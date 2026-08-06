#!/bin/sh
# chaos.sh : tire une panne au hasard parmi cinq, sur todo-cluster.
#
# À lancer depuis le poste, kubectl doit déjà pointer sur todo-cluster :
#   ./scripts/chaos.sh
#
# Le script n'affiche rien de ce qu'il vient de faire : le sujet, c'est le
# diagnostic, pas la surprise. Le lire à l'avance ne triche pas, la difficulté
# reste de reconnaître laquelle des cinq est en train de se produire.
#
# La réponse est écrite en base64 dans .incident, et ne se lit qu'une fois le
# diagnostic posé :  base64 -d .incident
#
# Deux de ces pannes se réparent toutes seules, le cluster sachant les voir.
# Les trois autres attendent une main humaine : le tableau des signatures et
# des remèdes est dans docs/PROCEDURE_DEPLOIEMENT.md.

set -u

N=$(( $(od -An -N1 -tu1 /dev/urandom) % 5 + 1 ))
echo "$N" | base64 > .incident

POD=$(kubectl get pods -n todo -l app=todo-api -o jsonpath='{.items[0].metadata.name}')
IMAGE=$(kubectl get deployment todo-api -n todo -o jsonpath='{.spec.template.spec.containers[0].image}')
REPO="${IMAGE%%:*}"

case "$N" in
  # 1. Un pod disparaît. Le cluster le voit et le remplace : rien à faire.
  1)
    kubectl delete pod -n todo "$POD"
    ;;

  # 2. Le processus meurt à l'intérieur du conteneur, sans que le pod
  #    disparaisse. kubelet redémarre le conteneur, le compteur RESTARTS monte.
  2)
    kubectl exec -n todo "$POD" -- kill 1
    ;;

  # 3. L'image ciblée n'existe nulle part. Le rollout reste bloqué, les anciens
  #    pods continuent de servir : la panne ne se voit pas côté client.
  3)
    kubectl set image deployment/todo-api "todo-api=${REPO}:ce-tag-n-existe-pas" -n todo
    ;;

  # 4. L'application redémarre sans un secret qu'elle exige.
  4)
    kubectl patch secret todo-secret -n todo --type=json \
      -p='[{"op":"remove","path":"/data/DB_PASSWORD"}]'
    kubectl rollout restart deployment/todo-api -n todo
    ;;

  # 5. La limite mémoire ne laisse plus l'application démarrer.
  5)
    kubectl patch deployment todo-api -n todo --type=json \
      -p='[{"op":"add","path":"/spec/template/spec/containers/0/resources","value":{"limits":{"memory":"8Mi"}}}]'
    ;;
esac >/dev/null 2>&1

exit 0
