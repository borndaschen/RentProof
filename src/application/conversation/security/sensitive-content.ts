export const SENSITIVE_CONTENT_DETECTOR_VERSION = "conversation-sensitive-content.v1";

export type PiiKind = "email" | "phone" | "taiwan_national_id" | "full_address";

export type AuthSecretKind =
  | "password"
  | "one_time_code"
  | "api_key"
  | "authorization_token"
  | "session_token"
  | "private_key"
  | "financial_account"
  | "qr_payload"
  | "data_url";

export type SensitiveContentResult =
  | { decision: "allow"; detectorVersion: string }
  | {
      decision: "warning_required";
      code: "PII_WARNING_REQUIRED";
      detectorVersion: string;
      piiKinds: PiiKind[];
    }
  | {
      decision: "hard_block";
      code: "AUTH_SECRET_DETECTED";
      detectorVersion: string;
      secretKinds: AuthSecretKind[];
    };

type Detector<K extends string> = {
  kind: K;
  pattern: RegExp;
};

const AUTH_SECRET_DETECTORS: readonly Detector<AuthSecretKind>[] = [
  {
    kind: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/iu,
  },
  {
    kind: "data_url",
    pattern: /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*(?:;base64)?,/iu,
  },
  {
    kind: "authorization_token",
    pattern: /\bauthorization\s*:\s*(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}/iu,
  },
  {
    kind: "authorization_token",
    pattern: /\bbearer\s+[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}(?:\.[a-z0-9_-]{8,})?/iu,
  },
  {
    kind: "api_key",
    pattern: /\b(?:(?:sk|rk|pk)[_-]|(?:ghp|github_pat)_)[a-z0-9_-]{16,}\b/iu,
  },
  {
    kind: "api_key",
    pattern: /\bapi[ _-]?key\s*(?:is|=|:|：)\s*[a-z0-9._~+/-]{12,}/iu,
  },
  {
    kind: "session_token",
    pattern:
      /\b(?:session(?:_?token)?|sessionid|auth(?:_?token)?)\s*(?:=|:|：)\s*[a-z0-9._~+/-]{12,}/iu,
  },
  {
    kind: "password",
    pattern: /(?:密碼|password|passwd)\s*(?:是|為|is|=|:|：)\s*\S{6,}/iu,
  },
  {
    kind: "one_time_code",
    pattern:
      /(?:otp|一次性(?:密碼|驗證碼)|驗證碼|重設碼|reset code)\s*(?:是|為|is|=|:|：)?\s*\d{4,10}\b/iu,
  },
  {
    kind: "financial_account",
    pattern:
      /(?:銀行帳號|匯款帳號|收款帳號|信用卡號|金融卡號|bank account|card number)\s*(?:是|為|is|=|:|：)?\s*(?:\d[ -]?){8,20}\b/iu,
  },
  {
    kind: "qr_payload",
    pattern: /(?:qr(?:\s*code)?|qr碼|二維碼)\s*(?:是|為|is|=|:|：)\s*\S{8,}/iu,
  },
];

const PII_DETECTORS: readonly Detector<PiiKind>[] = [
  {
    kind: "email",
    pattern:
      /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/iu,
  },
  {
    kind: "phone",
    pattern: /(?:^|[^0-9])(?:\+?886[-\s]?)?0?9\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/u,
  },
  {
    kind: "taiwan_national_id",
    pattern: /\b[A-Z][12]\d{8}\b/iu,
  },
  {
    kind: "full_address",
    pattern:
      /(?:(?:台|臺)(?:北|中|南|東)市|(?:新北|桃園|高雄|基隆|新竹|嘉義)市|(?:彰化|南投|雲林|屏東|宜蘭|花蓮|臺東|台東|澎湖|金門|連江|苗栗|新竹|嘉義)縣).{0,24}(?:區|鄉|鎮|市).{0,24}(?:路|街|大道|巷).{0,20}\d+(?:號)?/u,
  },
];

export function detectSensitiveConversationContent(input: string): SensitiveContentResult {
  const secretKinds = collectKinds(input, AUTH_SECRET_DETECTORS);
  if (secretKinds.length > 0) {
    return {
      decision: "hard_block",
      code: "AUTH_SECRET_DETECTED",
      detectorVersion: SENSITIVE_CONTENT_DETECTOR_VERSION,
      secretKinds,
    };
  }

  const piiKinds = collectKinds(input, PII_DETECTORS);
  if (piiKinds.length > 0) {
    return {
      decision: "warning_required",
      code: "PII_WARNING_REQUIRED",
      detectorVersion: SENSITIVE_CONTENT_DETECTOR_VERSION,
      piiKinds,
    };
  }

  return { decision: "allow", detectorVersion: SENSITIVE_CONTENT_DETECTOR_VERSION };
}

function collectKinds<K extends string>(input: string, detectors: readonly Detector<K>[]): K[] {
  const kinds = new Set<K>();
  for (const detector of detectors) {
    if (detector.pattern.test(input)) {
      kinds.add(detector.kind);
    }
  }
  return [...kinds];
}
