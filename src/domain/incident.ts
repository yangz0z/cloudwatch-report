export type Severity = "info" | "warning" | "critical";

export interface EventAggregate {
  readonly service: string;
  readonly category: string;
  readonly provider: string;
  readonly operation: string;
  readonly endpoint: string;
  readonly errorCode: string;
  readonly count: number;
  readonly firstSeenKst: string;
  readonly lastSeenKst: string;
}

export interface DetectorRule {
  readonly errorCode: string;
  readonly service?: string | undefined;
  readonly provider?: string | undefined;
  readonly operation?: string | undefined;
  readonly knownCause: string;
  readonly recommendedActions: readonly string[];
  readonly warningThreshold?: number | undefined;
  readonly criticalThreshold?: number | undefined;
}

export interface Incident extends EventAggregate {
  readonly id: string;
  readonly reportDate: string;
  readonly severity: Severity;
  readonly knownCause: string;
  readonly recommendedActions: readonly string[];
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,100}$/;
const SAFE_ENDPOINT = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,199}$/;

export function createIncidents(
  reportDate: string,
  aggregates: readonly EventAggregate[],
  rules: readonly DetectorRule[]
): readonly Incident[] {
  return Object.freeze(aggregates.map((aggregate) => {
    validateAggregate(aggregate);
    const rule = rules.find((candidate) => candidate.errorCode === aggregate.errorCode &&
      (!candidate.service || candidate.service === aggregate.service) &&
      (!candidate.provider || candidate.provider === aggregate.provider) &&
      (!candidate.operation || candidate.operation === aggregate.operation));
    if (rule) {
      assertSafeText(rule.knownCause);
      rule.recommendedActions.forEach(assertSafeText);
    }
    const warningThreshold = rule?.warningThreshold ?? 5;
    const criticalThreshold = rule?.criticalThreshold ?? 20;
    const severity: Severity = aggregate.count >= criticalThreshold
      ? "critical" : aggregate.count >= warningThreshold ? "warning" : "info";
    return Object.freeze({
      ...aggregate,
      endpoint: normalizeEndpoint(aggregate.endpoint),
      id: stableId(reportDate, { ...aggregate, endpoint: normalizeEndpoint(aggregate.endpoint) }),
      reportDate,
      severity,
      knownCause: rule?.knownCause ?? "원인 미확정",
      recommendedActions: Object.freeze(rule?.recommendedActions ?? ["관련 로그와 최근 변경 사항 확인"])
    });
  }).sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.count - left.count));
}

function validateAggregate(value: EventAggregate): void {
  for (const field of [value.service, value.category, value.provider, value.operation, value.errorCode]) {
    if (!SAFE_IDENTIFIER.test(field)) throw new Error("안전하지 않은 집계 식별자");
  }
  if (!SAFE_ENDPOINT.test(value.endpoint) || value.endpoint.includes("%")) throw new Error("안전하지 않은 endpoint");
  if (!Number.isInteger(value.count) || value.count < 1) throw new Error("집계 건수 오류");
  if (!Number.isFinite(Date.parse(value.firstSeenKst)) || !Number.isFinite(Date.parse(value.lastSeenKst))) {
    throw new Error("집계 시각 오류");
  }
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.split("/").map((segment) => {
    if (/^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || segment.length > 24) return ":id";
    return segment;
  }).join("/");
}

function assertSafeText(value: string): void {
  const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) < 32);
  if (value.length > 300 || /[<>]/.test(value) || hasControlCharacter || /@(channel|here|everyone)/i.test(value)) {
    throw new Error("안전하지 않은 Detector Rule 문구");
  }
}

function stableId(reportDate: string, value: EventAggregate): string {
  const input = [reportDate, value.service, value.provider, value.operation, value.endpoint, value.errorCode].join("|");
  let hash = 2166136261;
  for (const character of input) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `incident-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const severityRank = (severity: Severity): number => ({ info: 1, warning: 2, critical: 3 })[severity];
