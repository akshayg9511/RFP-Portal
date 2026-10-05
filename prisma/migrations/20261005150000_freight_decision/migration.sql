-- Freight decisions — Phase 3, decisions P3 and P5, 5 Oct.
--
-- P3: freight basis is automatic (the cheaper of Quince-paid and DDP) unless
-- Quince overrides it for a bid. NULL = automatic, which is every existing
-- row, so this is additive with no backfill.
ALTER TABLE `Quote` ADD COLUMN `freightBasis` VARCHAR(191) NULL;

-- P5: the air / ocean split is set per PRODUCT x VARIANT and applies to every
-- vendor on it, so all of a size's bids are compared on one freight
-- assumption. Absent row = the wave default (70 air / 30 ocean).
CREATE TABLE `VariantFreight` (
  `id` VARCHAR(191) NOT NULL,
  `styleId` VARCHAR(191) NOT NULL,
  `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE',
  `airPct` DECIMAL(5, 2) NOT NULL DEFAULT 70,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `VariantFreight_styleId_variationKey_key`(`styleId`, `variationKey`),
  PRIMARY KEY (`id`)
-- Charset and collation stated explicitly: MySQL 8 defaults a new table to
-- utf8mb4_0900_ai_ci, and an FK between differently-collated varchar(191)
-- columns fails with error 3780 (learned in migration 10).
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `VariantFreight`
  ADD CONSTRAINT `VariantFreight_styleId_fkey`
  FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
