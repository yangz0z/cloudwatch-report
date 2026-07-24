import { z } from "zod";

const ConfigSchema = z.object({
  AWS_REGION: z.string().min(1).default("ap-northeast-2"),
  LOG_GROUP_NAMES: z.string().min(1),
  RUN_TABLE_NAME: z.string().min(1),
  SECRET_ID: z.string().min(1),
  SLACK_CHANNEL_ID: z.string().min(1),
  DETECTOR_RULES_PARAMETER_NAME: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini")
});

export type Config = z.infer<typeof ConfigSchema>;
export const loadConfig = (environment: NodeJS.ProcessEnv): Config => ConfigSchema.parse(environment);
