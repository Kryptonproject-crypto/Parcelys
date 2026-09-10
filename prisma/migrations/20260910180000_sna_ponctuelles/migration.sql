-- Élargissement du type géométrique des entités PAC.
--
-- Pourquoi
-- --------
-- Une SNA (surface non agricole) n'est pas toujours une surface. Dans le dossier
-- XML TéléPAC, 157 des 560 SNA de la campagne 2026 sont des `gml:Point` : des
-- arbres isolés, qui comptent au titre des infrastructures agro-écologiques. La
-- colonne, restreinte aux MultiPolygon, les refusait — l'import échouait sur des
-- données parfaitement déclarées, et le message d'erreur venait de PostgreSQL.
--
-- Ce que fait cette migration
-- ---------------------------
-- Elle élargit la contrainte de type, elle ne convertit rien : les MultiPolygon
-- déjà stockés restent des MultiPolygon, bit pour bit. Un élargissement de ce
-- genre ne peut pas perdre de donnée, puisque l'ancien domaine est inclus dans
-- le nouveau.
--
-- L'index GiST n'est pas recréé : il porte sur la colonne, pas sur son type, et
-- PostgreSQL le conserve à travers un ALTER TYPE qui n'a pas besoin de réécrire
-- la table. Le laisser tranquille évite de reconstruire un index pour rien sur
-- un Raspberry Pi.
--
-- Les îlots et les parcelles ne sont pas touchés : ceux-là sont toujours des
-- surfaces, et une contrainte qui dit vrai vaut mieux qu'une contrainte lâche.

ALTER TABLE "pac_features"
  ALTER COLUMN "geom" TYPE geometry(Geometry, 4326) USING "geom";
