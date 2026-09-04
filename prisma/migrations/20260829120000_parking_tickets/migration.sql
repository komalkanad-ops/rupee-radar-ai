-- CreateTable
CREATE TABLE `ParkingTicket` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `challanNumber` VARCHAR(191) NULL,
    `location` VARCHAR(191) NOT NULL,
    `vehicleNumber` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `issuedDate` DATETIME(3) NOT NULL,
    `dueDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNPAID',
    `paidAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ParkingTicket_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ParkingTicket` ADD CONSTRAINT `ParkingTicket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
