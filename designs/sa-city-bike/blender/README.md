# Blender model

`build_bike.py` builds a 3D model of each SA City Bike from its `*_geometry.json`,
so it can be re-run whenever the geometry changes. From `designs/sa-city-bike`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/build_bike.py -- OUT_DIR SA_City_Bike_700C_adult_geometry.json SA_City_Bike_24_kids_geometry.json
```

For each bike it writes `<name>.blend`, `<name>.glb` (in metres, without the ground plane)
and Cycles renders `<name>_side.png` (orthographic, drive side), `<name>_front34.png`,
`<name>_rear34.png` and a saddle close-up `<name>_saddle.png`. It also prints a clearance
report: tyre to crown, seat tube, step tube and down tube, and whether a fender fits under
the crown.

The rear rack comes from `accessories.rear_rack` when it holds geometry. The saddle is a
sprung leather city saddle (twin coil springs, rivets) sized from `saddle.saddle_length`.

Options: `--no-render` skips the renders; `--samples N` sets Cycles samples (default 96).
