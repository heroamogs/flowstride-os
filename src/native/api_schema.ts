import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { assertionCheck, requireAssertion, type AssertionReporter } from '../reporting/assertion_result';
import type { FlowstrideConfig } from '../types';
import { apiTimeout, withinApiDeadline, type CompleteApiState } from './api_transport';
import { dataSnapshot } from './paths';
import { readBoundedProjectFile } from './project_data';

interface SchemaOutcome {
  error?: string;
  valid?: boolean;
  violation?: { path: string; keyword: string; message?: string; missing?: string };
}

function validate(schema: unknown, body: unknown, signal: AbortSignal): Promise<SchemaOutcome> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(path.join(__dirname, 'api_schema_worker.js'), {
      workerData: { schema, body },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    const cancel = () => { void worker.terminate(); reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
    worker.once('message', resolve);
    worker.once('error', () => reject(new Error('JSON Schema validation exceeded its resource limits or could not start.')));
    worker.once('exit', () => {
      signal.removeEventListener('abort', cancel);
      reject(new Error('JSON Schema validation stopped before returning a result.'));
    });
  });
}

export async function expectApiSchema(
  config: FlowstrideConfig, input: unknown, state: CompleteApiState, signal: AbortSignal, reporter?: AssertionReporter,
) {
  const data = z.object({ file: z.string().min(1).max(4000), timeout: apiTimeout.optional() }).strict().parse(input);
  const target = 'API response body';
  const parsed = assertionCheck('body', 'Response body is JSON', state.jsonBody, 'JSON', state.jsonBody ? 'JSON' : 'Empty or non-JSON body');
  if (!state.jsonBody) return requireAssertion('api.expectSchema', target, [parsed], reporter);
  const bytes = readBoundedProjectFile(config, data.file, 256 * 1024);
  let schema: unknown;
  try { schema = dataSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''))); }
  catch { throw new Error('Schema file must contain valid UTF-8 JSON within the supported depth and size limits.'); }
  const timeout = data.timeout ?? Math.min(config.timeout || 15000, 120000);
  const started = Date.now();
  const result = await withinApiDeadline(timeout, signal, current => validate(schema, dataSnapshot(state.body), current));
  if (result.error) throw new Error(result.error);
  const violation = result.violation;
  const location = violation?.missing
    ? (violation.path === '/' ? '' : violation.path) + '/' + violation.missing.replace(/~/g, '~0').replace(/\//g, '~1')
    : violation?.path;
  const check = assertionCheck('schema', location ? `JSON Schema at ${location}` : 'Response matches JSON Schema', result.valid === true, violation?.keyword);
  if (violation) check.reason = violation.message;
  requireAssertion('api.expectSchema', target, [parsed, check], reporter, {
    timeout, elapsed: Date.now() - started, reason: violation ? `JSON Schema rule "${violation.keyword}" failed at ${location}.` : undefined,
  });
}
