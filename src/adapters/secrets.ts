import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

const DetectorRuleSchema = z.object({
  errorCode: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),
  service: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
  provider: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
  operation: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional(),
  knownCause: z.string().min(1).max(300).refine(isSafeRuleText),
  recommendedActions: z.array(z.string().min(1).max(300).refine(isSafeRuleText)).min(1).max(10),
  warningThreshold: z.number().int().positive().optional(),
  criticalThreshold: z.number().int().positive().optional()
}).refine((rule) => (rule.warningThreshold ?? 5) < (rule.criticalThreshold ?? 20), "임계값 순서 오류");

function isSafeRuleText(value: string): boolean {
  return !/[<>]/.test(value) && !/@(channel|here|everyone)/i.test(value) &&
    ![...value].some((character) => character.charCodeAt(0) < 32);
}

const SecretSchema = z.object({
  openaiApiKey: z.string().min(20),
  slackBotToken: z.string().min(20),
  slackChannelId: z.string().min(1),
  detectorRules: z.array(DetectorRuleSchema).default([])
});
export type AppSecrets = z.infer<typeof SecretSchema>;

export async function loadSecrets(client: SecretsManagerClient, secretId: string): Promise<AppSecrets> {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) throw new Error("Secrets Manager 문자열 값 누락");
  return SecretSchema.parse(JSON.parse(result.SecretString));
}
