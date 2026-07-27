import {
  CloudWatchLogsClient, GetQueryResultsCommand, StartQueryCommand, StopQueryCommand
} from "@aws-sdk/client-cloudwatch-logs";
import type { LogsReader } from "../application/ports.js";
import type { EventAggregate } from "../domain/incident.js";
import type { ReportWindow } from "../domain/report-window.js";

export const CLOUDWATCH_QUERY = `fields @timestamp,
  coalesce(\`service.name\`, \`frontend.service.name\`, "unknown-service") as service,
  coalesce(\`error.classification\`, error_classification, "unclassified-error") as category,
  coalesce(\`integration.name\`, integration_name, "internal") as provider,
  coalesce(\`event.name\`, event_name, ActionName, "unclassified-operation") as operation,
  "/redacted" as endpoint,
  coalesce(\`error.classification\`, error_classification, "UNCLASSIFIED_ERROR") as errorCode
| filter @l in ["Error", "Fatal"] or ispresent(\`error.classification\`) or ispresent(error_classification) or ispresent(\`integration.failure\`) or ispresent(integration_failure)
| stats count(*) as failureCount, min(@timestamp) as firstSeen, max(@timestamp) as lastSeen by service, category, provider, operation, endpoint, errorCode
| sort failureCount desc
| limit 100`;

export class CloudWatchLogsReader implements LogsReader {
  constructor(
    private readonly client: CloudWatchLogsClient,
    private readonly logGroupNames: readonly string[],
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async readEvents(window: ReportWindow): Promise<readonly EventAggregate[]> {
    const started = await this.client.send(new StartQueryCommand({
      logGroupNames: [...this.logGroupNames],
      startTime: Math.floor(window.startMs / 1000),
      endTime: Math.ceil(window.endMs / 1000) - 1,
      queryString: CLOUDWATCH_QUERY
    }));
    if (!started.queryId) throw new Error("Logs Insights queryId 누락");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await this.client.send(new GetQueryResultsCommand({ queryId: started.queryId }));
      if (result.status === "Complete") return (result.results ?? []).map(parseResult);
      if (["Failed", "Cancelled", "Timeout", "Unknown"].includes(result.status ?? "")) {
        throw new Error(`Logs Insights 쿼리 실패: ${result.status}`);
      }
      await this.wait(1_000);
    }
    await this.client.send(new StopQueryCommand({ queryId: started.queryId }));
    throw new Error("Logs Insights 쿼리 제한시간 초과");
  }
}

function parseResult(fields: readonly { field?: string | undefined; value?: string | undefined }[]): EventAggregate {
  const values = Object.fromEntries(fields.flatMap(({ field, value }) => field && value ? [[field, value]] : []));
  const count = Number(values.failureCount);
  if (!Number.isInteger(count) || count < 1) throw new Error("Logs Insights 집계값 오류");
  return {
    service: required(values.service, "service"), category: required(values.category, "category"),
    provider: required(values.provider, "provider"), operation: required(values.operation, "operation"),
    endpoint: required(values.endpoint, "endpoint"), errorCode: required(values.errorCode, "errorCode"), count,
    firstSeenKst: toKst(values.firstSeen), lastSeenKst: toKst(values.lastSeen)
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Logs Insights ${name} 누락`);
  return value;
}

function toKst(value: string | undefined): string {
  const time = Date.parse(required(value, "시각"));
  if (!Number.isFinite(time)) throw new Error("Logs Insights 시각 오류");
  return new Date(time + 9 * 3_600_000).toISOString().replace("Z", "+09:00");
}
