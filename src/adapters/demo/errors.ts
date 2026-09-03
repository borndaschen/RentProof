export type DemoManifestVerificationErrorCode =
  | "DEMO_MANIFEST_TOO_LARGE"
  | "DEMO_MANIFEST_SEAL_INVALID"
  | "DEMO_MANIFEST_SEAL_MISMATCH"
  | "DEMO_MANIFEST_INVALID_UTF8"
  | "DEMO_MANIFEST_INVALID_JSON"
  | "DEMO_MANIFEST_SCHEMA_INVALID"
  | "DEMO_MANIFEST_ROOT_INVALID"
  | "DEMO_MANIFEST_FILE_MISSING"
  | "DEMO_MANIFEST_FILE_EXTRA"
  | "DEMO_MANIFEST_FILE_UNSAFE"
  | "DEMO_MANIFEST_FILE_SIZE_MISMATCH"
  | "DEMO_MANIFEST_FILE_HASH_MISMATCH";

export class DemoManifestVerificationError extends Error {
  readonly code: DemoManifestVerificationErrorCode;

  constructor(code: DemoManifestVerificationErrorCode) {
    super(code);
    this.name = "DemoManifestVerificationError";
    this.code = code;
  }
}
