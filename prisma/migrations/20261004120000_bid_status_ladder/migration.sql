-- The status ladder replaces rounds, and Quote becomes per-variation.
--
-- Akshay, 2 Oct: "I am thinking not to introduce a concept of rounds."
-- Negotiation now repeats via the IN_NEGOTIATION status, so there is no
-- round counter. See domain/bidStatus.ts.

-- 1 · ProductBid — the status, per vendor x PRODUCT (H9).
--
-- Per product, not per variation: Quince negotiates over a product, so all
-- of its variants advance together. InvitationStyle is per-variation, so
-- repeating a status across those rows would let them disagree.
--
-- The charset clause is NOT optional: every other table here is
-- utf8mb4_unicode_ci, and MySQL 8 defaults a new one to utf8mb4_0900_ai_ci.
-- A foreign key between two varchar(191) columns of DIFFERENT collations is
-- rejected as "incompatible columns" (error 3780), which reads as a type
-- mismatch when it is a collation mismatch. Learned in migration 9.
CREATE TABLE `ProductBid` (
  `id` VARCHAR(191) NOT NULL,
  `invitationId` VARCHAR(191) NOT NULL,
  `styleId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'INVITED',
  `statusNote` TEXT NULL,
  `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `statusChangedBy` VARCHAR(191) NULL,
  `withdrawnAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ProductBid_invitationId_styleId_key`(`invitationId`, `styleId`),
  INDEX `ProductBid_styleId_idx`(`styleId`),
  INDEX `ProductBid_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2 · BidComment — the negotiation thread. Replaces Asks (cut 29 Sep).
CREATE TABLE `BidComment` (
  `id` VARCHAR(191) NOT NULL,
  `productBidId` VARCHAR(191) NOT NULL,
  `authorSide` VARCHAR(191) NOT NULL,
  `authorName` VARCHAR(191) NULL,
  `body` TEXT NOT NULL,
  `statusChange` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `BidComment_productBidId_createdAt_idx`(`productBidId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductBid`
  ADD CONSTRAINT `ProductBid_invitationId_fkey`
  FOREIGN KEY (`invitationId`) REFERENCES `Invitation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductBid`
  ADD CONSTRAINT `ProductBid_styleId_fkey`
  FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `BidComment`
  ADD CONSTRAINT `BidComment_productBidId_fkey`
  FOREIGN KEY (`productBidId`) REFERENCES `ProductBid`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3 · Quote becomes per-variation.
--
-- H8.5: every variant carries the FULL template at line-item level (41
-- fields on the Percale template), so each needs its own complete row.
ALTER TABLE `Quote`
  ADD COLUMN `variationId` VARCHAR(191) NULL,
  ADD COLUMN `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE';

-- CREATE BEFORE DROP. `Quote_invitationId_fkey` uses the old unique index
-- for its leading column and MySQL refuses to drop an index a foreign key
-- needs. Learned in migration 6, where the failed step also left its
-- columns behind — DDL is not transactional.
CREATE UNIQUE INDEX `Quote_invitationId_styleId_variationKey_key`
  ON `Quote`(`invitationId`, `styleId`, `variationKey`);

DROP INDEX `Quote_invitationId_styleId_round_key` ON `Quote`;

CREATE INDEX `Quote_variationId_idx` ON `Quote`(`variationId`);

ALTER TABLE `Quote`
  ADD CONSTRAINT `Quote_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4 · QuotePrice is dead. It held consumption + FOB per variation, which was
-- the F5 model; H8.5 replaced it with a full Quote row per variation, so a
-- thin price record has nothing left to carry.
DROP TABLE IF EXISTS `QuotePrice`;
