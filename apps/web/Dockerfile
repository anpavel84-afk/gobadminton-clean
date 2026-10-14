# syntax=docker/dockerfile:1.7
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY scripts/check-node.mjs scripts/check-node.mjs
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tooling/package.json packages/tooling/package.json
RUN pnpm install --frozen-lockfile --filter @gobadminton/web...
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/tooling packages/tooling
ENV API_BASE_URL=http://127.0.0.1:3000
RUN pnpm --filter @gobadminton/web run build

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
RUN useradd --system --uid 10001 --create-home gobadminton
COPY --from=build --chown=gobadminton:gobadminton /app/apps/web/.next/standalone ./
COPY --from=build --chown=gobadminton:gobadminton /app/apps/web/.next/static ./apps/web/.next/static
# Next standalone does not bundle public/; serve brand/discovery/PWA assets from apps/web/public
COPY --from=build --chown=gobadminton:gobadminton /app/apps/web/public ./apps/web/public
USER gobadminton
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
