import type { DetectorRule, EventAggregate, Incident } from "../domain/incident.js";
import type { ReportWindow } from "../domain/report-window.js";

export interface RunStore {
  acquire(reportDate: string): Promise<boolean>;
  markSent(reportDate: string, slackMessageTs: string): Promise<void>;
  markFailed(reportDate: string): Promise<void>;
}
export interface LogsReader { readEvents(window: ReportWindow): Promise<readonly EventAggregate[]>; }
export interface ReportWriter { write(incident: Incident): Promise<string>; }
export interface Publisher { publish(text: string, reportDate: string): Promise<string>; }
export interface Dependencies {
  readonly runStore: RunStore;
  readonly logsReader: LogsReader;
  readonly reportWriter: ReportWriter;
  readonly publisher: Publisher;
  readonly detectorRules: readonly DetectorRule[];
}
