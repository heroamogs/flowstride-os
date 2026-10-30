const defectKey = /^workspaces\/[a-f\d]{24}\/media\/defect\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.(png|jpe?g|gif|webm|mp4)$/;
export function isPrivateDefectKey(value: unknown): value is string {
  return typeof value === 'string' && defectKey.test(value);
}

/** Change only the preview source; saved reports keep their canonical Cloud URL. */
export function localDefectPreviewUrl(raw: string): string {
  try {
    const url = new URL(raw, 'http://flowstride.local');
    if (url.username || url.password || url.hash || !['http:','https:'].includes(url.protocol)) return raw;
    const key = url.pathname === '/api/upload/media' && url.searchParams.getAll('key').length === 1 ?
      url.searchParams.get('key') : !url.search ? url.pathname.slice(1) : null;
    return isPrivateDefectKey(key) ? `/api/defect-preview?key=${encodeURIComponent(key)}` : raw;
  } catch { return raw; }
}
