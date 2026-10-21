-- Parcelys 0.12.0 — mentions du registre phytopharmaceutique en vigueur au
-- 1er janvier 2026 (arrêté du 24 décembre 2025, JORF du 31 décembre 2025).
--
-- Elle **ajoute** des colonnes facultatives et deux types énumérés. Elle ne
-- supprime rien, ne renomme rien et ne réécrit aucune donnée : un traitement
-- déjà enregistré garde ses mentions vides — « non renseigné », jamais une
-- valeur supposée.
--
-- Rejouable : chaque instruction tolère d'avoir déjà été faite. Si elle
-- s'interrompt, `npx prisma migrate resolve --rolled-back
-- 20261018090000_registre_phyto_2026` puis `npx prisma migrate deploy`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrganicFarming') THEN
    CREATE TYPE "OrganicFarming" AS ENUM ('AUCUNE', 'TOTALE', 'PARTIELLE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApplicatorKind') THEN
    CREATE TYPE "ApplicatorKind" AS ENUM ('EXPLOITATION', 'PRESTATAIRE', 'ENTRAIDE');
  END IF;
END
$$;

ALTER TABLE "farms" ADD COLUMN IF NOT EXISTS "organic_farming" "OrganicFarming";

ALTER TABLE "phytosanitary_applications"
  ADD COLUMN IF NOT EXISTS "start_time" TEXT,
  ADD COLUMN IF NOT EXISTS "end_time" TEXT,
  ADD COLUMN IF NOT EXISTS "bbch_stage" TEXT,
  ADD COLUMN IF NOT EXISTS "organic_production" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "applied_by" "ApplicatorKind",
  ADD COLUMN IF NOT EXISTS "contractor_name" TEXT,
  ADD COLUMN IF NOT EXISTS "contractor_siret" TEXT;
