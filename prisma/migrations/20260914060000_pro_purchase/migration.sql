-- CreateTable
CREATE TABLE `ProPurchase` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `cfOrderId` VARCHAR(191) NULL,
    `plan` VARCHAR(191) NOT NULL,
    `amountInr` INTEGER NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'CREATED',
    `voucherCode` VARCHAR(191) NULL,
    `voucherRedeemed` BOOLEAN NOT NULL DEFAULT false,
    `redeemedByUserId` VARCHAR(191) NULL,
    `redeemedAt` DATETIME(3) NULL,
    `proExpiryAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProPurchase_orderId_key`(`orderId`),
    UNIQUE INDEX `ProPurchase_voucherCode_key`(`voucherCode`),
    INDEX `ProPurchase_email_idx`(`email`),
    INDEX `ProPurchase_phone_idx`(`phone`),
    INDEX `ProPurchase_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
