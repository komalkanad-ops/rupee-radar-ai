-- CreateTable
CREATE TABLE `Loan` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('HOME', 'CAR', 'PERSONAL', 'COMMERCIAL', 'EDUCATION', 'OTHER') NOT NULL,
    `bankName` VARCHAR(191) NOT NULL,
    `accountRef` VARCHAR(191) NULL,
    `principal` DOUBLE NOT NULL,
    `roiAnnualPct` DOUBLE NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `tenureMonths` INTEGER NOT NULL,
    `emiAmount` DOUBLE NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Loan_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
