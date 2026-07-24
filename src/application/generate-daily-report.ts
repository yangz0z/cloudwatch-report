import { createIncidents } from "../domain/incident.js";
import { windowForReportDate } from "../domain/report-window.js";
import { fallbackReport } from "../report/fallback.js";
import type { Dependencies } from "./ports.js";

export async function generateDailyReport(input: { readonly reportDate: string }, dependencies: Dependencies) {
  if (!(await dependencies.runStore.acquire(input.reportDate))) {
    return { status: "skipped" as const, reportDate: input.reportDate };
  }
  try {
    const aggregates = await dependencies.logsReader.readEvents(windowForReportDate(input.reportDate));
    const incidents = createIncidents(input.reportDate, aggregates, dependencies.detectorRules);
    if (incidents.length === 0) {
      const text = `✅ ${input.reportDate} CloudWatch 일일 리포트\n구조화된 중요 오류가 탐지되지 않음`;
      const ts = await dependencies.publisher.publish(text, input.reportDate);
      await dependencies.runStore.markSent(input.reportDate, ts);
      return { status: "sent" as const, reportDate: input.reportDate, fallbackCount: 0 };
    }
    let fallbackCount = 0;
    const sections = await Promise.all(incidents.map(async (incident) => {
      try { return await dependencies.reportWriter.write(incident); }
      catch { fallbackCount += 1; return fallbackReport(incident); }
    }));
    const text = sections.join("\n\n---\n\n").slice(0, 12_000);
    const ts = await dependencies.publisher.publish(text, input.reportDate);
    await dependencies.runStore.markSent(input.reportDate, ts);
    return { status: "sent" as const, reportDate: input.reportDate, fallbackCount };
  } catch (error) {
    await dependencies.runStore.markFailed(input.reportDate);
    throw error;
  }
}
