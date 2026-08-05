// Ces tests parlent à un vrai PostgreSQL, pas à un faux « db » programmé pour
// dire oui. C'est la seule façon de voir ce qu'un mock ne verra jamais : une
// colonne absente, une contrainte NOT NULL, un type qui ne correspond pas.
//
// En local :   docker compose -f docker-compose.test.yml up -d
//              npm run migrate && npm run test:integration
// En CI :      un conteneur de service, lancé et détruit avec le job.
const request = require("supertest");
const app = require("../../src/app");
const { query, getPool, connectWithRetry } = require("../../src/db");

beforeAll(async () => {
  // Le schéma doit exister avant le premier test. Le rejouer ici rend la suite
  // exécutable seule, sans dépendre d'un `npm run migrate` lancé avant.
  await connectWithRetry({ attempts: 15, delayMs: 1000 });
}, 30000);

// Chaque test repart d'une table vide. Sans cela, le comptage du test « la
// tâche a disparu de la liste » dépendrait de ce qu'un autre test a laissé,
// et la suite deviendrait sensible à son propre ordre d'exécution.
beforeEach(async () => {
  await query("TRUNCATE TABLE tasks");
});

afterAll(async () => {
  // Sans cette fermeture, Jest garde la main sur un pool ouvert et le process
  // ne rend jamais la main en CI.
  await getPool().end();
});

async function creer(corps) {
  return request(app).post("/api/tasks").send(corps);
}

describe("créer une tâche puis la relire", () => {
  test("ce qui est relu est exactement ce qui a été envoyé", async () => {
    const creation = await creer({
      description: "Acheter du pain",
      status: "in-progress",
    });

    expect(creation.status).toBe(201);
    expect(creation.headers.location).toBe(`/api/tasks/${creation.body.id}`);

    const relecture = await request(app).get(`/api/tasks/${creation.body.id}`);

    expect(relecture.status).toBe(200);
    expect(relecture.body.description).toBe("Acheter du pain");
    expect(relecture.body.status).toBe("in-progress");
    expect(relecture.body.id).toBe(creation.body.id);
    expect(relecture.body.createdAt).toBe(creation.body.createdAt);
  });

  test("la tâche existe vraiment en base, pas seulement dans la réponse", async () => {
    const { body } = await creer({ description: "Vérifier en SQL" });

    // On court-circuite l'API : si la ligne n'était pas écrite, la réponse 201
    // aurait menti, et seul un SELECT direct pouvait le dire.
    const { rows } = await query(
      "SELECT description, status FROM tasks WHERE id = $1",
      [body.id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("Vérifier en SQL");
    expect(rows[0].status).toBe("pending");
  });

  test("le statut par défaut est posé par le code, pas par la base", async () => {
    const { body } = await creer({ description: "Sans statut" });
    expect(body.status).toBe("pending");
  });
});

describe("demander une tâche qui n'existe pas", () => {
  test("un UUID valide mais absent donne un 404 propre, pas un 500", async () => {
    const absent = "11111111-2222-3333-4444-555555555555";

    const res = await request(app).get(`/api/tasks/${absent}`);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain(absent);
  });

  test("un identifiant mal formé donne aussi un 404, pas une erreur SQL", async () => {
    // Envoyé tel quel à Postgres, ce texte déclencherait une erreur 22P02
    // « invalid input syntax for type uuid », remontée en 500.
    const res = await request(app).get("/api/tasks/pas-un-uuid");

    expect(res.status).toBe(404);
  });
});

describe("un corps de requête invalide", () => {
  test("sans description, 400 et rien n'est écrit en base", async () => {
    const res = await creer({ status: "done" });

    expect(res.status).toBe(400);
    const { rows } = await query("SELECT count(*)::int AS n FROM tasks");
    expect(rows[0].n).toBe(0);
  });

  test("une description au-delà de la limite est refusée en 400", async () => {
    const res = await creer({ description: "x".repeat(501) });

    expect(res.status).toBe(400);
    const { rows } = await query("SELECT count(*)::int AS n FROM tasks");
    expect(rows[0].n).toBe(0);
  });

  test("un statut hors liste est refusé avant d'atteindre la base", async () => {
    const res = await creer({ description: "Valide", status: "presque" });

    expect(res.status).toBe(400);
    const { rows } = await query("SELECT count(*)::int AS n FROM tasks");
    expect(rows[0].n).toBe(0);
  });
});

describe("supprimer une tâche", () => {
  test("après un DELETE, elle a disparu de la liste et de la base", async () => {
    const gardee = await creer({ description: "Celle qui reste" });
    const supprimee = await creer({ description: "Celle qui part" });

    const suppression = await request(app).delete(
      `/api/tasks/${supprimee.body.id}`,
    );
    expect(suppression.status).toBe(204);

    const liste = await request(app).get("/api/tasks");
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(1);
    expect(liste.body[0].id).toBe(gardee.body.id);

    const relecture = await request(app).get(`/api/tasks/${supprimee.body.id}`);
    expect(relecture.status).toBe(404);
  });

  test("supprimer deux fois la même tâche donne un 404 au second passage", async () => {
    const { body } = await creer({ description: "À supprimer" });

    expect((await request(app).delete(`/api/tasks/${body.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/tasks/${body.id}`)).status).toBe(404);
  });
});

describe("modifier une tâche", () => {
  test("PUT met à jour updated_at et laisse created_at intact", async () => {
    const { body } = await creer({ description: "Avant" });

    const modification = await request(app)
      .put(`/api/tasks/${body.id}`)
      .send({ description: "Après", status: "done" });

    expect(modification.status).toBe(200);
    expect(modification.body.description).toBe("Après");
    expect(modification.body.status).toBe("done");
    expect(modification.body.createdAt).toBe(body.createdAt);
    expect(
      new Date(modification.body.updatedAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(body.updatedAt).getTime());
  });

  test("PUT sans statut conserve celui déjà en base", async () => {
    const { body } = await creer({
      description: "Avec statut",
      status: "in-progress",
    });

    const modification = await request(app)
      .put(`/api/tasks/${body.id}`)
      .send({ description: "Description changée" });

    expect(modification.status).toBe(200);
    expect(modification.body.status).toBe("in-progress");
  });
});
