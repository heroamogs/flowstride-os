import { request } from 'undici';
import { z } from 'zod';
import type { StepNode } from '../parser/parser';

const registration = z.object({
  method: z.literal('DELETE'),
  url: z.string().min(1).max(4000),
}).strict();

export function cleanupRegistration(input: unknown): { method: 'DELETE'; url: string } {
  const data = registration.safeParse(input);
  if (!data.success) throw new Error('flow.cleanup.register requires method DELETE and a URL.');
  return data.data;
}

/** Substitutions stay within their URL component so IDs cannot change the request path or query. */
export function resolveCleanupTarget(template: string, resolve: (component: string) => string): string {
  return template.split(/([/?#&=])/).map((component, index) => {
    if (index % 2 || !component) return component;
    const value = resolve(component);
    if (value !== component && (!value.trim() || /[/?#&=\\]/.test(value))) {
      throw new Error('A cleanup URL variable must resolve to a nonempty URL component.');
    }
    return value;
  }).join('');
}

interface CleanupEntry {
  step: StepNode;
  url: URL;
  headers: Record<string, string>;
}

export interface CleanupOutcome {
  step: StepNode;
  status?: number;
  error?: string;
}

const unsafeHeader = /^(?:host|connection|upgrade|transfer-encoding|content-length|expect|te|trailer|keep-alive|proxy-.*)$/i;

/** Cleanup is restricted to the application's configured origin. */
function cleanupURL(baseUrl: string | undefined, value: string): URL {
  if (!baseUrl) throw new Error('flow.cleanup.register requires a configured application baseUrl.');
  const base = new URL(baseUrl);
  const rawPath = value.split('?')[0];
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
      /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value) ||
      value.startsWith('//') || /[\\\x00-\x20\x7f@#{}]/.test(value) ||
      /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)|%2f|%5c|%25/i.test(rawPath)) {
    throw new Error('Cleanup requires a resolved HTTP(S) URL without credentials, traversal or fragments.');
  }
  const url = new URL(/^https?:\/\//i.test(value)
    ? value
    : `${baseUrl.replace(/\/$/, '')}${value.startsWith('/') ? value : '/' + value}`);
  if (url.origin !== base.origin || url.username || url.password) {
    throw new Error('Cleanup can send requests only to the configured application origin.');
  }
  return url;
}

/** Each scenario attempt owns its queue, including on retries and cooperative cancellation. */
export class ScenarioCleanup {
  private entries: CleanupEntry[] = [];
  private result?: Promise<CleanupOutcome[]>;

  constructor(private readonly baseUrl: string | undefined) {}

  register(step: StepNode, input: unknown, headers: Record<string, string>): void {
    if (this.result) throw new Error('This scenario has already started cleanup.');
    if (this.entries.length >= 32) throw new Error('A scenario attempt can register at most 32 cleanup requests.');
    const data = cleanupRegistration(input);
    const url = cleanupURL(this.baseUrl, data.url);
    const captured = Object.fromEntries(Object.entries(headers).filter(([name]) => !unsafeHeader.test(name)));
    this.entries.push({ step, url, headers: captured });
  }

  get hasEntries(): boolean {
    return this.entries.length > 0;
  }

  drain(): Promise<CleanupOutcome[]> {
    return this.result ??= this.execute();
  }

  private async execute(): Promise<CleanupOutcome[]> {
    const deadline = Date.now() + 4000;
    const outcomes: CleanupOutcome[] = [];
    for (const { step, url, headers } of [...this.entries].reverse()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        outcomes.push({ step, error: 'Cleanup deadline expired before the request could start.' });
        continue;
      }
      const signal = AbortSignal.timeout(Math.min(2000, remaining));
      try {
        const response = await request(url, {
          method: 'DELETE',
          headers,
          signal,
        });
        // Cleanup only needs response status. Do not retain the response body or follow redirects.
        response.body.on('error', () => {});
        response.body.destroy();
        const status = response.statusCode;
        outcomes.push({
          step,
          status,
          ...(status < 200 || status >= 300 ? { error: `Cleanup DELETE returned HTTP ${status}. Expected a 2xx response.` } : {}),
        });
      } catch {
        const timedOut = signal.aborted;
        outcomes.push({ step, error: timedOut ? 'Cleanup DELETE timed out.' : 'Cleanup DELETE could not reach the application.' });
      }
    }
    this.entries = [];
    return outcomes;
  }
}
