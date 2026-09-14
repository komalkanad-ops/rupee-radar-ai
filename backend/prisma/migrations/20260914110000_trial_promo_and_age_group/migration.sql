-- AlterTable
ALTER TABLE `User` ADD COLUMN `ageGroup` VARCHAR(191) NULL,
    ADD COLUMN `trialCodeRedeemedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `TrialPromoCode` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `code` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
