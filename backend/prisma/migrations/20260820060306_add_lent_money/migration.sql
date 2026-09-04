-- CreateTable
CREATE TABLE `LentMoney` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `personName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `reason` VARCHAR(191) NULL,
    `lentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expectedReturnDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OUTSTANDING',
    `returnedDate` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LentMoney_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LentMoney` ADD CONSTRAINT `LentMoney_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
