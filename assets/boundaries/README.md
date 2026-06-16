# Country boundary asset

`countries.geojson` is the bundled, simplified country dataset that border-aware route drafting uses to
keep a same-country route in that country's waters (for example, a Detroit River route between two US
points stays out of Canadian water). The plugin reads it at startup; it is published with the package
via the `assets` entry in `package.json` `files`.

## Source

Natural Earth admin-0 countries, 1:10m: the file `ne_10m_admin_0_countries` (the DEFAULT). This file
INCLUDES boundary lakes as country geometry, which is what splits the Great Lakes and the connecting
rivers along the international boundary. Do NOT use the `ne_10m_admin_0_countries_lakes` variant: it
erases the lake water this feature depends on.

Natural Earth is public domain (no attribution required).

## How it was built

```
curl -sL -o /tmp/ne.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
node scripts/build-boundaries.mjs /tmp/ne.geojson
```

`scripts/build-boundaries.mjs` strips each feature to `{ id, name }` (`id` is the admin-0 `ADM0_A3`
code, `name` the `NAME`) and simplifies the geometry with a zero-dependency, variable-tolerance
Douglas-Peucker:

- Fine tolerance (~33 m, below the 60 m router grid cell) over the narrow US/Canada connecting rivers
  (Detroit, St. Clair, St. Marys, Niagara, and the Thousand Islands stretch of the St. Lawrence), so
  the boundary stays mid-channel there.
- Coarse tolerance (~4 km) everywhere else, and far-flung islands smaller than ~6 km are dropped. A
  coarse coastline is safe: marine water is never blocked, and a misclassification only turns the
  constraint off.

There are no build-time package dependencies (no mapshaper, no topology library), so the build pulls in
nothing unmaintained.

## Acceptance

After rebuilding, confirm the boundary still splits the connecting rivers: classify known mid-river
points on the Detroit, St. Clair, and St. Marys rivers and confirm US-side points return `USA`,
Canada-side points return `CAN`, and the boundary sits between the banks. The asset is on the order of
1 to 2 MB on disk; the build script prints the exact feature count and size when it runs.
