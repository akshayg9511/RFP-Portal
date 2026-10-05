-- Awarding becomes variation-level — decision N1, 5 Oct.
--
-- Akshay: "awarding should be at variation level only." Each variation
-- allocates independently to exactly 100% (D2), so King can go to vendor A
-- and Queen to vendor B. NULL variationId = the whole product, which is what
-- a STYLE-grained product means and what every existing row means — so this
-- is additive with no backfill.

ALTER TABLE `Award`
  ADD COLUMN `variationId` VARCHAR(191) NULL,
  ADD COLUMN `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE';

-- CREATE BEFORE DROP. `Award_waveId_fkey` uses the old unique index for its
-- leading column, and MySQL refuses to drop an index a foreign key needs.
-- Learned in migration 6, where the failed step also left its columns behind
-- — DDL is not transactional.
--
-- variationKey, not variationId, is in the key: MySQL treats every NULL as
-- distinct in a unique index, so a nullable column alone would permit
-- duplicate style-level awards — a vendor appearing twice, each at 100%,
-- which is a 200% award that passes the 100% check.
CREATE UNIQUE INDEX `Award_waveId_styleId_variationKey_vendorId_key`
  ON `Award`(`waveId`, `styleId`, `variationKey`, `vendorId`);

DROP INDEX `Award_waveId_styleId_vendorId_key` ON `Award`;

CREATE INDEX `Award_variationId_idx` ON `Award`(`variationId`);

ALTER TABLE `Award`
  ADD CONSTRAINT `Award_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
