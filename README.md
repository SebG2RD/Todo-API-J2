# Todo API

Une API REST en Node.js pour gérer des tâches (`Task`), adossée à PostgreSQL, avec un
second service de statistiques en Python. Toute la stack tourne sous Docker Compose.

Projet d'apprentissage. L'objectif est de créer une API Node de A à Z, puis de
l'empaqueter et de l'orchestrer avec Docker pour qu'elle tourne à l'identique sur
n'importe quelle machine.

## La stack

| Service     | Rôle                                          | Port hôte |
| ----------- | --------------------------------------------- | --------- |
| `api`       | L'API REST Node.js / Express                  | 3000      |
| `stats-api` | Service Python qui compte les tâches par état | 8000      |
| `db`        | PostgreSQL, données dans un volume nommé      | aucun     |
| `adminer`   | Interface web pour inspecter la base          | 8080      |

`db` ne publie aucun port : la base n'est joignable que par les autres conteneurs du
network `todo-network`.

## Ce que fait l'API

Un CRUD complet sur des tâches : créer, lister, consulter, modifier, supprimer. Les
données vivent dans PostgreSQL et survivent à l'arrêt comme à la suppression des
conteneurs.

### Routes

| Méthode  | Route            | Rôle                         | Réponse                       |
| -------- | ---------------- | ---------------------------- | ----------------------------- |
| `GET`    | `/`              | Message d'accueil            | `200` `{ message }`           |
| `GET`    | `/health`        | Vérifier que l'API répond    | `200` `{ status, timestamp }` |
| `GET`    | `/metrics`       | Mesures au format Prometheus | `200` texte brut              |
| `POST`   | `/api/tasks`     | Créer une tâche              | `201` + la tâche créée        |
| `GET`    | `/api/tasks`     | Lister toutes les tâches     | `200` + tableau de tâches     |
| `GET`    | `/api/tasks/:id` | Voir une tâche               | `200` + la tâche              |
| `PUT`    | `/api/tasks/:id` | Modifier une tâche           | `200` + la tâche modifiée     |
| `DELETE` | `/api/tasks/:id` | Supprimer une tâche          | `204` sans contenu            |

`/health` ne touche jamais la base : il répond `200` même quand PostgreSQL est
mort. C'est délibéré, pour qu'une panne de base ne fasse pas passer l'API pour
morte et ne déclenche pas de redémarrages inutiles. En astreinte, la
conséquence est directe : seul `/api/tasks` prouve que toute la chaîne
fonctionne.

Le service de statistiques, sur le port 8000 :

| Méthode | Route     | Rôle                           | Réponse                                |
| ------- | --------- | ------------------------------ | -------------------------------------- |
| `GET`   | `/health` | Vérifier que le service répond | `200` `{ status }`                     |
| `GET`   | `/stats`  | Nombre de tâches par état      | `200` `{ pending, in-progress, done }` |

**CRUD et REST ?** CRUD est l'acronyme des quatre opérations de base sur une donnée :
Create, Read, Update, Delete. REST (*Representational State Transfer*) est le style
d'architecture qui les expose en HTTP : chaque URL désigne une ressource, et c'est le
verbe HTTP (`POST`, `GET`, `PUT`, `DELETE`) qui dit ce qu'on veut en faire.

### Le modèle Task

```json
{
  "id": "0557ad6b-5875-42dc-bdb9-ff0389ea6d49",
  "description": "Acheter du pain",
  "status": "pending",
  "createdAt": "2026-08-03T13:55:36.069Z",
  "updatedAt": "2026-08-03T13:55:36.069Z"
}
```

| Champ         | Type               | Détail                                             |
| ------------- | ------------------ | -------------------------------------------------- |
| `id`          | UUID               | Généré par le serveur, jamais fourni par le client |
| `description` | string             | Obligatoire, non vide, 500 caractères maximum      |
| `status`      | string             | `pending` (défaut), `in-progress` ou `done`        |
| `createdAt`   | timestamp ISO 8601 | Posé à la création, jamais modifié ensuite         |
| `updatedAt`   | timestamp ISO 8601 | Rafraîchi à chaque `PUT`                           |

**UUID ?** *Universally Unique Identifier*. Un identifiant généré aléatoirement, assez
long pour qu'on puisse en créer des milliards sans jamais tomber deux fois sur le même.
Chaque tâche reçoit son `id` sans avoir besoin d'un compteur central qui saurait où on
en est.

En base, la table `tasks` est créée au démarrage si elle n'existe pas. Les colonnes
sont en `snake_case` (`created_at`, `updated_at`), l'API répond en `camelCase`.

Seuls `description` et `status` sont lus dans le corps de la requête. Tout autre champ
envoyé par le client est ignoré : il ne peut donc pas fabriquer son propre `id` ou son
propre `createdAt`.

`PUT` remplace la tâche, `description` doit être fournie. `status` reste facultatif et
conserve sa valeur actuelle s'il est absent.

### Réponses d'erreur

Toutes les erreurs sortent en JSON, avec le même format. Aucune stacktrace n'est
envoyée au client :

```json
{ "error": { "status": 404, "message": "Aucune tâche avec l'id inconnu." } }
```

| Code  | Quand                                                                          |
| ----- | ------------------------------------------------------------------------------ |
| `400` | JSON malformé, `description` manquante, vide ou trop longue, `status` invalide |
| `404` | Id inexistant, ou route inconnue                                               |
| `413` | Corps de requête au-delà de 100 kB, refusé avant d'être chargé en mémoire      |
| `503` | Base de données injoignable                                                    |
| `500` | Erreur imprévue : message générique côté client, détail dans les logs serveur  |

### Exemples

```bash
# Créer
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"description":"Acheter du pain"}'

# Lister
curl http://localhost:3000/api/tasks

# Consulter
curl http://localhost:3000/api/tasks/<id>

# Modifier
curl -X PUT http://localhost:3000/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{"description":"Acheter du pain complet","status":"in-progress"}'

# Supprimer
curl -X DELETE http://localhost:3000/api/tasks/<id>

# Statistiques
curl http://localhost:8000/stats
```

L'en-tête `Content-Type: application/json` est obligatoire sur `POST` et `PUT`. Sans
lui, Express ne lit pas le corps de la requête et l'API répond `400`.

## Prérequis

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org) 18 ou supérieur, seulement pour travailler le code hors
  conteneur

```bash
docker --version
node --version
```

## Lancer la stack

Copier le fichier d'exemple et renseigner ses valeurs :

```bash
cp .env.example .env
```

Puis démarrer les quatre services :

```bash
docker compose up -d --build
```

Vérifier :

```bash
docker compose ps
curl http://localhost:3000/health   # {"status":"ok","timestamp":"..."}
curl http://localhost:8000/stats    # {"pending":1,"in-progress":1,"done":1}
```

Adminer est sur <http://localhost:8080>. Le formulaire attend `db` comme serveur, puis
les valeurs de `DB_USER`, `DB_PASSWORD` et `DB_NAME` du `.env`.

Les commandes du quotidien :

```bash
docker compose logs -f          # suivre les logs de tous les services
docker compose ps               # état des conteneurs
docker compose stop             # arrêter sans rien supprimer
docker compose down             # supprimer les conteneurs, garder les données
docker compose down -v          # supprimer aussi le volume, les données sont perdues
```

## Lancer depuis les images publiées

Les deux images sont publiées sur Docker Hub. `docker-compose.prod.yml` les référence
au lieu de construire depuis les sources : un dossier contenant seulement ce fichier et
un `.env` suffit à démarrer la stack, sans une ligne de code source.

```bash
docker compose -f docker-compose.prod.yml up -d
```

Pour publier une nouvelle version :

```bash
docker login -u <pseudo>
docker tag todo-api-api:latest <pseudo>/todo-api:1.0.0
docker tag todo-api-stats-api:latest <pseudo>/stats-api:1.0.0
docker push <pseudo>/todo-api:1.0.0
docker push <pseudo>/stats-api:1.0.0
```

Le tag de version explicite compte : `latest` change de contenu à chaque push, sans
qu'aucune version ne le distingue du précédent.

## Variables d'environnement

Toutes vivent dans `.env`, qui n'est jamais commité. `.env.example` porte les mêmes
clés avec des valeurs bidons.

| Variable        | Exemple     | Rôle                                              |
| --------------- | ----------- | ------------------------------------------------- |
| `DB_HOST`       | `db`        | Nom du service Postgres dans le compose           |
| `DB_PORT`       | `5432`      | Port de la base                                   |
| `DB_NAME`       | `todo_db`   | Nom de la base                                    |
| `DB_USER`       | `todo_user` | Utilisateur PostgreSQL                            |
| `DB_PASSWORD`   |             | Mot de passe PostgreSQL                           |
| `API_PORT`      | `3000`      | Port publié pour l'API sur la machine hôte        |
| `STATS_PORT`    | `8000`      | Port publié pour le service de statistiques       |
| `ADMINER_PORT`  | `8080`      | Port publié pour Adminer                          |
| `REGISTRY_USER` |             | Compte Docker Hub, pour `docker-compose.prod.yml` |
| `IMAGE_TAG`     | `1.0.0`     | Version des images publiées                       |

`DB_HOST`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` sont obligatoires. L'une d'elles
manquante et le démarrage s'arrête avec le message correspondant, plutôt qu'un
`undefined` qui casserait trois couches plus loin.

L'API écoute toujours sur 3000 à l'intérieur du conteneur : seule la partie gauche du
mapping de port change avec `API_PORT`.

## Structure du projet

```text
Todo API/
├── .github/workflows/
│   ├── ci.yml                  # test → test-integration → build → deploy
│   └── verifier-runner.yml     # Preuve manuelle que le runner voit bien le cluster
├── k8s/                        # L'état voulu du cluster, un fichier par objet
│   ├── todo-api-deployment.yaml
│   ├── todo-api-service.yaml
│   ├── todo-config.yaml
│   ├── todo-secret.example.yaml  # Le vrai Secret n'entre jamais dans le dépôt
│   ├── todo-db.yaml            # PostgreSQL, sa PVC et son Service
│   └── todo-ingress.yaml
├── src/
│   ├── app.js                  # Câblage Express : middlewares, routes, erreurs
│   ├── index.js                # Point d'entrée : attend la base, puis écoute
│   ├── db.js                   # Pool PostgreSQL, schéma, erreurs de connexion
│   ├── metrics.js              # Registre Prometheus, compteurs, histogramme
│   ├── models/
│   │   └── task.js             # Modèle Task et requêtes SQL
│   ├── routes/
│   │   └── tasks.js            # Les 5 routes REST montées sur /api/tasks
│   └── middleware/
│       └── errorHandler.js     # Erreurs vers réponses JSON propres
├── db/
│   └── schema.sql              # Le schéma, source unique : app, CI et migration
├── scripts/
│   ├── migrate.js              # Rejoue db/schema.sql, avant les tests d'intégration
│   ├── incident.sh             # Cinq pannes tirées au sort, sur la machine du J3
│   ├── chaos.sh                # Cinq pannes tirées au sort, sur le cluster
│   └── charge.sh               # Charge continue, pour mesurer plutôt que croire
├── deploy/                     # Ce qui part sur la machine cible, et rien d'autre
│   ├── compose.yml             # Stack de prod : API, base, Prometheus, Grafana
│   ├── prometheus.yml          # Cibles et fréquence de collecte
│   ├── env.example             # Modèle du .env qui vit sur la cible, jamais versionné
│   └── grafana/
│       ├── dashboards/
│       │   └── todo-api.json   # Le tableau de bord des quatre signaux
│       └── provisioning/       # Source de données et déclaration des dashboards
├── docs/
│   └── PROCEDURE_DEPLOIEMENT.md  # Le document qu'on suit à 3 h du matin
├── stats_api/
│   ├── main.py                 # Service FastAPI : /health et /stats
│   ├── requirements.txt        # Dépendances Python épinglées
│   ├── Dockerfile              # Image du service Python
│   └── .dockerignore
├── tests/
│   ├── unit/                   # 26 tests, sans base : mocks et validation
│   └── integration/            # 12 tests contre un vrai PostgreSQL
├── Dockerfile                  # Image de l'API Node, multi-stage
├── Dockerfile.vm               # La machine cible en maquette : Docker + sshd
├── docker-compose.yml          # Stack de développement, images construites en local
├── docker-compose.prod.yml     # Stack de production, images tirées du registry
├── docker-compose.test.yml     # Base jetable pour les tests d'intégration en local
├── eslint.config.js            # Le premier filet de la pipeline
├── .dockerignore               # Fichiers exclus du contexte de build
├── .env.example                # Modèle de configuration, commité
├── .gitignore                  # node_modules, .env, clés SSH, PDF
├── package.json
└── package-lock.json
```

Ni `deploy_key`, ni `.env`, ni aucun mot de passe n'entre dans le dépôt. La
ligne du `.gitignore` qui exclut la clé privée a été écrite avant que la
paire existe : une clé poussée par erreur ne se rattrape pas avec un commit de
suppression, `git log` garde tout.

`app.js` et `index.js` sont séparés volontairement. `app.js` configure l'application et
l'exporte sans ouvrir de port, ce qui permettra à un test de l'importer directement.
`index.js` attend que la base réponde, prépare le schéma, puis met l'app en écoute.

## Scripts npm

| Commande                   | Effet                                                          |
| -------------------------- | -------------------------------------------------------------- |
| `npm start`                | Démarre le serveur (`node src/index.js`)                       |
| `npm run lint`             | ESLint sur tout le dépôt                                       |
| `npm test`                 | 26 tests unitaires, sans base                                  |
| `npm run test:integration` | 12 tests contre un vrai PostgreSQL                             |
| `npm run migrate`          | Rejoue `db/schema.sql` sur la base pointée par l'environnement |

`npm start` hors conteneur suppose une base joignable : la stack Compose ne publie pas
le port de Postgres, il faut donc l'ajouter temporairement pour travailler ainsi.

Pour lancer les tests d'intégration en local, une base jetable suffit :

```bash
docker compose -f docker-compose.test.yml up -d
DB_HOST=localhost DB_PORT=5433 DB_NAME=todo_test \
DB_USER=todo_test_user DB_PASSWORD=todo_test_password \
  npm run migrate && npm run test:integration
docker compose -f docker-compose.test.yml down -v
```

Le `-v` final compte : la base ne survit pas d'une session à l'autre. Un test
qui dépend d'une base « à peu près propre parce qu'on n'y a pas touché depuis
hier » n'est pas reproductible, et ne prouve donc rien.

## Stack technique

- **Node.js 22** et **Express 5** : l'API HTTP
- **PostgreSQL 16** : la persistance, dans un volume nommé
- **pg** : le client PostgreSQL côté Node
- **dotenv** : charge le `.env` dans `process.env`
- **helmet** : en-têtes HTTP de sécurité
- **cors** : autorise les appels venant d'un autre domaine
- **FastAPI** et **uvicorn** : le service de statistiques en Python
- **Adminer** : interface web d'administration de la base
- **Docker** et **Docker Compose** : construction des images et orchestration
- **prom-client** : produit la page `/metrics` que Prometheus vient lire
- **Prometheus** : collecte les mesures toutes les 5 secondes
- **Grafana** : les affiche, source de données et tableau de bord provisionnés
  par fichier
- **Jest** et **Supertest** : tests unitaires et tests d'intégration HTTP
- **ESLint** : le premier filet de la pipeline
- **GitHub Actions** : lint, tests, image, déploiement, avec un runner
  self-hosted pour la seule étape qui doit joindre le cluster
- **Kubernetes**, via **k3d** et **K3s** : le cluster où l'application tourne
- **Traefik** : le contrôleur d'entrée fourni par K3s

**CORS ?** *Cross-Origin Resource Sharing*. La règle du navigateur qui empêche, par
défaut, une page servie par un domaine d'appeler une API hébergée sur un autre domaine.
Le middleware sert à ouvrir explicitement cette porte quand c'est voulu.

## La chaîne de livraison

Un `git push` sur `main` suffit. Personne ne tape de commande, et l'application
part en production toute seule.

```text
push sur main
   ├─ test               ubuntu-latest    lint + 26 tests unitaires
   ├─ test-integration   ubuntu-latest    12 tests contre un PostgreSQL jetable
   ├─ build              ubuntu-latest    image taguée au sha, poussée sur Docker Hub
   └─ deploy             self-hosted      kubectl apply → rollout status → curl /api/tasks
```

### La cible : un cluster Kubernetes

L'application tourne dans un cluster k3d, `todo-cluster`, dans le namespace
`todo`. Trois copies de l'API se partagent le trafic derrière un Service, la
base garde ses données dans un volume qui survit à son pod, et Traefik expose
le tout sur `todo.localhost`.

```bash
k3d cluster create todo-cluster -p "8080:80@loadbalancer"
kubectl create namespace todo
kubectl create secret generic todo-secret -n todo \
  --from-literal=DB_NAME=todo_prod \
  --from-literal=DB_USER=todo_prod_user \
  --from-literal=DB_PASSWORD='<le mot de passe>'
kubectl apply -f k8s/
```

Vérifier :

```bash
kubectl get pods -n todo
curl -s -H "Host: todo.localhost" http://localhost:8080/api/tasks
```

Sous Docker Desktop, `k3d` écrit un kubeconfig qui pointe sur
`host.docker.internal`, lequel ne répond pas. Le § 6.7 de la procédure donne la
ligne qui corrige. C'est le premier obstacle du Jour 4, et il n'a rien à voir
avec Kubernetes.

| Objet | Rôle |
| --- | --- |
| `k8s/todo-api-deployment.yaml` | 3 replicas, sondes, ressources, stratégie de mise à jour |
| `k8s/todo-api-service.yaml` | Adresse stable devant des pods qui ne le sont pas |
| `k8s/todo-config.yaml` | Configuration non sensible, injectée par `envFrom` |
| `k8s/todo-secret.example.yaml` | Modèle du Secret. Le vrai n'est jamais versionné |
| `k8s/todo-db.yaml` | PostgreSQL, sa PVC et son Service |
| `k8s/todo-ingress.yaml` | La porte d'entrée, sur `todo.localhost` |

Le déploiement pousse l'état voulu en entier, pas seulement l'image : le nombre
de copies, les sondes et les ressources vivent dans les manifestes et partent
avec eux. Seul le tag vient d'ailleurs, du commit qui a déclenché la pipeline,
et il est substitué dans la copie de travail du runner. Un `kubectl apply` tapé
à la main sans cette substitution ferait reculer la production d'une version.

`vm-prod`, la machine cible du Jour 3, existe toujours mais reste arrêtée. Elle
se rallume d'un `docker start vm-prod` pour comparer les deux mondes.

Les trois premiers jobs tournent sur des machines fournies par GitHub, neuves à
chaque exécution. Seul `deploy` tourne sur un runner self-hosted, et c'est
une décision d'architecture, pas un contournement : la machine cible vit sur le
poste de travail, derrière une box, sans adresse publique. Un runner hébergé
dans un centre de données n'a aucun moyen de la joindre. On place donc
l'exécutrice du bon côté de la porte.

Une branche de travail déclenche les deux jobs de test et s'arrête là : rien
n'est publié, rien n'est déployé, et surtout aucun code non fusionné ne
s'exécute sur la machine personnelle.

### La machine cible

Une vraie machine de production demande un compte chez un hébergeur. Elle est
remplacée par une maquette, décrite dans `Dockerfile.vm` : un conteneur qui
embarque son propre daemon Docker et un serveur SSH. Du point de vue de la
pipeline, rien ne la distingue d'un vrai serveur : une adresse, un port, un
utilisateur, une clé, un Docker au bout. Et son Docker ne voit aucun conteneur
du poste de travail : une panne en « production » ne touche jamais
l'environnement de développement.

```bash
ssh-keygen -t ed25519 -N "" -f deploy_key -C "deploy@todo-api"
docker build -f Dockerfile.vm -t vm-prod .
docker run -d --privileged --name vm-prod \
  -p 2222:22 -p 3000:3000 -p 9090:9090 -p 3001:3001 \
  -v vm-prod-data:/var/lib/docker vm-prod
```

Le volume `vm-prod-data` garde images et conteneurs entre deux redémarrages.
Le compte utilisé est `root` : sur une vraie machine, ce serait un compte de
service appartenant au groupe `docker` et rien de plus, sans `sudo`. La
simplification est assumée, la maquette étant jetable et injoignable depuis
l'extérieur.

### Secrets attendus par la pipeline

| Secret | Rôle |
| --- | --- |
| `DOCKERHUB_USERNAME` | Compte du registry, sert aussi à composer le nom de l'image |
| `DOCKERHUB_TOKEN` | Jeton d'accès Docker Hub, portée Read & Write |
| `DEPLOY_SSH_KEY` | Contenu de `deploy_key`, chargé dans un agent SSH, jamais écrit sur le disque du runner |
| `DEPLOY_HOST` | `localhost` |
| `DEPLOY_PORT` | `2222` |
| `DEPLOY_USER` | `root` |

### Surveillance

Prometheus et Grafana vivent dans le même `compose.yml` que l'API, sur le même
réseau : Prometheus joint l'application par son nom de service, sans qu'un
seul port soit publié pour ça.

- Grafana : <http://localhost:3001>, tableau de bord **Todo API, les quatre
  signaux**, lecture anonyme activée pour qu'un camarade d'astreinte n'ait pas
  à réclamer un mot de passe.
- Prometheus : <http://localhost:9090>, `scrape_interval` de 5 s.

La source de données et le tableau de bord sont provisionnés par fichier, donc
versionnés : ils survivent à un `docker compose down -v` et se relisent dans
une pull request.

En cas de panne, la marche à suivre est dans
[`docs/PROCEDURE_DEPLOIEMENT.md`](docs/PROCEDURE_DEPLOIEMENT.md), avec les
signatures mesurées de chaque panne connue et la commande de retour arrière.

## Journal de bord

Une entrée par chapitre : ce qui a été mesuré, ce qui a cassé, et pourquoi.

### Chapitres 1 à 4 : DevOps, conteneurs, première image

Mesuré : `npm start` démarre un serveur Express qui répond `{"message":"Bonjouuuur :)"}`
sur `/`, port 3000. Image construite depuis `node:18`, le conteneur sert la même réponse
sur le même port. `.dockerignore` exclut `node_modules` du contexte de build, pour que
`npm install` s'exécute dans l'environnement Linux du conteneur au lieu d'y recopier des
modules compilés pour Windows.

Cassé : *à compléter.*

### Le socle : la Todo API (CRUD)

Les 3 cas demandés ont été rejoués à la main avec `curl` contre le serveur local. Tous
passent :

| Cas                                              | Résultat mesuré                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Création puis `GET /api/tasks`                   | `201` avec `id` UUID généré, puis la tâche apparaît dans la liste                                |
| `GET /api/tasks/:id` sur un id inexistant        | `404` `{"error":{"status":404,"message":"Aucune tâche avec l'id ..."}}`, process toujours debout |
| `POST` avec JSON malformé                        | `400` `Unexpected end of JSON input`                                                             |
| `POST` avec une description de 50 000 caractères | `400` `Le champ \`description\` ne doit pas dépasser 500 caractères.`                            |

Premier accroc, sur ce dernier cas. La limite de taille était d'abord posée sur le
parseur seul (`express.json({ limit: "10kb" })`). Une description de 50 000 caractères
se faisait bien refuser, mais avec un `413 request entity too large`, message générique
qui ne dit pas quel champ pose problème. La limite du parseur est passée à 100 kB, et
une limite métier de 500 caractères a été ajoutée dans la validation. Il y a donc deux
lignes de défense : la validation répond un `400` clair sur les corps réalistes, le
parseur reprend la main en `413` au-delà de 100 kB (vérifié avec un corps de 500 000
caractères). Le serveur répond normalement après chaque tentative, aucun crash.

Deuxième accroc : un `POST` sans en-tête `Content-Type: application/json` laisse
`req.body` à `undefined` en Express 5. Sans garde, lire `body.description` aurait levé
un `TypeError`, transformé en `500`. La validation vérifie donc d'abord que le corps est
bien un objet, et le message d'erreur rappelle l'en-tête manquant.

Le gestionnaire d'erreurs masque le message des erreurs `500` côté client, qui peut
exposer des détails internes, et ne le trace qu'en console. Les codes `4xx` gardent leur
message, puisqu'ils expliquent au client ce qu'il a mal fait.

### Le câblage de l'application : app.js, sécurité, health check

`src/app.js` regroupe le câblage (helmet, cors, parsing JSON, `/health`, montage des
routes, gestion d'erreurs) et exporte l'app. `src/index.js` ne fait plus que l'écoute
réseau.

Mesuré, en-têtes réellement renvoyés par `/health` après l'ajout de helmet :
`Content-Security-Policy`, `Strict-Transport-Security: max-age=31536000`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`X-DNS-Prefetch-Control: off`, `X-Permitted-Cross-Domain-Policies: none`. helmet
supprime aussi le `X-Powered-By: Express` qui annonçait la techno du serveur. `cors()`
sans argument renvoie `Access-Control-Allow-Origin: *` : toutes les origines sont
acceptées, à restreindre le jour d'une mise en production.

Cassé : le premier test du conteneur renvoyait `Cannot POST /api/tasks` alors que le
code était bon. En cause, un conteneur `todo-app` encore lancé, qui servait l'image
précédente, celle d'avant les routes. `docker run` l'avait signalé
(`Conflict. The container name "/todo-app" is already in use`), message noyé dans la
sortie du build. À retenir : `docker rm -f todo-app` puis `docker build` avant tout test
conteneur, sinon on teste l'ancien code en croyant tester le nouveau.

Note d'implémentation : `errorHandler.js` exporte trois choses (`errorHandler`,
`notFound` et un helper `httpError`). L'import dans `app.js` est donc destructuré,
`const { notFound, errorHandler } = require(...)`, et non direct.

### Chapitre 5 : le Dockerfile de production

Le Dockerfile du matin marchait, mais il faisait tout ce qu'il ne faut pas faire :
`FROM node:18` sans version précise, un seul stage, `npm install` avec les dépendances
de développement, et le process en root.

Mesures avant et après, sur la même machine :

| Mesure                                     | Avant      | Après  |
| ------------------------------------------ | ---------- | ------ |
| Taille (`docker images`)                   | 1,58 Go    | 231 Mo |
| Taille compressée (`docker image inspect`) | 381 Mo     | 56 Mo  |
| Build à froid (`--no-cache`)               | 5,3 s      | 5,9 s  |
| Build à chaud                              | 3,1 s      | 2,2 s  |
| Utilisateur du process                     | `root`     | `node` |
| Temps jusqu'à la 1re réponse HTTP 200      | non mesuré | 855 ms |

Piège de mesure rencontré ici : `docker images` et `docker image inspect` ne renvoient
pas le même chiffre pour la même image. Le premier donne la taille décompressée sur
disque, le second la somme des couches compressées, celle qui transite réellement à
chaque `pull`. Les deux sont vraies, mais les mélanger dans un même tableau ne veut plus
rien dire. Le cours parle de `docker images` : c'est cette colonne qui fait foi ici.

Les cinq critères vérifiés un par un :

- `FROM node:22.14.0-alpine`, version épinglée, aucun `latest`.
- `docker run --rm todo-api ls -a` ne liste que `node_modules`, `package.json` et `src`.
  Ni `.git`, ni `.env`, ni log. La ligne `transferring context` du build affiche
  **414 B**, contre des dizaines de Mo si `node_modules` n'était pas ignoré.
- `docker run --rm todo-api sh -c whoami` répond `node`, plus jamais `root`.
- Build multi-stage : `docker run --rm todo-api ls node_modules | grep -c jest`
  répond `0`.
- Cache protégé : après modification d'un seul fichier de `src/`, le build affiche
  `CACHED` sur `RUN npm ci --omit=dev` et ne reconstruit que la couche `COPY src`.

Le build à froid ne s'améliore pas (5,9 s contre 5,3 s), ce qui est logique : deux
stages à construire au lieu d'un. Le chiffre qui compte au quotidien est le build à
chaud, passé de 3,1 s à 2,2 s. Le vrai gain est ailleurs : 1,58 Go à 231 Mo.

Le `HEALTHCHECK` passe l'état du conteneur à `healthy` après le `start-period` de 5 s,
vérifié avec `docker inspect --format '{{.State.Health.Status}}'`. Sans lui, un
conteneur planté en boucle resterait affiché `Up` sans que personne ne soit alerté.

### Chapitre 6 : networks et volumes

**Mission A, la persistance.** Postgres lancé à la main, avec un volume nommé
`todo_pgdata` :

```bash
docker volume create todo_pgdata
docker run -d --name todo-postgres \
  -e POSTGRES_DB=todo_db -e POSTGRES_USER=todo_user -e POSTGRES_PASSWORD=$DB_PASSWORD \
  -p 5432:5432 \
  -v todo_pgdata:/var/lib/postgresql/data \
  postgres:16.4-alpine
```

La limite du bridge par défaut se vérifie tout de suite. Avec `DB_HOST=todo-postgres`,
l'API ne trouve pas la base : `Connection terminated due to connection timeout`, en
boucle sur les 10 tentatives de reconnexion. Avec `DB_HOST=172.17.0.2`, l'IP interne
lue par `docker inspect`, elle se connecte du premier coup. Deux conteneurs sur la même
machine, et aucun nom résolu : c'est exactement ce que corrige la mission B.

La persistance tient les deux tests demandés. Une tâche créée via l'API est toujours là
après `docker stop` puis `docker start`, et toujours là après un `docker rm` du
conteneur suivi d'un conteneur tout neuf pointé sur le même volume. Le volume vit
indépendamment du conteneur qui le monte.

Le décompte des étapes manuelles pour arriver là : un `docker volume create`, un
`docker run` Postgres de 6 lignes, un `docker build`, un `docker run` API de 5 lignes,
et un `docker inspect` au milieu pour retrouver une IP qui peut changer. Tout est à
retaper à chaque redémarrage de la machine.

**Mission B, l'isolation réseau.** `docker network create todo-network`, les deux
conteneurs relancés dessus, et le `-p 5432:5432` retiré de Postgres.

| Vérification                                | Résultat                   |
| ------------------------------------------- | -------------------------- |
| API connectée par `DB_HOST=todo-postgres`   | `Base de données prête`    |
| Données d'avant toujours présentes          | oui, même volume           |
| `GET /:id`, `PUT`, `DELETE`, `GET` supprimé | `200`, `200`, `204`, `404` |
| Connexion TCP au port 5432 depuis l'hôte    | `ECONNREFUSED`             |
| `docker network inspect todo-network`       | `todo-app todo-postgres`   |

Le `ECONNREFUSED` est le comportement attendu : sans `-p`, Docker ne publie plus rien
sur l'hôte. Le port 5432 n'existe qu'à l'intérieur du network, où seuls les conteneurs
qui y sont attachés peuvent l'atteindre.

**Cas adverse, la base meurt en pleine charge.** `docker kill todo-postgres` pendant que
l'API tourne, puis un `POST` : réponse `503` en 3 200 ms, le process API reste `running`.
Les 3 secondes correspondent au `connectionTimeoutMillis` posé sur le pool. Sans ce
réglage, la requête serait restée pendue indéfiniment.

Ce test a révélé un vrai défaut. Le premier `503` renvoyait
`{"error":{"status":503,"message":"Erreur interne du serveur"}}` : le gestionnaire
d'erreurs masquait *tous* les codes `>= 500`, y compris ce 503 fabriqué exprès avec un
message utile. Le client recevait une erreur inexploitable, exactement ce que le
chapitre demande d'éviter. Correction : les erreurs créées par `httpError` portent
`expose: true` et gardent leur message, les `5xx` imprévues restent masquées. Le
message est maintenant `La base de données est injoignable, réessayer plus tard.`

Après `docker start` de la base, l'API retrouve le chemin toute seule (`GET` en `200`)
sans qu'il faille la redémarrer : le pool rouvre une connexion à la requête suivante.

### Chapitre 7 : Docker Compose et la configuration

**Mission A, la configuration sort du code.** Le cours propose de partir d'une config en
dur puis de l'externaliser. J'ai sauté l'étape intermédiaire volontairement : écrire des
identifiants de base en clair dans un dépôt public, même pour les retirer au commit
suivant, les laisse dans l'historique Git pour toujours. La connexion lit donc
`process.env` depuis le début, `dotenv` charge le `.env`, et `.env.example` porte les
mêmes clés avec des valeurs bidons.

**Mission B, toute la stack dans un fichier.** `docker compose up -d` crée cinq
ressources et rend la main en **12,9 s** : le network `todo-network`, le volume
`todo_pgdata`, et les trois conteneurs `db`, `api`, `adminer`. Postgres passe `healthy`
en **6 s**, et l'API ne démarre qu'après, grâce à `condition: service_healthy`.

Ajustement de noms entre le chapitre 6 et Compose : le network créé à la main a dû être
supprimé avant le premier `up`, pour laisser Compose créer le sien avec le même nom. Le
volume, lui, a été réutilisé tel quel via la clé `name: todo_pgdata`, et les tâches
créées pendant la mission A sont réapparues dans la stack sans rien faire.

Variables ajoutées au `.env.example` en cours de route : `API_PORT`, `ADMINER_PORT`,
`STATS_PORT`, puis `REGISTRY_USER` et `IMAGE_TAG` au chapitre 9.

**Cas limite, une variable obligatoire manque.** `DB_PASSWORD` commentée dans le `.env`,
puis `down` et `up -d`. Trois choses observées :

- Compose prévient dès le lancement :
  `The "DB_PASSWORD" variable is not set. Defaulting to a blank string.`
- Postgres démarre quand même et passe `healthy`. Le chapitre annonce l'inverse, et pour
  cause : le volume était déjà initialisé, or `POSTGRES_PASSWORD` n'est lu qu'à la
  toute première initialisation des données. Sur un volume neuf, l'image refuse
  effectivement de démarrer.
- L'API, elle, part en boucle : `Restarting (1)` dans `docker compose ps`.

Deuxième défaut trouvé ici. Le message d'erreur de l'API était une stacktrace brute se
terminant sur `at require (node:internal/modules/helpers:136:16)`, parce que le pool
PostgreSQL était construit au chargement du module : l'exception partait pendant le
`require`, avant tout `try/catch`. Le pool est maintenant créé à la première
utilisation, et les logs affichent
`Démarrage impossible : Variable d'environnement manquante : DB_PASSWORD. Copier .env.example vers .env et la renseigner.`

**Cas adverse, la base tombe pendant que la stack tourne.** `docker compose stop db`,
puis un `GET /api/tasks` : `503` en 3 288 ms avec le message clair. `/health` continue
de répondre `200`, et le conteneur `api` reste `healthy`, ce qui est voulu : le health
check ne dépend pas de la base, sinon une panne de base ferait passer l'API pour morte
et déclencherait des redémarrages inutiles. Après `docker compose start db`, l'API
répond `200` sans redémarrage.

### Chapitre 8 : un second service, en Python

Deux adaptations avant que le service ne réponde, et c'est tout le travail du chapitre.
`TABLE_NAME` et `STATUS_COLUMN` correspondaient déjà à mon schéma (`tasks`, `status`),
mais `KNOWN_STATUSES` listait `todo`, `in_progress`, `done` là où mon modèle utilise
`pending`, `in-progress`, `done`. Les clés de variables d'environnement du code Python
(`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) tombaient juste avec celles du `.env`,
puisque les deux services partagent le même fichier.

| Cas                  | Résultat mesuré                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Nominal              | `/stats` renvoie `{"pending":1,"in-progress":1,"done":0}`, identique au `SELECT status, COUNT(*) ... GROUP BY status` lancé dans `psql` |
| Limite, table vide   | `200` avec `{"pending":0,"in-progress":0,"done":0}`, jamais un `500`                                                                    |
| Adverse, base coupée | `503` avec `{"detail":"stats-api ne parvient pas à joindre la base de données"}`                                                        |

`docker network inspect todo-network` liste bien les quatre conteneurs, `stats-api`
compris.

Écart mesuré entre les deux services sur le cas adverse : l'API Node répond `503` en
3,3 s, le service Python en **8,4 s**, alors que les deux annoncent un timeout de 3 s.
La différence vient de la façon dont `psycopg2` traite `connect_timeout` : le délai
s'applique à chaque tentative de connexion, et le nom `db` résout vers plusieurs
adresses qui sont essayées l'une après l'autre. Un client qui attend 8 s là où il en
espérait 3 mérite d'être noté : c'est le genre d'écart qui devient un incident quand une
passerelle en amont coupe à 5 s.

Comme côté Node, `/health` reste indépendant de la base : le conteneur `stats-api` est
toujours `healthy` pendant la panne, et Docker ne le redémarre pas pour rien.

### Chapitre 9 : publier l'image et redéployer depuis le registry

Push mesuré : **8,7 s** pour `todo-api`, **6,1 s** pour `stats-api`, en `1.0.0` et pas
en `latest`.

Le test qui compte : dans un dossier vide ne contenant que `docker-compose.prod.yml` et
un `.env`, images locales supprimées au préalable pour forcer un vrai `pull`, la stack
complète démarre en **14,5 s**. Les quatre services répondent, et les tâches créées
avant sont toujours là puisque le volume nommé est le même. Aucune ligne de code source
n'est présente sur la machine.

Contrôle adverse, `docker history --no-trunc` sur les deux images publiées : aucune
trace du mot de passe. Mon premier grep avait pourtant levé une occurrence sur
`todo-api`, et c'était un faux positif : le motif `\.env` matchait le `process.env.PORT`
écrit dans la commande du `HEALTHCHECK`. Vérifier ce que le grep a réellement trouvé
avant de conclure vaut mieux que compter les lignes.

### Chapitre 10 : mesurer et optimiser

| Image       | Taille | Couches (poids max) | Build froid / chaud | 1re réponse HTTP                   |
| ----------- | ------ | ------------------- | ------------------- | ---------------------------------- |
| `todo-api`  | 231 Mo | 18 (155 Mo)         | 5,9 s / 2,2 s       | 855 ms seule, 10,5 s dans la stack |
| `stats-api` | 210 Mo | 21 (87,4 Mo)        | 9,3 s / 1,8 s       | 10,7 s dans la stack               |

Les deux mesures de première réponse HTTP ne disent pas la même chose. Lancée seule,
sans base, l'API Node répond en 855 ms. Dans la stack, il faut 10,5 s, parce que le
conteneur attend que Postgres soit `healthy` : le health check de la base tourne toutes
les 5 s, et c'est lui qui fixe le rythme, pas la vitesse de démarrage de l'application.
Optimiser l'image ne déplacerait pas ce chiffre d'une seconde.

Les deux cibles du cours ne sont pas atteintes sur la taille, et le détail des couches
dit pourquoi. Sur `todo-api`, les couches applicatives pèsent 5,78 Mo pour
`node_modules`, 53 kB pour `src` et 12 kB pour `package.json` : moins de 6 Mo sur 231.
Le reste est le runtime Node de l'image de base, dont la plus grosse couche fait à elle
seule 155 Mo. Passer sous 150 Mo demanderait d'abandonner l'image officielle
`node:alpine` pour du distroless, voire une base assemblée à la main. Le compromis est
tranché ici : je garde `node:22.14.0-alpine`, parce qu'un `docker compose exec api sh`
qui fonctionne vaut plus, à ce stade d'apprentissage, que 80 Mo gagnés sur une image
que je tire trois fois par jour. La même logique vaut pour `stats-api` : 87,4 Mo de
dépendances Python installées par `pip`, sur une base `python:3.12-slim` qui pèse déjà
plus qu'une alpine, pour 210 Mo contre 180 visés.

Ce qui a été atteint : le build à chaud de `todo-api` tient en 2,2 s, sous les 5 s
demandées, et l'écart froid/chaud (5,9 s contre 2,2 s) mesure directement ce que
rapporte l'ordre des instructions du Dockerfile.

Le coût d'un build à froid dans une pipeline qui tournerait cinquante fois par jour, à
partir de mes propres chiffres : 5,9 s + 9,3 s font 15,2 s pour les deux images, soit
**12 minutes 40 de calcul par jour**. Avec le cache chaud, 4 s par passage, soit 3
minutes 20. L'écart, environ 9 minutes par jour, est ce que rapporte concrètement un
`COPY package*.json` bien placé.

Réserve de méthode : les builds à froid ont été mesurés avec `--no-cache`, sans
`docker system prune` préalable. Les images de base restaient donc en cache local, et
un vrai build depuis zéro, sur une machine de CI qui télécharge tout, serait plus lent.

Note d'exploitation : Docker Desktop s'est arrêté en cours de session. Au redémarrage,
les quatre conteneurs sont remontés seuls, sans intervention, grâce au
`restart: unless-stopped` posé sur chaque service. Les données étaient intactes.

### Jour 3, phases 1 à 4 : la pipeline atteint une vraie machine

La pipeline de la veille vivait sur le projet d'échauffement. Le déménagement
sur la Todo API n'a rien apporté de neuf conceptuellement, et c'est pour ça
qu'il a été rapide : lint, tests, image taguée au sha.

Le premier run a donné exactement le résultat que le cours annonce. Le job
`test` est passé en 12 s, le job `build` a échoué seul, sur
`Error: Username and password required`. Le log montrait `IMAGE: /todo-api`,
avec le pseudo vide devant la barre oblique : le secret `DOCKERHUB_USERNAME`
n'existait pas encore. La panne était localisée, les tests toujours verts.
C'est le troisième scénario demandé en phase 1, obtenu sans avoir à le
provoquer.

La machine cible tient en un `Dockerfile.vm` de vingt lignes. Les trois
vérifications passent : `docker ps` à l'intérieur ne montre aucun conteneur de
développement, une connexion sans `-i deploy_key` est refusée avec
`Permission denied (publickey)`, et un `docker restart vm-prod` retrouve les
images grâce au volume.

Cassé, et c'est une erreur de méthode plus que de code : la première
vérification du volume affichait une liste d'images vide, ce qui laissait
croire que le volume ne servait à rien. En réalité, la commande de test était
`docker run --rm hello-world | head -4`. Le `head` fermait le tube au
quatrième ligne, `docker` recevait un SIGPIPE en plein téléchargement, et
l'image n'était jamais arrivée au bout. Le volume marchait très bien. Vérifier
ce que la commande de contrôle fait réellement avant d'accuser ce qu'elle
mesure.

Le runner self-hosted a demandé une correction que le cours ne mentionne pas,
parce qu'elle est propre à Windows. Le premier job a échoué sur
`WSL (2289 - Relay) ERROR: CreateProcessCommon:818: execvpe(/bin/bash) failed`.
GitHub Actions résout `shell: bash` en cherchant `bash` dans le PATH, et sur
Windows `C:\Windows\System32\bash.exe` arrive en premier : c'est celui de WSL,
qui n'a aucune distribution installée. Deux corrections étaient possibles,
écrire le chemin complet du bash de Git dans le YAML, ou corriger le PATH du
runner. J'ai choisi la seconde, par un fichier `.env` dans le dossier du
runner : le YAML reste portable, et rien dans le dépôt ne suppose Windows.

Preuve mesurée que le runner tourne bien chez moi, avec le workflow
`verifier-runner.yml` : le job self-hosted affiche `G2RD-Surface` et liste
`vm-prod` avec ses quatre ports, quand le job `ubuntu-latest` affiche
`runnervmvrwv9` et une liste de conteneurs vide.

Piège de redémarrage à connaître : après avoir tué puis relancé l'agent, GitHub
a mis environ deux minutes à libérer l'ancienne session
(`A session for this runner already exists` dans `runner.err`). Pendant ce
temps, le job restait `in progress` sans jamais démarrer. Annuler et relancer
le workflow suffit.

### Jour 3, phase 5 : rejouer, et revenir en arrière

L'idempotence se vérifie en deux commandes. Deux `docker compose up -d`
strictement identiques d'affilée laissent les quatre conteneurs en `Running`,
sans en recréer un seul, avec exactement un conteneur `todo-api` et aucun
orphelin. Là où une séquence naïve de `docker run` aurait planté sur un nom
déjà pris, Compose compare l'état voulu à l'état réel et ne touche que ce qui
a changé.

Pour le retour arrière, j'ai introduit une régression volontaire : un tri sur
`creation_date`, colonne qui n'existe pas, à la place de `created_at`. Le
résultat est la meilleure démonstration du cours que j'aie obtenue de la
journée.

| Couche de tests | Verdict sur le code cassé |
| --- | --- |
| 26 tests unitaires (avec mock) | verts, tous |
| 12 tests d'intégration (vrai PostgreSQL) | 1 rouge |

Le mock ne connaît pas le schéma réel : il rejoue ce qu'on lui a écrit dans le
test, et dit oui à n'importe quelle requête SQL. C'est exactement le scénario
« vendredi 17h32 » du cours, reproduit sur mon propre code.

La pipeline a bloqué le commit sur le job `test-integration`, et `build` n'a
jamais tourné. Pour jouer quand même le scénario de bout en bout, j'ai poussé
l'image à la main et déployé la version fautive.

Chronométrage du retour arrière :

| Étape | Durée |
| --- | --- |
| Constat de la panne à la commande lancée | quelques secondes, le temps de lire le tableau de bord |
| Commande de retour arrière au premier `200` sur `/api/tasks` | **11,8 s** |

Aucune reconstruction, aucune pipeline, aucune enquête : l'image précédente
était encore sur Docker Hub, taguée à son sha. C'est le bénéfice concret
d'avoir banni `latest` la veille.

Dernier contrôle, un retour arrière vers un tag inexistant. Docker répond
`manifest for nghtmre/todo-api:000... not found: manifest unknown`, la commande
sort en code 1, et la production continue de répondre `200` sur la version
précédente. Rien n'est laissé à moitié éteint, et le code de sortie remonte
correctement : un vrai job de pipeline échouerait pour de bon.

### Jour 3, phase 6 : les tests qui touchent la base

Douze tests d'intégration couvrent les quatre comportements demandés, et deux
de plus sur le `PUT`. Le job CI tourne en 35 s avec un conteneur de service
PostgreSQL et son contrôle de santé `pg_isready`.

Décision prise ici, et je pense que c'est la plus importante du chapitre : le
schéma est sorti de `src/db.js` pour vivre dans `db/schema.sql`. Le même
fichier est rejoué par l'application au démarrage, par `npm run migrate` avant
les tests, et à la main sur la machine cible si besoin. Le cours décrit une
migration jouée sur la base de test mais jamais sur celle de production ; avec
une source unique, ce décalage ne peut pas exister.

Contrôle que les tests servent à quelque chose : en remplaçant le
`DELETE FROM tasks` par un `SELECT 1`, deux tests d'intégration virent au
rouge. En retirant le garde `isUuid`, cinq tests unitaires virent au rouge. Un
test qui reste vert quand on casse le code qu'il prétend couvrir n'a pas sa
place dans le dépôt.

### Jour 3, phase 7 : l'API se met à parler, et le premier vrai bug

L'instrumentation produit un compteur, un histogramme et deux mesures métier.
Le test qui compte, celui du cours : trois `GET /api/tasks`, puis relecture de
`/metrics`, et le compteur affiche exactement 3. Une route inconnue est comptée
sous l'étiquette `<inconnue>` et non sous son URL réelle, sinon un scanner de
vulnérabilités suffirait à faire tomber Prometheus.

Premier accroc, sur Express. Les métriques étaient étiquetées `route="/:id"`
au lieu de `route="/api/tasks/:id"`. Express ne garde `req.baseUrl` que le
temps de la traversée du routeur et le restaure à la sortie, y compris quand
une erreur remonte. Or l'étiquette est posée sur l'événement `finish`, donc
après cette restauration. Le préfixe est maintenant figé à l'entrée du routeur,
et deux routeurs différents ne se mélangent plus dans la même série.

Deuxième accroc, et c'est un vrai défaut de conception que seule la mesure a
révélé. J'avais branché la métrique `todo_tasks_in_database` sur le callback
`collect()` de prom-client, donc interrogée à chaque lecture de `/metrics`. En
coupant la base pour observer la signature de la panne, `up` est tombé à **0**
alors que `/health` répondait toujours `200`. La requête attendait les 3 s de
`connectionTimeoutMillis`, `/metrics` dépassait le `scrape_timeout` de
Prometheus, et le scrape échouait. Autrement dit, la supervision devenait
aveugle exactement au moment où elle servait, et annonçait « application
morte » pour une panne de base.

La correction sort la requête du chemin du scrape : un rafraîchissement en
tâche de fond toutes les 10 secondes, avec `unref()` pour ne pas retarder les
arrêts de conteneur. Même panne rejouée après correction, la signature est
juste : `up` reste à 1, le taux d'erreur monte à 61 %, le p95 explose à 4,8 s.

### Jour 3, phase 8 : Prometheus, Grafana, et les relevés

La stack de supervision vit dans le même `compose.yml` que l'API, sur le même
réseau. La source de données et le tableau de bord sont provisionnés par
fichier : après un `docker compose down -v`, tout revient sans un clic.

Relevés demandés, sous une charge d'environ 3 requêtes par seconde :

| Moment | `up` | req/s | Taux 5xx | p95 |
| --- | --- | --- | --- | --- |
| Au repos, avant la boucle de charge | 1 | 0,04 | non défini | 4,7 ms |
| Pendant la boucle de charge | 1 | 4,45 | non défini | 13,8 ms |
| Pendant l'incident (base coupée) | 1 | 0,51 | 61 % | 4,79 s |
| Après redémarrage de la base | 1 | 0,04 | 0 % | 4,7 ms |

Le taux d'erreur est « non défini » et non « zéro » dans les deux premières
lignes, et c'est correct : sans aucune réponse 5xx, le rapport
`5xx / total` n'existe pas pour Prometheus, et le panneau reste vide. Un
panneau vide n'est donc pas toujours un panneau cassé.

Checkpoint qualité : après `docker stop todo-api`, `up` passe à 0 en
**8 secondes**, pour un `scrape_interval` de 5 s. Sous les quinze demandées.

Et la distinction qui compte pour diagnostiquer, mesurée sur trois pannes
différentes :

| Panne | `up` | Taux 5xx | p95 |
| --- | --- | --- | --- |
| API arrêtée | 0 | pas de données | pas de données |
| Base coupée | 1 | 61 % | 4,79 s |
| Régression de code | 1 | 33 % | 24 ms |

Les deux dernières se ressemblent sur le taux d'erreur et se séparent sur la
latence. Une panne en aval échoue lentement, le p95 collant au délai du pool.
Un bug de code échoue vite. Je ne m'attendais pas à ce que le p95 soit le
discriminant le plus net du tableau de bord, et c'est probablement ce que je
retiens le plus de la journée.

### Jour 3, phases 9 et 10 : la procédure et l'incident

La procédure vit dans `docs/PROCEDURE_DEPLOIEMENT.md`. Elle a été écrite
pendant les déploiements, pas après : c'est le seul moment où ce qui deviendra
évident dans trois mois est encore surprenant.

Mise à l'épreuve immédiate, en tirant une panne au hasard avec
`scripts/incident.sh` et en ne suivant que le document. Le tirage a donné la
panne 3, la coupure réseau. Le service est revenu en 12 secondes avec la
commande de la procédure, donc la réparation était bonne. Sa ligne de
signature, elle, était fausse.

J'avais écrit « `up` à 1 avec des erreurs, même image que la panne 2 ». La
réalité mesurée est tout autre : détaché de son réseau, le conteneur perd aussi
la publication de son port 3000. `curl` depuis le poste ne renvoie même pas un
code HTTP, il renvoie `000`, et Prometheus ne le joint plus non plus, donc `up`
tombe à 0. Le conteneur, lui, se déclare `healthy`.

Cette erreur a fait réécrire toute la section 6 de la procédure. Les pannes ne
se classent plus par numéro, mais en deux familles selon `up`, et pour la
famille où `up` vaut 0, c'est `docker ps` qui tranche entre trois causes :

| Panne | Ce qu'affiche `docker ps -a` |
| --- | --- |
| API arrêtée | `Exited (137)` |
| Réseau coupé | `Up (healthy)`, sans réseau ni port |
| Relancée sans configuration | `Exited (1)`, avec `Variable d'environnement manquante : DB_HOST` dans les logs |

La panne 4 a été vérifiée séparément plutôt que déduite, et son log donne
directement la réponse. C'est le genre de détail qu'on n'écrit pas quand on
rédige une procédure de mémoire.

Le script d'incident lui-même a demandé une correction. Sa panne de saturation
lance quatre conteneurs dévoreurs de CPU. Mesuré ici : quatre conteneurs à
100 % sur une machine à **20 cœurs** occupent 20 % de la machine, et le p95 de
l'API reste à 21 ms, contre 24 ms au repos. Autrement dit, la panne ne se voit
pas, et le pilote chercherait ailleurs pendant dix minutes. Le nombre de
dévoreurs est maintenant calé sur `nproc`, à raison de deux par cœur, et la
signature devient lisible :

| Charge | req/s | Taux 5xx | p95 |
| --- | --- | --- | --- |
| 4 dévoreurs sur 20 cœurs | 2,87 | 0 % | 21 ms |
| 40 dévoreurs sur 20 cœurs | 2,07 | 0 % | 83 ms |

La latence est multipliée par quatre sans une seule erreur. C'est la seule
panne de cette forme, donc la plus facile à identifier une fois qu'elle est
visible.

### Jour 3, note d'exploitation

Docker Desktop s'est arrêté en cours de session, et la machine cible avec lui.
Au redémarrage de `vm-prod`, les quatre conteneurs de production sont remontés
seuls en une trentaine de secondes, sans intervention, grâce au
`restart: unless-stopped`. Le volume `vm-prod-data` a gardé les images, rien
n'a été retéléchargé. Le daemon Docker interne met environ 25 s à accepter des
connexions : un déploiement lancé trop tôt après un redémarrage échouera sur un
`Connection refused` qui n'a rien d'inquiétant.

### Jour 3, le run qui ferme la chaîne

Pendant toute la journée, la pipeline est restée rouge sur le job `build`, avec
`Error: Username and password required`. Une seule cause, et elle n'avait rien
de technique : le secret `DOCKERHUB_TOKEN` n'existait pas. Comme `deploy`
déclare `needs: [build]`, il restait `skipped` à chaque push. Les deux jobs de
test, eux, étaient verts depuis le début.

Ce rouge-là a une valeur pédagogique que je ne soupçonnais pas : il montre
qu'un job manquant en amont ne produit aucune erreur en aval, juste un silence.
Un `skipped` ressemble beaucoup à « tout va bien » quand on lit vite.

Le secret posé, le premier run complet donne :

| Job | Machine | Résultat |
| --- | --- | --- |
| Lint et tests unitaires | `ubuntu-latest` | vert |
| Tests d'intégration | `ubuntu-latest` + service PostgreSQL | vert |
| Construire et publier l'image | `ubuntu-latest` | vert |
| Déployer sur la machine cible | `self-hosted` | vert |

Le job de déploiement affiche `/health répond 200 après 1 tentative(s)`, et la
machine cible tourne bien l'image du commit qui a déclenché la pipeline. La
boucle est fermée : un `git push` sur `main`, et l'application part en
production sans qu'une seule commande soit tapée.

Contrôle de fuite sur le log complet du run : aucune occurrence de
`BEGIN OPENSSH`. La clé privée est passée par un agent SSH, en mémoire, et
GitHub masque les valeurs des secrets. Le log affiche `IMAGE: ***/todo-api`,
avec le pseudo remplacé par des astérisques.

Une seule pipeline rouge de la journée était voulue, celle du commit
`4596c48` : la régression volontaire, arrêtée par les tests d'intégration,
avec `build` et `deploy` sautés. Une pipeline qui refuse de publier du code
cassé fait exactement son travail.

### Jour 4, phases 1 à 4 : l'application entre dans un cluster

Le premier obstacle n'était pas Kubernetes, c'était Windows. `k3d cluster
create` écrit un kubeconfig qui pointe sur `https://host.docker.internal:51578`,
et ce nom résout ici vers l'IP du réseau local, qui ne répond pas. Cinq minutes
de `dial tcp 192.168.1.114:51578: connectex: A connection attempt failed`, pour
une correction d'une ligne :

```bash
kubectl config set-cluster k3d-todo-cluster --server="https://127.0.0.1:51578"
```

Le port publié par `k3d-todo-cluster-serverlb` était bon depuis le début, seul
le nom d'hôte était faux. C'est noté au § 6.7 de la procédure, parce que
personne ne devrait avoir à le retrouver deux fois.

Le pod de la phase 1 n'a jamais atteint `Running`, et c'était la bonne nouvelle.
Les logs disaient `Démarrage impossible : Variable d'environnement manquante :
DB_HOST`. Le sujet annonce ce cas en phase 2 sous le nom de « cas cassant » : le
code doit refuser de tourner sans ses variables plutôt que de se connecter à une
base au hasard. Il le fait depuis le Jour 1.

Les deux vérifications qui ne dépendaient pas de ce démarrage sont passées : un
`kubectl delete pod` fait revenir un autre pod, sous un autre nom, sans qu'on
retape quoi que ce soit, et une faute de frappe dans le nom de l'image laisse le
pod en `ImagePullBackOff`, jamais en `Running`. Détail que je n'attendais pas :
le pod fautif n'a **pas** remplacé l'ancien. La mise à jour progressive refuse
de tuer une copie tant que la nouvelle n'est pas prête, et ce comportement sera
au centre des phases 8 et 10.

Sur le Secret, j'ai tranché contre la lettre du sujet. Il demande de versionner
les manifestes, Secret compris, pendant que sa grille exige qu'aucun secret ne
soit versionné. Un `stringData` committé n'est pas un secret, et un `data` en
base64 non plus : il se relit en une commande. Le dépôt porte donc
`k8s/todo-secret.example.yaml`, avec ses valeurs bidons, et le vrai Secret est
créé par `kubectl create secret`. C'est exactement le rapport qu'entretiennent
`.env.example` et `.env` depuis le Jour 1. La ligne du `.gitignore` a été écrite
avant que le fichier existe.

Les trois tests de la phase 3 passent. Une tâche créée par l'API survit à la
suppression du pod PostgreSQL. Un `selector` de Service cassé volontairement
vide la liste d'endpoints, et l'API reçoit `ECONNREFUSED` sur l'IP du Service
alors que les pods de la base tournent toujours. Et la suppression de la PVC
reste bloquée en `Terminating`, retenue par le finalizer
`kubernetes.io/pvc-protection`, tant qu'un pod la monte.

Ce dernier test a une conséquence qu'il vaut mieux connaître avant de le jouer :
une fois la suppression demandée, elle ne s'annule pas. L'objet porte un
`deletionTimestamp` et partira dès que plus aucun pod ne le montera, donc au
premier redémarrage de la base. Il a fallu supprimer le Deployment pour libérer
le volume, puis tout recréer.

### Jour 4, phase 5 : le runner ne bouge pas, la cible si

Toutes les pipelines sont passées au rouge dès la phase 1, et pour une raison
que je n'avais pas anticipée : le job `deploy` de la veille ouvrait une
connexion SSH vers `vm-prod`, que le sujet demande d'arrêter en tout premier
geste de la journée. Les trois autres jobs restaient verts. La panne était
localisée là où il fallait, mais elle a duré le temps d'arriver à la phase 5.

Le remplacement est plus simple que ce qu'il remplace, ce qui est rare. Le
runner self-hosted partage la machine du cluster, donc il lit le même
kubeconfig que les commandes tapées à la main. Aucune clé, aucun tunnel, et les
quatre secrets `DEPLOY_*` d'hier ne servent plus.

Deux corrections ont été nécessaires côté machine, aucune dans le dépôt : le
`PATH` du runner devait connaître `kubectl`, et le runner ne relit ce PATH qu'au
redémarrage.

Erreur de conception corrigée en cours de route, et c'est la plus utile de la
journée. La première version du job faisait `kubectl set image`, comme le
propose le sujet. Elle ne poussait donc que l'image : tout le reste de l'état
voulu, `replicas`, sondes, ressources, restait dans les fichiers sans jamais
atteindre le cluster. Pire, un `kubectl apply` tapé à la main ramenait le tag
écrit dans le manifeste et faisait **reculer la production d'une version**, sans
erreur ni avertissement. Constaté en direct en passant à trois replicas. Le job
applique maintenant les manifestes avec le tag substitué dans la copie de
travail du runner, jetée avec le job.

Le troisième scénario demandé se vérifie : sur un tag inexistant,
`rollout status` rend `error: timed out waiting for the condition` et sort en
code 1, donc le job devient rouge. Pendant tout ce temps, les anciens pods
continuent de répondre `200`.

### Jour 4, phases 6 à 8 : mesurer plutôt que croire

Trois replicas, et la preuve par le trafic plutôt que par le `get pods`. Sous
25 s de charge à travers l'Ingress, 67 requêtes se répartissent **23 / 22 / 23**
entre les trois pods. Le contrôle inverse est aussi net : avec un `selector` de
Service qui ne colle à aucune étiquette, trois pods `Running` et **19 échecs sur
19**, faute d'endpoint.

Les sondes de la phase 7 mentent exactement comme le sujet l'annonce, et je ne
m'attendais pas à ce que ce soit aussi visible :

| Ce que le cluster affirme | Ce que rend le service |
| --- | --- |
| 3 pods `READY 1/1 Running` | `GET /health` → `200` |
| 0 événement `Unhealthy` | `GET /api/tasks` → `503` |
| 0 redémarrage | |

Une sonde `readiness` pointée sur un port jamais exposé donne un résultat plus
intéressant que celui annoncé : le sujet prévoit un Service sans aucun pod prêt,
donc un refus de connexion. Avec trois replicas et `maxUnavailable: 0`, le
nouveau pod reste `0/1`, le rollout se bloque, et les anciens continuent de
servir. Aucune requête perdue. La sonde fait précisément son travail : elle
empêche une mauvaise version d'entrer en service.

Le tableau de comparaison de la phase 8, mesuré avec le même script des deux
côtés, une requête toutes les 100 ms pendant le déploiement :

| Déploiement | Requêtes | Échouées | Signature | Convergence |
| --- | --- | --- | --- | --- |
| Hier, `docker compose` sur `vm-prod` | 160 | **7** | `000`, aucune connexion | 21 s |
| Cluster, `maxUnavailable: 0` `maxSurge: 1` | 137 | **0** | | 23 s |
| Cluster, `maxUnavailable: 3` `maxSurge: 0` | 91 | **17** | `503` immédiats | 7 s |

La troisième ligne est le contrôle qui prouve que le réglage sert à quelque
chose. Elle dit aussi le prix : trois fois plus rapide, mais 19 % des requêtes
perdues.

Un piège de mesure a failli me faire écrire n'importe quoi. Le tout premier
relevé sur `vm-prod` donnait 0 échec, ce qui aurait rendu la comparaison
absurde. En cause : j'avais redéployé le tag déjà en place, donc
`docker compose up -d` n'avait rien fait du tout. Vérifier que la commande de
test change réellement quelque chose avant d'interpréter son résultat.

Réserve à noter, parce qu'elle relativise la ligne du milieu : deux passes
ultérieures ont compté 2 et 3 échecs, tous en `000` à exactement 10 s, soit le
plafond `--max-time` de curl. L'un d'eux est tombé **avant** le début du
rollout, et une passe témoin de 30 s sans aucun déploiement n'en a produit
aucun. La signature ne ressemble pas à une perte d'endpoint, qui donne des `503`
immédiats. Je penche pour la redirection de ports de Docker Desktop, sans
pouvoir le prouver.

### Jour 4, phase 9 : le retour arrière, comparé à celui d'hier

| | Jour 3, SSH et `docker compose` | Jour 4, `kubectl rollout undo` |
| --- | --- | --- |
| Constat au premier `200` | 11,8 s | **13,6 s** |
| Convergence complète | 11,8 s | 23 s |
| Service pendant l'opération | coupé | jamais coupé |

Le cluster est légèrement plus lent à rétablir, et c'est logique : il remplace
les pods un par un au lieu de recréer un conteneur unique. Ce que le chiffre ne
dit pas, c'est qu'hier le service était mort pendant ces 11,8 s, alors qu'ici il
n'a jamais cessé de répondre.

Première mesure jetée : j'avais lancé le chronomètre sans vérifier que la
régression était bien en place sur les trois pods. Le relevé mélangeait des
réponses des anciens et des nouveaux. Repris après avoir constaté dix `500`
d'affilée.

`rollout history` liste les révisions, et `--to-revision=29` en cible une
précise. Une révision inexistante échoue proprement, `error: unable to find
specified revision 999 in history`, code de sortie 1, sans que la production
bouge.

### Jour 4, phase 10 : ce que le cluster répare, et ce qu'il ne répare pas

Le tableau des cinq pannes, toutes rejouées, aucune déduite :

| # | Panne | `get pods` | `describe` / logs | Se répare seule ? | Remède |
| --- | --- | --- | --- | --- | --- |
| 1 | Pod supprimé | un `Terminating`, un nouveau apparaît | rien d'anormal | **Oui, 10 s** | aucun |
| 2 | Processus tué dans le conteneur | même pod, `RESTARTS` +1 | `Reason: Completed`, `Exit Code: 0` | **Oui, 9 s** | aucun |
| 3 | Tag d'image inexistant | un `ImagePullBackOff`, 3 anciens `Running` | `Failed to pull image ... not found` | Non | `rollout undo`, 1 s |
| 4 | Clé du Secret supprimée | un `CrashLoopBackOff`, 3 anciens `Running` | `Exit Code: 1`, `Variable d'environnement manquante : DB_PASSWORD` | Non | restaurer la clé, `rollout restart`, 21 s |
| 5 | Limite mémoire à 8Mi | un `CrashLoopBackOff`, 3 anciens `Running` | `Reason: OOMKilled`, `Exit Code: 137` | Non | réappliquer le manifeste, 23 s |

Ce que je retiens de cette phase tient en une ligne, et ce n'est pas ce que
j'attendais : **les cinq pannes laissent `/api/tasks` répondre `200`**. Les
anciens pods servent pendant que le nouveau échoue. Une panne de déploiement ne
se voit donc pas depuis l'extérieur, elle ne se voit que dans
`kubectl get pods`. Hier, la moitié des pannes se lisaient sur un `curl`.
Aujourd'hui, aucune.

La panne 2 n'a d'abord rien cassé du tout. `kubectl exec -- kill 1` renvoyait
`RESTARTS=0`, et un `kill -KILL 1` ne faisait pas mieux. L'explication est dans
le noyau : pour PID 1 d'un espace de noms, tout signal sans gestionnaire
installé est ignoré s'il vient de ce même espace. L'image lance `node`
directement, donc le process est PID 1, et il n'installait aucun gestionnaire.

J'ai corrigé le code plutôt que le script, et j'ai eu tort sur la raison. Mon
message de commit initial affirmait que le pod attendait ses 30 s de délai de
grâce à chaque mise à jour. Mesuré ensuite : la terminaison prend 1,1 s sans
gestionnaire contre 2,0 s avec, et la convergence d'un rolling update reste à
23 s dans les deux cas. Kubelet envoie son SIGTERM depuis l'extérieur de
l'espace de noms, là où la protection de PID 1 ne s'applique pas. Le message de
commit a été corrigé.

Ce que la correction apporte réellement, et qui suffit à la garder : le pool
PostgreSQL se ferme au lieu d'être coupé net, les requêtes en cours disposent de
10 s pour finir, et la panne 2 produit enfin la signature attendue.

### Jour 4, phase 12 : la limite se trouve par l'échec

`kubectl top` mesure 16 à 17 Mi par pod, au repos comme sous une charge de
10 requêtes par seconde. En resserrant `limits.memory` cran par cran :

| `limits.memory` | Résultat |
| --- | --- |
| 64Mi | tient |
| 32Mi | tient |
| 24Mi | tient |
| 20Mi | tient |
| 18Mi | **OOMKilled**, `Exit Code: 137` |
| 16Mi | **OOMKilled** |

Le plancher est donc entre 18 et 20 Mi. Deux essais ont d'abord été rejetés par
l'API sans que je le remarque, `requests` étant resté au-dessus de la nouvelle
`limits` : les valeurs testées n'étaient pas celles que je croyais mesurer.

Le réglage retenu est pourtant `requests: 32Mi` et `limits: 96Mi`, et l'écart
est délibéré. Le plancher a été trouvé sous une charge légère, avec un seul
profil de requêtes. Une pointe de trafic, un corps JSON plus gros ou un
ramasse-miettes qui passe au mauvais moment suffiraient à tuer un pod calé au
ras de sa consommation. La mesure dit où est le mur, elle ne dit pas à quelle
distance s'en garer. Aucune limite de CPU non plus : elle étranglerait le
conteneur au lieu de le tuer, ce qui se diagnostique bien plus mal qu'un
`OOMKilled`.

### Jour 4, la procédure mise à l'épreuve

Deux incidents tirés au hasard, diagnostiqués en ne suivant que le document.

Le premier, avant la réécriture, a donné la panne 4. Le log nommait la variable
manquante, et la réparation a pris 21 s. Le second, après réécriture, a donné la
panne 5 : `OOMKilled`, `Exit Code: 137`, et `limits` à 8Mi dans le manifeste.
Diagnostic posé en deux commandes, réparation en 23 s avec la commande écrite
dans le document, sans avoir eu à le corriger.

C'est la différence avec hier, où le premier incident avait révélé une ligne
fausse dans le tableau des signatures. Cette fois, le document a tenu.

## À venir

- [ ] Restreindre les origines CORS pour la production
- [ ] Un utilisateur PostgreSQL en lecture seule pour `stats-api`
- [ ] Pool de connexions côté `stats-api`, qui ouvre et ferme à chaque appel
- [ ] Une règle d'alerte sur le taux d'erreur 5xx, avec envoi réel
- [ ] Un retour arrière déclenché depuis la pipeline plutôt qu'à la main
- [ ] Instrumenter `stats-api` de la même façon, et le faire entrer dans le
      cluster à son tour
- [ ] Remonter Prometheus et Grafana dans le cluster, avec `node_exporter` et
      `postgres_exporter` pour mesurer le nœud et la base
- [ ] Un `/health` qui distingue « le serveur répond » de « la base répond »,
      sans exposer les sondes à une cascade d'échecs
- [ ] Un `StatefulSet` pour `todo-db` plutôt qu'un `Deployment`, qui est le
      bon objet pour une charge à état
- [ ] Enregistrer le runner comme service Windows, pour qu'il survive à un
      redémarrage du poste
