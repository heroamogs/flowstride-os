import { request } from "undici";
import { FlowstrideConfig } from "../../types";

import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { apiRequestFields, apiRequestSchema, httpURL, requestHeaders, sendApiRequest, withinApiDeadline, type ApiRequest, type CompleteApiState } from '../../native/api_transport';
import { expectApiSchema } from '../../native/api_schema';
import { parseDataPath, readDataPath } from '../../native/paths';
import { name, headers } from '../../native/validation';
import { assertionCheck, requireAssertion, type AssertionReporter } from '../../reporting/assertion_result';
import { isSensitiveField } from '../../security/sensitiveFields';

const createContextSchema = z.object({ name, baseUrl: z.string().min(1).max(4000).optional(), headers: headers.optional(), cookies: z.boolean().default(false) }).strict();
const contextSelector = z.object({ name }).strict();
const pollSchema = z.object({
  ...apiRequestFields, path: z.string().min(1).max(1000), equals: z.json(),
  interval: z.number().int().min(50).max(30000).default(500),
}).strict();

interface ApiContext {
  baseUrl: string;
  headers?: Record<string, string>;
  cookies?: CookieJar;
  state?: CompleteApiState;
}

export interface ApiState {
  status: number | null;
  body: any | null;
  headers: Record<string, string | string[] | undefined> | null;
  responseTime: number;
}

export class ApiAdapter {
  private globalHeaders: Record<string, string> = {};
  private onUnauthorized?: () => Promise<void>;
  private unauthorizedStatus?: number;
  private refreshing = false;

  private state?: CompleteApiState;
  private legacySessionResponse = false;
  private contexts = new Map<string, ApiContext>();
  private selected = 'default';
  private cancellation = new AbortController();

  constructor(private config: FlowstrideConfig) {}

  public resetCancellation() { this.cancellation = new AbortController(); }
  public cancelNativeRequests() { this.cancellation.abort(); }

  public setGlobalHeader(name: string, value: string): void {
    this.globalHeaders[name] = value;
  }

  public setUnauthorizedHandler(handler: () => Promise<void>, status?: number): void {
    if (status !== undefined && status !== 401 && status !== 403) {
      throw new Error('Authentication refresh status must be 401 or 403.');
    }
    this.onUnauthorized = handler;
    this.unauthorizedStatus = status;
  }

  private responseState(): CompleteApiState {
    const state = this.selected === 'default' ? this.state : this.contexts.get(this.selected)?.state;
    if (!state) throw new Error('No API request has been executed yet to extract state from in the selected API context.');
    return state;
  }

  public getState(): ApiState {
    const { status, body, headers, responseTime } = this.responseState();
    return { status, body, headers, responseTime };
  }

  public getLegacySessionState(): ApiState | undefined {
    return this.selected === 'default' && this.legacySessionResponse ? this.getState() : undefined;
  }

  // Browser session injection and cleanup retain their original application scope.
  public snapshotHeaders(): Record<string, string> {
    return { ...this.globalHeaders };
  }

  public checkpointState() {
    const contexts = [...this.contexts].map(([key, context]) => {
      const { cookies, ...data } = context;
      return [key, { ...data, cookies: cookies?.serializeSync() }] as const;
    });
    return structuredClone({
      globalHeaders: this.globalHeaders, state: this.state, legacySessionResponse: this.legacySessionResponse,
      selected: this.selected, contexts,
    });
  }

  public restoreState(snapshot: ReturnType<ApiAdapter['checkpointState']>) {
    const data = structuredClone(snapshot);
    this.globalHeaders = data.globalHeaders;
    this.state = data.state;
    this.legacySessionResponse = data.legacySessionResponse;
    this.selected = data.selected;
    this.contexts = new Map(data.contexts.map(([key, context]) => {
      const { cookies, ...stored } = context;
      return [key, { ...stored, cookies: cookies && CookieJar.deserializeSync(cookies) }];
    }));
  }

  public resetState(): void {
    this.state = undefined;
    this.legacySessionResponse = false;
    this.contexts.clear();
    this.selected = 'default';
  }

  private updateState(context: ApiContext | undefined, state?: CompleteApiState) {
    if (context) context.state = state;
    else {
      this.state = state;
      this.legacySessionResponse = false;
    }
  }

  private async structuredRequest(data: ApiRequest, signal: AbortSignal, context?: ApiContext): Promise<CompleteApiState> {
    const base = context?.baseUrl || this.config.baseUrl;
    const url = httpURL(data.url, base);
    const sameOrigin = !!base && url.origin === httpURL(base).origin;
    if (context && !sameOrigin) throw new Error('API context is limited to the origin of its baseUrl. Select a different context for this request.');
    const outgoing = requestHeaders(context ? context.headers : sameOrigin ? this.globalHeaders : undefined, data.headers);
    const jar = context?.cookies && CookieJar.deserializeSync(context.cookies.serializeSync()!);
    const response = await sendApiRequest(this.config, data, url, outgoing, signal, jar);
    if (context && jar) context.cookies = jar;
    this.updateState(context, response);
    return response;
  }

  public async executeNative(action: string, input: unknown, reporter?: AssertionReporter): Promise<void> {
    const signal = this.cancellation.signal;
    signal.throwIfAborted();
    if (action === 'create') {
      const data = createContextSchema.parse(input);
      if (data.name === 'default' || this.contexts.has(data.name)) throw new Error('API context name already exists. Close it or choose another name.');
      if (this.contexts.size >= 16) throw new Error('A flow can have at most 16 named API contexts.');
      const baseUrl = httpURL(data.baseUrl || this.config.baseUrl || '').href;
      requestHeaders(data.headers);
      this.contexts.set(data.name, { baseUrl, headers: data.headers, cookies: data.cookies ? new CookieJar() : undefined });
      return;
    }
    if (action === 'use' || action === 'close') {
      const { name: selected } = contextSelector.parse(input);
      if (selected !== 'default' && !this.contexts.has(selected)) throw new Error('Unknown API context. Create it before selecting or closing it.');
      if (action === 'use') this.selected = selected;
      else {
        if (selected === 'default') throw new Error('The default API context cannot be closed.');
        this.contexts.delete(selected);
        if (this.selected === selected) this.selected = 'default';
      }
      return;
    }
    if (action === 'expectSchema') return expectApiSchema(this.config, input, this.responseState(), signal, reporter);
    const context = this.contexts.get(this.selected);
    if (action === 'request') {
      const data = apiRequestSchema.parse(input);
      this.updateState(context);
      await withinApiDeadline(this.timeout(data.timeout), signal, current => this.structuredRequest(data, current, context));
      return;
    }
    if (action === 'poll') {
      const { path, equals, interval, ...data } = pollSchema.parse(input);
      const sensitive = parseDataPath(path).some(isSensitiveField);
      const timeout = this.timeout(data.timeout), start = Date.now();
      let attempts = 0;
      let observed = 'No response received';
      let last: unknown;
      this.updateState(context);
      try {
        await withinApiDeadline(timeout, signal, async current => {
          for (;;) {
            attempts++;
            const state = await this.structuredRequest({ ...data, method: 'GET' }, current, context);
            observed = `HTTP ${state.status}`;
            last = undefined;
            if (state.status >= 200 && state.status < 300) {
              if (!state.jsonBody) observed += ', no JSON body';
              else {
                try {
                  last = readDataPath(state.body, path);
                  if (isDeepStrictEqual(last, equals)) return;
                  observed += ', value did not match';
                } catch { observed += ', path missing or exceeds data limits'; }
              }
            } else if (![404, 408, 425, 429].includes(state.status) && state.status < 500) {
              throw new Error('API poll stopped on a non-retryable HTTP response.');
            }
            await sleep(interval, undefined, { signal: current });
          }
        });
      } catch (error) {
        const check = assertionCheck('value', `Response path "${path}" matched`, false,
          sensitive ? '[REDACTED]' : equals, last === undefined ? observed : sensitive ? '[REDACTED]' : last);
        check.reason = `${observed}; ${attempts} GET attempt(s).`;
        return requireAssertion('api.poll', 'API response body', [check], reporter, {
          timeout, elapsed: Date.now() - start, reason: error instanceof Error ? error.message : 'API polling failed.',
        });
      }
      requireAssertion('api.poll', 'API response body', [assertionCheck('value', `Response path "${path}" matched`, true)], reporter, { timeout, elapsed: Date.now() - start });
      return;
    }
    throw new Error(`Unknown API action: ${action}`);
  }

  private timeout(explicit?: number): number {
    return explicit ?? Math.min(this.config.timeout || 15000, 120000);
  }

  public async get(
    path: string,
    headers: { key: string; value: string }[] = [],
  ) {
    return this.execute("GET", path, headers);
  }

  public async delete(
    path: string,
    headers: { key: string; value: string }[] = [],
  ) {
    return this.execute("DELETE", path, headers);
  }

  public async post(
    path: string,
    headers: { key: string; value: string }[],
    body?: string,
  ) {
    return this.execute("POST", path, headers, body);
  }

  public async put(
    path: string,
    headers: { key: string; value: string }[],
    body?: string,
  ) {
    return this.execute("PUT", path, headers, body);
  }

  public async patch(
    path: string,
    headers: { key: string; value: string }[],
    body?: string,
  ) {
    return this.execute("PATCH", path, headers, body);
  }

  public async graphql(
    path: string,
    headers: { key: string; value: string }[],
    bodyContent: string,
  ) {
    let finalPayload = bodyContent;
    try {
      JSON.parse(bodyContent);
    } catch {
      finalPayload = JSON.stringify({ query: bodyContent.trim() });
    }
    const hasContentType = headers.some(
      (h) => h.key.toLowerCase() === "content-type",
    );
    if (!hasContentType)
      headers.push({ key: "Content-Type", value: "application/json" });
    return this.execute("POST", path, headers, finalPayload);
  }

  private async execute(
    method: any,
    path: string,
    headersArray: { key: string; value: string }[] = [],
    body?: string,
  ): Promise<void> {
    const context = this.contexts.get(this.selected);
    if (context) {
      const headers = Object.fromEntries(headersArray.map(({ key, value }) => [key, value]));
      if (body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      this.updateState(context);
      await withinApiDeadline(this.timeout(), this.cancellation.signal, signal =>
        this.structuredRequest(apiRequestSchema.parse({ method, url: path, headers, body }), signal, context));
      return;
    }
    const url =
      this.config.baseUrl && !path.startsWith("http")
        ? `${this.config.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
        : path;

    const requestHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Flowstride/1.0",
      Accept: "application/json, text/plain, */*",
      ...this.globalHeaders,
    };

    let hasContentType = false;
    headersArray.forEach((h) => {
      requestHeaders[h.key] = h.value;
      if (h.key.toLowerCase() === "content-type") hasContentType = true;
    });

    if (body && !hasContentType) {
      requestHeaders["Content-Type"] = "application/json";
    }

    const makeRequest = async () => {
      const startTime = Date.now();
      const response = await request(url, {
        method,
        headers: requestHeaders,
        body: body ? body : undefined,
      });
      const responseTime = Date.now() - startTime;

      const text = await response.body.text();
      let parsedBody = text;
      let jsonBody = false;
      try {
        parsedBody = text ? JSON.parse(text) : null;
        jsonBody = !!text;
      } catch {}

      return {
        status: response.statusCode,
        headers: response.headers,
        body: parsedBody,
        jsonBody,
        responseTime,
      };
    };

    let res = await makeRequest();

    if ((res.status === 401 || res.status === 403) && this.onUnauthorized &&
        !this.refreshing && (this.unauthorizedStatus === undefined || res.status === this.unauthorizedStatus)) {
      // A refresh can use this adapter too. Never recursively refresh its own rejection.
      this.refreshing = true;
      try { await this.onUnauthorized(); }
      finally { this.refreshing = false; }
      Object.assign(requestHeaders, this.globalHeaders);
      res = await makeRequest();
    }

    this.state = res;
    this.legacySessionResponse = true;
  }
}
