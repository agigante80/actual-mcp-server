// Pure response-normalisation helpers for the Actual adapter (#166 split out of
// actual-adapter.ts). No module state, no side effects: they only coerce the
// varied raw shapes the @actual-app/api returns (id string, id array, object,
// array of objects) into the canonical shapes the tools expect. Re-exported
// from actual-adapter.ts so the public surface and all importers are unchanged.

import type { components } from '../../../generated/actual-client/types.js';

export function normalizeToTransactionArray(raw: unknown): components['schemas']['Transaction'][] {
  if (!raw) return [];
  // If already an array of transactions
  if (Array.isArray(raw) && (raw as unknown[]).every(r => typeof r === 'object')) return raw as components['schemas']['Transaction'][];
  // If a single transaction object, wrap it
  if (typeof raw === 'object' && raw !== null && 'id' in (raw as Record<string, unknown>)) return [raw as components['schemas']['Transaction']];
  // If array of ids returned, convert to minimal Transaction objects
  if (Array.isArray(raw) && (raw as unknown[]).every(r => typeof r === 'string')) {
    return (raw as string[]).map(id => ({ id } as components['schemas']['Transaction']));
  }
  // Fallback: try to coerce
  return Array.isArray(raw) ? (raw as components['schemas']['Transaction'][]) : [];
}

export function normalizeToId(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'id' in (raw as Record<string, unknown>)) {
    const idVal = (raw as Record<string, unknown>)['id'];
    if (typeof idVal === 'string') return idVal;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') return raw[0] as string;
  return String(raw ?? '');
}

export function normalizeImportResult(raw: unknown): { added?: string[]; updated?: string[]; errors?: string[] } {
  if (!raw || typeof raw !== 'object') return { added: [], updated: [], errors: [] };
  const r = raw as Record<string, unknown>;
  return {
    added: Array.isArray(r.added) ? (r.added as string[]) : [],
    updated: Array.isArray(r.updated) ? (r.updated as string[]) : [],
    errors: Array.isArray(r.errors) ? (r.errors as string[]) : [],
  };
}
