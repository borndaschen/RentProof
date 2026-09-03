export type WindowsDemoPathErrorCode =
  | "DEMO_DIR_MISSING"
  | "DEMO_DIR_UNSAFE"
  | "DEMO_CASE_VERSION_INVALID"
  | "DEMO_CASE_DIR_MISSING"
  | "DEMO_CASE_DIR_UNSAFE";

export class WindowsDemoPathError extends Error {
  override readonly name = "WindowsDemoPathError";
  readonly code: WindowsDemoPathErrorCode;

  constructor(code: WindowsDemoPathErrorCode) {
    super(code);
    this.code = code;
  }
}
