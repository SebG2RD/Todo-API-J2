// Ces cas-là sont refusés par la validation avant que la moindre requête SQL
// soit envoyée : ils se testent donc sans base, contre l'app Express elle-même.
// supertest envoie de vraies requêtes HTTP à `app`, sans ouvrir de port.
const request = require("supertest");
const app = require("../../src/app");
const { MAX_DESCRIPTION_LENGTH } = require("../../src/models/task");

describe("les routes qui ne dépendent pas de la base", () => {
  test("GET /health répond 200 avec un horodatage", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(new Date(res.body.timestamp).toString()).not.toBe("Invalid Date");
  });

  test("une route inconnue répond 404 en JSON, pas en HTML", async () => {
    const res = await request(app).get("/nexiste-pas");

    expect(res.status).toBe(404);
    expect(res.body.error.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  test("helmet retire l'en-tête qui annonce la techno du serveur", async () => {
    const res = await request(app).get("/health");

    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("le corps de requête refusé avant d'atteindre la base", () => {
  test("POST sans description répond 400", async () => {
    const res = await request(app).post("/api/tasks").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/description/);
  });

  test("POST avec une description vide répond 400", async () => {
    const res = await request(app).post("/api/tasks").send({ description: "   " });

    expect(res.status).toBe(400);
  });

  test("POST avec une description trop longue répond 400, pas 413", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .send({ description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(String(MAX_DESCRIPTION_LENGTH));
  });

  test("POST avec un statut hors liste répond 400", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .send({ description: "Acheter du pain", status: "presque-fini" });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/status/);
  });

  test("un corps au-delà de 100 kB est refusé en 413 par le parseur", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .send({ description: "x".repeat(200_000) });

    expect(res.status).toBe(413);
  });

  test("un id mal formé répond 404 sans jamais interroger la base", async () => {
    const res = await request(app).get("/api/tasks/pas-un-uuid");

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/pas-un-uuid/);
  });
});
