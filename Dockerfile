# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# package.json points at the phone app's native scanner plugin as a local
# folder (file:native/live-scanner), so `npm ci` needs that folder to exist.
# The web build only ever uses its tiny JS entry; the Android/iOS code in it
# is for the phone app and stays out of the image.
COPY native/live-scanner/package.json native/live-scanner/index.js ./native/live-scanner/
RUN npm ci --no-audit --no-fund --include=dev
COPY index.html vite.config.js ./
# vite copies public/ into dist verbatim — it holds the Tesseract worker and
# wasm the card scanner loads at runtime. Without this the app builds and runs
# but scanning 404s on files that exist perfectly well in the repo.
COPY public ./public
COPY src ./src
RUN npm run build

# ---- run ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8420 DATA_DIR=/data
# Accounts use Node's built-in SQLite, which
# Node 22 still labels experimental and warns about on every start.
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
# Every server-side module, by glob rather than by name. This line used to
# list them one by one, which meant adding a module to server.cjs shipped an
# image that crash-looped on MODULE_NOT_FOUND — the code was right, the
# packaging wasn't. docker-packaging-test.jsx now fails if this drifts again.
COPY *.cjs ./
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
