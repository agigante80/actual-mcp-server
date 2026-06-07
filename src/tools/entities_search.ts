import Fuse from 'fuse.js';
import { z } from 'zod';
import { createTool } from '../lib/toolFactory.js';
import adapter from '../lib/actual-adapter.js';

/**
 * actual_entities_search (#204)
 *
 * Find payees, categories, or accounts by a NAME pattern, so an AI can resolve a
 * partial or mistyped name (the common "payee not found" failure) without knowing
 * the exact string. Read-only.
 *
 * matchType: contains (default) | startsWith | endsWith | exact are case-insensitive
 * native string ops; fuzzy is typo-tolerant via Fuse.js (a maintained, zero-dependency
 * library, chosen over a hand-rolled Levenshtein). Regex is intentionally out of scope
 * (separate Phase 2 ticket: ReDoS attack surface).
 *
 * On no match the tool returns `{ matches: [], count: 0 }` (never an error): an empty
 * result is a valid "found nothing" signal that lets the AI retry with a broader
 * matchType (e.g. switch `contains` to `fuzzy`).
 */
const ENTITY_TYPES = ['accounts', 'categories', 'payees'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];
type Entity = { id: string; name?: string | null };

const FETCH: Record<EntityType, () => Promise<unknown[]>> = {
  accounts: () => adapter.getAccounts(),
  categories: () => adapter.getCategories(),
  payees: () => adapter.getPayees(),
};

const schema = z.object({
  type: z.enum(ENTITY_TYPES).describe('Entity type to search: accounts, categories, or payees.'),
  query: z
    .union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)])
    .describe('Name pattern to match. A single string, or an array of strings (matches if ANY pattern matches).'),
  matchType: z
    .enum(['contains', 'startsWith', 'endsWith', 'exact', 'fuzzy'])
    .default('contains')
    .describe('contains (default), startsWith, endsWith, exact (all case-insensitive), or fuzzy (typo-tolerant). Regex is not supported.'),
  limit: z.number().int().min(1).max(100).default(10).describe('Maximum number of matches to return (1 to 100, default 10).'),
});

type Match = { id: string; name: string; score?: number };

export default createTool({
  name: 'actual_entities_search',
  description:
    'Find accounts, categories, or payees by a name pattern. Use this to resolve a partial or mistyped name to its entity (the fix for "payee not found"). ' +
    'matchType: contains (default), startsWith, endsWith, exact (all case-insensitive), or fuzzy (typo-tolerant, e.g. "amzon" matches "Amazon.com"). ' +
    'query may be a single string or an array (matches if ANY matches). Read-only. ' +
    'On no match it returns { matches: [], count: 0 } (not an error): retry with a broader matchType such as fuzzy.',
  schema,
  examples: [
    { description: 'Find the payee for a partial name', input: { type: 'payees', query: 'amazon', matchType: 'contains', limit: 10 } },
    { description: 'Typo-tolerant payee lookup', input: { type: 'payees', query: 'amzon', matchType: 'fuzzy', limit: 10 } },
    { description: 'Categories starting with "Gro"', input: { type: 'categories', query: 'gro', matchType: 'startsWith', limit: 10 } },
  ],
  handler: async (input) => {
    const { type, matchType, limit } = input;
    const patterns = (Array.isArray(input.query) ? input.query : [input.query]).map((p) => p.trim());

    const raw = (await FETCH[type as EntityType]()) as Entity[];
    // Only entities with a usable string name can be matched (some payees have null names).
    const entities = raw.filter((e): e is Entity & { name: string } => typeof e?.name === 'string' && e.name.length > 0);

    let matches: Match[];

    if (matchType === 'fuzzy') {
      const fuse = new Fuse(entities, {
        keys: ['name'],
        includeScore: true,
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 1,
      });
      // Multi-pattern OR: search each pattern, keep the best (lowest) score per entity.
      const bestById = new Map<string, Match>();
      for (const pattern of patterns) {
        for (const r of fuse.search(pattern)) {
          const score = typeof r.score === 'number' ? r.score : 1;
          const prev = bestById.get(r.item.id);
          if (!prev || score < (prev.score ?? 1)) {
            bestById.set(r.item.id, { id: r.item.id, name: r.item.name, score: Math.round(score * 1000) / 1000 });
          }
        }
      }
      matches = [...bestById.values()].sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
    } else {
      const needles = patterns.map((p) => p.toLowerCase());
      const test = (name: string): boolean => {
        const n = name.toLowerCase();
        return needles.some((q) => {
          switch (matchType) {
            case 'startsWith': return n.startsWith(q);
            case 'endsWith': return n.endsWith(q);
            case 'exact': return n === q;
            case 'contains':
            default: return n.includes(q);
          }
        });
      };
      matches = entities
        .filter((e) => test(e.name))
        .map((e) => ({ id: e.id, name: e.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const limited = matches.slice(0, limit);
    return { matches: limited, count: limited.length, type, matchType };
  },
});
