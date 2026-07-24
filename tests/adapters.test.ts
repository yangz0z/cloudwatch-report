import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWatchLogsReader } from "../src/adapters/cloudwatch-logs-reader.js";
import { DynamoDbRunStore } from "../src/adapters/dynamodb-run-store.js";
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
        { field: "service", value: "example-service" }, { field: "category", value: "database" },
        { field: "provider", value: "example-db" }, { field: "operation", value: "read_items" },
        { field: "endpoint", value: "/v1/items" }, { field: "errorCode", value: "QUERY_TIMEOUT" },
        { field: "failureCount", value: "42" }, { field: "firstSeen", value: "2030-01-13T16:00:00Z" },
        { field: "lastSeen", value: "2030-01-13T17:00:00Z" }
      ]] });
    const reader = new CloudWatchLogsReader({ send } as never, ["/example/app"], vi.fn());
    await expect(reader.readEvents(windowForReportDate("2030-01-14"))).resolves.toEqual([expect.objectContaining({
      service: "example-service", errorCode: "QUERY_TIMEOUT", count: 42
    })]);
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
});

describe("DynamoDB 실행 저장소", () => {
  it("실행권 획득 후 발송 상태 기록", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoDbRunStore({ send } as never, "runs");
    await expect(store.acquire("2030-01-14")).resolves.toBe(true);
    await store.markSent("2030-01-14", "123.456");
    await store.markFailed("2030-01-15");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("조건부 쓰기 충돌을 중복 실행으로 처리", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("duplicate"), { name: "ConditionalCheckFailedException" }));
    await expect(new DynamoDbRunStore({ send } as never, "runs").acquire("2030-01-14")).resolves.toBe(false);
  });
});

describe("설정과 비밀값", () => {
  it("환경변수와 Secrets Manager JSON을 검증", async () => {
    expect(loadConfig({ LOG_GROUP_NAMES: "/example/app", RUN_TABLE_NAME: "runs", SECRET_ID: "secret",
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
