import type { ColumnType, Generated } from "kysely";

export type TimestampColumn = ColumnType<Date, Date | string, Date | string>;
export type GeneratedTimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
export type JsonColumn = ColumnType<unknown, unknown, unknown>;

export interface InternalUsersTable {
  id: string;
  /** Deprecated schema-compatibility column from frozen migration 001; active auth never reads it. */
  clerk_user_id: string | null;
  email_verified: boolean;
  status: "active" | "disabled" | "deletion_pending";
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
}

export interface AuthCredentialsTable {
  user_id: string;
  email_normalized: string;
  password_hash: string;
  password_updated_at: TimestampColumn;
  email_verified_at: TimestampColumn | null;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
}

export interface AuthSessionsTable {
  id: string;
  user_id: string;
  token_digest: string;
  created_at: TimestampColumn;
  last_used_at: TimestampColumn;
  idle_expires_at: TimestampColumn;
  reverified_until: TimestampColumn | null;
  revoked_at: TimestampColumn | null;
  version: Generated<number>;
}

export interface AuthPasswordResetChallengesTable {
  id: string;
  user_id: string;
  token_digest: string;
  created_at: TimestampColumn;
  expires_at: TimestampColumn;
  attempt_count: Generated<number>;
  consumed_at: TimestampColumn | null;
}

export interface AuthEmailVerificationChallengesTable {
  id: string;
  user_id: string;
  token_digest: string;
  created_at: TimestampColumn;
  expires_at: TimestampColumn;
  attempt_count: Generated<number>;
  consumed_at: TimestampColumn | null;
}

export interface GuestIdentitiesTable {
  id: string;
  created_at: GeneratedTimestampColumn;
  expires_at: TimestampColumn;
  purge_state: "active" | "pending" | "purged";
}

export interface RentalCasesTable {
  id: string;
  owner_type: "user" | "guest";
  owner_subject_id: string;
  display_name: string;
  status: "draft" | "analyzing" | "needs_attention" | "ready" | "deletion_pending";
  revision: number;
  active_snapshot_id: string | null;
  state: JsonColumn;
  source_mode: "live" | "fixture";
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
  deleted_at: TimestampColumn | null;
}

export interface PolicyDocumentsTable {
  id: string;
  policy_type: "terms" | "privacy_notice" | "cloud_processing_notice" | "cookie_policy";
  version: string;
  locale: "zh-TW";
  content_hash: string;
  canonical_url: string;
  status: "draft" | "published" | "retired";
  published_at: TimestampColumn | null;
  effective_at: TimestampColumn | null;
}

export interface PolicyEventsTable {
  id: string;
  actor_type: "user" | "guest";
  actor_subject_id: string;
  policy_document_id: string;
  event_type: "accepted" | "acknowledged" | "consented" | "declined" | "withdrawn";
  occurred_at: TimestampColumn;
  source_route: string;
  case_id: string | null;
  analysis_run_id: string | null;
  processor_list_version: string | null;
  audit_ref: string;
}

export interface ConsentPreferencesTable {
  actor_type: "user" | "guest";
  actor_subject_id: string;
  purpose_key: "functional" | "analytics" | "marketing";
  decision: "granted" | "declined" | "withdrawn";
  cookie_policy_version: string;
  inventory_version: string;
  occurred_at: TimestampColumn;
}

export interface DeletionRequestsTable {
  id: string;
  target_type: "case" | "account";
  target_id: string;
  requested_by_type: "user" | "guest";
  requested_by_subject_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  requested_at: TimestampColumn;
  purge_deadline: TimestampColumn;
  attempt_count: Generated<number>;
  completed_at: TimestampColumn | null;
  correlation_id: string;
  updated_at: GeneratedTimestampColumn;
}

export interface SecurityAuditEventsTable {
  id: string;
  event_type: string;
  occurred_at: TimestampColumn;
  outcome: "success" | "failure";
  reason_code: string;
  correlation_id: string;
  actor_ref: string | null;
  target_ref: string | null;
  provider_ref: string | null;
}

export interface CaseArtifactsTable {
  id: string;
  case_id: string;
  owner_type: "user" | "guest";
  owner_subject_id: string;
  artifact_kind: "listing_image" | "viewing_image" | "contract_pdf" | "follow_up_image";
  state: "quarantined" | "available" | "deletion_pending" | "purged";
  mime: "image/jpeg" | "image/png" | "application/pdf";
  original_sha256: string;
  derivative_sha256: string | null;
  original_bytes: number;
  derivative_bytes: number | null;
  original_relative_path: string;
  derivative_relative_path: string | null;
  extracted_text_relative_path: string | null;
  created_at: GeneratedTimestampColumn;
  updated_at: GeneratedTimestampColumn;
  deleted_at: TimestampColumn | null;
}

export interface RentProofDatabase {
  internal_users: InternalUsersTable;
  auth_credentials: AuthCredentialsTable;
  auth_sessions: AuthSessionsTable;
  auth_password_reset_challenges: AuthPasswordResetChallengesTable;
  auth_email_verification_challenges: AuthEmailVerificationChallengesTable;
  guest_identities: GuestIdentitiesTable;
  rental_cases: RentalCasesTable;
  policy_documents: PolicyDocumentsTable;
  policy_events: PolicyEventsTable;
  consent_preferences: ConsentPreferencesTable;
  deletion_requests: DeletionRequestsTable;
  security_audit_events: SecurityAuditEventsTable;
  case_artifacts: CaseArtifactsTable;
}
