-- Rechercher une parcelle par son nom, accents compris.
--
-- Pourquoi
-- --------
-- La recherche de la liste des parcelles passait par `contains` en mode
-- insensible à la casse : « croix » trouvait « Croix », mais « cote » ne
-- trouvait pas « La Côte », et « chene » ne trouvait pas « Le Chêne ». Or on
-- tape un nom de parcelle au champ, sur un téléphone, sans accent — c'est
-- précisément là que la recherche sert.
--
-- Pourquoi pas l'extension `unaccent`
-- -----------------------------------
-- `CREATE EXTENSION unaccent` demande les droits de superutilisateur sur la
-- plupart des installations. Parcelys tourne sur un Raspberry Pi où la base
-- applicative n'est pas superutilisateur, et une migration qui exige un
-- privilège qu'on n'a pas est une migration qui ne passe pas.
--
-- `translate()` fait le même travail sur les caractères qui nous concernent,
-- sans extension, sans privilège et sans dépendance. La table de
-- correspondance est celle du français, plus quelques voisins européens qu'on
-- croise dans les noms de lieux.
--
-- IMMUTABLE, et pourquoi c'est nécessaire
-- ---------------------------------------
-- Sans ce marqueur, PostgreSQL refuse d'indexer une expression qui l'appelle.
-- La fonction ne lit rien d'autre que son argument : elle l'est réellement.
--
-- D'où vient la table, et ce qu'elle ne contient pas
-- --------------------------------------------------
-- Elle n'est pas écrite à la main : elle est **dérivée** de la règle
-- JavaScript de `src/lib/shared/texte.ts`, qui décompose en NFD et retire les
-- accents combinants. Pour chaque caractère de U+00C0 à U+024F, la paire n'est
-- retenue que si cette règle le ramène à une seule lettre ASCII.
--
-- Conséquence voulue : Æ, Œ, Ø, Ł et Đ n'y figurent pas. NFD ne les décompose
-- pas — ce sont des lettres à part entière, pas des lettres accentuées — et la
-- règle JavaScript les laisse donc intacts. Une première version de cette
-- table les traduisait tout de même, et rendait « vallee de l'auf » là où le
-- JavaScript rendait « vallee de l'œuf » : le site et le téléphone n'auraient
-- pas trouvé les mêmes parcelles. C'est `tests/recherche-parcelles.test.ts`
-- qui l'a relevé, en confrontant les deux implémentations sur des noms réels ;
-- il échouera de nouveau si elles divergent.

CREATE OR REPLACE FUNCTION parcelys_sans_accent(valeur text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT translate(
    lower(valeur),
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳ',
    'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyy'
  );
$$;

-- L'index sert la recherche « contient » sur le nom, le numéro interne, la
-- commune et le lieu-dit : les quatre façons dont un exploitant désigne une
-- parcelle. `gin_trgm_ops` serait plus rapide encore, mais demande
-- `pg_trgm` — même problème de privilège. Un index B-tree sur l'expression
-- suffit largement aux quelques centaines de parcelles d'une exploitation, et
-- il sert au moins les recherches par préfixe.
CREATE INDEX IF NOT EXISTS "parcels_nom_sans_accent_idx"
  ON "parcels" (parcelys_sans_accent("name"));
