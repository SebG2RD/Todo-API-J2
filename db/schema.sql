-- Schéma de la base, source unique.
--
-- Ce fichier est rejoué à trois endroits, et c'est volontaire : au démarrage de
-- l'API, par `npm run migrate` avant les tests d'intégration en CI, et à la
-- main sur la machine cible en cas de besoin. Un schéma décrit à deux endroits
-- finit toujours par diverger, et c'est exactement le bug que les tests
-- d'intégration sont censés attraper : une colonne qui existe en test et pas en
-- production.
--
-- IF NOT EXISTS le rend idempotent : le rejouer ne casse rien et n'empile rien.

CREATE TABLE IF NOT EXISTS tasks (
  id          UUID        PRIMARY KEY,
  description TEXT        NOT NULL,
  status      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Les listes sont toujours triées par date de création : sans cet index,
-- Postgres relit toute la table à chaque GET /api/tasks.
CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks (created_at);
