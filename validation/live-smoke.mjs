import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const password = randomBytes(32).toString("base64url");
const env = {
  ...process.env,
  SMOKE_PASSWORD: password,
  SMOKE_SUFFIX: randomBytes(4).toString("hex"),
};
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const prepare = spawnSync(
  docker,
  [
    "compose",
    "run",
    "--rm",
    "-e",
    "SMOKE_PASSWORD",
    "migrate",
    "pnpm",
    "exec",
    "tsx",
    "scripts/prepare-smoke.ts",
  ],
  { env, stdio: "inherit" },
);
if (prepare.error) throw prepare.error;
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const smoke = spawnSync(process.execPath, ["validation/smoke.mjs"], {
  env,
  stdio: "inherit",
});
if (smoke.error) throw smoke.error;
if (smoke.status !== 0) process.exit(smoke.status ?? 1);

if (process.argv.includes("--e2e")) {
  const browser = spawnSync(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test"],
    { env, stdio: "inherit" },
  );
  if (browser.error) throw browser.error;
  if (browser.status !== 0) process.exit(browser.status ?? 1);
}
