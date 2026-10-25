import { redactText } from '../security/redaction';
import { diagnosticValue } from './assertion_result';

export interface FailureContext { file?: string; line?: number; profile?: string; timeout?: number; elapsed?: number; }
/** Preserve the adapter's evidence and nested causes, without printing request bodies or typed values. */
export function commandSecrets(command: string, payload: any): string[] {
  const secrets: string[] = [], seen = new Set<unknown>();
  const visit = (value:any, depth:number) => {
    if (depth > 8 || value == null || seen.has(value)) return;
    if (typeof value === 'string') { if (/^\s*[\[{]/.test(value)) { try { visit(JSON.parse(value),depth+1); } catch {} } return; }
    if (typeof value !== 'object') return;
    seen.add(value);
    for (const [key,item] of Object.entries(value).slice(0,200)) {
      if (/password|passcode|secret|token|authorization|cookie|api.?key|otp/i.test(key) && typeof item === 'string') secrets.push(item);
      else visit(item,depth+1);
    }
  };
  visit(payload,0);
  if (/^(?:flow\.)?(?:type|forceType|passcode)$/i.test(command) && typeof payload?.text === 'string') secrets.push(payload.text);
  return secrets;
}
export function runtimeFailure(command: string, payload: any, error: unknown, context: FailureContext): string {
  const label = command.includes('.') ? command : 'flow.' + command;
  const lines = [`Failed command: ${diagnosticValue(label)}`];
  if (context.file) lines.push(`Location: ${diagnosticValue(context.file)}${context.line ? ':' + context.line : ''}`);
  const input = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const fields = ['selector','role','name','text','url','path','file','filename','audioPath','sessionName','jsonPath','attribute','property','key','canvas','id','target'];
  const targets = fields.filter(key => !(/^(?:flow\.)?(?:type|forceType|passcode)$/i.test(command) && key === 'text') && (['string','number'].includes(typeof input[key]) || key === 'selector' && input[key] && typeof input[key] === 'object')).map(key => `${key}: ${diagnosticValue(input[key])}`);
  if (targets.length) lines.push('Target / resource: ' + targets.join('; '));
  if (context.profile) lines.push('Profile: ' + diagnosticValue(context.profile));
  if (context.timeout !== undefined) lines.push(`Timeout: ${context.timeout} ms${context.elapsed !== undefined ? '; elapsed: ' + context.elapsed + ' ms' : ''}`);
  const seen = new Set<unknown>(); let current: any = error;
  for (let depth = 0; current != null && depth < 5 && !seen.has(current); depth++) {
    seen.add(current);
    const message = typeof current === 'object' ? current.message || String(current) : String(current);
    // Keep line breaks in Playwright call logs, but escape terminal control sequences.
    const reason = String(message).slice(0,12000).split('\n').map(line => diagnosticValue(line)).join('\n');
    lines.push((depth ? 'Caused by: ' : 'Reason: ') + reason);
    if (current.code) lines.push('Error code: ' + diagnosticValue(current.code));
    current = current.cause;
  }
  return redactText(lines.join('\n'),commandSecrets(command,payload));
}
