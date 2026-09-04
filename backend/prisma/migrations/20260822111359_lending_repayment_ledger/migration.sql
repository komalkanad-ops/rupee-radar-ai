-- CreateTable
CREATE TABLE `LentMoneyRepayment` (
    `id` VARCHAR(191) NOT NULL,
    `lentMoneyId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LentMoneyRepayment_lentMoneyId_idx`(`lentMoneyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LentMoneyRepayment` ADD CONSTRAINT `LentMoneyRepayment_lentMoneyId_fkey` FOREIGN KEY (`lentMoneyId`) REFERENCES `LentMoney`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
