import sanitizeHtml from "sanitize-html";
import { z } from "zod";
const MANUAL_HTML_TAGS = ["b", "i", "em", "strong", "a", "ul", "ol", "li", "br", "div", "p", "font"];

export function sanitizeManualHtml(value: unknown) {
  return sanitizeHtml(typeof value === "string" ? value : "", {
    allowedTags: MANUAL_HTML_TAGS,
    allowedAttributes: { a: ["href", "target", "rel"], font: ["size"] },
    allowedSchemes: ["http", "https", "mailto"], allowProtocolRelative: false,
    transformTags: { a: (tagName, attribs) => ({ tagName, attribs: {
      ...attribs, target: attribs.target === "_blank" ? "_blank" : "_self", rel: "noopener noreferrer",
    } }) },
  });
}
const label = z.string().max(2000);
const rich = z.string().max(100000).transform(sanitizeManualHtml);
const numeric = z.number().finite();
const media = z.string().max(8192).refine(value => !value || /^(https?:\/\/|\/(?!\/))[^\s\\]*$/i.test(value), "Invalid media URL");
const nodeFields = {
  id: z.number().int().nonnegative(), title: label.optional(), visual_step: label.optional(),
  description: rich.optional(), steps: rich.optional(), expected_result: rich.optional(), references: rich.optional(),
  defect_report: rich.optional(), defect_media: media.optional(), assigned_to: label.optional(), priority: label.optional(),
  x: numeric.optional(), y: numeric.optional(), width: numeric.optional(), height: numeric.optional(), is_active: z.boolean().optional(),
};
const node = z.looseObject(nodeFields);
const step = z.looseObject({ ...nodeFields, status: z.enum(["Pending", "Current", "Passed", "Failed", "Blocked", "Skipped", "Pass", "Fail", "Success", "passed", "failed", "pass", "fail", "success", "pending", "skipped", "blocked"]), group_title: label.optional() });
const group = z.looseObject({ id: z.number().int().nonnegative(), title: label.optional(), x: numeric.optional(), y: numeric.optional(), width: numeric.optional(), height: numeric.optional(), is_active: z.boolean().optional() });
const text = z.looseObject({ id: z.number().int().nonnegative(), content: label.optional(), x: numeric.optional(), y: numeric.optional(), width: numeric.optional(), height: numeric.optional(), is_active: z.boolean().optional() });
const connection = z.looseObject({ id: z.number().int().nonnegative() });
export const manualRunSchema = z.object({
  name: z.string().trim().min(1).max(255),
  status: z.enum(["PASS", "FAIL", "INCOMPLETE", "NO STEPS"]),
  metrics: z.object({ total: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), pending: z.number().int().nonnegative() }).refine(m => m.total === m.passed + m.failed + m.pending, "Inconsistent metrics"),
  canvasData: z.looseObject({ nodes: z.array(node).max(10000).default([]), groups: z.array(group).max(10000).default([]), texts: z.array(text).max(10000).default([]), connections: z.array(connection).max(20000).default([]), executionReport: z.array(step).max(10000).default([]), metadata: z.record(z.string(), z.unknown()).optional() }),
});
// Sanitize older records without trusting their original ingestion path.
export function sanitizeStoredCanvas(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const canvas = { ...value } as Record<string, unknown>;
  for (const key of ["nodes", "executionReport"]) {
    if (!Array.isArray(canvas[key])) { canvas[key] = []; continue; }
    canvas[key] = (canvas[key] as unknown[]).filter(item => item && typeof item === "object").map(item => {
      const result = { ...(item as Record<string, unknown>) };
      for (const field of ["description", "steps", "expected_result", "references", "defect_report"]) {
        if (field in result) result[field] = sanitizeManualHtml(result[field]);
      }
      return result;
    });
  }
  return canvas;
}

export const manualCanvasSchema = manualRunSchema.shape.canvasData;

export class ManualInputError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function readManualPayload(req: import("http").IncomingMessage) {
  const limit = 2 * 1024 * 1024;
  const length = req.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new ManualInputError(400, "Invalid request length");
  if (length && Number(length) > limit) throw new ManualInputError(413, "Manual payload exceeds 2 MiB");
  const buffer = Buffer.allocUnsafe(length ? Number(length) : limit); let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit || (length && bytes > Number(length))) { req.resume(); throw new ManualInputError(413, "Manual payload exceeds allowed size"); }
    buffer.set(chunk, bytes - chunk.length);
  }
  if (length && bytes !== Number(length)) throw new ManualInputError(400, "Request length mismatch");
  let payload;
  try { payload = JSON.parse(buffer.subarray(0, bytes).toString("utf8")); }
  catch { throw new ManualInputError(400, "Invalid manual JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ManualInputError(400, "Invalid manual payload");
  const canvas = manualCanvasSchema.safeParse(payload.canvasData);
  if (!canvas.success) throw new ManualInputError(400, "Invalid manual canvas");
  return { ...payload, canvasData: canvas.data };
}
