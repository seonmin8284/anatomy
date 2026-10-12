# LEGO parts from BrickLink Studio

This folder draws LEGO parts and models in the Anatomy style, reading the
LDraw library that ships with BrickLink Studio 2.0 in place (nothing is copied;
set `STUDIO_DIR` if Studio lives somewhere other than `C:/Program Files/Studio 2.0`).

- `ldraw.mjs` resolves parts through Studio's own path indexes (low, normal and
  high detail primitives), flattens each part's sub-file tree with BFC winding,
  reads colours from `LDConfig.ldr` and names and BrickLink numbers from
  `data/StudioPartDefinition2.txt`, and opens `.io` files (a zip with the model
  inside as LDraw).
- `render.mjs` paints the triangles with the kit's camera and four-tone light.
  A depth buffer drops faces that are completely hidden, decides which face is
  in front wherever two overlap (a topological sort, so painter's order no
  longer decides who covers whom), and clips LDraw's edges to what is visible,
  with conditional edges kept only on the silhouette. The
  same function runs in the page, so every figure can be dragged to turn.
- `units.mjs` holds LEGO's two measuring systems (below): snapping, grid checks,
  sizes in both systems, and the rulers drawn under every figure.
- `lego.mjs` is the command line.

```bash
cd lego
node lego.mjs find gear 24                     # search Studio's part table
node lego.mjs part 3001 --color red            # one part, by LDraw / BrickLink / LDD number or name
node lego.mjs part 32523 --tone                # in the kit's paper tones instead of LEGO colour
node lego.mjs sheet 3001 3647 32523 3062b 3023 # several parts in a row, one scale
node lego.mjs model "C:/Program Files/Studio 2.0/Sample/Banana.io" --light
node lego.mjs model my-model.ldr               # .ldr or .mpd exported from Studio
node lego.mjs build examples/grid.bld          # place parts in studs and plates
```

Flags: `--light`, `--tone`, `--color <code|name>`, `--azimuth <deg>`,
`--detail low|normal|high`, `--out <file>`. Pages land in `lego/out/`; open them through any static server (their script is a module).

### LEGO units

| | real | LDraw units (1 LDU = 0.4 mm) |
|---|---|---|
| stud pitch, across | 8.0 mm | 20 |
| finest offset across: half a stud | 4.0 mm | 10 |
| plate, the finest step up = 0.4 stud | 3.2 mm | 8 |
| brick = 3 plates = 1.2 studs | 9.6 mm | 24 |

- **Build files** place parts on these grids, one per line:
  `<part> <colour> <x> <y> <z> [r90|r180|r270]`. `x` and `y` are studs to the
  part's footprint corner, snapped to half a stud; `z` is plates from the floor to
  its underside, snapped to whole plates. Anything moved is reported, overlapping
  parts are flagged, and the model is also written as LDraw to `out/<title>.ldr`
  for Studio. See `examples/grid.bld`.
- **Imported models** are checked: upright parts against the half-stud and plate
  grid, relative to the first; parts on their side or at an angle are counted but
  not checked. Sideways building lands parts on half plates, since one stud is
  2.5 plates, so a SNOT model reports those as off grid by 4 LDU.
- **Every figure** carries rulers on its far sides (a tick each half stud, long
  each stud; up a post, a tick each plate, long each brick) and a readout of its
  size in studs, plates and millimetres.

Limits: some `.io` files keep their model encrypted inside the zip (two of
Studio's three samples do); export those from Studio with File > Export As >
LDraw and use the `.ldr`. Models over 20,000 faces are drawn once and are not
turnable in the page. Half-stud snapping keeps a part on the grid but does not
check that it can actually attach there (that needs Studio's connectivity data).
