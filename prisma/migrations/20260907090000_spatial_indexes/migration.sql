-- Index spatial GIST : indispensable aux requêtes ST_Intersects / ST_Extent
-- (détection de recouvrement, emprise de l'exploitation). Prisma ne génère pas
-- d'index sur les colonnes de type `Unsupported`, il est donc créé ici.
CREATE INDEX IF NOT EXISTS "parcel_geometries_geom_gist"
  ON "parcel_geometries" USING GIST ("geom");

-- Une seule géométrie courante par parcelle.
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_geometries_current_unique"
  ON "parcel_geometries" ("parcel_id")
  WHERE "is_current" = true;

-- Recherche plein texte simple sur le nom des produits phytosanitaires
-- (utilisée par la recherche E-Phy avec `contains`).
CREATE INDEX IF NOT EXISTS "phytosanitary_products_name_trgm"
  ON "phytosanitary_products" ("normalized_name" text_pattern_ops);

-- Accélère le filtre « parcelles actives d'une exploitation ».
CREATE INDEX IF NOT EXISTS "parcels_farm_active"
  ON "parcels" ("farm_id", "name")
  WHERE "deleted_at" IS NULL;
