# Multi-stage build. Produces one image used for BOTH the web service and the
# worker service (different CMD in docker-compose). The worker is still an
# isolated process - it shares only library code, never a runtime.
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/worker ./worker
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json /app/next.config.mjs /app/tsconfig.json ./

# Drop privileges.
RUN useradd -m -u 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["npm", "run", "start"]
