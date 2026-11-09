import { dataSnapshot } from './paths';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { assertionCheck, requireAssertion, diagnosticValue, type AssertionReporter } from '../reporting/assertion_result';

const valueSchema = z.object({
  actual: z.unknown(),
  operator: z.enum(['equals','notEquals','contains','greaterThan','greaterThanOrEqual','lessThan','lessThanOrEqual','type']),
  expected: z.unknown(),
  message: z.string().min(1).max(1500).optional(),
}).strict();

/** Immediate assertion on captured values; UI/browser conditions use assert.that. */
export function assertValue(input: unknown, reporter?: AssertionReporter): void {
  const data = valueSchema.parse(input);
  if (!Object.prototype.hasOwnProperty.call(data, 'actual') || !Object.prototype.hasOwnProperty.call(data, 'expected')) {
    throw new Error('Stored-value assertion requires actual and expected.');
  }
  data.actual = dataSnapshot(data.actual);
  data.expected = dataSnapshot(data.expected);
  let matched = false;
  if (data.operator === 'equals' || data.operator === 'notEquals') {
    matched = isDeepStrictEqual(data.actual, data.expected);
    if (data.operator === 'notEquals') matched = !matched;
  } else if (data.operator === 'contains') {
    if (typeof data.actual === 'string' && typeof data.expected === 'string') matched = data.actual.includes(data.expected);
    else if (Array.isArray(data.actual)) matched = data.actual.some(value => isDeepStrictEqual(value, data.expected));
    else if (data.actual !== null && typeof data.actual === 'object' && data.expected !== null && typeof data.expected === 'object' && !Array.isArray(data.expected)) {
      matched = Object.entries(data.expected).every(([key, expected]) => Object.prototype.hasOwnProperty.call(data.actual, key) && isDeepStrictEqual((data.actual as Record<string,unknown>)[key], expected));
    } else throw new Error('contains requires matching strings, an array with an expected item, or an object with an expected object subset.');
  } else if (data.operator === 'type') {
    if (!['string','number','boolean','array','object','null'].includes(String(data.expected))) throw new Error('type requires string, number, boolean, array, object or null.');
    const actualType = data.actual === null ? 'null' : Array.isArray(data.actual) ? 'array' : typeof data.actual;
    matched = actualType === data.expected && (actualType !== 'number' || Number.isFinite(data.actual));
  } else {
    if (typeof data.actual !== 'number' || !Number.isFinite(data.actual) || typeof data.expected !== 'number' || !Number.isFinite(data.expected)) {
      throw new Error('Numeric value assertions require finite numbers for both actual and expected; strings are not coerced.');
    }
    if (data.operator === 'greaterThan') matched = data.actual > data.expected;
    if (data.operator === 'greaterThanOrEqual') matched = data.actual >= data.expected;
    if (data.operator === 'lessThan') matched = data.actual < data.expected;
    if (data.operator === 'lessThanOrEqual') matched = data.actual <= data.expected;
  }
  requireAssertion('assert.value', 'stored value', [assertionCheck('value', `value ${data.operator}`, matched, data.expected, data.actual)], reporter,
    { ...(data.message ? { message: diagnosticValue(data.message) } : {}), ...(!matched ? { reason: 'Stored value did not satisfy '+data.operator+'.' } : {}) });
}
