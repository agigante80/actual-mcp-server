---
applyTo: "tests/unit/*.{js,ts}"
---

## Rules for unit test files (`tests/unit/`)

### `generated_tools.smoke.test.js`
- Update `EXPECTED_TOOL_COUNT` at the top whenever a tool is added or removed
- Add a special-case input block if the new tool needs non-trivial required fields
- The adapter is stubbed — do NOT make live network calls

### `schema_validation.test.js`
- Add one `it()` block per Zod-layer error scenario (wrong date, missing field, bad enum, etc.)
- Assert BOTH that an error is thrown AND that its message is actionable:
  ```javascript
  const err = assert.throws(() => InputSchema.parse({...}));
  assert.match(err.message, /YYYY-MM-DD/); // not just assert.throws(...)
  ```
- See the 10-scenario table in `docs/feature/IMPROVED_ERROR_MESSAGES.md` for guidance on which scenarios to cover

### General
- Run all unit tests with: `npm run test:unit-js`
- Tests must pass with zero live server connections
