// Integration tests run against a dedicated database (never the dev DB).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/goalfi_test";
