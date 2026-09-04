-- AlterTable
ALTER TABLE `CoinLedgerEntry` MODIFY `reason` ENUM('REFERRAL_BONUS', 'VOUCHER_REDEMPTION', 'ADMIN_ADJUSTMENT', 'BILL_PAYMENT_BONUS', 'FEEDBACK_BONUS') NOT NULL;

-- CreateTable
CREATE TABLE `Feedback` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `source` ENUM('APP', 'WEB') NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `rating` INTEGER NULL,
    `status` ENUM('NEW', 'REVIEWED', 'RESOLVED') NOT NULL DEFAULT 'NEW',
    `coinsAwarded` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Feedback_userId_idx`(`userId`),
    INDEX `Feedback_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
