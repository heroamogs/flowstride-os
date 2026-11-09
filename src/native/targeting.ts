import { z } from 'zod';

const readableText = z.string().min(1).max(2000).refine(value => value.trim().length > 0, 'Readable text must not be blank.');
export const readableTargetSchema = z.union([
  readableText,
  z.object({
    text: readableText,
    element: z.enum(['button','link','a','input','field','div','span','image','img','text','table','tr','th','td','iframe']).optional(),
    inside: readableText.optional(),
    near: readableText.optional(),
    above: readableText.optional(),
    under: readableText.optional(),
    below: readableText.optional(),
    leftOf: readableText.optional(),
    rightOf: readableText.optional(),
  }).strict().refine(target => ['near','above','under','below','leftOf','rightOf'].filter(key => key in target).length <= 1,
    'Choose one directional spatial relationship; inside may be combined with it.'),
]);
export type ReadableTarget = z.infer<typeof readableTargetSchema>;
export function readableTargetDescription(target: ReadableTarget): string {
  if (typeof target === 'string') return JSON.stringify(target);
  const parts = [target.element, JSON.stringify(target.text)].filter(Boolean);
  for (const key of ['inside','near','above','under','below','leftOf','rightOf'] as const) {
    if (target[key] !== undefined) parts.push(key, JSON.stringify(target[key]));
  }
  return parts.join(' ');
}
