import type { LogsReader, Publisher, ReportWriter, RunStore } from "../application/ports.js";
import type { EventAggregate, Incident } from "../domain/incident.js";
import { fallbackReport } from "../report/fallback.js";

export class FixtureLogsReader implements LogsReader {
  constructor(private readonly events: readonly EventAggregate[]) {}
  async readEvents(): Promise<readonly EventAggregate[]> { return this.events.map((event) => ({ ...event })); }
}

export class MemoryRunStore implements RunStore {
  private dates: ReadonlySet<string> = new Set();
  async acquire(reportDate: string): Promise<boolean> {
    if (this.dates.has(reportDate)) return false;
    this.dates = new Set([...this.dates, reportDate]);
    return true;
  }
  async markSent(): Promise<void> {}
  async markFailed(reportDate: string): Promise<void> {
    this.dates = new Set([...this.dates].filter((date) => date !== reportDate));
  }
}

export class DeterministicReportWriter implements ReportWriter {
  async write(incident: Incident): Promise<string> { return fallbackReport(incident); }
}

export class JsonPublisher implements Publisher {
  constructor(private readonly write: (line: string) => void) {}
  async publish(text: string, reportDate: string): Promise<string> {
    const messageId = `local-${reportDate}`;
    this.write(JSON.stringify({ messageId, reportDate, text }));
    return messageId;
  }
}
