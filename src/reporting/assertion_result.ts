import { redactPayload } from '../security/redaction';
export type AssertionCheckStatus = 'passed' | 'failed' | 'not_evaluated' | 'running';
export interface AssertionCheck {
  key: string; label: string; status: AssertionCheckStatus;
  expected?: string; actual?: string; reason?: string; children?: AssertionCheck[];
}
export interface AssertionResult {
  command: string; target: string; status: 'passed' | 'failed' | 'running' | 'not_evaluated'; checks: AssertionCheck[];
  timeout?: number; elapsed?: number; reason?: string;
  sourceFile?: string; sourceLine?: number; profile?: string;
}
export type AssertionReporter = (result: AssertionResult) => void;

/** Diagnostic text is bounded data, including in terminals and exported reports. */
export function diagnosticValue(value: unknown): string {
  let text: string;
  try { const safe = redactPayload(value); text = typeof safe === 'string' ? safe : JSON.stringify(safe); }
  catch { text = '[unavailable]'; }
  if (text === undefined) text = '(not observed)';
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).slice(0, 1500);
}
export function assertionCheck(key: string, label: string, matched: boolean, expected?: unknown, actual?: unknown): AssertionCheck {
  return { key, label, status: matched ? 'passed' : 'failed',
    ...(expected === undefined ? {} : { expected: diagnosticValue(expected) }),
    ...(actual === undefined ? {} : { actual: diagnosticValue(actual) }) };
}
export function assertionText(result: AssertionResult): string {
  const lines = [`${result.status === 'passed' ? '✔' : result.status === 'not_evaluated' ? '○' : result.status === 'running' ? '◌' : '✖'} flow.${result.command}`];
  const visit = (check: AssertionCheck, depth: number) => {
    const prefix = '  '.repeat(depth);
    lines.push(`${prefix}${check.status === 'passed' ? '✔' : check.status === 'failed' ? '✖' : '○'} ${diagnosticValue(check.label)}${check.status === 'not_evaluated' ? ' — Not evaluated' : ''}`);
    if (check.status === 'failed') {
      if (check.expected !== undefined) lines.push(`${prefix}    Expected: ${diagnosticValue(check.expected)}`);
      if (check.actual !== undefined) lines.push(`${prefix}    Actual: ${diagnosticValue(check.actual)}`);
      if (check.reason) lines.push(`${prefix}    Reason: ${diagnosticValue(check.reason)}`);
    }
    for (const child of check.children || []) visit(child, depth + 1);
  };
  for (const check of result.checks) visit(check, 1);
  if (result.status === 'failed' && result.reason) lines.push(`  Reason: ${diagnosticValue(result.reason)}`);
  if (result.timeout !== undefined) lines.push(`  Timeout: ${result.timeout} ms; elapsed: ${result.elapsed || 0} ms`);
  if (result.sourceFile) lines.push(`  Location: ${diagnosticValue(result.sourceFile)}${result.sourceLine ? ':' + result.sourceLine : ''}`);
  if (result.profile) lines.push(`  Profile: ${diagnosticValue(result.profile)}`);
  return lines.join('\n');
}
export class AssertionFailure extends Error {
  public readonly assertion: AssertionResult;
  constructor(assertion: AssertionResult) {
    super(`${assertion.reason?.includes('timed out') ? 'Assertion timed out' : 'Assertion failed'}: ${assertion.target}\n${assertionText(assertion)}`);
    this.assertion = assertion;
    this.name = 'AssertionFailure';
  }
}
export function reportAssertion(command: string, target: string, checks: AssertionCheck[], reporter?: AssertionReporter, metadata: Partial<AssertionResult> = {}): AssertionResult {
  const result: AssertionResult = { command, target, status: checks.some(check => check.status === 'failed') ? 'failed' : 'passed', checks, ...metadata };
  reporter?.(result);
  return result;
}
export function requireAssertion(command: string, target: string, checks: AssertionCheck[], reporter?: AssertionReporter, metadata: Partial<AssertionResult> = {}): void {
  const result = reportAssertion(command, target, checks, reporter, metadata);
  if (result.status === 'failed') throw new AssertionFailure(result);
}
export function failedAssertion(result: AssertionResult | undefined, reason: string): AssertionResult | undefined {
  if (!result) return;
  const copy = structuredClone(result);
  copy.status = 'failed'; copy.reason ||= diagnosticValue(reason.split("\n")[0]);
  if (/exceeded|timed out|timeout/i.test(reason)) copy.elapsed = Math.max(copy.elapsed || 0, copy.timeout || 0);
  for (const check of copy.checks) if (check.status === 'running') check.status = 'failed';
  if (!copy.checks.some(check => check.status === 'failed')) copy.checks.push({ key: 'completion', label: 'Command completed within its deadline', status: 'failed', reason: diagnosticValue(reason) });
  return copy;
}
export function commandLabel(action: string, payload: any): string {
  return action === 'native' && typeof payload?.pluginMethod === 'string' ? 'flow.' + payload.pluginMethod
    : action === 'plugin' && typeof payload?.pluginAlias === 'string' ? payload.pluginAlias + '.' + payload.pluginMethod : action;
}

export function unexecutedAssertion(action: string, payload: any, reason = 'A previous required step failed.'): AssertionResult | undefined {
  if (action !== 'native' || !['assert.that','network.expect','download.expect','stub.expect','a11y.scan','a11y.match','a11y.snapshot'].includes(payload?.pluginMethod)) return;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const fields = payload.pluginMethod === 'assert.that' ? ['role','name','selector','condition'] : Object.keys(data).filter(key=>!['timeout','name'].includes(key));
  return { command:payload.pluginMethod,target:payload.pluginMethod,status:'not_evaluated',reason,checks:fields.slice(0,100).map(key=>({key,label:key+': '+diagnosticValue(data[key]),status:'not_evaluated',reason})) };
}
