/**
 * Mapping between .bcad files and the internal Design.
 *
 * A .bcad file holds well over a thousand keys. We map the ones that drive
 * geometry and components to Design parameters, keep every other key
 * untouched, and write them all back on save so a file round-trips through
 * Open Bike CAD without losing anything BikeCAD needs.
 *
 * Parameters that have no BikeCAD equivalent are stored under
 * "OpenBikeCAD.<id>" keys. Other programs ignore unknown keys.
 */
import { Design, PARAMS, PARAM_BY_ID, ParamValue, defaultDesign } from '../model/schema';
import { PropertiesDoc, parseProperties, serializeProperties } from './properties';

export const NS = 'OpenBikeCAD.';

export interface BikeFile {
  design: Design;
  /** Original file contents, used to preserve unmapped keys on save. */
  source: PropertiesDoc | null;
  fileName: string;
  /** Keys we recognised on import (for the import report). */
  mappedKeys: string[];
}

export function numFrom(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = parseFloat(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

/** Format a number the way Java's Double.toString would for typical values. */
export function formatJavaNumber(n: number, previousRaw?: string): string {
  const rounded = Math.round(n * 1e6) / 1e6;
  if (previousRaw != null && /^-?\d+$/.test(previousRaw.trim()) && Number.isInteger(rounded)) {
    return String(rounded);
  }
  const s = String(rounded);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/**
 * Special-case readers for values that are not a simple 1:1 key mapping.
 * Each returns a partial design.
 */
function readSpecial(e: Map<string, string>): Partial<Design> {
  const out: Partial<Design> = {};
  const n = (k: string) => numFrom(e.get(k));

  // Wheels: BikeCAD stores rim BSD and overall wheel diameter; tyre height is the difference.
  for (const side of ['rear', 'front'] as const) {
    const bsd = n(`BSD ${side}`);
    const wd = n(`Wheel diameter ${side}`);
    const tyreKey = side === 'rear' ? 'rearTyre' : 'frontTyre';
    if (bsd != null && wd != null && wd > bsd) out[tyreKey] = round1((wd - bsd) / 2);
  }

  // Fork: BikeCAD keeps several fork definitions (FORK0*, FORK1*, FORK2*), selected by fork type.
  const style = forkIndex(e);
  const forkL = n(`FORK${style}L`) ?? n('FORK0L');
  const forkR = n(`FORK${style}R`) ?? n('FORK0R');
  if (forkL != null) out.forkLength = forkL;
  if (forkR != null) out.forkRake = forkR;
  if (e.get('DUAL_CROWN') === 'true') out.forkType = 'dualCrown';

  // Front end: if a front-centre is present together with head tube length, use that mode,
  // since both are stored by BikeCAD. Otherwise fall back to reach + HTL.
  if (e.has('FCD textfield') && e.has('Head tube length textfield')) out.frontEndMode = 'frontCenter';
  else if (e.has('Stack') && e.has('Reach')) out.frontEndMode = 'stackReach';
  else if (e.has('Head tube length textfield')) out.frontEndMode = 'reachHtl';

  if (e.has('Top tube angle textfield')) out.topTubeMode = 'angle';

  // Tubes
  const tt = n('Top tube diameter') ?? n('Top tube front diameter');
  if (tt != null && tt > 5) out.ttOD = tt;
  const dt = n('Down tube front diameter') ?? n('Down tube diameter');
  if (dt != null && dt > 5) out.dtOD = dt;
  const walls: [string, string][] = [
    ['Wall thickness Top tube', 'ttWall'],
    ['Wall thickness Down tube', 'dtWall'],
    ['Wall thickness Seat tube', 'stWall'],
    ['Wall thickness Chain stay', 'csWall'],
    ['Wall thickness Seat stay', 'ssWall'],
    ['Wall thickness Head tube', 'htWall'],
  ];
  for (const [k, id] of walls) {
    const w = n(k);
    if (w != null && w > 0) out[id] = w;
  }
  const csBack = n('Chain stay back diameter');
  if (csBack != null) out.csODTip = csBack;
  const ssBottom = n('Seat stay bottom diameter');
  if (ssBottom != null) out.ssODTip = ssBottom;
  const ssJ = n('Seat stay junction');
  if (ssJ != null) out.ssSeatOffset = ssJ;
  if (e.get('Chain stay wishbone') === 'true') out.csYoke = true;

  const rings = readTeeth(e, 'chainring');
  if (rings.length) out.chainrings = rings.join(',');
  const cogs = readTeeth(e, 'cog');
  if (cogs.length) out.cogs = cogs.join(',');
  const crank = n('Crank length');
  if (crank != null) out.crankLength = crank;
  const barW = n('Handlebar width');
  if (barW != null) out.barWidth = barW;
  const bt = (e.get('HBAR type') ?? '').toLowerCase();
  if (bt) {
    if (bt.includes('drop')) out.barType = 'drop';
    else if (bt.includes('bull')) out.barType = 'bullhorn';
    else if (bt.includes('riser') || bt.includes('bmx')) out.barType = 'riser';
    else if (bt.includes('flat') || bt.includes('mtb') || bt.includes('mountain')) out.barType = 'flat';
  }
  if (e.get('BELTorCHAIN') === '0') out.driveType = 'belt';
  const fit = (e.get('Fit scheme') ?? '').toLowerCase();
  if (fit.includes('mtb')) out.fitScheme = 'mtb';
  else if (fit.includes('tour')) out.fitScheme = 'touring';
  else if (fit.includes('road')) out.fitScheme = 'road';

  return out;
}

function forkIndex(e: Map<string, string>): number {
  const t = numFrom(e.get('Fork type')) ?? numFrom(e.get('Fork style')) ?? 0;
  return e.has(`FORK${t}L`) ? t : 0;
}

/** Read "Teeth on chainring N" / "Teeth on cog N" lists. */
function readTeeth(e: Map<string, string>, what: 'chainring' | 'cog'): number[] {
  const countKey = what === 'cog' ? 'Number of cogs' : 'Number of chainrings';
  const count = numFrom(e.get(countKey));
  const out: number[] = [];
  for (let i = 0; i < 20; i++) {
    if (count != null && count > 0 && i >= count) break;
    const t = numFrom(e.get(`Teeth on ${what} ${i}`));
    if (t == null) break;
    out.push(t);
    if (count === 0) break;
  }
  return out;
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

export function importBcad(xml: string, fileName = 'design.bcad'): BikeFile {
  const doc = parseProperties(xml);
  const e = doc.entries;
  const design = defaultDesign();
  const mappedKeys = new Set<string>();

  for (const p of PARAMS) {
    if (!p.bcad) continue;
    for (const key of p.bcad) {
      const raw = e.get(key);
      if (raw == null) continue;
      const val = p.fromBcad ? p.fromBcad(raw, e) : coerce(p.kind, raw);
      if (val !== undefined) {
        design[p.id] = val;
        mappedKeys.add(key);
        break;
      }
    }
  }
  Object.assign(design, readSpecial(e));
  for (const k of e.keys()) if (SPECIAL_KEYS.has(k)) mappedKeys.add(k);

  // Our own namespaced keys.
  for (const [k, raw] of e) {
    if (!k.startsWith(NS)) continue;
    const id = k.slice(NS.length);
    const p = PARAM_BY_ID[id];
    if (!p) continue;
    // Only use them for parameters BikeCAD itself doesn't store, so edits
    // made in BikeCAD win over stale values we wrote earlier.
    if (p.bcad && p.bcad.some((bk) => e.has(bk))) continue;
    const val = coerce(p.kind, raw);
    if (val !== undefined) design[id] = val;
  }

  if (!design.title || design.title === PARAM_BY_ID.title.default) {
    design.title = fileName.replace(/\.bcad$/i, '');
  }

  return { design, source: doc, fileName, mappedKeys: [...mappedKeys] };
}

const SPECIAL_KEYS = new Set([
  'BSD rear',
  'BSD front',
  'Wheel diameter rear',
  'Wheel diameter front',
  'Fork style',
  'Fork type',
  'Number of cogs',
  'Number of chainrings',
  'FORK0L',
  'FORK0R',
  'FORK1L',
  'FORK1R',
  'FORK2L',
  'FORK2R',
  'DUAL_CROWN',
  'Top tube diameter',
  'Top tube front diameter',
  'Down tube diameter',
  'Down tube front diameter',
  'Wall thickness Top tube',
  'Wall thickness Down tube',
  'Wall thickness Seat tube',
  'Wall thickness Chain stay',
  'Wall thickness Seat stay',
  'Wall thickness Head tube',
  'Chain stay back diameter',
  'Seat stay bottom diameter',
  'Seat stay junction',
  'Chain stay wishbone',
  'Crank length',
  'Handlebar width',
  'HBAR type',
  'BELTorCHAIN',
  'Fit scheme',
]);

function coerce(kind: string, raw: string): ParamValue | undefined {
  switch (kind) {
    case 'num':
      return numFrom(raw);
    case 'bool':
      return raw.trim() === 'true';
    default:
      return raw;
  }
}

/** Write a design to .bcad XML, preserving every key from the source file. */
export function exportBcad(file: BikeFile, derived?: Record<string, number>): string {
  const entries = new Map<string, string>(file.source?.entries ?? []);
  const d = file.design;
  const setNum = (key: string, n: number) => entries.set(key, formatJavaNumber(n, entries.get(key)));
  // Only add keys we are unsure of to new files; for existing files, update keys that are already there.
  const setKnown = (key: string, n: number) => {
    if (!file.source || entries.has(key)) setNum(key, n);
  };

  for (const p of PARAMS) {
    const v = d[p.id];
    if (p.bcad && p.bcad.length && (!file.source || p.bcad.some((k) => entries.has(k)))) {
      const key = p.bcad.find((k) => entries.has(k)) ?? p.bcad[0];
      if (p.toBcad) entries.set(key, p.toBcad(v, d));
      else if (typeof v === 'number') setNum(key, v);
      else entries.set(key, String(v));
    }
    entries.set(NS + p.id, typeof v === 'number' ? formatJavaNumber(v) : String(v));
  }

  // Special mappings (inverse of readSpecial).
  const n = (id: string) => Number(d[id]);
  for (const side of ['rear', 'front'] as const) {
    const bsd = n(side === 'rear' ? 'rearBSD' : 'frontBSD');
    const tyre = n(side === 'rear' ? 'rearTyre' : 'frontTyre');
    setNum(`BSD ${side}`, bsd);
    setNum(`Wheel diameter ${side}`, bsd + 2 * tyre);
  }
  const style = forkIndex(entries);
  setNum(`FORK${style}L`, n('forkLength'));
  setNum(`FORK${style}R`, n('forkRake'));
  setKnown(entries.has('Top tube front diameter') && !entries.has('Top tube diameter') ? 'Top tube front diameter' : 'Top tube diameter', n('ttOD'));
  setKnown(entries.has('Down tube front diameter') ? 'Down tube front diameter' : 'Down tube diameter', n('dtOD'));
  setKnown('Wall thickness Top tube', n('ttWall'));
  setKnown('Wall thickness Down tube', n('dtWall'));
  setKnown('Wall thickness Seat tube', n('stWall'));
  setKnown('Wall thickness Chain stay', n('csWall'));
  setKnown('Wall thickness Seat stay', n('ssWall'));
  setKnown('Wall thickness Head tube', n('htWall'));
  setKnown('Chain stay back diameter', n('csODTip'));
  setKnown('Seat stay bottom diameter', n('ssODTip'));
  setKnown('Seat stay junction', n('ssSeatOffset'));
  setKnown('Crank length', n('crankLength'));
  const rings = String(d.chainrings).split(/[,;\s]+/).map(Number).filter((x) => x > 0);
  rings.forEach((t, i) => setNum(`Teeth on chainring ${i}`, t));
  const cogs = String(d.cogs).split(/[,;\s]+/).map(Number).filter((x) => x > 0);
  cogs.forEach((t, i) => setNum(`Teeth on cog ${i}`, t));
  setKnown('Handlebar width', n('barWidth'));

  // Keep derived geometry in sync so BikeCAD sees consistent values whatever
  // front-end mode it opens the file in.
  if (derived) {
    if (derived.headTubeLength != null) setNum('Head tube length textfield', derived.headTubeLength);
    if (derived.frontCenter != null) setNum('FCD textfield', derived.frontCenter);
    if (derived.stack != null && entries.has('Stack')) setNum('Stack', derived.stack);
    if (derived.reach != null && entries.has('Reach')) setNum('Reach', derived.reach);
    if (derived.ttAngle != null) setNum('Top tube angle textfield', derived.ttAngle);
  }

  return serializeProperties({ comment: file.source?.comment ?? `Created by Open Bike CAD on ${new Date().toString()}`, entries });
}

export function newBikeFile(design?: Design): BikeFile {
  return { design: design ?? defaultDesign(), source: null, fileName: 'untitled.bcad', mappedKeys: [] };
}
