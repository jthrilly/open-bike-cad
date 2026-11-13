import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Design, numOf } from '../model/schema';
import { Geometry, solve, switchFrontEndMode } from '../geometry/solve';
import { BikeDrawing } from '../render/BikeDrawing';
import { Vec, v, sub, dot } from '../geometry/vec';
import { poseRider } from '../fit/rider';

export interface CanvasHandle {
  svg: SVGSVGElement | null;
  fit: () => void;
}

interface Props {
  d: Design;
  g: Geometry;
  ghost?: { d: Design; g: Geometry } | null;
  onChange: (patch: Partial<Design>, coalesce?: boolean) => void;
  onPick: (group: string) => void;
  photo?: { url: string; x: number; y: number; scale: number; opacity: number } | null;
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

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ d, g, ghost, onChange, onPick, photo }, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<{ kind: DragKind; start: Vec; view: { x: number; y: number; w: number; h: number }; d: Design } | null>(null);

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
    const k = Math.exp(e.deltaY * 0.0015);
    const p = toWorld(e.clientX, e.clientY);
    const px = p.x;
    const py = -p.y;
    setView({ x: px - (px - view.x) * k, y: py - (py - view.y) * k, w: view.w * k, h: view.h * k });
  };

  const onPointerDown = (e: React.PointerEvent, kind: DragKind = 'pan') => {
    if (!view) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind, start: toWorld(e.clientX, e.clientY), view, d };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const dr = drag.current;
    if (!dr || !view) return;
    if (dr.kind === 'pan') {
      const r = svgRef.current!.getBoundingClientRect();
      const p = toWorld(e.clientX, e.clientY, dr.view);
      const dx = p.x - dr.start.x;
      const dy = p.y - dr.start.y;
      void r;
      setView({ ...dr.view, x: dr.view.x - dx, y: dr.view.y + dy });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    const snap = (n: number) => (e.shiftKey ? Math.round(n) : Math.round(n * 2) / 2);
    if (dr.kind === 'htTop') {
      let base = dr.d;
      if (base.frontEndMode !== 'stackReach') base = switchFrontEndMode(base, 'stackReach');
      onChange({ ...base, stack: snap(p.y), reach: snap(p.x) });
    } else if (dr.kind === 'rearAxle') {
      const cs = Math.hypot(p.x, p.y);
      onChange({ chainstayLength: snap(cs), bbDrop: snap(p.y) });
    } else if (dr.kind === 'saddle') {
      // Project onto the seat tube line for saddle height, horizontal remainder → rail slide.
      const s = g.seatDir;
      const rel = sub(p, g.stBottom);
      const h = dot(rel, s);
      const along = { x: g.stBottom.x + s.x * h, y: s.y * h };
      const slide = p.x - along.x + numOf(dr.d, 'seatpostSetback');
      onChange({ saddleHeight: snap(h), saddleSetback: snap(slide) });
    } else if (dr.kind === 'bar') {
      // Adjust stem length & angle to follow the pointer.
      const piv = g.stemPivot;
      const rel = sub(p, piv);
      const len = Math.hypot(rel.x, rel.y);
      const n = g.steerNormal;
      const ang = (Math.atan2(rel.y, rel.x) - Math.atan2(n.y, n.x)) * (180 / Math.PI);
      onChange({ stemLength: snap(len), stemAngle: Math.round(ang) });
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const handle = (p: Vec, kind: DragKind, title: string) => (
    <circle
      data-ui="1"
      className="handle"
      cx={p.x}
      cy={-p.y}
      r={view ? view.w * 0.007 : 8}
      onPointerDown={(e) => onPointerDown(e, kind)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
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
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      xmlns="http://www.w3.org/2000/svg"
    >
      {photo && <image data-ui="1" href={photo.url} x={photo.x} y={-photo.y} width={photo.scale * 1000} opacity={photo.opacity} preserveAspectRatio="xMinYMin" />}
      {ghost && <BikeDrawing d={{ ...ghost.d, showDims: false, showRider: false }} g={ghost.g} ghost />}
      <BikeDrawing d={d} g={g} onPick={onPick} />
      <g data-ui="1">
        {handle(g.htTop, 'htTop', 'Drag to set stack & reach')}
        {handle(g.rearAxle, 'rearAxle', 'Drag to set chainstay & BB drop')}
        {d.showComponents !== false && handle(g.saddleTop, 'saddle', 'Drag to set saddle height & position')}
        {d.showComponents !== false && handle(g.barClamp, 'bar', 'Drag to set stem length & angle')}
      </g>
    </svg>
  );
});

export { solve };
