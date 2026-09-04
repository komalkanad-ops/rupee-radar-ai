-- AlterTable
ALTER TABLE `Voucher` ADD COLUMN `code` VARCHAR(191) NULL,
    ADD COLUMN `pin` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `VoucherRedemption` ADD COLUMN `revealedCode` VARCHAR(191) NULL,
    ADD COLUMN `revealedPin` VARCHAR(191) NULL;
