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
export const nativeAssertionCommands = new Set(['assert.that','assert.value','dialog.expect','network.expect','download.expect','stub.expect','a11y.scan','a11y.match','api.expectSchema','console.expect','channel.expect','visual.match']);
export function isAssertionStep(action: string, payload: any): boolean {
  return action === 'expect' || action === 'plugin' || action === 'native' && nativeAssertionCommands.has(payload?.pluginMethod);
}

/** Soft mode is deliberately limited to built-in assertions; custom plugins retain their contract. */
export function isSoftAssertionStep(action: string, payload: any): boolean {
  return action === 'expect' || action === 'native' && nativeAssertionCommands.has(payload?.pluginMethod);
}

export function isControlDurationTemplate(value: unknown): value is string {
  return typeof value === 'string' && /^(?:\{\{env\.[A-Za-z_]\w*\}\}|@(?:[A-Za-z_]\w*|global\[[A-Za-z_]\w*\]))$/.test(value);
}

/** Interpolated durations are validated again at execution; no coercion of booleans/objects is allowed. */
export function validateControlDuration(value: unknown, command: 'wait' | 'pace', allowTemplate = false): number | undefined {
  if (allowTemplate && isControlDurationTemplate(value)) return;
  const maximum = command === 'wait' ? 86400000 : 60000;
  const invalid = () => new Error(`flow.${command} requires a finite integer duration from 0 to ${maximum} milliseconds.`);
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw invalid();
  const milliseconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > maximum) throw invalid();
  return milliseconds;
}

/** User messages share the dashboard transport limit so pauses are always resumable. */
export function validateControlMessage(value: unknown, command: 'log' | 'pause'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 32768) {
    throw new Error(`flow.${command} requires a nonempty quoted message of at most 32768 characters.`);
  }
  return value;
}
