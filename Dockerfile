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
# Install curl for healthchecks and bootstrap scripts
RUN apk add --no-cache curl
# Upgrade npm to latest version to fix security vulnerabilities in npm's dependencies
RUN npm install -g npm@latest
ENV NODE_ENV=production
# Accept VERSION as build argument and set as environment variable
ARG VERSION=unknown
ENV VERSION=${VERSION}
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/generated ./generated
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/test-data ./test-data

# Make bootstrap script executable (for E2E testing)
RUN chmod +x scripts/bootstrap-actual-server.sh 2>/dev/null || true

# Run as non-root
RUN addgroup -S app && adduser -S app -G app

# Create data directory with proper ownership BEFORE switching to non-root user
RUN mkdir -p /app/data && chown -R app:app /app/data

USER app

EXPOSE 3000 3600

# Healthcheck: Verify the MCP server is responding
# Use $MCP_BRIDGE_PORT if set, otherwise default to 3600 (HTTP mode default)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${MCP_BRIDGE_PORT:-3600}/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

# Use exec form with sh to allow environment variable expansion and proper signal handling
CMD ["sh", "-c", "node dist/src/index.js ${MCP_TRANSPORT_MODE:---http}"]
