-- CreateTable
CREATE TABLE `MerchantCategoryOverride` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `normalizedMerchant` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MerchantCategoryOverride_userId_normalizedMerchant_key`(`userId`, `normalizedMerchant`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MerchantCategoryOverride` ADD CONSTRAINT `MerchantCategoryOverride_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
