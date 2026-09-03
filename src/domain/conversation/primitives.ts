import { z } from "zod";
import { CONVERSATION_LIMITS } from "./constants";

const opaqueIdPattern = /^[A-Za-z0-9_-]{20,128}$/u;

export const OpaqueIdSchema = z.string().regex(opaqueIdPattern);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const IsoInstantSchema = z.iso.datetime({ offset: true });
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export function unicodeCodePointLength(value: string): number {
  return [...value.normalize("NFC")].length;
}

export const NormalizedTurnSchema = z
  .string()
  .refine((value) => !value.includes("\0"), "NUL_NOT_ALLOWED")
  .refine((value) => value === value.normalize("NFC"), "NOT_NFC")
  .refine(
    (value) => unicodeCodePointLength(value) <= CONVERSATION_LIMITS.normalizedTurnCodePoints,
    "TOO_MANY_CODE_POINTS",
  );
