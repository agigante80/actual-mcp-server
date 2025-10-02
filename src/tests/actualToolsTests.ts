// src/tests/actualToolsTests.ts
import logger from '../logger.js';
import actualToolsManager from '../actualToolsManager.js';

export async function testAllTools() {
  await actualToolsManager.initialize();

  const toolNames = actualToolsManager.getToolNames();

  for (const name of toolNames) {
    try {
      logger.info(`⚙️  Testing tool: ${name}`);
      const result = await actualToolsManager.callTool(name, {}); // pass empty args; customize if needed
      logger.info(`✅ Tool ${name} output: ${JSON.stringify(result, null, 2)}`);
    } catch (err: any) {
      logger.error(`❌ Tool ${name} test failed: ${err.message || err}`);
      throw err; // stop on first failure
    }
  }
}