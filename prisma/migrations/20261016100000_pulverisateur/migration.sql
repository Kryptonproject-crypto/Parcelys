-- Pulvérisateur de l'exploitation : type, moyen anti-dérive, charte riverains.
-- Tout est facultatif : une exploitation qui n'a rien renseigné n'est jamais
-- supposée équipée.
CREATE TYPE "SprayerType" AS ENUM ('RAMPE', 'JET_PORTE', 'PNEUMATIQUE', 'A_DOS', 'AUTRE');

ALTER TABLE "farms"
  ADD COLUMN "sprayer_type" "SprayerType",
  ADD COLUMN "sprayer_drift_reduction_pct" INTEGER,
  ADD COLUMN "sprayer_drift_equipment" TEXT,
  ADD COLUMN "riverain_charter_applied" BOOLEAN;

ALTER TABLE "farms"
  ADD CONSTRAINT "farms_sprayer_drift_reduction_pct_check"
  CHECK ("sprayer_drift_reduction_pct" IS NULL OR "sprayer_drift_reduction_pct" IN (0, 50, 66, 75, 90));
