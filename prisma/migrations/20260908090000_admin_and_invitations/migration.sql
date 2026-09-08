-- Administration de l'instance : administrateurs plateforme, suspension de
-- compte, codes d'invitation obligatoires à l'inscription et réglages
-- d'instance.

ALTER TABLE "users"
  ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspended_reason" TEXT;

CREATE INDEX "users_is_platform_admin_idx" ON "users"("is_platform_admin");

-- Codes d'invitation : seule l'empreinte est stockée, comme pour les sessions
-- et les jetons de réinitialisation.
CREATE TABLE "invitation_codes" (
  "id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "code_hint" TEXT NOT NULL,
  "email_normalized" TEXT,
  "farm_id" TEXT,
  "role" "FarmRole" NOT NULL DEFAULT 'OWNER',
  "grants_platform_admin" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "used_by_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL,
  "revoked_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invitation_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitation_codes_code_hash_key" ON "invitation_codes"("code_hash");
CREATE UNIQUE INDEX "invitation_codes_used_by_id_key" ON "invitation_codes"("used_by_id");
CREATE INDEX "invitation_codes_created_by_id_created_at_idx" ON "invitation_codes"("created_by_id", "created_at");
CREATE INDEX "invitation_codes_expires_at_idx" ON "invitation_codes"("expires_at");

ALTER TABLE "invitation_codes"
  ADD CONSTRAINT "invitation_codes_farm_id_fkey"
  FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitation_codes"
  ADD CONSTRAINT "invitation_codes_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitation_codes"
  ADD CONSTRAINT "invitation_codes_revoked_by_id_fkey"
  FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invitation_codes"
  ADD CONSTRAINT "invitation_codes_used_by_id_fkey"
  FOREIGN KEY ("used_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Réglages d'instance (mode maintenance…).
CREATE TABLE "app_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_by_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
