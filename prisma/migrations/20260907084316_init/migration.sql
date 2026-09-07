-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "FarmRole" AS ENUM ('OWNER', 'ADMIN', 'EMPLOYEE', 'VIEWER');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFICATION', 'EMAIL_CHANGE');

-- CreateEnum
CREATE TYPE "ParcelStatus" AS ENUM ('ACTIVE', 'FALLOW', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InputType" AS ENUM ('ORGANIC', 'MINERAL');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('LABOUR', 'DECHAUMAGE', 'SEMIS', 'ROULAGE', 'HERSAGE', 'BROYAGE', 'FAUCHE', 'RECOLTE', 'TRANSPORT', 'IRRIGATION', 'AUTRE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "unit_system" TEXT NOT NULL DEFAULT 'metric',
    "weather_provider" TEXT,
    "notify_by_email" BOOLEAN NOT NULL DEFAULT true,
    "accepted_terms_at" TIMESTAMP(3),
    "accepted_privacy_at" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siret" TEXT,
    "address_line" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "department" TEXT,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "weather_provider" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_members" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "FarmRole" NOT NULL DEFAULT 'VIEWER',
    "job_title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "active_farm_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL DEFAULT 'EMAIL_VERIFICATION',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "parcels" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internal_number" TEXT,
    "commune" TEXT,
    "insee_code" TEXT,
    "lieu_dit" TEXT,
    "cadastral_ref" TEXT,
    "pac_id" TEXT,
    "parcel_type" TEXT,
    "status" "ParcelStatus" NOT NULL DEFAULT 'ACTIVE',
    "area_ha" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "centroid_lat" DOUBLE PRECISION,
    "centroid_lng" DOUBLE PRECISION,
    "notes" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcel_geometries" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "geom" geometry(MultiPolygon, 4326) NOT NULL,
    "area_ha" DECIMAL(12,4) NOT NULL,
    "perimeter_m" DECIMAL(12,2),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_geometries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crops" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_years" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "crop_id" TEXT NOT NULL,
    "campaign_year" INTEGER NOT NULL,
    "variety" TEXT,
    "sowing_date" TIMESTAMP(3),
    "expected_harvest_date" TIMESTAMP(3),
    "actual_harvest_date" TIMESTAMP(3),
    "yield_value" DECIMAL(10,2),
    "yield_unit" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fertilizers" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "n_percent" DECIMAL(6,2),
    "p_percent" DECIMAL(6,2),
    "k_percent" DECIMAL(6,2),
    "default_unit" TEXT NOT NULL DEFAULT 'kg/ha',
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fertilizers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organic_inputs" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "n_content" DECIMAL(8,3),
    "p_content" DECIMAL(8,3),
    "k_content" DECIMAL(8,3),
    "dry_matter" DECIMAL(6,2),
    "default_unit" TEXT NOT NULL DEFAULT 't/ha',
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organic_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fertilizer_applications" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "crop_year_id" TEXT,
    "applied_on" TIMESTAMP(3) NOT NULL,
    "input_type" "InputType" NOT NULL,
    "fertilizer_id" TEXT,
    "organic_input_id" TEXT,
    "product_label" TEXT NOT NULL,
    "dose" DECIMAL(12,3) NOT NULL,
    "dose_unit" TEXT NOT NULL,
    "treated_area_ha" DECIMAL(12,4) NOT NULL,
    "total_quantity" DECIMAL(14,3) NOT NULL,
    "total_unit" TEXT NOT NULL,
    "n_supplied" DECIMAL(12,2),
    "p_supplied" DECIMAL(12,2),
    "k_supplied" DECIMAL(12,2),
    "supplier" TEXT,
    "batch_number" TEXT,
    "operator" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fertilizer_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_substances" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "cas_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_substances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phytosanitary_products" (
    "id" TEXT NOT NULL,
    "amm" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "second_names" TEXT,
    "holder" TEXT,
    "product_type" TEXT,
    "formulation" TEXT,
    "status" TEXT,
    "commercial_type" TEXT,
    "authorized_mentions" TEXT,
    "usage_restrictions" TEXT,
    "valid_until" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "source_version" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phytosanitary_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_substances" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "substance_id" TEXT NOT NULL,
    "concentration" TEXT,
    "unit" TEXT,

    CONSTRAINT "product_substances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phyto_usages" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "ephy_usage_id" TEXT,
    "crop_label" TEXT,
    "target_label" TEXT,
    "usage_label" TEXT,
    "dose_value" TEXT,
    "dose_unit" TEXT,
    "status" TEXT,
    "conditions" TEXT,
    "pre_harvest_delay" TEXT,
    "znt_aquatic_m" TEXT,
    "max_applications" TEXT,
    "decision_date" TIMESTAMP(3),

    CONSTRAINT "phyto_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ephy_sync_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "version" TEXT,
    "product_count" INTEGER NOT NULL DEFAULT 0,
    "substance_count" INTEGER NOT NULL DEFAULT 0,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ephy_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phytosanitary_applications" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "crop_year_id" TEXT,
    "applied_on" TIMESTAMP(3) NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "amm" TEXT,
    "active_substances" TEXT,
    "crop_label" TEXT,
    "target_label" TEXT,
    "dose" DECIMAL(12,3) NOT NULL,
    "dose_unit" TEXT NOT NULL,
    "spray_volume_l_ha" DECIMAL(10,2),
    "treated_area_ha" DECIMAL(12,4) NOT NULL,
    "quantity_used" DECIMAL(14,3) NOT NULL,
    "quantity_unit" TEXT NOT NULL,
    "weather_temp_c" DECIMAL(5,1),
    "weather_wind_kmh" DECIMAL(5,1),
    "weather_humidity" DECIMAL(5,1),
    "weather_rain_mm" DECIMAL(6,2),
    "weather_summary" TEXT,
    "weather_source" TEXT,
    "operator" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phytosanitary_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agricultural_operations" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "performed_on" TIMESTAMP(3) NOT NULL,
    "type" "OperationType" NOT NULL,
    "equipment" TEXT,
    "operator" TEXT,
    "duration_hours" DECIMAL(6,2),
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agricultural_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_records" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT,
    "parcel_id" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "temperature_c" DECIMAL(5,1),
    "humidity" DECIMAL(5,1),
    "wind_kmh" DECIMAL(5,1),
    "wind_direction_deg" INTEGER,
    "precipitation_mm" DECIMAL(6,2),
    "pressure_hpa" DECIMAL(7,1),
    "summary" TEXT,
    "provider" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "parcel_id" TEXT,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "category" TEXT NOT NULL DEFAULT 'AUTRE',
    "description" TEXT,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entity_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "farm_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");

-- CreateIndex
CREATE INDEX "users_email_normalized_idx" ON "users"("email_normalized");

-- CreateIndex
CREATE INDEX "farms_is_demo_idx" ON "farms"("is_demo");

-- CreateIndex
CREATE INDEX "farm_members_user_id_idx" ON "farm_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "farm_members_farm_id_user_id_key" ON "farm_members"("farm_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "email_verification_codes_user_id_purpose_idx" ON "email_verification_codes"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "email_verification_codes_expires_at_idx" ON "email_verification_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "rate_limit_counters_expires_at_idx" ON "rate_limit_counters"("expires_at");

-- CreateIndex
CREATE INDEX "parcels_farm_id_deleted_at_idx" ON "parcels"("farm_id", "deleted_at");

-- CreateIndex
CREATE INDEX "parcels_farm_id_status_idx" ON "parcels"("farm_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "parcels_farm_id_internal_number_key" ON "parcels"("farm_id", "internal_number");

-- CreateIndex
CREATE INDEX "parcel_geometries_parcel_id_is_current_idx" ON "parcel_geometries"("parcel_id", "is_current");

-- CreateIndex
CREATE INDEX "crops_name_idx" ON "crops"("name");

-- CreateIndex
CREATE UNIQUE INDEX "crops_farm_id_code_key" ON "crops"("farm_id", "code");

-- CreateIndex
CREATE INDEX "crop_years_parcel_id_campaign_year_idx" ON "crop_years"("parcel_id", "campaign_year");

-- CreateIndex
CREATE UNIQUE INDEX "crop_years_parcel_id_campaign_year_crop_id_key" ON "crop_years"("parcel_id", "campaign_year", "crop_id");

-- CreateIndex
CREATE UNIQUE INDEX "fertilizers_farm_id_name_key" ON "fertilizers"("farm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "organic_inputs_farm_id_name_key" ON "organic_inputs"("farm_id", "name");

-- CreateIndex
CREATE INDEX "fertilizer_applications_parcel_id_applied_on_idx" ON "fertilizer_applications"("parcel_id", "applied_on");

-- CreateIndex
CREATE INDEX "fertilizer_applications_applied_on_idx" ON "fertilizer_applications"("applied_on");

-- CreateIndex
CREATE UNIQUE INDEX "active_substances_name_key" ON "active_substances"("name");

-- CreateIndex
CREATE UNIQUE INDEX "active_substances_normalized_name_key" ON "active_substances"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "phytosanitary_products_amm_key" ON "phytosanitary_products"("amm");

-- CreateIndex
CREATE INDEX "phytosanitary_products_normalized_name_idx" ON "phytosanitary_products"("normalized_name");

-- CreateIndex
CREATE INDEX "phytosanitary_products_status_idx" ON "phytosanitary_products"("status");

-- CreateIndex
CREATE INDEX "product_substances_substance_id_idx" ON "product_substances"("substance_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_substances_product_id_substance_id_key" ON "product_substances"("product_id", "substance_id");

-- CreateIndex
CREATE INDEX "phyto_usages_product_id_idx" ON "phyto_usages"("product_id");

-- CreateIndex
CREATE INDEX "phyto_usages_crop_label_idx" ON "phyto_usages"("crop_label");

-- CreateIndex
CREATE INDEX "ephy_sync_runs_started_at_idx" ON "ephy_sync_runs"("started_at");

-- CreateIndex
CREATE INDEX "phytosanitary_applications_parcel_id_applied_on_idx" ON "phytosanitary_applications"("parcel_id", "applied_on");

-- CreateIndex
CREATE INDEX "phytosanitary_applications_applied_on_idx" ON "phytosanitary_applications"("applied_on");

-- CreateIndex
CREATE INDEX "agricultural_operations_parcel_id_performed_on_idx" ON "agricultural_operations"("parcel_id", "performed_on");

-- CreateIndex
CREATE INDEX "weather_records_farm_id_recorded_at_idx" ON "weather_records"("farm_id", "recorded_at");

-- CreateIndex
CREATE INDEX "weather_records_parcel_id_recorded_at_idx" ON "weather_records"("parcel_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_farm_id_idx" ON "documents"("farm_id");

-- CreateIndex
CREATE INDEX "documents_parcel_id_idx" ON "documents"("parcel_id");

-- CreateIndex
CREATE INDEX "audit_logs_farm_id_created_at_idx" ON "audit_logs"("farm_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "farm_members" ADD CONSTRAINT "farm_members_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_members" ADD CONSTRAINT "farm_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_farm_id_fkey" FOREIGN KEY ("active_farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_geometries" ADD CONSTRAINT "parcel_geometries_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crops" ADD CONSTRAINT "crops_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_years" ADD CONSTRAINT "crop_years_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_years" ADD CONSTRAINT "crop_years_crop_id_fkey" FOREIGN KEY ("crop_id") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizers" ADD CONSTRAINT "fertilizers_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organic_inputs" ADD CONSTRAINT "organic_inputs_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_crop_year_id_fkey" FOREIGN KEY ("crop_year_id") REFERENCES "crop_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_fertilizer_id_fkey" FOREIGN KEY ("fertilizer_id") REFERENCES "fertilizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_organic_input_id_fkey" FOREIGN KEY ("organic_input_id") REFERENCES "organic_inputs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_substances" ADD CONSTRAINT "product_substances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "phytosanitary_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_substances" ADD CONSTRAINT "product_substances_substance_id_fkey" FOREIGN KEY ("substance_id") REFERENCES "active_substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phyto_usages" ADD CONSTRAINT "phyto_usages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "phytosanitary_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phytosanitary_applications" ADD CONSTRAINT "phytosanitary_applications_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phytosanitary_applications" ADD CONSTRAINT "phytosanitary_applications_crop_year_id_fkey" FOREIGN KEY ("crop_year_id") REFERENCES "crop_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phytosanitary_applications" ADD CONSTRAINT "phytosanitary_applications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "phytosanitary_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phytosanitary_applications" ADD CONSTRAINT "phytosanitary_applications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agricultural_operations" ADD CONSTRAINT "agricultural_operations_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agricultural_operations" ADD CONSTRAINT "agricultural_operations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_records" ADD CONSTRAINT "weather_records_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_records" ADD CONSTRAINT "weather_records_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
