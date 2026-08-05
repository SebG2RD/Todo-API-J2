const { Pool } = require("pg");
const { httpError } = require("./middleware/errorHandler");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Copier .env.example vers .env et la renseigner.`,
    );
  }
  return value;
}

// Le pool est construit à la première utilisation, pas au chargement du module :
// une variable manquante remonte alors au démarrage sous forme de message lisible
// plutôt qu'en stacktrace brute pendant un require.
let pool;

function getPool() {
  if (pool) return pool;

  pool = new Pool({
    host: requireEnv("DB_HOST"),
    port: Number(process.env.DB_PORT) || 5432,
    database: requireEnv("DB_NAME"),
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    // Sans ce délai, une base injoignable laisse la requête HTTP pendue.
    connectionTimeoutMillis: 3000,
  });

  // Une erreur du pool hors requête (base tuée en cours de route) couperait le
  // process Node si personne ne l'écoutait.
  pool.on("error", (err) => {
    console.error("Erreur inattendue du pool PostgreSQL :", err.message);
  });

  return pool;
}

const CONNECTION_ERRORS = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now
]);

async function query(text, params) {
  try {
    return await getPool().query(text, params);
  } catch (err) {
    if (CONNECTION_ERRORS.has(err.code) || err.message.includes("timeout")) {
      throw httpError(503, "La base de données est injoignable, réessayer plus tard.");
    }
    throw err;
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id          UUID        PRIMARY KEY,
    description TEXT        NOT NULL,
    status      TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

// Postgres met quelques secondes à accepter des connexions après son démarrage.
async function connectWithRetry({ attempts = 10, delayMs = 1000 } = {}) {
  // Hors de la boucle : une erreur de configuration ne se réessaie pas.
  const db = getPool();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await db.query("SELECT 1");
      await db.query(SCHEMA);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      console.log(
        `Base injoignable (tentative ${attempt}/${attempts}) : ${err.message}. Nouvel essai dans ${delayMs} ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { getPool, query, connectWithRetry };
