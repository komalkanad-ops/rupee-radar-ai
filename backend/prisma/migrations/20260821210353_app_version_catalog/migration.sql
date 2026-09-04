-- CreateTable
CREATE TABLE `AppVersion` (
    `id` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL DEFAULT 'android',
    `versionName` VARCHAR(191) NOT NULL,
    `versionCode` INTEGER NOT NULL,
    `channel` ENUM('BETA', 'STABLE') NOT NULL,
    `releaseNotes` VARCHAR(191) NULL,
    `minSupportedVersionCode` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AppVersion_platform_versionCode_key`(`platform`, `versionCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
