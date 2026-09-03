import { CONVERSATION_LIMITS, NormalizedTurnSchema } from "@/domain/conversation";

export type NormalizeTurnResult =
  | { ok: true; value: string }
  | {
      ok: false;
      code:
        | "CONVERSATION_TURN_TOO_LARGE"
        | "CONVERSATION_TURN_INVALID_UTF8"
        | "CONVERSATION_TURN_NUL_DISALLOWED"
        | "CONVERSATION_TURN_PAYLOAD_INVALID";
    };

export function normalizeConversationTurn(bytes: Uint8Array): NormalizeTurnResult {
  if (bytes.byteLength > CONVERSATION_LIMITS.rawTurnBytes) {
    return { ok: false, code: "CONVERSATION_TURN_TOO_LARGE" };
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "CONVERSATION_TURN_INVALID_UTF8" };
  }

  if (decoded.includes("\0")) {
    return { ok: false, code: "CONVERSATION_TURN_NUL_DISALLOWED" };
  }

  const normalized = decoded.normalize("NFC");
  const parsed = NormalizedTurnSchema.safeParse(normalized);
  if (!parsed.success) {
    return { ok: false, code: "CONVERSATION_TURN_TOO_LARGE" };
  }

  return { ok: true, value: parsed.data };
}
