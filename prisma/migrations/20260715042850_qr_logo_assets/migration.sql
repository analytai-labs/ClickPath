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
CREATE INDEX "QrLogoAsset_userId_idx" ON "QrLogoAsset"("userId");

-- CreateIndex
CREATE INDEX "QrLogoAsset_teamId_idx" ON "QrLogoAsset"("teamId");

-- AddForeignKey
ALTER TABLE "QrLogoAsset" ADD CONSTRAINT "QrLogoAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrLogoAsset" ADD CONSTRAINT "QrLogoAsset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
