-- Nomination and bidding become variation-level.
--
-- A buyer can now ask a vendor for Twin/Full/Queen but not King, and the
-- vendor quotes a price per size. NULL variationId = the whole product,
-- which is every existing row, so this is additive with no backfill.

-- 1 · Nomination per variation.
ALTER TABLE `InvitationStyle`
  ADD COLUMN `variationId` VARCHAR(191) NULL,
  ADD COLUMN `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE';

-- CREATE BEFORE DROP. `InvitationStyle_invitationId_fkey` uses the old
-- unique index for its leading column and MySQL refuses to drop an index a
-- foreign key needs. Learned in migration 6, where the failed step also left
-- its columns behind — DDL is not transactional.
CREATE UNIQUE INDEX `InvitationStyle_invitationId_styleId_variationKey_key`
  ON `InvitationStyle`(`invitationId`, `styleId`, `variationKey`);

DROP INDEX `InvitationStyle_invitationId_styleId_key` ON `InvitationStyle`;

CREATE INDEX `InvitationStyle_variationId_idx` ON `InvitationStyle`(`variationId`);

ALTER TABLE `InvitationStyle`
  ADD CONSTRAINT `InvitationStyle_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2 · One quoted price per variation, against one quote.
--
-- Decision F5: the ~35-input cost breakdown STAYS on Quote. Only what
-- genuinely differs by size lives here, which is what the real Lauren Home
-- template does — one breakdown, one column per size. Duplicating the whole
-- breakdown per size would be five times the data entry for one garment
-- whose labour rate, SAM and trim do not change by size.
CREATE TABLE `QuotePrice` (
  `id` VARCHAR(191) NOT NULL,
  `quoteId` VARCHAR(191) NOT NULL,
  `variationId` VARCHAR(191) NOT NULL,
  `consumption` DECIMAL(12, 4) NULL,
  `fob` DECIMAL(12, 4) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `QuotePrice_quoteId_variationId_key`(`quoteId`, `variationId`),
  INDEX `QuotePrice_variationId_idx`(`variationId`),
  PRIMARY KEY (`id`)
-- The charset/collation clause is NOT optional. Every other table in this
-- schema is utf8mb4_unicode_ci; without it MySQL 8 defaults a new table to
-- utf8mb4_0900_ai_ci, and a foreign key between two varchar(191) columns of
-- DIFFERENT collations is rejected with error 3780 "incompatible columns" —
-- which reads as a type mismatch when it is a collation mismatch.
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QuotePrice`
  ADD CONSTRAINT `QuotePrice_quoteId_fkey`
  FOREIGN KEY (`quoteId`) REFERENCES `Quote`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `QuotePrice`
  ADD CONSTRAINT `QuotePrice_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
