export interface ExecutionPause {
  id: string;
  message: string;
  fileName?: string;
  scenario?: string;
  stepId?: string;
  attempt?: number;
  profile?: string;
  sourceLine?: number;
}

export function executionPause(payload: unknown): ExecutionPause | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) return null;
  if (typeof value.message !== 'string' || value.message.length > 32768) return null;
  const result: ExecutionPause = { id: value.id, message: value.message };
  for (const key of ['fileName', 'scenario', 'stepId', 'profile'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > 4096) return null;
      result[key] = value[key];
    }
  }
  for (const key of ['attempt', 'sourceLine'] as const) {
    if (value[key] !== undefined) {
      if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) return null;
      result[key] = value[key] as number;
    }
  }
  return result;
}
