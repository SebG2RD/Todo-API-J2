const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const taskRoutes = require("./routes/tasks");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

// helmet pose les en-têtes HTTP de sécurité. cors() sans argument accepte
// toutes les origines : à restreindre en production.
app.use(helmet());
app.use(cors());
// limit refuse les corps hors-normes (413) avant de les charger en mémoire.
app.use(express.json({ limit: "100kb" }));

// Volontairement indépendante de la base : un souci de base ne doit pas faire
// passer le conteneur lui-même pour mort aux yeux du HEALTHCHECK.
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

app.get("/", (req, res) => res.json({ message: "Bonjouuuur :)" }));

app.use("/api/tasks", taskRoutes);

// Ces deux-là restent les derniers déclarés, sinon ils répondraient avant les routes.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
