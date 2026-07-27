import OpenAI from "openai";
import { z } from "zod";
import type { ReportWriter } from "../application/ports.js";
import type { Incident } from "../domain/incident.js";

const AiReportSchema = z.object({
  incidentId: z.string(),
  title: z.string().min(1),
  summary: z.string().min(1),
  impact: z.string().min(1),
  cause: z.string().min(1),
  actions: z.array(z.string()).min(1),
  severity: z.enum(["info", "warning", "critical"]),
  eventCount: z.number().int().nonnegative()
}).strict();

export class OpenAiReportWriter implements ReportWriter {
  constructor(private readonly client: OpenAI, private readonly model: string) {}

  async write(incident: Incident): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: [
        "제공된 Incident 필드에 없는 사실을 만들지 않는다.",
        "knownCause를 원인의 유일한 근거로 사용한다.",
        "사용자 영향은 가능성으로 표현한다.",
        "한국어 운영 리포트용 JSON만 생성한다."
      ].join(" "),
      input: JSON.stringify(incident),
      text: {
        format: {
          type: "json_schema",
          name: "daily_incident_report",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["incidentId", "title", "summary", "impact", "cause", "actions", "severity", "eventCount"],
            properties: {
              incidentId: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
              impact: { type: "string" }, cause: { type: "string" },
              actions: { type: "array", items: { type: "string" } },
              severity: { type: "string", enum: ["info", "warning", "critical"] },
              eventCount: { type: "integer", minimum: 0 }
            }
          }
        }
      }
    });
    const report = AiReportSchema.parse(JSON.parse(response.output_text));
    const actionsValid = report.actions.every((action) => incident.recommendedActions.includes(action));
    if (report.incidentId !== incident.id || report.severity !== incident.severity ||
        report.eventCount !== incident.count || report.cause !== incident.knownCause || !actionsValid) {
      throw new Error("OpenAI 응답 근거 검증 실패");
    }
    for (const value of [report.title, report.summary, report.impact]) {
      if (value.length > 500 || /[<>]/.test(value) || /@(channel|here|everyone)/i.test(value)) {
        throw new Error("OpenAI 응답 Slack 안전성 검증 실패");
      }
    }
    const label = report.severity === "critical" ? "🚨 Critical" : report.severity === "warning" ? "⚠️ Warning" : "ℹ️ Info";
    return `${label} — ${report.title}\n\n${report.summary}\n\n` +
      `• 7일 일평균: ${incident.baselineDailyAverage}건 / 전일 증가: ${incident.increaseRatio}배\n` +
      `• 오류 원인: ${report.cause}\n• 사용자 영향: ${report.impact}\n` +
      `• 권장 조치: ${report.actions.join(", ")}\n\n근거: 동일한 구조화 오류 ${report.eventCount}건`;
  }
}
