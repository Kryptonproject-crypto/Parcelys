-- Couverture des sols en interculture, et irrigation comme événement.
--
-- Prisma a de nouveau proposé de supprimer les index GiST : il ne peut pas les
-- connaître (colonnes `Unsupported("geometry(...)")`, créées en SQL brut). Ces
-- DROP ont été retirés à la main. `tests/migrations.test.ts` le vérifie.

-- CreateEnum
CREATE TYPE "SoilCoverKind" AS ENUM ('CIPAN', 'DEROBEE', 'REPOUSSES', 'RESIDUS', 'COUVERT_PERMANENT', 'AUTRE');

-- CreateEnum
CREATE TYPE "CoverDestructionMethod" AS ENUM ('MECANIQUE', 'GEL', 'PATURAGE', 'ROULAGE', 'BROYAGE', 'CHIMIQUE', 'RECOLTE', 'AUTRE');

-- AlterTable
ALTER TABLE "agricultural_operations" ADD COLUMN     "irrigation_mm" DECIMAL(8,2),
ADD COLUMN     "irrigation_volume_m3_ha" DECIMAL(10,2),
ADD COLUMN     "water_analysis_doc_id" TEXT,
ADD COLUMN     "water_analysis_on" TIMESTAMP(3),
ADD COLUMN     "water_nitrate_mg_l" DECIMAL(8,2),
ADD COLUMN     "water_source" TEXT;

-- CreateTable
CREATE TABLE "soil_covers" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "crop_year_id" TEXT,
    "kind" "SoilCoverKind" NOT NULL,
    "species" TEXT,
    "sown_on" TIMESTAMP(3),
    "emerged_on" TIMESTAMP(3),
    "destroyed_on" TIMESTAMP(3),
    "destruction_method" "CoverDestructionMethod",
    "area_ha" DECIMAL(12,4),
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soil_covers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soil_covers_parcel_id_sown_on_idx" ON "soil_covers"("parcel_id", "sown_on");

-- CreateIndex
CREATE INDEX "soil_covers_crop_year_id_idx" ON "soil_covers"("crop_year_id");

-- AddForeignKey
ALTER TABLE "agricultural_operations" ADD CONSTRAINT "agricultural_operations_water_analysis_doc_id_fkey" FOREIGN KEY ("water_analysis_doc_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soil_covers" ADD CONSTRAINT "soil_covers_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soil_covers" ADD CONSTRAINT "soil_covers_crop_year_id_fkey" FOREIGN KEY ("crop_year_id") REFERENCES "crop_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soil_covers" ADD CONSTRAINT "soil_covers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

