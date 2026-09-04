-- CreateTable
CREATE TABLE `BugReport` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `type` ENUM('BUG', 'SUGGESTION') NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `screenRoute` VARCHAR(191) NOT NULL,
    `appVersionName` VARCHAR(191) NULL,
    `appVersionCode` INTEGER NULL,
    `deviceModel` VARCHAR(191) NULL,
    `androidSdkInt` INTEGER NULL,
    `status` ENUM('NEW', 'REVIEWED', 'RESOLVED') NOT NULL DEFAULT 'NEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BugReport_userId_idx`(`userId`),
    INDEX `BugReport_status_idx`(`status`),
    INDEX `BugReport_screenRoute_idx`(`screenRoute`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BugReport` ADD CONSTRAINT `BugReport_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
