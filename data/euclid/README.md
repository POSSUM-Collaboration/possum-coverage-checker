# Euclid DR1-Foundation tile footprints

Pinned on 2026-11-16 from the NASA/IPAC IRSA Euclid Data Explorer's DR1 **image tile coverage** MOCs:

- Wide: https://nasa-irsa-euclid-dr1.s3.amazonaws.com/dr1/MOC/euclid_dr1_wide.moc.moc.fits
- Deep: https://nasa-irsa-euclid-dr1.s3.amazonaws.com/dr1/MOC/euclid_dr1_deep.moc.moc.fits

The doubled `.moc` in the upstream filenames is intentional. Local names omit the duplicate.

Provenance: https://irsa.ipac.caltech.edu/applications/euclid/ uses these URLs in its DR1 Images search. See the official guide at https://irsa.ipac.caltech.edu/onlinehelp/euclid/euclid/searching.html (DR1 Images), which distinguishes the red wide and blue deep tile MOCs from the yellow **planned** survey and the separate catalogue MOCs. These are not the planned survey, Q1, or digitised press-release images.

Both FITS files use NUNIQ HEALPix indexing, celestial/equatorial coordinates (`COORDSYS=C`) and maximum order 13 (approximately 26 arcsec cell scale). They contain 201,207 wide and 18,575 deep cells. Original FITS bytes are retained; SHA-256 hashes and exact coverage areas are recorded in generated `src/euclid-data.js`.

The tile MOCs cover 2383.9865004467874 deg² (wide) and 91.82038452206996 deg² (deep). Tile footprints include margins and can contain unobserved/masked pixels; these areas are not the release's validated science area (~1900 deg²). Deep means the archive's deep tile category, not a guarantee of uniform depth. This visual overlay does not change POSSUM target matching or provide Euclid science-quality selection.

Release context: https://irsa.ipac.caltech.edu/data/Euclid/docs/overview_dr1.html

## Regeneration

With Python and Astropy installed:

```
python3 tools/build_euclid.py
python3 build.py
```

The converter validates the FITS coordinate/index convention and converts mixed-order cells to sorted, merged half-open order-13 pixel intervals without degrading or approximating coverage. Runtime use is entirely offline. Updating the data requires explicitly replacing the pinned files and reviewing the URLs, hashes and areas.

## Credit and terms

“This work has made use of the Data Release (DR1) data from the Euclid mission of the European Space Agency (ESA).” Data provided through NASA/IPAC IRSA, operated by Caltech under contract with NASA. See the release overview for DOI/citation instructions. ESA lists DR1 data under CC BY-NC 3.0 IGO: https://www.cosmos.esa.int/web/euclid/dr1-data. The repository's code license does not replace these data terms.
