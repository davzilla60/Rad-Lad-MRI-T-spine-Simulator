"""Build ../assets from the thoracic spine MRI study (Prometheus "MRI/Various/Patient Group 1/cmb_mml/MSB-00498").

    python -I tools/register.py   "<study folder holding the series folders>"     (once: writes tools/registration.json)
    python -I tools/gen_assets.py "<study folder holding the series folders>"

Needs numpy + pillow only (tools/spine_io.py reads this study's uncompressed little-endian DICOM).
The study has two table positions. The T-spine series (3-plane scout, sagittal T1 / T2 / STIR, axial T2 / T1) share one
coordinate frame and are used exactly as acquired. The large-FOV "counting" sagittal T1 was acquired in the second
position; tools/register.py finds the rigid move that lays it over the T-spine sagittals, and its geometry is stored in
the first frame. The post-contrast series (also second position) are not used.
Writes loc_sag/cor/ax.png (three real scout images), <series>_NN.jpg, and calib.json / calib.js: the DICOM geometry
(IPP / IOP / pixel spacing) of every image, the vertebral levels and the landmarks. All coordinates are DICOM patient
(LPS) millimetres. Only pixels and geometry are read from the study; every label comes from SERIES below.
"""
import base64, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spine_io as io

ROOT = sys.argv[1]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT, QA = os.path.join(HERE, "assets"), os.path.join(HERE, "qa")
os.makedirs(OUT, exist_ok=True); os.makedirs(QA, exist_ok=True)
LMJ = json.load(open(os.path.join(HERE, "tools", "landmarks.json")))
REG = json.load(open(os.path.join(HERE, "tools", "registration.json")))

# (DICOM series, id, task, plane, label, params, seconds per slice, shipped size, window percentile, gamma)
SERIES = [
    (6, "sag_t2",   "sag", "sag", "T2",   "FSE · TR 2500 / TE 85 · 3 mm",            10.0, 512, 99.7, 1.0),
    (2, "sag_t1",   "sag", "sag", "T1",   "FSE · TR 720 / TE 10 · 3 mm",              9.0, 512, 99.7, 1.0),
    (4, "sag_stir", "sag", "sag", "STIR", "TR 5916 / TE 47 / TI 149 · 3 mm",         12.0, 512, 99.8, 0.9),
    (8, "cnt_t1",   "cnt", "sag", "T1",   "FSE · TR 559 / TE 7 · 3 mm · 480 mm FOV",  5.0, 512, 99.8, 0.75),
    (3, "ax_t2",    "ax",  "ax",  "T2",   "FSE · TR 3328 / TE 98 · 4 mm",             8.0, 384, 99.7, 1.0),
    (7, "ax_t1",    "ax",  "ax",  "T1",   "FSE · TR 578 / TE 9 · 4 mm",               7.0, 384, 99.7, 1.0),
]
SAG_T1 = io.load(ROOT, 2)
MOVE = io.table_move(SAG_T1, io.load(ROOT, 8), REG)          # second table position -> first

r5 = lambda v: [round(float(x), 5) for x in v]
calib = {"ser": {}}
for num, sid, task, plane, label, params, spl, size, pct, gam in SERIES:
    ds = io.load(ROOT, num)
    st = io.Stack(ds, MOVE if sid == "cnt_t1" else None)
    hi = np.percentile(st.v[st.v > st.v.max() * 0.02], pct)
    for k in range(len(ds)):
        a8 = (np.clip(st.v[k] / hi, 0, 1) ** gam * 255).round().astype(np.uint8)
        im = Image.fromarray(a8)
        if size != im.width: im = im.resize((size, size), Image.LANCZOS)
        im.save(os.path.join(OUT, "%s_%02d.jpg" % (sid, k)), quality=82, optimize=True)
    f = ds[0]["rows"] / size
    ps = st.ps * f
    ipp = st.ipp + (st.row + st.col) * st.ps * (f - 1) / 2                     # centre of the new first pixel
    calib["ser"][sid] = {"task": task, "plane": plane, "seq": label, "params": params, "n": len(ds),
                         "ipp": [[round(float(x), 2) for x in p] for p in ipp], "row": r5(st.row), "col": r5(st.col),
                         "ps": round(float(ps), 6), "cols": size, "rows": size, "nrm": r5(st.nrm), "sp": round(st.sp, 3),
                         "thk": st.thk, "spl": spl, "pad": 2}
    print(sid, len(ds), "slices · centre", (ipp[len(ds) // 2] + (st.row + st.col) * ps * size / 2).round(1), "· normal", st.nrm.round(3))

# ---- the 3-plane localiser: one real scout image per plane (GRE, 360 mm FOV, 256 matrix, 5 mm) ----
scout = io.load(ROOT, 5)
calib["loc"] = {"n": 256, "fov": round(scout[0]["ps"] * 256, 1)}
locimg = {}
for p, k in LMJ["scout"].items():
    d = scout[k]
    hi = np.percentile(d["a"], 99.6)
    name = os.path.join(OUT, "loc_%s.png" % p)
    Image.fromarray((np.clip(d["a"] / hi, 0, 1) ** 0.85 * 255).round().astype(np.uint8)).save(name, optimize=True)
    locimg[p] = "data:image/png;base64," + base64.b64encode(open(name, "rb").read()).decode()
    calib["loc"][p] = {"ipp": [round(float(x), 2) for x in d["ipp"]], "row": r5(d["row"]), "col": r5(d["col"]),
                       "ps": round(d["ps"], 6), "cols": 256, "rows": 256}
    print("loc", p, "scout image", k, "ipp", d["ipp"].round(1))

# ---- vertebral levels + landmarks ----
X0 = LMJ["midline_x"]
def bodies(discs):
    """Centre of each vertebral body = midway between the discs above and below it."""
    out = []
    for name, a, b in zip(LMJ["names"], discs[:-1], discs[1:]):
        out.append([name, [X0, round((a[1] + b[1]) / 2, 1), round((a[2] + b[2]) / 2, 1)]])
    return out
calib["lv"] = bodies(LMJ["discs"])                       # as seen on the T-spine series
calib["lvc"] = bodies(LMJ["discs_counting"])             # as seen on the counting localiser (the patient lay slightly differently)
calib["disc"] = [[d[0], d[2]] for d in LMJ["discs"]]     # disc heights (z), top to bottom
lv = dict((n, p) for n, p in calib["lv"])
calib["lm"] = dict(LMJ["extra"])
calib["lm"]["dens"] = [X0 - 2.6, -9.0, 36.0]
for n in ("C7", "T1", "T5", "T6", "T7", "T9", "T12", "L1"):
    calib["lm"][n.lower()] = lv[n]

ax = calib["ser"]["ax_t2"]; n = np.array(ax["nrm"]); n = n if n[2] > 0 else -n
calib["real"] = {"axtilt": round(float(np.degrees(np.arctan2(-n[1], n[2]))), 1),       # axial block: tilt on the sagittal
                 "axcor": round(float(np.degrees(np.arctan2(n[0], n[2]))), 1)}
json.dump(calib, open(os.path.join(OUT, "calib.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
open(os.path.join(OUT, "calib.js"), "w", encoding="utf-8").write(
    "window.MRS_CALIB=" + json.dumps(calib, separators=(",", ":"), ensure_ascii=False) + ";\n" +
    "window.MRS_LOCIMG=" + json.dumps(locimg, separators=(",", ":")) + ";\n")     # localisers as data URIs: k-space works from file://

# ---- QA: levels and landmarks drawn on the nearest shipped slices ----
def qa(sid, pts, name, k=None):
    s = calib["ser"][sid]; ipp = np.array(s["ipp"]); r = np.array(s["row"]); c = np.array(s["col"]); nrm = np.array(s["nrm"])
    if k is None: k = int(np.argmin(np.abs((np.array(pts[0][1]) - ipp) @ nrm)))
    im = Image.open(os.path.join(OUT, "%s_%02d.jpg" % (sid, k))).convert("RGB"); z = 1024 // im.width
    im = im.resize((im.width * z, im.height * z), Image.BILINEAR); d = ImageDraw.Draw(im)
    for nm, P in pts:
        x, y = (np.array(P) - ipp[k]) @ r / s["ps"] * z, (np.array(P) - ipp[k]) @ c / s["ps"] * z
        d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 60, 60)); d.text((x + 8, y - 5), nm, fill=(255, 255, 0))
    im.save(os.path.join(QA, name))
qa("sag_t2", calib["lv"], "qa_levels_sag.png")
qa("cnt_t1", calib["lvc"], "qa_levels_cnt.png")
qa("ax_t2", [(k, v) for k, v in calib["lm"].items() if k in ("fl", "fr", "ant", "sp", "cord")], "qa_ax.png")
print("ok", {k: v["n"] for k, v in calib["ser"].items()}, calib["real"])
