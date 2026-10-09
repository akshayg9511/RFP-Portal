-- Procurement owners: a third owner role on an RFP (PRD 3.4). Additive.
ALTER TABLE `Rfp` ADD COLUMN `procurementOwners` JSON NULL;
