// Minimal runner for adapter normalization tests. Uses Node's assert and requires compiled dist file.
const assert = require('assert');
(async function(){
  try {
    await import('../dist/tests/unit/adapter_normalization.test.js');
    console.log('Adapter normalization tests module loaded. If assertions in file passed, success.');
    process.exit(0);
  } catch (err) {
    console.error('Adapter tests failed during import:', err);
    process.exit(2);
  }
})();
