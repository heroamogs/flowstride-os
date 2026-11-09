import { parentPort, workerData } from 'node:worker_threads';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

function validate() {
  const { schema, body } = workerData;
  const draft = schema?.$schema;
  const options = { allErrors: false, strictSchema: true, strictTypes: false, ownProperties: true };
  const ajv = draft === 'https://json-schema.org/draft/2020-12/schema' || draft === 'https://json-schema.org/draft/2020-12/schema#'
    ? new Ajv2020(options) : new Ajv(options);
  addFormats(ajv);
  let check;
  try {
    // Synchronous compilation has no external schema resolver or network access.
    check = ajv.compile(schema);
  } catch (error) {
    return { error: error instanceof Ajv.MissingRefError
      ? 'Schema reference could not be resolved. Use references within the same file.'
      : 'Invalid or unsupported JSON Schema. Check its keywords and Draft 7 or 2020-12 declaration.' };
  }
  if ('$async' in check && check.$async) return { error: 'Asynchronous JSON Schema validation is unavailable.' };
  const valid = check(body);
  const violation = check.errors?.[0];
  return { valid, violation: violation && {
    path: violation.instancePath || '/',
    keyword: violation.keyword,
    message: violation.message,
    missing: violation.keyword === 'required' ? violation.params.missingProperty : undefined,
  } };
}

try { parentPort!.postMessage(validate()); }
catch { parentPort!.postMessage({ error: 'JSON Schema validation could not complete within its resource limits.' }); }
