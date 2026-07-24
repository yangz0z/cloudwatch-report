import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLocalArgs, runLocal } from "../src/local/run-local.js";

describe("로컬 실행", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fixture만으로 전체 흐름을 실행하고 JSON을 출력", async () => {
    const fetchMock = vi.fn(() => { throw new Error("로컬 실행에서 네트워크 호출 금지"); });
    vi.stubGlobal("fetch", fetchMock);
    const write = vi.fn();
    const result = await runLocal({
      reportDate: "2030-01-14",
      eventsFile: "fixtures/events.example.json",
      rulesFile: "fixtures/detector-rules.example.json"
    }, write);
    expect(result).toMatchObject({ status: "sent", fallbackCount: 0 });
    expect(JSON.parse(write.mock.calls[0]?.[0])).toMatchObject({ reportDate: "2030-01-14" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("잘못된 fixture를 거부", async () => {
    await expect(runLocal({
      reportDate: "2030-01-14", eventsFile: "fixtures/detector-rules.example.json",
      rulesFile: "fixtures/detector-rules.example.json"
    }, vi.fn())).rejects.toThrow();
  });

  it("알 수 없거나 값이 누락된 CLI 인자를 거부", () => {
    expect(() => parseLocalArgs(["--unknown", "value"], "2030-01-14")).toThrow("지원하지 않는");
    expect(() => parseLocalArgs(["--events"], "2030-01-14")).toThrow("--key value");
  });
});
