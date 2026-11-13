import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BikeFile, exportBcad, importBcad, newBikeFile } from '../bcad/io';
import { parseProperties } from '../bcad/properties';
import { Design, GroupId, PARAMS, defaultDesign } from '../model/schema';
import { solve } from '../geometry/solve';
import { Canvas, CanvasHandle } from './Canvas';
import { ParamPanel } from './ParamPanel';
import { FitPanel, GearPanel, LibraryPanel, MitrePanel, SpecPanel } from './Panels';
import { Sheet } from './Sheet';
import { useAutosave, useBikeHistory, useLibrary, loadAutosave, upgradeDesign, LibraryItem } from './state';
import { SHEETS, baseName, compareCsv, download, frameDxf, mitreDxf, mitrePdf, specCsv, svgToPdf, svgToString } from '../export/exporters';
import { PRESETS } from '../model/presets';

type RightTab = 'spec' | 'fit' | 'gears' | 'mitres' | 'library' | 'compare';
type View = 'design' | 'sheet';

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
  const [compare, setCompare] = useState<{ name: string; design: Design } | null>(null);
  const [morph, setMorph] = useState(0);
  const [openGroup, setOpenGroup] = useState<GroupId | null>('frontEnd');
  const [rightTab, setRightTab] = useState<RightTab>('spec');
  const [view, setView] = useState<View>('design');
  const [photo, setPhoto] = useState<{ url: string; x: number; y: number; scale: number; opacity: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const sheetRef = useRef<SVGSVGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const compareInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const library = useLibrary();

  const shown: Design = useMemo(() => (compare && morph > 0 ? morphDesign(file.design, compare.design, morph) : file.design), [file.design, compare, morph]);
  const g = useMemo(() => solve(shown), [shown]);
  const ghost = useMemo(() => (compare && morph === 0 ? { d: compare.design, g: solve(compare.design) } : null), [compare, morph]);

  const serializeSource = useCallback(() => (file.source ? exportBcad(file, derivedFor(file)) : undefined), [file]);
  useAutosave(file, serializeSource);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

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
    [replace],
  );

  const openFiles = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    openText(await f.text(), f.name);
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
    const el = view === 'sheet' ? sheetRef.current : canvasRef.current?.svg;
    if (el) download(`${baseName(file.design)}.svg`, svgToString(el), 'image/svg+xml');
  };
  const exportPdf = async () => {
    setView('sheet');
    await new Promise((r) => setTimeout(r, 50));
    const el = sheetRef.current;
    if (!el) return;
    const [w, h] = SHEETS[String(file.design.sheetSize)] ?? SHEETS.A3;
    await svgToPdf(el, w, h, `${baseName(file.design)}.pdf`);
  };

  // --------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key.toLowerCase() === 'z' && tag !== 'TEXTAREA') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
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
      } else openText(await f.text(), f.name);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [openText]);

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
    library.save({
      id: `${Date.now()}`,
      name,
      savedAt: new Date().toISOString(),
      notes: [file.design.size, file.design.customer].filter(Boolean).join(' · '),
      design: file.design,
      sourceXml: file.source ? exportBcad(file, derivedFor(file)) : undefined,
    });
    flash(`Saved “${name}” to the library.`);
  };
  const openFromLibrary = (it: LibraryItem) => {
    replace({ design: upgradeDesign(it.design), source: it.sourceXml ? parseProperties(it.sourceXml) : null, fileName: `${it.name}.bcad`, mappedKeys: [] });
    setTimeout(() => canvasRef.current?.fit(), 0);
  };

  const Menu = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
    <div className="menu" onMouseLeave={() => menu === id && setMenu(null)}>
      <button type="button" className={menu === id ? 'open' : ''} onClick={() => setMenu(menu === id ? null : id)}>
        {label} ▾
      </button>
      {menu === id && (
        <div className="menu-items" onClick={() => setMenu(null)}>
          {children}
        </div>
      )}
    </div>
  );

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
        <Menu id="file" label="File">
          {PRESETS.map((p) => (
            <button type="button" key={p.id} onClick={() => newDesign(p.make)}>
              New {p.label}
            </button>
          ))}
          <button type="button" onClick={() => newDesign(defaultDesign)}>
            New blank
          </button>
          <hr />
          <button type="button" onClick={() => fileInput.current?.click()}>
            Open .bcad… <kbd>Ctrl O</kbd>
          </button>
          <button type="button" onClick={saveBcad}>
            Save .bcad <kbd>Ctrl S</kbd>
          </button>
          <button type="button" onClick={saveToLibrary}>
            Save to library
          </button>
        </Menu>
        <Menu id="export" label="Export">
          <button type="button" onClick={exportPdf}>
            Drawing sheet (PDF)
          </button>
          <button type="button" onClick={exportSvg}>
            {view === 'sheet' ? 'Drawing sheet' : 'Side view'} (SVG)
          </button>
          <button type="button" onClick={() => download(`${baseName(file.design)}_frame.dxf`, frameDxf(shown, g), 'application/dxf')}>
            Frame outline (DXF)
          </button>
          <hr />
          <button type="button" onClick={() => mitrePdf(shown, g)}>
            Mitre templates (PDF, 1:1)
          </button>
          <button type="button" onClick={() => download(`${baseName(file.design)}_mitres.dxf`, mitreDxf(shown, g), 'application/dxf')}>
            Mitre templates (DXF)
          </button>
          <hr />
          <button type="button" onClick={() => download(`${baseName(file.design)}_spec.csv`, specCsv(shown, g), 'text/csv')}>
            Spec, cut list & parameters (CSV)
          </button>
          {compare && (
            <button
              type="button"
              onClick={() =>
                download(
                  'comparison.csv',
                  compareCsv([
                    { name: String(file.design.title), d: file.design, g: solve(file.design) },
                    { name: compare.name, d: compare.design, g: solve(compare.design) },
                  ]),
                  'text/csv',
                )
              }
            >
              Comparison table (CSV)
            </button>
          )}
        </Menu>
        <div className="sep" />
        <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl Z)">
          ↶ Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl Shift Z)">
          ↷ Redo
        </button>
        <div className="sep" />
        <div className="seg">
          <button type="button" className={view === 'design' ? 'on' : ''} onClick={() => setView('design')}>
            Design
          </button>
          <button type="button" className={view === 'sheet' ? 'on' : ''} onClick={() => setView('sheet')}>
            Drawing sheet
          </button>
        </div>
        {view === 'design' && (
          <button type="button" onClick={() => canvasRef.current?.fit()} title="Zoom to fit">
            ⤢ Fit
          </button>
        )}
        <div className="grow" />
        <div className="title-edit">
          <input value={String(file.design.title)} onChange={(e) => update({ title: e.target.value })} aria-label="Design name" />
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
                setCompare({ name: f.name, design: bf.design });
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
            <Canvas ref={canvasRef} d={shown} g={g} ghost={ghost} onChange={update} onPick={onPick} photo={photo} />
          ) : (
            <div className="sheet-wrap">
              <Sheet ref={sheetRef} d={shown} g={g} />
            </div>
          )}
          <div className="statusbar">
            <span>
              Stack {g.dims.stack.toFixed(1)} · Reach {g.dims.reach.toFixed(1)} · HTL {g.dims.headTubeLength.toFixed(1)} · Trail {g.dims.trail.toFixed(1)} · WB {g.dims.wheelbase.toFixed(1)}
            </span>
            {g.warnings.length > 0 && <span className="warn">⚠ {g.warnings[0]}</span>}
            <span className="grow" />
            <span className="muted">Drag the blue handles · scroll to zoom · drag to pan · click a part to edit it</span>
          </div>
        </section>

        <aside className="right">
          <nav className="tabs">
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
              <button type="button" key={id} className={rightTab === id ? 'on' : ''} onClick={() => setRightTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {rightTab === 'spec' && <SpecPanel d={shown} g={g} onToggleDim={toggleDim} />}
          {rightTab === 'fit' && <FitPanel d={shown} g={g} onChange={update} />}
          {rightTab === 'gears' && <GearPanel d={shown} g={g} />}
          {rightTab === 'mitres' && <MitrePanel d={shown} g={g} />}
          {rightTab === 'library' && (
            <LibraryPanel
              items={library.items}
              onOpen={openFromLibrary}
              onDelete={library.remove}
              onSaveCurrent={saveToLibrary}
              onCompare={(it) => {
                setCompare({ name: it.name, design: upgradeDesign(it.design) });
                setRightTab('compare');
              }}
            />
          )}
          {rightTab === 'compare' && (
            <ComparePanel
              current={file.design}
              compare={compare}
              morph={morph}
              setMorph={setMorph}
              onLoad={() => compareInput.current?.click()}
              onClear={() => {
                setCompare(null);
                setMorph(0);
              }}
              onSwap={() => {
                if (!compare) return;
                const cur = file.design;
                replace(newBikeFile(compare.design));
                setCompare({ name: String(cur.title), design: cur });
              }}
              photo={photo}
              setPhoto={setPhoto}
              onPhoto={() => photoInput.current?.click()}
            />
          )}
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
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
  compare: { name: string; design: Design } | null;
  morph: number;
  setMorph: (n: number) => void;
  onLoad: () => void;
  onClear: () => void;
  onSwap: () => void;
  photo: { url: string; x: number; y: number; scale: number; opacity: number } | null;
  setPhoto: (p: { url: string; x: number; y: number; scale: number; opacity: number } | null) => void;
  onPhoto: () => void;
}) {
  const ga = solve(current);
  const gb = compare ? solve(compare.design) : null;
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
        <button type="button" onClick={onLoad}>
          Open .bcad to compare…
        </button>
        {compare && (
          <>
            <button type="button" onClick={onSwap}>
              Swap
            </button>
            <button type="button" onClick={onClear}>
              Clear
            </button>
          </>
        )}
      </div>
      {!compare && <p className="hint">Overlay another design in grey to compare geometry, or morph between the two.</p>}
      {compare && gb && (
        <>
          <label className="morph">
            Morph to “{compare.name}”: {(morph * 100).toFixed(0)}%
            <input type="range" min={0} max={1} step={0.01} value={morph} onChange={(e) => setMorph(Number(e.target.value))} />
          </label>
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
        <button type="button" onClick={onPhoto}>
          Import photo…
        </button>
        {photo && (
          <button type="button" onClick={() => setPhoto(null)}>
            Remove
          </button>
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
              <input type="number" step={step} value={Number(photo[k])} onChange={(e) => setPhoto({ ...photo, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
