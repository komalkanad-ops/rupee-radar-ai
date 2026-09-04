-- CreateTable
CREATE TABLE `SavingsInstrument` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `institution` VARCHAR(191) NULL,
    `principalInr` DOUBLE NOT NULL DEFAULT 0,
    `currentValueInr` DOUBLE NULL,
    `quantityGrams` DOUBLE NULL,
    `quantityUnits` DOUBLE NULL,
    `maturityDate` DATETIME(3) NULL,
    `interestRatePct` DOUBLE NULL,
    `contributionSchedule` VARCHAR(191) NULL,
    `customIntervalDays` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SavingsInstrument_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SavingsContribution` (
    `id` VARCHAR(191) NOT NULL,
    `instrumentId` VARCHAR(191) NOT NULL,
    `amountInr` DOUBLE NOT NULL,
    `quantity` DOUBLE NULL,
    `contributedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sourceTransactionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SavingsContribution_instrumentId_idx`(`instrumentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SavingsInstrument` ADD CONSTRAINT `SavingsInstrument_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SavingsContribution` ADD CONSTRAINT `SavingsContribution_instrumentId_fkey` FOREIGN KEY (`instrumentId`) REFERENCES `SavingsInstrument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
