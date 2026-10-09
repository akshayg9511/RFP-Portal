-- ux/15b: older vendor-written comments take the vendor's email on file.
-- Quince-written ones stay blank: there was no signed-in user to record.
UPDATE `BidComment` c
  JOIN `ProductBid` b ON c.`productBidId` = b.`id`
  JOIN `Invitation` i ON b.`invitationId` = i.`id`
  JOIN `Vendor` v ON i.`vendorId` = v.`id`
SET c.`authorEmail` = v.`email`
WHERE c.`authorSide` = 'VENDOR' AND c.`authorEmail` IS NULL;
