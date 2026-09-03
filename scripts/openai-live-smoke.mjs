const safeResult = (status, reasonCode) => ({ status, reasonCode });
const args = new Set(process.argv.slice(2));

if (!args.has("--live")) {
  process.stdout.write(`${JSON.stringify(safeResult("skipped", "LIVE_SMOKE_OPT_IN_REQUIRED"))}\n`);
  process.exit(0);
}

if (process.env.CI) {
  process.stdout.write(`${JSON.stringify(safeResult("skipped", "LIVE_SMOKE_DISABLED_IN_CI"))}\n`);
  process.exit(0);
}

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (process.env.RENTPROOF_LLM_MODE !== "live" || process.env.RENTPROOF_LIVE_SMOKE !== "1") {
  process.stdout.write(`${JSON.stringify(safeResult("skipped", "LIVE_SMOKE_OPT_IN_REQUIRED"))}\n`);
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  process.stdout.write(`${JSON.stringify(safeResult("failed", "LIVE_SMOKE_AUTH_FAILED"))}\n`);
  process.exitCode = 1;
} else {
  const { createOpenAILiveSmokeRunner } = await import(
    new URL("../src/adapters/openai/live-smoke.ts", import.meta.url)
  );
  const results = await createOpenAILiveSmokeRunner(apiKey).run();
  process.stdout.write(`${JSON.stringify(results)}\n`);
  if (results.some((result) => result.reasonCode !== "LIVE_SMOKE_OK")) process.exitCode = 1;
}
