import fs from 'fs';
import path from 'path';

const toolsDir = path.resolve('dist/src/tools');

function verifyToolFile(file) {
  return import(path.join(toolsDir, file)).then(mod => {
    const tool = mod.default;
    if (!tool) throw new Error(`${file}: missing default export`);
    if (!tool.name) throw new Error(`${file}: missing name`);
    if (!tool.inputSchema) throw new Error(`${file}: missing inputSchema`);
    if (typeof tool.call !== 'function') throw new Error(`${file}: missing call function`);
    console.log(`${file}: OK (${tool.name})`);
    return true;
  });
}

// #671: every compact tool must have a unique name and every action must name a legacy tool
// that exists. Legacy tools are the default exports of the files verified above.
async function verifyCompactRegistry(legacyNames) {
  const { COMPACT_TOOLS } = await import(path.resolve('dist/src/compact/registry.js'));
  const seen = new Set();
  for (const spec of COMPACT_TOOLS) {
    if (seen.has(spec.name) || legacyNames.has(spec.name)) throw new Error(`compact tool name is not unique: ${spec.name}`);
    seen.add(spec.name);
    for (const [action, row] of spec.actions) {
      for (const legacy of [row.legacy, ...(row.routes ?? []).map((r) => r.legacy)]) {
        if (!legacyNames.has(legacy)) throw new Error(`compact ${spec.name}.${action}: unregistered legacy tool ${legacy}`);
      }
    }
    console.log(`compact ${spec.name}: OK (${spec.actions.size} actions)`);
  }
  console.log(`${COMPACT_TOOLS.length} compact tools verified`);
}

async function main() {
  const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.js') && f !== 'index.js');
  const legacyNames = new Set();
  for (const f of files) {
    await verifyToolFile(f);
    legacyNames.add((await import(path.join(toolsDir, f))).default.name);
  }
  await verifyCompactRegistry(legacyNames);
  console.log('All tools verified');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
