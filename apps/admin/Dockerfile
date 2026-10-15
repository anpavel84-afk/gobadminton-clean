# syntax=docker/dockerfile:1.7
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY scripts/check-node.mjs scripts/check-node.mjs
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile --filter @gobadminton/admin...
COPY apps/admin apps/admin
COPY packages/tooling packages/tooling
RUN pnpm --filter @gobadminton/admin build
FROM node:24.21.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3010
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV ADMIN_INTERNAL_APP_ENABLED=0
RUN useradd --system --uid 10001 --create-home gobadminton
COPY --from=build --chown=gobadminton:gobadminton /app/apps/admin/.next/standalone ./
COPY --from=build --chown=gobadminton:gobadminton /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=gobadminton:gobadminton /app/apps/admin/public ./apps/admin/public
USER gobadminton
EXPOSE 3010
CMD ["node", "apps/admin/server.js"]
