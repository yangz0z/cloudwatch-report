import { describe, expect, it, vi } from "vitest";
import { generateDailyReport } from "../src/application/generate-daily-report.js";

const aggregate = {
  service: "example-service", category: "database", provider: "example-db", operation: "read_items",
  endpoint: "/v1/items", errorCode: "QUERY_TIMEOUT", count: 42,
  firstSeenKst: "2030-01-14T01:00:00+09:00", lastSeenKst: "2030-01-14T02:00:00+09:00"
};
const base = () => ({
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
    expect(dependencies.logsReader.readEvents).toHaveBeenCalledTimes(2);
    const currentWindow = dependencies.logsReader.readEvents.mock.calls[0]?.[0];
    const baselineWindow = dependencies.logsReader.readEvents.mock.calls[1]?.[0];
    expect(currentWindow).toMatchObject({ startMs: Date.parse("2030-01-13T15:00:00Z"), endMs: Date.parse("2030-01-14T15:00:00Z") });
    expect(baselineWindow).toMatchObject({ startMs: Date.parse("2030-01-06T15:00:00Z"), endMs: Date.parse("2030-01-13T15:00:00Z") });
  });
  it("같은 날짜를 수동 재실행하면 다시 전송", async () => {
    const dependencies = base();
    await generateDailyReport({ reportDate: "2030-01-14" }, dependencies);
    await generateDailyReport({ reportDate: "2030-01-14" }, dependencies);
    expect(dependencies.publisher.publish).toHaveBeenCalledTimes(2);
  });
  it("오류가 없으면 정상 메시지를 전송", async () => {
    const dependencies = base();
    dependencies.logsReader.readEvents.mockResolvedValue([]);
    await generateDailyReport({ reportDate: "2030-01-14" }, dependencies);
    expect(dependencies.publisher.publish.mock.calls[0]?.[0]).toContain("구조화된 중요 오류가 탐지되지 않음");
  });
  it("낮은 빈도의 일반 오류는 AI에 보내지 않고 제외 건수를 알림", async () => {
    const dependencies = base();
    dependencies.logsReader.readEvents.mockResolvedValue([{ ...aggregate, count: 4 }]);
    await generateDailyReport({ reportDate: "2030-01-14" }, dependencies);
    expect(dependencies.reportWriter.write).not.toHaveBeenCalled();
    expect(dependencies.publisher.publish.mock.calls[0]?.[0])
      .toContain("중요 후보 0건(Critical 0, Warning 0) / 상세 알림 0건 / 제외·후순위 1건");
  });
  it("발송 오류를 전파", async () => {
    const dependencies = base();
    dependencies.publisher.publish.mockRejectedValue(new Error("publish failed"));
    await expect(generateDailyReport({ reportDate: "2030-01-14" }, dependencies)).rejects.toThrow("publish failed");
  });
  it("7일 baseline 수집 실패 시 전일 데이터로 계속 보고", async () => {
    const dependencies = base();
    dependencies.logsReader.readEvents.mockResolvedValueOnce([aggregate]).mockRejectedValueOnce(new Error("timeout"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(generateDailyReport({ reportDate: "2030-01-14" }, dependencies)).resolves.toMatchObject({ status: "sent" });
    expect(dependencies.publisher.publish.mock.calls[0]?.[0]).toContain("7일 기준 수집 실패");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("baseline_collection_failed"));
    warning.mockRestore();
  });
});
