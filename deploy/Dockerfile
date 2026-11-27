FROM oven/bun:1.4.5-alpine AS builder

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

RUN bun run build

FROM nginx:alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
