-- CreateTable
CREATE TABLE `LentMoneyInstallment` (
    `id` VARCHAR(191) NOT NULL,
    `lentMoneyId` VARCHAR(191) NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `paidAt` DATETIME(3) NULL,

    INDEX `LentMoneyInstallment_lentMoneyId_idx`(`lentMoneyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LentMoneyInstallment` ADD CONSTRAINT `LentMoneyInstallment_lentMoneyId_fkey` FOREIGN KEY (`lentMoneyId`) REFERENCES `LentMoney`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
