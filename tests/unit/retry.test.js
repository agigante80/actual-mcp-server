console.log('Running retry helper tests');

(async () => {
  const { retry } = await import('../../dist/src/lib/retry.js');

  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 3) throw new Error('fail');
    return 'ok';
  };

  try {
    const res = await retry(fn, { retries: 3, backoffMs: 10 });
    if (res !== 'ok') {
      console.error('Unexpected result', res);
      process.exit(2);
    }
    console.log('retry helper test passed');
  } catch (e) {
    console.error('retry helper test failed', e);
    process.exit(1);
  }
})();
