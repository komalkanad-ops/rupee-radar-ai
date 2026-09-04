-- AlterTable
ALTER TABLE `UserCreditCard` ADD COLUMN `creditLimitInr` INTEGER NULL,
    ADD COLUMN `currentOutstandingInr` INTEGER NULL;

-- CreateTable
CREATE TABLE `LoungeVisit` (
    `id` VARCHAR(191) NOT NULL,
    `userCreditCardId` VARCHAR(191) NOT NULL,
    `visitedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoungeVisit_userCreditCardId_idx`(`userCreditCardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LoungeVisit` ADD CONSTRAINT `LoungeVisit_userCreditCardId_fkey` FOREIGN KEY (`userCreditCardId`) REFERENCES `UserCreditCard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
