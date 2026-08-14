# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --include=dev
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ---- run ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8420 DATA_DIR=/data
COPY server.cjs ./
COPY --from=build /app/dist ./dist
# COPY preserves whatever file-mode bits existed on the host. If server.cjs
# (or anything else) ends up non-world-readable there -- an extracted zip, an
# editor's umask, various things unrelated to this Dockerfile -- the image
# still builds fine but the non-root user below can't read its own entry
# file at startup (EACCES on `node server.cjs`). Fix permissions explicitly
# here so the container never depends on the host's file modes.
RUN chmod -R a+rX /app && mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8420
USER node
CMD ["node", "server.cjs"]
