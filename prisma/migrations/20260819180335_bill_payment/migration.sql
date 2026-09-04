-- AlterTable
ALTER TABLE `CoinLedgerEntry` MODIFY `reason` ENUM('REFERRAL_BONUS', 'VOUCHER_REDEMPTION', 'ADMIN_ADJUSTMENT', 'BILL_PAYMENT_BONUS') NOT NULL;

-- CreateTable
CREATE TABLE `BillPayment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `recurringPaymentId` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `razorpayOrderId` VARCHAR(191) NOT NULL,
    `razorpayPaymentId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,

    UNIQUE INDEX `BillPayment_razorpayOrderId_key`(`razorpayOrderId`),
    INDEX `BillPayment_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BillPayment` ADD CONSTRAINT `BillPayment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BillPayment` ADD CONSTRAINT `BillPayment_recurringPaymentId_fkey` FOREIGN KEY (`recurringPaymentId`) REFERENCES `RecurringPayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

