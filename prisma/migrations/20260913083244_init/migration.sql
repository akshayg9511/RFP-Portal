-- CreateTable
CREATE TABLE `Wave` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `dueDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Style` (
    `id` VARCHAR(191) NOT NULL,
    `styleNumber` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `division` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `subDepartment` VARCHAR(191) NOT NULL,
    `subClass` VARCHAR(191) NULL,
    `material` VARCHAR(191) NULL,
    `variationLevel` VARCHAR(191) NOT NULL DEFAULT 'STYLE',
    `imageUrl` TEXT NULL,
    `heroImageUrl` TEXT NULL,
    `htsCode` VARCHAR(191) NULL,
    `lengthIn` DECIMAL(10, 3) NULL,
    `widthIn` DECIMAL(10, 3) NULL,
    `heightIn` DECIMAL(10, 3) NULL,
    `weightG` DECIMAL(10, 3) NULL,
    `planUnits` INTEGER NULL,
    `revenue2026` DECIMAL(14, 2) NULL,
    `baselineFob` DECIMAL(12, 4) NULL,
    `baselineLanded` DECIMAL(12, 4) NULL,

    UNIQUE INDEX `Style_styleNumber_key`(`styleNumber`),
    INDEX `Style_division_department_subDepartment_idx`(`division`, `department`, `subDepartment`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Variation` (
    `id` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `size` VARCHAR(191) NULL,
    `colour` VARCHAR(191) NULL,
    `sku` VARCHAR(191) NULL,
    `planUnits` INTEGER NULL,
    `volumeShare` DECIMAL(8, 6) NULL,
    `baselineFob` DECIMAL(12, 4) NULL,
    `logisticsOcean` DECIMAL(12, 4) NULL,
    `logisticsAir` DECIMAL(12, 4) NULL,

    INDEX `Variation_styleId_idx`(`styleId`),
    INDEX `Variation_sku_idx`(`sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StyleSet` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `lastUsedIn` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StyleSetMember` (
    `id` VARCHAR(191) NOT NULL,
    `styleSetId` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,

    INDEX `StyleSetMember_styleId_idx`(`styleId`),
    UNIQUE INDEX `StyleSetMember_styleSetId_styleId_key`(`styleSetId`, `styleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CleanSheet` (
    `id` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `size` VARCHAR(191) NULL,
    `bucket` VARCHAR(191) NOT NULL,
    `lineItem` VARCHAR(191) NULL,
    `amount` DECIMAL(12, 4) NOT NULL,

    INDEX `CleanSheet_styleId_bucket_idx`(`styleId`, `bucket`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vendor` (
    `id` VARCHAR(191) NOT NULL,
    `vendorCode` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NULL,
    `countryIso` VARCHAR(191) NULL,
    `cooRegion` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `isNewToQuince` BOOLEAN NOT NULL DEFAULT false,
    `isTemp` BOOLEAN NOT NULL DEFAULT false,
    `email` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Vendor_vendorCode_key`(`vendorCode`),
    INDEX `Vendor_cooRegion_idx`(`cooRegion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CurrentSupplier` (
    `id` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `vendorId` VARCHAR(191) NOT NULL,
    `currentFob` DECIMAL(12, 4) NULL,

    INDEX `CurrentSupplier_vendorId_idx`(`vendorId`),
    UNIQUE INDEX `CurrentSupplier_styleId_vendorId_key`(`styleId`, `vendorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Template` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `division` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `subDepartment` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `definition` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Template_division_department_subDepartment_idx`(`division`, `department`, `subDepartment`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rfp` (
    `id` VARCHAR(191) NOT NULL,
    `waveId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `instructions` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `dueDate` DATETIME(3) NULL,
    `currentRound` INTEGER NOT NULL DEFAULT 1,
    `sourcingPartner` VARCHAR(191) NULL,
    `gm` VARCHAR(191) NULL,
    `comment` TEXT NULL,
    `issuedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Rfp_waveId_idx`(`waveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RfpStyle` (
    `id` VARCHAR(191) NOT NULL,
    `rfpId` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `addedPostIssue` BOOLEAN NOT NULL DEFAULT false,
    `addedAt` DATETIME(3) NULL,

    INDEX `RfpStyle_styleId_idx`(`styleId`),
    UNIQUE INDEX `RfpStyle_rfpId_styleId_key`(`rfpId`, `styleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invitation` (
    `id` VARCHAR(191) NOT NULL,
    `rfpId` VARCHAR(191) NOT NULL,
    `vendorId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'NOT_STARTED',
    `currentRound` INTEGER NOT NULL DEFAULT 1,
    `declined` BOOLEAN NOT NULL DEFAULT false,
    `declineReason` TEXT NULL,
    `issuedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Invitation_vendorId_idx`(`vendorId`),
    UNIQUE INDEX `Invitation_rfpId_vendorId_key`(`rfpId`, `vendorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvitationStyle` (
    `id` VARCHAR(191) NOT NULL,
    `invitationId` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `cannotBid` BOOLEAN NOT NULL DEFAULT false,
    `cannotBidReason` TEXT NULL,

    INDEX `InvitationStyle_styleId_idx`(`styleId`),
    UNIQUE INDEX `InvitationStyle_invitationId_styleId_key`(`invitationId`, `styleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Quote` (
    `id` VARCHAR(191) NOT NULL,
    `invitationId` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `vendorId` VARCHAR(191) NOT NULL,
    `round` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `values` JSON NOT NULL,
    `bucketTotals` JSON NULL,
    `fob` DECIMAL(12, 4) NULL,
    `dutyType` VARCHAR(191) NULL,
    `ddpWest` DECIMAL(12, 4) NULL,
    `ddpCentral` DECIMAL(12, 4) NULL,
    `ddpEast` DECIMAL(12, 4) NULL,
    `maxVolumeCapacity` INTEGER NULL,
    `productionLeadTime` INTEGER NULL,
    `moq` INTEGER NULL,
    `notes` TEXT NULL,
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Quote_styleId_idx`(`styleId`),
    INDEX `Quote_vendorId_idx`(`vendorId`),
    UNIQUE INDEX `Quote_invitationId_styleId_round_key`(`invitationId`, `styleId`, `round`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ask` (
    `id` VARCHAR(191) NOT NULL,
    `invitationId` VARCHAR(191) NOT NULL,
    `anchor` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NULL,
    `bucket` VARCHAR(191) NULL,
    `fieldPath` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `targetPctLo` DECIMAL(6, 2) NULL,
    `targetPctHi` DECIMAL(6, 2) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `mandatory` BOOLEAN NOT NULL DEFAULT false,
    `valueBefore` TEXT NULL,
    `valueAfter` TEXT NULL,
    `reply` TEXT NULL,
    `round` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ask_invitationId_status_idx`(`invitationId`, `status`),
    INDEX `Ask_styleId_idx`(`styleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Award` (
    `id` VARCHAR(191) NOT NULL,
    `waveId` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NOT NULL,
    `vendorId` VARCHAR(191) NOT NULL,
    `awardPct` DECIMAL(7, 4) NOT NULL,
    `bestCost` DECIMAL(12, 4) NULL,
    `bestCostBasis` VARCHAR(191) NULL,
    `awardedUnits` INTEGER NULL,
    `awardedDollars` DECIMAL(16, 2) NULL,
    `savingsDollars` DECIMAL(16, 2) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ALLOCATED',
    `comment` TEXT NULL,
    `awardedAt` DATETIME(3) NULL,
    `awardedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Award_styleId_idx`(`styleId`),
    INDEX `Award_vendorId_idx`(`vendorId`),
    INDEX `Award_status_idx`(`status`),
    UNIQUE INDEX `Award_waveId_styleId_vendorId_key`(`waveId`, `styleId`, `vendorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TariffRate` (
    `id` VARCHAR(191) NOT NULL,
    `htsCode` VARCHAR(191) NOT NULL,
    `countryIso` VARCHAR(191) NOT NULL,
    `rate` DECIMAL(8, 6) NOT NULL,

    INDEX `TariffRate_htsCode_idx`(`htsCode`),
    UNIQUE INDEX `TariffRate_htsCode_countryIso_key`(`htsCode`, `countryIso`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LogisticsRate` (
    `id` VARCHAR(191) NOT NULL,
    `styleNumber` VARCHAR(191) NOT NULL,
    `size` VARCHAR(191) NULL,
    `countryIso` VARCHAR(191) NULL,
    `ocean` DECIMAL(12, 4) NULL,
    `air` DECIMAL(12, 4) NULL,

    INDEX `LogisticsRate_styleNumber_size_idx`(`styleNumber`, `size`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Config` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NULL,
    `vendorId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` JSON NULL,
    `actor` VARCHAR(191) NULL,
    `actorSide` VARCHAR(191) NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActivityLog_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `ActivityLog_styleId_idx`(`styleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Variation` ADD CONSTRAINT `Variation_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StyleSetMember` ADD CONSTRAINT `StyleSetMember_styleSetId_fkey` FOREIGN KEY (`styleSetId`) REFERENCES `StyleSet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StyleSetMember` ADD CONSTRAINT `StyleSetMember_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CleanSheet` ADD CONSTRAINT `CleanSheet_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CurrentSupplier` ADD CONSTRAINT `CurrentSupplier_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CurrentSupplier` ADD CONSTRAINT `CurrentSupplier_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rfp` ADD CONSTRAINT `Rfp_waveId_fkey` FOREIGN KEY (`waveId`) REFERENCES `Wave`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rfp` ADD CONSTRAINT `Rfp_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `Template`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RfpStyle` ADD CONSTRAINT `RfpStyle_rfpId_fkey` FOREIGN KEY (`rfpId`) REFERENCES `Rfp`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RfpStyle` ADD CONSTRAINT `RfpStyle_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invitation` ADD CONSTRAINT `Invitation_rfpId_fkey` FOREIGN KEY (`rfpId`) REFERENCES `Rfp`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invitation` ADD CONSTRAINT `Invitation_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvitationStyle` ADD CONSTRAINT `InvitationStyle_invitationId_fkey` FOREIGN KEY (`invitationId`) REFERENCES `Invitation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvitationStyle` ADD CONSTRAINT `InvitationStyle_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_invitationId_fkey` FOREIGN KEY (`invitationId`) REFERENCES `Invitation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quote` ADD CONSTRAINT `Quote_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ask` ADD CONSTRAINT `Ask_invitationId_fkey` FOREIGN KEY (`invitationId`) REFERENCES `Invitation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Award` ADD CONSTRAINT `Award_waveId_fkey` FOREIGN KEY (`waveId`) REFERENCES `Wave`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Award` ADD CONSTRAINT `Award_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `Style`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Award` ADD CONSTRAINT `Award_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
