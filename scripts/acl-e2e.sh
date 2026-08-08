#!/usr/bin/env bash
# acl-e2e.sh
#
# #338: end-to-end proof that the dynamic budget ACL actually isolates users.
#
# WHY A SCRIPT AND NOT PURE COMPOSE. There is an ordering dependency compose
# cannot express: Actual generates user UUIDs at creation time, and the IdP must
# mint tokens whose `sub` equals those UUIDs. So the IdP cannot be configured
# until after the users exist.
#
# WHY PASSWORD FIRST, THEN OPENID. Load bearing, and verified rather than
# assumed: @actual-app/api authenticates with a password. An Actual server
# bootstrapped with OpenID only rejects password login outright ("Invalid
# redirect URL"), and a password cannot be retrofitted ("already-bootstrapped"),
# so this MCP server cannot connect to such a server at all. A named volume
# carries the password bootstrap across the container restart that enables
# OpenID. This is the supported production topology, not a test convenience.
#
# Usage: bash scripts/acl-e2e.sh [--keep]
set -euo pipefail

KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NET=acl-e2e-net
VOL=acl-e2e-data
ACTUAL=acl-e2e-actual
IDP=acl-e2e-idp
ACTUAL_PORT=5098
IDP_PORT=8897
PASSWORD=acl-e2e-pass
AUDIENCE=actual-mcp-acl-e2e
OUT="$ROOT/.release/acl-e2e-fixture.json"

info() { echo ""; echo "==> $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

teardown() {
  if [ "$KEEP" = "1" ]; then echo ""; echo "kept: $ACTUAL $IDP (network $NET, volume $VOL)"; return; fi
  purge
}

# Unconditional cleanup. Kept separate from teardown() so the START of a run can
# always clear a previous --keep run's leftovers, which teardown() deliberately
# does not. Removing the network needs its containers gone first, hence the
# ordering and the settle.
purge() {
  docker rm -f "$ACTUAL" "$IDP" >/dev/null 2>&1 || true
  sleep 1
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
}
trap teardown EXIT

wait_http() { # wait_http <url> <label>
  for _ in $(seq 1 45); do curl -sf "$1" >/dev/null 2>&1 && return 0; sleep 2; done
  die "timed out waiting for $2 ($1)"
}

actual_api() { # actual_api <method> <path> [json]
  if [ -n "${3:-}" ]; then
    curl -sS -X "$1" "http://localhost:$ACTUAL_PORT$2" -H "x-actual-token: $TOKEN" -H 'Content-Type: application/json' -d "$3"
  else
    curl -sS -X "$1" "http://localhost:$ACTUAL_PORT$2" -H "x-actual-token: $TOKEN"
  fi
}

jqp() { python3 -c "import sys,json; $1" ; }  # tiny json helper, no jq dependency

purge
docker network create "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

# ---------------------------------------------------------------------------
info "1/6 Actual up in PASSWORD mode, and bootstrap it"
# ---------------------------------------------------------------------------
docker run -d --name "$ACTUAL" --network "$NET" -p "$ACTUAL_PORT:5006" \
  -v "$VOL:/data" -e NODE_ENV=production actualbudget/actual-server:latest >/dev/null
wait_http "http://localhost:$ACTUAL_PORT/account/needs-bootstrap" "Actual (password mode)"

TOKEN=$(curl -sS -X POST "http://localhost:$ACTUAL_PORT/account/bootstrap" \
  -H 'Content-Type: application/json' -d "{\"password\":\"$PASSWORD\"}" \
  | jqp "print(json.load(sys.stdin)['data']['token'])")
[ -n "$TOKEN" ] || die "bootstrap did not return a token"
echo "    bootstrapped; owner token acquired"

# ---------------------------------------------------------------------------
info "2/6 Start the IdP FIRST, then restart Actual with OpenID"
# ---------------------------------------------------------------------------
# Ordering that cost a debugging round: Actual reads the discovery document at
# STARTUP. If the IdP is not reachable then, it silently falls back to
# password-only and never enters multi-user mode, with no error in its log.
# So the IdP comes up first with a placeholder config (discovery is all Actual
# needs), and is restarted in step 4 with the real per-user claim mappings once
# the user UUIDs exist. Discovery is identical across both, so Actual is
# undisturbed by that restart.
docker run -d --name "$IDP" --network "$NET" -p "$IDP_PORT:8080" \
  ghcr.io/navikt/mock-oauth2-server:2.1.10 >/dev/null
wait_http "http://localhost:$IDP_PORT/default/.well-known/openid-configuration" "mock IdP (placeholder)"
echo "    IdP up, discovery reachable"

docker rm -f "$ACTUAL" >/dev/null
docker run -d --name "$ACTUAL" --network "$NET" -p "$ACTUAL_PORT:5006" \
  -v "$VOL:/data" -e NODE_ENV=production \
  -e "ACTUAL_OPENID_DISCOVERY_URL=http://$IDP:8080/default/.well-known/openid-configuration" \
  -e ACTUAL_OPENID_CLIENT_ID=actual-acl-e2e \
  -e ACTUAL_OPENID_CLIENT_SECRET=acl-e2e-secret \
  -e "ACTUAL_OPENID_SERVER_HOSTNAME=http://localhost:$ACTUAL_PORT" \
  -e ACTUAL_USER_CREATION_MODE=login \
  actualbudget/actual-server:latest >/dev/null
wait_http "http://localhost:$ACTUAL_PORT/account/needs-bootstrap" "Actual (OpenID mode)"

STATE=$(curl -sS "http://localhost:$ACTUAL_PORT/account/needs-bootstrap")
echo "    $STATE"
echo "$STATE" | grep -q '"multiuser":true' || die "server did not enter multi-user mode"
# The password method must still be listed, otherwise the API cannot connect.
echo "$STATE" | grep -q '"method":"password"' || die "password login disappeared; the API could not authenticate"

# ---------------------------------------------------------------------------
info "3/6 Create users and capture their generated UUIDs"
# ---------------------------------------------------------------------------
for u in alice bob; do
  actual_api POST /admin/users "{\"userName\":\"$u\",\"displayName\":\"${u^}\",\"enabled\":true,\"role\":\"BASIC\"}" >/dev/null
done
USERS=$(actual_api GET /admin/users)
ALICE_ID=$(echo "$USERS" | jqp "print(next(u['id'] for u in json.load(sys.stdin) if u['userName']=='alice'))")
BOB_ID=$(echo "$USERS"   | jqp "print(next(u['id'] for u in json.load(sys.stdin) if u['userName']=='bob'))")
[ -n "$ALICE_ID" ] && [ -n "$BOB_ID" ] || die "could not resolve user ids"
echo "    alice=$ALICE_ID"
echo "    bob=$BOB_ID"

# ---------------------------------------------------------------------------
info "4/6 Restart the IdP so it mints tokens whose sub equals those UUIDs"
# ---------------------------------------------------------------------------
# The claims are injected per scope, because the user names are only known now.
#
# #343: `sub` is deliberately an OPAQUE value that matches NOTHING on the Actual
# side. That is the whole point. The first version of this harness set sub to
# Actual's own userId, which made the join trivially self-consistent and hid a
# defect where the ACL matched sub against userId: a comparison that can never
# succeed in reality, because Actual mints userId itself and no IdP ever issues
# it. Keeping sub opaque forces the join to go through `preferred_username` to
# `userName`, which is the path a real deployment takes.
#
# The extra scopes cover the negative cases: an email-only token (precedence
# fall-through), an unknown user, and a token whose every identity claim is blank
# (which must NEVER match the service account's blank userName).
docker rm -f "$IDP" >/dev/null
IDP_CONFIG=$(cat <<JSON
{ "tokenCallbacks": [ { "issuerId": "default", "tokenExpiry": 3600, "requestMappings": [
  { "requestParam": "scope", "match": "user-alice",     "claims": { "sub": "opaque-idp-sub-alice", "preferred_username": "alice", "email": "alice@example.test", "aud": ["$AUDIENCE"] } },
  { "requestParam": "scope", "match": "user-bob",       "claims": { "sub": "opaque-idp-sub-bob",   "preferred_username": "bob",   "email": "bob@example.test",   "aud": ["$AUDIENCE"] } },
  { "requestParam": "scope", "match": "user-emailonly", "claims": { "sub": "opaque-idp-sub-eo",    "email": "alice@example.test", "aud": ["$AUDIENCE"] } },
  { "requestParam": "scope", "match": "user-ghost",     "claims": { "sub": "opaque-idp-sub-ghost", "preferred_username": "nobody", "aud": ["$AUDIENCE"] } },
  { "requestParam": "scope", "match": "user-blank",     "claims": { "sub": "", "preferred_username": "", "email": "", "aud": ["$AUDIENCE"] } }
] } ] }
JSON
)
docker run -d --name "$IDP" --network "$NET" -p "$IDP_PORT:8080" \
  -e JSON_CONFIG="$IDP_CONFIG" ghcr.io/navikt/mock-oauth2-server:2.1.10 >/dev/null
wait_http "http://localhost:$IDP_PORT/default/.well-known/openid-configuration" "mock IdP"
echo "    IdP serving discovery"

# ---------------------------------------------------------------------------
info "5/6 Import two budgets and grant one to each user"
# ---------------------------------------------------------------------------
ZIP="$ROOT/test-data/2026-01-08-Test Budget.zip"
[ -f "$ZIP" ] || die "missing test budget zip at $ZIP"

IMPORT_JS="$(mktemp "$ROOT/.acl-e2e-import-XXXX.mjs")"
cat > "$IMPORT_JS" <<'JS'
import api from '@actual-app/api';
const [dataDir, url, password, zip] = process.argv.slice(2);
await api.init({ dataDir, serverURL: url, password });
// Import twice: two distinct budget FILES, so per-user isolation is observable.
const a = await api.importBudget(zip, { type: 'actual' });
const b = await api.importBudget(zip, { type: 'actual' });
const files = (await api.getBudgets()).filter(f => f.usersWithAccess);
console.log('FILES=' + JSON.stringify(files.map(f => f.cloudFileId)));
console.log('GROUPS=' + JSON.stringify(files.map(f => f.groupId)));
console.log('IMPORTED=' + JSON.stringify([a.id, b.id]));
await api.shutdown();
JS
DATA_DIR="$(mktemp -d)"
IMPORT_RAW=$(cd "$ROOT" && node "$IMPORT_JS" "$DATA_DIR" "http://localhost:$ACTUAL_PORT" "$PASSWORD" "$ZIP" 2>/dev/null || true)
IMPORT_OUT=$(echo "$IMPORT_RAW" | grep '^FILES=' || true)
GROUP_OUT=$(echo "$IMPORT_RAW" | grep '^GROUPS=' || true)
rm -f "$IMPORT_JS"; rm -rf "$DATA_DIR"
[ -n "$IMPORT_OUT" ] || die "budget import produced no files"
# Same guard as its sibling: without it an absent GROUPS= line makes the jqp call
# raise a Python traceback under `set -e`, or writes "None" into the fixture and
# fails the verify step for an unrelated-looking reason.
[ -n "$GROUP_OUT" ] || die "budget import produced no groupIds (syncIds); cannot build the fixture"
FILE_A=$(echo "${IMPORT_OUT#FILES=}" | jqp "print(json.load(sys.stdin)[0])")
FILE_B=$(echo "${IMPORT_OUT#FILES=}" | jqp "print(json.load(sys.stdin)[1])")
GROUP_A=$(echo "${GROUP_OUT#GROUPS=}" | jqp "print(json.load(sys.stdin)[0])")
GROUP_B=$(echo "${GROUP_OUT#GROUPS=}" | jqp "print(json.load(sys.stdin)[1])")
echo "    fileA=$FILE_A (syncId $GROUP_A)"
echo "    fileB=$FILE_B (syncId $GROUP_B)"

actual_api POST /admin/access "{\"fileId\":\"$FILE_A\",\"userId\":\"$ALICE_ID\"}" >/dev/null
actual_api POST /admin/access "{\"fileId\":\"$FILE_B\",\"userId\":\"$BOB_ID\"}"   >/dev/null
echo "    alice granted fileA, bob granted fileB"

# ---------------------------------------------------------------------------
info "6/6 Emit the fixture for the spec"
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<JSON
{
  "actualUrl": "http://localhost:$ACTUAL_PORT",
  "idpUrl": "http://localhost:$IDP_PORT",
  "audience": "$AUDIENCE",
  "password": "$PASSWORD",
  "users": { "alice": "$ALICE_ID", "bob": "$BOB_ID" },
  "files": { "alice": "$FILE_A", "bob": "$FILE_B" },
  "syncIds": { "alice": "$GROUP_A", "bob": "$GROUP_B" }
}
JSON
echo "    wrote $OUT"

echo ""
info "Running the ACL scenarios (positive AND negative)"
if node "$ROOT/scripts/acl-e2e-verify.mjs" "$OUT"; then
  echo ""
  echo "ACL E2E: all scenarios passed."
else
  die "ACL scenarios FAILED"
fi

echo ""
echo "ACL E2E environment ready."
echo "Verify the ACL source data with:"
echo "  node -e \"import('@actual-app/api').then(async m=>{const a=m.default;await a.init({dataDir:'/tmp/x',serverURL:'http://localhost:$ACTUAL_PORT',password:'$PASSWORD'});console.log(JSON.stringify((await a.getBudgets()).filter(f=>f.usersWithAccess),null,1));await a.shutdown();})\""
[ "$KEEP" = "1" ] || echo "(tearing down; pass --keep to inspect)"
