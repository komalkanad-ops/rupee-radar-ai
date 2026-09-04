-- CreateTable
CREATE TABLE `CreditScoreSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `bureau` VARCHAR(191) NULL,
    `score` INTEGER NULL,
    `scoreBand` VARCHAR(191) NULL,
    `factors` JSON NULL,
    `status` VARCHAR(191) NOT NULL,
    `pulledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CreditScoreSnapshot_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CreditScoreSnapshot` ADD CONSTRAINT `CreditScoreSnapshot_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

