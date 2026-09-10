-- Dossier de contrôle, justificatifs typés, documents verrouillés.
--
-- Prisma a de nouveau proposé de supprimer les index GiST (colonnes
-- `Unsupported("geometry(...)")`, créées en SQL brut). Ces DROP ont été retirés
-- à la main. `tests/migrations.test.ts` le vérifie.

-- CreateEnum
CREATE TYPE "CampaignDocumentKind" AS ENUM ('REGISTRE_PHYTO', 'CAHIER_EPANDAGE', 'CEP', 'PPF', 'DOSSIER_CONTROLE');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "campaign_year" INTEGER,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "valid_from" TIMESTAMP(3),
ADD COLUMN     "valid_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "campaign_documents" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "campaign_year" INTEGER NOT NULL,
    "kind" "CampaignDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "gaps" TEXT,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_by_id" TEXT,
    "notes" TEXT,

    CONSTRAINT "campaign_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_documents_farm_id_campaign_year_idx" ON "campaign_documents"("farm_id", "campaign_year");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_documents_farm_id_campaign_year_kind_version_key" ON "campaign_documents"("farm_id", "campaign_year", "kind", "version");

-- AddForeignKey
ALTER TABLE "campaign_documents" ADD CONSTRAINT "campaign_documents_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_documents" ADD CONSTRAINT "campaign_documents_locked_by_id_fkey" FOREIGN KEY ("locked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

