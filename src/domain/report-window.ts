const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface ReportWindow {
  readonly reportDate: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function previousKstDay(now: Date): ReportWindow {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  const currentKstMidnightAsUtc = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()
  ) - KST_OFFSET_MS;
  const endMs = currentKstMidnightAsUtc;
  const startMs = endMs - 24 * 60 * 60 * 1000;
  return Object.freeze({
    reportDate: new Date(startMs + KST_OFFSET_MS).toISOString().slice(0, 10),
    startMs,
    endMs
  });
}

export function windowForReportDate(reportDate: string): ReportWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error("reportDate 형식 오류");
  const startMs = Date.parse(`${reportDate}T00:00:00+09:00`);
  if (!Number.isFinite(startMs)) throw new Error("reportDate 값 오류");
  const normalized = new Date(startMs + KST_OFFSET_MS).toISOString().slice(0, 10);
  if (normalized !== reportDate) throw new Error("reportDate 달력 값 오류");
  return Object.freeze({ reportDate, startMs, endMs: startMs + 86_400_000 });
}
