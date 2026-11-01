# Build context is the repository root. No .env or company files enter the context.
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY prisma/schema.prisma prisma/schema.prisma
RUN npm ci
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
COPY packages/api-client packages/api-client
RUN npm run build:api && rm -rf apps/api/dist/tests && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 poppler-utils ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/api-client ./packages/api-client
COPY apps/api/assets ./apps/api/assets
COPY services/statistics/worker.py ./services/statistics/worker.py
COPY scripts/start-production.mjs scripts/deployment-config.mjs ./scripts/
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health/ready',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start-production.mjs"]
