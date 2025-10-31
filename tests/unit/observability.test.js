console.log('Running observability tests');

(async () => {
  const observability = await import('../../dist/src/observability.js');
  try {
    const txt = await observability.getMetricsText();
    if (txt !== null && typeof txt !== 'string') {
      console.error('observability.getMetricsText returned unexpected type', typeof txt);
      process.exit(2);
    }
    console.log('observability test passed (metrics text:', txt ? 'present' : 'null', ')');
  } catch (e) {
    console.error('observability test failed', e);
    process.exit(1);
  }
})();
