import { defineConfig } from "vitest/config";
import { readFile } from "node:fs/promises";

export default defineConfig({
  plugins: [{
    name: "markdown-text",
    async load(id) {
      if (!id.endsWith(".md")) return null;
      return `export default ${JSON.stringify(await readFile(id, "utf8"))}`;
    }
  }],
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/handler.ts", "src/application/ports.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 }
    }
  }
});
