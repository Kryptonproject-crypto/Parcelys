-- CreateEnum
CREATE TYPE "RegulatoryDomain" AS ENUM ('ZONAGE', 'NITRATES', 'GREN', 'IFT', 'PHYTO', 'PAC', 'COUVERTURE');

-- CreateEnum
CREATE TYPE "ReferentialStatus" AS ENUM ('NON_CONFIGURE', 'IMPORT_EN_COURS', 'ACTIF', 'REMPLACE', 'ECHEC');

-- CreateEnum
CREATE TYPE "ZoneKind" AS ENUM ('ZONE_VULNERABLE', 'ZONE_ACTION_RENFORCEE', 'CAPTAGE', 'AIRE_ALIMENTATION_CAPTAGE', 'COURS_EAU', 'ZONE_ENVIRONNEMENTALE', 'AUTRE');

-- CreateEnum
CREATE TYPE "FindingLevel" AS ENUM ('OK', 'INDETERMINE', 'VERIFICATION', 'ANOMALIE');

-- Les index GiST (`*_geom_gist`) sont créés en SQL brut, hors du modèle Prisma
-- qui ne connaît pas les colonnes PostGIS : chaque migration générée propose de
-- les supprimer. On retire ces trois lignes — cf. tests/migrations.test.ts.

-- CreateTable
CREATE TABLE "regulatory_referentials" (
    "id" TEXT NOT NULL,
    "domain" "RegulatoryDomain" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "territory" TEXT,
    "version" TEXT NOT NULL,
    "source_label" TEXT NOT NULL,
    "source_url" TEXT,
    "checksum" TEXT,
    "published_at" TIMESTAMP(3),
    "applies_from" TIMESTAMP(3),
    "applies_to" TIMESTAMP(3),
    "status" "ReferentialStatus" NOT NULL DEFAULT 'NON_CONFIGURE',
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "imported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_referentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_imports" (
    "id" TEXT NOT NULL,
    "referential_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source_url" TEXT,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "regulatory_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_rules" (
    "id" TEXT NOT NULL,
    "referential_id" TEXT NOT NULL,
    "domain" "RegulatoryDomain" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "territory" TEXT NOT NULL,
    "condition" JSONB,
    "value" JSONB NOT NULL,
    "unit" TEXT,
    "exception" TEXT,
    "applies_from" TIMESTAMP(3) NOT NULL,
    "applies_to" TIMESTAMP(3),
    "source_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_zones" (
    "id" TEXT NOT NULL,
    "referential_id" TEXT NOT NULL,
    "kind" "ZoneKind" NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "geom" geometry(MultiPolygon, 4326),
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcel_regulatory_contexts" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "insee_code" TEXT,
    "commune" TEXT,
    "departement" TEXT,
    "region" TEXT,
    "bassin" TEXT,
    "zones" JSONB NOT NULL DEFAULT '[]',
    "referential_versions" JSONB NOT NULL DEFAULT '[]',
    "unresolved" JSONB NOT NULL DEFAULT '[]',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcel_regulatory_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nitrogen_plans" (
    "id" TEXT NOT NULL,
    "crop_year_id" TEXT NOT NULL,
    "campaign_year" INTEGER NOT NULL,
    "soil_type" TEXT,
    "opened_on" TIMESTAMP(3),
    "absorbed_at_opening_kg_ha" DECIMAL(8,2),
    "yield_target" DECIMAL(10,2),
    "yield_target_unit" TEXT,
    "legume_share" DECIMAL(5,2),
    "irrigated" BOOLEAN NOT NULL DEFAULT false,
    "irrigation_nitrate_mg_l" DECIMAL(8,2),
    "irrigation_volume_m3_ha" DECIMAL(10,2),
    "soil_analysis_id" TEXT,
    "previous_crop" TEXT,
    "need_kg_ha" DECIMAL(8,2),
    "soil_supply_kg_ha" DECIMAL(8,2),
    "previous_crop_kg_ha" DECIMAL(8,2),
    "residual_kg_ha" DECIMAL(8,2),
    "other_supplies_kg_ha" DECIMAL(8,2),
    "planned_efficient_kg_ha" DECIMAL(8,2),
    "planned_total_kg_ha" DECIMAL(8,2),
    "referential_code" TEXT,
    "referential_version" TEXT,
    "computation" JSONB,
    "locked_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nitrogen_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nitrogen_plan_entries" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "planned_on" TIMESTAMP(3),
    "input_type" "InputType" NOT NULL,
    "efficient_kg_ha" DECIMAL(8,2),
    "total_kg_ha" DECIMAL(8,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nitrogen_plan_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nitrogen_plan_deviations" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "deviation_kg_ha" DECIMAL(8,2) NOT NULL,
    "cause" TEXT NOT NULL,
    "occurred_on" TIMESTAMP(3),
    "tool" TEXT,
    "comment" TEXT,
    "document_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nitrogen_plan_deviations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soil_analyses" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "campaign_year" INTEGER NOT NULL,
    "sampled_on" TIMESTAMP(3) NOT NULL,
    "laboratory" TEXT,
    "depth_cm" INTEGER,
    "ph" DECIMAL(4,2),
    "organic_matter" DECIMAL(6,2),
    "nitrogen_total" DECIMAL(8,3),
    "phosphorus" DECIMAL(8,2),
    "potassium" DECIMAL(8,2),
    "residual_nitrogen_kg_ha" DECIMAL(8,2),
    "results" JSONB,
    "document_id" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "soil_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ift_references" (
    "id" TEXT NOT NULL,
    "referential_id" TEXT NOT NULL,
    "crop_label" TEXT NOT NULL,
    "crop_normalized" TEXT NOT NULL,
    "amm" TEXT,
    "target_label" TEXT,
    "category" TEXT NOT NULL,
    "dose_value" TEXT NOT NULL,
    "dose_unit" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ift_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_findings" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "parcel_id" TEXT,
    "campaign_year" INTEGER NOT NULL,
    "domain" "RegulatoryDomain" NOT NULL,
    "level" "FindingLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "rule_label" TEXT,
    "referential_code" TEXT,
    "referential_version" TEXT,
    "source_label" TEXT,
    "action" TEXT,
    "entity" TEXT,
    "entity_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regulatory_referentials_domain_status_idx" ON "regulatory_referentials"("domain", "status");

-- CreateIndex
CREATE INDEX "regulatory_referentials_code_territory_idx" ON "regulatory_referentials"("code", "territory");

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_referentials_code_territory_version_key" ON "regulatory_referentials"("code", "territory", "version");

-- CreateIndex
CREATE INDEX "regulatory_imports_referential_id_started_at_idx" ON "regulatory_imports"("referential_id", "started_at");

-- CreateIndex
CREATE INDEX "regulatory_rules_domain_territory_applies_from_idx" ON "regulatory_rules"("domain", "territory", "applies_from");

-- CreateIndex
CREATE INDEX "regulatory_rules_referential_id_idx" ON "regulatory_rules"("referential_id");

-- CreateIndex
CREATE INDEX "regulatory_zones_referential_id_kind_idx" ON "regulatory_zones"("referential_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_regulatory_contexts_parcel_id_key" ON "parcel_regulatory_contexts"("parcel_id");

-- CreateIndex
CREATE INDEX "nitrogen_plans_campaign_year_idx" ON "nitrogen_plans"("campaign_year");

-- CreateIndex
CREATE UNIQUE INDEX "nitrogen_plans_crop_year_id_key" ON "nitrogen_plans"("crop_year_id");

-- CreateIndex
CREATE INDEX "nitrogen_plan_entries_plan_id_idx" ON "nitrogen_plan_entries"("plan_id");

-- CreateIndex
CREATE INDEX "nitrogen_plan_deviations_plan_id_idx" ON "nitrogen_plan_deviations"("plan_id");

-- CreateIndex
CREATE INDEX "soil_analyses_parcel_id_campaign_year_idx" ON "soil_analyses"("parcel_id", "campaign_year");

-- CreateIndex
CREATE INDEX "ift_references_referential_id_crop_normalized_idx" ON "ift_references"("referential_id", "crop_normalized");

-- CreateIndex
CREATE INDEX "ift_references_amm_idx" ON "ift_references"("amm");

-- CreateIndex
CREATE INDEX "compliance_findings_farm_id_campaign_year_level_idx" ON "compliance_findings"("farm_id", "campaign_year", "level");

-- CreateIndex
CREATE INDEX "compliance_findings_parcel_id_idx" ON "compliance_findings"("parcel_id");

-- AddForeignKey
ALTER TABLE "regulatory_imports" ADD CONSTRAINT "regulatory_imports_referential_id_fkey" FOREIGN KEY ("referential_id") REFERENCES "regulatory_referentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_rules" ADD CONSTRAINT "regulatory_rules_referential_id_fkey" FOREIGN KEY ("referential_id") REFERENCES "regulatory_referentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_zones" ADD CONSTRAINT "regulatory_zones_referential_id_fkey" FOREIGN KEY ("referential_id") REFERENCES "regulatory_referentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_regulatory_contexts" ADD CONSTRAINT "parcel_regulatory_contexts_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nitrogen_plans" ADD CONSTRAINT "nitrogen_plans_crop_year_id_fkey" FOREIGN KEY ("crop_year_id") REFERENCES "crop_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nitrogen_plans" ADD CONSTRAINT "nitrogen_plans_soil_analysis_id_fkey" FOREIGN KEY ("soil_analysis_id") REFERENCES "soil_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nitrogen_plan_entries" ADD CONSTRAINT "nitrogen_plan_entries_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "nitrogen_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nitrogen_plan_deviations" ADD CONSTRAINT "nitrogen_plan_deviations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "nitrogen_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nitrogen_plan_deviations" ADD CONSTRAINT "nitrogen_plan_deviations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nitrogen_plan_deviations" ADD CONSTRAINT "nitrogen_plan_deviations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soil_analyses" ADD CONSTRAINT "soil_analyses_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soil_analyses" ADD CONSTRAINT "soil_analyses_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soil_analyses" ADD CONSTRAINT "soil_analyses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ift_references" ADD CONSTRAINT "ift_references_referential_id_fkey" FOREIGN KEY ("referential_id") REFERENCES "regulatory_referentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index spatial du zonage réglementaire.
--
-- Sans lui, déterminer le contexte d'une parcelle imposerait un balayage
-- complet du zonage : les zones vulnérables d'une région, c'est des milliers de
-- polygones, et le calcul se fait à chaque création de parcelle.
--
-- Créé ici en SQL brut, comme les autres index GiST : Prisma ne sait pas
-- déclarer un index sur une colonne qu'il ne modélise pas.
CREATE INDEX IF NOT EXISTS regulatory_zones_geom_gist
  ON "regulatory_zones" USING GIST ("geom");
