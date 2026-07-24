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
  criticalThreshold: z.number().int().positive().optional()
}).strict().refine((rule) => (rule.warningThreshold ?? 5) < (rule.criticalThreshold ?? 20), "임계값 순서 오류");

export const DetectorRulesSchema = z.array(DetectorRuleSchema).max(100);
export const parseDetectorRules = (value: unknown) => DetectorRulesSchema.parse(value);
