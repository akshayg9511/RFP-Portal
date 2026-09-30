-- RFP contents become variation-aware: an RFP may carry 3 of a product's 5
-- sizes. NULL variationId means the whole product, which is every existing
-- row, so this is additive with no backfill.
--
-- Same '@STYLE' sentinel as StyleSetMember, for the same reason: MySQL treats
-- every NULL as DISTINCT in a unique index, so a nullable variationId alone
-- would let one product join one RFP without limit.

ALTER TABLE `RfpStyle`
  ADD COLUMN `variationId` VARCHAR(191) NULL,
  ADD COLUMN `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE';

-- CREATE BEFORE DROP: `RfpStyle_rfpId_fkey` uses the old unique index for its
-- leading rfpId column, so dropping first fails with "needed in a foreign key
-- constraint". This ordering was learned the hard way in migration 6.
CREATE UNIQUE INDEX `RfpStyle_rfpId_styleId_variationKey_key`
  ON `RfpStyle`(`rfpId`, `styleId`, `variationKey`);

DROP INDEX `RfpStyle_rfpId_styleId_key` ON `RfpStyle`;

CREATE INDEX `RfpStyle_variationId_idx` ON `RfpStyle`(`variationId`);

ALTER TABLE `RfpStyle`
  ADD CONSTRAINT `RfpStyle_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
