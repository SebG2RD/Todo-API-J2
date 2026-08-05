// Rejoue db/schema.sql sur la base pointée par les variables d'environnement,
// puis rend la main. C'est ce que la pipeline lance avant les tests
// d'intégration : sans schéma, le premier test échouerait sur une table
// inexistante, et on croirait à un bug du code.
require("dotenv").config();

const { connectWithRetry, getPool } = require("../src/db");

async function migrer() {
  // Les mêmes tentatives qu'au démarrage de l'API : en CI, le conteneur
  // Postgres accepte parfois les connexions une seconde après le job.
  await connectWithRetry();
  console.log("Schéma appliqué sur", process.env.DB_NAME);
}

migrer()
  .then(() => getPool().end())
  .catch(async (err) => {
    console.error("Migration impossible :", err.message);
    await getPool().end().catch(() => {});
    process.exit(1);
  });
