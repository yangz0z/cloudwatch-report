export type Severity = "info" | "warning" | "critical";

export interface EventAggregate {
  readonly level?: "error" | "fatal" | undefined;
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
  readonly excludeFromDailyReport?: boolean | undefined;
}

export interface Incident extends EventAggregate {
  readonly id: string;
  readonly reportDate: string;
  readonly severity: Severity;
  readonly knownCause: string;
  readonly recommendedActions: readonly string[];
  readonly excludedFromDailyReport: boolean;
  readonly baselineDailyAverage: number;
  readonly increaseRatio: number;
  readonly priorityScore: number;
  readonly selectionReasons: readonly string[];
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,100}$/;
const UNSAFE_IDENTIFIER = /(?:ignore.*(?:previous|instruction)|system.*prompt|assistant|@(?:channel|here|everyone)|[0-9a-f]{8}-[0-9a-f-]{27,}|(?:^|[._-])\d{6,}(?:$|[._-])|(?:^|_)[a-z0-9.-]+\.(?:com|net|org|io|co\.kr)(?:$|_)|(?:\d{1,3}\.){3}\d{1,3})/i;
const CRITICAL_SIGNAL = /(?:^|[._:-])(fatal|panic|outofmemory|out_of_memory|corrupt|data_loss|deadlock|security|unauthorized|forbidden|payment|spool_read_failed|spool_write_failed|quarantine_failed)(?:$|[._:-])/i;
const NOTABLE_SIGNAL = /(exception|api_error|failure|failed)/i;
const SAFE_ENDPOINT = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,199}$/;

export function createIncidents(
  reportDate: string,
  aggregates: readonly EventAggregate[],
  rules: readonly DetectorRule[],
  baselineAggregates?: readonly EventAggregate[],
  baselineDays = 7
): readonly Incident[] {
  if (baselineAggregates !== undefined && (!Number.isInteger(baselineDays) || baselineDays < 1 || baselineDays > 30)) {
    throw new Error("baseline 일수 오류");
  }
  const mergedAggregates = mergeAggregates(aggregates);
  const mergedBaseline = baselineAggregates === undefined ? undefined : mergeAggregates(baselineAggregates);
  const baselineBySignature = new Map(mergedBaseline?.map((aggregate) => [signatureKey(aggregate), aggregate]));
  return Object.freeze(mergedAggregates.map((aggregate) => {
    const rule = rules.find((candidate) => candidate.errorCode === aggregate.errorCode &&
      (!candidate.service || candidate.service === aggregate.service) &&
      (!candidate.provider || candidate.provider === aggregate.provider) &&
      (!candidate.operation || candidate.operation === aggregate.operation));
    if (rule) {
      assertSafeText(rule.knownCause);
      rule.recommendedActions.forEach(assertSafeText);
    }
    const baseline = baselineBySignature.get(signatureKey(aggregate));
    const baselineDailyAverage = baseline ? round(baseline.count / baselineDays) : 0;
    const increaseRatio = mergedBaseline === undefined ? 1 : round(aggregate.count / Math.max(baselineDailyAverage, 1));
    const warningThreshold = rule?.warningThreshold ?? 20;
    const criticalThreshold = rule?.criticalThreshold ?? Number.POSITIVE_INFINITY;
    const identifiers = [aggregate.category, aggregate.operation, aggregate.errorCode].join(".");
    const hasCriticalSignal = CRITICAL_SIGNAL.test(identifiers);
    const hasNotableSignal = NOTABLE_SIGNAL.test(identifiers);
    const isCriticalSpike = aggregate.count >= 10 && increaseRatio >= 5;
    const isWarningSpike = aggregate.count >= 5 && increaseRatio >= 3;
    const severity: Severity = aggregate.level === "fatal" || aggregate.count >= criticalThreshold ||
      isCriticalSpike || hasCriticalSignal ? "critical" : aggregate.count >= warningThreshold ||
      isWarningSpike || (hasNotableSignal && aggregate.count >= 5) ? "warning" : "info";
    const selectionReasons = Object.freeze([
      ...(aggregate.level === "fatal" ? ["fatal"] : []),
      ...(hasCriticalSignal ? ["high_risk_identifier"] : []),
      ...(isCriticalSpike || isWarningSpike ? ["seven_day_spike"] : []),
      ...(aggregate.count >= warningThreshold ? ["high_frequency"] : []),
      ...(hasNotableSignal ? ["notable_identifier"] : [])
    ]);
    const priorityScore = round((aggregate.level === "fatal" ? 10_000 : 0) +
      (hasCriticalSignal ? 1_000 : 0) + (hasNotableSignal ? 200 : 0) +
      Math.min(increaseRatio, 20) * 100 + Math.log10(aggregate.count + 1) * 20 + severityRank(severity) * 10);
    return Object.freeze({
      ...aggregate,
      endpoint: normalizeEndpoint(aggregate.endpoint),
      id: stableId(reportDate, { ...aggregate, endpoint: normalizeEndpoint(aggregate.endpoint) }),
      reportDate,
      severity,
      knownCause: rule?.knownCause ?? "원인 미확정",
      recommendedActions: Object.freeze(rule?.recommendedActions ?? ["관련 로그와 최근 변경 사항 확인"]),
      excludedFromDailyReport: rule?.excludeFromDailyReport ?? false,
      baselineDailyAverage,
      increaseRatio,
      priorityScore,
      selectionReasons
    });
  }).sort((left, right) => right.priorityScore - left.priorityScore || right.count - left.count));
}

function mergeAggregates(aggregates: readonly EventAggregate[]): readonly EventAggregate[] {
  const bySignature = new Map<string, EventAggregate>();
  for (const aggregate of aggregates) {
    validateAggregate(aggregate);
    const normalized = { ...aggregate, endpoint: normalizeEndpoint(aggregate.endpoint) };
    const key = signatureKey(normalized);
    const existing = bySignature.get(key);
    if (!existing) {
      bySignature.set(key, normalized);
      continue;
    }
    const replacement: EventAggregate = {
      ...existing,
      level: existing.level === "fatal" || normalized.level === "fatal" ? "fatal" : "error",
      count: existing.count + normalized.count,
      firstSeenKst: Date.parse(existing.firstSeenKst) <= Date.parse(normalized.firstSeenKst)
        ? existing.firstSeenKst : normalized.firstSeenKst,
      lastSeenKst: Date.parse(existing.lastSeenKst) >= Date.parse(normalized.lastSeenKst)
        ? existing.lastSeenKst : normalized.lastSeenKst
    };
    bySignature.set(key, replacement);
  }
  return Object.freeze([...bySignature.values()]);
}

const signatureKey = (value: EventAggregate): string =>
  [value.service, value.category, value.provider, value.operation, value.endpoint, value.errorCode].join("|");

export function selectReportableIncidents(
  incidents: readonly Incident[], maximumItems = 3
): readonly Incident[] {
  return Object.freeze(incidents
    .filter(({ level, severity, excludedFromDailyReport }) =>
      level === "fatal" || (severity !== "info" && !excludedFromDailyReport))
    .slice(0, maximumItems));
}

function validateAggregate(value: EventAggregate): void {
  if (value.level !== undefined && !["error", "fatal"].includes(value.level)) throw new Error("집계 로그 수준 오류");
  for (const field of [value.service, value.category, value.provider, value.operation, value.errorCode]) {
    if (!SAFE_IDENTIFIER.test(field) || UNSAFE_IDENTIFIER.test(field)) throw new Error("안전하지 않은 집계 식별자");
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
const round = (value: number): number => Math.round(value * 100) / 100;
