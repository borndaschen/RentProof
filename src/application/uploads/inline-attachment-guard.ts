import type { UploadFailure } from "@/domain/uploads";

const DATA_URL = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*(?:;base64)?,/iu;
const LABELED_BASE64 = /(?:base64|附件|attachment)\s*(?:=|:|：)\s*[a-z0-9+/]{40,}={0,2}/iu;

export function guardInlineAttachmentText(text: string): { ok: true } | UploadFailure {
  return DATA_URL.test(text) || LABELED_BASE64.test(text)
    ? { ok: false, code: "UPLOAD_INLINE_ATTACHMENT_DISALLOWED" }
    : { ok: true };
}
