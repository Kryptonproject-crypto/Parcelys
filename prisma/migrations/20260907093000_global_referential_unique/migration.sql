-- Le référentiel global (farm_id NULL) n'est pas couvert par les contraintes
-- `UNIQUE (farm_id, ...)` : en SQL, deux NULL ne sont jamais égaux, deux lignes
-- globales de même code passeraient donc la contrainte. Ces index partiels
-- rétablissent l'unicité côté base.
CREATE UNIQUE INDEX IF NOT EXISTS "crops_global_code_unique"
  ON "crops" ("code") WHERE "farm_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "fertilizers_global_name_unique"
  ON "fertilizers" ("name") WHERE "farm_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "organic_inputs_global_name_unique"
  ON "organic_inputs" ("name") WHERE "farm_id" IS NULL;
