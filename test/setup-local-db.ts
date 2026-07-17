import 'dotenv/config';

// e2e tests run against local Postgres, never the shared Supabase database -
// DATABASE_URL otherwise points at Supabase for the running app (see .env).
process.env.DATABASE_URL =
  process.env.LOCAL_DATABASE_URL ??
  'postgresql://spal@localhost:5432/digital_wallet?schema=public';
