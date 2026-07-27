import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SAM 재시도 설정", () => {
  it("예약 및 Lambda 비동기 재시도를 비활성화하고 DynamoDB를 사용하지 않음", async () => {
    const template = await readFile("template.yaml", "utf8");

    expect(template).toContain("MaximumRetryAttempts: 0");
    expect(template).toContain("EventInvokeConfig:");
    expect(template).not.toContain("AWS::DynamoDB::Table");
    expect(template).not.toContain("dynamodb:");
    expect(template).not.toContain("RUN_TABLE_NAME");
  });
  it("CommonJS 의존성을 안전하게 로딩하도록 Lambda 번들을 cjs 형식으로 생성", async () => {
    const template = await readFile("template.yaml", "utf8");
    expect(template).toContain("Format: cjs");
    expect(template).not.toContain(".js=.mjs");
  });
});
