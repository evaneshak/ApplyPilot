// Backward-compatible local verification entry point. No external database is accessed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync(
  process.execPath,
  [
    "--test",
    fileURLToPath(new URL("../../test/migration.test.js", import.meta.url)),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
