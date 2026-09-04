-- CreateTable
CREATE TABLE `SiteScreenshot` (
    `id` VARCHAR(191) NOT NULL,
    `caption` VARCHAR(191) NOT NULL DEFAULT '',
    `category` VARCHAR(191) NOT NULL DEFAULT '',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `mimeType` VARCHAR(191) NOT NULL,
    `data` LONGBLOB NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SiteScreenshot_active_sortOrder_idx`(`active`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
