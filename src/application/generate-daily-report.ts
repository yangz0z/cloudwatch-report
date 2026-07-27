import { createIncidents, selectReportableIncidents } from "../domain/incident.js";
import { baselineWindowForReportDate, windowForReportDate } from "../domain/report-window.js";
import { fallbackReport } from "../report/fallback.js";
import { diagnoseReportError } from "../report/diagnostic-error.js";
import type { Dependencies } from "./ports.js";

export async function generateDailyReport(input: { readonly reportDate: string }, dependencies: Dependencies) {
  const [currentResult, baselineResult] = await Promise.allSettled([
    dependencies.logsReader.readEvents(windowForReportDate(input.reportDate)),
    dependencies.logsReader.readEvents(baselineWindowForReportDate(input.reportDate))
  ]);
  if (currentResult.status === "rejected") throw currentResult.reason;
  const aggregates = currentResult.value;
  const baselineAggregates = baselineResult.status === "fulfilled" ? baselineResult.value : undefined;
  if (baselineResult.status === "rejected") {
    console.warn(JSON.stringify({ event: "baseline_collection_failed", reportDate: input.reportDate }));
  }
  const incidents = createIncidents(input.reportDate, aggregates, dependencies.detectorRules, baselineAggregates, 7);
  const reportable = selectReportableIncidents(incidents, incidents.length);
  const selected = selectReportableIncidents(incidents);
  const criticalCount = reportable.filter(({ severity }) => severity === "critical").length;
  const warningCount = reportable.length - criticalCount;
  const baselineLabel = baselineAggregates === undefined ? "7일 기준 수집 실패" : "7일 기준";
  const summary = `${baselineLabel} · 전체 후보 ${incidents.length}건 / 중요 후보 ${reportable.length}건` +
    `(Critical ${criticalCount}, Warning ${warningCount}) / 상세 알림 ${selected.length}건 / 제외·후순위 ${incidents.length - selected.length}건`;
  if (selected.length === 0) {
    const text = `✅ ${input.reportDate} CloudWatch 일일 리포트\n구조화된 중요 오류가 탐지되지 않음\n${summary}`;
    await dependencies.publisher.publish(text, input.reportDate);
    return { status: "sent" as const, reportDate: input.reportDate, fallbackCount: 0 };
  }
  let fallbackCount = 0;
  let sections: readonly string[];
  try {
    sections = await dependencies.reportWriter.write(selected);
    if (sections.length !== selected.length) throw new Error("리포트 개수 불일치");
  } catch (error) {
    fallbackCount = selected.length;
    sections = selected.map(fallbackReport);
    console.warn(JSON.stringify({
      event: "openai_report_fallback", reportDate: input.reportDate, fallbackCount,
      ...diagnoseReportError(error)
    }));
  }
  const fallbackNotice = fallbackCount > 0
    ? [`⚠️ AI 분석 실패 — 상위 ${fallbackCount}건을 기본 리포트로 대체`] : [];
  const text = [`📊 ${input.reportDate} CloudWatch 일일 리포트 — ${summary}`, ...fallbackNotice, ...sections]
    .join("\n\n---\n\n").slice(0, 12_000);
  await dependencies.publisher.publish(text, input.reportDate);
  return { status: "sent" as const, reportDate: input.reportDate, fallbackCount };
}
