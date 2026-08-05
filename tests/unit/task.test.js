// Le modèle parle à PostgreSQL par un seul point, `query`. On le remplace ici
// pour observer ce que le modèle envoie et ce qu'il fait de la réponse.
// Un mock ne dit rien du schéma réel de la base : c'est le rôle des tests
// d'intégration, dans tests/integration.
jest.mock("../../src/db", () => ({ query: jest.fn() }));

const { query } = require("../../src/db");
const {
  createTask,
  findTask,
  updateTask,
  deleteTask,
  STATUSES,
  DEFAULT_STATUS,
} = require("../../src/models/task");

const ROW = {
  id: "0557ad6b-5875-42dc-bdb9-ff0389ea6d49",
  description: "Acheter du pain",
  status: "pending",
  created_at: new Date("2026-08-05T10:00:00.000Z"),
  updated_at: new Date("2026-08-05T10:00:00.000Z"),
};

beforeEach(() => {
  query.mockReset();
});

describe("le passage de la base à l'API", () => {
  test("les colonnes snake_case ressortent en camelCase ISO 8601", async () => {
    query.mockResolvedValue({ rows: [ROW] });

    const task = await findTask(ROW.id);

    expect(task).toEqual({
      id: ROW.id,
      description: "Acheter du pain",
      status: "pending",
      createdAt: "2026-08-05T10:00:00.000Z",
      updatedAt: "2026-08-05T10:00:00.000Z",
    });
    // created_at ne doit jamais fuiter tel quel vers le client.
    expect(Object.keys(task)).not.toContain("created_at");
  });

  test("createTask génère l'id et pose le statut par défaut", async () => {
    query.mockResolvedValue({ rows: [ROW] });

    await createTask({ description: "Acheter du pain" });

    const [, params] = query.mock.calls[0];
    const [id, description, status] = params;
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(description).toBe("Acheter du pain");
    expect(status).toBe(DEFAULT_STATUS);
    expect(STATUSES).toContain(DEFAULT_STATUS);
  });
});

describe("le garde-fou sur les identifiants mal formés", () => {
  // Sans ce garde, Postgres répondrait une erreur de type 22P02 transformée en
  // 500, là où la réponse attendue est un 404.
  const MALFORMED = ["pas-un-uuid", "42", "0557ad6b-5875-42dc-bdb9"];

  test.each(MALFORMED)("findTask(%p) ne touche jamais la base", async (id) => {
    expect(await findTask(id)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test("updateTask et deleteTask s'arrêtent aussi avant la base", async () => {
    expect(await updateTask("pas-un-uuid", { description: "x" })).toBeNull();
    expect(await deleteTask("pas-un-uuid")).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("ce que le modèle fait d'une base qui ne renvoie rien", () => {
  test("findTask renvoie null sur un résultat vide", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await findTask(ROW.id)).toBeNull();
  });

  test("deleteTask renvoie false quand aucune ligne n'a été supprimée", async () => {
    query.mockResolvedValue({ rowCount: 0 });
    expect(await deleteTask(ROW.id)).toBe(false);
  });

  test("deleteTask renvoie true quand une ligne est partie", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    expect(await deleteTask(ROW.id)).toBe(true);
  });
});
