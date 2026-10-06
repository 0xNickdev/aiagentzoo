# Build from the repository root:  docker build -f apps/node/Dockerfile -t aiagentzoo-node .
FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/node/package.json apps/node/
RUN npm ci --workspace @aiagentzoo/sdk --workspace @aiagentzoo/node --include-workspace-root=false
COPY packages/sdk packages/sdk
RUN npm run build -w @aiagentzoo/sdk
COPY apps/node apps/node

FROM node:24-slim
WORKDIR /repo
ENV NODE_ENV=production ZOO_DATA_DIR=/data PORT=8787
COPY --from=build /repo /repo
EXPOSE 8787
WORKDIR /repo/apps/node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
