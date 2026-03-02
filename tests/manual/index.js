// Entry point — kept intentionally thin.
import { run } from './runner.js';

run().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
