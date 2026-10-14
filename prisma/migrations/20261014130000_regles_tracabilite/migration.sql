-- Règles transcrites des arrêtés : la citation, et l'état de l'intégration.
--
-- Pourquoi
-- --------
-- Les règles du 7e programme d'actions régional, des zones d'actions
-- renforcées et du référentiel GREN d'Auvergne-Rhône-Alpes ne sont publiées
-- qu'en PDF — dont deux arrêtés scannés. Elles sont transcrites, règle par
-- règle, avec leur référence (texte, article, page).
--
-- `source_ref` disait déjà d'où venait une règle. Il ne disait pas **ce que
-- dit le texte** : la citation littérale permet à quiconque — l'exploitant, un
-- contrôleur — de confronter la valeur appliquée au texte sans rouvrir le PDF.
--
-- `integration` décrit, pour une version de référentiel, ce qui a été intégré
-- et ce qui manque : un référentiel importé à moitié ne doit pas s'afficher
-- comme complet, ni comme « non importé ».
--
-- `REGION_ADMINISTRATIVE` porte le contour officiel de la région, fourni avec
-- les référentiels : il dit à quel programme régional une parcelle est soumise
-- sans déduire la région d'un code de département.

ALTER TABLE "regulatory_rules" ADD COLUMN IF NOT EXISTS "citation" TEXT;
ALTER TABLE "regulatory_referentials" ADD COLUMN IF NOT EXISTS "integration" JSONB;
ALTER TYPE "ZoneKind" ADD VALUE IF NOT EXISTS 'REGION_ADMINISTRATIVE';
