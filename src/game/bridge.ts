/** Register observable state and explicitly test-only fixtures in a browser game. */
export interface GameBridgeOptions {
  readState?: () => unknown;
  locate?: (id: string) => { x: number; y: number };
  testMode?: boolean;
  fixtures?: Record<string, (data: unknown) => unknown>;
}
export function registerGame(options: GameBridgeOptions) {
  if (typeof window === 'undefined') throw new Error('Game bridges must be registered in the browser.');
  if (typeof options.readState !== 'function' && typeof options.locate !== 'function') throw new Error('A game bridge requires readState or locate.');
  const bridge = { readState: options.readState, locate: options.locate,
    testMode: options.testMode === true,
    fixtures: options.testMode === true ? options.fixtures || {} : {} };
  (window as any).__FLOWSTRIDE_GAME__ = bridge;
  return { dispose() { if ((window as any).__FLOWSTRIDE_GAME__ === bridge) delete (window as any).__FLOWSTRIDE_GAME__; } };
}
