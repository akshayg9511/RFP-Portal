-- Add `kind` so the same table holds both the BASELINE bucket split and the
-- CLEAN_SHEET target. They are the same shape and are always read together,
-- and without the baseline split stored the drawer cannot show a real per
-- bucket gap — it was reverse-deriving baseline from the clean sheet, which
-- forces every bucket to the same percentage.
--
-- Hand-corrected. The generated migration dropped CleanSheet's foreign key
-- without re-adding it, and tried to ADD StyleImage_colourwayId_fkey, which
-- the previous migration already created and which has nothing to do with
-- this change.

-- DropIndex
DROP INDEX `CleanSheet_styleId_bucket_idx` ON `CleanSheet`;

-- AlterTable
ALTER TABLE `CleanSheet` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'CLEAN_SHEET';

-- CreateIndex
CREATE INDEX `CleanSheet_styleId_kind_bucket_idx` ON `CleanSheet`(`styleId`, `kind`, `bucket`);
