export type ConfirmationConsumeErrorCode =
  | "CONFIRMATION_NOT_FOUND"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_STALE"
  | "CONFIRMATION_ALREADY_USED"
  | "CONFIRMATION_ACTOR_MISMATCH";

export class PendingConfirmationConflictError extends Error {
  constructor() {
    super("A pending confirmation with the same opaque identifier already exists.");
    this.name = "PendingConfirmationConflictError";
  }
}

export class PendingConfirmationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingConfirmationIntegrityError";
  }
}
