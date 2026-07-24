import { previousKstDay } from "./domain/report-window.js";
import { parseLocalArgs, runLocal } from "./local/run-local.js";

await runLocal(parseLocalArgs(process.argv.slice(2), previousKstDay(new Date()).reportDate));
