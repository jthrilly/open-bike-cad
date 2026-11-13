import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { migrateDesign } from '../model/migrate';
import { BikeFile, newBikeFile } from '../bcad/io';
import { Design, PARAMS } from '../model/schema';

const AUTOSAVE_KEY = 'openbikecad.autosave.v1';
const LIBRARY_KEY = 'openbikecad.library.v1';

interface Stored {
  design: Design;
  fileName: string;
  sourceXml?: string;
}

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** Returns false when the value could not be stored (quota exceeded, blocked storage). */
export function safeSet(key: string, val: string): boolean {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch {
    return false;
  }
}

/** Fill in parameters added since a design was stored. */
export function upgradeDesign(d: Design): Design {
  const out = migrateDesign({ ...d });
  for (const p of PARAMS) if (!(p.id in out)) out[p.id] = p.default;
  return out;
}

// ----------------------------------------------------------- undo history
export interface HistoryState {
  items: BikeFile[];
  index: number;
  /** The commit that produced the current entry, for merging the next one into it. */
  last?: MergeInfo;
}
/** What the last commit was, used to decide whether the next one merges into it. */
export interface MergeInfo {
  key: string | null;
  time: number;
}
/** Consecutive edits of the same field(s) merge when they come within this window. */
export const FIELD_MERGE_MS = 1000;
export const HISTORY_LIMIT = 200;

/**
 * Coalesce argument → merge key. `true` merges consecutive edits of the same
 * field set (within FIELD_MERGE_MS); a string merges every commit carrying that
 * exact key (e.g. one canvas drag); `false` never merges.
 */
export function mergeKey(patch: Partial<Design> | null, coalesce: boolean | string): string | null {
  if (typeof coalesce === 'string') return `g:${coalesce}`;
  if (!coalesce || !patch) return null;
  return `f:${Object.keys(patch).sort().join(',')}`;
}

export function shouldMerge(prev: MergeInfo, key: string | null, now: number): boolean {
  if (key == null || prev.key !== key) return false;
  if (key.startsWith('g:')) return true;
  return now - prev.time < FIELD_MERGE_MS;
}

function sameFile(a: BikeFile, b: BikeFile) {
  if (a === b) return true;
  if (a.source !== b.source || a.fileName !== b.fileName || a.mappedKeys !== b.mappedKeys) return false;
  const ka = Object.keys(a.design);
  const kb = Object.keys(b.design);
  return ka.length === kb.length && ka.every((k) => Object.is(a.design[k], b.design[k]));
}

/** Pure history step: push `next`, or replace the current entry when merging. */
export function pushHistory(s: HistoryState, next: BikeFile, merge: boolean): HistoryState {
  const cur = s.items[s.index];
  if (sameFile(cur, next)) return s;
  const m = merge && s.index > 0;
  const base = s.items.slice(0, m ? s.index : s.index + 1);
  const items = [...base, next].slice(-HISTORY_LIMIT);
  return { items, index: items.length - 1 };
}

/**
 * Commit `next` under merge key `key` at time `now`. The merge decision lives in the state
 * itself, so a commit that changes nothing leaves it untouched and can't make a later
 * edit merge into an unrelated step.
 */
export function commitHistory(s: HistoryState, next: BikeFile, key: string | null, now: number): HistoryState {
  const merge = shouldMerge(s.last ?? { key: null, time: 0 }, key, now);
  const out = pushHistory(s, next, merge);
  return out === s ? s : { ...out, last: { key, time: now } };
}

export function useBikeHistory(initial: () => BikeFile) {
  const [stack, setStack] = useState<HistoryState>(() => ({ items: [initial()], index: 0 }));
  const file = stack.items[stack.index];
  const apply = useCallback((fn: (cur: BikeFile) => BikeFile, key: string | null) => {
    // The time is taken outside the updater so StrictMode's double invocation stays pure.
    const now = Date.now();
    setStack((s) => commitHistory(s, fn(s.items[s.index]), key, now));
  }, []);

  const commit = useCallback((next: BikeFile, coalesce: string | false = false) => apply(() => next, mergeKey(null, coalesce)), [apply]);

  const update = useCallback(
    (patch: Partial<Design>, coalesce: boolean | string = true) => {
      apply((cur) => ({ ...cur, design: { ...cur.design, ...patch } as Design }), mergeKey(patch, coalesce));
    },
    [apply],
  );

  /** Load a different file (New / Open / library / swap) as a new undoable step. */
  const replace = useCallback((f: BikeFile) => apply(() => f, null), [apply]);
  const undo = useCallback(() => {
    setStack((s) => ({ ...s, index: Math.max(0, s.index - 1), last: undefined }));
  }, []);
  const redo = useCallback(() => {
    setStack((s) => ({ ...s, index: Math.min(s.items.length - 1, s.index + 1), last: undefined }));
  }, []);

  return {
    file,
    update,
    commit,
    replace,
    undo,
    redo,
    canUndo: stack.index > 0,
    canRedo: stack.index < stack.items.length - 1,
  };
}

export function loadAutosave(): Stored | null {
  const raw = safeGet(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

export function useAutosave(file: BikeFile, serializeSource: () => string | undefined) {
  useEffect(() => {
    const t = setTimeout(() => {
      const s: Stored = { design: file.design, fileName: file.fileName, sourceXml: serializeSource() };
      safeSet(AUTOSAVE_KEY, JSON.stringify(s));
    }, 500);
    return () => clearTimeout(t);
  }, [file, serializeSource]);
}

// ----------------------------------------------------------- local library
export interface LibraryItem {
  id: string;
  name: string;
  savedAt: string;
  notes: string;
  design: Design;
  sourceXml?: string;
}

/** Parse the stored library, dropping anything that is not a usable entry. */
export function parseLibrary(raw: string | null): LibraryItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(
    (it): it is LibraryItem =>
      !!it && typeof it === 'object' && typeof (it as LibraryItem).id === 'string' && !!(it as LibraryItem).design && typeof (it as LibraryItem).design === 'object',
  ).map((it) => ({ ...it, name: String(it.name ?? 'Untitled'), savedAt: String(it.savedAt ?? ''), notes: String(it.notes ?? '') }));
}

export function readLibrary(): LibraryItem[] {
  return parseLibrary(safeGet(LIBRARY_KEY));
}

export function writeLibrary(items: LibraryItem[]): boolean {
  return safeSet(LIBRARY_KEY, JSON.stringify(items));
}

export function useLibrary() {
  const [items, setItems] = useState<LibraryItem[]>(() => readLibrary());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Returns false when the browser refused to store the library. */
  const save = useCallback((item: LibraryItem): boolean => {
    const next = [item, ...itemsRef.current.filter((p) => p.id !== item.id)];
    if (!writeLibrary(next)) return false;
    itemsRef.current = next;
    setItems(next);
    return true;
  }, []);
  const remove = useCallback((id: string): boolean => {
    const next = itemsRef.current.filter((p) => p.id !== id);
    const ok = writeLibrary(next);
    itemsRef.current = next;
    setItems(next);
    return ok;
  }, []);
  return useMemo(() => ({ items, save, remove }), [items, save, remove]);
}

export { newBikeFile };
