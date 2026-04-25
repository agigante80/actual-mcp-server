FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apk add --no-cache python3 make g++
RUN npm ci --production=false
COPY . ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Accept VERSION as build argument and set as environment variable
ARG VERSION=unknown
ENV VERSION=${VERSION}
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts

# Run as non-root
RUN addgroup -S app && adduser -S app -G app

# Create data directory with proper ownership BEFORE switching to non-root user
RUN mkdir -p /app/data && chown -R app:app /app/data

USER app

EXPOSE 3600

# Healthcheck: Verify the MCP server is responding
# Use $MCP_BRIDGE_PORT if set, otherwise default to 3600 (HTTP mode default)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${MCP_BRIDGE_PORT:-3600}/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

# Use exec form with sh to allow environment variable expansion and proper signal handling
CMD ["sh", "-c", "node dist/src/index.js ${MCP_TRANSPORT_MODE:---http}"]
