-- AlterTable
ALTER TABLE `FeatureFlag` ADD COLUMN `order` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `quickActionRoutesJson` VARCHAR(191) NULL,
    ADD COLUMN `serviceOrderJson` VARCHAR(191) NULL;
