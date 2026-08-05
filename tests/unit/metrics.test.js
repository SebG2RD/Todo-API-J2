const request = require("supertest");
const app = require("../../src/app");
const { register } = require("../../src/metrics");

// Lit la valeur d'une série dans le texte exposé par /metrics.
// On travaille sur la sortie réelle, pas sur l'objet Registry : c'est ce texte
// que Prometheus lira, et c'est donc lui qu'il faut vérifier.
function valeur(texte, nom, labels = {}) {
  const attendus = Object.entries(labels);
  for (const ligne of texte.split("\n")) {
    if (!ligne.startsWith(`${nom}{`) && ligne !== nom) continue;
    if (attendus.every(([cle, val]) => ligne.includes(`${cle}="${val}"`))) {
      return Number(ligne.slice(ligne.lastIndexOf(" ") + 1));
    }
  }
  return 0;
}

async function lireMetrics() {
  const res = await request(app).get("/metrics");
  return res;
}

describe("l'endpoint /metrics", () => {
  test("répond en texte brut, jamais en JSON", async () => {
    const res = await lireMetrics();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.headers["content-type"]).not.toMatch(/json/);
  });

  test("expose les trois familles attendues, avec leur HELP et leur TYPE", async () => {
    const { text } = await lireMetrics();

    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain("# TYPE http_request_duration_seconds histogram");
    expect(text).toContain("# TYPE todo_tasks_created_total counter");
    expect(text).toContain("# HELP http_requests_total");
  });

  test("expose aussi les métriques de saturation du process", async () => {
    const { text } = await lireMetrics();

    expect(text).toMatch(/process_resident_memory_bytes/);
    expect(text).toMatch(/nodejs_eventloop_lag_seconds/);
  });
});

describe("le comptage des requêtes", () => {
  test("trois appels sur la même route font monter le compteur de trois", async () => {
    const avant = valeur(
      (await lireMetrics()).text,
      "http_requests_total",
      { method: "GET", route: "/health", status: "200" },
    );

    await request(app).get("/health");
    await request(app).get("/health");
    await request(app).get("/health");

    const apres = valeur(
      (await lireMetrics()).text,
      "http_requests_total",
      { method: "GET", route: "/health", status: "200" },
    );

    expect(apres - avant).toBe(3);
  });

  test("une route inconnue en 404 est comptée elle aussi", async () => {
    const avant = valeur((await lireMetrics()).text, "http_requests_total", {
      route: "<inconnue>",
      status: "404",
    });

    await request(app).get("/cette-route-nexiste-pas");

    const apres = valeur((await lireMetrics()).text, "http_requests_total", {
      route: "<inconnue>",
      status: "404",
    });

    expect(apres - avant).toBe(1);
  });

  test("les scrapes de Prometheus ne se comptent pas eux-mêmes", async () => {
    const avant = valeur((await lireMetrics()).text, "http_requests_total", {
      route: "/metrics",
    });
    await lireMetrics();
    const apres = valeur((await lireMetrics()).text, "http_requests_total", {
      route: "/metrics",
    });

    expect(avant).toBe(0);
    expect(apres).toBe(0);
  });
});

describe("le piège de la cardinalité", () => {
  test("l'identifiant d'une tâche n'apparaît jamais en label", async () => {
    const id = "0557ad6b-5875-42dc-bdb9-ff0389ea6d49";

    // Un GET sur un id inexistant suffit : la route est déclarée, donc comptée.
    await request(app).get(`/api/tasks/${id}`).catch(() => {});

    const { text } = await lireMetrics();

    expect(text).not.toContain(id);
    // C'est la route déclarée qui sert d'étiquette, pas l'URL réelle.
    expect(text).toContain('route="/api/tasks/:id"');
  });
});

describe("l'histogramme de latence", () => {
  test("chaque requête alimente les tranches, la somme et le compte", async () => {
    await request(app).get("/health");

    const { text } = await lireMetrics();

    expect(text).toMatch(/http_request_duration_seconds_bucket\{.*le="0\.05"/);
    expect(text).toMatch(/http_request_duration_seconds_sum\{/);
    expect(text).toMatch(/http_request_duration_seconds_count\{/);
  });
});

afterAll(() => {
  register.clear();
});
