# Robot Preview (URDF, xacro) — evidence

What: the Robot Preview editor (`.urdf`, `.xacro`, also `.urdf.xacro`) — its xacro processor compared with the
reference implementation, the browser harness, interaction checks, and real Orca.

## 1. Library choice: own processor

| Candidate | Licence | CSP | Decision |
| --- | --- | --- | --- |
| [gkjohnson/xacro-parser](https://github.com/gkjohnson/xacro-parser) 0.3.11 | Apache-2.0 | evaluates `${…}` with `expr-eval-fork` 3.0.3, whose bundle contains `new Function` (`toJSFunction`); its loader `fetch`es includes; depends on `yaml` and `yargs` | not used: a CSP scanner flags the bundle, and expr-eval is not Python (no `//`, `**` precedence, int/float, `'a' if c else b`, string methods), so output would differ from ROS xacro |
| [gkjohnson/urdf-loaders](https://github.com/gkjohnson/urdf-loaders) (`urdf-loader` 0.13.1) | Apache-2.0 | no eval; `fetch`es the URDF and meshes; built for its own three.js import | not used: the preview already has three.js and no file/network access, and the kinematics needed here are ~100 lines |

Written instead (`plugin/editor/renderers/urdf/`, ≈ 125 KB of TypeScript, no new vendor bundle):
`xml.ts` (strict XML reader/writer with line numbers, no DOM so tests run in Node), `expr.ts` (tokeniser + parser +
tree-walking evaluator for the Python subset xacro uses, Python int/float semantics and `repr` of floats),
`xacro.ts` (ROS 2 xacro 2.x `eval_all` order: lazy properties with cycle detection, literal typing, block properties,
`default`/`remove`/`scope`/`lazy_eval`, args, macros with `:=`, `^`, `^|`, `*`/`**` blocks, dynamic scoping,
`xacro:call`, `if`/`unless`, `element`/`attribute`, `$(arg|find|optenv|env|eval|dirname|anon)`), `model.ts`
(URDF → links/joints/materials, tree, notes), `load.ts`, and the renderer `urdf.ts`. The three.js bundle gained the
primitive geometries, `Raycaster` and `EdgesGeometry` (+7 KB).

## 2. xacro fidelity against ROS 2 `xacro` 2.1.1 (PyPI, no ROS install needed)

How: `node --experimental-transform-types tools/urdf/xacro-compare.mjs --python <python with xacro>`. Each case is
expanded by `tools/urdf/xacro_ref.py` (the reference; `$(find pkg)` mapped to `package://pkg` as the preview does,
since there is no ROS package index) and by the preview's processor. Both trees are compared (1) as text — every
element and every attribute string, comments and blank text ignored, attributes sorted — and (2) as robot models —
link/joint names, types, parent/child, origins, axes, limits, mimic, geometry numbers, colours within 1e-9.

Committed cases (all written for this repo): [xacro-compare.md](xacro-compare.md), [json](xacro-compare.json)

| Case | Links / joints | Attributes equal | Model numbers equal | Result |
| --- | --- | --- | --- | --- |
| `samples/sample-robot.urdf.xacro` (args, lazy/block/default properties, math, macros with defaults, `^|`, `*`/`**` blocks, recursive macro, if/unless, element/attribute, call, `$(find)`) | 12 / 11 | 225 / 225 | 384 / 384 | ✅ identical |
| `tools/urdf/cases/expressions.xacro` (72 expressions: `/ // % **`, unary minus vs `**`, chained comparisons, `and`/`or` values, ternary, `in`, string `+ *  %`, indexing, `sqrt floor ceil min max round int float atan2 pow radians degrees log hypot copysign`, `math.`/`python.`/`xacro.arg`, `$$` escapes, float repr `1.234e-05`, `1e+20`, `0.30000000000000004`) | 1 / 0 | 74 / 74 | — | ✅ identical |
| `tools/urdf/cases/scopes.xacro` (lazy order, `lazy_eval="false"`, `remove`, `default`, `scope="global"`/`"parent"`, local macros, `^` forwarding, multi-blocks, block properties, conditions on ints/floats/strings) | 7 / 1 | 38 / 38 | 33 / 33 | ✅ identical |
| `samples/sample-macros.xacro` (macro library, no links) | 0 / 0 | — | — | ✅ identical |
| `samples/sample-include.xacro` | — | — | — | skipped: the reference needs the included files |

Local check on public files (**not committed**): ROS [`urdf_tutorial`](https://github.com/ros/urdf_tutorial) (branch
`ros2`, BSD-3-Clause) `urdf/01-myfirst.urdf` … `08-macroed.urdf.xacro`: **8 / 8 identical**
(1,071 / 1,071 attributes, 1,684 / 1,684 model numbers). [`ros-controls/ros2_control_demos`](https://github.com/ros-controls/ros2_control_demos)
(Apache-2.0, master): all 23 `*.urdf.xacro` / `*.urdf` files load without an exception or error; top-level files whose robot
comes from includes show the includes and the unresolved macro calls (warnings, not errors), macro-library files show
their macro list, `openduckmini/mujoco/robot.urdf` (16 links, 44 meshes) draws 44 labelled placeholders.

Known differences from ROS xacro (by design): includes are not read (recorded, the rest continues); where xacro
stops at an error (unknown name, unknown macro, bad condition), the preview records a note and continues;
`$(env)` is empty; `xacro.load_yaml`, `xacro.dotify`, namespaced includes (`ns=`), `xacro:eval-comments` and
keyword arguments in calls are not supported.

## 3. Feature table

| Feature | Status | Notes |
| --- | --- | --- |
| Geometry: box, cylinder, sphere, capsule (ROS 2 extension) | ✅ | cylinders/capsules along Z as URDF specifies |
| Origins xyz / rpy | ✅ | fixed-axis roll-pitch-yaw (Rz·Ry·Rx) |
| Materials: robot-level named, inline colour, named reference | ✅ | sRGB colours, alpha → translucent; textures listed as not loaded |
| Joints: fixed, revolute, continuous, prismatic, floating, planar | ✅ | sliders for the single-axis types (continuous and unlimited revolute ±π, unlimited prismatic ±1 m); floating/planar drawn at rest, counted as 6/3 DOF |
| Limits, axis (normalised), home pose inside limits | ✅ | |
| `mimic` (multiplier, offset, chains), mimic loops | ✅ | mimic sliders are read-only and follow |
| Kinematic tree drives the pose | ✅ | three.js group per joint: origin → motion → child link |
| Meshes (`package://`, `file://`, relative) | ⚠ placeholder | not readable (one file only): primitive collision shapes of the same link drawn translucent with edges, else a marker cube sized from the robot; file-name labels; listed under "Not loaded (external file)"; banner in the view |
| xacro (section 2) | ✅ | includes → "Includes not loaded" + "Unresolved macros" |
| Macro-only xacro | ✅ | lists macros (with params), includes, args |
| Toggles: visual, collision, link frames, joint axes, labels, grid; fit; background | ✅ | |
| Link/joint tree panel, selection (tree or click in 3D) with frame and details | ✅ | phone width: panel is an overlay, hidden until ☰ |
| Info bar: robot name, links, joints, DOF, extents (≈ with placeholders), size | ✅ | |
| Robustness: bad XML (line/column), unknown tags, missing links, two parents, loops, bad numbers, unknown geometry, runaway recursion, expansion > 200k elements | ✅ | notes in the panel; fatal cases end in a friendly error |
| Not done | — | mesh loading (no file access), textures, `<gazebo>`/`<transmission>`/`<ros2_control>` content, `<sensor>`, inertia display, planar/floating sliders, SRDF |

## 4. Browser harness and interactions

- `node tools/harness/run.mjs --only urdf,xacro --profiles desktop-dark,desktop-light,mobile-light,tablet-dark`:
  **40/40** (10 samples × 4 profiles), shots and [results.md](harness/results.md) in [`harness/`](harness/).
  `broken.urdf` (unclosed element) ends in `urdf-xml` with line/column; `broken.xacro` (self-calling macro) ends in
  `xacro-recursion` after 100 levels. (The 404 in the notes is the harness page's favicon.)
- `node tools/harness/urdf-interact.mjs --out docs/evidence/urdf/interact`: **19/19** — idle draws nothing; sliders
  move the arm, value shown in degrees, reset pose restores the exact picture; collision/frames/axes/visual toggles;
  clicking the robot in 3D selects a link in the tree; tree click shows the parent joint; gripper `finger_joint`
  drives three mimic joints (±40.1°); 4 mesh placeholders labelled and listed; `sample-large.urdf` (141 links,
  132 sliders) ready in 0.3–0.4 s with a median slider step of about 33 ms (two animation frames); phone panel.
  Shots and [results.json](interact/results.json) in [`interact/`](interact/).
- Whole harness (all formats): `node tools/harness/run.mjs --profiles desktop-dark,desktop-light,mobile-light,tablet-dark`
  **508/508** (127 samples × 4 profiles).
- Unit tests `plugin/editor/renderers/urdf/urdf.test.ts`: 12 tests (XML, expressions, xacro, URDF model, notes,
  failures, 2,000-link chain).

## 5. Real Orca (1.4.263, Windows 11)

A copy of `plugin/` with id `file-preview-urdf` and only the Robot editor was dev-loaded, each file opened with
`orca plugin open local.file-preview-urdf --editor …`, captured with `orca plugin shot --window` (project sidebar
cropped), then unloaded. `orca plugin logs` showed one line, the expected `preview refused: xacro-recursion` for
`broken.xacro`.

URDF and xacro files are XML text, so Orca opens them in its **Source view first** and the preview is behind the
tab's view toggle ([source-view-utf8.png](orca/source-view-utf8.png)). To capture without clicking in the user's
window, the captured copies were saved as UTF-16 (Orca hands those to the plugin editor directly; the decoder reads
the BOM), as for KiCad. Screenshots: [arm](orca/arm.png), [mobile base](orca/mobile.png),
[mimic gripper with placeholders](orca/gripper.png), [xacro robot](orca/robot.png),
[xacro with missing includes](orca/include.png), [141-link robot](orca/large.png), [problems as notes](orca/problems.png),
[macro library](orca/macros.png), [broken.xacro](orca/broken.png).

## 6. Samples

All written for this repo (MIT): `samples/sample-arm.urdf` (6-axis arm, primitives), `sample-mobile.urdf`
(continuous wheels, caster, prismatic mast, capsule bumper, gazebo/ros2_control tags), `sample-gripper.urdf` (mimic
chain, `package://`/`file://`/relative meshes), `sample-problems.urdf`, `sample-large.urdf`
(`tools/urdf/make-urdf-samples.mjs`), `sample-robot.urdf.xacro`, `sample-include.xacro`, `sample-macros.xacro`,
`broken.urdf`, `broken.xacro`; comparison cases in `tools/urdf/cases/`.
