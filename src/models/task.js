const { randomUUID } = require("node:crypto");
const { query } = require("../db");

const STATUSES = ["pending", "in-progress", "done"];
const DEFAULT_STATUS = "pending";
const MAX_DESCRIPTION_LENGTH = 500;

// La base est en snake_case, l'API répond en camelCase.
function toTask(row) {
  return {
    id: row.id,
    description: row.description,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Un id mal formé ferait échouer Postgres sur une erreur de type 22P02, là où
// la réponse attendue est un 404.
function isUuid(value) {
  return UUID_PATTERN.test(value);
}

async function createTask({ description, status = DEFAULT_STATUS }) {
  const { rows } = await query(
    `INSERT INTO tasks (id, description, status)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [randomUUID(), description, status],
  );
  return toTask(rows[0]);
}

async function listTasks() {
  const { rows } = await query("SELECT * FROM tasks ORDER BY creation_date");
  return rows.map(toTask);
}

async function findTask(id) {
  if (!isUuid(id)) return null;

  const { rows } = await query("SELECT * FROM tasks WHERE id = $1", [id]);
  return rows[0] ? toTask(rows[0]) : null;
}

// COALESCE laisse la valeur en base intacte quand le champ n'est pas fourni.
async function updateTask(id, { description, status }) {
  if (!isUuid(id)) return null;

  const { rows } = await query(
    `UPDATE tasks
        SET description = COALESCE($2, description),
            status      = COALESCE($3, status),
            updated_at  = now()
      WHERE id = $1
      RETURNING *`,
    [id, description ?? null, status ?? null],
  );
  return rows[0] ? toTask(rows[0]) : null;
}

async function deleteTask(id) {
  if (!isUuid(id)) return false;

  const { rowCount } = await query("DELETE FROM tasks WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = {
  STATUSES,
  DEFAULT_STATUS,
  MAX_DESCRIPTION_LENGTH,
  createTask,
  listTasks,
  findTask,
  updateTask,
  deleteTask,
};
