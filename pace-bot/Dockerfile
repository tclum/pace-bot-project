FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Runtime assets resolved by compiled scripts via import.meta.url.
# migrate.js expects ../src/db/migrations/ relative to itself (dist/scripts/).
# ingest-concepts.js expects ../data/concepts.json relative to itself.
COPY --from=builder /app/src/db/migrations ./dist/src/db/migrations
COPY --from=builder /app/data ./dist/data

EXPOSE 3000
CMD ["npm", "run", "start:prod"]
