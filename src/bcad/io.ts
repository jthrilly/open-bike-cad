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
import { Design, PARAMS, PARAM_BY_ID, ParamValue, defaultDesign, numOf } from '../model/schema';
import { PropertiesDoc, parseProperties, serializeProperties } from './properties';
import { solve, Geometry } from '../geometry/solve';
import { LEGACY_PARAMS, migrateDesign } from '../model/migrate';
import { Vec, v, add, sub, mul, dot, dist, norm, perp, lineIntersect } from '../geometry/vec';

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
  const forkR = n(`FORK${fi}R`) ?? n('FORK0R');
  // A suspension fork (FORK1) is drawn and measured by BikeCAD at sag: its head tube sits
  // "Fork sag" lower along the steering axis than the full fork length would put it (checked
  // against BikeCAD's own drawings of four files). Open Bike CAD solves with the fork length as
  // given, so an imported suspension fork's length is the length at sag; the sag is added back
  // on save.
  const sag = forkSagOf(e, fi);
  if (fi === 1 && n('Fork sag') != null) out.forkSag = n('Fork sag')!;
  if (forkL != null) {
    out.forkLength = round1(forkAxialIsMeasured(e, fi) ? Math.hypot(forkL - sag, forkR ?? 0) : forkL - sag);
    out.forkRake = forkR ?? 0;
  } else if (forkR != null) out.forkRake = forkR;
  if (e.get('DUAL_CROWN') === 'true') out.forkType = 'dualCrown';
  else if (fi === 1) out.forkType = 'suspension';
  else if (e.get('Fork straight blade') === 'true') out.forkType = 'straight';

  // Front end. "Top tube front center measure style" says what "FCD textfield" holds:
  //   0 = effective top tube, with "Top tube angle textfield"; head tube length is an output
  //   1 = front centre, with "Head tube length textfield"
  //   2 = handlebar clamp X from the BB, with "Handlebar Y textfield" above the BB
  //   3 = reach, with "Stack"
  //   4 = rider compartment, 5 = BB to hands: converted to a handlebar position afterwards
  //       by riderFrontEndToBars()
  // All checked by exporting real files through BikeCAD and measuring its drawings, and
  // against its FrontTriangle code.
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
      const tta = n('Top tube angle textfield');
      if (tta != null) out.topTubeAngle = tta;
    } else if (style === 2 && e.has('Handlebar Y textfield')) {
      out.frontEndMode = 'bars';
      out.barReachTarget = fcd;
      out.barStackTarget = n('Handlebar Y textfield')!;
    } else if (style !== 4 && style !== 5) {
      out.frontEndMode = 'frontCenter';
      out.frontCenter = fcd;
    }
  } else if (e.has('Head tube length textfield')) out.frontEndMode = 'reachHtl';

  // "OFFSET_AT_BB st": the seat tube axis is moved forward of the BB centre by this much,
  // measured square to the seat tube. Our bbOffset is horizontal at BB height.
  const stOff = n('OFFSET_AT_BB st');
  const saDeg = n('Seat angle');
  if (stOff != null && saDeg != null) out.bbOffset = stOff / Math.sin((saDeg * Math.PI) / 180);

  // BB: style 0 = drop below axle, 1 = height above ground.
  const bbv = n('BB textfield');
  if (bbv != null && n('BB measure style') === 1) {
    const wd = n('Wheel diameter rear');
    if (wd != null) out.bbDrop = round1(wd / 2 - bbv);
  }
  // Chainstay: style 0 = centre-to-centre; style 1 = clearance between the rear tyre and
  // the seat tube, measured square to the seat tube. Verified by exporting real files
  // through BikeCAD and measuring where it puts the rear axle.
  const csv = n('CS textfield');
  if (csv != null && n('CS measure style') === 1) {
    const drop = typeof out.bbDrop === 'number' ? out.bbDrop : bbv ?? 0;
    const wd = n('Wheel diameter rear');
    const sa = n('Seat angle');
    if (wd != null && sa != null) {
      const x = chainstayXFromClearance(csv, wd / 2, n('Seat tube diameter textfield') ?? 28.6, sa, drop, typeof out.bbOffset === 'number' ? out.bbOffset : 0);
      out.chainstayLength = round1(Math.hypot(x, drop));
    }
  }

  // Tube junctions, as centreline offsets: top tube below head tube top, down tube above head
  // tube bottom, seat tube top above the top tube. BikeCAD stores these as the "…extension2"
  // keys; when "Display SEATTUBEEXTENSION" is true it positions the tubes from the edge-measured
  // "…extension" keys instead, which edgeExtensionsToCentreline() converts after the rest of
  // the design is known. (Checked against BikeCAD's drawings of 19 files and its FrontTriangle code.)
  const htUp = n('Head tube upper extension2');
  if (htUp != null) out.ttHeadOffset = htUp;
  const htLow = n('Head tube lower extension2');
  if (htLow != null) out.dtHeadOffset = htLow;
  const stExt = n('Seat tube extension2');
  if (stExt != null) {
    // The stored top tube angle is only an input in BikeCAD's effective-top-tube mode, so the
    // seat tube extension defines the top tube.
    out.topTubeMode = 'extension';
    out.seatTubeExtension = stExt;
    // ST measure style: 0 = "Seat tube length" is centre-to-centre (BB to top tube centreline),
    // 1 = centre-to-top. Our seat tube length is c-t.
    const stl = n('Seat tube length');
    if (stl != null) out.seatTubeLength = round1(stMeasuredCC(e) ? stl + stExt : stl);
  } else if (e.has('Top tube angle textfield')) out.topTubeMode = 'angle';

  // Tubes. "Top tube type" 0 (round) is drawn at "Top tube diameter"; the front/rear diameters
  // belong to the other types. "Down tube type" 1 (round) is drawn at "Down tube diameter";
  // type 2 tapers from "Down tube rear diameter" at the BB to "Down tube front diameter" at the
  // head tube, which we approximate with the front (head tube end) value.
  const ttType = n('Top tube type') ?? 0;
  const ttR = n('Top tube rear diameter');
  const ttF = n('Top tube front diameter') ?? n('Top tube diameter');
  const tt = ttType === 0 && n('Top tube diameter') != null ? n('Top tube diameter') : ttR != null && ttF != null ? Math.max(ttR, ttF) : ttR ?? ttF;
  if (tt != null && tt > 5) out.ttOD = tt;
  const dt = n('Down tube type') === 1 ? n('Down tube diameter') ?? n('Down tube front diameter') : n('Down tube front diameter') ?? n('Down tube diameter');
  if (dt != null && dt > 5) out.dtOD = dt;
  const st = n('Seat tube diameter') ?? n('Seat tube diameter textfield');
  if (st != null && st > 5) {
    out.stOD = st;
    if (!e.has('Seat tube bottom diameter textfield')) out.stODBottom = st;
  }
  // "Head tube type": 0 = aero, 1 = straight round tube of "Head tube diameter" ("Head tube d"
  // is ignored), 2 = a shaped tube with "Head tube diameter" at the ends and "Head tube d" at
  // the waist over lengths "Head tube A…E". Our hourglass doesn't follow that profile (it would
  // put the top and down tube junctions on too thin a tube), so type 2 is read as a straight
  // tube of its end diameter, which is what the junctions meet.
  const ht = n('Head tube diameter');
  if (ht != null) {
    out.htProfile = 'straight';
    out.htOD = ht;
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

/** Suspension fork sag BikeCAD applies to the drawn geometry (FORK1 only). */
function forkSagOf(e: Map<string, string>, fi: number): number {
  if (fi !== 1) return 0;
  const s = numFrom(e.get('Fork sag'));
  return s != null && s > 0 ? s : 0;
}

/** "ST measure style" 0 (the default) means "Seat tube length" is centre-to-centre. */
function stMeasuredCC(e: Map<string, string>): boolean {
  return numFrom(e.get('ST measure style')) !== 1;
}

/** Head tube radius at a point on its axis (matches the drawing's straight/tapered/hourglass shapes). */
function htRadiusAt(d: Design, g: Geometry, p: Vec): number {
  const top = numOf(d, 'htOD');
  if (d.htProfile !== 'tapered' && d.htProfile !== 'hourglass') return top / 2;
  const bot = numOf(d, 'htODBottom');
  const L = dist(g.htTop, g.htBottom);
  const t = L > 1e-9 ? Math.max(0, Math.min(1, dot(sub(p, g.htTop), g.steerDir) / L)) : 0;
  if (d.htProfile === 'tapered') return (top + (bot - top) * t) / 2;
  const w = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
  return (bot + (top - bot) * w) / 2;
}

/**
 * How far each centreline junction lies from the edge point BikeCAD's edge-measured extensions
 * start from, along the tube the extension runs along:
 *  st:  seat tube; edge point = top tube top edge × seat tube front edge.
 *  up:  head tube top; edge point = top tube top edge × head tube rear edge.
 *  low: head tube bottom; edge point = down tube underside × head tube rear edge.
 * "…extension2" (centreline) = "…extension" (edge) + offset.
 */
export function junctionEdgeOffsets(d: Design, g: Geometry): { st: number; up: number; low: number } {
  const s = g.seatDir;
  const u = g.steerDir;
  const back = mul(g.steerNormal, -1);
  const tt = norm(sub(g.ttFront, g.ttRear));
  const ttUp = tt.x >= 0 ? perp(tt) : mul(perp(tt), -1);
  const rT = numOf(d, 'ttOD') / 2;
  const sFront = v(s.y, -s.x);
  const P = lineIntersect(add(g.ttRear, mul(ttUp, rT)), tt, add(g.ttRear, mul(sFront, numOf(d, 'stOD') / 2)), s);
  const Q = lineIntersect(add(g.ttFront, mul(ttUp, rT)), tt, add(g.ttFront, mul(back, htRadiusAt(d, g, g.ttFront))), u);
  const dtDir = norm(sub(g.dtFront, g.dtRear));
  const dtDown = dtDir.x >= 0 ? mul(perp(dtDir), -1) : perp(dtDir);
  const R = lineIntersect(add(g.dtFront, mul(dtDown, numOf(d, 'dtOD') / 2)), dtDir, add(g.dtFront, mul(back, htRadiusAt(d, g, g.dtFront))), u);
  return {
    st: P ? dot(sub(P.point, g.ttRear), s) : 0,
    up: Q ? dot(sub(g.ttFront, Q.point), u) : 0,
    low: R ? dot(sub(R.point, g.dtFront), u) : 0,
  };
}

/**
 * "Display SEATTUBEEXTENSION" = true: BikeCAD places the junctions from the edge-measured
 * extensions. Convert them to our centreline offsets; the offsets depend on the top tube angle,
 * so iterate with the solver (converges in a few passes).
 */
function edgeExtensionsToCentreline(d: Design, e: Map<string, string>) {
  if (e.get('Display SEATTUBEEXTENSION') !== 'true') return;
  const st1 = numFrom(e.get('Seat tube extension'));
  const up1 = numFrom(e.get('Head tube upper extension'));
  const low1 = numFrom(e.get('Head tube lower extension'));
  const stl = numFrom(e.get('Seat tube length'));
  const cc = stMeasuredCC(e);
  const useSt = st1 != null && d.topTubeMode === 'extension';
  for (let i = 0; i < 30; i++) {
    const o = junctionEdgeOffsets(d, solve(d));
    let moved = 0;
    const set = (id: string, x: number) => {
      moved = Math.max(moved, Math.abs(x - numOf(d, id)));
      d[id] = x;
    };
    if (useSt) {
      set('seatTubeExtension', st1! + o.st);
      if (cc && stl != null) set('seatTubeLength', stl + numOf(d, 'seatTubeExtension'));
    }
    if (up1 != null) set('ttHeadOffset', up1 + o.up);
    if (low1 != null) set('dtHeadOffset', low1 + o.low);
    if (moved < 1e-7) break;
  }
  for (const id of ['seatTubeExtension', 'seatTubeLength', 'ttHeadOffset', 'dtHeadOffset']) d[id] = Math.round(numOf(d, id) * 100) / 100;
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
  const { design, mappedKeys } = designFromEntries(doc.entries);
  titleFromFileName(design, fileName);
  return { design, source: doc, fileName, mappedKeys };
}

function titleFromFileName(design: Design, fileName: string) {
  if (!design.title || design.title === PARAM_BY_ID.title.default) {
    design.title = fileName.replace(/\.bcad$/i, '');
  }
}

/** Key holding a fingerprint of the BikeCAD values as we last wrote them. */
const FINGERPRINT = NS + 'fingerprint';

/**
 * A short hash of every non-Open-Bike-CAD entry. If it still matches on import, nothing
 * has edited the file since we saved it, so our own keys can be trusted in full.
 */
function fingerprint(e: Map<string, string>): string {
  let h = 0x811c9dc5;
  const keys = [...e.keys()].filter((k) => !k.startsWith(NS)).sort();
  for (const k of keys) {
    const s = `${k}\u0000${e.get(k)}\u0001`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

function designFromEntries(e: Map<string, string>, upgrade = true): { design: Design; mappedKeys: string[] } {
  const design = defaultDesign();
  const mappedKeys = new Set<string>();
  /** Parameters whose value came from a BikeCAD key. */
  const fromBikeCad = new Set<string>();

  for (const p of PARAMS) {
    if (!p.bcad) continue;
    for (const key of p.bcad) {
      const raw = e.get(key);
      if (raw == null) continue;
      const val = p.fromBcad ? p.fromBcad(raw, e) : coerce(p.kind, raw);
      if (val !== undefined) {
        design[p.id] = val;
        mappedKeys.add(key);
        fromBikeCad.add(p.id);
        break;
      }
    }
  }
  const special = readSpecial(e);
  Object.assign(design, special);
  for (const id of Object.keys(special)) fromBikeCad.add(id);
  for (const k of e.keys()) if (SPECIAL_KEYS.has(k)) mappedKeys.add(k);

  // Our own namespaced keys. If the file is exactly as we saved it, they hold the design
  // in full. Otherwise BikeCAD (or a person) has edited it since, so they only fill in
  // parameters BikeCAD itself doesn't store, and BikeCAD's values win.
  const untouched = e.get(FINGERPRINT) === fingerprint(e);
  for (const [k, raw] of e) {
    if (!k.startsWith(NS)) continue;
    const id = k.slice(NS.length);
    const p = PARAM_BY_ID[id];
    if (!p) {
      // Saved by an older version: upgraded by migrateDesign below.
      if (LEGACY_PARAMS.includes(id)) design[id] = numFrom(raw) ?? 0;
      continue;
    }
    if (!untouched && fromBikeCad.has(id)) continue;
    const val = coerce(p.kind, raw);
    if (val !== undefined) design[id] = val;
  }
  if (!untouched) {
    riderFrontEndToBars(design, e);
    edgeExtensionsToCentreline(design, e);
  }
  for (const k of RIDER_FRONT_KEYS) if (e.has(k)) mappedKeys.add(k);
  // Legacy parameters of ours only count while the file is as we saved it; once BikeCAD has
  // saved it, BikeCAD's values (which never had them) are the design. `base` designs for the
  // edit-aware export skip the upgrade, so its changes are written to the BikeCAD keys.
  if (!untouched || !upgrade) for (const id of LEGACY_PARAMS) delete design[id];
  const upgraded = migrateDesign(design);
  for (const k of Object.keys(design)) if (!(k in upgraded)) delete design[k];
  Object.assign(design, upgraded);
  // BikeCAD's only beam-like style is the discontinuous seat tube. A file BikeCAD has saved
  // since, with the seat tube continuous again, is no longer a beam frame. (Mixte and
  // step-through are ours alone: BikeCAD cannot express them, so our saved style stands.)
  if (!untouched && e.get('DISCONTINUOUS') === 'false' && design.frameStyle === 'beam') design.frameStyle = 'diamond';
  return { design, mappedKeys: [...mappedKeys] };
}

const RIDER_FRONT_KEYS = ['BB to handlebar direct', 'BB to hands angle', 'Handlebar Y textfield'];

/**
 * Where BikeCAD's style 5 puts the hands: probing BikeCAD with drop bars matched the bar clamp
 * itself to within 0.2 mm (other handlebar styles move it by about 10 mm).
 */
const riderHandOffset = v(0, 0);
/** BikeCAD's saddle point for style 4. Our saddle top lands within about 3 mm of BikeCAD's. */
const saddlePointOf = (_d: Design, g: Geometry): Vec => g.saddleTop;

/**
 * Front-end styles 4 and 5 place the handlebar from the rider's contact points:
 *   4 "rider compartment": FCD is the saddle-to-handlebar distance and "BB to handlebar direct"
 *     the BB-to-handlebar distance; with the saddle height they form a triangle at the BB.
 *   5 "BB to hands": FCD is the distance from the BB to the hands at "BB to hands angle" (degrees
 *     above horizontal); the bar sits behind the hands as the handlebar dictates.
 * We read both as a handlebar position (our 'bars' mode). From BikeCAD's FrontTriangle code.
 */
function riderFrontEndToBars(d: Design, e: Map<string, string>) {
  const style = numFrom(e.get('Top tube front center measure style'));
  const fcd = numFrom(e.get('FCD textfield'));
  if (fcd == null || (style !== 4 && style !== 5)) return;
  const g = solve(d);
  let clamp: Vec | null = null;
  if (style === 4) {
    const D = numFrom(e.get('BB to handlebar direct'));
    const S = saddlePointOf(d, g);
    const H = Math.hypot(S.x, S.y);
    if (D == null || !H) return;
    const cosPhi = (D * D + H * H - fcd * fcd) / (2 * D * H);
    if (Math.abs(cosPhi) > 1) return;
    const a = Math.atan2(S.y, S.x) - Math.acos(cosPhi);
    clamp = v(D * Math.cos(a), D * Math.sin(a));
  } else {
    const ang = numFrom(e.get('BB to hands angle'));
    if (ang == null) return;
    const a = (ang * Math.PI) / 180;
    clamp = sub(v(fcd * Math.cos(a), fcd * Math.sin(a)), riderHandOffset);
  }
  d.frontEndMode = 'bars';
  d.barReachTarget = Math.round(clamp.x * 100) / 100;
  d.barStackTarget = Math.round(clamp.y * 100) / 100;
}

/** BikeCAD keys whose value depends on a measure style, written only by exportBcad's special code. */
const STYLED_KEYS = new Set(['Head tube length textfield', 'Top tube angle textfield', 'BB textfield', 'CS textfield', 'Seat tube length']);

const SPECIAL_KEYS = new Set([
  'DISCONTINUOUS',
  'Display SEATTUBEEXTENSION',
  'Seat tube extension',
  'Head tube upper extension',
  'Head tube lower extension',
  'Fork sag',
  'Top tube type',
  'Down tube type',
  'Head tube type',
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

function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

/**
 * Write a design to .bcad XML, preserving every key from the source file.
 *
 * Only values the user actually changed are written back to BikeCAD's keys: a file that is
 * opened and saved without edits keeps every BikeCAD value exactly as it was.
 */
export function exportBcad(file: BikeFile, derived?: Record<string, number>): string {
  void derived;
  const entries = new Map<string, string>(file.source?.entries ?? []);
  const d = file.design;
  // The design exactly as it was read from the source, to tell which values were edited.
  const base = file.source ? designFromEntries(file.source.entries, false).design : null;
  if (base) titleFromFileName(base, file.fileName);
  const changed = (...ids: string[]) => !base || ids.some((id) => !sameValue(d[id], base[id]));
  const g = solve(d);
  const gBase = base ? solve(base) : null;
  /** A derived dimension moved (or there is no source file to compare with). */
  const dimChanged = (k: keyof typeof g.dims) => !gBase || Math.abs(g.dims[k] - gBase.dims[k]) > 1e-6;

  const setNum = (key: string, n: number) => {
    const prev = entries.get(key);
    const prevN = numFrom(prev);
    // Keep the original spelling ("74.50", "686") when the value hasn't really moved.
    if (prev != null && prevN != null && Math.abs(prevN - n) < 1e-9) return;
    entries.set(key, formatJavaNumber(n, prev));
  };
  const setInt = (key: string, n: number) => entries.set(key, String(Math.round(n)));
  const setBool = (key: string, b: boolean) => entries.set(key, b ? 'true' : 'false');
  // Only add keys we are unsure of to new files; for existing files, update keys that are already there.
  const setKnown = (key: string, n: number) => {
    if (!file.source || entries.has(key)) setNum(key, n);
  };
  const setKnownBool = (key: string, b: boolean) => {
    if (!file.source || entries.has(key)) setBool(key, b);
  };

  for (const p of PARAMS) {
    const v = d[p.id];
    // Keys whose meaning depends on the file's measure style are written below.
    if (p.bcad?.some((k) => STYLED_KEYS.has(k))) continue;
    if (p.bcad && p.bcad.length && changed(p.id) && (!file.source || p.bcad.some((k) => entries.has(k)))) {
      const key = p.bcad.find((k) => entries.has(k)) ?? p.bcad[0];
      if (p.toBcad) entries.set(key, p.toBcad(v, d));
      else if (typeof v === 'number') setNum(key, v);
      else entries.set(key, String(v));
    }
  }

  // Special mappings (inverse of readSpecial).
  const n = (id: string) => Number(d[id]);
  const num = (k: string) => numFrom(entries.get(k));
  for (const side of ['rear', 'front'] as const) {
    const bsdId = side === 'rear' ? 'rearBSD' : 'frontBSD';
    const tyreId = side === 'rear' ? 'rearTyre' : 'frontTyre';
    if (!changed(bsdId, tyreId)) continue;
    setNum(`BSD ${side}`, n(bsdId));
    setNum(`Wheel diameter ${side}`, n(bsdId) + 2 * n(tyreId));
  }

  // Fork (BikeCAD measures the length along the steering axis).
  // A suspension fork's length is held at sag (see readSpecial): add the sag back.
  const fi = forkIndex(entries);
  const sagged = fi === 1 && (!file.source || forkSagOf(file.source.entries, 1) > 0 || entries.has('Fork sag'));
  if (changed('forkLength', 'forkRake') || (sagged && changed('forkSag'))) {
    const rake = n('forkRake');
    const L = n('forkLength');
    const sag = sagged ? Math.max(0, n('forkSag')) : 0;
    setNum(`FORK${fi}L`, round1((forkAxialIsMeasured(entries, fi) ? Math.sqrt(Math.max(0, L * L - rake * rake)) : L) + sag));
    setNum(`FORK${fi}R`, rake);
  }
  if (fi === 1 && changed('forkSag')) setNum('Fork sag', n('forkSag'));
  if (changed('forkType')) {
    setKnownBool('DUAL_CROWN', d.forkType === 'dualCrown');
    setKnownBool('Fork straight blade', d.forkType === 'straight');
  }

  // Beam frame = BikeCAD's discontinuous seat tube (BikeCAD 13+). The generic loop above only
  // updates these keys when the file has them; a file from an older BikeCAD gets them added.
  if (changed('frameStyle') && d.frameStyle === 'beam' && !entries.has('DISCONTINUOUS')) {
    setBool('DISCONTINUOUS', true);
    setNum('ST_TOP_LENGTH', n('stTopSection'));
    setNum('ST_BOTTOM_LENGTH', n('stBottomSection'));
  }

  // Front end: keep the file's measure style, writing the value it expects.
  const style = num('Top tube front center measure style') ?? 3;
  if (!entries.has('Top tube front center measure style')) setInt('Top tube front center measure style', 3);
  if (style === 4 || style === 5) {
    const barMoved = !base || !gBase || Math.hypot(g.barClamp.x - gBase.barClamp.x, g.barClamp.y - gBase.barClamp.y) > 1e-6 || changed('saddleHeight');
    if (barMoved && style === 4) {
      setNum('FCD textfield', round1(dist(saddlePointOf(d, g), g.barClamp)));
      setNum('BB to handlebar direct', round1(Math.hypot(g.barClamp.x, g.barClamp.y)));
    } else if (barMoved) {
      const h = add(g.barClamp, riderHandOffset);
      setNum('FCD textfield', round1(Math.hypot(h.x, h.y)));
      setNum('BB to hands angle', round1((Math.atan2(h.y, h.x) * 180) / Math.PI));
    }
  } else if (style === 2) {
    // Handlebar clamp position.
    const barMoved = !base || !gBase || Math.hypot(g.barClamp.x - gBase.barClamp.x, g.barClamp.y - gBase.barClamp.y) > 1e-6;
    if (barMoved) {
      setNum('FCD textfield', round1(g.barClamp.x));
      setNum('Handlebar Y textfield', round1(g.barClamp.y));
    }
  } else {
    const fcdKey = style === 3 ? 'reach' : style === 0 ? 'ett' : 'frontCenter';
    if (dimChanged(fcdKey)) setNum('FCD textfield', round1(g.dims[fcdKey]));
  }
  if (changed('bbOffset', 'seatAngle') && (entries.has('OFFSET_AT_BB st') || n('bbOffset') !== 0)) {
    setNum('OFFSET_AT_BB st', round1(n('bbOffset') * Math.sin((n('seatAngle') * Math.PI) / 180)));
  }
  if (dimChanged('stack') && (style === 3 || entries.has('Stack'))) setNum('Stack', round1(g.dims.stack));
  if (changed('headTubeLength') || dimChanged('headTubeLength')) setNum('Head tube length textfield', round1(g.dims.headTubeLength));
  if (changed('topTubeAngle') || dimChanged('ttAngle')) setNum('Top tube angle textfield', round1(g.dims.ttAngle));

  // BB and chainstay in the file's measure styles.
  if (changed('bbDrop') || dimChanged('bbHeight')) {
    setNum('BB textfield', num('BB measure style') === 1 ? round1(g.dims.bbHeight) : n('bbDrop'));
  }
  if (num('CS measure style') === 1) {
    // Clearance between the rear tyre and the seat tube.
    const clearance = (dd: Design, gg: typeof g) =>
      tyreToSeatTubeClearance(gg.rearAxle, gg.rearWheelR, Number(dd.stOD), Number(dd.seatAngle), Number(dd.bbOffset));
    const c = clearance(d, g);
    if (!base || !gBase || Math.abs(c - clearance(base, gBase)) > 1e-6) setNum('CS textfield', round1(c));
  } else if (changed('chainstayLength')) setNum('CS textfield', n('chainstayLength'));

  // Junction offsets and seat tube. Both BikeCAD key sets are written whenever a junction moves:
  // the centreline "…extension2" keys and the edge-measured "…extension" keys (which BikeCAD
  // uses instead when "Display SEATTUBEEXTENSION" is true), so the file reads the same either way.
  if (!file.source && !entries.has('ST measure style')) setInt('ST measure style', 1);
  const stCC = num('ST measure style') !== 1;
  const stExt = n('seatTubeLength') - g.dims.stCC;
  const stExtBase = base && gBase ? Number(base.seatTubeLength) - gBase.dims.stCC : NaN;
  const off = junctionEdgeOffsets(d, g);
  const offBase = base && gBase ? junctionEdgeOffsets(base, gBase) : null;
  const moved = (a: number, b: number | undefined) => b == null || !Number.isFinite(b) || Math.abs(a - b) > 1e-6;
  const setExt = (key: string, val: number, baseVal: number | undefined) => {
    if (moved(val, baseVal) && (!file.source || entries.has(key))) setNum(key, round1(val));
  };
  if (changed('ttHeadOffset')) setNum('Head tube upper extension2', n('ttHeadOffset'));
  if (changed('dtHeadOffset')) setNum('Head tube lower extension2', n('dtHeadOffset'));
  if (!base || Math.abs(stExt - stExtBase) > 1e-6) setNum('Seat tube extension2', round1(stExt));
  setExt('Head tube upper extension', n('ttHeadOffset') - off.up, base && offBase ? Number(base.ttHeadOffset) - offBase.up : undefined);
  setExt('Head tube lower extension', n('dtHeadOffset') - off.low, base && offBase ? Number(base.dtHeadOffset) - offBase.low : undefined);
  setExt('Seat tube extension', stExt - off.st, offBase ? stExtBase - offBase.st : undefined);
  if (changed('seatTubeLength') || dimChanged('stCC')) {
    // ST measure style 0 = centre-to-centre, 1 = centre-to-top.
    setNum('Seat tube length', stCC ? round1(g.dims.stCC) : n('seatTubeLength'));
  }
  if (changed('ssSeatOffset')) {
    setNum(entries.has('Seat stay junction') && !entries.has('Seat stay junction0') ? 'Seat stay junction' : 'Seat stay junction0', n('ssSeatOffset'));
  }

  // Tubes
  // Tube diameters go to the key BikeCAD draws for the file's tube type (see readSpecial).
  if (changed('ttOD')) {
    if ((num('Top tube type') ?? 0) === 0 && (!file.source || entries.has('Top tube diameter'))) setNum('Top tube diameter', n('ttOD'));
    else {
      setKnown('Top tube rear diameter', n('ttOD'));
      setKnown('Top tube front diameter', n('ttOD'));
      setKnown('Top tube diameter', n('ttOD'));
    }
  }
  if (changed('dtOD')) {
    if (num('Down tube type') === 1) setNum('Down tube diameter', n('dtOD'));
    else {
      setKnown('Down tube front diameter', n('dtOD'));
      setKnown('Down tube diameter', n('dtOD'));
    }
  }
  if (changed('stOD')) setKnown('Seat tube diameter', n('stOD'));
  // "Head tube type": 0 = aero, 1 = straight ("Head tube d" unused), 2 = ends at "Head tube
  // diameter", waist at "Head tube d" (our hourglass). BikeCAD has no plain taper, so a tapered
  // head tube is saved as a straight tube of its larger (bottom) diameter.
  if (changed('htOD', 'htODBottom', 'htProfile')) {
    if (d.htProfile === 'hourglass') {
      setNum('Head tube diameter', n('htODBottom'));
      setNum('Head tube d', n('htOD'));
      if (num('Head tube type') !== 2) setInt('Head tube type', 2);
    } else {
      setNum('Head tube diameter', d.htProfile === 'tapered' ? Math.max(n('htOD'), n('htODBottom')) : n('htOD'));
      if (!file.source || (base?.htProfile === 'hourglass' && num('Head tube type') === 2)) setInt('Head tube type', 1);
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
  const known: [string, string][] = [
    ...walls,
    ['Chain stay vertical diameter', 'csOD'],
    ['Chain stay back diameter', 'csODTip'],
    ['SEATSTAY_HR', 'ssOD'],
    ['Seat stay bottom diameter', 'ssODTip'],
    ['Dropout spacing', 'rearSpacing'],
    ['BB length', 'bbShellWidth'],
    ['BB diameter', 'bbShellOD'],
    ['Saddle thickness', 'saddleHeightAbove'],
    ['Crank length', 'crankLength'],
    ['Handlebar width', 'barWidth'],
  ];
  for (const [key, id] of known) if (changed(id)) setKnown(key, n(id));

  // Components and title-block values BikeCAD also stores.
  if (changed('title')) entries.set('MODEL_NAME', String(d.title));
  if (changed('material') && d.material) entries.set('MATERIAL', String(d.material).toUpperCase());
  if (changed('fenders')) {
    setKnownBool('Front Fender include', d.fenders === true);
    setKnownBool('Rear Fender include', d.fenders === true);
  }
  if (changed('rearRack')) setKnownBool('Display RACK', d.rearRack === true);
  if (changed('seatpostType')) setKnownBool('DROPPER', d.seatpostType === 'dropper');
  if (changed('dtBottles')) setKnownBool('bottle DOWNTUBE0 show', n('dtBottles') > 0);
  if (changed('stBottles')) setKnownBool('bottle SEATTUBE0 show', n('stBottles') > 0);
  if (changed('seatstayStyle')) setKnownBool('Seat stay wishbone', d.seatstayStyle === 'wishbone');
  if (changed('csYoke')) setKnownBool('Chain stay wishbone', d.csYoke === true);
  if (changed('driveType') && (d.driveType === 'belt' || entries.get('BELTorCHAIN') === '0')) {
    if (!file.source || entries.has('BELTorCHAIN')) entries.set('BELTorCHAIN', d.driveType === 'belt' ? '0' : '1');
  }
  if (changed('barType') && (d.barType === 'drop' || d.barType === 'bullhorn' || entries.has('Handlebar style'))) {
    setInt('Handlebar style', d.barType === 'drop' ? 0 : d.barType === 'bullhorn' ? 2 : 1);
  }

  // Gearing: "Number of …" is the index of the last ring/cog in use.
  if (changed('chainrings')) {
    const rings = String(d.chainrings).split(/[,;\s]+/).map(Number).filter((x) => x > 0);
    rings.forEach((t, i) => setInt(`Teeth on chainring ${i}`, t));
    if (rings.length) setInt('Number of chainrings', rings.length - 1);
  }
  if (changed('cogs')) {
    const cogs = String(d.cogs).split(/[,;\s]+/).map(Number).filter((x) => x > 0);
    cogs.forEach((t, i) => setInt(`Teeth on cog ${i}`, t));
    if (cogs.length) setInt('Number of cogs', cogs.length - 1);
  }

  // Our own copy of every parameter, plus a fingerprint of the BikeCAD values as written.
  for (const id of LEGACY_PARAMS) entries.delete(NS + id);
  for (const p of PARAMS) {
    const v = d[p.id];
    entries.set(NS + p.id, typeof v === 'number' ? formatJavaNumber(v) : String(v));
  }
  entries.set(FINGERPRINT, fingerprint(entries));

  return serializeProperties({ comment: file.source?.comment ?? `Created by Open Bike CAD on ${new Date().toString()}`, entries });
}

export function newBikeFile(design?: Design): BikeFile {
  return { design: design ?? defaultDesign(), source: null, fileName: 'untitled.bcad', mappedKeys: [] };
}

/**
 * CS measure style 1: the gap between the rear tyre and the seat tube surface, measured
 * square to the seat tube centreline (which passes through (bbOffset, 0) at the seat angle).
 */
export function tyreToSeatTubeClearance(axle: { x: number; y: number }, tyreR: number, stOD: number, seatAngle: number, bbOffset = 0): number {
  const a = (seatAngle * Math.PI) / 180;
  const lineX = bbOffset - axle.y / Math.tan(a);
  return Math.sin(a) * (lineX - axle.x) - tyreR - stOD / 2;
}

/** Inverse of tyreToSeatTubeClearance: the rear axle's x (behind the BB, so negative) for a given drop. */
export function chainstayXFromClearance(clearance: number, tyreR: number, stOD: number, seatAngle: number, drop: number, bbOffset = 0): number {
  const a = (seatAngle * Math.PI) / 180;
  return bbOffset - drop / Math.tan(a) - (clearance + tyreR + stOD / 2) / Math.sin(a);
}
