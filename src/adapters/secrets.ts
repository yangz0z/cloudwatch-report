import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

const CredentialsSchema = z.object({
  openaiApiKey: z.string().min(20),
  slackBotToken: z.string().min(20)
}).strict();
export type AppCredentials = z.infer<typeof CredentialsSchema>;

export async function loadSecrets(client: SecretsManagerClient, secretId: string): Promise<AppCredentials> {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) throw new Error("Secrets Manager 문자열 값 누락");
  return CredentialsSchema.parse(JSON.parse(result.SecretString));
}
