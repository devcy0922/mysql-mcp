# MySQL MCP는 컨테이너에서만 의존성 설치와 검증을 수행한다.
FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY test/ ./test/
RUN npm run typecheck && npm test

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN groupadd --system mcp && useradd --system --gid mcp --create-home mcp \
    && mkdir -p /var/lib/mcp/logs \
    && chown -R mcp:mcp /app /var/lib/mcp
USER mcp

ENTRYPOINT ["node", "dist/src/index.js"]
