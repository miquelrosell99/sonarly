// Domain types re-derived from the generated OpenAPI schema (audit F17, plan
// 10d): the generated shape is the single source of truth for the wire, so
// hand-maintained duplicates were deleted. Where a screen needs a narrower
// row type (SongListItem) or a client-only projection (SongWithNames), those
// live at the component / lib layer — not here.
import type { components } from '../contract/schema.js';

export type Song = components['schemas']['Song'];
export type SyncedLyricLine = components['schemas']['SyncedLyricLine'];
export type SongTags = components['schemas']['SongTags'];
