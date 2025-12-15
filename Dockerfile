FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
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
COPY --from=build /app/scripts/openapi ./scripts/openapi
COPY --from=build /app/generated ./generated
COPY --from=build /app/src/lib ./src/lib

# Run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
# Use exec form with sh to allow environment variable expansion and proper signal handling
CMD ["sh", "-c", "node dist/src/index.js ${MCP_TRANSPORT_MODE:---http}"]
