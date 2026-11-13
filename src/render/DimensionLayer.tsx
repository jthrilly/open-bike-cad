import type React from 'react';
/** Builds the set of dimensions to show on the drawing from the "dimSet" parameter. */
import { Design, numOf } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { v, add, mul, angleOf, sub } from '../geometry/vec';
import { LinearDim, AngleDim, DimStyle } from './dims';

const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export const DIM_OPTIONS: { id: string; label: string }[] = [
  { id: 'stack', label: 'Stack' },
  { id: 'reach', label: 'Reach' },
  { id: 'ha', label: 'Head angle' },
  { id: 'sa', label: 'Seat angle' },
  { id: 'ett', label: 'Effective top tube' },
  { id: 'htl', label: 'Head tube length' },
  { id: 'cs', label: 'Chainstay' },
  { id: 'bbdrop', label: 'BB drop' },
  { id: 'bbh', label: 'BB height' },
  { id: 'wb', label: 'Wheelbase' },
  { id: 'fc', label: 'Front centre' },
  { id: 'trail', label: 'Trail' },
  { id: 'st', label: 'Seat tube c-t' },
  { id: 'stcc', label: 'Seat tube c-c' },
  { id: 'tt', label: 'Top tube c-c' },
  { id: 'dt', label: 'Down tube c-c' },
  { id: 'ss', label: 'Seatstay c-c' },
  { id: 'standover', label: 'Standover' },
  { id: 'fork', label: 'Fork length' },
  { id: 'rake', label: 'Fork rake' },
  { id: 'saddle', label: 'Saddle height' },
  { id: 'setback', label: 'Saddle setback' },
  { id: 'toe', label: 'Toe overlap' },
  { id: 'barpos', label: 'Handlebar position' },
  { id: 'tta', label: 'Top tube angle' },
];

export function DimensionLayer({ d, g, onPick }: { d: Design; g: Geometry; onPick?: (grp: string) => void }) {
  const set = new Set(
    String(d.dimSet)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const style: DimStyle = { color: String(d.dimColor), textSize: numOf(d, 'dimTextSize') * 1.6, stroke: 0.9 };
  const ts = style.textSize;
  const pk = (grp: string) => (onPick ? () => onPick(grp) : undefined);
  const out: React.ReactElement[] = [];
  const D = g.dims;
  const ground = g.groundY;
  const bottom = ground - ts * 2;

  if (set.has('stack'))
    out.push(<LinearDim key="stack" a={v(g.htTop.x, 0)} b={g.htTop} offset={-(g.frontWheelR * 0.0 + 60)} mode="vertical" label={`Stack ${f1(D.stack)}`} style={style} onClick={pk('frontEnd')} />);
  if (set.has('reach'))
    out.push(<LinearDim key="reach" a={v(0, g.htTop.y)} b={g.htTop} offset={ts * 3} mode="horizontal" label={`Reach ${f1(D.reach)}`} style={style} onClick={pk('frontEnd')} />);
  if (set.has('ett')) {
    const sl = v(g.stBottom.x - g.ttFront.y / Math.tan((D.seatAngle * Math.PI) / 180), g.ttFront.y);
    out.push(<LinearDim key="ett" a={sl} b={g.ttFront} offset={ts * 6} mode="horizontal" label={`ETT ${f1(D.ett)}`} style={style} onClick={pk('frontEnd')} />);
  }
  if (set.has('htl'))
    out.push(<LinearDim key="htl" a={g.htTop} b={g.htBottom} offset={-(numOf(d, 'htOD') / 2 + ts * 1.5)} label={`HT ${f1(D.headTubeLength)}`} style={style} onClick={pk('frontEnd')} />);
  if (set.has('ha')) {
    const at = g.steerGround;
    out.push(<AngleDim key="ha" at={at} fromDeg={angleOf(sub(g.htTop, at))} toDeg={180} r={ts * 7} label={`${f1(D.headAngle)}°`} style={style} onClick={pk('frontEnd')} />);
  }
  if (set.has('sa')) {
    const top = add(g.stBottom, mul(g.seatDir, 160));
    void top;
    out.push(<AngleDim key="sa" at={g.stBottom} fromDeg={0} toDeg={angleOf(g.seatDir)} r={ts * 5} label={`${f1(D.seatAngle)}°`} style={style} onClick={pk('frame')} />);
  }
  if (set.has('tta')) {
    out.push(<AngleDim key="tta" at={g.ttFront} fromDeg={180} toDeg={angleOf(sub(g.ttRear, g.ttFront))} r={ts * 6} label={`TT ${f1(D.ttAngle)}°`} style={style} onClick={pk('frame')} />);
  }
  if (set.has('cs'))
    out.push(<LinearDim key="cs" a={g.rearAxle} b={g.bb} offset={-ts * 2.5} label={`CS ${f1(D.chainstay)}`} style={style} onClick={pk('rear')} />);
  if (set.has('bbdrop'))
    out.push(<LinearDim key="bbd" a={v(g.rearAxle.x * 0.35, g.rearAxle.y)} b={v(g.rearAxle.x * 0.35, 0)} offset={0} mode="vertical" label={`Drop ${f1(D.bbDrop)}`} style={style} onClick={pk('frame')} />);
  if (set.has('bbh'))
    out.push(<LinearDim key="bbh" a={v(0, ground)} b={v(0, 0)} offset={ts * 2} mode="vertical" label={`BB ht ${f1(D.bbHeight)}`} style={style} onClick={pk('frame')} />);
  if (set.has('wb'))
    out.push(<LinearDim key="wb" a={v(g.rearAxle.x, ground)} b={v(g.frontAxle.x, ground)} offset={-(ts * 4.5)} mode="horizontal" label={`Wheelbase ${f1(D.wheelbase)}`} style={style} />);
  if (set.has('fc'))
    out.push(<LinearDim key="fc" a={v(0, bottom)} b={v(g.frontAxle.x, bottom)} offset={-ts * 1.2} mode="horizontal" label={`FC ${f1(D.frontCenterHoriz)}`} style={style} onClick={pk('frontEnd')} />);
  if (set.has('trail'))
    out.push(<LinearDim key="trail" a={v(g.frontAxle.x, ground)} b={v(g.steerGround.x, ground)} offset={-ts * 1.2} mode="horizontal" label={`Trail ${f1(D.trail)}`} style={style} onClick={pk('fork')} />);
  if (set.has('st'))
    out.push(<LinearDim key="st" a={g.stBottom} b={g.stTop} offset={ts * 2 + numOf(d, 'stOD') / 2} label={`ST ${f1(D.stCT)}`} style={style} onClick={pk('frame')} />);
  if (set.has('stcc'))
    out.push(<LinearDim key="stcc" a={g.stBottom} b={g.ttRear} offset={ts * 4 + numOf(d, 'stOD') / 2} label={`ST c-c ${f1(D.stCC)}`} style={style} onClick={pk('frame')} />);
  if (set.has('tt'))
    out.push(<LinearDim key="tt" a={g.ttRear} b={g.ttFront} offset={-ts * 2.2 - numOf(d, 'ttOD') / 2} label={`TT ${f1(D.ttCC)}`} style={style} onClick={pk('frame')} />);
  if (set.has('dt'))
    out.push(<LinearDim key="dt" a={g.bb} b={g.dtFront} offset={-ts * 2 - numOf(d, 'dtOD') / 2} label={`DT ${f1(D.dtCC)}`} style={style} onClick={pk('frame')} />);
  if (set.has('ss'))
    out.push(<LinearDim key="ss" a={g.rearAxle} b={g.ssTop} offset={ts * 2} label={`SS ${f1(D.ssCC)}`} style={style} onClick={pk('rear')} />);
  if (set.has('standover')) {
    const mid = mul(add(g.ttFront, g.ttRear), 0.5);
    const top = v(mid.x, mid.y + numOf(d, 'ttOD') / 2);
    out.push(<LinearDim key="so" a={v(mid.x, ground)} b={top} offset={0} mode="vertical" label={`Standover ${f1(D.standover)}`} style={style} onClick={pk('frame')} />);
  }
  if (set.has('fork'))
    out.push(<LinearDim key="fork" a={g.crownRace} b={g.frontAxle} offset={ts * 2.5} label={`A-C ${f1(D.forkLength)}`} style={style} onClick={pk('fork')} />);
  if (set.has('rake')) {
    const foot = sub(g.frontAxle, mul(g.steerNormal, D.forkRake));
    out.push(<LinearDim key="rake" a={foot} b={g.frontAxle} offset={-ts * 1.5} label={`Rake ${f1(D.forkRake)}`} style={style} onClick={pk('fork')} />);
  }
  if (set.has('saddle'))
    out.push(<LinearDim key="sad" a={g.bb} b={add(g.stBottom, mul(g.seatDir, numOf(d, 'saddleHeight')))} offset={-ts * 3 - numOf(d, 'stOD')} label={`Saddle ${f1(D.saddleHeight)}`} style={style} onClick={pk('saddle')} />);
  if (set.has('setback'))
    out.push(<LinearDim key="sb" a={v(g.saddleTop.x, g.saddleTop.y)} b={v(0, g.saddleTop.y)} offset={ts * 2} mode="horizontal" label={`Setback ${f1(D.saddleSetback)}`} style={style} onClick={pk('saddle')} />);
  if (set.has('barpos')) {
    out.push(<LinearDim key="barx" a={v(0, g.barClamp.y)} b={g.barClamp} offset={ts * 2} mode="horizontal" label={`Bar X ${f1(g.barClamp.x)}`} style={style} onClick={pk('cockpit')} />);
    out.push(<LinearDim key="bary" a={v(g.barClamp.x, 0)} b={g.barClamp} offset={-ts * 2} mode="vertical" label={`Bar Y ${f1(g.barClamp.y)}`} style={style} onClick={pk('cockpit')} />);
  }
  if ((set.has('toe') || d.showToeOverlap === true) && D.toeOverlap > -40) {
    const color = D.toeOverlap > 0 ? '#dc2626' : '#16a34a';
    out.push(
      <g key="toe" style={{ pointerEvents: 'none' }}>
        <circle cx={g.toe.x} cy={-g.toe.y} r={6} fill={color} />
        <text x={g.toe.x + 10} y={-g.toe.y - 10} fill={color} fontSize={ts * 0.9}>
          {D.toeOverlap > 0 ? `Toe overlap ${f1(D.toeOverlap)}` : `Toe clearance ${f1(-D.toeOverlap)}`}
        </text>
      </g>,
    );
  }
  return <g className="dims">{out}</g>;
}
