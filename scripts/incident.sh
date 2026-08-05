#!/bin/sh
# incident.sh : casse la production d'une façon tirée au sort, et n'affiche rien.
#
# À lancer SUR la machine cible, sans regarder le résultat :
#   ssh -i deploy_key -p 2222 root@localhost 'sh -s' < scripts/incident.sh
#
# Lire ce fichier à l'avance ne donne aucun avantage : connaître la liste des
# pannes possibles, c'est exactement la situation d'une vraie astreinte. Toute
# la difficulté reste de reconnaître laquelle est en train de se produire, et
# le tableau de bord est là pour ça.
#
# La réponse est écrite en base64 dans /root/.incident, et ne se lit qu'au
# débriefing :  base64 -d /root/.incident

set -u

N=$(( $(od -An -N1 -tu1 /dev/urandom) % 5 + 1 ))
echo "$N" | base64 > /root/.incident

# Relevé avant de casser quoi que ce soit : sans lui, impossible de remettre le
# conteneur dans son état d'origine si la réparation tourne mal.
IMAGE=$(docker inspect -f '{{.Config.Image}}' todo-api 2>/dev/null)

case "$N" in
  # 1. Plus personne ne répond. Signature : up passe à 0 en moins de 15 s.
  1)
    docker stop todo-api > /dev/null 2>&1
    ;;

  # 2. L'API répond, la base a disparu. Signature : up reste à 1, le taux
  #    d'erreur 5xx grimpe, et le p95 explose vers 3 s (le délai du pool).
  2)
    docker stop todo-db > /dev/null 2>&1
    ;;

  # 3. La base tourne, mais l'API ne la joint plus. Même signature que la 2
  #    vue du tableau de bord : c'est docker ps qui les distingue, la base
  #    étant ici toujours Up.
  3)
    NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' todo-api 2>/dev/null | awk '{print $1}')
    [ -n "$NET" ] && docker network disconnect "$NET" todo-api > /dev/null 2>&1
    ;;

  # 4. Relancée sans sa configuration : plus de variables de connexion, plus de
  #    réseau todo-prod. L'API démarre, mais ne trouve plus sa base.
  4)
    docker rm -f todo-api > /dev/null 2>&1
    docker run -d --name todo-api -p 3000:3000 "$IMAGE" > /dev/null 2>&1
    ;;

  # 5. La machine ne respire plus. Signature : tout répond encore, mais le p95
  #    monte sans que le taux d'erreur bouge, et la saturation part en flèche.
  #
  #    Le nombre de dévoreurs est calé sur le nombre de cœurs, et non fixé à
  #    quatre. Mesuré sur cette machine : quatre conteneurs à 100 % de CPU sur
  #    20 cœurs occupent 20 % de la machine, et le p95 de l'API ne bouge pas
  #    (21 ms, contre 24 ms au repos). Une panne qui ne se voit pas n'apprend
  #    rien au pilote, et lui ferait chercher ailleurs pendant dix minutes.
  5)
    COEURS=$(nproc 2>/dev/null || echo 4)
    DEVOREURS=$(( COEURS * 2 ))
    i=1
    while [ "$i" -le "$DEVOREURS" ]; do
      docker run -d --name "hog-$i" alpine sh -c 'while :; do :; done' > /dev/null 2>&1
      i=$(( i + 1 ))
    done
    ;;
esac

exit 0
