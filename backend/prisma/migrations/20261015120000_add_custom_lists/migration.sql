-- AlterTable
ALTER TABLE `SmsTransaction` ADD COLUMN `subcategory` VARCHAR(40) NULL;

-- CreateTable
CREATE TABLE `CustomListItem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(40) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `defaultCategory` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomListItem_userId_idx`(`userId`),
    UNIQUE INDEX `CustomListItem_userId_clientId_key`(`userId`, `clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CustomListItem` ADD CONSTRAINT `CustomListItem_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
