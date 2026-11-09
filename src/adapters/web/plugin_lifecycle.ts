const guarded = Symbol('flowstride.userAgentLifecycle');

/** The pinned UA plugin starts a CDP send without awaiting it. Own that promise
 * so closing a popup/context cannot create an unhandled rejection. UA behavior
 * and every other stealth hook stay intact; active-page errors still propagate. */
export function settleUserAgentOverride(plugin: any): void {
  if (!plugin || plugin.name !== 'stealth/evasions/user-agent-override' || plugin[guarded]) return;
  const original = plugin.onPageCreated;
  plugin[guarded] = true;
  plugin.onPageCreated = async function(page: any) {
    const pending: Promise<unknown>[] = [];
    const proxy = new Proxy(page, {
      get(target, key, receiver) {
        if (key !== '_client') return Reflect.get(target,key,receiver);
        const client = typeof target._client === 'function' ? target._client() : target._client;
        return () => new Proxy(client, {
          get(session, method, sessionReceiver) {
            if (method !== 'send') return Reflect.get(session,method,sessionReceiver);
            return (...args: unknown[]) => {
              const operation = Promise.resolve().then(() => session.send(...args));
              pending.push(operation);
              // The original hook ignores this return value. Handle rejection immediately.
              void operation.catch(() => {});
              return operation;
            };
          },
        });
      },
    });
    try { await original.call(this,proxy); await Promise.all(pending); }
    catch (error) {
      await Promise.allSettled(pending);
      if (page.isClosed?.() && /(?:target|page|context|browser|session).*(?:closed|detached)/i.test(String(error))) return;
      throw error;
    }
  };
}
