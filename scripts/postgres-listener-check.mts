import { execFileSync } from "node:child_process";
import {
  checkPostgresListener,
  parseWindowsTcpListeners,
  PostgresListenerCheckError,
} from "../src/adapters/database/postgres/listener-check.ts";

function main(): void {
  const portText = process.argv[2] ?? "5433";
  if (!/^\d{1,5}$/u.test(portText)) {
    throw new Error("POSTGRES_LISTENER_PORT_INVALID");
  }
  const port = Number(portText);
  if (port < 1 || port > 65_535) {
    throw new Error("POSTGRES_LISTENER_PORT_INVALID");
  }
  if (process.platform !== "win32") {
    throw new Error("POSTGRES_LISTENER_CHECK_WINDOWS_ONLY");
  }

  const output = execFileSync("netstat.exe", ["-ano"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const result = checkPostgresListener(parseWindowsTcpListeners(output), port);
  process.stdout.write(
    `POSTGRES_LISTENER_LOOPBACK_ONLY port=${result.port} listeners=${result.listeners.length}\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  const reason =
    error instanceof PostgresListenerCheckError ||
    (error instanceof Error && error.message.startsWith("POSTGRES_"))
      ? error.message
      : "POSTGRES_LISTENER_CHECK_FAILED";
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}
