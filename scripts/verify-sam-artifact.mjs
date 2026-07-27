import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const buildDirectory = ".aws-sam/build";
const template = await readFile(join(buildDirectory, "template.yaml"), "utf8");
const codeUri = template.match(/^\s+CodeUri:\s+([^\s]+)$/m)?.[1];
const handler = template.match(/^\s+Handler:\s+([A-Za-z0-9_/-]+)\.([A-Za-z0-9_]+)$/m);
if (!codeUri || !handler) throw new Error("SAM build template handler 누락");
const source = join(buildDirectory, codeUri, `${handler[1]}.js`);
const exportName = handler[2];
const temporaryDirectory = await mkdtemp(join(tmpdir(), "cloudwatch-report-sam-"));
const target = join(temporaryDirectory, "handler.cjs");

try {
  await copyFile(source, target);
  const module = createRequire(import.meta.url)(target);
  if (typeof module[exportName] !== "function") throw new Error("SAM handler export 누락");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
