-- AlterTable
ALTER TABLE `Device` ADD COLUMN `deviceModel` VARCHAR(191) NULL,
    ADD COLUMN `deviceManufacturer` VARCHAR(191) NULL,
    ADD COLUMN `osVersion` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `FeatureUsageEvent_createdAt_idx` ON `FeatureUsageEvent`(`createdAt`);
