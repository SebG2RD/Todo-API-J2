const { Router } = require("express");
const { httpError } = require("../middleware/errorHandler");
const {
  STATUSES,
  MAX_DESCRIPTION_LENGTH,
  createTask,
  listTasks,
  findTask,
  updateTask,
  deleteTask,
} = require("../models/task");

const router = Router();

// Seuls description et status sont lus : le client ne peut pas fabriquer son
// propre id ou son propre createdAt.
function readTaskInput(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(
      400,
      "Le corps de la requête doit être un objet JSON (en-tête Content-Type: application/json).",
    );
  }

  const input = {};

  if (body.description !== undefined) {
    if (typeof body.description !== "string" || body.description.trim() === "") {
      throw httpError(400, "Le champ `description` doit être une chaîne non vide.");
    }
    if (body.description.length > MAX_DESCRIPTION_LENGTH) {
      throw httpError(
        400,
        `Le champ \`description\` ne doit pas dépasser ${MAX_DESCRIPTION_LENGTH} caractères.`,
      );
    }
    input.description = body.description.trim();
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      throw httpError(
        400,
        `Le champ \`status\` doit valoir l'une de ces valeurs : ${STATUSES.join(", ")}.`,
      );
    }
    input.status = body.status;
  }

  return input;
}

// Express 5 rattrape les rejets des handlers async : un throw suffit, sans
// try/catch dans chaque route.
async function getTaskOr404(id) {
  const task = await findTask(id);
  if (!task) {
    throw httpError(404, `Aucune tâche avec l'id ${id}.`);
  }
  return task;
}

router.post("/", async (req, res) => {
  const input = readTaskInput(req.body);

  if (input.description === undefined) {
    throw httpError(400, "Le champ `description` est obligatoire.");
  }

  const task = await createTask(input);
  res.status(201).location(`/api/tasks/${task.id}`).json(task);
});

router.get("/", async (req, res) => {
  res.json(await listTasks());
});

router.get("/:id", async (req, res) => {
  res.json(await getTaskOr404(req.params.id));
});

// PUT remplace la tâche : description obligatoire. status garde sa valeur
// actuelle s'il est absent.
router.put("/:id", async (req, res) => {
  await getTaskOr404(req.params.id);
  const input = readTaskInput(req.body);

  if (input.description === undefined) {
    throw httpError(400, "Le champ `description` est obligatoire.");
  }

  res.json(await updateTask(req.params.id, input));
});

router.delete("/:id", async (req, res) => {
  await getTaskOr404(req.params.id);
  await deleteTask(req.params.id);

  res.status(204).end();
});

module.exports = router;
