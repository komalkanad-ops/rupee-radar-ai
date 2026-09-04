-- AlterTable
ALTER TABLE `HouseholdMember` ADD COLUMN `categorySpendSharingEnabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `LentMoney` ADD COLUMN `amountRepaid` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `upiVpa` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `UserCreditCard` ADD COLUMN `rewardPointsBalance` INTEGER NULL,
    ADD COLUMN `rewardPointsExpiryDate` DATETIME(3) NULL;
