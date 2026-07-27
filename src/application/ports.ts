import type { DetectorRule, EventAggregate, Incident } from "../domain/incident.js";
import type { ReportWindow } from "../domain/report-window.js";

export interface LogsReader { readEvents(window: ReportWindow): Promise<readonly EventAggregate[]>; }
export interface ReportWriter { write(incident: Incident): Promise<string>; }
export interface Publisher { publish(text: string, reportDate: string): Promise<string>; }
export interface Dependencies {
  readonly logsReader: LogsReader;
  readonly reportWriter: ReportWriter;
  readonly publisher: Publisher;
  readonly detectorRules: readonly DetectorRule[];
}
