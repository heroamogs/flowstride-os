import { positive } from './validation';

/** Only commands whose validated contract accepts a timeout may override it. */
export function nativeStepTimeout(command: string, input: unknown, fallback: number): number {
  if (['assert.that', 'a11y.match', 'a11y.snapshot', 'stub.expect'].includes(command) &&
      input !== null && typeof input === 'object' && !Array.isArray(input) &&
      Object.hasOwn(input, 'timeout')) {
    return positive.parse((input as Record<string, unknown>).timeout);
  }
  return fallback;
}
