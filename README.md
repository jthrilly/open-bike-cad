# Open Bike CAD

A free, browser-based tool for designing bicycle frames. It opens and saves BikeCAD `.bcad` files, draws the bike to scale, and produces the numbers and paperwork a frame builder needs.

Everything runs in your browser. There is no server and no account; designs are saved as `.bcad` files on your computer, with an optional library kept in the browser.

## Features

**Files**
- Open `.bcad` files (File → Open, Ctrl O, or drag a file onto the window).
- Save `.bcad` files. Every key in the original file is kept, so a file can go back and forth with BikeCAD. Settings that BikeCAD has no equivalent for are stored under `OpenBikeCAD.*` keys.
- Starting presets: road, gravel, touring, track, hardtail MTB, step-through city.
- Autosave of the current design, undo/redo, and a local design library.

**Geometry**
- Front end set by stack & reach, reach & head tube, front centre, effective top tube, top tube c-c, or handlebar position. Switching method never moves the bike.
- Top tube by angle or by seat tube extension; head tube extensions; BB offset; diamond, mixte, step-through and beam frames.
- Rear end by chainstay and BB drop; seatstay junction, wishbone stays, dropout styles (vertical, horizontal, track, sliding, thru-axle, hooded) with slot angle.
- Fork: rigid curved, straight, suspension (travel, sag), dual crown, single sided; headset stack.
- Drag handles on the drawing for stack/reach, rear axle, saddle and handlebar.

**Tubes**
- Outside diameter and wall for every tube, tapered stays and seat tube, tapered or hourglass head tube, ovalised/rectangular tubes.
- Curved tubes (by bend sagitta), looped stays, lugged and fillet-brazed joint display.

**Components**
- Wheels (BSD, tyre, rim depth, spokes and cross pattern, hubs, disc wheels), drivetrain (chain, belt, gearbox, mid-drive; chainrings, cassette, derailleurs), stem (threadless, quill, integrated), handlebars (drop, flat, riser, bullhorn, swept-back, aero), levers, seatpost (setback, dropper, integrated mast), saddle, brakes (disc rotors, rim, cantilever, V), bottle bosses and cages, fenders, racks, pump, battery, kickstand.

**Fit**
- Rider figure posed from body measurements; estimate measurements from height.
- Fit advisor for road, racing, touring, MTB, TT and city with one-click apply.
- Knee, hip, torso, shoulder and elbow angles; knee-over-pedal; toe overlap check.
- Gear table: gear inches, development and speed at a chosen cadence.

**Builder outputs**
- Cut list (centre-to-centre, long points, cut length with allowance).
- 1:1 mitre templates as PDF (A4, A3, Letter, Tabloid, with paper thickness allowance and scale bar) or DXF.
- Frame jig / fixture coordinates.
- Drawing sheet with title block, notes and specification table; export as PDF or SVG.
- Frame outline DXF, spec CSV, and a side-by-side comparison CSV.
- Compare with a second design as an overlay, and morph between them. Trace over a photo.

## Developing

```sh
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # production build in dist/
```

The app is deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

## About .bcad files

A `.bcad` file is a Java Properties XML document: a flat list of `<entry key="…">value</entry>` pairs, with lengths in millimetres and angles in degrees. `src/bcad/io.ts` holds the mapping between BikeCAD keys and Open Bike CAD parameters. Keys it doesn't understand are carried through unchanged.

Open Bike CAD is an independent project inspired by BikeCAD's feature set. It is not affiliated with or endorsed by BikeCAD.
