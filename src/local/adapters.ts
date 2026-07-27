import type { LogsReader, Publisher, ReportWriter } from "../application/ports.js";
import type { EventAggregate, Incident } from "../domain/incident.js";
import { fallbackReport } from "../report/fallback.js";

export class FixtureLogsReader implements LogsReader {
  constructor(private readonly events: readonly EventAggregate[]) {}
  async readEvents(): Promise<readonly EventAggregate[]> { return this.events.map((event) => ({ ...event })); }
}

export class DeterministicReportWriter implements ReportWriter {
  async write(incidents: readonly Incident[]): Promise<readonly string[]> { return incidents.map(fallbackReport); }
}

export class JsonPublisher implements Publisher {
  constructor(private readonly write: (line: string) => void) {}
  async publish(text: string, reportDate: string): Promise<string> {
    const messageId = `local-${reportDate}`;
    this.write(JSON.stringify({ messageId, reportDate, text }));
    return messageId;
  }
}
