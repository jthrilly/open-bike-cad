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
import { solve } from '../geometry/solve';

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

  // Fork: BikeCAD keeps several fork definitions (FORK0*, FORK1*, FORK2*), selected by "Fork type".
  // Its fork length is measured parallel to the steering axis (checked against real files:
  // stack, head angle, lower stack and this axial length reproduce the stored head tube length
  // exactly). Open Bike CAD uses the straight-line axle-to-crown length, so convert.
  const fi = forkIndex(e);
  const forkL = n(`FORK${fi}L`) ?? n('FORK0L');
  const forkR = n(`FORK${fi}R`) ?? n('FORK0R') ?? 0;
  if (forkL != null) out.forkLength = round1(forkAxialIsMeasured(e, fi) ? Math.hypot(forkL, forkR) : forkL);
  out.forkRake = forkR;
  if (e.get('DUAL_CROWN') === 'true') out.forkType = 'dualCrown';
  else if (fi === 1) out.forkType = 'suspension';
  else if (e.get('Fork straight blade') === 'true') out.forkType = 'straight';

  // Front end. "Top tube front center measure style" says what "FCD textfield" holds:
  //   3 = reach (with "Stack")  — verified against real files
  //   1 = front centre          — matches how published BikeCAD datasets interpret it
  //   0 = effective top tube, 2 = top tube c-c — best guess, not yet verified
  const style = n('Top tube front center measure style');
  const fcd = n('FCD textfield');
  if (fcd != null) {
    if (style === 3 && e.has('Stack')) {
      out.frontEndMode = 'stackReach';
      out.stack = n('Stack')!;
      out.reach = fcd;
    } else if (style === 0) {
      out.frontEndMode = 'ett';
      out.ettLength = fcd;
    } else if (style === 2) {
      out.frontEndMode = 'ttLength';
      out.ttLengthCC = fcd;
    } else {
      out.frontEndMode = 'frontCenter';
      out.frontCenter = fcd;
    }
  } else if (e.has('Head tube length textfield')) out.frontEndMode = 'reachHtl';

  // BB: style 0 = drop below axle, 1 = height above ground.
  const bbv = n('BB textfield');
  if (bbv != null && n('BB measure style') === 1) {
    const wd = n('Wheel diameter rear');
    if (wd != null) out.bbDrop = round1(wd / 2 - bbv);
  }
  // Chainstay: style 0 = centre-to-centre, 1 = horizontal.
  const csv = n('CS textfield');
  if (csv != null && n('CS measure style') === 1) {
    const drop = typeof out.bbDrop === 'number' ? out.bbDrop : bbv ?? 0;
    out.chainstayLength = round1(Math.hypot(csv, drop));
  }

  // Tube junctions: the "…extension2" values are centreline offsets (used this way by
  // published BikeCAD datasets): top tube below head tube top, down tube above head tube
  // bottom, seat tube above top tube.
  const htUp = n('Head tube upper extension2');
  if (htUp != null) out.ttHeadOffset = htUp;
  const htLow = n('Head tube lower extension2');
  if (htLow != null) out.dtHeadOffset = htLow;
  const stExt = n('Seat tube extension2');
  if (stExt != null) {
    // The stored top tube angle is not always consistent with the seat tube length, so
    // the seat tube extension defines the top tube.
    out.topTubeMode = 'extension';
    out.seatTubeExtension = stExt;
    // ST measure style 1 = seat tube length to the top tube (c-c).
    const stl = n('Seat tube length');
    if (stl != null && n('ST measure style') === 1) out.seatTubeLength = round1(stl + stExt);
  } else if (e.has('Top tube angle textfield')) out.topTubeMode = 'angle';

  // Tubes
  const ttR = n('Top tube rear diameter');
  const ttF = n('Top tube front diameter') ?? n('Top tube diameter');
  const tt = ttR != null && ttF != null ? Math.max(ttR, ttF) : ttR ?? ttF;
  if (tt != null && tt > 5) out.ttOD = tt;
  const dt = n('Down tube front diameter') ?? n('Down tube diameter');
  if (dt != null && dt > 5) out.dtOD = dt;
  const st = n('Seat tube diameter') ?? n('Seat tube diameter textfield');
  if (st != null && st > 5) {
    out.stOD = st;
    if (!e.has('Seat tube bottom diameter textfield')) out.stODBottom = st;
  }
  const ht = n('Head tube diameter');
  const htd = n('Head tube d');
  if (ht != null) {
    if (n('Head tube type') === 1 && htd != null && htd !== ht) {
      out.htProfile = 'tapered';
      out.htOD = Math.min(ht, htd);
      out.htODBottom = Math.max(ht, htd);
    } else {
      out.htProfile = 'straight';
      out.htOD = ht;
    }
  }
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
  const csV = n('Chain stay vertical diameter');
  if (csV != null && csV > 5) out.csOD = csV;
  const csBack = n('Chain stay back diameter');
  if (csBack != null) out.csODTip = csBack;
  const ssTop = n('SEATSTAY_HR');
  if (ssTop != null && ssTop > 5) out.ssOD = ssTop;
  const ssBottom = n('Seat stay bottom diameter');
  if (ssBottom != null) out.ssODTip = ssBottom;
  const ssJ = n('Seat stay junction0') ?? n('Seat stay junction');
  if (ssJ != null) out.ssSeatOffset = ssJ;
  if (e.get('Seat stay wishbone') === 'true') out.seatstayStyle = 'wishbone';
  if (e.get('Chain stay wishbone') === 'true') out.csYoke = true;

  // Shells, spacing, components
  const spacing = n('Dropout spacing');
  if (spacing != null) out.rearSpacing = spacing;
  const bbLen = n('BB length');
  if (bbLen != null) out.bbShellWidth = bbLen;
  const bbDia = n('BB diameter');
  if (bbDia != null) out.bbShellOD = bbDia;
  const thick = n('Saddle thickness');
  if (thick != null) out.saddleHeightAbove = thick;
  if (e.get('DROPPER') === 'true') out.seatpostType = 'dropper';
  const dtB = e.get('bottle DOWNTUBE0 show');
  if (dtB != null) out.dtBottles = dtB === 'true' ? 1 : 0;
  const stB = e.get('bottle SEATTUBE0 show');
  if (stB != null) out.stBottles = stB === 'true' ? 1 : 0;
  if (e.get('Front Fender include') === 'true' || e.get('Rear Fender include') === 'true') out.fenders = true;
  if (e.get('Display RACK') === 'true') out.rearRack = true;
  const mat = e.get('MATERIAL');
  if (mat) out.material = mat.charAt(0) + mat.slice(1).toLowerCase();
  const model = (e.get('MODEL_NAME') ?? '').trim();
  if (model) out.title = model;
  const hs = n('Handlebar style');
  if (hs === 0) out.barType = 'drop';
  else if (hs === 2) out.barType = 'bullhorn';

  const rings = readTeeth(e, 'chainring');
  if (rings.length) out.chainrings = rings.join(',');
  const cogs = readTeeth(e, 'cog');
  if (cogs.length) out.cogs = cogs.join(',');
  const crank = n('Crank length');
  if (crank != null) out.crankLength = crank;
  const barW = n('Handlebar width');
  if (barW != null) out.barWidth = barW;
  const bt = (e.get('HBAR type') ?? '').toLowerCase();
  if (bt && (hs == null || hs === 1)) {
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

/** BikeCAD's fork length is axial unless ForkLengthMeasurementN says otherwise. */
function forkAxialIsMeasured(e: Map<string, string>, fi: number): boolean {
  return e.get(`ForkLengthMeasurement${fi}`) !== '0';
}

/**
 * Read "Teeth on chainring N" / "Teeth on cog N" lists. "Number of …" holds the
 * index of the last one in use (0 = a single ring or cog), as seen in real files.
 */
function readTeeth(e: Map<string, string>, what: 'chainring' | 'cog'): number[] {
  const countKey = what === 'cog' ? 'Number of cogs' : 'Number of chainrings';
  const count = numFrom(e.get(countKey));
  const out: number[] = [];
  const last = count != null ? count : 19;
  for (let i = 0; i <= last; i++) {
    const t = numFrom(e.get(`Teeth on ${what} ${i}`));
    if (t == null) break;
    out.push(t);
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
  const setInt = (key: string, n: number) => entries.set(key, String(Math.round(n)));
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
  const g = solve(d);
  const num = (k: string) => numFrom(entries.get(k));
  for (const side of ['rear', 'front'] as const) {
    const bsd = n(side === 'rear' ? 'rearBSD' : 'frontBSD');
    const tyre = n(side === 'rear' ? 'rearTyre' : 'frontTyre');
    setNum(`BSD ${side}`, bsd);
    setNum(`Wheel diameter ${side}`, bsd + 2 * tyre);
  }

  // Fork (BikeCAD measures the length along the steering axis).
  const fi = forkIndex(entries);
  const rake = n('forkRake');
  const L = n('forkLength');
  setNum(`FORK${fi}L`, round1(forkAxialIsMeasured(entries, fi) ? Math.sqrt(Math.max(0, L * L - rake * rake)) : L));
  setNum(`FORK${fi}R`, rake);

  // Front end: keep the file's measure style, writing the value it expects.
  const style = num('Top tube front center measure style') ?? 3;
  if (!entries.has('Top tube front center measure style')) setInt('Top tube front center measure style', 3);
  const fcd = style === 3 ? g.dims.reach : style === 0 ? g.dims.ett : style === 2 ? g.dims.ttCC : g.dims.frontCenter;
  setNum('FCD textfield', round1(fcd));
  setNum('Stack', round1(g.dims.stack));
  setNum('Head tube length textfield', round1(g.dims.headTubeLength));
  setNum('Top tube angle textfield', round1(g.dims.ttAngle));

  // BB and chainstay in the file's measure styles.
  setNum('BB textfield', num('BB measure style') === 1 ? round1(g.dims.bbHeight) : n('bbDrop'));
  setNum('CS textfield', num('CS measure style') === 1 ? round1(g.dims.rearCenterHoriz) : n('chainstayLength'));

  // Junction offsets and seat tube.
  setNum('Head tube upper extension2', n('ttHeadOffset'));
  setNum('Head tube lower extension2', n('dtHeadOffset'));
  const stExt = n('seatTubeLength') - g.dims.stCC;
  setNum('Seat tube extension2', round1(stExt));
  setNum('Seat tube length', num('ST measure style') === 1 ? round1(g.dims.stCC) : n('seatTubeLength'));
  setNum(entries.has('Seat stay junction') && !entries.has('Seat stay junction0') ? 'Seat stay junction' : 'Seat stay junction0', n('ssSeatOffset'));

  // Tubes
  setKnown('Top tube rear diameter', n('ttOD'));
  setKnown('Top tube front diameter', n('ttOD'));
  setKnown('Top tube diameter', n('ttOD'));
  setKnown('Down tube front diameter', n('dtOD'));
  setKnown('Down tube diameter', n('dtOD'));
  setKnown('Seat tube diameter', n('stOD'));
  if (d.htProfile === 'straight') setKnown('Head tube diameter', n('htOD'));
  setKnown('Wall thickness Top tube', n('ttWall'));
  setKnown('Wall thickness Down tube', n('dtWall'));
  setKnown('Wall thickness Seat tube', n('stWall'));
  setKnown('Wall thickness Chain stay', n('csWall'));
  setKnown('Wall thickness Seat stay', n('ssWall'));
  setKnown('Wall thickness Head tube', n('htWall'));
  setKnown('Chain stay vertical diameter', n('csOD'));
  setKnown('Chain stay back diameter', n('csODTip'));
  setKnown('SEATSTAY_HR', n('ssOD'));
  setKnown('Seat stay bottom diameter', n('ssODTip'));
  setKnown('Dropout spacing', n('rearSpacing'));
  setKnown('BB length', n('bbShellWidth'));
  setKnown('BB diameter', n('bbShellOD'));
  setKnown('Saddle thickness', n('saddleHeightAbove'));
  setKnown('Crank length', n('crankLength'));
  setKnown('Handlebar width', n('barWidth'));

  // Gearing: "Number of …" is the index of the last ring/cog in use.
  const rings = String(d.chainrings).split(/[,;\s]+/).map(Number).filter((x) => x > 0);
  rings.forEach((t, i) => setInt(`Teeth on chainring ${i}`, t));
  if (rings.length) setInt('Number of chainrings', rings.length - 1);
  const cogs = String(d.cogs).split(/[,;\s]+/).map(Number).filter((x) => x > 0);
  cogs.forEach((t, i) => setInt(`Teeth on cog ${i}`, t));
  if (cogs.length) setInt('Number of cogs', cogs.length - 1);
  void derived;

  return serializeProperties({ comment: file.source?.comment ?? `Created by Open Bike CAD on ${new Date().toString()}`, entries });
}

export function newBikeFile(design?: Design): BikeFile {
  return { design: design ?? defaultDesign(), source: null, fileName: 'untitled.bcad', mappedKeys: [] };
}
