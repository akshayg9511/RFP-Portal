-- CreateTable
CREATE TABLE `AwardStrategy` (
    `id` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `comment` TEXT NULL,
    `split` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NULL,

    INDEX `AwardStrategy_styleId_idx`(`styleId`),
    UNIQUE INDEX `AwardStrategy_styleId_name_key`(`styleId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AwardStrategy` ADD CONSTRAINT `AwardStrategy_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
