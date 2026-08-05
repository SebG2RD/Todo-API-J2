const client = require("prom-client");

// Un Registry rassemble toutes les métriques de l'application. On lui demande
// aussi les métriques standard du process (mémoire, CPU, boucle d'événements) :
// c'est ce qui répond au quatrième golden signal, la saturation, sans écrire
// une ligne de code de plus.
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Trafic et erreurs. Trois labels suffisent à répondre à « quelle route casse ».
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Nombre total de requêtes HTTP servies",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

// Latence. Les tranches sont en secondes, calées sur le profil réel de l'API :
// des réponses de quelques dizaines de millisecondes, et une queue à surveiller
// au-delà de la seconde, là où le pool PostgreSQL commence à faire attendre.
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Durée des requêtes HTTP en secondes",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// La métrique métier, celle que personne d'autre ne peut deviner : combien de
// tâches cette instance a créées depuis son démarrage. Un redémarrage la remet
// à zéro, et c'est justement l'information qu'on veut voir sur un graphique.
const tasksCreatedTotal = new client.Counter({
  name: "todo_tasks_created_total",
  help: "Nombre de tâches créées depuis le démarrage de l'application",
  registers: [register],
});

// Seconde métrique métier : l'état réel de la base, pas un cumul. C'est un
// gauge, puisque la valeur monte et descend au gré des suppressions.
const tasksInDatabase = new client.Gauge({
  name: "todo_tasks_in_database",
  help: "Nombre de tâches actuellement présentes en base",
  registers: [register],
});

// Cette valeur est rafraîchie en tâche de fond, JAMAIS pendant le scrape.
//
// La première version interrogeait la base dans un callback `collect()` de
// prom-client, donc à chaque lecture de /metrics. Mesuré en coupant la base :
// la requête attendait les 3 s de connectionTimeoutMillis, /metrics dépassait
// le scrape_timeout de Prometheus, et `up` tombait à 0 alors que
// l'application répondait encore parfaitement sur /health. Autrement dit, la
// supervision devenait aveugle exactement au moment où elle servait, et
// affichait « application morte » pour une panne de base.
//
// En sortant la requête du chemin du scrape, /metrics ne dépend plus de la
// base : `up` reste à 1, et c'est l'explosion des 503 sur http_requests_total
// qui signale la panne. Deux pannes différentes, deux signatures différentes.
function demarrerCollecteMetier({ intervalleMs = 10000 } = {}) {
  const rafraichir = async () => {
    // Chargé ici et pas en tête de fichier : src/db.js et src/metrics.js
    // s'appelleraient mutuellement au chargement sinon.
    const { query } = require("./db");
    try {
      const { rows } = await query("SELECT count(*)::int AS n FROM tasks");
      tasksInDatabase.set(rows[0].n);
    } catch {
      // Base injoignable : le gauge garde sa dernière valeur connue plutôt que
      // de faire échouer la collecte. Une valeur figée se repère à l'œil sur un
      // graphique ; un /metrics muet ne se repère pas du tout.
    }
  };

  rafraichir();
  const minuteur = setInterval(rafraichir, intervalleMs);
  // Sans unref, ce minuteur empêcherait le process de se terminer, et un
  // `docker stop` attendrait le délai de grâce complet à chaque déploiement.
  minuteur.unref();
  return minuteur;
}

// Le nom de la route déclarée, jamais l'URL réelle. « /api/tasks/:id » prend
// une seule série ; « /api/tasks/0557ad6b-... » en prendrait une par tâche, et
// Prometheus finirait par consommer toute la mémoire de la machine.
function routeLabel(req) {
  if (!req.route) {
    // Une route inconnue répond 404 et doit être comptée, sinon la moitié des
    // erreurs devient invisible. Mais elle est comptée sous une étiquette fixe :
    // req.path serait à cardinalité illimitée, un scanner de vulnérabilités
    // suffirait à faire tomber Prometheus.
    return "<inconnue>";
  }

  // metricsBaseUrl est figé à l'entrée du routeur (voir src/routes/tasks.js) :
  // req.baseUrl, lui, est déjà remis à vide quand `finish` se déclenche.
  const base = req.metricsBaseUrl || req.baseUrl || "";
  // Sur un routeur monté, la racine s'écrit "/" : la coller à baseUrl donnerait
  // « /api/tasks/ » au lieu de « /api/tasks ».
  const chemin = req.route.path === "/" && base ? "" : req.route.path;
  return `${base}${chemin}` || "/";
}

function metricsMiddleware(req, res, next) {
  // Prometheus scrape /metrics toutes les cinq secondes : les compter
  // gonflerait le panneau Trafic d'un bruit de fond constant qui n'a rien à
  // voir avec l'usage réel de l'API.
  if (req.path === "/metrics") return next();

  const stopTimer = httpRequestDuration.startTimer();

  // `finish` et pas la fin du handler : le chrono s'arrête quand la réponse
  // est réellement partie, en incluant la sérialisation JSON.
  res.on("finish", () => {
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status: res.statusCode,
    };
    httpRequestsTotal.inc(labels);
    stopTimer(labels);
  });

  next();
}

module.exports = {
  register,
  metricsMiddleware,
  tasksCreatedTotal,
  tasksInDatabase,
  demarrerCollecteMetier,
};
