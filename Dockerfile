# ---- build the React app (client bundle + server-render bundle) ----
FROM node:24-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- runtime: API + built client ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data
WORKDIR /app
# ffmpeg turns course videos into protected streams (server/video.js)
RUN apk add --no-cache ffmpeg
COPY server/package.json server/package-lock.json server/
RUN npm ci --omit=dev --prefix server && npm cache clean --force
COPY server/ server/
COPY --from=client /app/client/dist client/dist
COPY --from=client /app/client/dist-ssr client/dist-ssr
# SQLite database, uploads, backups and the generated signing secret live in /data
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node
EXPOSE 4000
# the deployed version (server/scripts/deploy.sh passes the git sha): tags error reports, so a new error is tied to a deploy
ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/start.js"]
