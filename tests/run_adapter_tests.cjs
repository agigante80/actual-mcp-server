// CJS runner: load ts-node register then require the TS test file
require('ts-node').register({ transpileOnly: true, files: true });
(async () => {
  try {
    await require('./unit/adapter_normalization.test.ts');
    console.log('Adapter normalization tests completed');
    process.exit(0);
  } catch (err) {
    console.error('Adapter tests failed:', err);
    process.exit(2);
  }
})();
