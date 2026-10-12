# syntax=docker/dockerfile:1.7
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY scripts/check-node.mjs scripts/check-node.mjs
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tooling/package.json packages/tooling/package.json
RUN pnpm install --frozen-lockfile --filter @gobadminton/api...
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/tooling packages/tooling
RUN pnpm --filter @gobadminton/contracts run check \
  && pnpm --filter @gobadminton/api run build

FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
RUN useradd --system --uid 10001 --create-home gobadminton \
  && mkdir -p /var/lib/gobadminton/avatars \
  && chown gobadminton:gobadminton /var/lib/gobadminton/avatars \
  && chmod 700 /var/lib/gobadminton/avatars
COPY --from=build --chown=gobadminton:gobadminton /app /app
WORKDIR /app/apps/api
USER gobadminton
EXPOSE 3000
CMD ["node", "dist/main.js"]
