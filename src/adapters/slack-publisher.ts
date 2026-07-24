import type { Publisher } from "../application/ports.js";

export class SlackPublisher implements Publisher {
  constructor(
    private readonly token: string,
    private readonly channel: string,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async publish(text: string, reportDate: string): Promise<string> {
    if (text.length > 12_000) throw new Error("Slack 메시지 길이 제한 초과");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          channel: this.channel,
          text,
          blocks: splitSlackSections(text).map((section) => ({ type: "section", text: { type: "mrkdwn", text: section } })),
          metadata: { event_type: "cloudwatch_daily_report", event_payload: { reportDate } }
        })
      });
      if (response.status === 429 && attempt < 2) {
        const retrySeconds = Math.min(Number(response.headers.get("retry-after") ?? 1), 30);
        await this.wait(Number.isFinite(retrySeconds) ? retrySeconds * 1_000 : 1_000);
        continue;
      }
      const body = await response.json() as { ok?: boolean; ts?: string; error?: string };
      if (!response.ok || !body.ok || !body.ts) throw new Error(`Slack 전송 실패: ${body.error ?? response.status}`);
      return body.ts;
    }
    throw new Error("Slack 재시도 한도 초과");
  }
}

function splitSlackSections(text: string): readonly string[] {
  const sections: string[] = [];
  for (let offset = 0; offset < text.length; offset += 3_000) sections.push(text.slice(offset, offset + 3_000));
  return sections;
}
