// Charge le .env avant tout require qui lit process.env.
require("dotenv").config();

const app = require("./app");
const { connectWithRetry } = require("./db");

const port = process.env.PORT || 3000;

async function start() {
  await connectWithRetry();
  console.log("Base de données prête");

  app.listen(port, () =>
    console.log(`app listening on http://localhost:${port}`),
  );
}

start().catch((err) => {
  console.error("Démarrage impossible :", err.message);
  process.exit(1);
});
