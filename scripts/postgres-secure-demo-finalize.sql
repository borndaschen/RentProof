\set ON_ERROR_STOP on
\connect rentproof_secure_demo

REVOKE ALL ON TABLE rentproof.kysely_migration FROM rentproof_secure_demo_app;
REVOKE ALL ON TABLE rentproof.kysely_migration_lock FROM rentproof_secure_demo_app;

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
  rentproof.case_artifacts
TO rentproof_secure_demo_app;
