-- Référentiels réglementaires : points, lignes, et proximités.
--
-- Pourquoi
-- --------
-- Les référentiels fournis pour l'Auvergne-Rhône-Alpes ne sont pas tous des
-- surfaces :
--
--   * BD TOPAGE 2026 — 402 215 tronçons hydrographiques (lignes), 18 796 cours
--     d'eau (lignes), des surfaces en eau et des plans d'eau (surfaces) ;
--   * points et ouvrages de prélèvement — 23 787 et 22 479 points en AURA.
--
-- La colonne `geom` des zonages, restreinte aux MultiPolygon, les refusait.
-- Même situation, même remède que pour les SNA ponctuelles de la PAC
-- (20260910180000_sna_ponctuelles) : on élargit la contrainte de type, on ne
-- convertit rien. Les MultiPolygon déjà stockés le restent, bit pour bit.
--
-- L'index GiST porte sur la colonne et survit à l'élargissement.
--
-- Les natures ajoutées distinguent ce que la réglementation distingue : un
-- point de prélèvement n'est pas un ouvrage, aucun des deux n'est une aire
-- d'alimentation de captage, et aucun n'est un périmètre de protection. Les
-- deux dernières natures n'ont pas de données à ce jour — elles existent pour
-- qu'un import futur ne soit pas rangé sous une nature voisine, faute de mieux.

ALTER TABLE "regulatory_zones"
  ALTER COLUMN "geom" TYPE geometry(Geometry, 4326) USING "geom";

ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'BASSIN_HYDROGRAPHIQUE';
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'TRONCON_HYDROGRAPHIQUE';
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'SURFACE_HYDROGRAPHIQUE';
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'PLAN_EAU';
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'POINT_PRELEVEMENT';
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'OUVRAGE_PRELEVEMENT';
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'PERIMETRE_PROTECTION_CAPTAGE';
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'ZONE_PROTECTION_AAC';

-- Ce qui se trouve à proximité de la parcelle sans la recouper : un cours
-- d'eau, un point de prélèvement. Distinct de `zones`, qui ne porte que des
-- recouvrements de surface — mêler les deux ferait lire une distance comme
-- une appartenance.
ALTER TABLE "parcel_regulatory_contexts"
  ADD COLUMN IF NOT EXISTS "proximites" JSONB NOT NULL DEFAULT '[]';
