# syntax=docker/dockerfile:1
# Sonarly v2 (Go rewrite) — all-in-one image.
#
# Build context must be the REPO ROOT (the directory containing packages/
# and v2/), not docker/:
#
#   docker build -f docker/Dockerfile.v2 \
#     --build-arg SONARLY_VERSION=$(git describe --tags --always) -t sonarly:v2 .
#
# Stages:
#   web-builder    node:22-alpine  — builds packages/web into packages/web/dist
#   server-builder golang:1.23-alpine — builds the v2 Go binary (pure Go, CGO off)
#   runtime        alpine          — ffmpeg + python3/mutagen + su-exec, non-root

# ---------------------------------------------------------------------------
# Stage 1: web client build (Vite + tsc).
# ---------------------------------------------------------------------------
FROM node:22-alpine AS web-builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

COPY packages/web packages/web

# --filter <pkg>... (trailing dots) builds the package and its workspace deps.
RUN pnpm --filter @sonarly/web... build

# ---------------------------------------------------------------------------
# Stage 2: v2 Go server. modernc.org/sqlite is pure Go, so CGO stays off and
# the binary runs on a bare alpine runtime.
# ---------------------------------------------------------------------------
FROM golang:1.23-alpine AS server-builder
WORKDIR /src

ARG SONARLY_VERSION=0.0.0-dev

COPY v2/go.mod v2/go.sum ./v2/
RUN cd v2 && go mod download

COPY v2 ./v2

RUN cd v2 && CGO_ENABLED=0 go build \
      -ldflags "-X github.com/miquelrosell99/sonarly/v2/internal/buildinfo.Version=${SONARLY_VERSION}" \
      -o /out/sonarly ./cmd/sonarly

# ---------------------------------------------------------------------------
# Stage 3: runtime. Tooling: ffmpeg (transcoding), python3 + mutagen==1.48.1
# (tag editing), su-exec (privilege drop in the entrypoint), wget (HEALTHCHECK).
# ---------------------------------------------------------------------------
FROM alpine:3.20

RUN apk add --no-cache ffmpeg python3 py3-pip su-exec wget \
  && pip3 install --no-cache-dir mutagen==1.48.1 --break-system-packages

WORKDIR /app

COPY --from=server-builder /out/sonarly ./sonarly
COPY --from=web-builder /app/packages/web/dist ./web-dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Defaults mirror the v1 compose shape; everything is overridable at runtime.
#   /data/db     SQLite DB + server-owned state (artist images, uploads)
#   /data/ingest drop folder
#   /media/music the music library (mounted read-only is fine)
ENV SONARLY_ADDR=":3000" \
    SONARLY_DB_PATH="/data/db/sonarly.db" \
    SONARLY_DATA_DIR="/data/db" \
    SONARLY_LIBRARY_PATH="/media/music" \
    SONARLY_INGEST_PATH="/data/ingest" \
    SONARLY_WEB_DIST="/app/web-dist" \
    PUID="1000" \
    PGID="1000"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
