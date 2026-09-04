-- CreateTable
CREATE TABLE `RouteMetricBucket` (
    `id` VARCHAR(191) NOT NULL,
    `bucketAt` DATETIME(3) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `route` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `errorCount` INTEGER NOT NULL DEFAULT 0,
    `clientErrs` INTEGER NOT NULL DEFAULT 0,
    `p50Ms` INTEGER NOT NULL DEFAULT 0,
    `p95Ms` INTEGER NOT NULL DEFAULT 0,
    `maxMs` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RouteMetricBucket_bucketAt_idx`(`bucketAt`),
    UNIQUE INDEX `RouteMetricBucket_bucketAt_method_route_key`(`bucketAt`, `method`, `route`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
