const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;
const SENSITIVE_VALUE = /(?:sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16})/gi;

export interface ReportErrorDiagnostic {
  readonly reason: string;
  readonly errorName: string;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly stackFrames: readonly string[];
}

export function diagnoseReportError(error: unknown): ReportErrorDiagnostic {
  if (!(error instanceof Error)) return { reason: "unknown", errorName: "UnknownError", stackFrames: [] };
  const candidate = error as Error & { readonly status?: unknown; readonly code?: unknown };
  const status = typeof candidate.status === "number" && candidate.status >= 400 && candidate.status <= 599
    ? candidate.status : undefined;
  const code = typeof candidate.code === "string" && SAFE_CODE.test(candidate.code) ? candidate.code : undefined;
  return {
    reason: classify(error, status),
    errorName: SAFE_CODE.test(error.name) ? error.name : "Error",
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code }),
    stackFrames: Object.freeze((error.stack ?? "").split("\n").slice(1)
      .map((frame) => frame.trim()).filter((frame) => frame.startsWith("at ")).slice(0, 8)
      .map((frame) => frame.replace(/\/Users\/[^/]+/g, "/Users/:user").replace(SENSITIVE_VALUE, "[redacted]").slice(0, 300)))
  };
}

function classify(error: Error, status: number | undefined): string {
  if (status !== undefined) return `api_error_${status}`;
  if (error.name === "ZodError") return "response_schema_invalid";
  if (error instanceof SyntaxError) return "response_json_invalid";
  if (error.message.includes("Incident 구성")) return "incident_composition_invalid";
  if (error.message.includes("근거 검증")) return "evidence_mismatch";
  if (error.message.includes("가설 검증")) return "hypothesis_policy_invalid";
  if (error.message.includes("Slack 안전성")) return "output_safety_invalid";
  return "unknown";
}
