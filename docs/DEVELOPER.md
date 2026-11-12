# Developer notes

The application is one self-contained file, `index.html`, built by inlining three scripts into `src/page.html`. There are no runtime dependencies and no server.

## Layout

```
index.html            built app (served by GitHub Pages) — do not edit by hand
src/page.html         markup and CSS, with /*@DATA@*/ /*@LIB@*/ /*@UI@*/ placeholders
src/lib.js            DOM-free core: astrometry, HEALPix, target parser, status model, matcher
src/ui.js             live loading, canvas sky map, results table, detail panel, exports
src/data.js           generated: beam geometry (BEAMDATA) and offline snapshot (SNAPSHOT)
tools/build_data.py   data/ -> src/data.js   (--fetch refreshes data/snapshot from the sheet)
build.py, build.sh    src/ -> index.html
data/beams/           full-survey beam-centre tables, 36 beams per field, both bands
data/snapshot/        dated copy of the tracking-sheet tabs (fallback + test fixture)
tests/core.mjs        node, no dependencies
tests/smoke.mjs       Playwright; mocks the sheet from data/snapshot
```

## Update workflow

Edit `src/`, then `./build.sh`, `node tests/core.mjs`, `node tests/smoke.mjs`, commit and push. Pages redeploys from `main`. To refresh the offline snapshot: `./build.sh --data --fetch` (the regression block in `tests/core.mjs` is keyed to the snapshot date and is skipped for a newer one — update it if you want it kept).

## The tracking sheet

Sheet id `1sWCtxSSzTwjYjhxr1_KVLWG2AnrHwSJf_RWQow7wbH0`. Tabs are addressed by gid first, then by name:

| Tab | gid | Columns used |
|---|---|---|
| Survey Fields - Band 1 | 1364788351 | name, obs_start, sbid, processed, validated, aus_src, single_SB_1D_pipeline, Dave_1D_pipeline, associated_tiles |
| Survey Fields - Band 2 | 995376834 | as above |
| Survey Tiles - Band 1 | 1858715798 | tile_id, aus_src, 3d_pipeline |
| Survey Tiles - Band 2 | 780749712 | as above |
| All Observations | 785190940 | name, sbid, project, obs_start, deposited, validated, validation_level, current_state |

`loadTab` in `ui.js` tries, in order, `export?format=csv&gid=…`, `gviz/tq?tqx=out:csv&headers=1&sheet=…`, and gviz JSONP. Each result is validated against the tab's required columns (`TABS[…].need` in `lib.js`). This matters: asking gviz for a tab name that does not exist silently returns the *first* tab, which is how the older script's "Survey Observations - Band 1" query went wrong after the sheet was reorganised.

Field status is derived in `applyStatus`: no SBID → planned; `validated` starting "REJECTED" → rejected; `aus_src` date → processed; `validated` date → validated; otherwise observed. Tile state comes from `3d_pipeline` (date, Running, Failed, WaitingForValidation) and `aus_src`.

## Geometry

- Beam tables name fields as the sheet name minus `EMU_` / `WALLABY_`; all 1014 + 1104 fields match.
- Matching is brute force over fields with a cheap field-centre rejection; 6000 targets take about a second.
- Tiles: HEALPix ring index at N<sub>side</sub> 32 (`ang2pix`, `pix2zphi`, `tileOutline` in `lib.js`); `tests/core.mjs` round-trips all 12 288 pixels.
- Map projections (Mollweide, orthographic) and all drawing are in `drawSky`, which is also used for the detail panel's beam chart and the PNG export.

## Hosting note

The page must be able to fetch `docs.google.com` and `cds.unistra.fr` from the browser. GitHub Pages and a local `file://` copy both allow this; sandboxed hosts that block cross-origin requests will only ever show the snapshot.
