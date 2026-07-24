import { describe, expect, it, vi } from "vitest";
import { generateDailyReport } from "../src/application/generate-daily-report.js";

const aggregate = {
  service: "example-service", category: "database", provider: "example-db", operation: "read_items",
  endpoint: "/v1/items", errorCode: "QUERY_TIMEOUT", count: 42,
  firstSeenKst: "2030-01-14T01:00:00+09:00", lastSeenKst: "2030-01-14T02:00:00+09:00"
};
const base = () => ({
  runStore: { acquire: vi.fn().mockResolvedValue(true), markSent: vi.fn(), markFailed: vi.fn() },
  logsReader: { readEvents: vi.fn().mockResolvedValue([aggregate]) },
  reportWriter: { write: vi.fn().mockResolvedValue("가상 리포트") }, publisher: { publish: vi.fn().mockResolvedValue("123.456") },
  detectorRules: []
});

describe("일일 리포트 유스케이스", () => {
  it("AI 실패 시 fallback을 전송", async () => {
    const dependencies = base();
    dependencies.reportWriter.write.mockRejectedValue(new Error("unavailable"));
    const result = await generateDailyReport({ reportDate: "2030-01-14" }, dependencies);
    expect(result).toMatchObject({ status: "sent", fallbackCount: 1 });
    expect(dependencies.publisher.publish.mock.calls[0]?.[0]).toContain("QUERY_TIMEOUT");
  });
  it("이미 발송된 날짜는 외부 호출 없이 종료", async () => {
    const dependencies = base();
    dependencies.runStore.acquire.mockResolvedValue(false);
    await expect(generateDailyReport({ reportDate: "2030-01-14" }, dependencies)).resolves.toMatchObject({ status: "skipped" });
    expect(dependencies.logsReader.readEvents).not.toHaveBeenCalled();
  });
  it("오류가 없으면 정상 메시지를 전송", async () => {
    const dependencies = base();
    dependencies.logsReader.readEvents.mockResolvedValue([]);
    await generateDailyReport({ reportDate: "2030-01-14" }, dependencies);
    expect(dependencies.publisher.publish.mock.calls[0]?.[0]).toContain("구조화된 중요 오류가 탐지되지 않음");
  });
  it("발송 실패를 기록하고 오류를 전파", async () => {
    const dependencies = base();
    dependencies.publisher.publish.mockRejectedValue(new Error("publish failed"));
    await expect(generateDailyReport({ reportDate: "2030-01-14" }, dependencies)).rejects.toThrow("publish failed");
    expect(dependencies.runStore.markFailed).toHaveBeenCalled();
  });
});
