import { describe, expect, it } from "vitest";
import {
  checkPostgresListener,
  parseWindowsTcpListeners,
  PostgresListenerCheckError,
} from "./listener-check";

describe("PostgreSQL Windows listener check", () => {
  it("accepts IPv4 and IPv6 loopback listeners", () => {
    const listeners = parseWindowsTcpListeners(
      "  TCP    127.0.0.1:5433  0.0.0.0:0  LISTENING  7756\r\n" +
        "  TCP    [::1]:5433     [::]:0     LISTENING  7756\r\n",
    );
    expect(checkPostgresListener(listeners, 5433)).toEqual({ port: 5433, listeners });
  });

  it.each(["0.0.0.0", "[::]", "192.168.1.20"])("rejects exposed address %s", (address) => {
    const listeners = parseWindowsTcpListeners(
      `  TCP    ${address}:5432  0.0.0.0:0  LISTENING  7700\r\n`,
    );
    expect(() => checkPostgresListener(listeners, 5432)).toThrowError(
      new PostgresListenerCheckError("POSTGRES_LISTENER_EXPOSED"),
    );
  });

  it("fails when the requested port is not listening", () => {
    expect(() => checkPostgresListener([], 5433)).toThrowError(
      new PostgresListenerCheckError("POSTGRES_LISTENER_NOT_FOUND"),
    );
  });

  it("fails closed on an unrecognized listening line", () => {
    expect(() => parseWindowsTcpListeners("TCP malformed LISTENING line")).toThrowError(
      new PostgresListenerCheckError("POSTGRES_LISTENER_OUTPUT_INVALID"),
    );
  });
});
