// `expose` marque un message écrit pour le client : il traverse le gestionnaire
// tel quel, même sur un 5xx (un 503 "base injoignable" doit rester lisible).
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function notFound(req, res, next) {
  next(httpError(404, `Route inconnue : ${req.method} ${req.originalUrl}`));
}

// Quatre paramètres : c'est à ça qu'Express reconnaît un gestionnaire d'erreurs.
// Retirer `next` en ferait un middleware ordinaire.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    console.error(err);
  }

  const masked = status >= 500 && !err.expose;

  res.status(status).json({
    error: {
      status,
      message: masked ? "Erreur interne du serveur" : err.message,
    },
  });
}

module.exports = { httpError, notFound, errorHandler };
