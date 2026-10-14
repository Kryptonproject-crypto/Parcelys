-- Classement réglementaire des produits organiques, et paramètres GREN du plan.
--
-- Pourquoi
-- --------
-- Le 7e programme d'actions régional plafonne les apports sur couverts
-- d'interculture en « azote potentiellement libéré jusqu'en sortie d'hiver »,
-- par types de fertilisants (0, I, II, III). Le référentiel GREN, lui, calcule
-- l'azote efficace d'un apport organique avec un coefficient Kéq. Trois
-- nomenclatures distinctes de la fiche technique 19 (teneurs, Kéq,
-- coefficients APLSH) et le classement du programme national désignent un même
-- produit : aucune n'est déductible de son nom, elles se déclarent.
--
-- `regulatory_class` porte ces déclarations ; vide, les contrôles qui en
-- dépendent restent indéterminés.
--
-- `gren_inputs` porte les paramètres du calcul de la dose prévisionnelle
-- (culture au sens du GREN, type de sol, choix dans chaque tableau, valeurs
-- mesurées et leur justification). Le résultat, avec sa traçabilité, va dans
-- `computation`, qui existait déjà.

ALTER TABLE "organic_inputs" ADD COLUMN IF NOT EXISTS "regulatory_class" JSONB;
ALTER TABLE "nitrogen_plans" ADD COLUMN IF NOT EXISTS "gren_inputs" JSONB;
