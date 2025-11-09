// Integration test: probe MCP bridge as LibreChat would
import { startMockActualServer } from './mock-actual-server.js';

async function run() {
  const mockServer = startMockActualServer(4000);
  // Wait for server to start
  await new Promise(r => setTimeout(r, 500));

  // Probe MCP bridge /health endpoint
  const health = await fetch('http://localhost:3000/health').then(r => r.json());
  console.log('Health:', health);

  // Probe MCP bridge /tools endpoint (example)
  // const tools = await fetch('http://localhost:3000/tools').then(r => r.json());
  // console.log('Tools:', tools);

  mockServer.close();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
