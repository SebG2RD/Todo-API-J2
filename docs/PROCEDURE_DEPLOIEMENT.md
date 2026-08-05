# Procédure de déploiement de la Todo API

Ce document n'explique pas comment le système fonctionne : il dit quoi taper,
dans quel ordre, et comment vérifier que ça a marché. Pour comprendre
l'architecture, lire le `README.md`. Pour rétablir un service à 3 h du matin,
rester ici.

Toutes les commandes se collent telles quelles. Les seules valeurs à remplacer
sont écrites `<comme ceci>`.

- Durée d'un déploiement normal : 45 s à 1 min 15 de bout en bout.
  Au-delà de 3 minutes, quelque chose ne va pas : aller directement au § 6.
- Coupure attendue : 8 à 12 secondes, le temps que le conteneur `todo-api`
  soit recréé. La stratégie est un *recreate* assumé.
- Fenêtre de maintenance : aucune contrainte, projet de formation. Sur un
  vrai service, une coupure de 10 s se pose hors heures de pointe.

---

## 1. Ce qu'il faut avoir sous la main avant de commencer

| Élément | Valeur | Où le trouver |
| --- | --- | --- |
| Clé privée de déploiement | `deploy_key` | À la racine du dépôt local, jamais versionnée. Si elle manque, voir § 7. |
| Machine cible | `localhost`, port SSH **2222** | Conteneur `vm-prod` sur le poste de travail |
| Utilisateur | `root` | Maquette jetable. Sur une vraie machine, ce serait un compte `deploy` sans sudo. |
| Dossier de déploiement | `/srv/todo` | Sur la machine cible |
| Fichier de secrets | `/srv/todo/.env` | Sur la machine cible uniquement. Modèle : `deploy/env.example`. |
| Image | `nghtmre/todo-api:<sha du commit>` | Docker Hub |
| API | <http://localhost:3000> | Publiée par `vm-prod` |
| Prometheus | <http://localhost:9090> | |
| Grafana | <http://localhost:3001> | Lecture anonyme activée, aucun mot de passe à demander |

Raccourci utilisé partout dans ce document :

```bash
cd "<racine du dépôt>"
SSH="ssh -i deploy_key -p 2222 root@localhost"
```

Vérification : `$SSH "echo ok"` doit répondre `ok`. Si non, § 7.

---

## 2. Vérifications AVANT de toucher à quoi que ce soit

Ces trois relevés servent de point de comparaison. Sans eux, impossible de
prouver après coup que le déploiement a amélioré ou dégradé les choses.

```bash
# 2.1. Quelle version tourne actuellement ? Noter ce sha : c'est la cible du
#       retour arrière du § 5.
$SSH "docker inspect -f '{{.Config.Image}}' todo-api"

# 2.2. Tout est-il debout ?
$SSH "docker ps --format '{{.Names}}\t{{.Status}}'"

# 2.3. Le service répond-il, là, maintenant ?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
```

Vérifications attendues :

- 2.1 affiche `nghtmre/todo-api:<40 caractères hexadécimaux>`. S'il affiche
  `latest`, quelqu'un a déployé à la main hors pipeline : le retour arrière
  sera impossible, prévenir avant de continuer.
- 2.2 liste quatre conteneurs : `todo-api` et `todo-db` en `(healthy)`,
  `prometheus` et `grafana` en `Up`.
- 2.3 répond `200`.

---

## 3. Déploiement automatique : le cas normal

Il n'y a rien à taper. Un `git push` sur `main` suffit :

1. `test` et `test-integration` tournent sur des machines fournies par GitHub.
2. `build` construit l'image et la pousse sur Docker Hub, taguée au sha.
3. `deploy` tourne sur le runner self-hosted, se connecte en SSH à la machine
   cible, envoie `deploy/`, lance `docker compose up -d`, puis interroge
   `/health` jusqu'à obtenir un `200`.

Vérification : dans l'onglet Actions, les quatre jobs sont verts. Le job
`deploy` affiche `/health répond 200 après N tentative(s)`.

Prérequis à contrôler une fois pour toutes, sinon rien ne part :

```bash
gh secret list   # doit lister DOCKERHUB_USERNAME, DOCKERHUB_TOKEN,
                 # DEPLOY_SSH_KEY, DEPLOY_HOST, DEPLOY_PORT, DEPLOY_USER
gh api repos/<compte>/<dépôt>/actions/runners --jq '.runners[] | "\(.name) \(.status)"'
                 # doit afficher : vm-prod-host online
```

Un runner `offline` laisse le job `deploy` en Queued indéfiniment, sans
message d'erreur. C'est le comportement normal, pas une panne de GitHub : aller
au § 7.3.

---

## 4. Déploiement manuel : quand la pipeline n'est pas disponible

À n'utiliser que si GitHub Actions est en panne ou le runner injoignable.

```bash
# 4.1. Choisir la version. Un sha de commit, jamais "latest".
SHA=<sha du commit à déployer>

# 4.2. Vérifier que l'image existe AVANT de toucher à la production.
docker manifest inspect nghtmre/todo-api:$SHA > /dev/null && echo "image trouvée"
```

Vérification : la commande affiche `image trouvée`. Si elle répond
`manifest unknown`, le tag n'existe pas : ne pas continuer, reprendre au 4.1.

```bash
# 4.3. Envoyer la description de la stack (compose, Prometheus, Grafana).
$SSH "mkdir -p /srv/todo"
scp -i deploy_key -P 2222 -r deploy/. root@localhost:/srv/todo/
$SSH "rm -f /srv/todo/env.example"
```

Vérification : `$SSH "ls /srv/todo"` liste `compose.yml`, `prometheus.yml`,
`grafana` et `.env`. Si `.env` manque, voir § 7.4.

```bash
# 4.4. Déployer.
$SSH "cd /srv/todo && IMAGE='nghtmre/todo-api' TAG='$SHA' docker compose up -d"
```

Vérification : la sortie affiche `Container todo-api Started` ou
`Recreated`. Le code de sortie de la commande est `0` (`echo $?`).

```bash
# 4.5. Vérifier que le service répond réellement.
sleep 12
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks
```

Vérification : les deux répondent `200`. `/health` seul ne suffit pas : il
ne touche pas la base, et répond `200` même quand la base est morte.

```bash
# 4.6. Confirmer la version réellement en place.
$SSH "docker inspect -f '{{.Config.Image}}' todo-api"
```

Vérification : le sha affiché est bien celui du 4.1.

---

## 5. Retour arrière

### 5.1 Quand le déclencher, et qui décide

| Signal observé sur le tableau de bord | Action | Qui décide |
| --- | --- | --- |
| Taux d'erreur 5xx **au-dessus de 5 %** pendant plus de 2 minutes | Retour arrière immédiat, sans validation supplémentaire | La personne d'astreinte, seule |
| `up` à **0** pendant plus de 1 minute | Retour arrière immédiat | La personne d'astreinte, seule |
| p95 au-dessus de **500 ms**, mais taux d'erreur sous 1 % | Surveiller 10 minutes de plus, prévenir l'astreinte | La personne d'astreinte alerte, ne décide pas seule |
| Signal ambigu, rien de franchement rouge | Ne rien toucher, attendre une validation humaine | Le responsable du service |

### 5.2 Comment le faire

```bash
# Le sha relevé au § 2.1, celui qui tournait AVANT le déploiement fautif.
PRECEDENT=<sha précédent>
$SSH "cd /srv/todo && IMAGE='nghtmre/todo-api' TAG='$PRECEDENT' docker compose up -d"
```

Vérification : `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks`
répond `200`, et le panneau **Disponibilité** de Grafana repasse à `EN LIGNE`.

Durée mesurée : 11,8 secondes entre le lancement de la commande et le
premier `200` sur `/api/tasks`. Aucune reconstruction, aucune pipeline : l'image
précédente est encore sur Docker Hub, taguée à son sha.

Si le tag n'existe pas : la commande échoue avec
`manifest unknown` et la production n'est pas touchée, l'ancienne version
continue de servir. Vérifié. Reprendre avec un sha valide, à retrouver dans
l'historique Git ou sur Docker Hub.

Limite connue : ce retour arrière ne concerne que le code. Si le
déploiement fautif a modifié le schéma de la base, revenir sur le code sans
revenir sur le schéma peut casser autant que le bug qu'on fuyait. À ce jour,
`db/schema.sql` n'utilise que des `CREATE ... IF NOT EXISTS` : aucune migration
destructive n'existe, le retour arrière est donc sûr.

---

## 6. Pannes connues et leur signature dans le tableau de bord

Ces quatre signatures ont été mesurées sur cette machine, sous une charge de
~3 requêtes/seconde. Elles suffisent à identifier la panne sans se connecter.

Toutes ces valeurs ont été relevées en rejouant chaque panne, pas déduites.
Le premier tri se fait sur `up`, et il partage les pannes en deux familles.

### Famille A : `up` vaut 0, et `curl` depuis le poste répond `000`

`000` n'est pas un code HTTP : c'est `curl` qui n'a même pas obtenu de
connexion. Trois pannes différentes donnent cette même image, et seul
`docker ps` les sépare. C'est la commande à taper en premier.

```bash
$SSH "docker ps -a --format '{{.Names}}\t{{.Status}}'"
```

| # | Panne | Ce qu'affiche `docker ps -a` pour `todo-api` | Confirmation |
| --- | --- | --- | --- |
| 1 | `todo-api` arrêté | `Exited (137)` ou `Exited (0)` | `docker logs` s'arrête net, sans erreur |
| 3 | Réseau coupé entre l'API et la base | `Up (healthy)` | `docker inspect -f '{{.NetworkSettings.Networks}}' todo-api` renvoie une liste vide, et `docker port todo-api` n'affiche rien |
| 4 | `todo-api` relancé sans sa configuration | `Exited (1)` | `docker logs todo-api` affiche `Démarrage impossible : Variable d'environnement manquante : DB_HOST` |

La panne 3 est la plus déroutante des trois : le conteneur tourne, se déclare
`healthy`, et pourtant plus rien ne l'atteint. Détaché de son réseau, il perd
aussi la publication de son port 3000, d'où le `000` côté poste et le `up` à 0
côté Prometheus, qui ne le joint plus non plus.

Délai de détection mesuré : `up` passe à 0 en **8 secondes** après l'arrêt du
conteneur, pour un `scrape_interval` de 5 s.

### Famille B : `up` vaut 1, le service répond mais quelque chose cloche

Ici, c'est le p95 qui tranche, pas le taux d'erreur.

| # | Panne | Taux 5xx | p95 | Lecture |
| --- | --- | --- | --- | --- |
| 2 | `todo-db` arrêté | **61 %** | **4,8 s** | Erreurs **et** latence. Le p95 colle aux 3 s de `connectionTimeoutMillis` : ça échoue lentement, donc en aval. |
| 5 | Machine saturée (conteneurs dévoreurs de CPU) | **0 %** | **83 ms** au lieu de 21 | Latence multipliée par 4 sans une seule erreur. Le seul cas de cette forme. |
| hors script | Régression de code déployée | **33 %** | **24 ms** | Erreurs sans latence : ça échoue vite, donc dans le code. L'inverse exact de la panne 2. |

Pour la 2, vérifier `docker ps` : `todo-db` y est `Exited`. Pour la 5,
`docker ps` liste des conteneurs `hog-*` qui n'ont rien à faire là.

### Le piège à connaître avant d'ouvrir un terminal

`docker ps` affiche `todo-api` en **`healthy`** dans les pannes **2, 3 et 5**,
et aussi quand une régression de code est en production. Le `HEALTHCHECK`
interroge `/health` depuis l'intérieur du conteneur, et `/health` ne touche pas
la base, c'est délibéré, pour qu'une panne de base ne déclenche pas des
redémarrages en boucle. **Un `healthy` ne prouve rien d'autre que « le process
Node répond à lui-même ».** La seule commande qui prouve que le service marche
vraiment est celle qui traverse toute la chaîne :

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks   # doit répondre 200
```

### Réparations

```bash
# Panne 1
$SSH "docker start todo-api"

# Panne 2
$SSH "docker start todo-db"

# Panne 3 : réattacher le conteneur à son réseau
$SSH "docker network connect todo-prod todo-api && docker restart todo-api"

# Panne 4 : redéployer proprement (§ 4.4) avec le sha relevé au § 2.1
$SSH "docker inspect -f '{{.Config.Image}}' todo-api"   # pour lire le sha en cours
$SSH "cd /srv/todo && IMAGE='nghtmre/todo-api' TAG='<sha>' docker compose up -d"

# Panne 5 : supprimer les conteneurs dévoreurs
$SSH "docker rm -f \$(docker ps -aq --filter name=hog-)"
```

**Vérification, après n'importe laquelle de ces réparations** :
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks`
répond `200`, et les quatre conteneurs sont listés par
`$SSH "docker ps --format '{{.Names}}'"`.

---

## 7. Ce qui bloque le plus souvent

### 7.1 `Permission denied (publickey)`

La clé privée n'est pas la bonne, ou la publique n'est plus sur la machine.

```bash
ssh-keygen -y -f deploy_key                  # empreinte de la clé locale
$SSH "cat /root/.ssh/authorized_keys"        # ce que la machine accepte
```

Les deux lignes doivent être identiques. Si `deploy_key` a été perdue, la
machine cible doit être reconstruite (§ 7.5) : il n'y a pas d'autre porte.

### 7.2 `Connection refused` sur le port 2222

La machine cible ne tourne plus.

```bash
docker ps -a --filter name=vm-prod --format '{{.Names}} {{.Status}}'
docker start vm-prod
sleep 30      # le daemon Docker interne met ~25 s à accepter des connexions
$SSH "docker ps"
```

Vérification : les quatre conteneurs remontent seuls, grâce au
`restart: unless-stopped`. Vérifié après un redémarrage complet du poste.

### 7.3 Le job `deploy` reste « Queued » sans erreur

Le runner self-hosted n'écoute plus.

```bash
gh api repos/<compte>/<dépôt>/actions/runners --jq '.runners[] | "\(.name) \(.status)"'
```

S'il est `offline`, relancer l'agent depuis son dossier d'installation
(`C:\Users\<vous>\actions-runner`) avec `run.cmd`, et attendre `Listening for
Jobs`. Compter jusqu'à 2 minutes : une ancienne session peut encore tenir la
place, avec le message `A session for this runner already exists`.

### 7.4 `.env` manquant sur la machine cible

`docker compose up` avertit que `DB_PASSWORD` n'est pas défini, et `todo-api`
part en boucle de redémarrage.

```bash
$SSH "cat > /srv/todo/.env" < deploy/env.example
$SSH "vi /srv/todo/.env && chmod 600 /srv/todo/.env"
```

Vérification : `$SSH "cut -d= -f1 /srv/todo/.env"` liste `DB_NAME`,
`DB_USER`, `DB_PASSWORD`. Ne jamais afficher le fichier entier dans un
terminal partagé.

### 7.5 Reconstruire la machine cible de zéro

```bash
docker rm -f vm-prod
ssh-keygen -t ed25519 -N "" -f deploy_key -C "deploy@todo-api"   # si la clé est perdue
docker build -f Dockerfile.vm -t vm-prod .
docker run -d --privileged --name vm-prod \
  -p 2222:22 -p 3000:3000 -p 9090:9090 -p 3001:3001 \
  -v vm-prod-data:/var/lib/docker vm-prod
```

Puis refaire le § 7.4, mettre à jour le secret `DEPLOY_SSH_KEY`
(`gh secret set DEPLOY_SSH_KEY < deploy_key`), et redéployer (§ 4).

### 7.6 Le port 3000 est déjà pris sur la machine cible

`docker compose up` échoue avec `port is already allocated`. Un autre conteneur
occupe le port, et `docker stop todo-api` ne le libérera pas puisqu'il porte un
autre nom.

```bash
$SSH "docker ps --format '{{.Names}}\t{{.Ports}}' | grep 3000"
$SSH "docker rm -f <le nom affiché>"
```

Vérification : `$SSH "docker ps --format '{{.Ports}}' | grep -c 3000"`
répond `0` avant de relancer le § 4.4.

### 7.7 Un panneau Grafana est vide

Dans l'ordre, et pas dans un autre :

1. La source de données répond-elle ? Grafana → Connections → Data sources →
   Prometheus → **Test**. Elle doit pointer sur `http://prometheus:9090`, le
   nom du service. `localhost:9090` désigne Grafana lui-même : c'est l'erreur
   qui fait perdre un quart d'heure.
2. Prometheus voit-il sa cible ? <http://localhost:9090/targets> doit lister
   `todo-api` en **UP**.
3. Seulement ensuite, relire la requête PromQL du panneau.

Cas normal à ne pas confondre avec une panne : le panneau **Erreurs** reste
vide quand il n'y a aucun trafic. Le taux d'erreur est un rapport, et sans
requête il n'est pas défini. Envoyer une requête pour lever le doute.

---

## 8. Vérifications APRÈS déploiement

À faire dans l'ordre, et à comparer avec le § 2.

```bash
$SSH "docker ps --format '{{.Names}}\t{{.Status}}'"
$SSH "docker inspect -f '{{.Config.Image}}' todo-api"
curl -s http://localhost:3000/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks
curl -s http://localhost:3000/metrics | head -3
```

Vérifications attendues :

- quatre conteneurs, `todo-api` et `todo-db` en `(healthy)` ;
- le sha affiché est celui qu'on voulait déployer, pas celui du § 2.1 ;
- `/health` répond `{"status":"ok",...}` ;
- `/api/tasks` répond `200`, c'est celui-là qui prouve que la base répond ;
- `/metrics` commence par `# HELP`, en texte brut.

Puis, sur Grafana (<http://localhost:3001>), tableau de bord
**Todo API, les quatre signaux** : Disponibilité à `EN LIGNE`, et le taux
d'erreur revenu sous 1 % dans les deux minutes.

---

## 9. Escalade

| Situation | Qui prévenir | Canal | Délai |
| --- | --- | --- | --- |
| Retour arrière effectué, service rétabli | Le responsable du service, pour information | Message écrit | Dans l'heure |
| Retour arrière tenté, service toujours cassé | Le responsable du service, immédiatement | Téléphone | Tout de suite |
| Doute sur la marche à suivre | La personne d'astreinte suivante | Téléphone | Avant de toucher à la production |
| Suspicion de fuite de secret (clé, mot de passe) | Le responsable du dépôt | Téléphone, jamais par écrit | Tout de suite |

Après tout incident, écrire un compte rendu sans chercher de coupable :
chronologie minute par minute, impact réel, cause profonde, et les actions
concrètes pour que la même panne ne revienne pas, avec un responsable et une
échéance par action. Le compte rendu va dans le Journal de bord du `README.md`.
