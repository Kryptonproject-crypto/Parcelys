-- Synchronisation hors ligne : mémorisation des réponses déjà produites, pour
-- qu'un rejeu de l'application mobile ne crée pas de doublon.

CREATE TABLE "idempotency_records" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "owner_hash" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "response_body" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- La clé n'est unique que pour un porteur donné : deux appareils peuvent
-- utiliser le même identifiant sans se percuter, et personne ne peut relire la
-- réponse d'un autre.
CREATE UNIQUE INDEX "idempotency_records_key_owner_hash_key"
  ON "idempotency_records"("key", "owner_hash");

CREATE INDEX "idempotency_records_created_at_idx"
  ON "idempotency_records"("created_at");
