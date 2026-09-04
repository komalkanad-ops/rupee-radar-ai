-- CreateTable
CREATE TABLE `MeshUsageLog` (
    `id` VARCHAR(191) NOT NULL,
    `feature` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `promptTokens` INTEGER NULL,
    `completionTokens` INTEGER NULL,
    `totalTokens` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MeshUsageLog_feature_createdAt_idx`(`feature`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppEventLog` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `level` VARCHAR(191) NOT NULL DEFAULT 'ERROR',
    `feature` VARCHAR(191) NULL,
    `message` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `userId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AppEventLog_source_level_createdAt_idx`(`source`, `level`, `createdAt`),
    INDEX `AppEventLog_feature_createdAt_idx`(`feature`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChangelogEntry` (
    `id` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `releaseDate` DATETIME(3) NOT NULL,
    `platforms` JSON NOT NULL,
    `summary` VARCHAR(191) NULL,
    `highlights` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ChangelogEntry_version_key`(`version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
