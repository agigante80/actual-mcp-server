import { ActualMCPConnection } from '../../dist/src/lib/ActualMCPConnection.js';
import adapter from '../../dist/src/lib/actual-adapter.js';

console.log('Running notification forwarding smoke test');

const conn = new ActualMCPConnection();

conn.on('progress', ({ token, payload }) => {
  console.log('Forwarded progress:', token, payload);
  process.exit(0);
});

setTimeout(() => {
  // emit a notification on adapter
  adapter.notifications.emit('progress', 'token-123', { pct: 50, message: 'halfway' });
}, 200);

// fail if no event
setTimeout(() => {
  console.error('No forwarded notification received');
  process.exit(2);
}, 2000);
