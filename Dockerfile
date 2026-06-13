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
# Runtime tools for the PUID/PGID entrypoint (#227): su-exec drops privileges,
# shadow gives usermod/groupmod, tini is the init that reaps and forwards signals.
RUN apk add --no-cache su-exec shadow tini

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts

# Non-root user with an EXPLICIT uid/gid so the entrypoint can remap it to the
# host's PUID/PGID on Unraid.
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

# Create the writable volume dirs and own only those (app code and node_modules
# are world-readable as copied). The entrypoint re-chowns these to the runtime
# PUID/PGID at startup (#227).
RUN mkdir -p /app/data /app/logs && chown -R app:app /app/data /app/logs

# Canonical in-image data dir (#228): point the app's default at exactly the
# directory created and chowned above, so a bare `docker run` can write its
# Actual data without EACCES. Overridable at runtime.
ENV MCP_BRIDGE_DATA_DIR=/app/data

# PUID/PGID privilege-drop entrypoint (#227).
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# NOTE: the container starts as ROOT so the entrypoint can align PUID/PGID and
# fix volume ownership, then drops to the non-root `app` user via su-exec. No
# `USER` line: dropping privileges is the entrypoint's job.

EXPOSE 3600

# Healthcheck: Verify the MCP server is responding
# Use $MCP_BRIDGE_PORT if set, otherwise default to 3600 (HTTP mode default)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${MCP_BRIDGE_PORT:-3600}/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

# tini reaps and forwards signals; the entrypoint applies PUID/PGID then drops
# privileges and execs the CMD.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]

# Shell form for ${MCP_TRANSPORT_MODE} expansion, with an inner `exec` so NODE
# (not sh) is the leaf process and tini's forwarded SIGTERM reaches the Node
# cleanup() handler (pool drain + api.shutdown) for graceful shutdown (#227).
CMD ["sh", "-c", "exec node dist/src/index.js ${MCP_TRANSPORT_MODE:---http}"]
