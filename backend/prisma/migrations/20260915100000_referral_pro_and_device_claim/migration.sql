-- AlterTable
ALTER TABLE `ReferralConversion` ADD COLUMN `proDaysAwarded` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `ReferralDeviceClaim` (
    `id` VARCHAR(191) NOT NULL,
    `deviceIdentifier` VARCHAR(191) NOT NULL,
    `referrerUserId` VARCHAR(191) NOT NULL,
    `referredUserId` VARCHAR(191) NOT NULL,
    `rejectedAttempts` INTEGER NOT NULL DEFAULT 0,
    `lastRejectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ReferralDeviceClaim_deviceIdentifier_key`(`deviceIdentifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
