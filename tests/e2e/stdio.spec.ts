import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..', '..');
const ENTRY = path.join(ROOT, 'dist', 'src', 'index.js');
const node = process.execPath;

const baseEnv = {
  ...process.env,
  ACTUAL_SERVER_URL: 'http://localhost:5007',
  ACTUAL_PASSWORD: 'test',
  ACTUAL_BUDGET_SYNC_ID: 'test-sync-id',
  ACTUAL_DATA_DIR: path.join(ROOT, 'test-actual-data'),
  LOG_LEVEL: 'error',
};

test.describe('stdio transport', () => {
  test('--http and --stdio together exit with code 1 and mutual-exclusion message', async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(node, [ENTRY, '--http', '--stdio'], { env: baseEnv });
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('exit', (code) => {
        try {
          expect(code).toBe(1);
          expect(stderr).toContain('mutually exclusive');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      setTimeout(() => {
        proc.kill();
        reject(new Error('Process did not exit within 5 s'));
      }, 5000);
    });
  });

  test('--stdio starts without crashing within 3 s', async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(node, [ENTRY, '--stdio'], {
        env: { ...baseEnv, MCP_STDIO_MODE: 'true' },
      });
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('exit', (code) => {
        // Should NOT exit on its own within 3 s — if it does it crashed
        reject(new Error(`Process exited early with code ${code}. stderr: ${stderr}`));
      });
      setTimeout(() => {
        proc.kill('SIGTERM');
        resolve();
      }, 3000);
    });
  });

  test('--stdio process exits cleanly within 2 s when stdin closes', async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(node, [ENTRY, '--stdio'], {
        env: { ...baseEnv, MCP_STDIO_MODE: 'true' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      // Give the server 1 s to start, then close stdin
      setTimeout(() => {
        proc.stdin!.end();
      }, 1000);

      const deadline = setTimeout(() => {
        proc.kill();
        reject(new Error(`Process did not exit within 2 s after stdin close. stderr: ${stderr}`));
      }, 3000); // 1 s start + 2 s grace

      proc.on('exit', (code) => {
        clearTimeout(deadline);
        // Exit code 0 expected (clean shutdown from stdin 'end' handler)
        try {
          expect(code).toBe(0);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
