-- AlterTable
ALTER TABLE `Quote` ADD COLUMN `ddpCentralAir` DECIMAL(12, 4) NULL,
    ADD COLUMN `ddpEastAir` DECIMAL(12, 4) NULL,
    ADD COLUMN `ddpWestAir` DECIMAL(12, 4) NULL;
