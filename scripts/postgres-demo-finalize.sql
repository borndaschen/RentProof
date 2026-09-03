\set ON_ERROR_STOP on
\connect rentproof_demo

-- Run as the migration role after `pnpm db:migrate -- up`.
REVOKE ALL ON TABLE rentproof.kysely_migration FROM rentproof_demo_app;
REVOKE ALL ON TABLE rentproof.kysely_migration_lock FROM rentproof_demo_app;

-- Product table grants are repeated deliberately so this step repairs an
-- interrupted bootstrap/migration sequence without broadening schema rights.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  rentproof.internal_users,
  rentproof.guest_identities,
  rentproof.rental_cases,
  rentproof.policy_documents,
  rentproof.policy_events,
  rentproof.consent_preferences,
  rentproof.deletion_requests,
  rentproof.security_audit_events,
  rentproof.auth_credentials,
  rentproof.auth_sessions,
  rentproof.auth_password_reset_challenges,
  rentproof.auth_email_verification_challenges,
  rentproof.case_artifacts,
  rentproof.guest_sessions
TO rentproof_demo_app;
