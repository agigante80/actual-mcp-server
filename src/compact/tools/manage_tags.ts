import { z } from 'zod';
import { CommonSchemas } from '../../lib/schemas/common.js';
import { asFields, issue, needs, strict } from '../refine.js';
import type { CompactActionRow, CompactToolSpec } from '../types.js';

/**
 * manage_tags (#676): the compact front for the three tag writers. Selector `action` is
 * required. Nothing here imports the adapter.
 *
 * Mapping (#670 section 7): create -> actual_tags_create, update -> actual_tags_update,
 * delete -> actual_tags_delete. Every row passes its fields through flat (no wrap, no rename).
 *
 * WRITE tool: `nullAsAbsent` is NOT set. An update with nothing to change is refused here with
 * the legacy refine's own words, so no legacy call is made.
 *
 * Shared keys are ONE light optional schema object each (see manage_payees); the strict
 * formats and required-ness are enforced by the per-row refines.
 */

const id = z.string().optional().describe('Tag id.');
const tag = z.string().optional().describe('Tag word without a leading "#", at least 1 character.');
const color = z.string().optional().describe('Color string, by convention CSS hex such as "#33aa33".');
const description = z.string().optional().describe('Tag description.');

const REAL: Readonly<Record<string, z.ZodType>> = {
  id: CommonSchemas.tagId,
  tag: z.string().min(1, 'tag must not be empty'),
};

type V = Record<string, unknown>;

const createFields = asFields(
  z.object({ tag, color, description }).superRefine((value, ctx) => {
    needs('create', ctx, value as V, ['tag']);
    strict(ctx, value as V, REAL);
  }),
);
const updateFields = asFields(
  z.object({ id, tag, color, description }).superRefine((value, ctx) => {
    needs('update', ctx, value as V, ['id']);
    strict(ctx, value as V, REAL);
    const v = value as V;
    if (v.tag === undefined && v.color === undefined && v.description === undefined) {
      issue(ctx, 'id', 'At least one of tag, color, or description must be provided');
    }
  }),
);
const deleteFields = asFields(
  z.object({ id }).superRefine((value, ctx) => {
    needs('delete', ctx, value as V, ['id']);
    strict(ctx, value as V, REAL);
  }),
);

export const manageTags: CompactToolSpec = {
  name: 'manage_tags',
  domain: 'Changing data',
  summary: 'Create, change or delete tags.',
  examplePrompt: 'Create a tag called vacation with a blue color.',
  description:
    'Create, change or delete tags; pick one `action`. Writes. ' +
    'To read tags or find ids use list_entities with type tag. Other fields are refused. ' +
    'create: tag (the word without "#"); optional color, description. An existing name, even a deleted one, is updated and its id returned. ' +
    'update: id and at least one of tag, color, description; an unknown id is refused. ' +
    'delete: id; DESTRUCTIVE: the tag is soft-deleted and no longer listed; an unknown id is refused. ' +
    'Returns { result: id } (create), { result: { success: true } } (update, delete).',
  selector: 'action',
  actions: new Map<string, CompactActionRow>([
    ['create', { legacy: 'actual_tags_create', fields: createFields }],
    ['update', { legacy: 'actual_tags_update', fields: updateFields }],
    ['delete', { legacy: 'actual_tags_delete', fields: deleteFields }],
  ]),
};
