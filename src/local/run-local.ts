import { readFile } from "node:fs/promises";
import { z } from "zod";
import { generateDailyReport } from "../application/generate-daily-report.js";
import { parseDetectorRules } from "../domain/detector-rules.js";
import { windowForReportDate } from "../domain/report-window.js";
import { DeterministicReportWriter, FixtureLogsReader, JsonPublisher } from "./adapters.js";

const EventSchema = z.object({
  level: z.enum(["error", "fatal"]).optional(),
  service: z.string(), category: z.string(), provider: z.string(), operation: z.string(), endpoint: z.string(),
  errorCode: z.string(), count: z.number().int().positive(), firstSeenKst: z.string(), lastSeenKst: z.string()
}).strict();

export interface LocalOptions { readonly reportDate: string; readonly eventsFile: string; readonly rulesFile: string; }

export function parseLocalArgs(args: readonly string[], defaultReportDate: string): LocalOptions {
  const allowed = new Set(["report-date", "events", "rules"]);
  let values: ReadonlyMap<string, string> = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("로컬 인자 형식 오류: --key value 필요");
    const name = key.slice(2);
    if (!allowed.has(name)) throw new Error(`지원하지 않는 로컬 인자: ${key}`);
    values = new Map([...values, [name, value]]);
  }
  return {
    reportDate: values.get("report-date") ?? defaultReportDate,
    eventsFile: values.get("events") ?? "fixtures/events.example.json",
    rulesFile: values.get("rules") ?? "fixtures/detector-rules.example.json"
  };
}

export async function runLocal(options: LocalOptions, write: (line: string) => void = console.log) {
  windowForReportDate(options.reportDate);
  const [eventsValue, rulesValue] = await Promise.all([readJson(options.eventsFile), readJson(options.rulesFile)]);
  const events = z.array(EventSchema).parse(eventsValue);
  const detectorRules = parseDetectorRules(rulesValue);
  return generateDailyReport({ reportDate: options.reportDate }, {
    logsReader: new FixtureLogsReader(events),
    reportWriter: new DeterministicReportWriter(), publisher: new JsonPublisher(write), detectorRules
  });
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
