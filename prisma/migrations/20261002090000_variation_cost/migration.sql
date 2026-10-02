-- Cost data becomes per-variation, so a dropdown over the cost breakdown
-- changes real numbers rather than just a label.
--
-- Cost genuinely differs by size: Variation.baselineFob spans $53.90-$100.01
-- on U-BEDD-33. Before this, CleanSheet and CurrentSupplier were keyed on
-- styleId alone, so every size shared one set of buckets.
--
-- NULL variationId = the style-level figure, which is every existing row.
-- Additive, no backfill. Same '@STYLE' sentinel as migrations 6 and 7:
-- MySQL treats each NULL as DISTINCT in a unique index, so without it one
-- style could hold unlimited duplicate rows per bucket.

ALTER TABLE `CleanSheet`
  ADD COLUMN `variationId` VARCHAR(191) NULL,
  ADD COLUMN `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE';

ALTER TABLE `CurrentSupplier`
  ADD COLUMN `variationId` VARCHAR(191) NULL,
  ADD COLUMN `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE';

-- CleanSheet had NO unique constraint before, so this one is purely new —
-- nothing to drop, and it closes a real hole: the same bucket could be
-- inserted twice for one style and the drawer would double-count it.
CREATE UNIQUE INDEX `CleanSheet_styleId_variationKey_kind_bucket_key`
  ON `CleanSheet`(`styleId`, `variationKey`, `kind`, `bucket`);

CREATE INDEX `CleanSheet_variationId_idx` ON `CleanSheet`(`variationId`);

-- CurrentSupplier DOES have one to replace. CREATE before DROP: the old
-- index covers CurrentSupplier_styleId_fkey's leading column, and MySQL
-- refuses to drop an index a foreign key needs (learned in migration 6,
-- where the failed step also left its columns behind — DDL is not
-- transactional).
CREATE UNIQUE INDEX `CurrentSupplier_styleId_variationKey_vendorId_key`
  ON `CurrentSupplier`(`styleId`, `variationKey`, `vendorId`);

DROP INDEX `CurrentSupplier_styleId_vendorId_key` ON `CurrentSupplier`;

CREATE INDEX `CurrentSupplier_variationId_idx` ON `CurrentSupplier`(`variationId`);

ALTER TABLE `CleanSheet`
  ADD CONSTRAINT `CleanSheet_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CurrentSupplier`
  ADD CONSTRAINT `CurrentSupplier_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
