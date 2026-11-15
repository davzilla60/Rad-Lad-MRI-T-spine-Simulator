# MR-I Ready — Thoracic Spine

An embeddable, single-file teaching simulator for the Rad-Lad website, built on the same engine and layout as the
other MR-I Ready simulators (shoulder, elbow, ankle, femur, tibia + fibula). Every image comes from **one real,
de-identified thoracic spine MRI** in a public research collection (The Cancer Imaging Archive, CC BY 4.0 — see
`CREDITS.md`), shown with its true geometry. **It's a demonstration only.**

Marker: **Spine and Dandy** — sagittals straight along the spine from C7 to L1, the axial block tilted square to the
canal through T5–T9, with the patient supine, arms by the sides and a bolster under the knees.

Source images: <https://www.cancerimagingarchive.net/collection/cmb-mml/>

## Flow

1. **Patient set-up.** Supine, **head first**, on the spine array built into the table, skin marker on the back,
   landmark on the mid-sternum. Choose how the patient lies (the 3-D room changes pose):
   - arms by the sides, knees over a bolster — correct;
   - legs flat, no knee support — the lower back arches, the patient shifts: motion;
   - hands clasped on the chest — breathing motion in front of the spine, and a skin-to-skin loop.
2. **Localiser.** The study's own 3-plane scout (360 mm FOV) is "acquired" line by line from its k-space with an
   inverse FFT.
3. **Optional C-spine localiser.** One click (`cloc`) from the protocol: a fast, large-FOV (480 mm) mid-line sagittal
   from the skull base to T11. It lands in the tray and on the SAG panel, and the plan boxes are drawn on it in their
   true position, so you can see where C7 is before placing the T-spine FOV. An **L-spine localiser** (`lloc`) is
   offered the same way once images for it are in the build — this study has none.
4. **Sagittal first.** Centre the stack on the spine on the coronal and axial localisers, keep it straight along the
   spine, cover the vertebrae edge to edge, and size the FOV to hold C7 at the top and L1 at the bottom (≈ 340 mm).
   T2, T1 and STIR.
5. **Axial.** Unlocks once the sagittal is scanned. Drag (or tap) a sagittal from the tray onto the **SAG** panel to
   unlock the tilt handle, then tilt the block square to the canal through T5–T9 (reference 7.1°, graded ± 5°: a
   straight stack fails) and cover T5 to T9 with a ≈ 200 mm FOV. T2 and T1.
6. **Scan → images.** Each scan shows the acquired slices inside your stack, cropped to your FOV.
7. **Debrief.** Coverage and angle per plan, position, hero images (the sagittal shows your axial block against the
   acquired tilt; the C-spine localiser, if run, shows your sagittal FOV), a sequences-to-consider table and the
   marker.

CLI: `bolster | flat | arms`, `load`, `loc`, `cloc`, `plan sag|ax`, `auto`, `slices`, `thick`, `gap`, `fov`, `tilt`,
`straight`, `use <series>`, `restore <sag|cor|ax>`, `scan`, `back`, `finish`, `help`.

## Files

- `tspine.embed.html` is the self-contained deliverable (~4.5 MB, every image inlined). `index.html` is an
  identical copy for one-drop hosting.
- `tspine.html` + `app.js` + `room3d.js` + `assets/` are the editable sources. `tspine.html` also runs straight from
  disk: the localisers are repeated as data URIs in `assets/calib.js` so the k-space step works under `file://`.
  After editing, rebuild with `python inline.py`.
- `tools/gen_assets.py` rebuilds `assets/` (images, scout, geometry, levels) from the study's DICOM series folders;
  `tools/register.py` (run once, before it) finds where the C-spine localiser sits relative to the T-spine series
  and writes `tools/registration.json`; `tools/landmarks.json` holds the disc positions and hand-picked landmarks.
  All three need only numpy + pillow:
  `python -I tools/register.py "<study folder>"` then `python -I tools/gen_assets.py "<study folder>"`.
- The 3-D room loads three.js 0.160 from jsDelivr; without it the set-up step falls back to a flat drawing.

## Outstanding

- Radiologist / radiographer review of the level names in the read-outs and the teaching text.
- L-spine localiser images (none in this study).
- Confirm the source study came from the collection's open (CC BY 4.0) tier — see `CREDITS.md`.

Educational simulation — not a medical device, not for clinical use.
