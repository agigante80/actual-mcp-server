# Tags CRUD Tools

**Status:** Blocked — waiting for stable `@actual-app/api` release  
**Priority:** 🟡 Low (additive, no breaking changes)  
**Effort:** ~1 day once API is stable  
**Blocker:** Tags methods (`getTags`, `createTag`, `updateTag`, `deleteTag`) are now **documented** in the [official API reference](https://actualbudget.org/docs/api/reference/#tags) but are **NOT exported** by `@actual-app/api@26.2.1` (current stable). They will be available in the next stable npm release.

---

## Overview

Four tools for managing transaction tags in Actual Budget. Blocked until the Tags API ships in a stable release of `@actual-app/api`.

## Tools

| Tool | Method | Description |
|------|--------|-------------|
| `actual_tags_get` | `getTags()` | List all tags |
| `actual_tags_create` | `createTag(tag)` | Create a new tag |
| `actual_tags_update` | `updateTag(id, fields)` | Update a tag |
| `actual_tags_delete` | `deleteTag(id)` | Delete a tag |

## Tag Object Shape

```typescript
{
  id: string;           // UUID (auto-generated)
  tag: string;          // The tag text (required)
  color?: string;       // Hex color string e.g. '#ff0000'
  description?: string; // Free-text description
}
```

## Action Plan

1. Monitor [`@actual-app/api` releases](https://github.com/actualbudget/actual/releases) for stable Tags support
2. Bump `@actual-app/api` version in `package.json`
3. Add adapter methods to `src/lib/actual-adapter.ts`
4. Create 4 tool files in `src/tools/`
5. Register in `actualToolsManager.ts`
6. Follow [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)

## Actual Budget API Methods

All methods are documented on the [Actual Budget API Reference](https://actualbudget.org/docs/api/reference) page.

| Method | Description | In stable? | API Ref |
|--------|-------------|------------|--------|
| `getTags()` | Returns all tags | ❌ not in `26.2.1` | [→](https://actualbudget.org/docs/api/reference#gettags) |
| `createTag(tag)` | Creates a tag, returns new UUID | ❌ not in `26.2.1` | [→](https://actualbudget.org/docs/api/reference#createtag) |
| `updateTag(id, fields)` | Updates a tag's fields | ❌ not in `26.2.1` | [→](https://actualbudget.org/docs/api/reference#updatetag) |
| `deleteTag(id)` | Deletes a tag by UUID | ❌ not in `26.2.1` | [→](https://actualbudget.org/docs/api/reference#deletetag) |

> ℹ️ These methods are now **documented** in the official API reference, meaning they will be included in the next stable npm release. Check [`@actual-app/api` releases](https://github.com/actualbudget/actual/releases) before implementing.

## References

- [Actual Budget API Reference](https://actualbudget.org/docs/api/reference)
- [`@actual-app/api` releases](https://github.com/actualbudget/actual/releases)
- [`src/lib/actual-adapter.ts`](../../src/lib/actual-adapter.ts)
- [`src/actualToolsManager.ts`](../../src/actualToolsManager.ts)
- [`docs/NEW_TOOL_CHECKLIST.md`](../NEW_TOOL_CHECKLIST.md)
