FROM node:22-alpine AS build
WORKDIR /app
# Upgrade npm to latest version to fix security vulnerabilities in npm's dependencies
RUN npm install -g npm@latest
COPY package.json package-lock.json* ./
RUN npm ci --production=false
# CRITICAL FIX: Force Zod 3.x (DO NOT REMOVE)
# Problem: npm chooses Zod 4.x for @modelcontextprotocol/sdk peer dependency (^3.25 || ^4.0)
# Impact: Zod 4.x breaks zod-to-json-schema, causing LibreChat to detect 0 tools instead of 53
# Solution: Remove npm's choice and force install Zod 3.25.76
# See: docs/ZOD_VERSION_CONSTRAINT.md for full details
RUN rm -rf node_modules/zod && npm install --no-save zod@3.25.76
COPY . ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
# Upgrade npm to latest version to fix security vulnerabilities in npm's dependencies
RUN npm install -g npm@latest
ENV NODE_ENV=production
# Accept VERSION as build argument and set as environment variable
ARG VERSION=unknown
ENV VERSION=${VERSION}
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/openapi ./scripts/openapi
COPY --from=build /app/generated ./generated
COPY --from=build /app/src/lib ./src/lib

# Run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

# Healthcheck: Verify the MCP server is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Use exec form with sh to allow environment variable expansion and proper signal handling
CMD ["sh", "-c", "node dist/src/index.js ${MCP_TRANSPORT_MODE:---http}"]
