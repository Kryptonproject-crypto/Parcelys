-- CreateEnum
CREATE TYPE "PacFeatureKind" AS ENUM ('PARCELLE', 'SNA', 'ZDH', 'AUTRE');

-- CreateEnum
CREATE TYPE "PacImportStatus" AS ENUM ('ANALYZED', 'APPLIED', 'FAILED', 'CANCELLED');

-- Prisma proposait ici « DROP INDEX parcel_geometries_geom_gist ». Cet index
-- GiST est créé en SQL brut par la migration initiale, hors du modèle Prisma,
-- qui ne le connaît donc pas et le croit superflu. Le supprimer priverait
-- d'index spatial toutes les géométries de parcelles existantes — chaque
-- affichage de carte repasserait en parcours séquentiel. On le garde.

-- CreateTable
CREATE TABLE "pac_campaigns" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "referential_version" TEXT,
    "last_import_at" TIMESTAMP(3),
    "last_export_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pac_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pac_ilots" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "geom" geometry(MultiPolygon, 4326),
    "area_ha" DECIMAL(12,4),
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pac_ilots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pac_features" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ilot_id" TEXT,
    "parcel_id" TEXT,
    "kind" "PacFeatureKind" NOT NULL DEFAULT 'PARCELLE',
    "external_id" TEXT,
    "numero" TEXT,
    "crop_code" TEXT,
    "crop_label" TEXT,
    "geom" geometry(MultiPolygon, 4326),
    "area_ha" DECIMAL(12,4),
    "source_wkt" TEXT,
    "source_srid" INTEGER,
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pac_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pac_imports" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "status" "PacImportStatus" NOT NULL DEFAULT 'ANALYZED',
    "source_files" JSONB,
    "detected_srid" INTEGER,
    "src_label" TEXT,
    "feature_count" INTEGER NOT NULL DEFAULT 0,
    "ilot_count" INTEGER NOT NULL DEFAULT 0,
    "area_ha" DECIMAL(12,4),
    "report" JSONB,
    "snapshot_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "pac_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pac_snapshots" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parcel_count" INTEGER NOT NULL DEFAULT 0,
    "area_ha" DECIMAL(12,4),
    "payload" JSONB NOT NULL,
    "restored_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pac_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pac_changes" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "feature_id" TEXT,
    "parcel_id" TEXT,
    "user_id" TEXT,
    "change_type" TEXT NOT NULL,
    "previous_geojson" JSONB,
    "new_geojson" JSONB,
    "previous_area_ha" DECIMAL(12,4),
    "new_area_ha" DECIMAL(12,4),
    "previous_crop" TEXT,
    "new_crop" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pac_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pac_crop_codes" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group_code" TEXT,
    "group_label" TEXT,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pac_crop_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pac_campaigns_farm_id_idx" ON "pac_campaigns"("farm_id");

-- CreateIndex
CREATE UNIQUE INDEX "pac_campaigns_farm_id_year_key" ON "pac_campaigns"("farm_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "pac_ilots_campaign_id_numero_key" ON "pac_ilots"("campaign_id", "numero");

-- CreateIndex
CREATE INDEX "pac_features_campaign_id_kind_idx" ON "pac_features"("campaign_id", "kind");

-- CreateIndex
CREATE INDEX "pac_features_parcel_id_idx" ON "pac_features"("parcel_id");

-- CreateIndex
CREATE INDEX "pac_imports_campaign_id_created_at_idx" ON "pac_imports"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "pac_snapshots_campaign_id_created_at_idx" ON "pac_snapshots"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "pac_changes_campaign_id_created_at_idx" ON "pac_changes"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "pac_changes_parcel_id_idx" ON "pac_changes"("parcel_id");

-- CreateIndex
CREATE INDEX "pac_crop_codes_year_code_idx" ON "pac_crop_codes"("year", "code");

-- CreateIndex
CREATE UNIQUE INDEX "pac_crop_codes_year_version_code_key" ON "pac_crop_codes"("year", "version", "code");

-- AddForeignKey
ALTER TABLE "pac_campaigns" ADD CONSTRAINT "pac_campaigns_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_ilots" ADD CONSTRAINT "pac_ilots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "pac_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_features" ADD CONSTRAINT "pac_features_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "pac_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_features" ADD CONSTRAINT "pac_features_ilot_id_fkey" FOREIGN KEY ("ilot_id") REFERENCES "pac_ilots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_features" ADD CONSTRAINT "pac_features_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_imports" ADD CONSTRAINT "pac_imports_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "pac_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_imports" ADD CONSTRAINT "pac_imports_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "pac_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_imports" ADD CONSTRAINT "pac_imports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_snapshots" ADD CONSTRAINT "pac_snapshots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "pac_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_snapshots" ADD CONSTRAINT "pac_snapshots_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_changes" ADD CONSTRAINT "pac_changes_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "pac_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_changes" ADD CONSTRAINT "pac_changes_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "pac_features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_changes" ADD CONSTRAINT "pac_changes_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pac_changes" ADD CONSTRAINT "pac_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index spatiaux des nouvelles géométries. Comme pour parcel_geometries, ils
-- sont créés en SQL : Prisma ne sait pas déclarer un index GiST.
CREATE INDEX "pac_ilots_geom_gist" ON "pac_ilots" USING GIST ("geom");
CREATE INDEX "pac_features_geom_gist" ON "pac_features" USING GIST ("geom");
