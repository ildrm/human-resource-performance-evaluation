FROM node:24.21.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/calculation-engine/package.json ./packages/calculation-engine/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm build

FROM node:24.21.0-bookworm-slim
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY --chown=node:node --from=build /workspace /workspace
ENV NODE_ENV=production
USER node
