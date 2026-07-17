/*
  Warnings:

  - You are about to drop the column `customerId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `productId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `variantId` on the `Subscription` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CornerStyle" ADD VALUE 'plus';
ALTER TYPE "CornerStyle" ADD VALUE 'box';
ALTER TYPE "CornerStyle" ADD VALUE 'octagon';
ALTER TYPE "CornerStyle" ADD VALUE 'random';
ALTER TYPE "CornerStyle" ADD VALUE 'tiny-plus';
ALTER TYPE "CornerStyle" ADD VALUE 'auto';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PatternStyle" ADD VALUE 'dot';
ALTER TYPE "PatternStyle" ADD VALUE 'squircle';
ALTER TYPE "PatternStyle" ADD VALUE 'row';
ALTER TYPE "PatternStyle" ADD VALUE 'column';

-- DropForeignKey
ALTER TABLE "BioBlock" DROP CONSTRAINT "BioBlock_bioPageId_fkey";

-- DropForeignKey
ALTER TABLE "BioBlock" DROP CONSTRAINT "BioBlock_linkId_fkey";

-- DropForeignKey
ALTER TABLE "BioPage" DROP CONSTRAINT "BioPage_teamId_fkey";

-- DropForeignKey
ALTER TABLE "BioPageViewDailySummary" DROP CONSTRAINT "BioPageViewDailySummary_bioPageId_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_teamId_fkey";

-- DropForeignKey
ALTER TABLE "CustomDomain" DROP CONSTRAINT "CustomDomain_teamId_fkey";

-- DropForeignKey
ALTER TABLE "FlaggedLink" DROP CONSTRAINT "FlaggedLink_linkId_fkey";

-- DropForeignKey
ALTER TABLE "Folder" DROP CONSTRAINT "Folder_teamId_fkey";

-- DropForeignKey
ALTER TABLE "FolderPermission" DROP CONSTRAINT "FolderPermission_folderId_fkey";

-- DropForeignKey
ALTER TABLE "GeoRule" DROP CONSTRAINT "GeoRule_linkId_fkey";

-- DropForeignKey
ALTER TABLE "Link" DROP CONSTRAINT "Link_teamId_fkey";

-- DropForeignKey
ALTER TABLE "LinkMilestone" DROP CONSTRAINT "LinkMilestone_linkId_fkey";

-- DropForeignKey
ALTER TABLE "LinkTag" DROP CONSTRAINT "LinkTag_linkId_fkey";

-- DropForeignKey
ALTER TABLE "LinkVisit" DROP CONSTRAINT "LinkVisit_linkId_fkey";

-- DropForeignKey
ALTER TABLE "LinkVisitDailySummary" DROP CONSTRAINT "LinkVisitDailySummary_linkId_fkey";

-- DropForeignKey
ALTER TABLE "QrCode" DROP CONSTRAINT "QrCode_linkId_fkey";

-- DropForeignKey
ALTER TABLE "QrCode" DROP CONSTRAINT "QrCode_teamId_fkey";

-- DropForeignKey
ALTER TABLE "QrPreset" DROP CONSTRAINT "QrPreset_teamId_fkey";

-- DropForeignKey
ALTER TABLE "SiteSettings" DROP CONSTRAINT "SiteSettings_teamId_fkey";

-- DropForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TeamInvite" DROP CONSTRAINT "TeamInvite_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

-- DropForeignKey
ALTER TABLE "UniqueLinkVisit" DROP CONSTRAINT "UniqueLinkVisit_linkId_fkey";

-- DropForeignKey
ALTER TABLE "UtmTemplate" DROP CONSTRAINT "UtmTemplate_teamId_fkey";

-- AlterTable
ALTER TABLE "QrCode" ADD COLUMN     "effect" VARCHAR(50) DEFAULT 'none',
ADD COLUMN     "lightColor" VARCHAR(9) DEFAULT '#ffffff',
ADD COLUMN     "logoImage" TEXT,
ADD COLUMN     "marginNoise" BOOLEAN DEFAULT false,
ADD COLUMN     "markerInnerShape" VARCHAR(50) DEFAULT 'auto',
ALTER COLUMN "color" SET DATA TYPE VARCHAR(9);

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "customerId",
DROP COLUMN "orderId",
DROP COLUMN "productId",
DROP COLUMN "subscriptionId",
DROP COLUMN "variantId",
ADD COLUMN     "stripeCustomerId" VARCHAR(255),
ADD COLUMN     "stripePriceId" VARCHAR(255),
ADD COLUMN     "stripeSubscriptionId" VARCHAR(255);

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoRule" ADD CONSTRAINT "GeoRule_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkVisit" ADD CONSTRAINT "LinkVisit_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniqueLinkVisit" ADD CONSTRAINT "UniqueLinkVisit_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkVisitDailySummary" ADD CONSTRAINT "LinkVisitDailySummary_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkMilestone" ADD CONSTRAINT "LinkMilestone_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrPreset" ADD CONSTRAINT "QrPreset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderPermission" ADD CONSTRAINT "FolderPermission_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkTag" ADD CONSTRAINT "LinkTag_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlaggedLink" ADD CONSTRAINT "FlaggedLink_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtmTemplate" ADD CONSTRAINT "UtmTemplate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPage" ADD CONSTRAINT "BioPage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioBlock" ADD CONSTRAINT "BioBlock_bioPageId_fkey" FOREIGN KEY ("bioPageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioBlock" ADD CONSTRAINT "BioBlock_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPageViewDailySummary" ADD CONSTRAINT "BioPageViewDailySummary_bioPageId_fkey" FOREIGN KEY ("bioPageId") REFERENCES "BioPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
