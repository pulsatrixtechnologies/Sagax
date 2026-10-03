-- Better Auth 1.7.3 drops the required `account.issuer` column that 1.7.0
-- through 1.7.2 added (0001 was generated from 1.7.1). It never writes the
-- column again, so a NOT NULL `issuer` makes every new account insert fail
-- (startup reports "Database schema mismatch"). SQLite has no ALTER COLUMN:
-- drop the unique index, then the column, as the 1.7 upgrade guide says
-- (https://www.better-auth.com/docs/guides/1-7-upgrade-guide).
DROP INDEX IF EXISTS "account_issuer_accountId_uidx";
ALTER TABLE "account" DROP COLUMN "issuer";
