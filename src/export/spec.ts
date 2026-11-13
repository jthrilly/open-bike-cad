/** Specification table rows: the numbers a builder or customer needs. */
import { Design, numOf, parseTeeth } from '../model/schema';
import { Geometry } from '../geometry/solve';

export interface SpecRow {
  section: string;
  label: string;
  value: string;
  unit: string;
  /** Dimension id for "dimSet" so the row can toggle display. */
  dim?: string;
}

const f = (n: number, p = 1) => (Number.isFinite(n) ? n.toFixed(p) : '—');

export function specRows(d: Design, g: Geometry): SpecRow[] {
  const D = g.dims;
  const rows: SpecRow[] = [
    { section: 'Geometry', label: 'Stack', value: f(D.stack), unit: 'mm', dim: 'stack' },
    { section: 'Geometry', label: 'Reach', value: f(D.reach), unit: 'mm', dim: 'reach' },
    { section: 'Geometry', label: 'Head angle', value: f(D.headAngle), unit: '°', dim: 'ha' },
    { section: 'Geometry', label: 'Seat angle', value: f(D.seatAngle), unit: '°', dim: 'sa' },
    { section: 'Geometry', label: 'Effective seat angle (to saddle)', value: f(D.effectiveSeatAngle), unit: '°' },
    { section: 'Geometry', label: 'Head tube length', value: f(D.headTubeLength), unit: 'mm', dim: 'htl' },
    { section: 'Geometry', label: 'Effective top tube', value: f(D.ett), unit: 'mm', dim: 'ett' },
    { section: 'Geometry', label: 'Top tube c-c', value: f(D.ttCC), unit: 'mm', dim: 'tt' },
    { section: 'Geometry', label: 'Top tube angle', value: f(D.ttAngle), unit: '°', dim: 'tta' },
    { section: 'Geometry', label: 'Seat tube c-t', value: f(D.stCT), unit: 'mm', dim: 'st' },
    { section: 'Geometry', label: 'Seat tube c-c', value: f(D.stCC), unit: 'mm', dim: 'stcc' },
    { section: 'Geometry', label: 'Down tube c-c', value: f(D.dtCC), unit: 'mm', dim: 'dt' },
    { section: 'Geometry', label: 'Chainstay', value: f(D.chainstay), unit: 'mm', dim: 'cs' },
    { section: 'Geometry', label: 'Seatstay c-c', value: f(D.ssCC), unit: 'mm', dim: 'ss' },
    { section: 'Geometry', label: 'BB drop', value: f(D.bbDrop), unit: 'mm', dim: 'bbdrop' },
    { section: 'Geometry', label: 'BB height', value: f(D.bbHeight), unit: 'mm', dim: 'bbh' },
    { section: 'Geometry', label: 'Wheelbase', value: f(D.wheelbase), unit: 'mm', dim: 'wb' },
    { section: 'Geometry', label: 'Front centre', value: f(D.frontCenter), unit: 'mm', dim: 'fc' },
    { section: 'Geometry', label: 'Standover', value: f(D.standover), unit: 'mm', dim: 'standover' },
    { section: 'Steering', label: 'Fork length (A-C)', value: f(D.forkLength), unit: 'mm', dim: 'fork' },
    { section: 'Steering', label: 'Fork rake', value: f(D.forkRake), unit: 'mm', dim: 'rake' },
    { section: 'Steering', label: 'Trail', value: f(D.trail), unit: 'mm', dim: 'trail' },
    { section: 'Steering', label: 'Mechanical trail', value: f(D.mechanicalTrail), unit: 'mm' },
    { section: 'Steering', label: 'Wheel flop', value: f(D.flop), unit: 'mm' },
    { section: 'Steering', label: 'Toe overlap', value: D.toeOverlap > 0 ? f(D.toeOverlap) : 'none', unit: D.toeOverlap > 0 ? 'mm' : '', dim: 'toe' },
    { section: 'Steering', label: 'Stack to top of headset', value: f(D.stackToTopOfHeadset), unit: 'mm' },
    { section: 'Steering', label: 'Reach to top of headset', value: f(D.reachToTopOfHeadset), unit: 'mm' },
    { section: 'Fit', label: 'Saddle height', value: f(D.saddleHeight), unit: 'mm', dim: 'saddle' },
    { section: 'Fit', label: 'Saddle setback', value: f(D.saddleSetback), unit: 'mm', dim: 'setback' },
    { section: 'Fit', label: 'Saddle to bar drop', value: f(D.saddleToBarDrop), unit: 'mm' },
    { section: 'Fit', label: 'Bar clamp from BB (x)', value: f(D.barReachFromBB), unit: 'mm', dim: 'barpos' },
    { section: 'Fit', label: 'Bar clamp from BB (y)', value: f(D.barStackFromBB), unit: 'mm', dim: 'barpos' },
    { section: 'Fit', label: 'Minimum seatpost length', value: f(D.seatpostMinLength), unit: 'mm' },
    { section: 'Tubes', label: 'Head tube', value: `${f(numOf(d, 'htOD'), 1)} × ${f(numOf(d, 'htWall'), 2)}`, unit: 'mm' },
    { section: 'Tubes', label: 'Top tube', value: `${f(numOf(d, 'ttOD'), 1)} × ${f(numOf(d, 'ttWall'), 2)}`, unit: 'mm' },
    { section: 'Tubes', label: 'Down tube', value: `${f(numOf(d, 'dtOD'), 1)} × ${f(numOf(d, 'dtWall'), 2)}`, unit: 'mm' },
    { section: 'Tubes', label: 'Seat tube', value: `${f(numOf(d, 'stOD'), 1)} × ${f(numOf(d, 'stWall'), 2)}`, unit: 'mm' },
    { section: 'Tubes', label: 'Chainstays', value: `${f(numOf(d, 'csOD'), 1)}→${f(numOf(d, 'csODTip'), 1)} × ${f(numOf(d, 'csWall'), 2)}`, unit: 'mm' },
    { section: 'Tubes', label: 'Seatstays', value: `${f(numOf(d, 'ssOD'), 1)}→${f(numOf(d, 'ssODTip'), 1)} × ${f(numOf(d, 'ssWall'), 2)}`, unit: 'mm' },
    { section: 'Tubes', label: 'Seatpost', value: f(numOf(d, 'seatpostDia'), 1), unit: 'mm' },
    { section: 'Components', label: 'Wheels (BSD rear/front)', value: `${f(numOf(d, 'rearBSD'), 0)} / ${f(numOf(d, 'frontBSD'), 0)}`, unit: 'mm' },
    { section: 'Components', label: 'Tyres (rear/front)', value: `${f(numOf(d, 'rearTyre'), 0)} / ${f(numOf(d, 'frontTyre'), 0)}`, unit: 'mm' },
    { section: 'Components', label: 'Hub spacing (rear/front)', value: `${f(numOf(d, 'rearSpacing'), 0)} / ${f(numOf(d, 'frontSpacing'), 0)}`, unit: 'mm' },
    { section: 'Components', label: 'BB shell', value: `${f(numOf(d, 'bbShellWidth'), 0)}`, unit: 'mm' },
    { section: 'Components', label: 'Cranks', value: f(numOf(d, 'crankLength'), 1), unit: 'mm' },
    { section: 'Components', label: 'Chainrings', value: parseTeeth(d.chainrings).join('/'), unit: 'T' },
    { section: 'Components', label: 'Cassette', value: (() => { const c = parseTeeth(d.cogs); return c.length ? `${Math.min(...c)}–${Math.max(...c)} (${c.length})` : '—'; })(), unit: 'T' },
    { section: 'Components', label: 'Stem', value: `${f(numOf(d, 'stemLength'), 0)} × ${f(numOf(d, 'stemAngle'), 0)}°`, unit: '' },
    { section: 'Components', label: 'Spacers', value: f(numOf(d, 'spacers'), 0), unit: 'mm' },
    { section: 'Components', label: 'Handlebar', value: `${String(d.barType)} ${f(numOf(d, 'barWidth'), 0)}`, unit: 'mm' },
    ...(d.forkType === 'rigid' || d.forkType === 'straight'
      ? [
          {
            section: 'Components',
            label: 'Fork dropouts',
            // Kept short so it fits the drawing sheet's spec table.
            value: `${f(numOf(d, 'forkDropoutPlate'), 0)} mm plate, ${f(numOf(d, 'forkDropoutSlotWidth'), 0)} mm slot${d.forkTorqueArm === true ? ', torque arm' : ''}${numOf(d, 'forkCableGuides') > 0 ? `, ${f(numOf(d, 'forkCableGuides'), 0)} cable guides` : ''}`,
            unit: '',
          },
        ]
      : []),
    { section: 'Components', label: 'Brakes', value: String(d.brakeType), unit: '' },
  ];
  return rows;
}
