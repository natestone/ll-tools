-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `isSuperAdmin` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailSuppression` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL DEFAULT 'unsubscribed',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailSuppression_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordReset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordReset_tokenHash_key`(`tokenHash`),
    INDEX `PasswordReset_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `League` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `fyStartMonth` INTEGER NOT NULL DEFAULT 10,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/New_York',
    `ownerUserId` INTEGER NOT NULL,
    `seedVersion` VARCHAR(191) NOT NULL DEFAULT 'gngrll-2026.1',
    `activeSeasonYear` INTEGER NULL,
    `isSeed` BOOLEAN NOT NULL DEFAULT false,
    `website` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `addressLine1` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `postalCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `League_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Membership` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `isOwner` BOOLEAN NOT NULL DEFAULT false,

    INDEX `Membership_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `Membership_leagueId_userId_key`(`leagueId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `isCustom` BOOLEAN NOT NULL DEFAULT false,

    INDEX `Role_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `Role_leagueId_key_key`(`leagueId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OfficerAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `membershipId` INTEGER NOT NULL,
    `roleId` INTEGER NOT NULL,

    INDEX `OfficerAssignment_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `OfficerAssignment_leagueId_membershipId_roleId_key`(`leagueId`, `membershipId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `roleKey` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `subject` TEXT NOT NULL,
    `bodyMd` LONGTEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `weekOfFY` INTEGER NULL,
    `seededFromId` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmailTemplate_leagueId_idx`(`leagueId`),
    INDEX `EmailTemplate_leagueId_roleKey_idx`(`leagueId`, `roleKey`),
    UNIQUE INDEX `EmailTemplate_leagueId_key_key`(`leagueId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgendaTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `phase` VARCHAR(191) NULL,
    `weekOfFY` INTEGER NULL,
    `bodyMd` LONGTEXT NOT NULL,
    `seededFromId` INTEGER NULL,

    INDEX `AgendaTemplate_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `AgendaTemplate_leagueId_slug_key`(`leagueId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalendarItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `roleKey` VARCHAR(191) NOT NULL,
    `weekOfFY` INTEGER NOT NULL,
    `dateOverride` DATETIME(3) NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'reminder',
    `title` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `seededFromId` INTEGER NULL,

    INDEX `CalendarItem_leagueId_idx`(`leagueId`),
    INDEX `CalendarItem_leagueId_roleKey_idx`(`leagueId`, `roleKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `roleKey` VARCHAR(191) NOT NULL,
    `seasonYear` INTEGER NULL,
    `archivedAt` DATETIME(3) NULL,
    `archivedSteps` JSON NULL,
    `dueWeekOfFY` INTEGER NULL,
    `dueDateOverride` DATETIME(3) NULL,
    `seriesId` VARCHAR(191) NULL,
    `recurrence` JSON NULL,
    `phase` VARCHAR(191) NULL,
    `title` TEXT NOT NULL,
    `details` LONGTEXT NULL,
    `steps` JSON NULL,
    `links` JSON NULL,
    `stepsDone` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `seededFromId` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_leagueId_idx`(`leagueId`),
    INDEX `Task_leagueId_roleKey_idx`(`leagueId`, `roleKey`),
    INDEX `Task_leagueId_seasonYear_idx`(`leagueId`, `seasonYear`),
    INDEX `Task_leagueId_seriesId_idx`(`leagueId`, `seriesId`),
    INDEX `Task_leagueId_seasonYear_phase_idx`(`leagueId`, `seasonYear`, `phase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PolicyDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `bodyMd` LONGTEXT NOT NULL,
    `seededFromId` INTEGER NULL,

    INDEX `PolicyDocument_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `PolicyDocument_leagueId_slug_key`(`leagueId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReferenceDoc` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `bodyMd` LONGTEXT NOT NULL,
    `seededFromId` INTEGER NULL,

    INDEX `ReferenceDoc_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `ReferenceDoc_leagueId_slug_key`(`leagueId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invite` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `roleKeys` JSON NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `invitedByUserId` INTEGER NOT NULL,
    `isOwnerInvite` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Invite_tokenHash_key`(`tokenHash`),
    INDEX `Invite_leagueId_idx`(`leagueId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Season` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `seasonYear` INTEGER NOT NULL,
    `fyStart` DATETIME(3) NOT NULL,
    `fyEnd` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Season_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `Season_leagueId_seasonYear_key`(`leagueId`, `seasonYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `session_id` VARCHAR(128) NOT NULL,
    `expires` INTEGER UNSIGNED NOT NULL,
    `data` MEDIUMTEXT NULL,

    PRIMARY KEY (`session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BoardMeeting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `title` TEXT NOT NULL,
    `meetingDate` DATETIME(3) NULL,
    `startTime` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `facilitator` VARCHAR(191) NULL,
    `recorder` VARCHAR(191) NULL,
    `attendees` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `items` JSON NULL,
    `notes` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BoardMeeting_leagueId_idx`(`leagueId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CategoryPermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `roleKey` VARCHAR(191) NOT NULL,

    INDEX `CategoryPermission_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `CategoryPermission_leagueId_category_roleKey_key`(`leagueId`, `category`, `roleKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchedulerState` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `preferences` JSON NULL,
    `schedule` JSON NULL,
    `view` VARCHAR(191) NOT NULL DEFAULT 'list',
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SchedulerState_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `SchedulerState_leagueId_userId_key`(`leagueId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AllStarSeason` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leagueId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `publicSlug` VARCHAR(191) NOT NULL,
    `consentMd` LONGTEXT NOT NULL,
    `signupOpen` BOOLEAN NOT NULL DEFAULT true,
    `votingClosesAt` DATETIME(3) NULL,
    `invitesSentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AllStarSeason_publicSlug_key`(`publicSlug`),
    INDEX `AllStarSeason_leagueId_idx`(`leagueId`),
    UNIQUE INDEX `AllStarSeason_leagueId_year_key`(`leagueId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AllStarLevel` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seasonId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `bornFrom` DATETIME(3) NOT NULL,
    `bornTo` DATETIME(3) NOT NULL,

    INDEX `AllStarLevel_seasonId_idx`(`seasonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AllStarSignup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seasonId` INTEGER NOT NULL,
    `playerName` VARCHAR(191) NOT NULL,
    `playerDob` DATETIME(3) NOT NULL,
    `parentName` VARCHAR(191) NOT NULL,
    `parentEmail` VARCHAR(191) NULL,
    `parentPhone` VARCHAR(191) NULL,
    `consentMd` LONGTEXT NOT NULL,
    `signedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signedIp` VARCHAR(191) NULL,

    INDEX `AllStarSignup_seasonId_idx`(`seasonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AllStarSignupLevel` (
    `signupId` INTEGER NOT NULL,
    `levelId` INTEGER NOT NULL,

    INDEX `AllStarSignupLevel_levelId_idx`(`levelId`),
    PRIMARY KEY (`signupId`, `levelId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AllStarVoter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seasonId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NULL,
    `codeSentAt` DATETIME(3) NULL,
    `codeExpiresAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `invitedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AllStarVoter_token_key`(`token`),
    INDEX `AllStarVoter_seasonId_idx`(`seasonId`),
    UNIQUE INDEX `AllStarVoter_seasonId_email_key`(`seasonId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AllStarBallot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voterId` INTEGER NOT NULL,
    `levelId` INTEGER NOT NULL,
    `ordering` JSON NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AllStarBallot_levelId_idx`(`levelId`),
    UNIQUE INDEX `AllStarBallot_voterId_levelId_key`(`voterId`, `levelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PasswordReset` ADD CONSTRAINT `PasswordReset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Role` ADD CONSTRAINT `Role_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OfficerAssignment` ADD CONSTRAINT `OfficerAssignment_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OfficerAssignment` ADD CONSTRAINT `OfficerAssignment_membershipId_fkey` FOREIGN KEY (`membershipId`) REFERENCES `Membership`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OfficerAssignment` ADD CONSTRAINT `OfficerAssignment_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplate` ADD CONSTRAINT `EmailTemplate_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgendaTemplate` ADD CONSTRAINT `AgendaTemplate_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarItem` ADD CONSTRAINT `CalendarItem_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PolicyDocument` ADD CONSTRAINT `PolicyDocument_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReferenceDoc` ADD CONSTRAINT `ReferenceDoc_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invite` ADD CONSTRAINT `Invite_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invite` ADD CONSTRAINT `Invite_invitedByUserId_fkey` FOREIGN KEY (`invitedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Season` ADD CONSTRAINT `Season_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BoardMeeting` ADD CONSTRAINT `BoardMeeting_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CategoryPermission` ADD CONSTRAINT `CategoryPermission_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchedulerState` ADD CONSTRAINT `SchedulerState_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarSeason` ADD CONSTRAINT `AllStarSeason_leagueId_fkey` FOREIGN KEY (`leagueId`) REFERENCES `League`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarLevel` ADD CONSTRAINT `AllStarLevel_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `AllStarSeason`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarSignup` ADD CONSTRAINT `AllStarSignup_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `AllStarSeason`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarSignupLevel` ADD CONSTRAINT `AllStarSignupLevel_signupId_fkey` FOREIGN KEY (`signupId`) REFERENCES `AllStarSignup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarSignupLevel` ADD CONSTRAINT `AllStarSignupLevel_levelId_fkey` FOREIGN KEY (`levelId`) REFERENCES `AllStarLevel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarVoter` ADD CONSTRAINT `AllStarVoter_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `AllStarSeason`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarBallot` ADD CONSTRAINT `AllStarBallot_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `AllStarVoter`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AllStarBallot` ADD CONSTRAINT `AllStarBallot_levelId_fkey` FOREIGN KEY (`levelId`) REFERENCES `AllStarLevel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

