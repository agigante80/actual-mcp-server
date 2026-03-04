/**
 * Node.js polyfills for browser globals required by @actual-app/api.
 *
 * @actual-app/api v26.3.0 introduced `navigator.platform` usage at the module
 * top level (inside the Electron/browser bundle) which crashes on Node.js with
 * `ReferenceError: navigator is not defined`.
 *
 * This file must be imported BEFORE any `@actual-app/api` import so that the
 * global is defined when the bundle is first evaluated.
 */

if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      platform: process.platform === 'win32' ? 'Win32' : 'Linux',
    },
    writable: true,
    configurable: true,
  });
}
