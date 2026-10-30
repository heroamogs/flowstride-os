/** Transport libraries own framing, compression and connection-specific metadata. */
export function excludedRequestHeaders(headers: Record<string, unknown>): Set<string> {
  const excluded = new Set([
    'host', 'content-length', 'accept-encoding', 'connection', 'keep-alive',
    'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te',
    'trailer', 'transfer-encoding', 'upgrade', 'expect',
  ]);
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'connection' && typeof value === 'string') {
      for (const field of value.split(',')) excluded.add(field.trim().toLowerCase());
    }
  }
  return excluded;
}
