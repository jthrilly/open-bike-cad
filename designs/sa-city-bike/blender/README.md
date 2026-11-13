# Blender model

`build_bike.py` builds a 3D model of each SA City Bike from its `*_geometry.json`,
so it can be re-run whenever the geometry changes. From `designs/sa-city-bike`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/build_bike.py -- OUT_DIR SA_City_Bike_700C_adult_geometry.json SA_City_Bike_24_kids_geometry.json SA_City_Bike_700C_eassist_geometry.json
```

For each bike it writes `<name>.blend`, `<name>.glb` (in metres, without the ground plane)
and Cycles renders `<name>_side.png` (orthographic, drive side), `<name>_front34.png`,
`<name>_rear34.png` and a saddle close-up `<name>_saddle.png`. It also prints a clearance
report: tyre to crown, seat tube, step tube and down tube, and whether a fender fits under
the crown.

Accessories are built only from the `accessories` section of the geometry (format version 2):
fenders and their stays, the rear rack tubes, the chainguard outline and lip, the ring lock,
the front carrier block and the kickstand. The cockpit (bar, grips, brake levers and twist
shifter) comes from `cockpit`. V-brake arms, pads and the link cable sit on the fork blade
and seatstay below the rim, and the cable housings run from the levers to the brakes and hub. Nothing there is invented by the
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

It writes `school_bag.glb`/`.blend` (the bag alone, straps out), `school_bag_on_bike.glb`/`.blend`
(the bike with the bag clipped on, straps stowed) and renders, and `school_bag_clearance.txt`.
That file reports the gap to every steered part straight ahead, and the steering angle at which
each first touches the bag, with a 25 mm allowance for a child's hand on the grips. It builds
the bike with `build_bike.py`, so it follows any change to the geometry.
