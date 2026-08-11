# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ---- run ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8420 DATA_DIR=/data
COPY server.cjs ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8420
USER node
CMD ["node", "server.cjs"]
