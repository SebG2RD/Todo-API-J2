# Procédure de déploiement de la Todo API

Ce document n'explique pas comment le système fonctionne : il dit quoi taper,
dans quel ordre, et comment vérifier que ça a marché. Pour comprendre
l'architecture, lire le `README.md`. Pour rétablir un service à 3 h du matin,
rester ici.

Toutes les commandes se collent telles quelles. Les seules valeurs à remplacer
sont écrites `<comme ceci>`.

La cible est un cluster Kubernetes, plus une machine unique jointe par SSH. Il
n'y a donc plus rien à copier, plus de `docker compose`, et le retour arrière
est une commande `kubectl`.

- Durée d'un déploiement normal : 2 min de bout en bout depuis le push, dont
  23 s pour le seul rollout. Au-delà de 5 minutes, aller au § 6.
- Coupure attendue : aucune. Les pods sont remplacés un par un, et un ancien ne
  part jamais avant qu'un nouveau soit prêt.
- Fenêtre de maintenance : aucune contrainte.

---

## 1. Ce qu'il faut avoir sous la main avant de commencer

| Élément | Valeur | Où le trouver |
| --- | --- | --- |
| Cluster | `todo-cluster` | k3d, sur le poste de travail |
| Contexte kubectl | `k3d-todo-cluster` | `~/.kube/config` |
| Namespace | `todo` | |
| Deployment | `todo-api`, 3 replicas | `k8s/todo-api-deployment.yaml` |
| Base | `todo-db`, 1 replica, volume `todo-db-data` | `k8s/todo-db.yaml` |
| Secret | `todo-secret` | Dans le cluster uniquement. Modèle : `k8s/todo-secret.example.yaml` |
| Image | `nghtmre/todo-api:<sha du commit>` | Docker Hub |
| API | <http://todo.localhost:8080> | Par l'Ingress Traefik |

Raccourci utilisé partout dans ce document :

```bash
cd "<racine du dépôt>"
K="kubectl -n todo --context k3d-todo-cluster"
```

Vérification : `$K get nodes` répond avec un nœud `Ready`. Si non, § 6.7.

---

## 2. Vérifications AVANT de toucher à quoi que ce soit

Ces relevés servent de point de comparaison. Sans eux, impossible de prouver
après coup que le déploiement a amélioré ou dégradé les choses.

```bash
# 2.1. Quelle version tourne ? Noter ce sha : c'est la cible du retour arrière.
$K get deployment todo-api -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

# 2.2. Tout est-il debout ?
$K get pods

# 2.3. Le service répond-il, là, maintenant ?
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: todo.localhost" http://localhost:8080/api/tasks
```

Vérifications attendues :

- 2.1 affiche un tag de 40 caractères hexadécimaux. S'il affiche `latest`,
  quelqu'un a déployé à la main hors pipeline : le retour arrière sera une
  enquête, prévenir avant de continuer.
- 2.2 liste 3 pods `todo-api` en `1/1 Running` et 1 pod `todo-db` en
  `1/1 Running`.
- 2.3 répond `200`. **C'est la seule commande qui prouve que la chaîne
  complète fonctionne** : voir le piège du § 5.

---

## 3. Déploiement automatique, le cas normal

Il n'y a rien à taper. Un `git push` sur `main` suffit :

1. `test` et `test-integration` tournent sur des machines fournies par GitHub.
2. `build` construit l'image et la pousse sur Docker Hub, taguée au sha.
3. `deploy` tourne sur le runner self-hosted, applique les manifestes avec le
   tag du commit substitué, puis attend `kubectl rollout status`.

Vérification : les quatre jobs sont verts dans l'onglet Actions. Le job
`deploy` affiche `deployment "todo-api" successfully rolled out`, puis
`/api/tasks répond 200`.

Le job ne peut pas mentir : `kubectl set image` et `kubectl apply` rendent la
main immédiatement, sans rien garantir. C'est `rollout status` qui attend la
convergence réelle, pod par pod, et qui sort en code 1 si elle n'arrive pas.
Vérifié : sur un tag inexistant, il rend `error: timed out waiting for the
condition` et le job devient rouge.

Prérequis à contrôler une fois pour toutes, sinon rien ne part :

```bash
gh secret list   # DOCKERHUB_USERNAME et DOCKERHUB_TOKEN suffisent désormais
gh api repos/<compte>/<dépôt>/actions/runners --jq '.runners[] | "\(.name) \(.status)"'
                 # doit afficher : vm-prod-host online
```

Les secrets `DEPLOY_*` de la version SSH ne servent plus. Le runner partage la
machine du cluster et lit le même kubeconfig que les commandes tapées à la
main : aucune clé, aucun tunnel.

Un runner `offline` laisse le job `deploy` en Queued indéfiniment, sans message
d'erreur. Aller au § 6.8.

---

## 4. Déploiement manuel d'urgence, si la pipeline est en panne

À n'utiliser que si GitHub Actions est indisponible.

```bash
# 4.1. Choisir la version. Un sha de commit, jamais "latest".
SHA=<sha du commit à déployer>

# 4.2. Vérifier que l'image existe AVANT de toucher au cluster.
docker manifest inspect nghtmre/todo-api:$SHA > /dev/null && echo "image trouvée"
```

Vérification : la commande affiche `image trouvée`. Si elle répond
`manifest unknown`, ne pas continuer, reprendre au 4.1.

```bash
# 4.3. Appliquer l'état voulu, avec le tag substitué comme le fait la pipeline.
sed "s|image: .*/todo-api:.*|image: nghtmre/todo-api:$SHA|" k8s/todo-api-deployment.yaml \
  | $K apply -f -
```

Vérification : la sortie affiche `deployment.apps/todo-api configured`.

**Piège vérifié** : un `$K apply -f k8s/todo-api-deployment.yaml` sans
substitution ramène le tag écrit dans le fichier et fait **reculer la
production d'une version**, sans erreur ni avertissement. C'est le `sed`
ci-dessus qui l'évite, et c'est exactement ce que fait la pipeline.

```bash
# 4.4. Attendre la convergence réelle.
$K rollout status deployment/todo-api --timeout=180s
```

Vérification : `deployment "todo-api" successfully rolled out`, et le code de
sortie vaut `0` (`echo $?`).

```bash
# 4.5. Vérifier que le service répond vraiment.
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: todo.localhost" http://localhost:8080/api/tasks

# 4.6. Confirmer la version réellement en place.
$K get deployment todo-api -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Vérification : `200`, et le sha affiché est celui du 4.1.

---

## 5. Le piège à connaître avant d'ouvrir un terminal

`/health` ne touche pas la base. Il répond `200` même quand PostgreSQL est
mort, et les deux sondes du pod sont bâties dessus : elles mentent donc de la
même façon.

Mesuré en coupant la base sans toucher à l'API :

| Ce que le cluster affirme | Ce que rend le service |
| --- | --- |
| 3 pods `READY 1/1 Running` | `GET /health` → `200` |
| 0 événement `Unhealthy` dans `describe pod` | `GET /api/tasks` → `503` |
| 0 redémarrage | |

**Un pod `READY 1/1` ne prouve rien d'autre que « le serveur HTTP répond à
lui-même ».** La seule commande qui prouve que le service marche est celle qui
traverse toute la chaîne :

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: todo.localhost" http://localhost:8080/api/tasks
```

Cette limite se documente, elle ne se corrige pas à la légère. Un `/health` qui
interrogerait la base à chaque appel protégerait de ce mensonge, mais exposerait
l'application à une cascade de sondes qui échouent toutes en même temps dès que
la base ralentit un peu, et donc à des redémarrages en boucle qui aggraveraient
la panne.

---

## 6. Pannes connues, leur signature et leur remède

Les cinq premières lignes correspondent aux tirages de `scripts/chaos.sh`.
Toutes ont été rejouées et mesurées, aucune n'est déduite.

**Le réflexe qui fait gagner le plus de temps** : les cinq pannes laissent
`/api/tasks` répondre `200`. Les anciens pods continuent de servir pendant que
le nouveau échoue. **Une panne de déploiement ne se voit pas depuis
l'extérieur**, elle ne se voit que dans `kubectl get pods`. C'est la première
commande à taper, avant tout curl.

```bash
$K get pods
$K describe pod <le pod qui ne va pas>   # les événements sont en bas
```

| # | Panne | `get pods` | `describe` / logs | Se répare seule ? | Remède |
| --- | --- | --- | --- | --- | --- |
| 1 | Un pod supprimé | un pod `Terminating`, un nouveau apparaît | rien d'anormal | **Oui, 10 s** | aucun |
| 2 | Processus tué dans le conteneur | même pod, `RESTARTS` +1 | `Last State: Terminated`, `Reason: Completed`, `Exit Code: 0` | **Oui, 9 s** | aucun |
| 3 | Tag d'image inexistant | un pod `ErrImagePull` puis `ImagePullBackOff`, les 3 anciens `Running` | `Failed to pull image ... : not found` | Non | `$K rollout undo deployment/todo-api` (1 s) |
| 4 | Clé du Secret supprimée | un pod `CrashLoopBackOff`, les 3 anciens `Running` | `Exit Code: 1`, log : `Variable d'environnement manquante : DB_PASSWORD` | Non | restaurer la clé puis `$K rollout restart deployment/todo-api` (21 s) |
| 5 | Limite mémoire trop basse | un pod `CrashLoopBackOff`, les 3 anciens `Running` | `Last State: Terminated`, `Reason: OOMKilled`, `Exit Code: 137` | Non | réappliquer le manifeste du dépôt (§ 4.3) |

Ce que le cluster répare, et ce qu'il ne répare pas : la boucle de
réconciliation corrige ce qu'elle peut voir, un pod qui manque ou un conteneur
qui s'est arrêté. Une image introuvable, un secret absent ou une limite mal
calibrée sont des états voulus, écrits par un humain. Le cluster les applique
fidèlement et attend qu'un humain les corrige.

### Réparations, commandes exactes

```bash
# Panne 3 : revenir à la révision précédente
$K rollout undo deployment/todo-api
$K rollout status deployment/todo-api --timeout=180s

# Panne 4 : restaurer la clé manquante, puis relancer les pods
$K patch secret todo-secret -p '{"stringData":{"DB_PASSWORD":"<le mot de passe>"}}'
$K rollout restart deployment/todo-api
$K rollout status deployment/todo-api --timeout=180s

# Panne 5 : réappliquer l'état voulu du dépôt (voir le § 4.3 pour le tag)
sed "s|image: .*/todo-api:.*|image: nghtmre/todo-api:<sha>|" k8s/todo-api-deployment.yaml | $K apply -f -
$K rollout status deployment/todo-api --timeout=180s
```

Vérification, après n'importe laquelle : `$K get pods` ne montre que des pods
`1/1 Running`, et `/api/tasks` répond `200`.

### 6.6 La base ne répond plus

Signature : `/health` → `200`, `/api/tasks` → `503`, pods `todo-api` tous
`READY 1/1`. Voir le § 5.

```bash
$K get pods -l app=todo-db
$K get endpointslice -l kubernetes.io/service-name=todo-db
$K logs -l app=todo-api --tail=5
```

- Si le pod `todo-db` est absent ou `0/1` : `$K rollout restart deployment/todo-db`.
- Si le pod tourne mais que la liste d'endpoints est **vide**, le `selector` du
  Service ne colle plus aux étiquettes des pods. Vérifié : les pods PostgreSQL
  tournent, et l'API reçoit `ECONNREFUSED` sur l'IP du Service.
  Remède : `$K apply -f k8s/todo-db.yaml`.

### 6.7 `kubectl` ne joint pas le cluster

```bash
kubectl config current-context        # doit afficher k3d-todo-cluster
docker ps --filter name=k3d-todo-cluster
k3d cluster start todo-cluster        # si les conteneurs sont arrêtés
```

**Piège spécifique à Docker Desktop sous Windows** : `k3d` écrit un kubeconfig
qui pointe sur `https://host.docker.internal:<port>`, lequel résout vers l'IP
du réseau local et ne répond pas. Le symptôme est une série de
`dial tcp 192.168.x.x:<port>: connectex: A connection attempt failed`.

```bash
PORT=$(docker port k3d-todo-cluster-serverlb 6443/tcp | head -1 | cut -d: -f2)
kubectl config set-cluster k3d-todo-cluster --server="https://127.0.0.1:$PORT"
kubectl get nodes
```

### 6.8 Le job `deploy` reste « Queued » sans erreur

Le runner self-hosted n'écoute plus, ou il a été redémarré pendant que GitHub
lui assignait le job.

```bash
gh api repos/<compte>/<dépôt>/actions/runners --jq '.runners[] | "\(.name) \(.status)"'
```

S'il est `offline`, relancer `run.cmd` depuis `C:\Users\<vous>\actions-runner`
et attendre `Listening for Jobs`. Compter jusqu'à 2 minutes : une ancienne
session peut tenir la place, avec `A session for this runner already exists`
dans `runner.err`.

Si le runner est `online` et que le job reste malgré tout en attente, il a été
assigné à une session morte. **Vérifié deux fois** : annuler le run et le
relancer est le seul remède, l'attente ne débloque rien.

```bash
gh run cancel <id>
gh workflow run ci.yml --ref main
```

### 6.9 Le port 8080 est déjà pris

`k3d cluster create` échoue sur un port occupé, en général par un cluster de
démonstration resté en place.

```bash
k3d cluster list
k3d cluster delete <l'autre cluster>
```

---

## 7. Retour arrière

### 7.1 Quand le déclencher, et qui décide

| Signal observé | Action | Qui décide |
| --- | --- | --- |
| Taux d'erreur 5xx au-dessus de 5 % pendant plus de 2 minutes | Retour arrière immédiat, sans validation supplémentaire | La personne d'astreinte, seule |
| `/api/tasks` répond une erreur alors que les pods sont `1/1` | Retour arrière immédiat | La personne d'astreinte, seule |
| Latence en hausse, taux d'erreur sous 1 % | Surveiller 10 minutes, prévenir l'astreinte | La personne d'astreinte alerte, ne décide pas seule |
| Signal ambigu, rien de franchement rouge | Ne rien toucher, attendre une validation humaine | Le responsable du service |

### 7.2 Comment le faire

```bash
$K rollout undo deployment/todo-api
$K rollout status deployment/todo-api --timeout=180s
```

Vérification : `/api/tasks` répond `200`.

**Durée mesurée**, du constat au premier `200` : **13,6 s**. La convergence
complète des trois pods prend 23 s, mais le service est rétabli avant, dès que
le premier pod sain est prêt.

Pour viser une révision précise, et pas seulement la précédente :

```bash
$K rollout history deployment/todo-api
$K rollout undo deployment/todo-api --to-revision=<N>
```

Vérifié : une révision qui n'existe pas échoue proprement avec
`error: unable to find specified revision 999 in history`, code de sortie 1, et
**la production ne bouge pas**.

### 7.3 Limite connue

Ce retour arrière ne concerne que le code. Si un déploiement a modifié le
schéma de la base, revenir sur le code sans revenir sur le schéma peut casser
autant que le bug qu'on fuyait. À ce jour, `db/schema.sql` n'utilise que des
`CREATE ... IF NOT EXISTS` : aucune migration destructive n'existe, le retour
arrière est donc sûr.

Les données, elles, ne sont jamais en jeu : elles vivent dans la
PersistentVolumeClaim `todo-db-data`, détachée du cycle de vie du pod. Vérifié :
une tâche créée survit à la suppression du pod PostgreSQL.

---

## 8. Vérifications APRÈS déploiement

À faire dans l'ordre, et à comparer avec le § 2.

```bash
$K get pods
$K get deployment todo-api -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
curl -s -H "Host: todo.localhost" http://localhost:8080/health
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: todo.localhost" http://localhost:8080/api/tasks
$K top pods
```

Vérifications attendues :

- 3 pods `todo-api` en `1/1 Running`, 0 redémarrage, plus un pod `todo-db` ;
- le sha affiché est celui qu'on voulait déployer, pas celui du § 2.1 ;
- `/health` répond `{"status":"ok",...}` ;
- `/api/tasks` répond `200`, et c'est celui-là qui prouve que la base répond ;
- `$K top pods` affiche 16 à 17 Mi par pod. Au-delà de 60 Mi, quelque chose a
  changé : la limite est à 96 Mi et un `OOMKilled` guette.

---

## 9. Escalade

| Situation | Qui prévenir | Canal | Délai |
| --- | --- | --- | --- |
| Retour arrière effectué, service rétabli | Le responsable du service, pour information | Message écrit | Dans l'heure |
| Retour arrière tenté, service toujours cassé | Le responsable du service, immédiatement | Téléphone | Tout de suite |
| Doute sur la marche à suivre | La personne d'astreinte suivante | Téléphone | Avant de toucher au cluster |
| Suspicion de fuite de secret | Le responsable du dépôt | Téléphone, jamais par écrit | Tout de suite |

Après tout incident, écrire un compte rendu sans chercher de coupable :
chronologie minute par minute, impact réel, cause profonde, et les actions
concrètes pour que la même panne ne revienne pas, avec un responsable et une
échéance par action. Le compte rendu va dans le Journal de bord du `README.md`.
