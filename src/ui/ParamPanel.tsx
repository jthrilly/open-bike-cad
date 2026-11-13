import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Design, GROUPS, GroupId, PARAMS, ParamDef, ParamValue } from '../model/schema';
import { switchFrontEndMode, switchTopTubeMode } from '../geometry/solve';
import { DIM_OPTIONS } from '../render/DimensionLayer';
import { Accordion } from '@base-ui/react/accordion';
import { Field as BaseField } from '@base-ui/react/field';
import { NumberField } from '@base-ui/react/number-field';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Check, Select, TextInput, Tip } from './kit';

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
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const visible = groups.filter((g) => g.id === 'display' || PARAMS.some((p) => p.group === g.id && (!p.showIf || p.showIf(d)) && matches(p, q)));
  // While searching every matching group is forced open.
  const value = q ? visible.map((g) => g.id) : openGroup ? [openGroup] : [];

  return (
    <div className="panel params">
      <TextInput className="search" placeholder="Find a setting…" value={query} onValueChange={(v) => setQuery(v)} aria-label="Find a setting" />
      <Accordion.Root
        className="accordion"
        multiple={!!q}
        value={value}
        onValueChange={(next) => {
          // Toggles while searching just reflect the forced-open state.
          if (q) return;
          const opened = (next as GroupId[]).find((id) => id !== openGroup);
          setOpenGroup(opened ?? ((next as GroupId[]).includes(openGroup as GroupId) ? openGroup : null));
        }}
      >
        {visible.map((g) => {
          const params = PARAMS.filter((p) => p.group === g.id && (!p.showIf || p.showIf(d)) && matches(p, q));
          const header = g.section !== lastSection ? <div className="section-title">{g.section}</div> : null;
          lastSection = g.section;
          return (
            <div key={g.id}>
              {header}
              <Accordion.Item
                value={g.id}
                className="group"
                ref={(el: HTMLDivElement | null) => {
                  groupRefs.current[g.id] = el;
                }}
              >
                <Accordion.Header className="group-header">
                  <Accordion.Trigger className="group-trigger">{g.label}</Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Panel className="fields">
                  {params.map((p) => (
                    <Field key={p.id} p={p} value={d[p.id]} onChange={(v) => setValue(p, v)} />
                  ))}
                  {g.id === 'display' && <DimPicker d={d} onChange={onChange} />}
                </Accordion.Panel>
              </Accordion.Item>
            </div>
          );
        })}
      </Accordion.Root>
    </div>
  );
}

const matches = (p: ParamDef, q: string) => !q || p.label.toLowerCase().includes(q) || (p.help ?? '').toLowerCase().includes(q);

function DimPicker({ d, onChange }: { d: Design; onChange: Props['onChange'] }) {
  const set = new Set(String(d.dimSet).split(',').map((s) => s.trim()).filter(Boolean));
  return (
    <div className="dim-picker">
      <div className="label">Dimensions shown</div>
      <ToggleGroup className="chips" multiple value={[...set]} onValueChange={(v) => onChange({ dimSet: v.join(',') }, false)}>
        {DIM_OPTIONS.map((o) => (
          <Toggle key={o.id} value={o.id} className="chip">
            {o.label}
          </Toggle>
        ))}
      </ToggleGroup>
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
<Select id={id} value={String(value)} options={p.options!} onChange={onChange} />
      );
      break;
    case 'bool':
      input = <Check id={id} checked={value === true} onChange={onChange} />;
      break;
    case 'color':
      input = <TextInput id={id} type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'longtext':
      input = <BaseField.Control id={id} render={<textarea rows={4} />} value={String(value)} onValueChange={(v) => onChange(String(v))} />;
      break;
    default:
      input = <TextInput id={id} type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <BaseField.Root className={`field kind-${p.kind}`}>
      <Tip text={p.help}>
        <BaseField.Label htmlFor={id}>{p.label}</BaseField.Label>
      </Tip>
      <div className="control">
        {input}
        {p.unit && p.kind === 'num' && <span className="unit">{p.unit}</span>}
      </div>
    </BaseField.Root>
  );
}

/**
 * Number box on Base UI NumberField. Typing updates the design live; arrow
 * keys step (Shift = ×10, Alt = ×0.1); Enter commits and leaves the box.
 */
export function NumberInput({ id, value, step, min, max, onChange }: { id?: string; value: number; step: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <NumberField.Root
      className="number-field"
      value={Number.isFinite(value) ? round(value) : null}
      step={step}
      smallStep={round(step * 0.1)}
      largeStep={step * 10}
      min={min}
      max={max}
      format={NUMBER_FORMAT}
      onValueChange={(v) => {
        if (v != null && Number.isFinite(v)) onChange(clamp(round(v), min, max));
      }}
    >
      <NumberField.Input
        id={id}
        inputMode="decimal"
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === ',' && !e.ctrlKey && !e.metaKey) {
            // Accept a decimal comma whatever the browser's locale.
            e.preventDefault();
            document.execCommand('insertText', false, '.');
          }
        }}
      />
    </NumberField.Root>
  );
}

const NUMBER_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 3, useGrouping: false };
const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, min?: number, max?: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
