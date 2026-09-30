-- Style set membership becomes variation-aware.
--
-- A set may now hold 3 of a product's 5 sizes. NULL variationId means "the
-- whole product", which is what a style-grained product means and what every
-- pre-existing row is — so this is purely ADDITIVE and needs no backfill.
--
-- variationKey exists because MySQL treats every NULL as DISTINCT in a unique
-- index: a key of (styleSetId, styleId, variationId) would let the same style
-- join the same set without limit. The sentinel collapses those NULLs.
-- DEFAULT '@STYLE' is semantically correct for existing rows, not a
-- placeholder.

ALTER TABLE `StyleSetMember`
  ADD COLUMN `variationId` VARCHAR(191) NULL,
  ADD COLUMN `variationKey` VARCHAR(191) NOT NULL DEFAULT '@STYLE';

-- CREATE BEFORE DROP, deliberately.
--
-- `StyleSetMember_styleSetId_fkey` uses the old unique index for its leading
-- styleSetId column, so dropping it first fails with "needed in a foreign key
-- constraint". Creating the wider index first leaves the FK covered
-- throughout, and the window where both exist is harmless: the new index is
-- strictly more permissive, so nothing the old one rejected can slip in.
--
-- Existing data cannot violate the new index — variationKey is a constant for
-- every current row, and the old index already guaranteed uniqueness on the
-- other two columns.
CREATE UNIQUE INDEX `StyleSetMember_styleSetId_styleId_variationKey_key`
  ON `StyleSetMember`(`styleSetId`, `styleId`, `variationKey`);

DROP INDEX `StyleSetMember_styleSetId_styleId_key` ON `StyleSetMember`;

CREATE INDEX `StyleSetMember_variationId_idx` ON `StyleSetMember`(`variationId`);

ALTER TABLE `StyleSetMember`
  ADD CONSTRAINT `StyleSetMember_variationId_fkey`
  FOREIGN KEY (`variationId`) REFERENCES `Variation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
