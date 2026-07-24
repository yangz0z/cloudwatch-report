import { describe, expect, it, vi } from "vitest";
import { OpenAiReportWriter } from "../src/adapters/openai-report-writer.js";
import { createIncidents } from "../src/domain/incident.js";

const incident = createIncidents("2030-01-14", [{
  service: "example-service", category: "dependency", provider: "example-provider", operation: "fetch_resource",
  endpoint: "/v1/resources", errorCode: "UPSTREAM_TIMEOUT", count: 42,
  firstSeenKst: "2030-01-14T01:00:00+09:00", lastSeenKst: "2030-01-14T02:00:00+09:00"
}], [])[0]!;

const response = (overrides = {}) => ({ output_text: JSON.stringify({
  incidentId: incident.id, title: "외부 의존성 오류", summary: "동일 오류 42건 발생",
  impact: "기능 지연 가능성", cause: incident.knownCause, actions: [...incident.recommendedActions],
  severity: "critical", eventCount: 42, ...overrides
}) });

describe("OpenAI 리포트 검증", () => {
  it("근거와 일치하는 구조화 응답만 사용", async () => {
    const create = vi.fn().mockResolvedValue(response());
    const writer = new OpenAiReportWriter({ responses: { create } } as never, "example-model");
    await expect(writer.write(incident)).resolves.toContain("42건");
    expect(create.mock.calls[0]?.[0].input).not.toContain("message");
  });
  it("건수 위변조와 Slack 멘션을 거부", async () => {
    const tampered = new OpenAiReportWriter({ responses: { create: vi.fn().mockResolvedValue(response({ eventCount: 99 })) } } as never, "example-model");
    await expect(tampered.write(incident)).rejects.toThrow("근거 검증");
    const mention = new OpenAiReportWriter({ responses: { create: vi.fn().mockResolvedValue(response({ title: "@channel 오류" })) } } as never, "example-model");
    await expect(mention.write(incident)).rejects.toThrow("Slack 안전성");
  });
});
