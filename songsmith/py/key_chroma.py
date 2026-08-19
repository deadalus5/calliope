#!/usr/bin/env python
"""Audio-derived key estimate: Krumhansl-Kessler profile correlation over
mean CQT chroma. argv[1] = audio path; stdout = one JSON line:
  {"root": 0-11, "minor": bool, "strength": 0..1}
`strength` is the margin of the best key over the runner-up, scaled — the
TS side treats this as a measured prior for key inference, weightier than a
sheet's tonality field but still never a veto. Charts that barely write
chords (a riff song like Superstition) are exactly why this exists.
"""
import json
import sys

import numpy as np

MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimate(chroma_mean):
    scores = []
    for minor, profile in ((False, MAJOR), (True, MINOR)):
        for root in range(12):
            r = np.corrcoef(np.roll(profile, root), chroma_mean)[0, 1]
            scores.append((r, root, minor))
    scores.sort(reverse=True)
    (r1, root, minor) = scores[0]
    # Runner-up on a DIFFERENT root — relative major/minor siblings are
    # near-ties by construction and shouldn't zero the strength.
    r2 = next((s[0] for s in scores[1:] if s[1] != root), scores[1][0])
    strength = max(0.0, min(1.0, (r1 - r2) * 3.0))
    return {"root": int(root), "minor": bool(minor), "strength": round(float(strength), 3)}


def main():
    try:
        import librosa
        y, sr = librosa.load(sys.argv[1], sr=22050, mono=True)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        print(json.dumps(estimate(chroma.mean(axis=1))))
    except Exception as e:  # noqa: BLE001 — absent estimate just means no prior
        print(json.dumps({"root": 0, "minor": False, "strength": 0, "error": f"{type(e).__name__}: {e}"}))


if __name__ == "__main__":
    main()
