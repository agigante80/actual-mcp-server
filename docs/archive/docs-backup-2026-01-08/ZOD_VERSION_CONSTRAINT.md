# Zod Version Constraint - CRITICAL

## ⚠️ DO NOT UPGRADE ZOD TO 4.x

**Status**: Active Constraint  
**Date Discovered**: December 16, 2025  
**Severity**: CRITICAL - Breaks all LibreChat tool functionality

## Problem Summary

Zod 4.x has breaking internal changes that make it incompatible with `zod-to-json-schema@3.25.0`, causing complete failure of MCP tool registration in LibreChat.

## Technical Details

### What Changed in Zod 4.x

Zod 4.x changed its internal schema structure:

**Zod 3.x** (working):
```typescript
schema._def = {
  typeName: 'ZodObject',  // ✅ Used by zod-to-json-schema
  // ... other properties
}
```

**Zod 4.x** (broken):
```typescript
schema._def = {
  type: 'object',  // ❌ zod-to-json-schema doesn't recognize this
  // typeName property removed
}
```

### Impact on zod-to-json-schema

The `zod-to-json-schema` library (v3.25.0) uses `_def.typeName` to determine which parser to use. When `typeName` is missing:

1. `parseDef()` returns `undefined`
2. `zodToJsonSchema()` returns only: `{"$schema": "http://json-schema.org/draft-07/schema#"}`
3. Missing: `type`, `properties`, `required`, `description`, etc.

### Impact on LibreChat

LibreChat validates MCP tool schemas using Zod. When it receives incomplete schemas:

```javascript
// Expected schema:
{
  "type": "object",
  "properties": { "id": { "type": "string" } },
  "required": ["id"],
  "$schema": "http://json-schema.org/draft-07/schema#"
}

// Actual with Zod 4.x:
{
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

LibreChat's validation fails:
- Error: `"invalid_literal, expected: object"`
- Path: `["tools", 0, "inputSchema", "type"]`
- Result: **0 tools detected** (instead of 53)

## Solution Implemented

### 1. Pin Zod to 3.25.76 in package.json

```json
{
  "dependencies": {
    "zod": "3.25.76"  // Exact version, no caret
  },
  "overrides": {
    "zod": "3.25.76"  // Force all nested dependencies
  }
}
```

### 2. Dockerfile Post-Install Step

Even with overrides, npm can choose Zod 4.x for the `@modelcontextprotocol/sdk` peer dependency range (`^3.25 || ^4.0`). The Dockerfile forcibly removes and reinstalls Zod 3.x:

```dockerfile
RUN npm ci --production=false
# Force Zod 3.x to work around npm choosing 4.x for MCP SDK peer dependency
RUN rm -rf node_modules/zod && npm install --no-save zod@3.25.76
```

### 3. Testing Commands

Verify Zod version after any dependency update:

```bash
# Check version in container
docker exec <container> cat /app/node_modules/zod/package.json | grep version
# Must show: "version": "3.25.76"

# Test schema conversion
node -e "(async()=>{
  const{z}=await import('zod');
  const{zodToJsonSchema}=await import('zod-to-json-schema');
  const schema=z.object({id:z.string()});
  console.log(JSON.stringify(zodToJsonSchema(schema),null,2));
})()"

# Expected output (✅):
{
  "type": "object",
  "properties": {
    "id": { "type": "string" }
  },
  "required": ["id"],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}

# Broken output with Zod 4.x (❌):
{
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

## What to Do When Dependabot/Renovate Suggests Zod 4.x

### Step 1: Immediately Reject the PR

Do NOT merge any PR that upgrades Zod to 4.x, even if:
- It claims to be compatible
- Other packages are updated
- It's part of a "dependency group update"

### Step 2: Add This Comment to the PR

```markdown
Thank you, but we cannot upgrade to Zod 4.x at this time.

**Reason**: Zod 4.x has breaking internal changes that make it incompatible with `zod-to-json-schema@3.25.0`. This causes all 53 MCP tools to become invisible to LibreChat.

**Technical Issue**: Zod 4.x removed the `_def.typeName` property that zod-to-json-schema relies on, causing it to produce incomplete JSON schemas.

**When can we upgrade?**: When `zod-to-json-schema` releases a version that fully supports Zod 4.x's internal structure changes.

See: `docs/ZOD_VERSION_CONSTRAINT.md` for full details.
```

### Step 3: Update Renovate/Dependabot Configuration

If the bot keeps suggesting Zod 4.x, update configuration:

**.github/renovate.json**:
```json
{
  "packageRules": [
    {
      "matchPackageNames": ["zod"],
      "allowedVersions": ">=3.25.0 <4.0.0",
      "description": "Block Zod 4.x until zod-to-json-schema supports it"
    }
  ]
}
```

**renovate.json** (root):
```json
{
  "packageRules": [
    {
      "matchPackageNames": ["zod"],
      "allowedVersions": "3.x"
    }
  ]
}
```

## Monitoring for Resolution

### Check zod-to-json-schema Releases

Monitor https://github.com/StefanTerdell/zod-to-json-schema for:
- New releases claiming Zod 4.x support
- Issues discussing Zod 4.x compatibility
- Migration guides for Zod 4.x

### Test Before Upgrading

If `zod-to-json-schema` claims Zod 4.x support:

1. Create a test branch
2. Upgrade both packages
3. Run the schema conversion test (see above)
4. Build Docker image
5. Test with LibreChat (must see "Added 53 MCP tools")
6. Only then merge to develop

## Related Files

- `/home/alien/dev/actual-mcp-server/package.json` - Zod version and overrides
- `/home/alien/dev/actual-mcp-server/Dockerfile` - Post-install Zod 3.x enforcement
- `/home/alien/dev/actual-mcp-server/src/lib/ActualMCPConnection.ts` - Uses zodToJsonSchema
- `/home/alien/dev/actual-mcp-server/src/index.ts` - Tool schema extraction
- `.github/copilot-instructions.md` - AI agent warnings about Zod

## History

- **2025-12-16**: Issue discovered after npm upgraded to Zod 4.1.13
- **2025-12-16**: Implemented triple-layer safeguards (package.json, overrides, Dockerfile)
- **2025-12-16**: Verified fix - LibreChat detecting all 53 tools with Zod 3.25.76

## Future Resolution Path

This constraint can be removed when ONE of these occurs:

1. **zod-to-json-schema** releases a version fully supporting Zod 4.x internal structure
2. **MCP SDK** switches to a different JSON Schema library
3. **We migrate** from zod-to-json-schema to an alternative that supports Zod 4.x

Until then, **Zod MUST remain at 3.x**.

---

**Last Updated**: December 16, 2025  
**Status**: ACTIVE CONSTRAINT - DO NOT REMOVE
