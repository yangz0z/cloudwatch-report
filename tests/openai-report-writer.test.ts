import { describe, expect, it, vi } from "vitest";
import { OpenAiReportWriter } from "../src/adapters/openai-report-writer.js";
import { createIncidents } from "../src/domain/incident.js";

const incidents = createIncidents("2030-01-14", [1, 2, 3].map((number) => ({
  service: "example-service", category: "dependency", provider: "example-provider", operation: `fetch_resource_${number}`,
  endpoint: "/v1/resources", errorCode: `UPSTREAM_TIMEOUT_${number}`, count: 40 + number, level: "error" as const,
  firstSeenKst: "2030-01-14T01:00:00+09:00", lastSeenKst: "2030-01-14T02:00:00+09:00"
})), []);

const reportFor = (incident: typeof incidents[number], overrides = {}) => ({
  incidentId: incident.id, title: "외부 의존성 오류", summary: `동일 오류 ${incident.count}건 발생`,
  problem: incident.problem, likelyCauses: ["외부 API의 일시적 지연 가능성"], impact: "기능 지연 가능성",
  actions: ["관련 로그와 최근 변경 사항 확인"], confidence: "medium", causeSource: "ai_hypothesis",
  unknowns: ["외부 API 응답 시간"],
  severity: incident.severity, eventCount: incident.count, ...overrides
});
const response = (reports = incidents.map((incident) => reportFor(incident))) => ({ output_text: JSON.stringify({ reports }) });

describe("OpenAI 배치 리포트 검증", () => {
  it("상위 3건을 한 번만 요청하고 입력 순서로 반환", async () => {
    const create = vi.fn().mockResolvedValue(response());
    const writer = new OpenAiReportWriter({ responses: { create } } as never, "example-model");
    const output = await writer.write(incidents);
    expect(output).toHaveLength(3);
    expect(output[0]).toContain(`${incidents[0]!.count}건`);
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(create.mock.calls[0]?.[0].input)).toHaveLength(3);
    expect(create.mock.calls[0]?.[0].instructions).toContain("가설");
  });
  it("건수 변조와 Incident 누락을 거부", async () => {
    const tampered = new OpenAiReportWriter({ responses: { create: vi.fn().mockResolvedValue(response([
      reportFor(incidents[0]!, { eventCount: 99 }), ...incidents.slice(1).map((incident) => reportFor(incident))
    ])) } } as never, "example-model");
    await expect(tampered.write(incidents)).rejects.toThrow("근거 검증");
    const missing = new OpenAiReportWriter({ responses: { create: vi.fn().mockResolvedValue(response([reportFor(incidents[0]!)])) } } as never, "example-model");
    await expect(missing.write(incidents)).rejects.toThrow("구성 검증");
  });
  it("미확정 오류의 high confidence와 Slack 멘션을 거부", async () => {
    const high = new OpenAiReportWriter({ responses: { create: vi.fn().mockResolvedValue(response([
      reportFor(incidents[0]!, { confidence: "high" }), ...incidents.slice(1).map((incident) => reportFor(incident))
    ])) } } as never, "example-model");
    await expect(high.write(incidents)).rejects.toThrow("가설 검증");
    const mention = new OpenAiReportWriter({ responses: { create: vi.fn().mockResolvedValue(response([
      reportFor(incidents[0]!, { title: "@channel 오류" }), ...incidents.slice(1).map((incident) => reportFor(incident))
    ])) } } as never, "example-model");
    await expect(mention.write(incidents)).rejects.toThrow("Slack 안전성");
    const internalHost = new OpenAiReportWriter({ responses: { create: vi.fn().mockResolvedValue(response([
      reportFor(incidents[0]!, { summary: "prod-db.internal 장애" }), ...incidents.slice(1).map((incident) => reportFor(incident))
    ])) } } as never, "example-model");
    await expect(internalHost.write(incidents)).rejects.toThrow("Slack 안전성");
  });
});
