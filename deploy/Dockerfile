# syntax=docker/dockerfile:1

FROM golang:1.27.4-alpine AS wasm-builder
WORKDIR /app

COPY engine/sudoku ./engine/sudoku
COPY scripts/build-wasm.sh ./scripts/build-wasm.sh

RUN sh ./scripts/build-wasm.sh

FROM oven/bun:1.4.5-alpine AS web-builder
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/game-core/package.json ./packages/game-core/
COPY packages/ui/package.json ./packages/ui/
COPY games/sudoku/package.json ./games/sudoku/

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY games ./games
COPY apps/web ./apps/web
COPY --from=wasm-builder /app/apps/web/public/wasm ./apps/web/public/wasm

RUN bun run build && \
    find /app/apps/web/dist -type f \
      \( -name '*.wasm' -o -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' -o -name '*.html' -o -name '*.webmanifest' \) \
      -exec sh -c 'for f do gzip -9 -c "$f" > "$f.gz"; done' _ {} +

FROM golang:1.27.4-alpine AS api-builder
WORKDIR /src

COPY go.work ./
COPY engine/sudoku/ ./engine/sudoku/
COPY services/api/ ./services/api/

RUN mkdir -p /data && chown 65532:65532 /data
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./services/api/cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=api-builder --chown=65532:65532 /data /data
COPY --from=api-builder /out/server /server
COPY --from=web-builder /app/apps/web/dist /srv/web

ENV HEARTHSIDE_ADDR=:8080 \
    HEARTHSIDE_DB_PATH=/data/hearthside.db \
    HEARTHSIDE_WEB_DIR=/srv/web \
    HEARTHSIDE_COOKIE_SECURE=true \
    HEARTHSIDE_LOG_LEVEL=info

USER nonroot:nonroot
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/server", "-healthcheck"]

ENTRYPOINT ["/server"]
