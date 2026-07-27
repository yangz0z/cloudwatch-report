import OpenAI from "openai";
import { z } from "zod";
import type { ReportWriter } from "../application/ports.js";
import type { Incident } from "../domain/incident.js";
import instructions from "../prompts/incident-analysis.instructions.md";

const NarrativeSchema = z.object({
  incidentId: z.string(), title: z.string().min(1).max(200), summary: z.string().min(1).max(500),
  problem: z.string().min(1).max(500), likelyCauses: z.array(z.string().min(1).max(500)).min(1).max(3),
  impact: z.string().min(1).max(500), actions: z.array(z.string().min(1).max(300)).min(1).max(5),
  confidence: z.enum(["low", "medium", "high"]),
  causeSource: z.enum(["catalog", "standard_protocol", "ai_hypothesis", "insufficient"]),
  evidenceUsed: z.array(z.string().min(1).max(300)).min(1).max(5),
  unknowns: z.array(z.string().min(1).max(300)).max(5),
  severity: z.enum(["info", "warning", "critical"]), eventCount: z.number().int().positive()
}).strict();
const BatchSchema = z.object({ reports: z.array(NarrativeSchema).min(1).max(3) }).strict();
const SENSITIVE_OUTPUT = /(?:\b(?:sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|internal|local)\b)/i;

const jsonSchema = {
  type: "object", additionalProperties: false, required: ["reports"], properties: { reports: {
    type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false,
      required: ["incidentId", "title", "summary", "problem", "likelyCauses", "impact", "actions", "confidence", "causeSource", "evidenceUsed", "unknowns", "severity", "eventCount"],
      properties: {
        incidentId: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, problem: { type: "string" },
        likelyCauses: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } }, impact: { type: "string" },
        actions: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        causeSource: { type: "string", enum: ["catalog", "standard_protocol", "ai_hypothesis", "insufficient"] },
        evidenceUsed: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
        unknowns: { type: "array", maxItems: 5, items: { type: "string" } },
        severity: { type: "string", enum: ["info", "warning", "critical"] }, eventCount: { type: "integer", minimum: 1 }
      }
    }
  } }
} as const;

export class OpenAiReportWriter implements ReportWriter {
  constructor(private readonly client: OpenAI, private readonly model: string) {}

  async write(incidents: readonly Incident[]): Promise<readonly string[]> {
    if (incidents.length < 1 || incidents.length > 3) throw new Error("OpenAI 분석 대상 개수 오류");
    const response = await this.client.responses.create({
      model: this.model, instructions,
      input: JSON.stringify(incidents.map(toSafeInput)),
      text: { format: { type: "json_schema", name: "daily_incident_reports", strict: true, schema: jsonSchema } }
    });
    const parsed = BatchSchema.parse(JSON.parse(response.output_text));
    const byId = new Map(incidents.map((incident) => [incident.id, incident]));
    if (parsed.reports.length !== incidents.length || new Set(parsed.reports.map(({ incidentId }) => incidentId)).size !== incidents.length) {
      throw new Error("OpenAI 응답 Incident 구성 검증 실패");
    }
    const byReportId = new Map(parsed.reports.map((report) => [report.incidentId, report]));
    return incidents.map((incident) => {
      const report = byReportId.get(incident.id);
      if (!report || !byId.has(report.incidentId)) throw new Error("OpenAI 응답 Incident 구성 검증 실패");
      validateReport(report, incident);
      const label = report.severity === "critical" ? "🚨 Critical" : report.severity === "warning" ? "⚠️ Warning" : "ℹ️ Info";
      const causes = report.likelyCauses.join(", ");
      const unknowns = report.unknowns.length > 0 ? `\n• 추가 확인: ${report.unknowns.join(", ")}` : "";
      const title = `${incident.service} ${incident.operation} 오류`;
      const summary = `동일한 구조화 오류 ${incident.count}건 발생`;
      return `${label} — ${title}\n\n${summary}\n\n• 문제: ${report.problem}\n` +
        `• 7일 일평균: ${incident.baselineDailyAverage}건 / 기준 대비: ${incident.increaseRatio}배\n` +
        `• 예측 원인: ${causes} (${report.confidence})\n• 사용자 영향: ${report.impact}\n` +
        `• 권장 조치: ${report.actions.join(", ")}${unknowns}\n\n근거: 동일한 구조화 오류 ${report.eventCount}건`;
    });
  }
}

function toSafeInput(incident: Incident) {
  return {
    incidentId: incident.id, reportDate: incident.reportDate, service: incident.service, category: incident.category,
    provider: incident.provider, operation: incident.operation, endpoint: incident.endpoint, errorCode: incident.errorCode,
    httpStatus: incident.httpStatus, eventCount: incident.count, firstSeenKst: incident.firstSeenKst,
    lastSeenKst: incident.lastSeenKst, severity: incident.severity, baselineDailyAverage: incident.baselineDailyAverage,
    increaseRatio: incident.increaseRatio, problem: incident.problem, likelyCauses: incident.likelyCauses,
    impact: incident.impact, recommendedActions: incident.recommendedActions, confidence: incident.confidence,
    causeSource: incident.causeSource, selectionReasons: incident.selectionReasons,
    evidence: evidenceFor(incident)
  };
}

function validateReport(report: z.infer<typeof NarrativeSchema>, incident: Incident): void {
  if (report.severity !== incident.severity || report.eventCount !== incident.count) throw new Error("OpenAI 응답 근거 검증 실패");
  if (!report.evidenceUsed.every((value) => evidenceFor(incident).includes(value))) throw new Error("OpenAI 응답 근거 검증 실패");
  if (incident.causeSource !== "unresolved") {
    if (report.causeSource !== incident.causeSource || report.problem !== incident.problem || report.impact !== incident.impact ||
        report.confidence !== incident.confidence || !report.likelyCauses.every((value) => incident.likelyCauses.includes(value)) ||
        !report.actions.every((value) => incident.recommendedActions.includes(value))) throw new Error("OpenAI 응답 근거 검증 실패");
  } else if (!["ai_hypothesis", "insufficient"].includes(report.causeSource) || report.confidence === "high") {
    throw new Error("OpenAI 가설 검증 실패");
  }
  for (const value of [report.title, report.summary, report.problem, report.impact, ...report.likelyCauses, ...report.actions, ...report.evidenceUsed, ...report.unknowns]) {
    if (/[<>]/.test(value) || /@(channel|here|everyone)/i.test(value) || SENSITIVE_OUTPUT.test(value) ||
        [...value].some((character) => character.charCodeAt(0) < 32)) {
      throw new Error("OpenAI 응답 Slack 안전성 검증 실패");
    }
  }
}

function evidenceFor(incident: Incident): readonly string[] {
  return Object.freeze([
    `eventCount=${incident.count}`, `severity=${incident.severity}`,
    `baselineDailyAverage=${incident.baselineDailyAverage}`, `increaseRatio=${incident.increaseRatio}`,
    ...incident.selectionReasons.map((reason) => `selectionReason=${reason}`),
    ...(incident.httpStatus === undefined ? [] : [`httpStatus=${incident.httpStatus}`])
  ]);
}
