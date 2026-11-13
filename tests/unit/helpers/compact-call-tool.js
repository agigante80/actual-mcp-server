// tests/unit/helpers/compact-call-tool.js
//
// #680: drive the live suite's support code (tests/manual/residue.js, cleanup.js, runner.js)
// through the REAL compact dispatcher with the legacy layer stubbed.
//
// `viaCompact(legacyStub)` returns a `callTool(name, args)` shaped like the live clients':
//   - `name` must be one of the 15 compact tools, otherwise it throws the same "is not
//     available" refusal a compact server gives for a legacy `actual_*` name;
//   - `args` go through the compact tool's own strict validation, so a wrong or missing
//     argument (an `entity` the delete needs, a typo'd key) throws here, as it would live;
//   - the call is then shaped exactly as the server shapes it and handed to
//     `legacyStub(legacyName, legacyArgs)`, which stands for the adapter-backed legacy tool and
//     returns the legacy value. The compact layer returns that value unchanged, and so does this.
//
// Requires `npm run build` (it imports dist/).

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

const { COMPACT_TOOLS } = await import('../../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases } = await import('../../../dist/src/compact/dispatch.js');

const phrases = legacyPhrases(COMPACT_TOOLS);

/** @param {(legacyName: string, legacyArgs: any) => any} legacyStub */
export function viaCompact(legacyStub) {
  const ops = { callOperation: async (legacyName, args) => legacyStub(legacyName, args) };
  const tools = new Map(COMPACT_TOOLS.map((spec) => [spec.name, buildCompactTool(spec, ops, phrases)]));
  return async function callTool(name, args = {}) {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not available: this server publishes the compact tool surface (MCP_TOOL_SURFACE).`);
    }
    return tool.call(args);
  };
}
