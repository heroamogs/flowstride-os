export const expectationTypes = new Set([
  'status', 'responseTime', 'resBody', 'resHeader', 'cookie',
  'visible', 'text', 'value', 'attribute', 'transcript',
]);

export const apiAssertionConditions = new Set([
  'equals', 'contains', 'to.be', 'to.not.be', 'is', 'is.not',
  'type.of', 'format', 'matches', 'lessthan', 'greaterthan',
  'length', 'length.greaterthan', 'length.lessthan',
  'includes', 'does.not.include', 'has.key', 'does.not.have.key',
  'is.empty', 'not.empty',
]);

export function validateExpectationType(type: unknown): void {
  if (typeof type !== 'string' || !expectationTypes.has(type)) {
    throw new Error(`Unsupported flow.expect modifier: ${String(type)}.`);
  }
}

/** Templates are checked after interpolation; literal thresholds fail at parse time. */
export function validateResponseTimeThreshold(value: unknown, allowTemplate = false): number | undefined {
  if (allowTemplate && typeof value === 'string' &&
      /\{\{env\.[^}]+\}\}|(?:@|\$)(?:global\[[^\]]+\]|[a-zA-Z_]\w*)/.test(value)) return;
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && value.trim() === '')) {
    throw new Error('API responseTime threshold must be a finite nonnegative number.');
  }
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('API responseTime threshold must be a finite nonnegative number.');
  }
  return threshold;
}

export function validateApiAssertions(assertions: unknown): asserts assertions is { condition: string; value: string }[] {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new Error('API assertion requires at least one supported condition.');
  }
  for (const assertion of assertions) {
    if (!assertion || !apiAssertionConditions.has(assertion.condition)) {
      throw new Error(`Unsupported API assertion condition: ${String(assertion?.condition)}.`);
    }
    if (!['is.empty', 'not.empty'].includes(assertion.condition) && typeof assertion.value !== 'string') {
      throw new Error(`API assertion ${assertion.condition} requires an expected string.`);
    }
  }
}

/** And remains limited to assertions and existing custom assertion plugins. */
export const nativeAssertionCommands = new Set(['assert.that','network.expect','download.expect','stub.expect','a11y.scan','a11y.match']);
export function isAssertionStep(action: string, payload: any): boolean {
  return action === 'expect' || action === 'plugin' || action === 'native' && nativeAssertionCommands.has(payload?.pluginMethod);
}
