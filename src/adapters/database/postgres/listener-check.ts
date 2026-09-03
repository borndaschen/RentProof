export type TcpListener = {
  address: string;
  port: number;
  processId: number;
};

export type PostgresListenerCheck = {
  port: number;
  listeners: readonly TcpListener[];
};

export class PostgresListenerCheckError extends Error {
  override readonly name = "PostgresListenerCheckError";
  readonly code:
    | "POSTGRES_LISTENER_NOT_FOUND"
    | "POSTGRES_LISTENER_OUTPUT_INVALID"
    | "POSTGRES_LISTENER_EXPOSED";

  constructor(code: PostgresListenerCheckError["code"]) {
    super(code);
    this.code = code;
  }
}

const LISTEN_LINE = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/u;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "[::1]"]);

export function parseWindowsTcpListeners(output: string): readonly TcpListener[] {
  const listeners: TcpListener[] = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line.includes("LISTENING")) continue;
    const match = LISTEN_LINE.exec(line);
    if (!match) {
      throw new PostgresListenerCheckError("POSTGRES_LISTENER_OUTPUT_INVALID");
    }
    const [, address, portText, processIdText] = match;
    if (address === undefined || portText === undefined || processIdText === undefined) {
      throw new PostgresListenerCheckError("POSTGRES_LISTENER_OUTPUT_INVALID");
    }
    listeners.push({
      address,
      port: Number(portText),
      processId: Number(processIdText),
    });
  }
  return listeners;
}

export function checkPostgresListener(
  listeners: readonly TcpListener[],
  port: number,
): PostgresListenerCheck {
  const matching = listeners.filter((listener) => listener.port === port);
  if (matching.length === 0) {
    throw new PostgresListenerCheckError("POSTGRES_LISTENER_NOT_FOUND");
  }
  if (matching.some((listener) => !LOOPBACK_ADDRESSES.has(listener.address))) {
    throw new PostgresListenerCheckError("POSTGRES_LISTENER_EXPOSED");
  }
  return { port, listeners: matching };
}
