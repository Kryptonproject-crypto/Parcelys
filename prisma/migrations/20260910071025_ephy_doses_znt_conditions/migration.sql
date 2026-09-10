-- Les index GiST (`*_geom_gist`) sont créés en SQL brut, hors du modèle Prisma
-- qui ne connaît pas les colonnes PostGIS : chaque migration générée propose de
-- les supprimer. On retire ces trois lignes — cf. tests/migrations.test.ts.

-- AlterTable
ALTER TABLE "parcels" ADD COLUMN     "drained_soil" BOOLEAN;

-- AlterTable
ALTER TABLE "phyto_usages" ADD COLUMN     "bbch_max" TEXT,
ADD COLUMN     "bbch_min" TEXT,
ADD COLUMN     "crop_normalized" TEXT,
ADD COLUMN     "end_distribution_at" TIMESTAMP(3),
ADD COLUMN     "end_usage_at" TIMESTAMP(3),
ADD COLUMN     "min_interval_days" TEXT,
ADD COLUMN     "pre_harvest_bbch" TEXT,
ADD COLUMN     "znt_arthropod_m" TEXT,
ADD COLUMN     "znt_plant_m" TEXT;

-- CreateTable
CREATE TABLE "phyto_conditions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "concerns_drained_soil" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "phyto_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phyto_conditions_product_id_idx" ON "phyto_conditions"("product_id");

-- CreateIndex
CREATE INDEX "phyto_conditions_product_id_concerns_drained_soil_idx" ON "phyto_conditions"("product_id", "concerns_drained_soil");

-- CreateIndex
CREATE INDEX "phyto_usages_product_id_crop_normalized_idx" ON "phyto_usages"("product_id", "crop_normalized");

-- AddForeignKey
ALTER TABLE "phyto_conditions" ADD CONSTRAINT "phyto_conditions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "phytosanitary_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
