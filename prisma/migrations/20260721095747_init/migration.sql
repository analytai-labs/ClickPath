-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "InviteRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('free', 'pro', 'ultra');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "GeoRuleType" AS ENUM ('country', 'continent');

-- CreateEnum
CREATE TYPE "GeoRuleCondition" AS ENUM ('in', 'not_in');

-- CreateEnum
CREATE TYPE "GeoRuleAction" AS ENUM ('redirect', 'block');

-- CreateEnum
CREATE TYPE "QrContentType" AS ENUM ('link', 'text');

-- CreateEnum
CREATE TYPE "PatternStyle" AS ENUM ('square', 'diamond', 'star', 'fluid', 'rounded', 'tile', 'stripe', 'fluid-line', 'stripe-column', 'dot', 'squircle', 'row', 'column');

-- CreateEnum
CREATE TYPE "CornerStyle" AS ENUM ('circle', 'circle-diamond', 'square', 'square-diamond', 'rounded-circle', 'rounded', 'circle-star', 'plus', 'box', 'octagon', 'random', 'tiny-plus', 'auto');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('pending', 'active', 'invalid');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('pending', 'blocked', 'dismissed');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('pending', 'accepted', 'cancelled', 'expired', 'declined');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('bug', 'feature', 'question');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "PlanSnapshot" AS ENUM ('free', 'pro', 'ultra');

-- CreateEnum
CREATE TYPE "BioBlockType" AS ENUM ('link', 'heading', 'text', 'social', 'divider', 'email');

-- CreateTable
CREATE TABLE "Team" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "avatarUrl" TEXT,
    "defaultDomain" VARCHAR(255) DEFAULT 'clickpath.analytai.in',
    "ownerId" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "role" "TeamRole" NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "email" VARCHAR(255),
    "role" "InviteRole" NOT NULL DEFAULT 'member',
    "token" VARCHAR(64) NOT NULL,
    "invitedBy" VARCHAR(32) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255),
    "email" VARCHAR(255),
    "emailVerified" TIMESTAMP(3),
    "password" VARCHAR(255),
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "qrCodeCount" INTEGER DEFAULT 0,
    "monthlyLinkCount" INTEGER DEFAULT 0,
    "lastLinkCountReset" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "monthlyEventCount" INTEGER DEFAULT 0,
    "lastEventCountReset" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "eventUsageAlertLevel" INTEGER DEFAULT 0,
    "lastViewedChangelogSlug" VARCHAR(100),
    "deletedAt" TIMESTAMP(3),
    "isAdmin" BOOLEAN DEFAULT false,
    "banned" BOOLEAN DEFAULT false,
    "bannedAt" TIMESTAMP(3),
    "bannedReason" VARCHAR(255),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" VARCHAR(32) NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "refresh_token_expires_in" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "stripeCustomerId" VARCHAR(255),
    "stripeSubscriptionId" VARCHAR(255),
    "stripePriceId" VARCHAR(255),
    "renewsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" VARCHAR(255) DEFAULT '',
    "plan" "SubscriptionPlan" DEFAULT 'free',
    "billingInterval" "BillingInterval" DEFAULT 'monthly',
    "cardBrand" VARCHAR(255) DEFAULT '',
    "cardLastFour" VARCHAR(4) DEFAULT '',

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255),
    "url" TEXT,
    "alias" VARCHAR(20),
    "domain" VARCHAR(255) NOT NULL DEFAULT 'clickpath.analytai.in',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "disableLinkAfterClicks" INTEGER,
    "disableLinkAfterDate" TIMESTAMP(3),
    "disabled" BOOLEAN DEFAULT false,
    "publicStats" BOOLEAN DEFAULT false,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "createdByUserId" VARCHAR(32),
    "passwordHash" TEXT,
    "note" VARCHAR(255),
    "metadata" JSONB,
    "utmParams" JSONB,
    "tags" JSONB DEFAULT '[]',
    "archived" BOOLEAN DEFAULT false,
    "folderId" INTEGER,
    "campaignId" INTEGER,
    "cloaking" BOOLEAN DEFAULT false,
    "verifiedClicksEnabled" BOOLEAN DEFAULT false,
    "isQrCode" BOOLEAN DEFAULT false,
    "isBioLink" BOOLEAN DEFAULT false,
    "blocked" BOOLEAN DEFAULT false,
    "blockedAt" TIMESTAMP(3),
    "blockedReason" VARCHAR(255),

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoRule" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "type" "GeoRuleType" NOT NULL,
    "condition" "GeoRuleCondition" NOT NULL DEFAULT 'in',
    "values" JSONB NOT NULL,
    "action" "GeoRuleAction" NOT NULL,
    "destination" VARCHAR(2048),
    "blockMessage" VARCHAR(500),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkVisit" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "device" VARCHAR(255),
    "browser" VARCHAR(255),
    "os" VARCHAR(255),
    "model" VARCHAR(255) DEFAULT '',
    "referer" VARCHAR(255),
    "country" VARCHAR(255),
    "city" VARCHAR(255),
    "continent" VARCHAR(255) DEFAULT 'N/A',
    "matchedGeoRuleId" INTEGER,
    "visitId" CHAR(36),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniqueLinkVisit" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "ipHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniqueLinkVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkVisitDailySummary" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "uniqueClicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LinkVisitDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkMilestone" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "threshold" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" SERIAL NOT NULL,
    "token" VARCHAR(255),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "userId" VARCHAR(32) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrCode" (
    "id" SERIAL NOT NULL,
    "qrCode" TEXT,
    "title" VARCHAR(255) DEFAULT '',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "linkId" INTEGER DEFAULT 0,
    "contentType" "QrContentType" NOT NULL,
    "content" TEXT NOT NULL,
    "patternStyle" "PatternStyle" NOT NULL,
    "cornerStyle" "CornerStyle" NOT NULL,
    "color" VARCHAR(9) NOT NULL,
    "lightColor" VARCHAR(9) DEFAULT '#ffffff',
    "logoImage" TEXT,
    "effect" VARCHAR(50) DEFAULT 'none',
    "marginNoise" BOOLEAN DEFAULT false,
    "markerInnerShape" VARCHAR(50) DEFAULT 'auto',

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrPreset" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "pixelStyle" VARCHAR(50) NOT NULL DEFAULT 'rounded',
    "markerShape" VARCHAR(50) NOT NULL DEFAULT 'square',
    "markerInnerShape" VARCHAR(50) NOT NULL DEFAULT 'auto',
    "darkColor" VARCHAR(9) NOT NULL DEFAULT '#000000',
    "lightColor" VARCHAR(9) NOT NULL DEFAULT '#ffffff',
    "effect" VARCHAR(50) NOT NULL DEFAULT 'none',
    "effectRadius" INTEGER NOT NULL DEFAULT 12,
    "marginNoise" BOOLEAN NOT NULL DEFAULT false,
    "marginNoiseRate" VARCHAR(10) NOT NULL DEFAULT '0.5',
    "logoImage" TEXT,
    "logoSize" INTEGER NOT NULL DEFAULT 25,
    "logoMargin" INTEGER NOT NULL DEFAULT 4,
    "logoBorderRadius" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "QrPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" SERIAL NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "defaultDomain" VARCHAR(255) DEFAULT 'clickpath.analytai.in',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderPermission" (
    "folderId" INTEGER NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderPermission_pkey" PRIMARY KEY ("folderId","userId")
);

-- CreateTable
CREATE TABLE "LinkTag" (
    "linkId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkTag_pkey" PRIMARY KEY ("linkId","tagId")
);

-- CreateTable
CREATE TABLE "BlockedDomain" (
    "id" SERIAL NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "reason" VARCHAR(255),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" VARCHAR(32),

    CONSTRAINT "BlockedDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlaggedLink" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "reason" VARCHAR(255),
    "reporterEmail" VARCHAR(320),
    "details" TEXT,
    "status" "FlagStatus" NOT NULL DEFAULT 'pending',
    "flaggedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" VARCHAR(32),

    CONSTRAINT "FlaggedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomDomain" (
    "id" SERIAL NOT NULL,
    "domain" VARCHAR(255),
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "status" "DomainStatus" DEFAULT 'pending',
    "verificationDetails" JSONB,
    "lastReminderSentAt" TIMESTAMP(3),

    CONSTRAINT "CustomDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtmTemplate" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "utmSource" VARCHAR(255),
    "utmMedium" VARCHAR(255),
    "utmCampaign" VARCHAR(255),
    "utmTerm" VARCHAR(255),
    "utmContent" VARCHAR(255),
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "UtmTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'active',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "utmSource" VARCHAR(255),
    "utmMedium" VARCHAR(255),
    "utmTerm" VARCHAR(255),
    "utmContent" VARCHAR(255),
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "createdByUserId" VARCHAR(32),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountTransfer" (
    "id" SERIAL NOT NULL,
    "fromUserId" VARCHAR(32) NOT NULL,
    "toEmail" VARCHAR(255) NOT NULL,
    "toUserId" VARCHAR(32),
    "token" VARCHAR(64) NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'pending',
    "linksCount" INTEGER NOT NULL DEFAULT 0,
    "customDomainsCount" INTEGER NOT NULL DEFAULT 0,
    "qrCodesCount" INTEGER NOT NULL DEFAULT 0,
    "foldersCount" INTEGER NOT NULL DEFAULT 0,
    "tagsCount" INTEGER NOT NULL DEFAULT 0,
    "utmTemplatesCount" INTEGER NOT NULL DEFAULT 0,
    "qrPresetsCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" SERIAL NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "message" TEXT NOT NULL,
    "imageUrls" JSONB DEFAULT '[]',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceFeedback" (
    "id" SERIAL NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "role" VARCHAR(64),
    "useCase" VARCHAR(64),
    "monthlyVolume" VARCHAR(64),
    "acquisitionChannel" VARCHAR(64),
    "acquisitionDetail" TEXT,
    "priorTool" VARCHAR(64),
    "switchReason" TEXT,
    "magicFeature" VARCHAR(64),
    "upgradeReason" VARCHAR(64),
    "upgradeBlocker" TEXT,
    "improvementWish" TEXT,
    "planSnapshot" "PlanSnapshot",
    "submittedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dismissCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "AudienceFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioPage" (
    "id" SERIAL NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "createdByUserId" VARCHAR(32),
    "slug" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255),
    "description" TEXT,
    "avatarUrl" TEXT,
    "theme" JSONB,
    "socialImageUrl" TEXT,
    "seoTitle" VARCHAR(255),
    "seoDescription" VARCHAR(500),
    "customDomain" VARCHAR(255),
    "removeBranding" BOOLEAN DEFAULT false,
    "isPublished" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "BioPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioBlock" (
    "id" SERIAL NOT NULL,
    "bioPageId" INTEGER NOT NULL,
    "type" "BioBlockType" NOT NULL,
    "title" VARCHAR(255),
    "content" TEXT,
    "url" TEXT,
    "linkId" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "scheduledAt" TIMESTAMP(3),
    "scheduledUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "BioBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioPageView" (
    "id" SERIAL NOT NULL,
    "bioPageId" INTEGER NOT NULL,
    "device" VARCHAR(255),
    "browser" VARCHAR(255),
    "os" VARCHAR(255),
    "model" VARCHAR(255) DEFAULT '',
    "referer" VARCHAR(255),
    "country" VARCHAR(255),
    "city" VARCHAR(255),
    "continent" VARCHAR(255) DEFAULT 'N/A',
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioPageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniqueBioPageView" (
    "id" SERIAL NOT NULL,
    "bioPageId" INTEGER NOT NULL,
    "ipHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniqueBioPageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BioPageViewDailySummary" (
    "id" SERIAL NOT NULL,
    "bioPageId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "uniqueViews" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BioPageViewDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrLogoAsset" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "name" VARCHAR(255),
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrLogoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_ownerId_idx" ON "Team"("ownerId");

-- CreateIndex
CREATE INDEX "Team_deletedAt_idx" ON "Team"("deletedAt");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_userId_idx" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE INDEX "TeamInvite_teamId_idx" ON "TeamInvite"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Link_userId_idx" ON "Link"("userId");

-- CreateIndex
CREATE INDEX "Link_teamId_idx" ON "Link"("teamId");

-- CreateIndex
CREATE INDEX "Link_alias_domain_idx" ON "Link"("alias", "domain");

-- CreateIndex
CREATE INDEX "Link_folderId_idx" ON "Link"("folderId");

-- CreateIndex
CREATE INDEX "Link_campaignId_idx" ON "Link"("campaignId");

-- CreateIndex
CREATE INDEX "Link_createdAt_idx" ON "Link"("createdAt");

-- CreateIndex
CREATE INDEX "Link_blocked_blockedAt_idx" ON "Link"("blocked", "blockedAt");

-- CreateIndex
CREATE INDEX "Link_domain_idx" ON "Link"("domain");

-- CreateIndex
CREATE INDEX "Link_userId_teamId_isQrCode_archived_idx" ON "Link"("userId", "teamId", "isQrCode", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "Link_alias_domain_key" ON "Link"("alias", "domain");

-- CreateIndex
CREATE INDEX "GeoRule_linkId_idx" ON "GeoRule"("linkId");

-- CreateIndex
CREATE INDEX "GeoRule_linkId_priority_idx" ON "GeoRule"("linkId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "LinkVisit_visitId_key" ON "LinkVisit"("visitId");

-- CreateIndex
CREATE INDEX "LinkVisit_linkId_idx" ON "LinkVisit"("linkId");

-- CreateIndex
CREATE INDEX "LinkVisit_matchedGeoRuleId_idx" ON "LinkVisit"("matchedGeoRuleId");

-- CreateIndex
CREATE INDEX "LinkVisit_linkId_createdAt_idx" ON "LinkVisit"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "LinkVisit_createdAt_idx" ON "LinkVisit"("createdAt");

-- CreateIndex
CREATE INDEX "UniqueLinkVisit_linkId_idx" ON "UniqueLinkVisit"("linkId");

-- CreateIndex
CREATE INDEX "UniqueLinkVisit_ipHash_idx" ON "UniqueLinkVisit"("ipHash");

-- CreateIndex
CREATE INDEX "UniqueLinkVisit_linkId_createdAt_idx" ON "UniqueLinkVisit"("linkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UniqueLinkVisit_linkId_ipHash_key" ON "UniqueLinkVisit"("linkId", "ipHash");

-- CreateIndex
CREATE UNIQUE INDEX "LinkVisitDailySummary_linkId_date_key" ON "LinkVisitDailySummary"("linkId", "date");

-- CreateIndex
CREATE INDEX "LinkMilestone_linkId_idx" ON "LinkMilestone"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkMilestone_linkId_threshold_key" ON "LinkMilestone"("linkId", "threshold");

-- CreateIndex
CREATE INDEX "Token_userId_idx" ON "Token"("userId");

-- CreateIndex
CREATE INDEX "Token_token_idx" ON "Token"("token");

-- CreateIndex
CREATE INDEX "QrCode_userId_idx" ON "QrCode"("userId");

-- CreateIndex
CREATE INDEX "QrCode_teamId_idx" ON "QrCode"("teamId");

-- CreateIndex
CREATE INDEX "QrCode_linkId_idx" ON "QrCode"("linkId");

-- CreateIndex
CREATE INDEX "QrPreset_userId_idx" ON "QrPreset"("userId");

-- CreateIndex
CREATE INDEX "QrPreset_teamId_idx" ON "QrPreset"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSettings_userId_key" ON "SiteSettings"("userId");

-- CreateIndex
CREATE INDEX "SiteSettings_teamId_idx" ON "SiteSettings"("teamId");

-- CreateIndex
CREATE INDEX "Tag_name_idx" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Tag_userId_idx" ON "Tag"("userId");

-- CreateIndex
CREATE INDEX "Tag_teamId_idx" ON "Tag"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_teamId_key" ON "Tag"("name", "teamId");

-- CreateIndex
CREATE INDEX "Folder_userId_idx" ON "Folder"("userId");

-- CreateIndex
CREATE INDEX "Folder_teamId_idx" ON "Folder"("teamId");

-- CreateIndex
CREATE INDEX "FolderPermission_userId_idx" ON "FolderPermission"("userId");

-- CreateIndex
CREATE INDEX "LinkTag_tagId_idx" ON "LinkTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedDomain_domain_key" ON "BlockedDomain"("domain");

-- CreateIndex
CREATE INDEX "FlaggedLink_linkId_idx" ON "FlaggedLink"("linkId");

-- CreateIndex
CREATE INDEX "FlaggedLink_status_idx" ON "FlaggedLink"("status");

-- CreateIndex
CREATE INDEX "CustomDomain_userId_idx" ON "CustomDomain"("userId");

-- CreateIndex
CREATE INDEX "CustomDomain_teamId_idx" ON "CustomDomain"("teamId");

-- CreateIndex
CREATE INDEX "CustomDomain_status_createdAt_idx" ON "CustomDomain"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomDomain_domain_userId_teamId_key" ON "CustomDomain"("domain", "userId", "teamId");

-- CreateIndex
CREATE INDEX "UtmTemplate_userId_idx" ON "UtmTemplate"("userId");

-- CreateIndex
CREATE INDEX "UtmTemplate_teamId_idx" ON "UtmTemplate"("teamId");

-- CreateIndex
CREATE INDEX "Campaign_userId_idx" ON "Campaign"("userId");

-- CreateIndex
CREATE INDEX "Campaign_teamId_idx" ON "Campaign"("teamId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_userId_teamId_key" ON "Campaign"("slug", "userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountTransfer_token_key" ON "AccountTransfer"("token");

-- CreateIndex
CREATE INDEX "AccountTransfer_fromUserId_idx" ON "AccountTransfer"("fromUserId");

-- CreateIndex
CREATE INDEX "AccountTransfer_toEmail_idx" ON "AccountTransfer"("toEmail");

-- CreateIndex
CREATE INDEX "AccountTransfer_status_idx" ON "AccountTransfer"("status");

-- CreateIndex
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceFeedback_userId_key" ON "AudienceFeedback"("userId");

-- CreateIndex
CREATE INDEX "AudienceFeedback_userId_idx" ON "AudienceFeedback"("userId");

-- CreateIndex
CREATE INDEX "AudienceFeedback_submittedAt_idx" ON "AudienceFeedback"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_slug_key" ON "BioPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BioPage_customDomain_key" ON "BioPage"("customDomain");

-- CreateIndex
CREATE INDEX "BioPage_userId_idx" ON "BioPage"("userId");

-- CreateIndex
CREATE INDEX "BioPage_teamId_idx" ON "BioPage"("teamId");

-- CreateIndex
CREATE INDEX "BioPage_isPublished_idx" ON "BioPage"("isPublished");

-- CreateIndex
CREATE INDEX "BioBlock_bioPageId_idx" ON "BioBlock"("bioPageId");

-- CreateIndex
CREATE INDEX "BioBlock_bioPageId_position_idx" ON "BioBlock"("bioPageId", "position");

-- CreateIndex
CREATE INDEX "BioBlock_linkId_idx" ON "BioBlock"("linkId");

-- CreateIndex
CREATE INDEX "BioPageView_bioPageId_idx" ON "BioPageView"("bioPageId");

-- CreateIndex
CREATE INDEX "BioPageView_bioPageId_createdAt_idx" ON "BioPageView"("bioPageId", "createdAt");

-- CreateIndex
CREATE INDEX "BioPageView_createdAt_idx" ON "BioPageView"("createdAt");

-- CreateIndex
CREATE INDEX "UniqueBioPageView_bioPageId_idx" ON "UniqueBioPageView"("bioPageId");

-- CreateIndex
CREATE INDEX "UniqueBioPageView_bioPageId_createdAt_idx" ON "UniqueBioPageView"("bioPageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UniqueBioPageView_bioPageId_ipHash_key" ON "UniqueBioPageView"("bioPageId", "ipHash");

-- CreateIndex
CREATE UNIQUE INDEX "BioPageViewDailySummary_bioPageId_date_key" ON "BioPageViewDailySummary"("bioPageId", "date");

-- CreateIndex
CREATE INDEX "QrLogoAsset_userId_idx" ON "QrLogoAsset"("userId");

-- CreateIndex
CREATE INDEX "QrLogoAsset_teamId_idx" ON "QrLogoAsset"("teamId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoRule" ADD CONSTRAINT "GeoRule_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkVisit" ADD CONSTRAINT "LinkVisit_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkVisit" ADD CONSTRAINT "LinkVisit_matchedGeoRuleId_fkey" FOREIGN KEY ("matchedGeoRuleId") REFERENCES "GeoRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniqueLinkVisit" ADD CONSTRAINT "UniqueLinkVisit_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkVisitDailySummary" ADD CONSTRAINT "LinkVisitDailySummary_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkMilestone" ADD CONSTRAINT "LinkMilestone_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrPreset" ADD CONSTRAINT "QrPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrPreset" ADD CONSTRAINT "QrPreset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderPermission" ADD CONSTRAINT "FolderPermission_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderPermission" ADD CONSTRAINT "FolderPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkTag" ADD CONSTRAINT "LinkTag_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkTag" ADD CONSTRAINT "LinkTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedDomain" ADD CONSTRAINT "BlockedDomain_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlaggedLink" ADD CONSTRAINT "FlaggedLink_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlaggedLink" ADD CONSTRAINT "FlaggedLink_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtmTemplate" ADD CONSTRAINT "UtmTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtmTemplate" ADD CONSTRAINT "UtmTemplate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceFeedback" ADD CONSTRAINT "AudienceFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioBlock" ADD CONSTRAINT "BioBlock_bioPageId_fkey" FOREIGN KEY ("bioPageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioBlock" ADD CONSTRAINT "BioBlock_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPageViewDailySummary" ADD CONSTRAINT "BioPageViewDailySummary_bioPageId_fkey" FOREIGN KEY ("bioPageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrLogoAsset" ADD CONSTRAINT "QrLogoAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrLogoAsset" ADD CONSTRAINT "QrLogoAsset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
