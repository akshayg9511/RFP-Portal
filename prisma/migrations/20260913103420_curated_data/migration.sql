/*
  Warnings:

  - You are about to drop the column `heroImageUrl` on the `Style` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `Style` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Style` DROP COLUMN `heroImageUrl`,
    DROP COLUMN `imageUrl`,
    ADD COLUMN `franchise` VARCHAR(191) NULL,
    ADD COLUMN `gender` VARCHAR(191) NULL,
    ADD COLUMN `productType` VARCHAR(191) NULL,
    ADD COLUMN `retailPrice` DECIMAL(12, 2) NULL,
    ADD COLUMN `scenarioId` VARCHAR(191) NULL,
    ADD COLUMN `scenarioName` VARCHAR(191) NULL,
    ADD COLUMN `sizeModel` VARCHAR(191) NULL,
    ADD COLUMN `websiteUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `Variation` ADD COLUMN `colourwayId` VARCHAR(191) NULL,
    ADD COLUMN `sizeSortOrder` INTEGER NULL;

-- CreateTable
CREATE TABLE `Colourway` (
    `id` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `styleColorId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `websiteUrl` TEXT NULL,

    INDEX `Colourway_styleId_idx`(`styleId`),
    UNIQUE INDEX `Colourway_styleId_styleColorId_key`(`styleId`, `styleColorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StyleImage` (
    `id` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `colourwayId` VARCHAR(191) NULL,
    `url` TEXT NOT NULL,
    `isHero` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,

    INDEX `StyleImage_styleId_position_idx`(`styleId`, `position`),
    INDEX `StyleImage_colourwayId_idx`(`colourwayId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Variation` ADD CONSTRAINT `Variation_colourwayId_fkey` FOREIGN KEY (`colourwayId`) REFERENCES `Colourway`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Colourway` ADD CONSTRAINT `Colourway_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StyleImage` ADD CONSTRAINT `StyleImage_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StyleImage` ADD CONSTRAINT `StyleImage_colourwayId_fkey` FOREIGN KEY (`colourwayId`) REFERENCES `Colourway`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
