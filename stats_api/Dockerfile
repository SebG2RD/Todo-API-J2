# slim retire les paquets Debian non essentiels. Alpine existe aussi pour
# Python, mais certaines libs C y compilent moins bien.
FROM python:3.12-slim

# Pas de .pyc dans un conteneur éphémère.
ENV PYTHONDONTWRITEBYTECODE=1
# Sans ça, les logs restent coincés dans un buffer et n'apparaissent jamais
# dans docker logs.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Les dépendances d'abord, le code après : même logique que npm ci côté Node.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# python:slim ne fournit pas d'utilisateur non-root prêt à l'emploi.
RUN adduser --disabled-password --gecos "" appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# --host 0.0.0.0 est indispensable : sur 127.0.0.1, l'app ne serait joignable
# que depuis l'intérieur du conteneur.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
