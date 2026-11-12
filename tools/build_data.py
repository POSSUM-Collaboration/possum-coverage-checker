#!/usr/bin/env python3
"""Build src/data.js: the embedded beam geometry and the offline status snapshot.

  python3 tools/build_data.py            # rebuild from data/beams and data/snapshot
  python3 tools/build_data.py --fetch    # first refresh data/snapshot from the live tracking sheet

BEAMDATA  - beam centres (36 per field, little-endian float32 RA/Dec pairs, base64) for both bands
SNAPSHOT  - a dated copy of the tracking-sheet tabs, used only when the live sheet cannot be reached
"""
import base64, collections, csv, datetime, json, pathlib, struct, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHEET = "https://docs.google.com/spreadsheets/d/1sWCtxSSzTwjYjhxr1_KVLWG2AnrHwSJf_RWQow7wbH0/export?format=csv&gid="
TABS = {"fields_band1": "1364788351", "fields_band2": "995376834", "tiles_band1": "1858715798",
        "tiles_band2": "780749712", "all_observations": "785190940"}
FCOLS = ["name", "obs_start", "sbid", "processed", "validated", "aus_src", "single_SB_1D_pipeline",
         "Dave_1D_pipeline", "associated_tiles"]
ACOLS = ["name", "sbid", "project", "obs_start", "deposited", "validated", "validation_level", "current_state"]
SNAP = ROOT / "data" / "snapshot"


def rows(name):
    with open(SNAP / f"{name}.csv", newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def fetch():
    for name, gid in TABS.items():
        text = urllib.request.urlopen(SHEET + gid, timeout=60).read().decode("utf-8")
        need = "tile_id" if name.startswith("tiles") else "sbid"
        if need not in text.splitlines()[0]:
            sys.exit(f"{name}: unexpected columns - has the sheet layout changed?")
        (SNAP / f"{name}.csv").write_text(text, encoding="utf-8")
        print("fetched", name)
    (SNAP / "DATE").write_text(datetime.date.today().isoformat() + "\n")


def main():
    if "--fetch" in sys.argv:
        fetch()
    beams = {}
    for band in (1, 2):
        by = collections.OrderedDict()
        with open(ROOT / "data" / "beams" / f"full_survey_band{band}_beam_center.csv", newline="") as fh:
            for r in csv.DictReader(fh):
                by.setdefault(r["SB"], []).append(
                    (int(r["beam no"]), float(r["beam center ra [deg]"]), float(r["beam center dec [deg]"])))
        for sb, v in by.items():
            if [b[0] for b in v] != list(range(1, 37)):
                sys.exit(f"band {band} field {sb}: expected beams 1-36 in order")
        buf = b"".join(struct.pack("<2f", ra, dec) for v in by.values() for _, ra, dec in v)
        beams[band] = {"names": list(by), "b64": base64.b64encode(buf).decode()}
    snap = {"date": (SNAP / "DATE").read_text().strip(), "fields": {}, "tiles": {}, "obs": None}
    for band in (1, 2):
        snap["fields"][band] = [[r[c] for c in FCOLS] for r in rows(f"fields_band{band}")]
        snap["tiles"][band] = "\n".join(
            r["tile_id"] + (f";{r['aus_src']};{r['3d_pipeline']}" if r["aus_src"] or r["3d_pipeline"] else "")
            for r in rows(f"tiles_band{band}") if r["tile_id"])
    snap["obs"] = [[r[c] for c in ACOLS] for r in rows("all_observations")]
    snap["fcols"], snap["acols"] = FCOLS, ACOLS
    js = ("const BEAMDATA=" + json.dumps(beams, separators=(",", ":")) + ";\nconst SNAPSHOT="
          + json.dumps(snap, separators=(",", ":")) + ";\n")
    (ROOT / "src" / "data.js").write_text(js, encoding="utf-8")
    print(f"src/data.js: {len(js)} bytes, snapshot {snap['date']}")


if __name__ == "__main__":
    main()
