/**
 * Node.js polyfills for browser globals required by @actual-app/api.
 *
 * @actual-app/api v26.3.0 introduced `navigator.platform` usage at the module
 * top level (inside the Electron/browser bundle) which crashes on Node.js with
 * `ReferenceError: navigator is not defined`. v26.6.0 additionally reads
 * `navigator.userAgent` at the top level (`navigator.userAgent.includes(...)`
 * plus a UAParser call), so the polyfill must define `userAgent` too or the
 * bundle throws `Cannot read properties of undefined (reading 'includes')`.
 *
 * Node 21+ ships a native `navigator` that already carries both fields, so this
 * polyfill only fires on Node 20 (still inside the documented "Node.js 20+"
 * support range, and the version several CI workflows run on).
 *
 * This file must be imported BEFORE any `@actual-app/api` import so that the
 * global is defined when the bundle is first evaluated.
 */

if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      platform: process.platform === 'win32' ? 'Win32' : 'Linux',
      userAgent: `Node.js/${process.version}`,
    },
    writable: true,
    configurable: true,
  });
}
