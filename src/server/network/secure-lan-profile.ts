import { isAbsolute, win32 } from "node:path";
import { z } from "zod";
import { isRfc1918Ipv4 } from "./windows-lan-policy.ts";

const AbsoluteWindowsPathSchema = z
  .string()
  .min(3)
  .max(1024)
  .refine(
    (value) =>
      isAbsolute(value) &&
      win32.isAbsolute(value) &&
      !value.startsWith("\\\\") &&
      !value.includes("\0") &&
      !value.split(/[\\/]/u).includes(".."),
    "SECURE_LAN_CERT_PATH_INVALID",
  );

const SecureLanEnvironmentSchema = z
  .object({
    RENTPROOF_DEPLOYMENT_PROFILE: z.literal("lan_secure_demo"),
    RENTPROOF_BIND_HOST: z.string().refine(isRfc1918Ipv4),
    RENTPROOF_PORT: z.coerce.number().int().min(1024).max(65_535),
    RENTPROOF_INTERNAL_PORT: z.coerce.number().int().min(1024).max(65_535),
    RENTPROOF_PUBLIC_ORIGIN: z.url(),
    RENTPROOF_ALLOWED_HOSTS: z.string().min(1),
    RENTPROOF_ALLOWED_ORIGINS: z.string().min(1),
    RENTPROOF_ALLOW_REAL_DATA: z.literal("true"),
    RENTPROOF_AUTH_MODE: z.literal("self_hosted"),
    RENTPROOF_AUTH_TOKEN_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    RENTPROOF_DATABASE_ADAPTER: z.literal("postgres"),
    RENTPROOF_DATABASE_URL: z.string().min(1),
    RENTPROOF_DATABASE_ROLE: z.literal("app"),
    RENTPROOF_DATABASE_ENVIRONMENT: z.literal("secure_demo"),
    RENTPROOF_DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20),
    RENTPROOF_REAL_DATA_DIR: AbsoluteWindowsPathSchema,
    RENTPROOF_DATA_ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    RENTPROOF_INTERNAL_PROXY_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    RENTPROOF_LLM_MODE: z.enum(["fixture", "live"]),
    OPENAI_PROJECT_LIMITS_CONFIRMED: z.enum(["true", "false"]),
    RENTPROOF_TLS_CERT_PATH: AbsoluteWindowsPathSchema,
    RENTPROOF_TLS_KEY_PATH: AbsoluteWindowsPathSchema,
    RENTPROOF_TLS_CA_PATH: AbsoluteWindowsPathSchema,
    RENTPROOF_LAN_NO_PORT_FORWARDING: z.literal("confirmed-for-this-run"),
    RENTPROOF_LAN_NO_UPNP_EXPOSURE: z.literal("confirmed-for-this-run"),
    RENTPROOF_LAN_NO_TUNNEL: z.literal("confirmed-for-this-run"),
  })
  .passthrough();

export type SecureLanProfile = Readonly<{
  bindAddress: string;
  externalPort: number;
  internalPort: number;
  exactHost: string;
  exactOrigin: string;
  certificatePath: string;
  privateKeyPath: string;
  caCertificatePath: string;
  realDataRoot: string;
}>;

export function parseSecureLanProfile(
  environment: Readonly<Record<string, string | undefined>>,
): SecureLanProfile {
  const parsed = SecureLanEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new Error("SECURE_LAN_CONFIGURATION_INVALID");
  const value = parsed.data;
  const exactHost = `${value.RENTPROOF_BIND_HOST}:${String(value.RENTPROOF_PORT)}`;
  const exactOrigin = `https://${exactHost}`;
  if (
    value.RENTPROOF_INTERNAL_PORT === value.RENTPROOF_PORT ||
    value.RENTPROOF_PUBLIC_ORIGIN !== exactOrigin ||
    value.RENTPROOF_ALLOWED_HOSTS !== exactHost ||
    value.RENTPROOF_ALLOWED_ORIGINS !== exactOrigin ||
    (value.RENTPROOF_LLM_MODE === "live" && value.OPENAI_PROJECT_LIMITS_CONFIRMED !== "true")
  ) {
    throw new Error("SECURE_LAN_CONFIGURATION_INVALID");
  }
  return Object.freeze({
    bindAddress: value.RENTPROOF_BIND_HOST,
    externalPort: value.RENTPROOF_PORT,
    internalPort: value.RENTPROOF_INTERNAL_PORT,
    exactHost,
    exactOrigin,
    certificatePath: value.RENTPROOF_TLS_CERT_PATH,
    privateKeyPath: value.RENTPROOF_TLS_KEY_PATH,
    caCertificatePath: value.RENTPROOF_TLS_CA_PATH,
    realDataRoot: value.RENTPROOF_REAL_DATA_DIR,
  });
}
