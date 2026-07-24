import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { parseDetectorRules } from "../domain/detector-rules.js";

export async function loadDetectorRules(client: SSMClient, parameterName: string) {
  const result = await client.send(new GetParameterCommand({ Name: parameterName }));
  if (!result.Parameter?.Value) throw new Error("Parameter Store 값 누락");
  return parseDetectorRules(JSON.parse(result.Parameter.Value));
}
