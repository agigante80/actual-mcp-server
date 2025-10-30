# Deployment

This project includes a minimal Docker workflow and example `docker-compose.prod.yml` for production-like runs.

Secrets
- Put the ACTUAL_PASSWORD or other secrets into files referenced by `docker-compose.prod.yml` under `secrets/` and mount them as Docker secrets.

Build & run (example)

```bash
docker build -t actual-mcp-server:latest .
docker run -e ACTUAL_SERVER_URL="https://actual.example" -e ACTUAL_PASSWORD_FILE=/run/secrets/actual_password -p 3000:3000 actual-mcp-server:latest
```

Use `docker-compose -f docker-compose.prod.yml up -d` to run the example compose.

Health & metrics
- The service exposes `/health` which reports connection and initialization state. It also exposes `/metrics` when `prom-client` is available; the endpoint returns 204 if `prom-client` is not installed or no metrics are registered.

Local secrets (development)
- You can emulate Docker secrets locally by creating files and pointing environment variables to them. Example:

```bash
# create secret file
echo "$ACTUAL_PASSWORD" > /tmp/actual_password

# start service reading the secret file
ACTUAL_PASSWORD_FILE=/tmp/actual_password ACTUAL_SERVER_URL="https://actual.example" npm run start
```

Notes and status
- The repository contains a sample `Dockerfile` and `docker-compose.prod.yml` but production hardening (non-root user, k8s manifests, secret management) remains to be completed.
- The `/health` and `/metrics` endpoints were wired into the HTTP server; `/metrics` is optional at runtime to allow lighter-weight deployments without Prometheus client.

Acceptance checklist for production readiness
- Container starts and responds to `/health` (200).
- `/metrics` returns content when `prom-client` is available.
- Secrets are read from files and not from env when `*_FILE` vars are present.
- App runs as non-root in container (future PR).
