import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Design, numOf } from '../model/schema';
import { Geometry, solve, switchFrontEndMode } from '../geometry/solve';
import { BikeDrawing } from '../render/BikeDrawing';
import { Vec, v, sub } from '../geometry/vec';
import { poseRider } from '../fit/rider';

export interface CanvasHandle {
  svg: SVGSVGElement | null;
  fit: () => void;
}

interface Props {
  d: Design;
  g: Geometry;
  ghost?: { d: Design; g: Geometry } | null;
  /** `coalesce` is a drag id: every change from one drag merges into one undo step. */
  onChange: (patch: Partial<Design>, coalesce?: boolean | string) => void;
  onPick: (group: string) => void;
  photo?: { url: string; x: number; y: number; scale: number; opacity: number } | null;
  /** False while a morph preview is shown: handles are hidden and cannot drag. */
  editable?: boolean;
}

export function bikeBounds(d: Design, g: Geometry) {
  const xs = [g.rearAxle.x - g.rearWheelR, g.frontAxle.x + g.frontWheelR, g.barClamp.x + 200];
  const ys = [g.groundY, g.saddleTop.y, g.barClamp.y, g.htTop.y];
  if (d.showRider === true) {
    const p = poseRider(d, g);
    ys.push(p.head.y + p.headR + 30);
    xs.push(p.head.x + p.headR);
  }
  const minX = Math.min(...xs) - 120;
  const maxX = Math.max(...xs) + 120;
  const minY = Math.min(...ys) - 160;
  const maxY = Math.max(...ys) + 120;
  return { minX, maxX, minY, maxY };
}

type DragKind = 'pan' | 'htTop' | 'rearAxle' | 'saddle' | 'bar';
type HandleKind = Exclude<DragKind, 'pan'>;

/** Pointer travel (CSS px) before a press becomes a drag; below it a press is a click. */
const DRAG_THRESHOLD_PX = 4;

/** Where each handle is drawn. */
export function handlePos(kind: HandleKind, g: Geometry): Vec {
  switch (kind) {
    case 'htTop':
      return g.htTop;
    case 'rearAxle':
      return g.rearAxle;
    case 'saddle':
      return g.saddleTop;
    case 'bar':
      return g.barClamp;
  }
}

/**
 * Inverse of the solver for one handle: the parameters that put the handle at
 * `t`, given the real design `d` and its geometry `g`. Returns only the keys the
 * handle controls (plus any front-end mode switch it needs), never a whole design.
 */
export function inverseHandle(kind: HandleKind, d: Design, g: Geometry, t: Vec, snap: (n: number) => number = (n) => n): Partial<Design> {
  if (kind === 'htTop') {
    const patch: Partial<Design> = {};
    if (d.frontEndMode !== 'stackReach') {
      const base = switchFrontEndMode(d, 'stackReach');
      for (const k of Object.keys(base)) if (!Object.is(base[k], d[k])) patch[k] = base[k];
    }
    patch.stack = snap(t.y);
    patch.reach = snap(t.x);
    return patch;
  }
  if (kind === 'rearAxle') return { chainstayLength: snap(Math.hypot(t.x, t.y)), bbDrop: snap(t.y) };
  if (kind === 'saddle') {
    // solve(): saddleTop = stBottom + s·(saddleHeight − drop) + (−postSetback + slide, 0)
    const s = g.seatDir;
    const rel = sub(t, g.stBottom);
    const along = rel.y / s.y;
    const drop = d.seatpostType === 'dropper' && d.dropperDown === true ? numOf(d, 'dropperTravel') : 0;
    const slide = rel.x - s.x * along + numOf(d, 'seatpostSetback');
    return { saddleHeight: snap(along + drop), saddleSetback: snap(slide) };
  }
  // Bar: stem length & angle about the stem pivot.
  const rel = sub(t, g.stemPivot);
  const n = g.steerNormal;
  let ang = (Math.atan2(rel.y, rel.x) - Math.atan2(n.y, n.x)) * (180 / Math.PI);
  if (ang > 180) ang -= 360;
  if (ang < -180) ang += 360;
  return { stemLength: snap(Math.hypot(rel.x, rel.y)), stemAngle: Math.round(ang) };
}

interface DragState {
  kind: DragKind;
  pointerId: number;
  client: { x: number; y: number };
  start: Vec;
  view: { x: number; y: number; w: number; h: number };
  d: Design;
  g: Geometry;
  /** Handle position at pointerdown, so the grab offset is kept. */
  anchor: Vec;
  active: boolean;
  id: string;
}

let dragSeq = 0;

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ d, g, ghost, onChange, onPick, photo, editable = true }, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<DragState | null>(null);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const b = bikeBounds(d, g);
    const rect = el.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    let w = b.maxX - b.minX;
    let h = b.maxY - b.minY;
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    const cx = (b.minX + b.maxX) / 2;
    const cy = -(b.minY + b.maxY) / 2;
    setView({ x: cx - w / 2, y: cy - h / 2, w, h });
  }, [d, g]);

  useImperativeHandle(ref, () => ({ svg: svgRef.current, fit }), [fit]);

  // Fit on first render and when the window resizes.
  useEffect(() => {
    if (!view) fit();
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  // Handles are disabled while a morph preview is shown; drop any drag in progress.
  useEffect(() => {
    if (!editable && drag.current && drag.current.kind !== 'pan') drag.current = null;
  }, [editable]);

  const toWorld = (clientX: number, clientY: number, vw = view): Vec => {
    const el = svgRef.current!;
    const r = el.getBoundingClientRect();
    if (!vw) return v(0, 0);
    const x = vw.x + ((clientX - r.left) / r.width) * vw.w;
    const y = vw.y + ((clientY - r.top) / r.height) * vw.h;
    return v(x, -y);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!view) return;
    // Keep the view between 20 cm and 50 m across so it can't zoom into nothing.
    const k = Math.min(Math.max(Math.exp(e.deltaY * 0.0015), 200 / view.w), 50000 / view.w);
    const p = toWorld(e.clientX, e.clientY);
    const px = p.x;
    const py = -p.y;
    setView({ x: px - (px - view.x) * k, y: py - (py - view.y) * k, w: view.w * k, h: view.h * k });
  };

  const onPointerDown = (e: React.PointerEvent, kind: DragKind = 'pan') => {
    if (!view) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (kind !== 'pan' && !editable) return;
    e.stopPropagation();
    // No pointer capture yet: a press that does not move must stay a click on
    // whatever part is under it (capture would retarget the click to the svg).
    drag.current = {
      kind,
      pointerId: e.pointerId,
      client: { x: e.clientX, y: e.clientY },
      start: toWorld(e.clientX, e.clientY),
      view,
      d,
      g,
      anchor: kind === 'pan' ? v(0, 0) : handlePos(kind, g),
      active: false,
      id: `drag-${++dragSeq}`,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const dr = drag.current;
    if (!dr || !view || e.pointerId !== dr.pointerId) return;
    if (!dr.active) {
      if (Math.hypot(e.clientX - dr.client.x, e.clientY - dr.client.y) < DRAG_THRESHOLD_PX) return;
      dr.active = true;
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    }
    if (dr.kind === 'pan') {
      const p = toWorld(e.clientX, e.clientY, dr.view);
      const dx = p.x - dr.start.x;
      const dy = p.y - dr.start.y;
      setView({ ...dr.view, x: dr.view.x - dx, y: dr.view.y + dy });
      return;
    }
    if (!editable) return;
    const p = toWorld(e.clientX, e.clientY);
    const target = v(dr.anchor.x + p.x - dr.start.x, dr.anchor.y + p.y - dr.start.y);
    const snap = (n: number) => (e.shiftKey ? Math.round(n) : Math.round(n * 2) / 2);
    onChange(inverseHandle(dr.kind, dr.d, dr.g, target, snap), dr.id);
  };

  const endDrag = (e?: React.PointerEvent) => {
    const dr = drag.current;
    if (e && dr && e.pointerId !== dr.pointerId) return;
    drag.current = null;
    if (e && dr?.active && svgRef.current?.hasPointerCapture?.(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  };

  const handle = (p: Vec, kind: HandleKind, title: string) => (
    <circle data-ui="1" className="handle" cx={p.x} cy={-p.y} r={view ? view.w * 0.007 : 8} onPointerDown={(e) => onPointerDown(e, kind)}>
      <title>{title}</title>
    </circle>
  );

  const vb = view ? `${view.x} ${view.y} ${view.w} ${view.h}` : '0 0 100 100';

  return (
    <svg
      ref={svgRef}
      className="canvas"
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      onWheel={onWheel}
      onPointerDown={(e) => onPointerDown(e, 'pan')}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        if (drag.current?.active) drag.current = null;
      }}
      onPointerLeave={(e) => {
        // Only an uncaptured press (not yet a drag) ends when the pointer leaves.
        if (drag.current && !drag.current.active) endDrag(e);
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {photo && <image data-ui="1" href={photo.url} x={photo.x} y={-photo.y} width={photo.scale * 1000} opacity={photo.opacity} preserveAspectRatio="xMinYMin" />}
      {ghost && (
        <g data-ui="1">
          <BikeDrawing d={{ ...ghost.d, showDims: false, showRider: false }} g={ghost.g} ghost />
        </g>
      )}
      <BikeDrawing d={d} g={g} onPick={onPick} />
      {editable && (
      <g data-ui="1">
        {handle(g.htTop, 'htTop', 'Drag to set stack & reach')}
        {handle(g.rearAxle, 'rearAxle', 'Drag to set chainstay & BB drop')}
        {d.showComponents !== false && handle(g.saddleTop, 'saddle', 'Drag to set saddle height & position')}
        {d.showComponents !== false && handle(g.barClamp, 'bar', 'Drag to set stem length & angle')}
      </g>
      )}
    </svg>
  );
});

export { solve };
