-- Serve every template page of a workspace from a domain the customer owns
-- (https://<shareDomain>/p/<slug>), so pages and printed QR codes survive the
-- platform domain changing. Deliberately NOT unique: one domain serves many
-- pages. `customDomain` keeps its existing meaning (this domain's root shows
-- this one page) and stays unique.
ALTER TABLE "TemplatePage" ADD COLUMN "shareDomain" VARCHAR(255);

-- Persisted QR designer state for the page's QR code.
ALTER TABLE "TemplatePage" ADD COLUMN "qrDesign" JSONB;

-- A page already bound to a domain root should keep that domain as the host its
-- public URL and QR code are built from.
UPDATE "TemplatePage" SET "shareDomain" = "customDomain" WHERE "customDomain" IS NOT NULL;

-- CreateIndex
CREATE INDEX "TemplatePage_shareDomain_idx" ON "TemplatePage"("shareDomain");
