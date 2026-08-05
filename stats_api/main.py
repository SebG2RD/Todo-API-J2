import os

import psycopg2
from fastapi import FastAPI, HTTPException

app = FastAPI()

# Noms réels du schéma créé par l'API Node.js (src/db.js).
TABLE_NAME = "tasks"
STATUS_COLUMN = "status"

# Les états attendus, listés ici pour garantir des compteurs à zéro même quand
# un état n'a aucune ligne en base. Ce sont ceux de src/models/task.js.
KNOWN_STATUSES = ["pending", "in-progress", "done"]


def get_connection():
    # Mêmes clés que celles lues par l'API Node.js : les deux services
    # partagent la configuration du .env.
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        connect_timeout=3,
    )


@app.get("/health")
def health():
    # Volontairement indépendant de Postgres : un souci de base ne doit pas
    # faire passer le conteneur pour mort aux yeux du HEALTHCHECK.
    return {"status": "ok"}


@app.get("/stats")
def get_stats():
    counts = {status: 0 for status in KNOWN_STATUSES}

    try:
        conn = get_connection()
    except psycopg2.OperationalError:
        # Jamais de stacktrace brute renvoyée au client.
        raise HTTPException(
            status_code=503,
            detail="stats-api ne parvient pas à joindre la base de données",
        )

    try:
        with conn.cursor() as cursor:
            # TABLE_NAME et STATUS_COLUMN sont des constantes internes, jamais
            # une entrée utilisateur : pas de risque d'injection SQL ici.
            cursor.execute(
                f"SELECT {STATUS_COLUMN}, COUNT(*) FROM {TABLE_NAME} "
                f"GROUP BY {STATUS_COLUMN}"
            )
            for status, count in cursor.fetchall():
                counts[status] = count
    finally:
        conn.close()

    return counts
