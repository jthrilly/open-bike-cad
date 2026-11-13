/**
 * Side-view drawing of a complete bike, as SVG elements in world coordinates
 * (converted to SVG space with sx/sy). Drive side, front to the right.
 */
import React from 'react';
import { Design, numOf, parseTeeth } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { Vec, v, add, sub, mul, norm, perp, len, dist, rad, dirDeg, angleOf, lerp, rot } from '../geometry/vec';
import { tubeOutline, svgPath, sx, sy, arcPts, pointAlong, orientedRect, polyLength, subPolyline } from '../geometry/shapes';
import { poseRider } from '../fit/rider';
import { DimensionLayer } from './DimensionLayer';
import { frameTubes, forkBladePts } from '../geometry/tubes';
import { buildAssembly, Assembly, P3 } from '../geometry/assembly';

export type PickTarget = string;

interface Props {
  d: Design;
  g: Geometry;
  ghost?: boolean;
  onPick?: (group: PickTarget) => void;
}

export { frameTubes };

/**
 * Beam frame = BikeCAD's discontinuous seat tube: only a section J (stTopSection) below the top
 * of the seat tube and a section K (stBottomSection) above the BB shell are kept. K starts where
 * the seat tube's edge meets the shell, √(R² − r²) from the BB centre along the tube (BikeCAD's
 * stChopBottom()). The bottom section is drawn from the BB centre; the shell is drawn over it.
 * Sections that meet or overlap give the whole tube. Radii follow the seat tube's taper.
 */
export function seatTubeSections(d: Design, stPts: Vec[]): { id: 'top' | 'bottom'; pts: Vec[]; r0: number; r1: number; from: number; to: number }[] {
  const L = polyLength(stPts);
  const rb = numOf(d, 'stODBottom') / 2;
  const rt = numOf(d, 'stOD') / 2;
  const R = numOf(d, 'bbShellOD') / 2;
  const shell = Math.sqrt(Math.max(0, R * R - rb * rb));
  const J = Math.max(0, numOf(d, 'stTopSection'));
  const K = Math.max(0, numOf(d, 'stBottomSection'));
  const rAt = (s: number) => rb + ((rt - rb) * s) / (L || 1);
  const sec = (id: 'top' | 'bottom', a: number, b: number) => ({ id, pts: subPolyline(stPts, a, b), r0: rAt(a), r1: rAt(b), from: a, to: b });
  const botEnd = K > 0 ? Math.min(L, shell + K) : 0;
  const topStart = J > 0 ? Math.max(0, L - J) : L;
  if (K > 0 && J > 0 && botEnd >= topStart) return [sec('bottom', 0, L)];
  const out: ReturnType<typeof sec>[] = [];
  if (K > 0) out.push(sec('bottom', 0, botEnd));
  if (J > 0) out.push(sec('top', topStart, L));
  return out;
}

export function BikeDrawing({ d, g, ghost, onPick }: Props) {
  const paint = d.showPaint !== false && !ghost;
  const sw = numOf(d, 'outlineThickness');
  const outline = ghost ? '#8a94a6' : '#1a1d23';
  const fillMain = paint ? String(d.paintMain) : 'none';
  const fillStays = paint ? String(d.paintStays) : 'none';
  const fillFork = paint ? String(d.paintFork) : 'none';
  const fillHT = paint ? String(d.paintHeadTube) : 'none';
  const fillAccent = paint ? String(d.paintAccent) : 'none';
  const comp = paint ? String(d.componentColor) : 'none';
  const tyre = paint ? String(d.tyreColor) : 'none';
  const pick = (grp: string) => (onPick ? { onClick: (e: React.MouseEvent) => (e.stopPropagation(), onPick(grp)), style: { cursor: 'pointer' } } : {});
  const { ttPts, dtPts, stPts, csPts, ssPts } = frameTubes(d, g);
  const showComp = d.showComponents !== false;
  const asm = buildAssembly(d, g);
  const frameStyle = String(d.frameStyle);

  const P = (pts: Vec[], fill: string, extra: React.SVGProps<SVGPathElement> = {}) => (
    <path d={svgPath(pts)} fill={fill} stroke={outline} strokeWidth={sw} strokeLinejoin="round" {...extra} />
  );

  const htOD = numOf(d, 'htOD');
  const htODb = d.htProfile === 'straight' ? htOD : numOf(d, 'htODBottom');
  // The head tube is the whole tube between the headset cups (as in BikeCAD).
  const htA = g.htTop;
  const htB = g.htBottom;
  let htOutline: Vec[];
  if (d.htProfile === 'hourglass') {
    const mid = lerp(htA, htB, 0.5);
    htOutline = tubeOutline([htA, mid, htB], htODb / 2, htODb / 2);
    // narrower waist
    const waist = tubeOutline([htA, mid, htB], htOD / 2, htOD / 2);
    htOutline = [htOutline[0], waist[1], htOutline[2], htOutline[3], waist[4], htOutline[5]];
  } else {
    htOutline = tubeOutline([htA, htB], htOD / 2, htODb / 2);
  }

  const ttR = (d.ttProfile === 'round' ? numOf(d, 'ttOD') : numOf(d, 'ttODMinor')) / 2;
  const dtR = numOf(d, 'dtOD') / 2;
  const stR = numOf(d, 'stOD') / 2;
  const stRb = numOf(d, 'stODBottom') / 2;

  return (
    <g className={ghost ? 'bike ghost' : 'bike'} opacity={ghost ? 0.55 : 1} fill="none">
      {/* Ground */}
      {d.showGround !== false && !ghost && (
        <line x1={sx(g.rearAxle) - g.rearWheelR - 150} x2={sx(g.frontAxle) + g.frontWheelR + 150} y1={-g.groundY} y2={-g.groundY} stroke="#9aa3b2" strokeWidth={1} strokeDasharray="12 6" />
      )}

      {/* Wheels */}
      {d.showWheels !== false && (
        <g {...pick('wheels')}>
          <Wheel d={d} c={g.rearAxle} R={g.rearWheelR} rimR={g.rearRimR} side="rear" outline={outline} tyre={tyre} sw={sw} />
          <Wheel d={d} c={g.frontAxle} R={g.frontWheelR} rimR={g.frontRimR} side="front" outline={outline} tyre={tyre} sw={sw} />
        </g>
      )}

      {showComp && (asm.fenders.rear || asm.fenders.front) && (
        <g {...pick('accessories')}>
          {[asm.fenders.rear, asm.fenders.front].map((f, i) =>
            f ? (
              <g key={i}>
                <Fender c={f.centre} R={f.radius} from={f.startDeg} to={f.endDeg} outline={outline} sw={sw} />
                <path d={svgPath(f.stays.slice(0, 1).flatMap((st) => [side(st.from), side(st.to)]), false)} stroke={outline} strokeWidth={4} fill="none" strokeLinecap="round" />
              </g>
            ) : null,
          )}
        </g>
      )}

      {showComp && d.brakeType === 'disc' && (
        <g {...pick('accessories')}>
          <circle cx={sx(g.rearAxle)} cy={sy(g.rearAxle)} r={numOf(d, 'rotorRear') / 2} stroke={outline} strokeWidth={sw * 0.8} fill="none" />
          <circle cx={sx(g.frontAxle)} cy={sy(g.frontAxle)} r={numOf(d, 'rotorFront') / 2} stroke={outline} strokeWidth={sw * 0.8} fill="none" />
        </g>
      )}

      {/* Rear rack */}
      {showComp && asm.rack && <RearRack asm={asm} outline={outline} />}
      {showComp && d.frontRack === true && <Rack axle={g.frontAxle} anchor={sub(g.crownRace, mul(g.steerDir, -20))} R={g.frontWheelR} outline={outline} sw={sw} dir={1} />}

      {/* Stays */}
      <g {...pick('rear')}>
        {frameStyle === 'mixte' && <MixteStays d={d} g={g} outline={outline} fill={fillStays} sw={sw} />}
        {P(tubeOutline(csPts, numOf(d, 'csODTip') / 2, numOf(d, 'csOD') / 2), fillStays)}
        {d.seatstayStyle === 'wishbone' ? (
          <>
            {P(tubeOutline(ssPts.slice(0, -1), numOf(d, 'ssODTip') / 2, numOf(d, 'ssOD') / 2), fillStays)}
            {P(tubeOutline(ssPts.slice(-2), numOf(d, 'ssMonoOD') / 2, numOf(d, 'ssMonoOD') / 2), fillStays)}
            <circle cx={sx(ssPts[ssPts.length - 2])} cy={sy(ssPts[ssPts.length - 2])} r={numOf(d, 'ssOD') / 2 + 1} fill={fillStays} stroke={outline} strokeWidth={sw} />
          </>
        ) : (
          P(tubeOutline(ssPts, numOf(d, 'ssODTip') / 2, numOf(d, 'ssOD') / 2), fillStays)
        )}
        {d.loopedStays === true && (
          <path
            d={svgPath(arcPts(add(g.ssTop, mul(g.seatDir, 2)), numOf(d, 'ssOD') * 0.9, angleOf(g.seatDir) - 80, angleOf(g.seatDir) + 80), false)}
            stroke={outline}
            strokeWidth={numOf(d, 'ssOD') * 0.8}
            strokeOpacity={0.6}
          />
        )}
        <Dropout d={d} g={g} outline={outline} fill={fillAccent} sw={sw} />
        <StayBridges d={d} g={g} csPts={csPts} ssPts={ssPts} outline={outline} fill={fillStays} sw={sw} />
      </g>
      {showComp && asm.ringLock && <RingLockSide asm={asm} outline={outline} sw={sw} />}
      {showComp && asm.kickstand && <KickstandSide asm={asm} outline={outline} sw={sw} />}

      {/* Main triangle */}
      <g {...pick('frame')}>
        {P(tubeOutline(dtPts, d.dtProfile === 'round' ? dtR : numOf(d, 'dtODMinor') / 2, d.dtProfile === 'round' ? dtR : numOf(d, 'dtODMinor') / 2), fillMain)}
        {frameStyle !== 'stepThrough' && P(tubeOutline(ttPts, ttR, ttR), fillMain)}
        {frameStyle === 'stepThrough' && <StepThroughTube g={g} outline={outline} fill={fillMain} sw={sw} r={ttR} />}
        {frameStyle !== 'beam' && P(tubeOutline(stPts, stRb, stR), fillMain)}
        {frameStyle === 'beam' && seatTubeSections(d, stPts).map((sec, i) => <path key={i} d={svgPath(tubeOutline(sec.pts, sec.r0, sec.r1))} fill={fillMain} stroke={outline} strokeWidth={sw} strokeLinejoin="round" />)}
        {P(htOutline, fillHT, pick('frontEnd') as never)}
        <circle cx={0} cy={0} r={numOf(d, 'bbShellOD') / 2} fill={fillAccent} stroke={outline} strokeWidth={sw} />
        {d.jointStyle === 'lugged' && <Lugs d={d} g={g} outline={outline} fill={fillAccent} sw={sw} ttPts={ttPts} dtPts={dtPts} stPts={stPts} />}
        {d.jointStyle === 'fillet' && <Fillets d={d} g={g} outline={outline} fill={fillMain} />}
        {showComp && d.cableGuides === true && <CableGuides d={d} g={g} dtPts={dtPts} outline={outline} sw={sw} />}
      </g>

      {/* Decals */}
      {d.showDecals !== false && !ghost && <Decals d={d} g={g} dtPts={dtPts} ttPts={ttPts} />}

      {/* Bottle bosses & cages */}
      {showComp && <Bottles d={d} g={g} dtPts={dtPts} stPts={stPts} outline={outline} sw={sw} onPick={pick('accessories')} />}
      {showComp && d.battery === true && <Battery d={d} dtPts={dtPts} outline={outline} sw={sw} />}
      {showComp && d.pump === true && <Pump g={g} outline={outline} sw={sw} />}

      {showComp && asm.eAssist?.motor && <HubMotorSide asm={asm} outline={outline} sw={sw} />}

      {/* Fork */}
      <g {...pick('fork')}>
        <Fork d={d} g={g} outline={outline} fill={fillFork} sw={sw} />
      </g>

      {/* Cockpit */}
      {showComp && (
        <g {...pick('cockpit')}>
          <Cockpit d={d} g={g} outline={outline} fill={comp} sw={sw} />
        </g>
      )}

      {/* Seatpost & saddle */}
      {showComp && (
        <g {...pick('saddle')}>
          <SeatpostSaddle d={d} g={g} outline={outline} fill={comp} sw={sw} />
        </g>
      )}

      {/* Drivetrain */}
      {showComp && (
        <g {...pick('drivetrain')}>
          <Drivetrain d={d} g={g} outline={outline} fill={comp} sw={sw} />
        </g>
      )}
      {showComp && asm.chainguard && (
        <g {...pick('accessories')}>
          <path d={svgPath(asm.chainguard.outline)} fill="#2b2f36" fillOpacity={0.85} stroke={outline} strokeWidth={sw} strokeLinejoin="round" />
        </g>
      )}
      {showComp && asm.carrierBlock && <CarrierBlockSide asm={asm} outline={outline} sw={sw} />}
      {showComp && asm.eAssist && <EAssistSide asm={asm} outline={outline} sw={sw} />}

      {/* Centrelines */}
      {d.showCentrelines !== false && !ghost && <Centrelines d={d} g={g} pts={[ttPts, dtPts, stPts, csPts, ssPts]} />}

      {/* Rider */}
      {d.showRider === true && <Rider d={d} g={g} ghost={ghost} />}

      {d.showDims !== false && !ghost && <DimensionLayer d={d} g={g} onPick={onPick} />}
    </g>
  );
}

// ------------------------------------------------------------------ wheels
function Wheel({ d, c, R, rimR, side, outline, tyre, sw }: { d: Design; c: Vec; R: number; rimR: number; side: 'rear' | 'front'; outline: string; tyre: string; sw: number }) {
  const detail = String(d.wheelDetail);
  const rimOuter = rimR + 3;
  const rimInner = rimR - numOf(d, 'rimDepth') + 3;
  const flange = numOf(d, side === 'rear' ? 'hubFlangeRear' : 'hubFlangeFront') / 2;
  const spokes = Math.max(0, Math.round(numOf(d, side === 'rear' ? 'spokesRear' : 'spokesFront')));
  const cross = Math.round(numOf(d, side === 'rear' ? 'crossRear' : 'crossFront'));
  const spokeLines: React.ReactNode[] = [];
  if (detail === 'spokes' && spokes > 0) {
    // Draw one flange's spokes (half the count), crossing pattern.
    const half = spokes / 2;
    for (let i = 0; i < half; i++) {
      const a = (i / half) * Math.PI * 2;
      const dirn = i % 2 === 0 ? 1 : -1;
      const hubA = a + dirn * ((cross * 2 * Math.PI) / half);
      const p1 = v(c.x + flange * Math.cos(hubA), c.y + flange * Math.sin(hubA));
      const p2 = v(c.x + rimInner * Math.cos(a), c.y + rimInner * Math.sin(a));
      spokeLines.push(<line key={i} x1={sx(p1)} y1={sy(p1)} x2={sx(p2)} y2={sy(p2)} />);
    }
  }
  const ring = (ro: number, ri: number) =>
    `M${c.x + ro} ${-c.y}A${ro} ${ro} 0 1 0 ${c.x - ro} ${-c.y}A${ro} ${ro} 0 1 0 ${c.x + ro} ${-c.y}Z` +
    `M${c.x + ri} ${-c.y}A${ri} ${ri} 0 1 1 ${c.x - ri} ${-c.y}A${ri} ${ri} 0 1 1 ${c.x + ri} ${-c.y}Z`;
  if (detail === 'outline') {
    return <circle cx={sx(c)} cy={sy(c)} r={R} stroke={outline} strokeWidth={sw} fill="none" />;
  }
  return (
    <g>
      <path d={ring(R, rimOuter)} fill={tyre} fillRule="evenodd" stroke={outline} strokeWidth={sw} />
      {detail === 'disc' ? (
        <circle cx={sx(c)} cy={sy(c)} r={rimOuter} fill="#c9ced8" stroke={outline} strokeWidth={sw} />
      ) : (
        <path d={ring(rimOuter, rimInner)} fill="#b8bec9" fillRule="evenodd" stroke={outline} strokeWidth={sw * 0.8} />
      )}
      <g stroke={outline} strokeWidth={0.6}>
        {spokeLines}
      </g>
      <circle cx={sx(c)} cy={sy(c)} r={flange} fill="#d8dce3" stroke={outline} strokeWidth={sw * 0.8} />
      <circle cx={sx(c)} cy={sy(c)} r={6} fill={outline} />
    </g>
  );
}

function Fender({ c, R, from, to, outline, sw }: { c: Vec; R: number; from: number; to: number; outline: string; sw: number }) {
  const outer = arcPts(c, R + 3, from, to, 40);
  const inner = arcPts(c, R, to, from, 40);
  return <path d={svgPath([...outer, ...inner])} fill="#555b66" stroke={outline} strokeWidth={sw * 0.6} />;
}

/** Side-view projection of a 3D point. */
const side = (p: P3): Vec => v(p[0], p[2]);

function RearRack({ asm, outline }: { asm: Assembly; outline: string }) {
  const r = asm.rack!;
  // Side view: the left-side tubes (the right side lies behind them); cross bars show as dots.
  const tubes = r.tubes.filter((t) => !t.name.startsWith('cross') && !t.name.endsWith('right'));
  return (
    <g stroke={outline} strokeWidth={r.tubeOD} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {tubes.map((t) => (
        <path key={t.name} d={svgPath(t.pts.map(side), false)} />
      ))}
      {r.tubes
        .filter((t) => t.name.startsWith('cross'))
        .map((t) => (
          <circle key={t.name} cx={t.pts[0][0]} cy={-t.pts[0][2]} r={r.tubeOD * 0.7} fill={outline} stroke="none" />
        ))}
    </g>
  );
}

function RingLockSide({ asm, outline, sw }: { asm: Assembly; outline: string; sw: number }) {
  const l = asm.ringLock!;
  const t = v(-l.radial.y, l.radial.x);
  // The U body seen from the side: it spans from just inside the tyre centre out past the tread.
  const a = add(l.centre, mul(l.radial, -l.outerR * 0.35));
  const b = add(l.centre, mul(l.radial, l.outerR));
  const h = l.bodyLength / 2;
  const pts = [add(a, mul(t, h)), add(b, mul(t, h)), add(b, mul(t, -h)), add(a, mul(t, -h))];
  return <path d={svgPath(pts)} fill="#2b2f36" stroke={outline} strokeWidth={sw} />;
}

function KickstandSide({ asm, outline, sw }: { asm: Assembly; outline: string; sw: number }) {
  const k = asm.kickstand!;
  const c = side(k.plate.centre);
  return (
    <g>
      <path d={svgPath(orientedRect(v(c.x - k.plate.length / 2, c.y), v(1, 0), k.plate.length, 8))} fill="#2b2f36" stroke={outline} strokeWidth={sw * 0.7} />
      <path d={svgPath([side(k.pivot), side(k.feet[0])], false)} stroke="#2b2f36" strokeWidth={10} strokeLinecap="round" fill="none" />
    </g>
  );
}

function HubMotorSide({ asm, outline, sw }: { asm: Assembly; outline: string; sw: number }) {
  const m = asm.eAssist!.motor!;
  const c = side(m.axle);
  return (
    <g>
      <circle cx={sx(c)} cy={sy(c)} r={m.shellDia / 2} fill="#2b2f36" stroke={outline} strokeWidth={sw} />
      <circle cx={sx(c)} cy={sy(c)} r={m.shellDia / 2 - 12} fill="none" stroke="#8a9099" strokeWidth={sw * 0.7} />
      <circle cx={sx(c)} cy={sy(c)} r={9} fill="#8a9099" stroke={outline} strokeWidth={sw * 0.7} />
    </g>
  );
}

function EAssistSide({ asm, outline, sw }: { asm: Assembly; outline: string; sw: number }) {
  const e = asm.eAssist!;
  const f = e.forward;
  const up = e.up;
  const box = (b: { centre: [number, number, number]; depth: number; height: number }) => {
    const c = side(b.centre);
    const hd = mul(f, b.depth / 2);
    const hh = mul(up, b.height / 2);
    return [add(add(c, hd), hh), add(sub(c, hd), hh), sub(sub(c, hd), hh), sub(add(c, hd), hh)];
  };
  const b = e.battery;
  return (
    <g>
      {e.wiring.map((w, i) => (
        <path key={i} d={svgPath(w.pts.map(side), false)} fill="none" stroke="#111" strokeWidth={Math.max(w.od * 0.6, sw)} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
      ))}
      {b && (
        <g>
          <path d={svgPath(box(b.cradle))} fill="#8a9099" fillOpacity={0.35} stroke={outline} strokeWidth={sw * 0.8} />
          <path d={svgPath(box(b.base))} fill="#5c636e" stroke={outline} strokeWidth={sw * 0.7} />
          <path d={svgPath(box(b.controller))} fill="#5c636e" stroke={outline} strokeWidth={sw * 0.7} />
          <path d={svgPath(box(b.pack))} fill="#3d4450" stroke={outline} strokeWidth={sw} />
          <path d={svgPath([side(b.brace.boss), side(b.brace.from)], false)} stroke="#8a9099" strokeWidth={8} strokeLinecap="round" fill="none" />
          <circle cx={sx(side(b.brace.boss))} cy={sy(side(b.brace.boss))} r={5} fill="#c9ccd1" stroke={outline} strokeWidth={sw * 0.6} />
          <circle cx={sx(side(b.headlight))} cy={sy(side(b.headlight))} r={14} fill="#f2e6a0" stroke={outline} strokeWidth={sw * 0.7} />
        </g>
      )}
    </g>
  );
}

function CarrierBlockSide({ asm, outline, sw }: { asm: Assembly; outline: string; sw: number }) {
  const cb = asm.carrierBlock!;
  const f = cb.forward;
  const up = cb.up;
  const box = (c: Vec, depth: number, height: number) => {
    const hd = mul(f, depth / 2);
    const hh = mul(up, height / 2);
    return [add(add(c, hd), hh), add(sub(c, hd), hh), sub(sub(c, hd), hh), sub(add(c, hd), hh)];
  };
  return (
    <g>
      <path d={svgPath(box(side(cb.mountBlock.centre), cb.mountBlock.depth, cb.mountBlock.alongHT))} fill="#8a9099" stroke={outline} strokeWidth={sw * 0.8} />
      <path d={svgPath(box(side(cb.block.centre), cb.block.depth, cb.block.height))} fill="#2b2f36" stroke={outline} strokeWidth={sw} />
    </g>
  );
}

function Rack({ axle, anchor, R, outline, sw, dir }: { axle: Vec; anchor: Vec; R: number; outline: string; sw: number; dir: 1 | -1 }) {
  const topY = axle.y + R + 40;
  const back = v(axle.x + dir * (R * 0.4), topY);
  const front = v(axle.x - dir * R * 0.55, topY);
  const strut = v(anchor.x, Math.min(anchor.y, topY));
  return (
    <g stroke={outline} strokeWidth={sw * 2} fill="none" strokeLinecap="round">
      <path d={svgPath([axle, back, front], false)} />
      <path d={svgPath([front, strut], false)} />
      <path d={svgPath([lerp(axle, back, 0.5), lerp(back, front, 0.6)], false)} />
    </g>
  );
}

// ------------------------------------------------------------------- stays
function Dropout({ d, g, outline, fill, sw }: { d: Design; g: Geometry; outline: string; fill: string; sw: number }) {
  const size = numOf(d, 'dropoutSize');
  const style = String(d.dropoutStyle);
  const c = g.rearAxle;
  const toCs = norm(sub(g.bb, c));
  const toSs = norm(sub(g.ssTop, c));
  const csEnd = add(c, mul(toCs, numOf(d, 'csDropoutOffset')));
  const ssEnd = add(c, mul(toSs, numOf(d, 'ssDropoutOffset')));
  const r = size * 0.35;
  // Plate: hull of axle circle and the two stay ends.
  const pts = [
    ...arcPts(c, r, angleOf(toSs) + 90, angleOf(toCs) + 270 + (angleOf(toCs) < angleOf(toSs) ? 360 : 0), 18),
    add(csEnd, mul(perp(toCs), -numOf(d, 'csODTip') / 2 - 2)),
    add(csEnd, mul(perp(toCs), numOf(d, 'csODTip') / 2 + 2)),
    add(ssEnd, mul(perp(toSs), -numOf(d, 'ssODTip') / 2 - 2)),
    add(ssEnd, mul(perp(toSs), numOf(d, 'ssODTip') / 2 + 2)),
  ];
  const slotA = rad(numOf(d, 'dropoutSlotAngle'));
  const slotLen = numOf(d, 'dropoutSlotLength');
  let slot: Vec[] = [];
  if (style === 'horizontal' || style === 'sliding') slot = orientedRect(sub(c, v(slotLen * 0.3 * Math.cos(slotA), slotLen * 0.3 * Math.sin(slotA))), v(-Math.cos(slotA), -Math.sin(slotA)), slotLen, 10);
  else if (style === 'track') slot = orientedRect(sub(c, v(-slotLen * 0.3, 0)), rot(v(-1, 0), slotA), slotLen, 10);
  else if (style === 'vertical') slot = orientedRect(c, v(0.2, -1), size * 0.45, 10);
  return (
    <g>
      <path d={svgPath(convexHull(pts))} fill={fill} stroke={outline} strokeWidth={sw} />
      {slot.length > 0 && <path d={svgPath(slot)} fill="#fff" stroke={outline} strokeWidth={sw * 0.7} />}
      {style === 'thru' && <circle cx={sx(c)} cy={sy(c)} r={7.5} fill="#fff" stroke={outline} strokeWidth={sw * 0.7} />}
      {style === 'hooded' && <circle cx={sx(c)} cy={sy(c)} r={r * 0.85} fill="none" stroke={outline} strokeWidth={sw * 0.7} />}
    </g>
  );
}

export function convexHull(points: Vec[]): Vec[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const crossO = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossO(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossO(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function StayBridges({ d, g, csPts, ssPts, outline, fill, sw }: { d: Design; g: Geometry; csPts: Vec[]; ssPts: Vec[]; outline: string; fill: string; sw: number }) {
  void g;
  const csTotal = polyLen(csPts);
  const cb = pointAlong(csPts, csTotal - numOf(d, 'csBridgePos'));
  const ssTotal = polyLen(ssPts);
  const sb = pointAlong(ssPts, ssTotal - numOf(d, 'ssBridgePos'));
  return (
    <g>
      <circle cx={sx(cb.p)} cy={sy(cb.p)} r={numOf(d, 'csOD') * 0.35} fill={fill} stroke={outline} strokeWidth={sw * 0.7} />
      <circle cx={sx(sb.p)} cy={sy(sb.p)} r={numOf(d, 'ssOD') * 0.4} fill={fill} stroke={outline} strokeWidth={sw * 0.7} />
    </g>
  );
}

function polyLen(pts: Vec[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i], pts[i - 1]);
  return l;
}

function MixteStays({ d, g, outline, fill, sw }: { d: Design; g: Geometry; outline: string; fill: string; sw: number }) {
  // Twin lateral stays from the head tube, past the seat tube, to the dropouts.
  const start = g.ttFront;
  const via = add(lerp(g.ttRear, g.stBottom, 0.35), mul(norm(sub(g.rearAxle, g.ttFront)), numOf(d, 'mixteRearOffset')));
  const r = numOf(d, 'ssOD') / 2;
  return <path d={svgPath(tubeOutline([start, via, g.rearAxle], r, numOf(d, 'ssODTip') / 2))} fill={fill} stroke={outline} strokeWidth={sw} />;
}

function StepThroughTube({ g, outline, fill, sw, r }: { g: Geometry; outline: string; fill: string; sw: number; r: number }) {
  const low = lerp(g.stBottom, g.ttRear, 0.35);
  const ctrl = v(g.dtFront.x - 120, low.y + 40);
  const pts: Vec[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const mt = 1 - t;
    pts.push(v(mt * mt * g.ttFront.x + 2 * mt * t * ctrl.x + t * t * low.x, mt * mt * g.ttFront.y + 2 * mt * t * ctrl.y + t * t * low.y));
  }
  return <path d={svgPath(tubeOutline(pts, r, r))} fill={fill} stroke={outline} strokeWidth={sw} />;
}

// ----------------------------------------------------------------- joints
function Lugs({ d, g, outline, fill, sw, ttPts, dtPts, stPts }: { d: Design; g: Geometry; outline: string; fill: string; sw: number; ttPts: Vec[]; dtPts: Vec[]; stPts: Vec[] }) {
  const pl = numOf(d, 'lugPointLength');
  const sleeve = (at: Vec, dir: Vec, r: number) => {
    const u = norm(dir);
    const n = perp(u);
    const base1 = add(at, mul(n, r + 1.5));
    const base2 = sub(at, mul(n, r + 1.5));
    const tip = add(at, mul(u, pl));
    const shoulder1 = add(base1, mul(u, pl * 0.35));
    const shoulder2 = add(base2, mul(u, pl * 0.35));
    return [base1, shoulder1, tip, shoulder2, base2];
  };
  const htR = numOf(d, 'htOD') / 2;
  const lug = (pts: Vec[], k: number) => <path key={k} d={svgPath(pts)} fill={fill} stroke={outline} strokeWidth={sw * 0.8} />;
  const tt0 = ttPts[ttPts.length - 1];
  const ttDir = sub(ttPts[ttPts.length - 2], tt0);
  const ttBack = sub(ttPts[1], ttPts[0]);
  const dtF = dtPts[dtPts.length - 1];
  const dtDir = sub(dtPts[dtPts.length - 2], dtF);
  const stTopDir = sub(stPts[stPts.length - 2], stPts[stPts.length - 1]);
  return (
    <g>
      {lug(sleeve(add(tt0, mul(norm(ttDir), htR)), ttDir, numOf(d, 'ttOD') / 2), 1)}
      {lug(sleeve(add(dtF, mul(norm(dtDir), htR)), dtDir, numOf(d, 'dtOD') / 2), 2)}
      {lug(sleeve(add(ttPts[0], mul(norm(ttBack), numOf(d, 'stOD') / 2)), ttBack, numOf(d, 'ttOD') / 2), 3)}
      {lug(sleeve(add(g.ttRear, mul(norm(stTopDir), -10)), stTopDir, numOf(d, 'stOD') / 2), 4)}
      {lug(sleeve(add(g.htTop, mul(g.steerDir, 18)), g.steerDir, htR), 5)}
      {lug(sleeve(sub(g.htBottom, mul(g.steerDir, 18)), mul(g.steerDir, -1), htR), 6)}
      {lug(sleeve(v(0, 0), sub(dtPts[1], dtPts[0]), numOf(d, 'dtOD') / 2), 7)}
      {lug(sleeve(v(0, 0), sub(stPts[1], stPts[0]), numOf(d, 'stODBottom') / 2), 8)}
    </g>
  );
}

function Fillets({ d, g, outline, fill }: { d: Design; g: Geometry; outline: string; fill: string }) {
  const r = numOf(d, 'filletRadius');
  const pts = [g.ttFront, g.dtFront, g.ttRear, g.bb, g.ssTop];
  return (
    <g opacity={0.9}>
      {pts.map((p, i) => (
        <circle key={i} cx={sx(p)} cy={sy(p)} r={r + numOf(d, 'ttOD') / 2} fill={fill} stroke={outline} strokeWidth={0.5} strokeDasharray="2 2" />
      ))}
    </g>
  );
}

function CableGuides({ d, g, dtPts, outline, sw }: { d: Design; g: Geometry; dtPts: Vec[]; outline: string; sw: number }) {
  void g;
  const total = polyLen(dtPts);
  const r = numOf(d, 'dtOD') / 2;
  return (
    <g>
      {[0.25, 0.78].map((t, i) => {
        const { p, t: tan } = pointAlong(dtPts, total * t);
        const q = add(p, mul(perp(tan), -r - 2));
        return <rect key={i} x={sx(q) - 6} y={sy(q) - 2} width={12} height={4} fill="#444" stroke={outline} strokeWidth={sw * 0.5} />;
      })}
    </g>
  );
}

// ------------------------------------------------------------------ decals
function Decals({ d, g, dtPts, ttPts }: { d: Design; g: Geometry; dtPts: Vec[]; ttPts: Vec[] }) {
  const items: React.ReactNode[] = [];
  const along = (pts: Vec[], text: string, size: number, key: string) => {
    if (!text) return;
    const total = polyLen(pts);
    const mid = pointAlong(pts, total * 0.5);
    let a = -angleOf(mid.t);
    if (a > 90) a -= 180;
    if (a < -90) a += 180;
    items.push(
      <text
        key={key}
        x={sx(mid.p)}
        y={sy(mid.p) + size * 0.35}
        transform={`rotate(${a} ${sx(mid.p)} ${sy(mid.p)})`}
        fill={String(d.decalColor)}
        fontFamily={String(d.decalFont)}
        fontWeight={800}
        fontSize={size}
        textAnchor="middle"
        letterSpacing={size * 0.08}
        style={{ pointerEvents: 'none' }}
      >
        {text}
      </text>,
    );
  };
  along(dtPts, String(d.decalText), numOf(d, 'dtOD') * 0.62, 'dt');
  along(ttPts, String(d.ttDecal), numOf(d, 'ttOD') * 0.55, 'tt');
  if (d.headBadge) {
    const mid = lerp(g.htTop, g.htBottom, 0.4);
    items.push(
      <text key="hb" x={sx(mid)} y={sy(mid)} fill={String(d.decalColor)} fontSize={numOf(d, 'htOD') * 0.45} textAnchor="middle" fontWeight={700} transform={`rotate(${90 - numOf(d, 'headAngle')} ${sx(mid)} ${sy(mid)})`}>
        {String(d.headBadge)}
      </text>,
    );
  }
  return <g>{items}</g>;
}

// ----------------------------------------------------------------- bottles
function Bottles({ d, g, dtPts, stPts, outline, sw, onPick }: { d: Design; g: Geometry; dtPts: Vec[]; stPts: Vec[]; outline: string; sw: number; onPick: object }) {
  void g;
  const out: React.ReactNode[] = [];
  const spacing = numOf(d, 'bossSpacing');
  const place = (pts: Vec[], start: number, count: number, side: 1 | -1, r: number, key: string) => {
    for (let i = 0; i < count; i++) {
      const s = start + i * 190;
      const b1 = pointAlong(pts, s);
      const b2 = pointAlong(pts, s + spacing);
      const nrm = mul(perp(b1.t), side * (r + 1));
      const p1 = add(b1.p, nrm);
      const p2 = add(b2.p, nrm);
      out.push(<circle key={`${key}b${i}a`} cx={sx(p1)} cy={sy(p1)} r={3} fill={outline} />);
      out.push(<circle key={`${key}b${i}b`} cx={sx(p2)} cy={sy(p2)} r={3} fill={outline} />);
      // Bottle outline: 74 mm dia, 230 mm long, centred on the bosses.
      const mid = lerp(b1.p, b2.p, 0.5);
      const c = add(mid, mul(perp(b1.t), side * (r + 8 + 37)));
      const body = orientedRect(sub(c, mul(b1.t, 115)), b1.t, 230, 74);
      out.push(<path key={`${key}c${i}`} d={svgPath(body)} fill="#e6eef8" fillOpacity={0.6} stroke={outline} strokeWidth={sw * 0.6} />);
    }
  };
  place(dtPts, numOf(d, 'dtBossFromBB'), Math.round(numOf(d, 'dtBottles')), 1, numOf(d, 'dtOD') / 2, 'dt');
  // Seat tube cage sits in front of the seat tube (rotate side).
  place(stPts, numOf(d, 'stBossFromBB'), Math.round(numOf(d, 'stBottles')), -1, numOf(d, 'stOD') / 2, 'st');
  return <g {...onPick}>{out}</g>;
}

function Battery({ d, dtPts, outline, sw }: { d: Design; dtPts: Vec[]; outline: string; sw: number }) {
  const s = pointAlong(dtPts, 120);
  const c = add(s.p, mul(perp(s.t), numOf(d, 'dtOD') / 2 + 45));
  return <path d={svgPath(orientedRect(c, s.t, numOf(d, 'batteryLength'), 80))} fill="#3d4450" stroke={outline} strokeWidth={sw} />;
}

function Pump({ g, outline, sw }: { g: Geometry; outline: string; sw: number }) {
  const a = lerp(g.stBottom, g.ttRear, 0.15);
  const b = lerp(g.stBottom, g.ttRear, 0.85);
  const off = mul(perp(norm(sub(b, a))), 30);
  return <path d={svgPath(tubeOutline([add(a, off), add(b, off)], 12, 12))} fill="#c0c6d0" stroke={outline} strokeWidth={sw * 0.7} />;
}

// -------------------------------------------------------------------- fork
function Fork({ d, g, outline, fill, sw }: { d: Design; g: Geometry; outline: string; fill: string; sw: number }) {
  const u = g.steerDir;
  const n = g.steerNormal;
  const crownH = numOf(d, 'forkCrownHeight');
  const crownW = numOf(d, 'forkCrownWidth');
  const crownTop = g.crownRace;
  const crownBot = add(crownTop, mul(u, crownH));
  const crown = [add(crownTop, mul(n, -crownW / 2)), add(crownTop, mul(n, crownW / 2)), add(crownBot, mul(n, crownW / 2 + 4)), add(crownBot, mul(n, -crownW / 2 + 2))];
  const bladeR = numOf(d, 'forkBladeDia') / 2;
  const type = String(d.forkType);
  const parts: React.ReactNode[] = [];
  const axle = g.frontAxle;

  if (type === 'suspension' || type === 'dualCrown' || type === 'lefty') {
    const stanR = numOf(d, 'forkStanchionDia') / 2;
    // Lowers run from axle up parallel to steering axis (offset by rake).
    const lowerLen = Math.min(260, dist(axle, crownBot) * 0.6);
    const lowerTop = sub(axle, mul(u, lowerLen));
    const stTop = type === 'dualCrown' ? sub(g.htTop, mul(u, 10)) : crownBot;
    parts.push(<path key="stan" d={svgPath(tubeOutline([add(stTop, mul(n, numOf(d, 'forkRake'))), lowerTop], stanR, stanR))} fill="#d9dde3" stroke={outline} strokeWidth={sw} />);
    parts.push(<path key="low" d={svgPath(tubeOutline([sub(lowerTop, mul(u, 0)), add(axle, mul(u, 25))], stanR + 5, stanR + 3))} fill={fill} stroke={outline} strokeWidth={sw} />);
    if (type === 'dualCrown') {
      const top = sub(g.htTop, mul(u, 10));
      parts.push(<path key="tc" d={svgPath([add(top, mul(n, -crownW / 2)), add(top, mul(n, crownW / 2 + numOf(d, 'forkRake'))), add(add(top, mul(u, crownH)), mul(n, crownW / 2 + numOf(d, 'forkRake'))), add(add(top, mul(u, crownH)), mul(n, -crownW / 2))])} fill={fill} stroke={outline} strokeWidth={sw} />);
    }
  } else if (type === 'straight') {
    const start = add(crownBot, mul(n, numOf(d, 'forkRake') * 0.15));
    parts.push(<path key="blade" d={svgPath(tubeOutline([start, axle], bladeR + 2, bladeR * 0.6))} fill={fill} stroke={outline} strokeWidth={sw} />);
  } else {
    // Curved blade: straight along steering axis, then a tangent bend to the axle.
    const pts = forkBladePts(d, g);
    parts.push(<path key="blade" d={svgPath(tubeOutline(pts, bladeR + 1, bladeR * 0.55))} fill={fill} stroke={outline} strokeWidth={sw} />);
  }
  // Fork tip
  parts.push(<circle key="tip" cx={sx(axle)} cy={sy(axle)} r={11} fill={fill} stroke={outline} strokeWidth={sw} />);
  return (
    <g>
      {parts}
      <path d={svgPath(crown)} fill={fill} stroke={outline} strokeWidth={sw} />
    </g>
  );
}

// ----------------------------------------------------------------- cockpit
function Cockpit({ d, g, outline, fill, sw }: { d: Design; g: Geometry; outline: string; fill: string; sw: number }) {
  const u = g.steerDir;
  const n = g.steerNormal;
  const up = mul(u, -1);
  const htR = numOf(d, 'htOD') / 2;
  const steerR = numOf(d, 'steererDia') / 2;
  const upper = numOf(d, 'upperStack');
  const lower = numOf(d, 'lowerStack');
  const spacers = numOf(d, 'spacers');
  const clampH = numOf(d, 'stemClampHeight');
  const rectAlong = (start: Vec, length: number, w: number) => orientedRect(start, up, length, w);
  const parts: React.ReactNode[] = [];
  parts.push(<path key="ucup" d={svgPath(rectAlong(g.htTop, upper, htR * 2 + 4))} fill={fill} stroke={outline} strokeWidth={sw * 0.8} />);
  parts.push(<path key="lcup" d={svgPath(orientedRect(g.htBottom, u, lower, htR * 2 + 4))} fill={fill} stroke={outline} strokeWidth={sw * 0.8} />);
  const spStart = add(g.htTop, mul(up, upper));
  if (d.stemKind !== 'quill' && spacers > 0) {
    const n5 = Math.max(1, Math.round(spacers / 10));
    for (let i = 0; i < n5; i++) {
      parts.push(<path key={`sp${i}`} d={svgPath(rectAlong(add(spStart, mul(up, (i * spacers) / n5)), spacers / n5, steerR * 2 + 6))} fill="#9aa1ad" stroke={outline} strokeWidth={sw * 0.6} />);
    }
  }
  const stemDir = norm(sub(g.barClamp, g.stemPivot));
  const barDia = numOf(d, 'barDia');
  if (d.stemKind === 'quill') {
    parts.push(<path key="quill" d={svgPath(orientedRect(spStart, up, dist(spStart, g.stemPivot) + 12, steerR * 1.6))} fill={fill} stroke={outline} strokeWidth={sw} />);
    parts.push(<path key="stem" d={svgPath(orientedRect(g.stemPivot, stemDir, dist(g.stemPivot, g.barClamp), 22))} fill={fill} stroke={outline} strokeWidth={sw} />);
  } else {
    const clampStart = add(spStart, mul(up, spacers));
    parts.push(<path key="clamp" d={svgPath(rectAlong(clampStart, clampH, steerR * 2 + 10))} fill={fill} stroke={outline} strokeWidth={sw} />);
    parts.push(<path key="stem" d={svgPath(tubeOutline([g.stemPivot, g.barClamp], 14, 13))} fill={fill} stroke={outline} strokeWidth={sw} />);
    parts.push(<path key="cap" d={svgPath(rectAlong(add(clampStart, mul(up, clampH)), 4, steerR * 2 + 4))} fill={fill} stroke={outline} strokeWidth={sw * 0.6} />);
  }
  parts.push(<circle key="bc" cx={sx(g.barClamp)} cy={sy(g.barClamp)} r={barDia / 2 + 3} fill={fill} stroke={outline} strokeWidth={sw} />);

  // Handlebar profile
  const c = g.barClamp;
  const reach = numOf(d, 'barReach');
  const drop = numOf(d, 'barDrop');
  const roll = rad(numOf(d, 'barRoll'));
  const R = (p: Vec) => add(c, rot(sub(p, c), roll));
  let barPts: Vec[] = [];
  const type = String(d.barType);
  if (type === 'drop') {
    barPts = [c, v(c.x + reach * 0.6, c.y), ...arcPts(v(c.x + reach - 35, c.y - 35), 35, 90, -10, 8), v(c.x + reach + 2, c.y - drop * 0.5), ...arcPts(v(c.x + reach - 45, c.y - drop + 45), 45, 0, -110, 8), v(c.x + reach - 105, c.y - drop - 10)];
  } else if (type === 'bullhorn') {
    barPts = [c, v(c.x + reach, c.y), ...arcPts(v(c.x + reach, c.y + 40), 40, -90, 0, 8), v(c.x + reach + 50, c.y + 60)];
  } else if (type === 'riser') {
    barPts = [c, v(c.x + 10, c.y + numOf(d, 'barRise') * 0.8), v(c.x - 10, c.y + numOf(d, 'barRise'))];
  } else if (type === 'sweptBack') {
    barPts = [c, v(c.x + 20, c.y + numOf(d, 'barRise')), v(c.x - reach - 80, c.y + numOf(d, 'barRise') + 10)];
  } else if (type === 'aero') {
    barPts = [c, v(c.x + 250, c.y + 60), v(c.x + 290, c.y + 85)];
  } else {
    barPts = [v(c.x - 10, c.y), v(c.x + 10, c.y)];
  }
  barPts = barPts.map(R);
  parts.push(<path key="bar" d={svgPath(barPts, false)} stroke={outline} strokeWidth={barDia * 0.75 + sw * 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />);
  parts.push(<path key="bar2" d={svgPath(barPts, false)} stroke={fill === 'none' ? '#fff' : fill} strokeWidth={barDia * 0.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />);
  if (type === 'aero') {
    // Base bar too
    parts.push(<circle key="pad" cx={sx(c) + 120} cy={sy(c) - 45} r={12} fill="#333" />);
  }
  // Levers
  if (d.leverStyle === 'brifter' && type === 'drop') {
    const base = R(v(c.x + reach - 5, c.y - 5));
    const body = [base, R(v(c.x + reach + 40, c.y + 25)), R(v(c.x + reach + 45, c.y + 10)), R(v(c.x + reach + 20, c.y - 60)), R(v(c.x + reach + 10, c.y - 90)), R(v(c.x + reach, c.y - 30))];
    parts.push(<path key="lever" d={svgPath(body)} fill="#2b2f36" stroke={outline} strokeWidth={sw * 0.7} />);
  } else if (d.leverStyle === 'flat' || (d.leverStyle === 'brifter' && type !== 'drop')) {
    const end = barPts[barPts.length - 1];
    parts.push(<path key="lever" d={svgPath(orientedRect(end, v(1, -0.3), 70, 10))} fill="#2b2f36" stroke={outline} strokeWidth={sw * 0.7} />);
  }
  void n;
  return <g>{parts}</g>;
}

// --------------------------------------------------------- seatpost/saddle
function SeatpostSaddle({ d, g, outline, fill, sw }: { d: Design; g: Geometry; outline: string; fill: string; sw: number }) {
  const r = numOf(d, 'seatpostDia') / 2;
  const s = g.seatDir;
  const insert = numOf(d, 'minPostInsertion');
  const postBottom = sub(g.stTop, mul(s, insert));
  const parts: React.ReactNode[] = [];
  if (d.seatpostType === 'integrated') {
    parts.push(<path key="mast" d={svgPath(tubeOutline([g.stTop, g.seatpostTop], r + 2, r + 2))} fill={String(d.paintMain)} stroke={outline} strokeWidth={sw} />);
  } else {
    // Exposed post (bent toward setback head)
    const head = g.saddleClamp;
    const lower = g.seatpostTop;
    parts.push(<path key="post" d={svgPath(tubeOutline([postBottom, g.stTop, lower, head], r, r))} fill={fill === 'none' ? 'none' : '#a7aeb9'} stroke={outline} strokeWidth={sw} strokeDasharray={undefined} />);
    if (d.seatpostType === 'dropper') {
      const c = lerp(g.stTop, lower, 0.35);
      parts.push(<path key="collar" d={svgPath(orientedRect(c, s, 25, r * 2 + 6))} fill="#222" stroke={outline} strokeWidth={sw * 0.6} />);
    }
  }
  // Seat clamp collar
  parts.push(<path key="sc" d={svgPath(orientedRect(sub(g.stTop, mul(s, 18)), s, 18, numOf(d, 'stOD') + 6))} fill="#666" stroke={outline} strokeWidth={sw * 0.6} />);
  // Saddle: wedge shape, nose at front.
  const L = numOf(d, 'saddleLength');
  const tilt = rad(numOf(d, 'saddleAngle'));
  const top = g.saddleTop;
  const dir = v(Math.cos(tilt), Math.sin(tilt));
  const back = sub(top, mul(dir, L * 0.42));
  const nose = add(top, mul(dir, L * 0.58));
  const dn = perp(dir);
  const shell = [
    add(back, mul(dn, 8)),
    ...arcPts(add(back, mul(dn, -14)), 22, angleOf(dir) + 90, angleOf(dir) + 210, 6),
    add(lerp(back, nose, 0.4), mul(dn, -32)),
    add(nose, mul(dn, -16)),
    add(nose, mul(dn, 2)),
    add(lerp(back, nose, 0.55), mul(dn, 3)),
    add(lerp(back, nose, 0.2), mul(dn, 10)),
  ];
  parts.push(<path key="saddle" d={svgPath(shell)} fill={fill === 'none' ? 'none' : '#222'} stroke={outline} strokeWidth={sw} />);
  parts.push(<line key="rail" x1={sx(add(back, mul(dn, -35)))} y1={sy(add(back, mul(dn, -35)))} x2={sx(add(nose, mul(dn, -25)))} y2={sy(add(nose, mul(dn, -25)))} stroke={outline} strokeWidth={3} />);
  return <g>{parts}</g>;
}

// -------------------------------------------------------------- drivetrain
function Drivetrain({ d, g, outline, fill, sw }: { d: Design; g: Geometry; outline: string; fill: string; sw: number }) {
  const rings = parseTeeth(d.chainrings);
  const cogs = parseTeeth(d.cogs);
  const ring = rings.length ? Math.max(...rings) : 42;
  const cog = cogs.length ? cogs[Math.floor(cogs.length / 2)] : 16;
  const pitch = 12.7;
  const rr = pitch / (2 * Math.sin(Math.PI / ring));
  const cr = pitch / (2 * Math.sin(Math.PI / cog));
  const belt = d.driveType === 'belt';
  const parts: React.ReactNode[] = [];
  const bb = g.bb;
  const ra = g.rearAxle;
  // Chain: external tangent lines between the two circles.
  const dv = sub(ra, bb);
  const L = len(dv);
  const ang = Math.atan2(dv.y, dv.x);
  const phi = Math.asin(Math.max(-1, Math.min(1, (rr - cr) / L)));
  const tangents = [1, -1].map((sgn) => {
    const a = ang + sgn * (Math.PI / 2 + phi);
    const p1 = v(bb.x + rr * Math.cos(a), bb.y + rr * Math.sin(a));
    const p2 = v(ra.x + cr * Math.cos(a), ra.y + cr * Math.sin(a));
    return [p1, p2];
  });
  if (d.driveType === 'gearbox' || d.driveType === 'midDrive') {
    const w = numOf(d, 'motorLength');
    const h = numOf(d, 'motorHeight');
    parts.push(<rect key="mot" x={-w * 0.35} y={-h * 0.45} width={w} height={h} rx={20} fill="#4a505b" stroke={outline} strokeWidth={sw} />);
  }
  parts.push(
    <g key="chain" stroke={belt ? '#222' : '#777'} strokeWidth={belt ? 6 : 4} fill="none">
      {tangents.map(([p1, p2], i) => (
        <line key={i} x1={sx(p1)} y1={sy(p1)} x2={sx(p2)} y2={sy(p2)} />
      ))}
    </g>,
  );
  parts.push(<circle key="cog" cx={sx(ra)} cy={sy(ra)} r={cr} fill="none" stroke={outline} strokeWidth={sw} />);
  if (cogs.length > 1) parts.push(<circle key="cogmax" cx={sx(ra)} cy={sy(ra)} r={pitch / (2 * Math.sin(Math.PI / Math.max(...cogs)))} fill="none" stroke={outline} strokeWidth={sw * 0.5} strokeDasharray="4 3" />);
  if (cogs.length > 1 && d.showRearDerailleur !== false && !belt) {
    const p = add(ra, v(-10, -cr - 25));
    const cage = [add(ra, v(5, -10)), add(p, v(0, 0)), add(p, v(-15, -75))];
    parts.push(<path key="rd" d={svgPath(cage, false)} stroke={outline} strokeWidth={9} strokeLinecap="round" fill="none" />);
    parts.push(<circle key="rdp1" cx={sx(add(p, v(0, 0)))} cy={sy(add(p, v(0, 0)))} r={16} fill="#555" stroke={outline} />);
    parts.push(<circle key="rdp2" cx={sx(add(p, v(-15, -75)))} cy={sy(add(p, v(-15, -75)))} r={16} fill="#555" stroke={outline} />);
  }
  rings.forEach((t, i) => {
    const r = pitch / (2 * Math.sin(Math.PI / t));
    parts.push(<circle key={`ring${i}`} cx={0} cy={0} r={r} fill={i === 0 ? (fill === 'none' ? 'none' : '#c7ccd4') : 'none'} fillOpacity={0.6} stroke={outline} strokeWidth={sw} />);
  });
  if (rings.length > 1 && d.showFrontDerailleur !== false && !belt) {
    const fd = add(g.stBottom, mul(g.seatDir, rr + 25));
    parts.push(<path key="fd" d={svgPath(orientedRect(add(fd, v(-5, 0)), v(1, 0.15), 60, 18))} fill="#555" stroke={outline} strokeWidth={sw * 0.7} />);
  }
  // Crank arm & pedal
  const crankA = numOf(d, 'crankAngle');
  const pedal = mul(dirDeg(-crankA), numOf(d, 'crankLength'));
  parts.push(<path key="crank" d={svgPath(tubeOutline([bb, pedal], 15, 9))} fill={fill === 'none' ? 'none' : '#30343b'} stroke={outline} strokeWidth={sw} />);
  parts.push(<rect key="pedal" x={sx(pedal) - 45} y={sy(pedal) - 9} width={90} height={18} rx={4} fill="#30343b" stroke={outline} strokeWidth={sw * 0.7} />);
  parts.push(<circle key="spider" cx={0} cy={0} r={22} fill="#30343b" stroke={outline} strokeWidth={sw} />);
  return <g>{parts}</g>;
}

// ------------------------------------------------------------- centrelines
function Centrelines({ d, g, pts }: { d: Design; g: Geometry; pts: Vec[][] }) {
  const col = '#5b6b85';
  const ext = (a: Vec, b: Vec, extra: number) => {
    const u = norm(sub(b, a));
    return [sub(a, mul(u, extra)), add(b, mul(u, extra))];
  };
  const steer = [sub(g.htTop, mul(g.steerDir, 60)), g.steerGround];
  const st = ext(g.stBottom, g.stTop, 30);
  void d;
  return (
    <g stroke={col} strokeWidth={0.7} strokeDasharray="20 5 4 5" fill="none" style={{ pointerEvents: 'none' }}>
      {pts.map((p, i) => (
        <path key={i} d={svgPath(p, false)} />
      ))}
      <path d={svgPath(steer, false)} />
      <path d={svgPath(st, false)} />
      <line x1={sx(g.rearAxle)} y1={sy(g.rearAxle)} x2={sx(g.frontAxle)} y2={sy(g.frontAxle)} />
    </g>
  );
}

// ------------------------------------------------------------------- rider
function Rider({ d, g, ghost }: { d: Design; g: Geometry; ghost?: boolean }) {
  const p = poseRider(d, g);
  const limb = (pts: Vec[], w: number, col: string, key: string) => (
    <path key={key} d={svgPath(pts, false)} stroke={col} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );
  const far = ghost ? '#b0b8c4' : '#9fb4cf';
  const near = ghost ? '#c0c7d1' : '#6f8fb8';
  const thigh = numOf(d, 'inseam') * 0.15;
  return (
    <g opacity={0.75} style={{ pointerEvents: 'none' }}>
      {limb([p.hip, p.knee2, p.ankle2], thigh * 0.9, far, 'l2')}
      {limb([p.heel2, p.ankle2, p.ball2], 40, far, 'f2')}
      {limb([p.hip, p.shoulder], 150, near, 'torso')}
      {limb([p.shoulder, p.neck], 60, near, 'neck')}
      <circle cx={sx(p.head)} cy={sy(p.head)} r={p.headR} fill={near} />
      {d.showHelmet === true && (
        <path d={svgPath(arcPts(p.head, p.headR + 18, angleOf(sub(p.head, p.neck)) - 80, angleOf(sub(p.head, p.neck)) + 100, 16))} fill="#e2e8f0" stroke="#55606e" strokeWidth={2} />
      )}
      {limb([p.hip, p.knee, p.ankle], thigh, near, 'l1')}
      {limb([p.heel, p.ankle, p.ball], 45, near, 'f1')}
      {limb([p.shoulder, p.elbow, p.hand], 55, near, 'arm')}
      {[p.hip, p.knee, p.ankle, p.shoulder, p.elbow, p.hand].map((q, i) => (
        <circle key={i} cx={sx(q)} cy={sy(q)} r={6} fill="#2a3a52" />
      ))}
    </g>
  );
}
