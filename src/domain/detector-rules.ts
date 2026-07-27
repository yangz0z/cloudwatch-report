import { z } from "zod";

const safeText = (value: string): boolean => !/[<>]/.test(value) && !/@(channel|here|everyone)/i.test(value) &&
  ![...value].some((character) => character.charCodeAt(0) < 32);

export const DetectorRuleSchema = z.object({
  errorCode: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),
  service: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
  provider: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
  operation: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
  knownCause: z.string().min(1).max(300).refine(safeText),
  recommendedActions: z.array(z.string().min(1).max(300).refine(safeText)).min(1).max(10),
  warningThreshold: z.number().int().positive().optional(),
  criticalThreshold: z.number().int().positive().optional(),
  excludeFromDailyReport: z.boolean().optional()
}).strict().refine((rule) => rule.criticalThreshold === undefined ||
  (rule.warningThreshold ?? 20) < rule.criticalThreshold, "임계값 순서 오류");

export const DetectorRulesSchema = z.array(DetectorRuleSchema).max(100);
const EvidenceSchema = z.object({
  path: z.string().min(1).max(300).refine(safeText),
  symbol: z.string().min(1).max(200).refine(safeText).optional(),
  rationale: z.string().min(1).max(300).refine(safeText)
}).strict();

const DetectorRuleV2Schema = z.object({
  match: z.object({
    errorCode: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),
    service: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
    provider: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
    operation: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional()
  }).strict(),
  problem: z.string().min(1).max(300).refine(safeText),
  likelyCauses: z.array(z.string().min(1).max(300).refine(safeText)).min(1).max(5),
  impact: z.string().min(1).max(300).refine(safeText),
  recommendedActions: z.array(z.string().min(1).max(300).refine(safeText)).min(1).max(10),
  confidence: z.enum(["low", "medium", "high"]),
  sourceEvidence: z.array(EvidenceSchema).min(1).max(10),
  warningThreshold: z.number().int().positive().optional(),
  criticalThreshold: z.number().int().positive().optional(),
  excludeFromDailyReport: z.boolean().optional()
}).strict().refine((rule) => rule.criticalThreshold === undefined ||
  (rule.warningThreshold ?? 20) < rule.criticalThreshold, "임계값 순서 오류");

const DetectorCatalogV2Schema = z.object({
  schemaVersion: z.literal(2),
  source: z.object({ repository: z.string().min(1).max(100).regex(/^[A-Za-z0-9._/-]+$/),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/), generatedAt: z.string().datetime() }).strict(),
  rules: z.array(DetectorRuleV2Schema).max(100)
}).strict();

export const parseDetectorRules = (value: unknown) => {
  if (Array.isArray(value)) return assertUnambiguous(DetectorRulesSchema.parse(value));
  const catalog = DetectorCatalogV2Schema.parse(value);
  const rules = catalog.rules.map((rule) => ({
    ...rule.match,
    knownCause: rule.likelyCauses[0]!, problem: rule.problem, likelyCauses: rule.likelyCauses,
    impact: rule.impact, confidence: rule.confidence, recommendedActions: rule.recommendedActions,
    warningThreshold: rule.warningThreshold, criticalThreshold: rule.criticalThreshold,
    excludeFromDailyReport: rule.excludeFromDailyReport
  }));
  return assertUnambiguous(rules);
};

type ScopedRule = { errorCode: string; service?: string | undefined; provider?: string | undefined; operation?: string | undefined };

function assertUnambiguous<T extends ScopedRule>(rules: readonly T[]): readonly T[] {
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const left = rules[leftIndex]!;
      const right = rules[rightIndex]!;
      const sameSpecificity = specificity(left) === specificity(right);
      const overlaps = left.errorCode === right.errorCode && ["service", "provider", "operation"].every((field) => {
        const key = field as "service" | "provider" | "operation";
        return left[key] === undefined || right[key] === undefined || left[key] === right[key];
      });
      if (sameSpecificity && overlaps) throw new Error("모호하거나 중복된 Detector Rule");
    }
  }
  return Object.freeze([...rules]);
}

const specificity = (rule: { service?: string | undefined; provider?: string | undefined; operation?: string | undefined }): number =>
  Number(rule.service !== undefined) + Number(rule.provider !== undefined) + Number(rule.operation !== undefined);
