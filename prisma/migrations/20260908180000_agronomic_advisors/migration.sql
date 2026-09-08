-- Conseil agronomique : comptes experts, portefeuille d'exploitations suivies,
-- et préconisations transmises aux exploitants.

-- Nature du compte : exploitant ou expert agronomique.
CREATE TYPE "AccountType" AS ENUM ('FARMER', 'AGRONOMIST');

-- À quoi sert un code d'invitation : créer un compte, ou ouvrir l'accès
-- conseil d'une exploitation à un expert déjà inscrit.
CREATE TYPE "InvitationPurpose" AS ENUM ('ACCOUNT', 'ADVISORY_ACCESS');

CREATE TYPE "EngagementStatus" AS ENUM ('ACTIVE', 'ENDED');

CREATE TYPE "RecommendationKind" AS ENUM
  ('PHYTO', 'FERTILIZATION', 'OPERATION', 'OBSERVATION');

CREATE TYPE "RecommendationStatus" AS ENUM
  ('DRAFT', 'PROPOSED', 'ACCEPTED', 'DECLINED', 'APPLIED', 'WITHDRAWN');

CREATE TYPE "RecommendationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- L'expert reçoit un rôle sur l'exploitation qu'il suit, sans jamais figurer
-- parmi ses membres : le rôle décrit l'accès, pas une appartenance.
ALTER TYPE "FarmRole" ADD VALUE 'ADVISOR';

ALTER TABLE "users"
  ADD COLUMN "account_type" "AccountType" NOT NULL DEFAULT 'FARMER',
  ADD COLUMN "organization" TEXT,
  ADD COLUMN "advisor_certificate" TEXT;

CREATE INDEX "users_account_type_idx" ON "users"("account_type");

ALTER TABLE "invitation_codes"
  ADD COLUMN "purpose" "InvitationPurpose" NOT NULL DEFAULT 'ACCOUNT',
  ADD COLUMN "account_type" "AccountType" NOT NULL DEFAULT 'FARMER';

-- ---------------------------------------------------------------------------
-- Missions de conseil
-- ---------------------------------------------------------------------------

CREATE TABLE "advisory_engagements" (
  "id" TEXT NOT NULL,
  "farm_id" TEXT NOT NULL,
  "expert_id" TEXT NOT NULL,
  "status" "EngagementStatus" NOT NULL DEFAULT 'ACTIVE',
  "granted_by_id" TEXT,
  "note" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "advisory_engagements_pkey" PRIMARY KEY ("id")
);

-- Une seule mission par couple : la reprise d'un accès révoqué réactive la
-- ligne existante plutôt que d'en empiler une seconde.
CREATE UNIQUE INDEX "advisory_engagements_farm_id_expert_id_key"
  ON "advisory_engagements"("farm_id", "expert_id");
CREATE INDEX "advisory_engagements_expert_id_status_idx"
  ON "advisory_engagements"("expert_id", "status");

ALTER TABLE "advisory_engagements"
  ADD CONSTRAINT "advisory_engagements_farm_id_fkey"
  FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "advisory_engagements"
  ADD CONSTRAINT "advisory_engagements_expert_id_fkey"
  FOREIGN KEY ("expert_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "advisory_engagements"
  ADD CONSTRAINT "advisory_engagements_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Préconisations
-- ---------------------------------------------------------------------------

CREATE TABLE "recommendations" (
  "id" TEXT NOT NULL,
  "farm_id" TEXT NOT NULL,
  "parcel_id" TEXT,
  "author_id" TEXT NOT NULL,
  "kind" "RecommendationKind" NOT NULL,
  "status" "RecommendationStatus" NOT NULL DEFAULT 'DRAFT',
  "priority" "RecommendationPriority" NOT NULL DEFAULT 'NORMAL',
  "title" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "product_name" TEXT,
  "amm" TEXT,
  "ephy_product_id" TEXT,
  "dose" DECIMAL(12,4),
  "dose_unit" TEXT,
  "target_label" TEXT,
  "window_start" TIMESTAMP(3),
  "window_end" TIMESTAMP(3),
  "responded_by_id" TEXT,
  "responded_at" TIMESTAMP(3),
  "response_note" TEXT,
  "applied_phyto_id" TEXT,
  "applied_fertilization_id" TEXT,
  "applied_operation_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recommendations_farm_id_status_idx"
  ON "recommendations"("farm_id", "status");
CREATE INDEX "recommendations_author_id_created_at_idx"
  ON "recommendations"("author_id", "created_at");
CREATE INDEX "recommendations_parcel_id_idx" ON "recommendations"("parcel_id");

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_farm_id_fkey"
  FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_parcel_id_fkey"
  FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_responded_by_id_fkey"
  FOREIGN KEY ("responded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_ephy_product_id_fkey"
  FOREIGN KEY ("ephy_product_id") REFERENCES "phytosanitary_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_applied_phyto_id_fkey"
  FOREIGN KEY ("applied_phyto_id") REFERENCES "phytosanitary_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_applied_fertilization_id_fkey"
  FOREIGN KEY ("applied_fertilization_id") REFERENCES "fertilizer_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_applied_operation_id_fkey"
  FOREIGN KEY ("applied_operation_id") REFERENCES "agricultural_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
