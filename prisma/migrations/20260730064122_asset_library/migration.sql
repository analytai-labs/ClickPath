-- Replaces the QR-only logo library with a general workspace asset library.
-- Existing QrLogoAsset rows are carried over as library assets at the root
-- folder, so every logo already in use keeps working and stays selectable.

-- CreateTable
CREATE TABLE "AssetFolder" (
    "id" SERIAL NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "parentId" INTEGER,
    "name" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" SERIAL NOT NULL,
    "userId" VARCHAR(32) NOT NULL,
    "teamId" INTEGER,
    "folderId" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "storageKey" VARCHAR(1024),
    "mimeType" VARCHAR(100),
    "byteSize" INTEGER,
    "checksum" CHAR(64),
    "library" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetFolder_userId_teamId_idx" ON "AssetFolder"("userId", "teamId");

-- CreateIndex
CREATE INDEX "AssetFolder_teamId_idx" ON "AssetFolder"("teamId");

-- CreateIndex
CREATE INDEX "AssetFolder_parentId_idx" ON "AssetFolder"("parentId");

-- CreateIndex
CREATE INDEX "Asset_userId_teamId_idx" ON "Asset"("userId", "teamId");

-- CreateIndex
CREATE INDEX "Asset_teamId_idx" ON "Asset"("teamId");

-- CreateIndex
CREATE INDEX "Asset_folderId_idx" ON "Asset"("folderId");

-- CreateIndex
CREATE INDEX "Asset_url_idx" ON "Asset"("url");

-- CreateIndex
CREATE INDEX "Asset_checksum_idx" ON "Asset"("checksum");

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AssetFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: carry every saved QR logo into the new library. `storageKey` stays
-- NULL — deletes fall back to deriving the key from the URL, as they did before.
INSERT INTO "Asset" ("userId", "teamId", "folderId", "name", "url", "library", "createdAt")
SELECT
    "userId",
    "teamId",
    NULL,
    COALESCE(NULLIF(TRIM("name"), ''), 'Logo'),
    LEFT("url", 1024),
    true,
    COALESCE("createdAt", CURRENT_TIMESTAMP)
FROM "QrLogoAsset"
WHERE LENGTH("url") <= 1024;

-- DropForeignKey
ALTER TABLE "QrLogoAsset" DROP CONSTRAINT "QrLogoAsset_teamId_fkey";

-- DropForeignKey
ALTER TABLE "QrLogoAsset" DROP CONSTRAINT "QrLogoAsset_userId_fkey";

-- DropTable
DROP TABLE "QrLogoAsset";
