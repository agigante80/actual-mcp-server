import { register } from 'tsconfig-paths';
import path from 'path';

// Register tsconfig paths for module resolution in the compiled 'dist' directory
register({
  baseUrl: path.resolve('./dist'),
  // You can optionally specify 'paths' here or rely on tsconfig.json
  paths: {},
});

// Import and run the compiled main entry point
import('./dist/src/index.js').catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});