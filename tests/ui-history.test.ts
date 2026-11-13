import { describe, expect, it } from 'vitest';
import { newBikeFile } from '../src/bcad/io';
import { defaultDesign } from '../src/model/schema';
import { FIELD_MERGE_MS, HistoryState, MergeInfo, mergeKey, parseLibrary, pushHistory, shouldMerge } from '../src/ui/state';

const none: MergeInfo = { key: null, time: 0 };

describe('undo history merging', () => {
  it('merges consecutive edits of the same field within the window', () => {
    const k = mergeKey({ stack: 1 }, true);
    expect(shouldMerge({ key: k, time: 1000 }, mergeKey({ stack: 2 }, true), 1000 + FIELD_MERGE_MS - 1)).toBe(true);
    expect(shouldMerge({ key: k, time: 1000 }, k, 1000 + FIELD_MERGE_MS + 1)).toBe(false);
  });

  it('does not merge edits of different fields, however close together', () => {
    expect(shouldMerge({ key: mergeKey({ stack: 1 }, true), time: 1000 }, mergeKey({ reach: 1 }, true), 1001)).toBe(false);
  });

  it('merges every step of one drag but not two drags', () => {
    expect(shouldMerge({ key: mergeKey({ stack: 1 }, 'drag-1'), time: 0 }, mergeKey({ stack: 1, reach: 2 }, 'drag-1'), 60_000)).toBe(true);
    expect(shouldMerge({ key: mergeKey({}, 'drag-1'), time: 0 }, mergeKey({}, 'drag-2'), 1)).toBe(false);
  });

  it('never merges non-coalescing edits or after an undo (key reset)', () => {
    expect(shouldMerge({ key: mergeKey({ a: 1 }, true), time: 0 }, mergeKey({ a: 1 }, false), 1)).toBe(false);
    expect(shouldMerge(none, mergeKey({ a: 1 }, true), 1)).toBe(false);
  });

  it('pushHistory is pure and replaces only on merge', () => {
    const a = newBikeFile(defaultDesign());
    const b = { ...a, design: { ...a.design, stack: 1 } };
    const c = { ...a, design: { ...a.design, stack: 2 } };
    const s0: HistoryState = { items: [a], index: 0 };
    const s1 = pushHistory(s0, b, true); // nothing to merge into at index 0
    expect(s1.items).toEqual([a, b]);
    expect(pushHistory(s1, c, false).items).toEqual([a, b, c]);
    const merged = pushHistory(s1, c, true);
    expect(merged.items).toEqual([a, c]);
    // Calling twice (StrictMode) gives the same result and leaves inputs untouched.
    expect(pushHistory(s1, c, true)).toEqual(merged);
    expect(s1.items).toEqual([a, b]);
    // No-op edits do not add an entry.
    expect(pushHistory(s1, { ...b, design: { ...b.design } }, false)).toBe(s1);
  });

  it('loading a file is an undoable step that keeps the previous file', () => {
    const a = { ...newBikeFile(defaultDesign()), fileName: 'mine.bcad' };
    const b = newBikeFile({ ...defaultDesign(), title: 'other' });
    const s = pushHistory({ items: [a], index: 0 }, b, false);
    expect(s.index).toBe(1);
    expect(s.items[0]).toBe(a);
  });
});

describe('library parsing', () => {
  it('tolerates corrupt or non-array JSON', () => {
    expect(parseLibrary(null)).toEqual([]);
    expect(parseLibrary('{oops')).toEqual([]);
    expect(parseLibrary('{"a":1}')).toEqual([]);
    expect(parseLibrary('null')).toEqual([]);
    expect(parseLibrary('[null, 3, {"id":"x"}, {"id":"y","design":{}}]').map((i) => i.id)).toEqual(['y']);
  });
});
