#!/usr/bin/env node
// #610: MCP Registry metadata. server.json is committed with 0.0.0 in its three
// version slots; CI stamps a copy with the package version, validates it with
// mcp-publisher on every push, and publishes it on a release tag.
//
//   node scripts/mcp-server-json.mjs stamp --out <path> [--expect-version <v>]
//
// --expect-version (the tag without its v) first checks that the tag, VERSION and
// package.json agree, so a disagreement fails before mcp-publisher logs in.
// Only node: built-ins, so the publish job needs no npm ci.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OCI_REPOSITORY = 'docker.io/agigante80/actual-mcp-server';

/** The variables each package may declare, exactly (a test asserts set equality). */
export const ENV_ALLOWLIST = {
  npm: ['ACTUAL_SERVER_URL', 'ACTUAL_PASSWORD', 'ACTUAL_BUDGET_SYNC_ID', 'ACTUAL_BUDGET_PASSWORD', 'MCP_BRIDGE_DATA_DIR'],
  oci: ['ACTUAL_SERVER_URL', 'ACTUAL_PASSWORD', 'ACTUAL_BUDGET_SYNC_ID', 'ACTUAL_BUDGET_PASSWORD', 'MCP_SSE_AUTHORIZATION'],
};

const SECRET_NAME = /PASSWORD|AUTHORIZATION|TOKEN/;
const LABEL_KEY = 'io.modelcontextprotocol.server.name';

function ociPackages(serverJson) {
  return (serverJson.packages ?? []).filter((p) => p.registryType === 'oci');
}

/** A deep copy with the top-level, npm and OCI tag versions set to `version`. */
export function stampServerJson(serverJson, version) {
  const out = structuredClone(serverJson);
  const oci = ociPackages(out);
  if (oci.length !== 1) {
    throw new Error(`server.json: expected exactly one oci package, found ${oci.length}`);
  }
  const id = oci[0].identifier ?? '';
  const colon = id.lastIndexOf(':');
  if (colon < 0 || colon < id.lastIndexOf('/')) {
    throw new Error('server.json: cannot stamp OCI package identifier: missing tag');
  }
  oci[0].identifier = `${id.slice(0, colon)}:${version}`;
  out.version = version;
  for (const p of out.packages) {
    if (p.registryType === 'npm') p.version = version;
  }
  return out;
}

export function assertVersionsAgree({ expected, versionFile, pkgVersion }) {
  if (expected !== versionFile || expected !== pkgVersion) {
    throw new Error(`tag, VERSION and package.json disagree: ${expected} / ${versionFile} / ${pkgVersion}`);
  }
}

/** The text after the last FROM line: the stage that becomes the published image. */
function finalStage(dockerfileText) {
  const lines = dockerfileText.split('\n');
  let last = -1;
  lines.forEach((l, i) => {
    if (/^\s*FROM\s/i.test(l)) last = i;
  });
  return last < 0 ? '' : lines.slice(last + 1).join('\n');
}

/**
 * Every problem with the registry metadata, as messages; empty when it is valid.
 * `canonical` is canonicalConfigVars(...) from src/lib/config-registry.ts, so
 * server.json cannot declare a variable the config layer does not know.
 */
export function checkRegistryMetadata({ serverJson, pkg, dockerfileText, canonical }) {
  const problems = [];
  const name = serverJson.name;

  if (typeof serverJson.description !== 'string' || serverJson.description.length > 100) {
    problems.push('description exceeds 100 characters');
  }
  if (pkg.mcpName !== name) problems.push('mcpName must equal server.json name');

  const label = new RegExp(`^\\s*LABEL\\s+${LABEL_KEY.replace(/\./g, '\\.')}="([^"]*)"\\s*$`, 'm');
  const m = label.exec(finalStage(dockerfileText));
  if (!m || m[1] !== name) problems.push('label missing from final stage');

  for (const type of ['npm', 'oci']) {
    const found = (serverJson.packages ?? []).filter((p) => p.registryType === type);
    if (found.length !== 1) {
      problems.push(`server.json must declare exactly one ${type} package`);
      continue;
    }
    const vars = found[0].environmentVariables ?? [];
    const allowed = ENV_ALLOWLIST[type];
    for (const v of vars) {
      if (!allowed.includes(v.name) || !canonical.has(v.name)) {
        problems.push(`server.json declares a forbidden or unknown variable: ${v.name}`);
      } else if (SECRET_NAME.test(v.name) && v.isSecret !== true) {
        problems.push(`${v.name} must be isSecret`);
      }
    }
    const names = new Set(vars.map((v) => v.name));
    for (const want of allowed) {
      if (!names.has(want)) problems.push(`${type} package must declare ${want}`);
    }
  }

  const oci = ociPackages(serverJson)[0];
  if (oci) {
    if (!oci.identifier?.startsWith(`${OCI_REPOSITORY}:`)) {
      problems.push(`OCI identifier must be ${OCI_REPOSITORY}:<tag>`);
    }
    const auth = (oci.transport?.headers ?? []).find((h) => h.name === 'Authorization');
    if (!auth || auth.value !== 'Bearer {token}' || auth.isRequired !== true || auth.isSecret !== true) {
      problems.push('OCI transport must declare an Authorization header');
    } else {
      // A client fills {token} only from the header's own variables map; without
      // it the literal "Bearer {token}" is sent and every request gets a 401.
      const token = auth.variables?.token;
      if (!token || token.isRequired !== true || token.isSecret !== true) {
        problems.push('Authorization header must declare a required secret token variable');
      }
    }
    const port = (oci.runtimeArguments ?? []).filter((a) => a.name === '-p');
    if (port.length !== 1 || port[0].value !== '127.0.0.1:3600:3600') {
      problems.push('OCI port must bind 127.0.0.1');
    }
  }
  return problems;
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error(`bad argument: ${rest[i]}`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  return { cmd, opts };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (cmd !== 'stamp' || !opts.out) {
    throw new Error('usage: mcp-server-json.mjs stamp --out <path> [--expect-version <v>]');
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (opts['expect-version'] !== undefined) {
    assertVersionsAgree({
      expected: opts['expect-version'],
      versionFile: readFileSync(join(root, 'VERSION'), 'utf8').trim(),
      pkgVersion: pkg.version,
    });
  }
  const serverJson = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'));
  writeFileSync(opts.out, `${JSON.stringify(stampServerJson(serverJson, pkg.version), null, 2)}\n`);
  process.stdout.write(`stamped server.json ${pkg.version} -> ${opts.out}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`mcp-server-json: ${err.message}\n`);
    process.exit(1);
  }
}
