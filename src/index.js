// Charge le .env avant tout require qui lit process.env.
require("dotenv").config();

const app = require("./app");
const { connectWithRetry } = require("./db");
const { demarrerCollecteMetier } = require("./metrics");

const port = process.env.PORT || 3000;

async function start() {
  await connectWithRetry();
  console.log("Base de données prête");

  // Démarré ici et pas dans app.js : un test qui importe l'app ne doit pas
  // ouvrir de connexion à une base, ni laisser un minuteur derrière lui.
  demarrerCollecteMetier();

  app.listen(port, () =>
    console.log(`app listening on http://localhost:${port}`),
  );
}

start().catch((err) => {
  console.error("Démarrage impossible :", err.message);
  process.exit(1);
});
