import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BikeFile, exportBcad, importBcad, newBikeFile } from '../bcad/io';
import { parseProperties } from '../bcad/properties';
import { Design, GroupId, PARAMS, defaultDesign } from '../model/schema';
import { solve } from '../geometry/solve';
import { Canvas, CanvasHandle } from './Canvas';
import { NumberInput, ParamPanel } from './ParamPanel';
import { FitPanel, GearPanel, LibraryPanel, MitrePanel, SpecPanel } from './Panels';
import { Sheet } from './Sheet';
import { useAutosave, useBikeHistory, useLibrary, loadAutosave, upgradeDesign, LibraryItem } from './state';
import { SHEETS, baseName, compareCsv, download, frameDxf, mitreDxf, mitrePdf, sideViewSvgString, specCsv, svgFileName, svgToPdf, svgToString } from '../export/exporters';
import { PRESETS } from '../model/presets';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Menubar } from '@base-ui/react/menubar';
import { Tabs } from '@base-ui/react/tabs';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Slider } from '@base-ui/react/slider';
import { Button, TextInput, Tip, Toasts, useToastManager } from './kit';

type RightTab = 'spec' | 'fit' | 'gears' | 'mitres' | 'library' | 'compare';
type View = 'design' | 'sheet';
type Photo = { url: string; x: number; y: number; scale: number; opacity: number };
type Compare = { name: string; file: BikeFile };

/** Text-editing controls keep their own Ctrl+Z / Ctrl+Y. */
function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  // Selects have no undo of their own, so app undo still applies to them.
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'].includes((el as HTMLInputElement).type);
  return false;
}

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger className="btn menu-trigger">{label} ▾</BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="menu-positioner" sideOffset={2} align="start">
          <BaseMenu.Popup className="popup menu-items">{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

function Item({ onClick, children }: { onClick: () => unknown; children: React.ReactNode }) {
  return (
    <BaseMenu.Item className="popup-item" onClick={() => void onClick()}>
      {children}
    </BaseMenu.Item>
  );
}

const MenuSep = () => <BaseMenu.Separator className="menu-sep" />;

function initialFile(): BikeFile {
  const saved = loadAutosave();
  if (saved) {
    try {
      const source = saved.sourceXml ? parseProperties(saved.sourceXml) : null;
      return { design: upgradeDesign(saved.design), source, fileName: saved.fileName, mappedKeys: [] };
    } catch {
      /* fall through */
    }
  }
  return newBikeFile(PRESETS[0].make());
}

function derivedFor(f: BikeFile) {
  const g = solve(f.design);
  return { headTubeLength: g.dims.headTubeLength, frontCenter: g.dims.frontCenter, ttAngle: g.dims.ttAngle };
}

export function App() {
  const hist = useBikeHistory(initialFile);
  const { file, update, replace, undo, redo, canUndo, canRedo } = hist;
  const [compare, setCompareRaw] = useState<Compare | null>(null);
  const [morph, setMorph] = useState(0);
  // A new or cleared comparison always starts from the real design (no morph).
  const setCompare = useCallback((c: Compare | null) => {
    setCompareRaw(c);
    setMorph(0);
  }, []);
  const [openGroup, setOpenGroup] = useState<GroupId | null>('frontEnd');
  const [rightTab, setRightTab] = useState<RightTab>('spec');
  const [view, setView] = useState<View>('design');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const sheetRef = useRef<SVGSVGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const compareInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const library = useLibrary();

  const morphing = !!compare && morph > 0;
  // Real design and geometry: used for editing, panels and every export.
  const gReal = useMemo(() => solve(file.design), [file.design]);
  // On-screen preview only: the canvas (and its status bar) show the morph.
  const shown: Design = useMemo(() => (compare && morph > 0 ? morphDesign(file.design, compare.file.design, morph) : file.design), [file.design, compare, morph]);
  const g = useMemo(() => (shown === file.design ? gReal : solve(shown)), [shown, file.design, gReal]);
  const ghost = useMemo(() => (compare && morph === 0 ? { d: compare.file.design, g: solve(compare.file.design) } : null), [compare, morph]);

  // Revoke a photo's object URL once it is replaced or removed.
  const photoUrl = photo?.url;
  useEffect(() => {
    return () => {
      if (photoUrl?.startsWith('blob:')) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const serializeSource = useCallback(() => (file.source ? exportBcad(file, derivedFor(file)) : undefined), [file]);
  useAutosave(file, serializeSource);

  const { add: addToast } = useToastManager();
  const flash = useCallback((msg: string) => void addToast({ description: msg }), [addToast]);

  // ------------------------------------------------------------ file ops
  const openText = useCallback(
    (text: string, name: string) => {
      try {
        const f = importBcad(text, name);
        replace(f);
        setTimeout(() => canvasRef.current?.fit(), 0);
        flash(`Opened ${name}: ${f.mappedKeys.length} of ${f.source?.entries.size ?? 0} BikeCAD values used, all others kept for saving.`);
      } catch (e) {
        flash(`Could not open ${name}: ${(e as Error).message}`);
      }
    },
    [replace, flash],
  );

  const readAndOpen = useCallback(
    async (f: File) => {
      let text: string;
      try {
        text = await f.text();
      } catch (e) {
        flash(`Could not read ${f.name}: ${(e as Error).message}`);
        return;
      }
      openText(text, f.name);
    },
    [openText, flash],
  );

  const openFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void readAndOpen(f);
  };

  const saveBcad = useCallback(() => {
    const xml = exportBcad(file, derivedFor(file));
    const name = file.fileName && file.fileName !== 'untitled.bcad' ? file.fileName : `${baseName(file.design)}.bcad`;
    download(name, xml, 'application/xml');
  }, [file]);

  const newDesign = (make: () => Design) => {
    replace(newBikeFile(make()));
    setCompare(null);
    setTimeout(() => canvasRef.current?.fit(), 0);
  };

  // ------------------------------------------------------------- exports
  const exportSvg = () => {
    if (view === 'sheet') {
      const el = sheetRef.current;
      if (el) download(svgFileName(file.design, 'sheet'), svgToString(el), 'image/svg+xml');
    } else {
      const el = canvasRef.current?.svg;
      if (el) download(svgFileName(file.design, 'side'), sideViewSvgString(el, shown, g), 'image/svg+xml');
    }
  };
  const exportPdf = async () => {
    try {
      setView('sheet');
      await new Promise((r) => setTimeout(r, 50));
      const el = sheetRef.current;
      if (!el) return;
      const [w, h] = SHEETS[String(file.design.sheetSize)] ?? SHEETS.A3;
      await svgToPdf(el, w, h, `${baseName(file.design)}_sheet.pdf`);
    } catch (e) {
      flash(`PDF export failed: ${(e as Error).message}`);
    }
  };
  const runExport = (what: string, fn: () => unknown) => {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((e: unknown) => flash(`${what} export failed: ${(e as Error).message}`));
    } catch (e) {
      flash(`${what} export failed: ${(e as Error).message}`);
    }
  };

  // --------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        // Leave text undo to the focused field.
        if (isEditable(e.target)) return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveBcad();
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInput.current?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveBcad]);

  // Drag & drop
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (/\.(png|jpe?g|gif|webp)$/i.test(f.name)) {
        setPhoto({ url: URL.createObjectURL(f), x: -1000, y: 800, scale: 2, opacity: 0.5 });
      } else await readAndOpen(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [readAndOpen]);

  const onPick = (grp: string) => {
    setOpenGroup(grp as GroupId);
  };

  const toggleDim = (id: string) => {
    const set = new Set(String(file.design.dimSet).split(',').map((s) => s.trim()).filter(Boolean));
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ dimSet: [...set].join(',') }, false);
  };

  const saveToLibrary = () => {
    const name = String(file.design.title || 'Untitled');
    const ok = library.save({
      id: `${Date.now()}`,
      name,
      savedAt: new Date().toISOString(),
      notes: [file.design.size, file.design.customer].filter(Boolean).join(' · '),
      design: file.design,
      sourceXml: file.source ? exportBcad(file, derivedFor(file)) : undefined,
    });
    flash(ok ? `Saved “${name}” to the library.` : `Could not save “${name}”: browser storage is full or blocked. Use Save .bcad instead.`);
  };
  const libraryFile = (it: LibraryItem): BikeFile => ({
    design: upgradeDesign(it.design),
    source: it.sourceXml ? parseProperties(it.sourceXml) : null,
    fileName: `${it.name}.bcad`,
    mappedKeys: [],
  });
  const openFromLibrary = (it: LibraryItem) => {
    try {
      replace(libraryFile(it));
      setTimeout(() => canvasRef.current?.fit(), 0);
    } catch (e) {
      flash(`Could not open “${it.name}”: ${(e as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden>
            <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round">
              <circle cx="14" cy="42" r="11" />
              <circle cx="50" cy="42" r="11" />
              <path d="M14 42 28 42 44 20 24 20 28 42M44 20 50 42M24 20 22 14" />
            </g>
          </svg>
          <span>Open Bike CAD</span>
        </div>
        <Menubar className="menubar">
        <Menu label="File">
          {PRESETS.map((p) => (
            <Item key={p.id} onClick={() => newDesign(p.make)}>
              New {p.label}
            </Item>
          ))}
          <Item onClick={() => newDesign(defaultDesign)}>
            New blank
          </Item>
          <MenuSep />
          <Item onClick={() => fileInput.current?.click()}>
            Open .bcad… <kbd>Ctrl O</kbd>
          </Item>
          <Item onClick={saveBcad}>
            Save .bcad <kbd>Ctrl S</kbd>
          </Item>
          <Item onClick={saveToLibrary}>
            Save to library
          </Item>
        </Menu>
        <Menu label="Export">
          <Item onClick={exportPdf}>
            Drawing sheet (PDF)
          </Item>
          <Item onClick={exportSvg}>
            {view === 'sheet' ? 'Drawing sheet' : 'Side view'} (SVG)
          </Item>
          <Item onClick={() => runExport('DXF', () => download(`${baseName(file.design)}_frame.dxf`, frameDxf(file.design, gReal), 'application/dxf'))}>
            Frame outline (DXF)
          </Item>
          <MenuSep />
          <Item onClick={() => runExport('Mitre PDF', () => mitrePdf(file.design, gReal))}>
            Mitre templates (PDF, 1:1)
          </Item>
          <Item onClick={() => runExport('DXF', () => download(`${baseName(file.design)}_mitres.dxf`, mitreDxf(file.design, gReal), 'application/dxf'))}>
            Mitre templates (DXF)
          </Item>
          <MenuSep />
          <Item onClick={() => runExport('CSV', () => download(`${baseName(file.design)}_spec.csv`, specCsv(file.design, gReal), 'text/csv'))}>
            Spec, cut list & parameters (CSV)
          </Item>
          {compare && (
            <Item
              onClick={() =>
                download(
                  'comparison.csv',
                  compareCsv([
                    { name: String(file.design.title), d: file.design, g: gReal },
                    { name: compare.name, d: compare.file.design, g: solve(compare.file.design) },
                  ]),
                  'text/csv',
                )
              }
            >
              Comparison table (CSV)
            </Item>
          )}
        </Menu>
        </Menubar>
        <div className="sep" />
        <Tip text="Undo (Ctrl Z)">
          <Button onClick={undo} disabled={!canUndo}>
            ↶ Undo
          </Button>
        </Tip>
        <Tip text="Redo (Ctrl Shift Z)">
          <Button onClick={redo} disabled={!canRedo}>
            ↷ Redo
          </Button>
        </Tip>
        <div className="sep" />
        <ToggleGroup className="seg" value={[view]} onValueChange={(v) => v[0] && setView(v[0] as View)} aria-label="View">
          <Toggle value="design" className="btn">
            Design
          </Toggle>
          <Toggle value="sheet" className="btn">
            Drawing sheet
          </Toggle>
        </ToggleGroup>
        {view === 'design' && (
          <Tip text="Zoom to fit">
            <Button onClick={() => canvasRef.current?.fit()}>⤢ Fit</Button>
          </Tip>
        )}
        <div className="grow" />
        <div className="title-edit">
          <TextInput value={String(file.design.title)} onChange={(e) => update({ title: e.target.value })} aria-label="Design name" />
        </div>
        <input ref={fileInput} type="file" accept=".bcad,.xml,application/xml,text/xml" hidden onChange={(e) => (openFiles(e.target.files), (e.target.value = ''))} />
        <input
          ref={compareInput}
          type="file"
          accept=".bcad,.xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try {
                const bf = importBcad(await f.text(), f.name);
                setCompare({ name: f.name, file: bf });
                setRightTab('compare');
              } catch (err) {
                flash(`Could not open ${f.name}: ${(err as Error).message}`);
              }
            }
            e.target.value = '';
          }}
        />
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPhoto({ url: URL.createObjectURL(f), x: -1000, y: 800, scale: 2, opacity: 0.5 });
            e.target.value = '';
          }}
        />
      </header>

      <main>
        <aside className="left">
          <ParamPanel d={file.design} onChange={update} openGroup={openGroup} setOpenGroup={setOpenGroup} />
        </aside>

        <section className="center">
          {view === 'design' ? (
            <Canvas ref={canvasRef} d={shown} g={g} ghost={ghost} onChange={update} onPick={onPick} photo={photo} editable={!morphing} />
          ) : (
            <div className="sheet-wrap">
              <Sheet ref={sheetRef} d={file.design} g={gReal} />
            </div>
          )}
          <div className="statusbar">
            <span>
              Stack {g.dims.stack.toFixed(1)} · Reach {g.dims.reach.toFixed(1)} · HTL {g.dims.headTubeLength.toFixed(1)} · Trail {g.dims.trail.toFixed(1)} · WB {g.dims.wheelbase.toFixed(1)}
            </span>
            {g.warnings.length > 0 && <span className="warn">⚠ {g.warnings[0]}</span>}
            <span className="grow" />
            <span className="muted">
              {morphing ? 'Morph preview: set the slider to 0% to edit with the handles' : 'Drag the blue handles · scroll to zoom · drag to pan · click a part to edit it'}
            </span>
          </div>
        </section>

        <Tabs.Root render={<aside className="right" />} value={rightTab} onValueChange={(v) => setRightTab(v as RightTab)}>
          <Tabs.List className="tabs">
            {(
              [
                ['spec', 'Spec'],
                ['fit', 'Fit'],
                ['gears', 'Gears'],
                ['mitres', 'Mitres'],
                ['compare', 'Compare'],
                ['library', 'Library'],
              ] as [RightTab, string][]
            ).map(([id, label]) => (
              <Tabs.Tab key={id} value={id} className="btn tab">
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel value="spec"><SpecPanel d={file.design} g={gReal} onToggleDim={toggleDim} /></Tabs.Panel>
          <Tabs.Panel value="fit"><FitPanel d={file.design} g={gReal} onChange={update} /></Tabs.Panel>
          <Tabs.Panel value="gears"><GearPanel d={file.design} g={gReal} /></Tabs.Panel>
          <Tabs.Panel value="mitres"><MitrePanel d={file.design} g={gReal} /></Tabs.Panel>
          <Tabs.Panel value="library">
            <LibraryPanel
              items={library.items}
              onOpen={openFromLibrary}
              onDelete={library.remove}
              onSaveCurrent={saveToLibrary}
              onCompare={(it) => {
                try {
                  setCompare({ name: it.name, file: libraryFile(it) });
                } catch (e) {
                  flash(`Could not open “${it.name}”: ${(e as Error).message}`);
                  return;
                }
                setRightTab('compare');
              }}
            />
          </Tabs.Panel>
          <Tabs.Panel value="compare">
            <ComparePanel
              current={file.design}
              compare={compare}
              morph={morph}
              setMorph={setMorph}
              onLoad={() => compareInput.current?.click()}
              onClear={() => setCompare(null)}
              onSwap={() => {
                if (!compare) return;
                const cur = file;
                replace(compare.file);
                setCompare({ name: cur.fileName && cur.fileName !== 'untitled.bcad' ? cur.fileName : String(cur.design.title), file: cur });
              }}
              photo={photo}
              setPhoto={setPhoto}
              onPhoto={() => photoInput.current?.click()}
            />
          </Tabs.Panel>
        </Tabs.Root>
      </main>
      <Toasts />
    </div>
  );
}

/** Linear interpolation between two designs (numbers only; other values switch at 50%). */
export function morphDesign(a: Design, b: Design, t: number): Design {
  const out: Design = { ...a };
  for (const p of PARAMS) {
    const va = a[p.id];
    const vb = b[p.id];
    if (typeof va === 'number' && typeof vb === 'number') out[p.id] = va + (vb - va) * t;
    else if (t >= 0.5) out[p.id] = vb;
  }
  // Keep presentation settings from the current design.
  for (const k of ['showDims', 'dimSet', 'showRider', 'title']) out[k] = a[k];
  return out;
}

function ComparePanel({
  current,
  compare,
  morph,
  setMorph,
  onLoad,
  onClear,
  onSwap,
  photo,
  setPhoto,
  onPhoto,
}: {
  current: Design;
  compare: Compare | null;
  morph: number;
  setMorph: (n: number) => void;
  onLoad: () => void;
  onClear: () => void;
  onSwap: () => void;
  photo: Photo | null;
  setPhoto: (p: Photo | null) => void;
  onPhoto: () => void;
}) {
  const ga = solve(current);
  const gb = compare ? solve(compare.file.design) : null;
  const rows: [string, (g: ReturnType<typeof solve>) => number][] = [
    ['Stack', (g) => g.dims.stack],
    ['Reach', (g) => g.dims.reach],
    ['Head angle', (g) => g.dims.headAngle],
    ['Seat angle', (g) => g.dims.seatAngle],
    ['Head tube', (g) => g.dims.headTubeLength],
    ['Eff. top tube', (g) => g.dims.ett],
    ['Chainstay', (g) => g.dims.chainstay],
    ['BB drop', (g) => g.dims.bbDrop],
    ['Wheelbase', (g) => g.dims.wheelbase],
    ['Front centre', (g) => g.dims.frontCenter],
    ['Trail', (g) => g.dims.trail],
    ['Standover', (g) => g.dims.standover],
    ['Saddle height', (g) => g.dims.saddleHeight],
    ['Bar X from BB', (g) => g.barClamp.x],
    ['Bar Y from BB', (g) => g.barClamp.y],
  ];
  return (
    <div className="panel compare">
      <div className="row-actions">
        <Button onClick={onLoad}>Open .bcad to compare…</Button>
        {compare && (
          <>
            <Button onClick={onSwap}>Swap</Button>
            <Button onClick={onClear}>Clear</Button>
          </>
        )}
      </div>
      {!compare && <p className="hint">Overlay another design in grey to compare geometry, or morph between the two.</p>}
      {compare && gb && (
        <>
          <Slider.Root className="morph" min={0} max={1} step={0.01} value={morph} onValueChange={(v) => setMorph(Number(v))}>
            <Slider.Label>
              Morph to “{compare.name}”: {(morph * 100).toFixed(0)}%
            </Slider.Label>
            <Slider.Control className="slider-control">
              <Slider.Track className="slider-track">
                <Slider.Indicator className="slider-indicator" />
                <Slider.Thumb className="slider-thumb" aria-label="Morph amount" />
              </Slider.Track>
            </Slider.Control>
          </Slider.Root>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Current</th>
                <th>{compare.name}</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn]) => {
                const a = fn(ga);
                const b = fn(gb);
                return (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="num">{a.toFixed(1)}</td>
                    <td className="num">{b.toFixed(1)}</td>
                    <td className={`num ${Math.abs(b - a) > 0.05 ? 'diff' : ''}`}>{(b - a >= 0 ? '+' : '') + (b - a).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <h4>Trace a photo</h4>
      <div className="row-actions">
        <Button onClick={onPhoto}>Import photo…</Button>
        {photo && (
          <Button onClick={() => setPhoto(null)}>Remove</Button>
        )}
      </div>
      {photo && (
        <div className="photo-controls">
          {(
            [
              ['x', 'Left (mm)', 10],
              ['y', 'Top (mm)', 10],
              ['scale', 'Width (m)', 0.01],
              ['opacity', 'Opacity', 0.05],
            ] as [keyof typeof photo, string, number][]
          ).map(([k, label, step]) => (
            <label key={k}>
              {label}
              <NumberInput value={Number(photo[k])} step={step} min={k === 'opacity' ? 0 : k === 'scale' ? 0.01 : undefined} max={k === 'opacity' ? 1 : undefined} onChange={(n) => setPhoto({ ...photo, [k]: n })} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
