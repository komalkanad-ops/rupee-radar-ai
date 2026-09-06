-- Additive: the raw answers to the "Set up my layout" quiz. Nullable, no default, no backfill.
ALTER TABLE `User` ADD COLUMN `layoutQuizJson` TEXT NULL;
