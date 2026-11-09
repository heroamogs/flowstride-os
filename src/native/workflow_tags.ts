/** Tag names are case-insensitive and use portable CLI characters. */
export function workflowTags(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32 ||
      input.some(tag => typeof tag !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(tag))) {
    throw new Error('Provide 1–32 tags using letters, digits, underscores or hyphens.');
  }
  return [...new Set(input.map(tag => tag.toLowerCase()))].sort();
}
