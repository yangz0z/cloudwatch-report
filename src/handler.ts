import type { EventBridgeEvent } from "aws-lambda";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import OpenAI from "openai";
import { z } from "zod";
import { generateDailyReport } from "./application/generate-daily-report.js";
import { CloudWatchLogsReader } from "./adapters/cloudwatch-logs-reader.js";
import { DynamoDbRunStore } from "./adapters/dynamodb-run-store.js";
import { OpenAiReportWriter } from "./adapters/openai-report-writer.js";
import { loadSecrets } from "./adapters/secrets.js";
import { SlackPublisher } from "./adapters/slack-publisher.js";
import { loadConfig } from "./config.js";
import { previousKstDay } from "./domain/report-window.js";

const DetailSchema = z.object({ reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).default({});

export async function handler(event: EventBridgeEvent<string, unknown>) {
  const config = loadConfig(process.env);
  const detail = DetailSchema.parse(event.detail ?? {});
  const reportDate = detail.reportDate ?? previousKstDay(new Date()).reportDate;
  const secrets = await loadSecrets(new SecretsManagerClient({ region: config.AWS_REGION }), config.SECRET_ID);
  const result = await generateDailyReport({ reportDate }, {
    logsReader: new CloudWatchLogsReader(
      new CloudWatchLogsClient({ region: config.AWS_REGION }), config.LOG_GROUP_NAMES.split(",").map((value) => value.trim())
    ),
    runStore: new DynamoDbRunStore(
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.AWS_REGION })), config.RUN_TABLE_NAME
    ),
    reportWriter: new OpenAiReportWriter(new OpenAI({ apiKey: secrets.openaiApiKey }), config.OPENAI_MODEL),
    publisher: new SlackPublisher(secrets.slackBotToken, secrets.slackChannelId),
    detectorRules: secrets.detectorRules
  });
  console.info(JSON.stringify({ event: "daily_report_completed", reportDate, status: result.status }));
  return result;
}
