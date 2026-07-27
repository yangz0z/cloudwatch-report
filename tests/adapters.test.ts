import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWatchLogsReader } from "../src/adapters/cloudwatch-logs-reader.js";
import { loadSecrets } from "../src/adapters/secrets.js";
import { loadDetectorRules } from "../src/adapters/parameter-store.js";
import { SlackPublisher } from "../src/adapters/slack-publisher.js";
import { loadConfig } from "../src/config.js";
import { windowForReportDate } from "../src/domain/report-window.js";

describe("CloudWatch Logs 어댑터", () => {
  it("완료된 집계를 변환", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ queryId: "query-1" })
      .mockResolvedValueOnce({ status: "Running" })
      .mockResolvedValueOnce({ status: "Complete", results: [[
        { field: "fatalCount", value: "0" },
        { field: "service", value: "example-service" }, { field: "category", value: "database" },
        { field: "provider", value: "example-db" }, { field: "operation", value: "read_items" },
        { field: "endpoint", value: "/v1/items" }, { field: "errorCode", value: "QUERY_TIMEOUT" },
        { field: "failureCount", value: "42" }, { field: "firstSeen", value: "2030-01-13 16:00:00.000" },
        { field: "lastSeen", value: "2030-01-13T17:00:00Z" }
      ]] });
    const reader = new CloudWatchLogsReader({ send } as never, ["/example/app"], vi.fn());
    await expect(reader.readEvents(windowForReportDate("2030-01-14"))).resolves.toEqual([expect.objectContaining({
      service: "example-service", errorCode: "QUERY_TIMEOUT", count: 42,
      firstSeenKst: "2030-01-14T01:00:00.000+09:00"
    })]);
    const queryInput = send.mock.calls[0]?.[0].input;
    expect(queryInput.queryString).toContain("regex_replace(coalesce(`service.name`, `frontend.service.name`");
    expect(queryInput.queryString).toContain("regex_replace(coalesce(`integration.name`, integration_name");
    expect(queryInput.queryString).toContain("regex_replace(coalesce(`event.name`, event_name");
    expect(queryInput.queryString).not.toContain("SourceContext");
    expect(queryInput.queryString).not.toContain("ActionName");
    expect(queryInput.queryString).toContain('sum(if(toupper(@@l) = "FATAL", 1, 0)) as fatalCount');
    expect(queryInput.queryString).toContain('toupper(@@l) in ["ERROR", "FATAL"]');
    expect(queryInput.queryString).toContain("sort fatalCount desc, failureCount desc");
    expect(queryInput.queryString).toContain("limit 10000");
    expect(queryInput.queryString).toContain("ispresent(`integration.failure`)");
    expect(queryInput.queryString).toContain("ispresent(integration_failure)");
    expect(queryInput.queryString).toContain('"/redacted" as endpoint');
    expect(queryInput.queryString).not.toMatch(/errorCode\n.*event_name/);
    expect(queryInput.queryString).not.toContain("@message");
    expect(queryInput.queryString).not.toContain("`url.path`");
    expect(queryInput.queryString).not.toContain("RequestPath");
  });

  it("queryId 누락과 실패 상태를 거부", async () => {
    await expect(new CloudWatchLogsReader({ send: vi.fn().mockResolvedValue({}) } as never, ["/example/app"])
      .readEvents(windowForReportDate("2030-01-14"))).rejects.toThrow("queryId");
    const send = vi.fn().mockResolvedValueOnce({ queryId: "q" }).mockResolvedValueOnce({ status: "Failed" });
    await expect(new CloudWatchLogsReader({ send } as never, ["/example/app"]).readEvents(windowForReportDate("2030-01-14")))
      .rejects.toThrow("쿼리 실패");
  });

  it("빈 집계를 정상 처리", async () => {
    const send = vi.fn().mockResolvedValueOnce({ queryId: "q" }).mockResolvedValueOnce({ status: "Complete", results: [] });
    await expect(new CloudWatchLogsReader({ send } as never, ["/example/app"]).readEvents(windowForReportDate("2030-01-14")))
      .resolves.toEqual([]);
  });

  it("Fatal 집계를 로그 수준으로 변환하고 잘못된 건수를 거부", async () => {
    const result = (fatalCount: string, failureCount = "2") => [[
      { field: "fatalCount", value: fatalCount }, { field: "service", value: "example-service" },
      { field: "category", value: "database" }, { field: "provider", value: "internal" },
      { field: "operation", value: "read_items" }, { field: "endpoint", value: "/redacted" },
      { field: "errorCode", value: "QUERY_TIMEOUT" }, { field: "failureCount", value: failureCount },
      { field: "firstSeen", value: "2030-01-13T16:00:00Z" },
      { field: "lastSeen", value: "2030-01-13T17:00:00Z" }
    ]];
    const complete = vi.fn().mockResolvedValueOnce({ queryId: "q" })
      .mockResolvedValueOnce({ status: "Complete", results: result("1") });
    await expect(new CloudWatchLogsReader({ send: complete } as never, ["/example/app"])
      .readEvents(windowForReportDate("2030-01-14"))).resolves.toEqual([expect.objectContaining({ level: "fatal" })]);

    const invalid = vi.fn().mockResolvedValueOnce({ queryId: "q" })
      .mockResolvedValueOnce({ status: "Complete", results: result("3") });
    await expect(new CloudWatchLogsReader({ send: invalid } as never, ["/example/app"])
      .readEvents(windowForReportDate("2030-01-14"))).rejects.toThrow("Fatal 집계값");
  });
});

describe("설정과 비밀값", () => {
  it("환경변수와 Secrets Manager JSON을 검증", async () => {
    expect(loadConfig({ LOG_GROUP_NAMES: "/example/app", SECRET_ID: "secret",
      SLACK_CHANNEL_ID: "C123", DETECTOR_RULES_PARAMETER_NAME: "/example/rules" }).AWS_REGION)
      .toBe("ap-northeast-2");
    const send = vi.fn().mockResolvedValue({ SecretString: JSON.stringify({
      openaiApiKey: "a".repeat(20), slackBotToken: "x".repeat(20)
    }) });
    await expect(loadSecrets({ send } as never, "secret")).resolves.toEqual({
      openaiApiKey: "a".repeat(20), slackBotToken: "x".repeat(20)
    });
  });

  it("SSM에서 Detector Rule을 조회", async () => {
    const send = vi.fn().mockResolvedValue({ Parameter: { Value: JSON.stringify([{
      errorCode: "QUERY_TIMEOUT", knownCause: "가상 원인", recommendedActions: ["가상 조치"]
    }]) } });
    await expect(loadDetectorRules({ send } as never, "/example/rules")).resolves.toHaveLength(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({ Name: "/example/rules" });
  });

  it("SSM 누락값과 잘못된 Rule을 거부", async () => {
    await expect(loadDetectorRules({ send: vi.fn().mockResolvedValue({}) } as never, "/example/rules"))
      .rejects.toThrow("값 누락");
    await expect(loadDetectorRules({ send: vi.fn().mockResolvedValue({ Parameter: { Value: "not-json" } }) } as never, "/example/rules"))
      .rejects.toThrow();
    await expect(loadDetectorRules({ send: vi.fn().mockResolvedValue({ Parameter: { Value: "[{}]" } }) } as never, "/example/rules"))
      .rejects.toThrow();
  });

  it("문자열 비밀값 누락을 거부", async () => {
    await expect(loadSecrets({ send: vi.fn().mockResolvedValue({}) } as never, "secret")).rejects.toThrow("누락");
  });
});

describe("Slack 어댑터", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Block Kit 메시지를 전송", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ok: true, ts: "123.456" }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SlackPublisher("x".repeat(20), "C123").publish("x".repeat(3_001), "2030-01-14")).resolves.toBe("123.456");
    const payload = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(payload.blocks).toHaveLength(2);
    expect(payload.blocks[0].text.text).toHaveLength(3_000);
  });

  it("API 오류와 너무 긴 메시지를 거부", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: false, error: "invalid_auth" }) }));
    const publisher = new SlackPublisher("x".repeat(20), "C123");
    await expect(publisher.publish("보고서", "2030-01-14")).rejects.toThrow("invalid_auth");
    await expect(publisher.publish("x".repeat(12_001), "2030-01-14")).rejects.toThrow("길이 제한");
  });

  it("429 Retry-After 이후 재시도", async () => {
    const headers = { get: vi.fn().mockReturnValue("1") };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 429, headers })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true, ts: "123.456" }) });
    const wait = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SlackPublisher("x".repeat(20), "C123", wait).publish("보고서", "2030-01-14"))
      .resolves.toBe("123.456");
    expect(wait).toHaveBeenCalledWith(1_000);
  });
});
