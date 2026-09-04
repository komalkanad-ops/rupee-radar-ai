-- CreateTable
CREATE TABLE `ProductRecord` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `purchaseDate` DATETIME(3) NOT NULL,
    `pricePaid` DOUBLE NULL,
    `seller` VARCHAR(191) NULL,
    `warrantyMonths` INTEGER NULL,
    `warrantyExpiry` DATETIME(3) NULL,
    `serialNumber` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductRecord_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductRecord` ADD CONSTRAINT `ProductRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
