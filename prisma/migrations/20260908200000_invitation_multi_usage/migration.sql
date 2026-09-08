-- Un code d'invitation par personne, ce n'était pas l'intention.
--
-- `used_by_id` portait une contrainte d'unicité, héritée d'une relation 1-1
-- qui n'était utilisée nulle part. Elle interdisait à un même compte de
-- consommer deux codes au cours de sa vie — ce qui n'a pas posé de problème
-- tant qu'un compte ne consommait qu'un code d'inscription, mais bloque
-- l'expert agronomique : il active un code d'accès par exploitation suivie,
-- en plus du code qui a créé son compte.
--
-- L'index simple qui remplace la contrainte conserve la seule chose utile :
-- retrouver rapidement les codes consommés par une personne.

DROP INDEX IF EXISTS "invitation_codes_used_by_id_key";

CREATE INDEX IF NOT EXISTS "invitation_codes_used_by_id_idx"
  ON "invitation_codes" ("used_by_id");
