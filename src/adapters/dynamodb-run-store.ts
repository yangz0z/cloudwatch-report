import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RunStore } from "../application/ports.js";

export class DynamoDbRunStore implements RunStore {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async acquire(reportDate: string): Promise<boolean> {
    const nowEpoch = Math.floor(Date.now() / 1000);
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { reportDate, status: "PROCESSING", startedAt: new Date().toISOString(), leaseExpiresAt: nowEpoch + 300 },
        ConditionExpression: "attribute_not_exists(reportDate) OR #status = :failed OR (#status = :processing AND leaseExpiresAt < :now)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":failed": "FAILED", ":processing": "PROCESSING", ":now": nowEpoch }
      }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException || (error as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async markSent(reportDate: string, slackMessageTs: string): Promise<void> {
    await this.client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { reportDate },
      UpdateExpression: "SET #status = :sent, slackMessageTs = :ts, sentAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":sent": "SENT", ":ts": slackMessageTs, ":now": new Date().toISOString() }
    }));
  }

  async markFailed(reportDate: string): Promise<void> {
    await this.client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { reportDate },
      UpdateExpression: "SET #status = :failed, failedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":failed": "FAILED", ":now": new Date().toISOString() }
    }));
  }
}
