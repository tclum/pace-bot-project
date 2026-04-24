FROM node:20-alpine AS builder
WORKDIR /app

# Vite bakes VITE_* env vars at build time — Railway supplies them during build.
# ARG makes build-args visible to the Dockerfile; ENV re-exports them into the
# shell environment of subsequent RUN commands (npm run build in particular),
# which is where Vite's import.meta.env reads happen.
ARG VITE_API_BASE_URL
ARG VITE_LIVEKIT_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL

COPY package*.json ./
RUN npm ci
COPY . .
# Sanity check: surfaces the build-time value in deploy logs so a misconfigured
# Railway env (missing or typoed VITE_API_BASE_URL) shows up before the build runs.
RUN echo "VITE_API_BASE_URL is set to: $VITE_API_BASE_URL"
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist /app/dist
EXPOSE 3000
# -s (SPA mode) routes unmatched paths to index.html so React Router works.
CMD ["serve", "-s", "/app/dist", "-l", "3000"]
