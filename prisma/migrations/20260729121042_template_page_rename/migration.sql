/*
  Warnings:

  - You are about to drop the `BioPage` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('bio', 'pharma_product');

-- DropForeignKey
ALTER TABLE "BioBlock" DROP CONSTRAINT "BioBlock_bioPageId_fkey";

-- DropForeignKey inside BioPage removed because we are renaming it instead of dropping it

-- DropForeignKey
ALTER TABLE "BioPageViewDailySummary" DROP CONSTRAINT "BioPageViewDailySummary_bioPageId_fkey";

-- RenameTable
ALTER TABLE "BioPage" RENAME TO "TemplatePage";

-- RenamePrimaryKey
ALTER TABLE "TemplatePage" RENAME CONSTRAINT "BioPage_pkey" TO "TemplatePage_pkey";

-- RenameIndexes
ALTER INDEX "BioPage_slug_key" RENAME TO "TemplatePage_slug_key";
ALTER INDEX "BioPage_customDomain_key" RENAME TO "TemplatePage_customDomain_key";
ALTER INDEX "BioPage_userId_idx" RENAME TO "TemplatePage_userId_idx";
ALTER INDEX "BioPage_teamId_idx" RENAME TO "TemplatePage_teamId_idx";
ALTER INDEX "BioPage_isPublished_idx" RENAME TO "TemplatePage_isPublished_idx";

-- AddColumns
ALTER TABLE "TemplatePage" 
ADD COLUMN "templateType" "TemplateType" NOT NULL DEFAULT 'bio',
ADD COLUMN "templateData" JSONB;

-- CreateIndex
CREATE INDEX "TemplatePage_templateType_idx" ON "TemplatePage"("templateType");

-- RenameForeignKey
ALTER TABLE "TemplatePage" RENAME CONSTRAINT "BioPage_userId_fkey" TO "TemplatePage_userId_fkey";

-- RenameForeignKey
ALTER TABLE "TemplatePage" RENAME CONSTRAINT "BioPage_teamId_fkey" TO "TemplatePage_teamId_fkey";

-- AddForeignKey
ALTER TABLE "BioBlock" ADD CONSTRAINT "BioBlock_bioPageId_fkey" FOREIGN KEY ("bioPageId") REFERENCES "TemplatePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BioPageViewDailySummary" ADD CONSTRAINT "BioPageViewDailySummary_bioPageId_fkey" FOREIGN KEY ("bioPageId") REFERENCES "TemplatePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
