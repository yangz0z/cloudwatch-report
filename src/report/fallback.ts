import type { Incident } from "../domain/incident.js";

const severityIcon = { critical: "🚨 Critical", warning: "⚠️ Warning", info: "ℹ️ Info" } as const;

export function fallbackReport(incident: Incident): string {
  const start = incident.firstSeenKst.slice(11, 16);
  const end = incident.lastSeenKst.slice(11, 16);
  return `${severityIcon[incident.severity]} — ${incident.service} ${incident.operation} 오류\n\n` +
    `전날 동일 오류가 ${incident.count}건 발생함\n\n` +
    `• 발생 시간: ${start}~${end}\n` +
    `• 7일 일평균: ${incident.baselineDailyAverage}건 / 전일 증가: ${incident.increaseRatio}배\n` +
    `• 분류: ${incident.category}\n• 요청 경로: ${incident.endpoint}\n` +
    `• 외부 서비스: ${incident.provider}\n• 오류 코드: ${incident.errorCode}\n` +
    `• 오류 원인: ${incident.knownCause}\n` +
    `• 권장 조치: ${incident.recommendedActions.join(", ")}\n\n` +
    `근거: 동일한 구조화 오류 ${incident.count}건`;
}
