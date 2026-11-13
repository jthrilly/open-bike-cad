# Blender model

`build_bike.py` builds a 3D model of each SA City Bike from its `*_geometry.json`,
so it can be re-run whenever the geometry changes. From `designs/sa-city-bike`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/build_bike.py -- OUT_DIR SA_City_Bike_700C_adult_geometry.json SA_City_Bike_24_kids_geometry.json SA_City_Bike_700C_eassist_geometry.json SA_City_Bike_20_GLine_geometry.json SA_City_Bike_20_GLine_child_geometry.json
```

For each bike it writes `<name>.blend`, `<name>.glb` (in metres, without the ground plane)
and Cycles renders `<name>_side.png` (orthographic, drive side), `<name>_front34.png`,
`<name>_rear34.png` and a saddle close-up `<name>_saddle.png`. It also prints a clearance
report: tyre to crown, seat tube, step tube and down tube, and whether a fender fits under
the crown.

Accessories are built only from the `accessories` section of the geometry (format version 2):
fenders and their stays, the rear rack tubes, the chainguard outline and lip, the ring lock,
the front carrier block, the front bag envelope (`front_bag`, a plain box, on the 20" bike) and the kickstand. The cockpit (bar, grips, brake levers and twist
shifter) comes from `cockpit`. Brakes come from `accessories.brakes`: the front V-brake's bosses, arms, pads,
noodle and cable clamp, and the rear roller brake with its reaction arm and chainstay clamp.
The fork ends, torque arm and blade cable guides come from `fork`. Cable housings run from
the levers and shifter to the brakes and hub. Nothing there is invented by the
script, so a change to a drawing shows up in the model once the JSON is regenerated. The
saddle is a sprung leather city saddle (twin coil springs, rivets) sized from
`saddle.saddle_length`; it is the one part not described by the JSON.

The clearance report also prints the JSON's own `clearances` list.

Options: `--no-render` skips the renders; `--samples N` sets Cycles samples (default 96).

## Children's school bag (concept)

`build_school_bag.py` models an 18 L school bag that clips onto the kids' bike's Brompton-style
front carrier block (`accessories.front_carrier_block`) and works as a backpack for walking:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/build_school_bag.py -- OUT_DIR SA_City_Bike_24_kids_geometry.json
```

The bag is 330 W × 300 H × 180 D mm with a 35 mm front pocket: a recycled PET Cordura shell, a
welded TPU base, reflective bands and a top grab handle. On the back, a 10 mm aluminium tube
frame carries a glass-filled nylon receiver that slides down over the block. It wraps the
block's front, sides and top, has a release lever on top, and is a wedge so the bag hangs
vertically even though the block follows the head tube. The shoulder straps stow in a zipped
pocket between the frame rails, and two spacer-mesh pads stand proud of the receiver for walking.

It builds two layouts (`--layout upright|flat`, default both). **Upright** hangs the bag with its
back panel, frame and receiver facing the rider; it rises above the bars. **Flat** turns the bag
so it lies on its back panel over the front wheel, with the frame and receiver on its base: it
is 340 W × 330 L × 170 H mm on the bike and stays below the bars, so nothing touches it through
70° of steering, but its load sits about 200 mm ahead of the block instead of about 115 mm. In the
flat layout the main zip is a clamshell, so the lid opens upwards on the bike, and the back pads
are 10 mm deep because nothing on the back panel needs to clear them. Flat outputs use the
prefix `school_bag_flat`.

For the upright layout it writes `school_bag.glb`/`.blend` (the bag alone, straps out), `school_bag_on_bike.glb`/`.blend`
(the bike with the bag clipped on, straps stowed) and renders, and `school_bag_clearance.txt`.
That file reports the gap to every steered part straight ahead, and the steering angle at which
each first touches the bag, with a 25 mm allowance for a child's hand on the grips. It builds
the bike with `build_bike.py`, so it follows any change to the geometry.

## E-assist battery pack

`build_battery.py` models the e-assist bike's slide-in battery and its mounting, all placed from
`accessories.e_assist.battery` and `accessories.front_carrier_block` in the e-assist geometry:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/build_battery.py -- OUT_DIR SA_City_Bike_700C_eassist_geometry.json
```

- **Pack** (111 D × 85 W × 151 H mm, 36 V 10 Ah, 360 Wh): an aluminium extrusion between
  glass-filled nylon end caps, with a fold-down carry bail and a five-LED charge gauge in the top cap,
  a key lock in the bottom right, and a 3-pin charge port with a rubber flap on the upper left.
- **Inside**, as in `pack.build_up`: twenty 21700 cells (10S2P) lying across the bike, 4 deep × 5
  high on 22.2 mm holder pitch, with nickel strips, fish-paper wrap and EVA foam. The BMS and its
  leads sit in a 12 mm zone on the back face, the lock and contacts in an 18 mm zone underneath.
- **Mounting**: the pack hangs on two pairs of T-head lugs on a nylon slide base, which is screwed to
  the cradle's back plate. Three brass blades on the base enter a pocket in the pack's bottom. The
  steel cradle has a back plate screwed to the carrier block's front face, plus a hook over the block's top.
  It also has a floor, and side cheeks that stop 38 mm below the pack top. A 20 × 4 mm flat brace runs from an
  M5 boss on the head tube to the floor. The controller sits behind the plate's right wing, and the headlight hangs under the floor's front lip.
- **Removal**: turn the key, which pulls the lock bolt out of the notch in the right cheek. Slide the pack
  50 mm up the lugs, which parts the contacts and brings each lug under its entry window. Then pull the pack
  forward out through the cradle's open front.

It writes `battery.glb`/`.blend` (the parts above, in the bike's coordinates, so it overlays the
bike's GLB) and `battery_on_bike.glb`/`.blend` (built with `build_bike.py`). It also renders the pack from
the front, rear and side, an exploded view, the pack's back, a cutaway of the cells, BMS and foam, and
three views on the bike. `battery_report.txt` holds the pack build-up, the fit checks and the
nearest bike parts. Two points move from the JSON: the charge port goes to the BMS zone (the JSON point
is over the cell ends), and the headlight hangs below its JSON point so it clears the pack.
