import { incrementToolCall, getMetricsText } from '../observability.js';

export default async function runObservabilitySmoke() {
  console.log('Running observability smoke test');
  // Should not throw even if prom-client isn't installed
  await incrementToolCall('test.tool');
  const metrics = await getMetricsText();
  if (metrics !== null && typeof metrics !== 'string') {
    throw new Error('getMetricsText returned unexpected type');
  }
  console.log('✅ Observability smoke test passed');
}

const mainUrl = typeof process !== 'undefined' && process.argv && process.argv[1] ? `file://${process.argv[1]}` : '';
if (import.meta.url === mainUrl) {
  runObservabilitySmoke().catch(err => {
    console.error('Observability smoke test failed:', err);
    process.exit(1);
  });
}
