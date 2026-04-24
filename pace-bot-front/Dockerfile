FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
# Vite bakes VITE_* env vars at build time — Railway supplies them during build.
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist /app/dist
EXPOSE 3000
# -s (SPA mode) routes unmatched paths to index.html so React Router works.
CMD ["serve", "-s", "/app/dist", "-l", "3000"]
