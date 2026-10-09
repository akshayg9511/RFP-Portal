-- ux/15: comments get a kind, feedback records the stage it was written at,
-- and a declined/withdrawn bid remembers where it was.
ALTER TABLE `BidComment` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'MESSAGE',
    ADD COLUMN `statusFrom` VARCHAR(191) NULL;
ALTER TABLE `ProductBid` ADD COLUMN `statusBeforeExit` VARCHAR(191) NULL;

-- Backfill: Quince status changes were always notes to the vendor (feedback);
-- vendor status changes were submits and withdrawals (updates).
UPDATE `BidComment` SET `kind` = 'FEEDBACK' WHERE `statusChange` IS NOT NULL AND `authorSide` = 'QUINCE';
UPDATE `BidComment` SET `kind` = 'UPDATE' WHERE `statusChange` IS NOT NULL AND `authorSide` = 'VENDOR';
