import { describe, expect, it } from "vitest";
import { z } from "zod";
import { diagnoseReportError } from "../src/report/diagnostic-error.js";

describe("리포트 오류 진단", () => {
  it("API 오류의 안전한 상태와 코드만 기록", () => {
    const error = Object.assign(new Error("sk-sensitive-secret"), { name: "APIError", status: 429, code: "rate_limit" });
    error.stack = "Error: sk-sensitive-secret\n    at request (/Users/real-user/app.ts:10:2)";
    expect(diagnoseReportError(error)).toEqual({
      reason: "api_error_429", errorName: "APIError", status: 429, code: "rate_limit",
      stackFrames: ["at request (/Users/:user/app.ts:10:2)"]
    });
  });
  it.each([
    [new SyntaxError("bad json"), "response_json_invalid"],
    [new Error("OpenAI 응답 Incident 구성 검증 실패"), "incident_composition_invalid"],
    [new Error("OpenAI 응답 중요도 검증 실패"), "severity_mismatch"],
    [new Error("OpenAI 응답 건수 검증 실패"), "event_count_mismatch"],
    [new Error("OpenAI 응답 근거 검증 실패"), "evidence_mismatch"],
    [new Error("OpenAI 가설 검증 실패"), "hypothesis_policy_invalid"],
    [new Error("OpenAI 응답 Slack 안전성 검증 실패"), "output_safety_invalid"]
  ])("오류를 고정된 안전 분류로 변환", (error, reason) => {
    expect(diagnoseReportError(error).reason).toBe(reason);
  });
  it("Zod 오류와 Error가 아닌 값을 분류", () => {
    const parsed = z.string().safeParse(42);
    if (parsed.success) throw new Error("테스트 준비 오류");
    expect(diagnoseReportError(parsed.error).reason).toBe("response_schema_invalid");
    expect(diagnoseReportError("failure")).toEqual({ reason: "unknown", errorName: "UnknownError", stackFrames: [] });
  });
});
