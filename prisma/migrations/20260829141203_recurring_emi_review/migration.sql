-- AlterTable
ALTER TABLE `RecurringPayment` ADD COLUMN `detectedCount` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `firstDetectedAt` DATETIME(3) NULL,
    ADD COLUMN `dismissedAt` DATETIME(3) NULL,
    ADD COLUMN `convertedLoanId` VARCHAR(191) NULL;
