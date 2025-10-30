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

async function main() {
  const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.js') && f !== 'index.js');
  for (const f of files) {
    await verifyToolFile(f);
  }
  console.log('All tools verified');
}

main().catch(e => { console.error(e); process.exit(1); });
