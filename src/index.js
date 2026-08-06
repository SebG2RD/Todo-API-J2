// Charge le .env avant tout require qui lit process.env.
require("dotenv").config();

const app = require("./app");
const { connectWithRetry, getPool } = require("./db");
const { demarrerCollecteMetier } = require("./metrics");

const port = process.env.PORT || 3000;

// Combien de temps on s'autorise pour finir les requêtes en cours avant de
// couper net. Doit rester sous le terminationGracePeriodSeconds du pod, sinon
// c'est Kubernetes qui tranche à notre place, au SIGKILL.
const DELAI_ARRET_MS = 10000;

async function start() {
  await connectWithRetry();
  console.log("Base de données prête");

  // Démarré ici et pas dans app.js : un test qui importe l'app ne doit pas
  // ouvrir de connexion à une base, ni laisser un minuteur derrière lui.
  demarrerCollecteMetier();

  const server = app.listen(port, () =>
    console.log(`app listening on http://localhost:${port}`),
  );

  // Arrêt propre.
  //
  // Le conteneur lance `node` directement, donc le process est PID 1. Or le
  // noyau ignore, pour PID 1, tout signal dont le process n'a pas installé de
  // gestionnaire. Sans les deux lignes plus bas, l'application ne réagissait
  // donc pas au SIGTERM que Kubernetes envoie avant de retirer un pod : elle
  // attendait les 30 s de délai de grâce, puis se faisait tuer au SIGKILL.
  // Vérifié à la main : un `kill -TERM 1` comme un `kill -KILL 1` depuis
  // l'intérieur du conteneur restaient tous les deux sans effet.
  //
  // Conséquence pratique : chaque mise à jour traînait, et le pool PostgreSQL
  // n'était jamais fermé proprement.
  let arretEnCours = false;

  function arreter(signal) {
    if (arretEnCours) return;
    arretEnCours = true;
    console.log(`${signal} reçu, arrêt en cours`);

    // close() cesse d'accepter de nouvelles connexions et attend la fin des
    // requêtes déjà commencées. Le pod est déjà sorti des endpoints du Service
    // à ce moment-là, donc plus rien de neuf n'arrive.
    server.close(async () => {
      await getPool()
        .end()
        .catch(() => {});
      console.log("Arrêt terminé");
      process.exit(0);
    });

    // Filet : une requête pendue ne doit pas retenir l'arrêt indéfiniment.
    setTimeout(() => {
      console.error("Arrêt forcé : des connexions n'ont pas fini à temps");
      process.exit(1);
    }, DELAI_ARRET_MS).unref();
  }

  process.on("SIGTERM", () => arreter("SIGTERM"));
  process.on("SIGINT", () => arreter("SIGINT"));
}

start().catch((err) => {
  console.error("Démarrage impossible :", err.message);
  process.exit(1);
});
