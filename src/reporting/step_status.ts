/** Presentation shared by the interactive TestCase view and exported PDF. */
export interface StepStatusPresentation {
  status: string;
  label: string;
  actualResult: string;
  color: string;
  isPassed: boolean;
  isFailed: boolean;
}

export function stepStatusPresentation(value: unknown): StepStatusPresentation {
  const status = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : value == null ? "pending" : "unknown";
  const result = (state: string, label: string, actualResult: string, color = "#64748b") => ({
    status: state, label, actualResult, color,
    isPassed: state === "passed",
    isFailed: state === "failed" || state === "error",
  });

  switch (status) {
    case "pass":
    case "passed":
    case "success":
      return result("passed", "PASSED", "Action verified successfully.", "#10b981");
    case "fail":
    case "failed":
      return result("failed", "FAILED", "Validation failed.", "#ef4444");
    case "error":
      return result("error", "ERROR", "Step execution failed.", "#ef4444");
    case "skip":
    case "skipped":
      return result("skipped", "SKIPPED", "Step skipped; not executed.");
    case "not_tested":
      return result("not_tested", "NOT TESTED", "Step not tested.");
    case "":
    case "pending":
      return result("pending", "PENDING", "Awaiting execution.");
    case "running":
    case "in_progress":
      return result("running", "RUNNING", "Execution in progress.");
    case "cancelled":
    case "canceled":
      return result("cancelled", "CANCELLED", "Execution cancelled.");
    case "interrupted":
      return result("interrupted", "INTERRUPTED", "Execution interrupted.");
    case "blocked":
      return result("blocked", "BLOCKED", "Execution blocked.");
    default:
      return result("unknown", "UNKNOWN", "Result unavailable.");
  }
}
