import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = ".aws-sam/build/DailyReportFunction/handler.js";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "cloudwatch-report-sam-"));
const target = join(temporaryDirectory, "handler.cjs");

try {
  await copyFile(source, target);
  const module = createRequire(import.meta.url)(target);
  if (typeof module.handler !== "function") throw new Error("SAM handler export 누락");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
