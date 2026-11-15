"""Find where the counting localiser sits relative to the T-spine sagittals.

    python -I tools/register.py "<study folder>"      ->  tools/registration.json (+ qa/reg_qa.png)

The study was acquired in two table positions: the T-spine series (sagittal T1 / T2 / STIR, axial T2 / T1) in the first,
and the large-FOV "counting" sagittal T1 (which reaches C2) in the second, so their DICOM coordinates don't agree.
Both are sagittal T1 spin echo of the same spine, so one mid-line slice of each is matched in-plane: brute force over
the rotation and the slice pairing, masked normalised cross-correlation (FFT) over every shift. Stage 1 scores the whole
image; stage 2 scores only the band holding the vertebral column and cord, where the body is rigid (the skin and back fat
sit differently on the two table set-ups). Needs numpy (+ pillow for the QA picture).
"""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spine_io as io

ROOT = sys.argv[1]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A, B = io.load(ROOT, 2), io.load(ROOT, 8)
G, NC = 2.0, 512                                   # working grid (mm) and canvas (px)


def resample(d, th, band=None):
    """Slice d on the canvas, turned by th about its centre. band = (lo, hi) keeps only that range along the row (mm from centre)."""
    a, ps, n = d["a"], d["ps"], d["rows"]
    jj, ii = np.mgrid[0:NC, 0:NC]
    x, y = (ii - NC / 2) * G, (jj - NC / 2) * G
    c, s = np.cos(th), np.sin(th)
    u, v = (c * x + s * y) / ps + n / 2, (-s * x + c * y) / ps + n / 2
    ok = (u >= 0) & (v >= 0) & (u < n - 1) & (v < n - 1)
    if band: ok &= (x >= band[0]) & (x <= band[1])
    u0, v0 = np.clip(np.floor(u).astype(int), 0, n - 2), np.clip(np.floor(v).astype(int), 0, n - 2)
    fu, fv = u - u0, v - v0
    val = a[v0, u0] * (1 - fu) * (1 - fv) + a[v0, u0 + 1] * fu * (1 - fv) + a[v0 + 1, u0] * (1 - fu) * fv + a[v0 + 1, u0 + 1] * fu * fv
    return np.where(ok, val, 0).astype(np.float32), ok.astype(np.float32)


def mncc(f, mf, m, mm):
    """Masked NCC of f against m for every circular shift (Padfield 2012)."""
    F = np.fft.rfft2; I = lambda x: np.fft.irfft2(x, s=f.shape)
    Ff, Fm, Fmf, Fmm = F(f * mf), F(m * mm), F(mf), F(mm)
    ov = np.maximum(I(Fmf * np.conj(Fmm)), 1e-6)
    sf, sm = I(Ff * np.conj(Fmm)), I(Fmf * np.conj(Fm))
    sff, smm = I(F(f * f * mf) * np.conj(Fmm)), I(Fmf * np.conj(F(m * m * mm)))
    num = I(Ff * np.conj(Fm)) - sf * sm / ov
    den = np.sqrt(np.maximum(sff - sf ** 2 / ov, 0) * np.maximum(smm - sm ** 2 / ov, 0))
    return np.where((den > 1e-3) & (ov > 0.6 * mf.sum()), num / np.maximum(den, 1e-3), -1)


lg = lambda a: np.log1p(a / np.percentile(a, 99) * 20)
wrap = lambda v: v - NC if v > NC / 2 else v


def search(pairs, degs, band, near=None):
    out = []
    for ka, kb in pairs:
        f, mf = resample(A[ka], 0.0, band)
        for deg in degs:
            m, mm = resample(B[kb], np.radians(deg))
            r = mncc(lg(f), mf, lg(m), mm)
            if near is not None:                       # stay within 25 mm of the stage-1 answer
                jj, ii = np.mgrid[0:NC, 0:NC]
                di = (ii - near[0] + NC / 2) % NC - NC / 2; dj = (jj - near[1] + NC / 2) % NC - NC / 2
                r = np.where(np.hypot(di, dj) * G <= 25, r, -1)
            j, i = np.unravel_index(np.argmax(r), r.shape)
            sp = lambda a, b, c: 0.5 * (a - c) / (a - 2 * b + c) if abs(a - 2 * b + c) > 1e-9 else 0.0
            out.append((float(r[j, i]), ka, kb, float(deg), i + sp(r[j, (i - 1) % NC], r[j, i], r[j, (i + 1) % NC]),
                        j + sp(r[(j - 1) % NC, i], r[j, i], r[(j + 1) % NC, i])))
    return sorted(out, reverse=True)


s1 = search([(ka, kb) for ka in (7, 8, 9, 10) for kb in range(2, 9)], np.arange(-20, 20.01, 1.0), None)
print("stage 1 (whole image):", [tuple(round(x, 3) for x in b) for b in s1[:4]])
_, ka, kb, deg, i1, j1 = s1[0]
# A's row runs anterior -> posterior from y = ipp_y; the column of vertebral bodies + cord lies at y = 10..95 mm
y0 = A[ka]["ipp"][1] + A[ka]["rows"] * A[ka]["ps"] / 2
band = (10 - y0, 95 - y0)
d = ka - kb
s2 = search([(a, a - d) for a in (7, 8, 9, 10, 11)], np.arange(deg - 5, deg + 5.01, 0.25), band, (i1, j1))
print("stage 2 (spine band):", [tuple(round(x, 3) for x in b) for b in s2[:6]])
r, ka, kb, deg, si, sj = s2[0]
res = {"ka": int(ka), "kb": int(kb), "deg": float(deg), "shift_mm": [float(wrap(si) * G), float(wrap(sj) * G)], "ncc": float(r)}
json.dump(res, open(os.path.join(HERE, "tools", "registration.json"), "w"))
print(res)

try:
    from PIL import Image
    os.makedirs(os.path.join(HERE, "qa"), exist_ok=True)
    f, _ = resample(A[ka], 0.0); m, _ = resample(B[kb], np.radians(deg))
    m = np.roll(np.roll(m, int(round(wrap(sj))), 0), int(round(wrap(si))), 1)
    n8 = lambda a: np.clip(a / np.percentile(a[a > 0], 99.5), 0, 1) ** 0.7 * 255
    jj, ii = np.mgrid[0:NC, 0:NC]
    chk = ((ii // 12 + jj // 12) % 2 == 0)
    out = np.where(chk, n8(f), n8(m)).astype(np.uint8)[150:350, 190:330]
    Image.fromarray(out).resize((560, 800), Image.BILINEAR).save(os.path.join(HERE, "qa", "reg_qa.png"))
except ImportError:
    pass
