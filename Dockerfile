# Stage 1 : dépendances de production
FROM node:22.14.0-alpine AS deps

WORKDIR /app

# package*.json avant le code : la couche npm ci reste en cache tant que les
# dépendances ne changent pas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2 : image finale, sans le cache npm ni les outils du stage précédent
FROM node:22.14.0-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# L'image node fournit déjà cet utilisateur non privilégié.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD node -e "const p=process.env.PORT||3000;require('http').get('http://127.0.0.1:'+p+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Forme exec : le process Node devient PID 1 et reçoit SIGTERM.
CMD ["node", "src/index.js"]
