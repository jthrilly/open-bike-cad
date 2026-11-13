import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
export function safeSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* storage full or blocked */
  }
}

/** Fill in parameters added since a design was stored. */
export function upgradeDesign(d: Design): Design {
  const out = { ...d };
  for (const p of PARAMS) if (!(p.id in out)) out[p.id] = p.default;
  return out;
}

export function useBikeHistory(initial: () => BikeFile) {
  const [stack, setStack] = useState<{ items: BikeFile[]; index: number }>(() => ({ items: [initial()], index: 0 }));
  const file = stack.items[stack.index];
  const lastCommit = useRef(0);

  const commit = useCallback((next: BikeFile, coalesce = false) => {
    setStack((s) => {
      const now = Date.now();
      const merge = coalesce && now - lastCommit.current < 600 && s.index > 0;
      lastCommit.current = now;
      const base = s.items.slice(0, merge ? s.index : s.index + 1);
      const items = [...base, next].slice(-200);
      return { items, index: items.length - 1 };
    });
  }, []);

  const update = useCallback(
    (patch: Partial<Design>, coalesce = true) => {
      commit({ ...file, design: { ...file.design, ...patch } as Design }, coalesce);
    },
    [file, commit],
  );

  const replace = useCallback((f: BikeFile) => setStack({ items: [f], index: 0 }), []);
  const undo = useCallback(() => setStack((s) => ({ ...s, index: Math.max(0, s.index - 1) })), []);
  const redo = useCallback(() => setStack((s) => ({ ...s, index: Math.min(s.items.length - 1, s.index + 1) })), []);

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

export function readLibrary(): LibraryItem[] {
  try {
    return JSON.parse(safeGet(LIBRARY_KEY) ?? '[]') as LibraryItem[];
  } catch {
    return [];
  }
}

export function writeLibrary(items: LibraryItem[]) {
  safeSet(LIBRARY_KEY, JSON.stringify(items));
}

export function useLibrary() {
  const [items, setItems] = useState<LibraryItem[]>(() => readLibrary());
  const save = useCallback((item: LibraryItem) => {
    setItems((prev) => {
      const next = [item, ...prev.filter((p) => p.id !== item.id)];
      writeLibrary(next);
      return next;
    });
  }, []);
  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((p) => p.id !== id);
      writeLibrary(next);
      return next;
    });
  }, []);
  return useMemo(() => ({ items, save, remove }), [items, save, remove]);
}

export { newBikeFile };
