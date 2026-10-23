import DOMPurify from 'dompurify';

export function sanitizeManualHtml(value: unknown): string {
  const clean = DOMPurify.sanitize(typeof value === 'string' ? value : '', {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'br', 'div', 'p', 'font'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'size'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const anchor of template.content.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');
    if (href) {
      try {
        if (/^[\s]*[\\/]{2}/.test(href) || !['http:', 'https:', 'mailto:'].includes(new URL(href, window.location.href).protocol)) anchor.removeAttribute('href');
      } catch { anchor.removeAttribute('href'); }
    }
    if (anchor.getAttribute('target') !== '_blank') anchor.removeAttribute('target');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return template.innerHTML;
}

export function sanitizeImportedCanvas(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid manual canvas');
  const canvas = { ...value } as Record<string, any>;
  for (const name of ['nodes', 'groups', 'texts', 'connections', 'executionReport']) {
    const list = canvas[name] ?? [];
    if (!Array.isArray(list) || list.length > 20000) throw new Error('Invalid manual canvas collection');
    canvas[name] = list.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !Number.isSafeInteger(item.id) || item.id < 0) throw new Error('Invalid manual canvas entry');
      const result = { ...item };
      for (const field of ['x', 'y', 'width', 'height']) {
        if (field in result && (typeof result[field] !== 'number' || !Number.isFinite(result[field]))) throw new Error('Invalid canvas geometry');
      }
      for (const field of ['description', 'steps', 'expected_result', 'references', 'defect_report']) {
        if (field in result) {
          if (typeof result[field] !== 'string' || result[field].length > 100000) throw new Error('Invalid manual rich text');
          result[field] = sanitizeManualHtml(result[field]);
        }
      }
      for (const field of ['title', 'visual_step', 'status', 'group_title', 'assigned_to', 'content']) {
        if (field in result && (typeof result[field] !== 'string' || result[field].length > 100000)) throw new Error('Invalid manual text');
      }
      return result;
    });
  }
  return canvas;
}
