"""Shared helpers for the T-spine asset build: a small DICOM reader (explicit / implicit VR little endian, uncompressed),
stack loading, trilinear sampling, and the rigid map that brings the second table position into the first.
Needs numpy only."""
import os, struct
import numpy as np

LONG = (b"OB", b"OW", b"OF", b"SQ", b"UT", b"UN", b"OD", b"OL", b"UC", b"UR")


def read(path):
    b = open(path, "rb").read()
    i, ts = 132, "1.2.840.10008.1.2"
    while i + 8 <= len(b) and struct.unpack_from("<H", b, i)[0] == 2:          # file meta (always explicit)
        e = struct.unpack_from("<H", b, i + 2)[0]
        vr = b[i + 4:i + 6]
        if vr in LONG:
            ln, p = struct.unpack_from("<I", b, i + 8)[0], i + 12
        else:
            ln, p = struct.unpack_from("<H", b, i + 6)[0], i + 8
        if e == 0x10:
            ts = b[p:p + ln].decode().strip(" \0")
        i = p + ln
    assert ts in ("1.2.840.10008.1.2", "1.2.840.10008.1.2.1"), "unsupported transfer syntax " + ts
    explicit = ts != "1.2.840.10008.1.2"
    h = {}

    def walk(i, end, depth):
        while i + 8 <= end:
            g, e = struct.unpack_from("<HH", b, i)
            if g == 0xFFFE:
                ln = struct.unpack_from("<I", b, i + 4)[0]
                i += 8
                if e == 0xE000 and ln != 0xFFFFFFFF:
                    i = walk(i, i + ln, depth + 1)
                elif e == 0xE0DD and depth:
                    return i
                continue
            vr = None
            if explicit:
                vr = b[i + 4:i + 6]
                if vr in LONG:
                    ln, p = struct.unpack_from("<I", b, i + 8)[0], i + 12
                else:
                    ln, p = struct.unpack_from("<H", b, i + 6)[0], i + 8
            else:
                ln, p = struct.unpack_from("<I", b, i + 4)[0], i + 8
            if (g, e) == (0x7FE0, 0x0010) and depth == 0:
                h["px"] = (p, ln)
                return end
            if ln == 0xFFFFFFFF:
                i = walk(p, end, depth + 1)
                continue
            if vr == b"SQ":
                walk(p, p + ln, depth + 1)
            elif depth == 0:
                h[(g, e)] = b[p:p + ln]
            i = p + ln
        return i

    walk(i, len(b), 0)
    t = lambda k: h[k].decode("latin-1").strip(" \0")
    f = lambda k: [float(x) for x in t(k).split("\\")]
    rows, cols = [struct.unpack("<H", h[(0x28, k)][:2])[0] for k in (0x10, 0x11)]
    signed = struct.unpack("<H", h[(0x28, 0x103)][:2])[0]
    a = np.frombuffer(b, "<i2" if signed else "<u2", rows * cols, h["px"][0]).reshape(rows, cols).astype(np.float32)
    return {"inst": int(t((0x20, 0x13))), "ipp": np.array(f((0x20, 0x32))), "row": np.array(f((0x20, 0x37))[:3]),
            "col": np.array(f((0x20, 0x37))[3:]), "ps": f((0x28, 0x30))[0], "thk": f((0x18, 0x50))[0], "rows": rows, "cols": cols, "a": a}


def load(root, number):
    """All images of DICOM series <number> (folders are named '<number>-<description>-<id>'), in instance order."""
    sd = [s for s in os.listdir(root) if s.split("-")[0] == str(number)][0]
    ds = [read(os.path.join(root, sd, f)) for f in os.listdir(os.path.join(root, sd)) if f.lower().endswith(".dcm")]
    ds.sort(key=lambda d: d["inst"])
    return ds


class Stack:
    """A parallel, evenly spaced stack with its geometry (optionally moved by a rigid map into another frame)."""
    def __init__(self, ds, move=None):
        self.v = np.stack([d["a"] for d in ds])
        self.ps = ds[0]["ps"]; self.thk = ds[0]["thk"]
        ipp = np.array([d["ipp"] for d in ds]); row, col = ds[0]["row"], ds[0]["col"]
        if move is not None:
            R, t = move
            ipp = ipp @ R.T + t; row = R @ row; col = R @ col
        self.ipp, self.row, self.col = ipp, row, col
        step = ipp[1] - ipp[0]
        self.sp = float(np.linalg.norm(step)); self.nrm = step / self.sp

    def sample(self, P):
        """Trilinear sample at LPS points P (..., 3): values and an inside-the-stack mask."""
        d = P - self.ipp[0]
        i, j, k = d @ self.row / self.ps, d @ self.col / self.ps, d @ self.nrm / self.sp
        n, h, w = self.v.shape
        ok = (i >= 0) & (j >= 0) & (k >= -0.5) & (i <= w - 1) & (j <= h - 1) & (k <= n - 0.5)
        k = np.clip(k, 0, n - 1)
        i0, j0, k0 = [np.clip(np.floor(x).astype(int), 0, m - 2) for x, m in ((i, w), (j, h), (k, n))]
        fi, fj, fk = np.clip(i - i0, 0, 1), np.clip(j - j0, 0, 1), np.clip(k - k0, 0, 1)
        out = 0
        for dk in (0, 1):
            for dj in (0, 1):
                for di in (0, 1):
                    out = out + (fk if dk else 1 - fk) * (fj if dj else 1 - fj) * (fi if di else 1 - fi) * self.v[k0 + dk, j0 + dj, i0 + di]
        return np.where(ok, out, 0), ok


def table_move(A, B, reg):
    """Rigid map (R, t) taking patient coordinates of the second table position (the counting localiser, B) into the first
    (the T-spine sagittals, A). 'reg' is the in-plane registration found by tools/register.py: sagittal B[kb] matches
    sagittal A[ka] after turning it by 'deg' and shifting it by 'shift_mm' (along A's row and column)."""
    a, b = A[reg["ka"]], B[reg["kb"]]
    c, s = np.cos(np.radians(reg["deg"])), np.sin(np.radians(reg["deg"]))
    eA = (A[1]["ipp"] - A[0]["ipp"]); eA /= np.linalg.norm(eA)
    eB = (B[1]["ipp"] - B[0]["ipp"]); eB /= np.linalg.norm(eB)
    rowT, colT = a["row"] * c + a["col"] * s, -a["row"] * s + a["col"] * c       # where B's row / column end up in A
    R = np.outer(rowT, b["row"]) + np.outer(colT, b["col"]) + np.outer(eA, eB)
    u, _, vt = np.linalg.svd(R); R = u @ vt                                      # B's slice normal is 0.7 deg off: re-orthogonalise
    cB = b["ipp"] + (b["row"] * b["cols"] + b["col"] * b["rows"]) * b["ps"] / 2
    cA = a["ipp"] + (a["row"] * a["cols"] + a["col"] * a["rows"]) * a["ps"] / 2 + a["row"] * reg["shift_mm"][0] + a["col"] * reg["shift_mm"][1]
    return R, cA - R @ cB
