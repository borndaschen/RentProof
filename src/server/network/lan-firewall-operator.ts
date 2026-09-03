import { z } from "zod";
import { win32 } from "node:path";

export const LanFirewallOperatorActionSchema = z.enum([
  "Verify",
  "InstallDisabled",
  "Enable",
  "Disable",
]);
export type LanFirewallOperatorAction = z.infer<typeof LanFirewallOperatorActionSchema>;

export const LanFirewallOperationResultSchema = z
  .object({
    schema: z.literal("rentproof.lan-firewall-operation.v1"),
    status: z.enum(["PASS", "BLOCKED"]),
    code: z.string().regex(/^LAN_[A-Z0-9_]+$/u),
    action: LanFirewallOperatorActionSchema,
    enabled: z.boolean().optional(),
  })
  .strict();

export type LanFirewallOperationResult = z.infer<typeof LanFirewallOperationResultSchema>;
export type LanFirewallOperatorStage =
  "CONFIG" | "RUNTIME_VOLUME" | "RUNTIME_PREPARE" | "UAC_BROKER" | "RESULT_PARSE";

const Rfc1918Schema = z.string().refine(isRfc1918Ipv4);
const clerkPublishableVariable = ["CLERK", "PUBLISHABLE", "KEY"].join("_");
const clerkSecretVariable = ["CLERK", "SECRET", "KEY"].join("_");

export function parseLanFirewallOperatorConfig(
  environment: Readonly<Record<string, string | undefined>>,
  nodeExecutable: string,
): Readonly<{
  bindAddress: string;
  port: number;
  nodeExecutable: string;
}> {
  const schema = z
    .object({
      deployment: z.literal("lan_secure_demo"),
      bindAddress: Rfc1918Schema,
      port: z.coerce.number().int().min(1024).max(65535),
      publicOrigin: z.url(),
      allowedHosts: z.string().min(1),
      allowedOrigins: z.string().min(1),
      allowRealData: z.literal("true"),
      authMode: z.literal("self_hosted"),
      authToken: z.string().regex(/^[A-Za-z0-9_-]{43,}$/u),
      clerkPublishable: z.string().max(0).optional(),
      clerkSecret: z.string().max(0).optional(),
      clerkOrigin: z.string().max(0).optional(),
      nodeExecutable: z.string().regex(/^[A-Za-z]:\\[^"\0]+\\node\.exe$/iu),
    })
    .strict();
  const parsed = schema.safeParse({
    deployment: environment["RENTPROOF_DEPLOYMENT_PROFILE"],
    bindAddress: environment["RENTPROOF_BIND_HOST"],
    port: environment["RENTPROOF_PORT"],
    publicOrigin: environment["RENTPROOF_PUBLIC_ORIGIN"],
    allowedHosts: environment["RENTPROOF_ALLOWED_HOSTS"],
    allowedOrigins: environment["RENTPROOF_ALLOWED_ORIGINS"],
    allowRealData: environment["RENTPROOF_ALLOW_REAL_DATA"],
    authMode: environment["RENTPROOF_AUTH_MODE"],
    authToken: environment["RENTPROOF_AUTH_TOKEN_KEY"],
    clerkPublishable: environment[clerkPublishableVariable] || undefined,
    clerkSecret: environment[clerkSecretVariable] || undefined,
    clerkOrigin: environment["RENTPROOF_CLERK_FRONTEND_ORIGIN"] || undefined,
    nodeExecutable,
  });
  if (!parsed.success) throw new Error("LAN_FIREWALL_OPERATOR_CONFIG_INVALID");
  const expectedOrigin = `https://${parsed.data.bindAddress}:${String(parsed.data.port)}`;
  const allowedHosts = csv(parsed.data.allowedHosts);
  const allowedOrigins = csv(parsed.data.allowedOrigins);
  if (
    parsed.data.publicOrigin !== expectedOrigin ||
    allowedHosts.length !== 1 ||
    allowedOrigins.length !== 1 ||
    allowedHosts[0] !== `${parsed.data.bindAddress}:${String(parsed.data.port)}` ||
    allowedOrigins[0] !== expectedOrigin ||
    allowedHosts.some(isWildcard) ||
    allowedOrigins.some(isWildcard)
  )
    throw new Error("LAN_FIREWALL_OPERATOR_CONFIG_INVALID");
  return Object.freeze({
    bindAddress: parsed.data.bindAddress,
    port: parsed.data.port,
    nodeExecutable: parsed.data.nodeExecutable,
  });
}

export function parseLanFirewallOperationResult(
  raw: string,
  expectedAction: LanFirewallOperatorAction,
): LanFirewallOperationResult {
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error("LAN_FIREWALL_RESULT_INVALID");
  let unknown: unknown;
  try {
    unknown = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("LAN_FIREWALL_RESULT_INVALID");
  }
  const parsed = LanFirewallOperationResultSchema.safeParse(unknown);
  if (!parsed.success || parsed.data.action !== expectedAction) {
    throw new Error("LAN_FIREWALL_RESULT_INVALID");
  }
  if (parsed.data.status === "PASS") {
    const expectedEnabled = expectedAction === "Enable";
    if (parsed.data.enabled !== expectedEnabled && expectedAction !== "Verify") {
      throw new Error("LAN_FIREWALL_RESULT_INVALID");
    }
    if (expectedAction === "Verify" && parsed.data.enabled === undefined) {
      throw new Error("LAN_FIREWALL_RESULT_INVALID");
    }
  }
  return parsed.data;
}

export function mapLanFirewallOperatorError(
  error: unknown,
  stage: LanFirewallOperatorStage,
): string {
  if (
    error instanceof Error &&
    /^(?:LAN_|WINDOWS_|RUNTIME_|PATH_|DEMO_)[A-Z0-9_]+$/u.test(error.message)
  )
    return error.message;
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const code = error.code.toUpperCase();
    if (/^[A-Z][A-Z0-9_]+$/u.test(code)) return `LAN_FIREWALL_${stage}_${code}`;
  }
  return `LAN_FIREWALL_${stage}_FAILED`;
}

export function isCodexVirtualizedDefaultRuntimePath(
  requestedRuntimeRoot: string,
  canonicalRuntimeRoot: string,
): boolean {
  if (
    !win32.isAbsolute(requestedRuntimeRoot) ||
    !win32.isAbsolute(canonicalRuntimeRoot) ||
    requestedRuntimeRoot.startsWith("\\\\") ||
    canonicalRuntimeRoot.startsWith("\\\\")
  )
    return false;
  const requested = win32.normalize(requestedRuntimeRoot);
  if (
    win32.basename(requested).toLowerCase() !== "runtime" ||
    win32.basename(win32.dirname(requested)).toLowerCase() !== "rentproof"
  )
    return false;
  const localAppData = win32.dirname(win32.dirname(requested));
  const relative = win32.relative(localAppData, win32.normalize(canonicalRuntimeRoot));
  const segments = relative.split(win32.sep);
  return (
    segments.length === 6 &&
    segments[0]?.toLowerCase() === "packages" &&
    /^openai\.codex_/iu.test(segments[1] ?? "") &&
    segments[2]?.toLowerCase() === "localcache" &&
    segments[3]?.toLowerCase() === "local" &&
    segments[4]?.toLowerCase() === "rentproof" &&
    segments[5]?.toLowerCase() === "runtime"
  );
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isWildcard(value: string): boolean {
  return value === "*" || value === "null";
}

function isRfc1918Ipv4(value: string): boolean {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u.test(value)) return false;
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] !== undefined && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
