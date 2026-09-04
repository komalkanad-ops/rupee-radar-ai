-- CreateTable
CREATE TABLE `FeatureUsageEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `screen` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeatureUsageEvent_screen_createdAt_idx`(`screen`, `createdAt`),
    INDEX `FeatureUsageEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FeatureUsageEvent` ADD CONSTRAINT `FeatureUsageEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
