-- CreateTable
CREATE TABLE `BankLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `consentId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `fiTypes` VARCHAR(191) NOT NULL,
    `consentExpiry` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BankLink_consentId_key`(`consentId`),
    INDEX `BankLink_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BankLink` ADD CONSTRAINT `BankLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

