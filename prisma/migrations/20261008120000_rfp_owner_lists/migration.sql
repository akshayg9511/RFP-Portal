-- Owners as lists: several sourcing partners and several GMs per RFP.
-- Additive. The single columns stay and are dual-written with the first entry.
ALTER TABLE `Rfp` ADD COLUMN `sourcingPartners` JSON NULL,
    ADD COLUMN `gms` JSON NULL;

-- Backfill from the single columns so existing RFPs read the same either way.
UPDATE `Rfp` SET `sourcingPartners` = JSON_ARRAY(`sourcingPartner`) WHERE `sourcingPartner` IS NOT NULL;
UPDATE `Rfp` SET `gms` = JSON_ARRAY(`gm`) WHERE `gm` IS NOT NULL;
