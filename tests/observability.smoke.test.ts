import { incrementToolCall, getMetricsText } from '../src/observability.js';

async function run() {
  console.log('Running observability smoke test');
  // Should not throw even if prom-client isn't installed
  await incrementToolCall('test.tool');
  const metrics = await getMetricsText();
  if (metrics !== null && typeof metrics !== 'string') {
    throw new Error('getMetricsText returned unexpected type');
  }
  console.log('✅ Observability smoke test passed');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Observability smoke test failed:', err);
    process.exit(1);
  });
}

export default run;
