# Changelog

## 1.1.0 — 2026-11-12

- All beams within the maximum offset are now reported for every covering field (previously the three nearest regardless of distance): new "Other beams" table column, full per-SBID lists in the detail panel, shaded on the beam chart and map, and carried through the CSV and SBID-list exports (`beams_within_radius`, `all_sbid_beams`, `beam_rank`).
- "All sky / Globe" switch above the map (shortcut `P`); switching to the globe keeps the current view centre.

## 1.0.0 — 2026-11-12

First public release.

- Cross-match of target lists against all POSSUM Band 1 and Band 2 fields and beams, with live status from the tracking sheet and a dated offline fallback.
- Target input by file drop, paste or quick search; sexagesimal, decimal and Galactic coordinates; name resolution through CDS Sesame.
- Sky map (Mollweide / globe, equatorial / Galactic) of observation status and tile 3D-pipeline status, with beam footprints.
- Detail panel with all covering fields, nearest beams, observation history, tile products and a beam chart.
- CSV, SBID-list and PNG exports with provenance.
