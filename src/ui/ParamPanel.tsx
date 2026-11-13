import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Design, GROUPS, GroupId, PARAMS, ParamDef, ParamValue } from '../model/schema';
import { switchFrontEndMode, switchTopTubeMode } from '../geometry/solve';
import { DIM_OPTIONS } from '../render/DimensionLayer';

interface Props {
  d: Design;
  onChange: (patch: Partial<Design>, coalesce?: boolean | string) => void;
  openGroup: GroupId | null;
  setOpenGroup: (g: GroupId | null) => void;
  sections?: string[];
}

export function ParamPanel({ d, onChange, openGroup, setOpenGroup, sections }: Props) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groupRefs = useRef<Record<string, HTMLDetailsElement | null>>({});

  useEffect(() => {
    if (openGroup) groupRefs.current[openGroup]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [openGroup]);

  const groups = GROUPS.filter((g) => !sections || sections.includes(g.section));
  let lastSection = '';

  const setValue = (p: ParamDef, value: ParamValue) => {
    if (p.id === 'frontEndMode') {
      const next = switchFrontEndMode(d, String(value));
      onChange(next, false);
      return;
    }
    if (p.id === 'topTubeMode') {
      onChange(switchTopTubeMode(d, String(value)), false);
      return;
    }
    onChange({ [p.id]: value });
  };

  return (
    <div className="panel params">
      <input className="search" placeholder="Find a setting…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a setting" />
      {groups.map((g) => {
        const params = PARAMS.filter((p) => p.group === g.id && (!p.showIf || p.showIf(d)) && (!q || p.label.toLowerCase().includes(q) || (p.help ?? '').toLowerCase().includes(q)));
        if (!params.length && g.id !== 'display') return null;
        const header = g.section !== lastSection ? <div className="section-title">{g.section}</div> : null;
        lastSection = g.section;
        const open = q ? true : openGroup === g.id;
        return (
          <div key={g.id}>
            {header}
            <details
              ref={(el) => {
                groupRefs.current[g.id] = el;
              }}
              open={open}
              onToggle={(e) => {
                // While searching every group is forced open; toggles that just
                // reflect what we rendered are not user choices either.
                if (q) return;
                const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                if (isOpen === open) return;
                if (isOpen && openGroup !== g.id) setOpenGroup(g.id);
                if (!isOpen && openGroup === g.id) setOpenGroup(null);
              }}
            >
              <summary>{g.label}</summary>
              <div className="fields">
                {params.map((p) => (
                  <Field key={p.id} p={p} value={d[p.id]} onChange={(v) => setValue(p, v)} />
                ))}
                {g.id === 'display' && <DimPicker d={d} onChange={onChange} />}
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}

function DimPicker({ d, onChange }: { d: Design; onChange: Props['onChange'] }) {
  const set = new Set(String(d.dimSet).split(',').map((s) => s.trim()).filter(Boolean));
  const toggle = (id: string) => {
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ dimSet: [...set].join(',') }, false);
  };
  return (
    <div className="dim-picker">
      <div className="label">Dimensions shown</div>
      <div className="chips">
        {DIM_OPTIONS.map((o) => (
          <button key={o.id} className={set.has(o.id) ? 'chip on' : 'chip'} onClick={() => toggle(o.id)} type="button">
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({ p, value, onChange }: { p: ParamDef; value: ParamValue; onChange: (v: ParamValue) => void }) {
  if (p.id === 'dimSet') return null;
  const id = `f-${p.id}`;
  let input: React.ReactElement;
  switch (p.kind) {
    case 'num':
      input = <NumberInput id={id} value={Number(value)} step={p.step ?? 1} min={p.min} max={p.max} onChange={onChange} />;
      break;
    case 'enum':
      input = (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {p.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'bool':
      input = <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
      break;
    case 'color':
      input = <input id={id} type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'longtext':
      input = <textarea id={id} rows={4} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      input = <input id={id} type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className={`field kind-${p.kind}`} title={p.help}>
      <label htmlFor={id}>{p.label}</label>
      <div className="control">
        {input}
        {p.unit && p.kind === 'num' && <span className="unit">{p.unit}</span>}
      </div>
    </div>
  );
}

/**
 * Number input that lets you type freely (including "-" or "7.") and commits
 * on valid input. Arrow keys step; Shift = ×10, Alt = ×0.1.
 */
export function NumberInput({ id, value, step, min, max, onChange }: { id?: string; value: number; step: number; min?: number; max?: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  /** True once the user has typed since focusing (or since the last step/commit from outside). */
  const typed = useRef(false);
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    // Resync from the model unless the user is mid-typing and this is the value they typed.
    if (!focused.current || !typed.current || lastSent.current !== value) {
      setText(fmt(value));
      typed.current = false;
    }
  }, [value]);
  const commit = (s: string) => {
    // Accept a decimal comma; reject anything that isn't a whole number ("0x10", "72abc").
    const t = s.trim().replace(',', '.');
    const n = t === '' || t === '-' || t === '.' ? NaN : Number(t);
    if (Number.isFinite(n)) {
      const c = clamp(n, min, max);
      lastSent.current = c;
      onChange(c);
    }
  };
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => {
        focused.current = true;
        typed.current = false;
      }}
      onBlur={() => {
        focused.current = false;
        typed.current = false;
        setText(fmt(value));
      }}
      onChange={(e) => {
        typed.current = true;
        setText(e.target.value);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          const n = clamp(round(value + (e.key === 'ArrowUp' ? 1 : -1) * step * mult), min, max);
          typed.current = false;
          setText(fmt(n));
          onChange(n);
        } else if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => (Number.isFinite(n) ? String(round(n)) : '');
const clamp = (n: number, min?: number, max?: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
