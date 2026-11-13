import { useMemo } from 'react';
import { Design, numOf } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { fitAdvice, fitMetrics, estimateBodyFromHeight, gearTable } from '../fit/rider';
import { tubeCuts, fixtureTable } from '../export/mitre';
import { specRows } from '../export/spec';
import { LibraryItem } from './state';

const f = (n: number, p = 1) => (Number.isFinite(n) ? n.toFixed(p) : '—');

export function SpecPanel({ d, g, onToggleDim }: { d: Design; g: Geometry; onToggleDim: (id: string) => void }) {
  const rows = specRows(d, g);
  const shown = new Set(String(d.dimSet).split(',').map((s) => s.trim()));
  let section = '';
  return (
    <div className="panel spec">
      {g.warnings.length > 0 && (
        <div className="warnings">
          {g.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      <table>
        <tbody>
          {rows.map((r, i) => {
            const head = r.section !== section ? (
              <tr key={`h${i}`} className="sec">
                <th colSpan={3}>{r.section}</th>
              </tr>
            ) : null;
            section = r.section;
            return [
              head,
              <tr key={i}>
                <td>
                  {r.dim ? (
                    <label className="dimtoggle" title="Show on drawing">
                      <input type="checkbox" checked={shown.has(r.dim)} onChange={() => onToggleDim(r.dim!)} /> {r.label}
                    </label>
                  ) : (
                    <span className="nodim">{r.label}</span>
                  )}
                </td>
                <td className="num">{r.value}</td>
                <td className="unit">{r.unit}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FitPanel({ d, g, onChange }: { d: Design; g: Geometry; onChange: (p: Partial<Design>, c?: boolean) => void }) {
  const advice = useMemo(() => fitAdvice(d, g), [d, g]);
  const m = useMemo(() => fitMetrics(d, g), [d, g]);
  return (
    <div className="panel fit">
      <div className="row-actions">
        <label>
          <input type="checkbox" checked={d.showRider === true} onChange={(e) => onChange({ showRider: e.target.checked }, false)} /> Show rider
        </label>
        <button type="button" onClick={() => onChange(estimateBodyFromHeight(numOf(d, 'riderHeight')), false)} title="Fill inseam, torso, arm and foot from the rider's height">
          Estimate body from height
        </button>
      </div>
      <h4>Fit advisor ({String(d.fitScheme)})</h4>
      <table>
        <thead>
          <tr>
            <th>Measure</th>
            <th>Suggested</th>
            <th>Current</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {advice.map((a, i) => {
            const diff = a.current - a.recommended;
            const bad = Math.abs(diff) > (a.unit === '°' ? 5 : 15);
            return (
              <tr key={i} className={bad ? 'off' : ''} title={a.note}>
                <td>{a.label}</td>
                <td className="num">
                  {f(a.recommended)} {a.unit}
                </td>
                <td className="num">
                  {f(a.current)} {a.unit}
                </td>
                <td>
                  {a.param && (
                    <button type="button" className="small" onClick={() => onChange({ [a.param!]: Math.round(a.recommended * 2) / 2 }, false)}>
                      Apply
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4>Rider angles</h4>
      <table>
        <tbody>
          <tr>
            <td>Knee angle at bottom</td>
            <td className="num">{f(m.kneeAngleBottom)}°</td>
          </tr>
          <tr>
            <td>Hip angle at top of stroke</td>
            <td className="num">{f(m.hipAngleTop)}°</td>
          </tr>
          <tr>
            <td>Torso angle from horizontal</td>
            <td className="num">{f(m.torsoAngle)}°</td>
          </tr>
          <tr>
            <td>Shoulder angle</td>
            <td className="num">{f(m.shoulderAngle)}°</td>
          </tr>
          <tr>
            <td>Elbow angle</td>
            <td className="num">{f(m.elbowAngle)}°</td>
          </tr>
          <tr>
            <td>Knee forward of pedal axle</td>
            <td className="num">{f(m.kops)} mm</td>
          </tr>
        </tbody>
      </table>
      <p className="hint">Suggestions use general rules of thumb. Treat them as a starting point, not a professional fit.</p>
    </div>
  );
}

export function GearPanel({ d, g }: { d: Design; g: Geometry }) {
  const rows = useMemo(() => gearTable(d, g), [d, g]);
  const rings = [...new Set(rows.map((r) => r.ring))];
  const cogs = [...new Set(rows.map((r) => r.cog))];
  const cell = (ring: number, cog: number) => rows.find((r) => r.ring === ring && r.cog === cog)!;
  return (
    <div className="panel gears">
      <p className="hint">
        Wheel Ø {f(g.rearWheelR * 2, 0)} mm, cadence {numOf(d, 'cadence')} rpm. Each cell: gear inches / metres of development / km/h.
      </p>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Cog</th>
              {rings.map((r) => (
                <th key={r}>{r}T</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cogs.map((c) => (
              <tr key={c}>
                <th>{c}T</th>
                {rings.map((r) => {
                  const x = cell(r, c);
                  return (
                    <td key={r} className="num">
                      {f(x.gearInches, 1)}″<br />
                      <small>
                        {f(x.developmentM, 2)} m · {f(x.speedKmh, 1)}
                      </small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MitrePanel({ d, g }: { d: Design; g: Geometry }) {
  const cuts = useMemo(() => tubeCuts(d, g), [d, g]);
  const fixture = useMemo(() => fixtureTable(d, g), [d, g]);
  return (
    <div className="panel mitres">
      <h4>Cut list</h4>
      <table>
        <thead>
          <tr>
            <th>Tube</th>
            <th>OD × wall</th>
            <th>c-c</th>
            <th>Long points</th>
            <th>Cut</th>
          </tr>
        </thead>
        <tbody>
          {cuts.map((t) => (
            <tr key={t.id}>
              <td>
                {t.name}
                {t.quantity > 1 ? ` ×${t.quantity}` : ''}
              </td>
              <td className="num">
                {f(t.od)} × {f(t.wall, 2)}
              </td>
              <td className="num">{f(t.cc)}</td>
              <td className="num">{f(t.lengthLongPoints)}</td>
              <td className="num">{f(t.cutLength)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Mitre templates</h4>
      <div className="mitre-grid">
        {cuts.flatMap((t) =>
          t.ends.map((e, i) => {
            const W = e.curve[e.curve.length - 1].x;
            const H = Math.max(...e.curve.map((p) => p.y)) + 4;
            return (
              <figure key={`${t.id}${i}`}>
                <svg viewBox={`-2 -4 ${W + 4} ${H + 8}`}>
                  <rect x={0} y={-4} width={W} height={H + 6} fill="#f6f8fb" stroke="#ccd" strokeWidth={0.3} />
                  {[0, 0.25, 0.5, 0.75, 1].map((q) => (
                    <line key={q} x1={W * q} x2={W * q} y1={-4} y2={H + 2} stroke="#99a" strokeWidth={0.2} strokeDasharray="1 1" />
                  ))}
                  <polyline points={e.curve.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#1f4fae" strokeWidth={0.6} />
                </svg>
                <figcaption>
                  {t.name} → {e.into} · {f(e.angle)}°
                </figcaption>
              </figure>
            );
          }),
        )}
      </div>
      <h4>Fixture / jig set-up</h4>
      <table>
        <tbody>
          {fixture.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Coordinates are from the BB centre: x forward, y up, in mm.</p>
    </div>
  );
}

export function LibraryPanel({
  items,
  onOpen,
  onDelete,
  onSaveCurrent,
  onCompare,
}: {
  items: LibraryItem[];
  onOpen: (i: LibraryItem) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: () => void;
  onCompare: (i: LibraryItem) => void;
}) {
  return (
    <div className="panel library">
      <button type="button" className="primary" onClick={onSaveCurrent}>
        Save current design to library
      </button>
      <p className="hint">The library lives in this browser. Use Save .bcad to keep a file you can back up or share.</p>
      {items.length === 0 && <p className="empty">No saved designs yet.</p>}
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <div className="name">{it.name}</div>
            <div className="meta">{new Date(it.savedAt).toLocaleString()}</div>
            {it.notes && <div className="meta">{it.notes}</div>}
            <div className="actions">
              <button type="button" className="small" onClick={() => onOpen(it)}>
                Open
              </button>
              <button type="button" className="small" onClick={() => onCompare(it)}>
                Compare
              </button>
              <button type="button" className="small danger" onClick={() => onDelete(it.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
