\set ON_ERROR_STOP on

-- Run from psql while connected to the local `postgres` maintenance database as
-- an existing database administrator. This file contains no passwords.
SELECT 'CREATE ROLE rentproof_demo_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rentproof_demo_owner')
\gexec

SELECT 'CREATE ROLE rentproof_demo_migration LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rentproof_demo_migration')
\gexec

SELECT 'CREATE ROLE rentproof_demo_app LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rentproof_demo_app')
\gexec

SELECT 'CREATE DATABASE rentproof_demo OWNER rentproof_demo_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'rentproof_demo')
\gexec

\connect rentproof_demo

REVOKE ALL ON DATABASE rentproof_demo FROM PUBLIC;
GRANT CONNECT ON DATABASE rentproof_demo TO rentproof_demo_migration, rentproof_demo_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS rentproof AUTHORIZATION rentproof_demo_migration;
ALTER SCHEMA rentproof OWNER TO rentproof_demo_migration;
REVOKE ALL ON SCHEMA rentproof FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA rentproof TO rentproof_demo_migration;
GRANT USAGE ON SCHEMA rentproof TO rentproof_demo_app;

ALTER ROLE rentproof_demo_migration IN DATABASE rentproof_demo
  SET search_path = rentproof, pg_catalog;
ALTER ROLE rentproof_demo_app IN DATABASE rentproof_demo
  SET search_path = rentproof, pg_catalog;
ALTER ROLE rentproof_demo_migration IN DATABASE rentproof_demo
  SET statement_timeout = '30s';
ALTER ROLE rentproof_demo_app IN DATABASE rentproof_demo
  SET statement_timeout = '10s';
ALTER ROLE rentproof_demo_migration IN DATABASE rentproof_demo
  SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE rentproof_demo_app IN DATABASE rentproof_demo
  SET idle_in_transaction_session_timeout = '10s';

ALTER DEFAULT PRIVILEGES FOR ROLE rentproof_demo_migration IN SCHEMA rentproof
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rentproof_demo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rentproof_demo_migration IN SCHEMA rentproof
  GRANT USAGE, SELECT ON SEQUENCES TO rentproof_demo_app;

-- Set both LOGIN role passwords interactively after this file completes:
--   \password rentproof_demo_migration
--   \password rentproof_demo_app
-- psql suppresses the entered passwords; do not place them in this file or shell history.
