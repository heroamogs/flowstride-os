const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertValue } = require('../../dist/native/value_assertions');
const { AssertionFailure, assertionText } = require('../../dist/reporting/assertion_result');
const { readableTargetSchema } = require('../../dist/native/targeting');

for (const [operator, actual, expected] of [
  ['equals', { order: { id: 42 }, active: false }, { order: { id: 42 }, active: false }],
  ['notEquals', 42, '42'], ['contains', 'Order approved', 'approved'],
  ['contains', [{ id: 42 }], { id: 42 }], ['contains', { id: 42, active: true }, { id: 42 }],
  ['greaterThan', 42, 0], ['greaterThanOrEqual', 42, 42],
  ['lessThan', 1, 42], ['lessThanOrEqual', 42, 42],
  ['type', false, 'boolean'], ['type', 0, 'number'], ['type', [], 'array'],
  ['type', {}, 'object'], ['type', null, 'null'], ['equals', null, null],
]) test(`stored-value ${operator} compares typed JSON without changing it: ${JSON.stringify(actual)}`, () => {
  const original = structuredClone(actual), reports = [];
  assertValue({ operator, actual, expected, message: 'Verify the captured order' }, result => reports.push(result));
  assert.equal(reports.at(-1).status, 'passed');
  assert.equal(reports.at(-1).message, 'Verify the captured order');
  assert.equal(reports.at(-1).checks[0].status, 'passed');
  assert.deepEqual(actual, original);
});

test('failed value checks preserve detailed expected/actual/operator and the user message', () => {
  let result;
  assert.throws(() => assertValue({ actual: 0, expected: 10, operator: 'greaterThan', message: 'A completed order must have a positive total' }, value => result = value), AssertionFailure);
  assert.equal(result.status, 'failed');
  assert.match(assertionText(result), /greaterThan/);
  assert.match(assertionText(result), /Expected: 10/);
  assert.match(assertionText(result), /Actual: 0/);
  assert.equal(result.message, 'A completed order must have a positive total');
});

for (const input of [
  { operator: 'greaterThan', actual: '42', expected: 0 },
  { operator: 'equals', actual: NaN, expected: NaN },
  { operator: 'equals', actual: Infinity, expected: Infinity },
  { operator: 'equals', actual: undefined, expected: undefined },
  { operator: 'equals', expected: 1 }, { operator: 'equals', actual: 1 },
  { operator: 'contains', actual: 42, expected: '4' },
  { operator: 'type', actual: 42, expected: 'integer' },
  { operator: 'constructor', actual: 42, expected: 42 },
  { operator: 'equals', actual: 1, expected: 1, soft: true },
]) test(`invalid stored-value assertion fails closed: ${String(input.operator)} ${String(input.actual)}`, () => {
  assert.throws(() => assertValue(input));
});

test('deep equality keeps booleans, numbers, arrays and null distinct', () => {
  for (const [actual, expected] of [[false, 'false'], [0, '0'], [null, 'null'], [[], {}], [{ a: 1 }, { a: '1' }]]) {
    assert.throws(() => assertValue({ actual, expected, operator: 'equals' }), AssertionFailure);
  }
});

test('value snapshots reject getters, functions, cycles and exotic prototypes without invoking code', () => {
  let invoked = false;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return 42; } });
  const cyclic = {}; cyclic.loop = cyclic;
  const exotic = Object.create({ inherited: 42 }); exotic.own = 1;
  for (const actual of [getter, () => { invoked = true; }, cyclic, exotic, new Date()]) {
    assert.throws(() => assertValue({ actual, expected: {}, operator: 'equals' }));
  }
  assert.equal(invoked, false);
});

test('object inclusion checks own keys, and sensitive object values stay out of diagnostics', () => {
  assert.throws(() => assertValue({ actual: {}, expected: { constructor: {}.constructor }, operator: 'contains' }));
  let result;
  assert.throws(() => assertValue({ actual: { password: 'actual-secret' }, expected: { password: 'expected-secret' }, operator: 'equals' }, value => result = value), AssertionFailure);
  assert.doesNotMatch(assertionText(result), /actual-secret|expected-secret/);
  assert.match(assertionText(result), /REDACTED/);
});

test('readable target schema preserves text/spatials and rejects ambiguous or unimplemented shapes', () => {
  for (const target of ['Login', { text: 'Email', element: 'input', inside: 'Login form', under: 'Password' }]) {
    assert.deepEqual(readableTargetSchema.parse(target), target);
  }
  for (const target of ['', '   ', { text: 'Login', selector: '#login' }, { text: 'Login', element: 'unknown' },
    { text: 'Login', near: 'Email', under: 'Password' }, { text: 'Login', inside: '' }, { text: 'x'.repeat(2001) }]) {
    assert.throws(() => readableTargetSchema.parse(target));
  }
});
