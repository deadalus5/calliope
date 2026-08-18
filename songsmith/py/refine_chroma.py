#!/usr/bin/env python
"""Chroma refinement for Song Maps.

Contract (see songsmith/src/refine.ts, the only caller):
  argv[1] = path to a JSON request:
    { "audio": "/abs/path.m4a",
      "beatsMs": [..],                       # the allin1 grid — stays authoritative
      "sections": [{"startBeat": i, "endBeat": j}],      # j exclusive
      "chords": [{"i": globalIdx, "sectionIdx": s, "beatIndex": b,
                   "rootPc": 0-11, "pcs": [..]}],
      "bandBeats": 2 }
  stdout = one JSON response:
    { "ok": true, "refined": [{"i": globalIdx, "beatIndex": b}],
      "confidence": 0..1, "meanAbsShiftBeats": x, "error": null }

Python does ZERO music theory — pitch-class sets arrive in the request.
Each section runs a small banded monotone DP over chord-boundary
placements (+-bandBeats around the fused spot, strictly increasing,
section edges pinned); the objective is beat-synchronous CQT-chroma
cosine cost against per-chord templates. Output stays ON the beat grid —
sub-beat placement is the tap layer's job.

--selftest: runs the DP against synthetic chroma with a known
misplaced boundary and asserts recovery (no audio, no librosa needed).
"""
import json
import sys

import numpy as np

NEUTRAL_COST = 0.5  # per-beat cost for beats before a section's first chord
                    # when no previous chord exists to model them


def build_templates(chords):
    """(n, 12) L2-normalized: root 1.0, chord pcs 0.7, off-chord 0.05."""
    t = np.full((len(chords), 12), 0.05)
    for k, ch in enumerate(chords):
        for pc in ch["pcs"]:
            t[k, pc % 12] = 0.7
        t[k, ch["rootPc"] % 12] = 1.0
    norms = np.linalg.norm(t, axis=1, keepdims=True)
    return t / np.maximum(norms, 1e-9)


def dp_refine_section(cost, prev_cost, fused, start, end, band):
    """cost: (n, L) per-chord per-beat cost over beats [start, end).
    prev_cost: (L,) cost of the chord sounding BEFORE this section (models
    beats before the first placement). fused: absolute fused beat indices,
    ascending. Returns (refined absolute indices, total cost at optimum)."""
    n = len(fused)
    L = end - start
    if n == 0 or L <= 0:
        return list(fused), 0.0

    pref = np.zeros((n, L + 1))
    pref[:, 1:] = np.cumsum(cost, axis=1)
    prev_pref = np.zeros(L + 1)
    prev_pref[1:] = np.cumsum(prev_cost)

    def span(j, b0, b1):  # chord j active on absolute beats [b0, b1)
        return pref[j, b1 - start] - pref[j, b0 - start]

    cands = []
    for j, f in enumerate(fused):
        if j == 0 and f == start:
            cands.append([f])
        else:
            lo = max(start, f - band)
            hi = min(end - 1, f + band)
            cands.append(list(range(lo, hi + 1)) if hi >= lo else [f])

    INF = float("inf")
    # best[j][ci]: min cost of beats [cands[j][ci], end) with chord j there.
    best = [[INF] * len(c) for c in cands]
    choice = [[None] * len(c) for c in cands]
    for ci, b in enumerate(cands[n - 1]):
        best[n - 1][ci] = span(n - 1, b, end)
    for j in range(n - 2, -1, -1):
        for ci, b in enumerate(cands[j]):
            for cj, b2 in enumerate(cands[j + 1]):
                if b2 <= b or best[j + 1][cj] == INF:
                    continue
            # (loop kept flat for clarity)
                v = span(j, b, b2) + best[j + 1][cj]
                if v < best[j][ci]:
                    best[j][ci], choice[j][ci] = v, cj
            if best[j][ci] == INF:
                # No monotone room for the rest — pin this and everything
                # after to fused (degenerate, tiny sections).
                return list(fused), float(prev_pref[fused[0] - start] + span(0, fused[0], end))

    total, ci0 = INF, 0
    for ci, b in enumerate(cands[0]):
        v = best[0][ci] + prev_pref[b - start]
        if v < total:
            total, ci0 = v, ci

    out = []
    j, ci = 0, ci0
    while j < n:
        out.append(cands[j][ci])
        ci = choice[j][ci]
        j += 1
        if j < n and ci is None:
            # degenerate chain — keep fused for the tail
            out.extend(fused[j:])
            break
    return out, float(total)


def refine(beat_chroma, req):
    """beat_chroma: (12, numBeats) L2-normalized per column."""
    chords = req["chords"]
    band = int(req.get("bandBeats", 2))
    templates = build_templates(chords)
    num_beats = beat_chroma.shape[1]

    refined = {ch["i"]: ch["beatIndex"] for ch in chords}
    total_cost = 0.0
    total_beats = 0
    shifts = []

    for s_idx, sec in enumerate(req["sections"]):
        start = max(0, int(sec["startBeat"]))
        end = min(num_beats, int(sec["endBeat"]))
        in_sec = [k for k, ch in enumerate(chords) if ch["sectionIdx"] == s_idx]
        in_sec.sort(key=lambda k: chords[k]["beatIndex"])
        if not in_sec or end <= start:
            continue
        fused = [chords[k]["beatIndex"] for k in in_sec]
        seg = beat_chroma[:, start:end]
        cost = 1.0 - templates[in_sec] @ seg
        first_global = chords[in_sec[0]]["i"]
        prev = next((ch for ch in chords if ch["i"] == first_global - 1), None)
        if prev is not None:
            prev_cost = 1.0 - templates[[chords.index(prev)]] @ seg
            prev_cost = prev_cost[0]
        else:
            prev_cost = np.full(end - start, NEUTRAL_COST)
        placed, cost_at_opt = dp_refine_section(cost, prev_cost, fused, start, end, band)
        for k, b in zip(in_sec, placed):
            shifts.append(abs(b - chords[k]["beatIndex"]))
            refined[chords[k]["i"]] = int(b)
        total_cost += cost_at_opt
        total_beats += end - start

    confidence = 1.0 - (total_cost / total_beats) if total_beats else 0.0
    return {
        "ok": True,
        "refined": [{"i": i, "beatIndex": b} for i, b in sorted(refined.items())],
        "confidence": round(float(confidence), 4),
        "meanAbsShiftBeats": round(float(np.mean(shifts)) if shifts else 0.0, 4),
        "error": None,
    }


def beat_sync_chroma(audio_path, beats_ms):
    import librosa
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    frames = librosa.time_to_frames([ms / 1000.0 for ms in beats_ms], sr=sr, hop_length=hop)
    frames = np.clip(frames, 0, max(0, chroma.shape[1] - 1))
    cols = []
    for b in range(len(beats_ms)):
        f0 = frames[b]
        f1 = frames[b + 1] if b + 1 < len(beats_ms) else chroma.shape[1]
        seg = chroma[:, f0:max(f0 + 1, f1)]
        cols.append(seg.mean(axis=1))
    m = np.stack(cols, axis=1)
    norms = np.linalg.norm(m, axis=0, keepdims=True)
    return m / np.maximum(norms, 1e-9)


def selftest():
    # 24 beats, one section [0, 24). A (pcs 9,1,4) truly sounds beats 0..11,
    # D (pcs 2,6,9) beats 12..23 — but fusion placed D a beat EARLY (11) in
    # one run and a beat LATE (13) in another. The DP must recover 12 both
    # ways within band 2.
    a_pcs, d_pcs = [9, 1, 4], [2, 6, 9]
    chroma = np.zeros((12, 24))
    for b in range(24):
        for pc in (a_pcs if b < 12 else d_pcs):
            chroma[pc, b] = 1.0
    chroma /= np.maximum(np.linalg.norm(chroma, axis=0, keepdims=True), 1e-9)
    for wrong in (11, 13):
        req = {
            "beatsMs": [b * 500 for b in range(24)],
            "sections": [{"startBeat": 0, "endBeat": 24}],
            "chords": [
                {"i": 0, "sectionIdx": 0, "beatIndex": 0, "rootPc": 9, "pcs": a_pcs},
                {"i": 1, "sectionIdx": 0, "beatIndex": wrong, "rootPc": 2, "pcs": d_pcs},
            ],
            "bandBeats": 2,
        }
        res = refine(chroma, req)
        placed = {r["i"]: r["beatIndex"] for r in res["refined"]}
        assert placed[1] == 12, f"boundary fused at {wrong} not recovered: {placed}"
        assert placed[0] == 0
        assert res["confidence"] > 0.8, res
    print("SELFTEST OK")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        selftest()
        return
    try:
        with open(sys.argv[1]) as f:
            req = json.load(f)
        beat_chroma = beat_sync_chroma(req["audio"], req["beatsMs"])
        print(json.dumps(refine(beat_chroma, req)))
    except Exception as e:  # noqa: BLE001 — the TS side surfaces this string
        print(json.dumps({
            "ok": False, "refined": [], "confidence": 0,
            "meanAbsShiftBeats": 0, "error": f"{type(e).__name__}: {e}",
        }))


if __name__ == "__main__":
    main()
