# Lakes Parks Trail Explorer (Leaflet version)

A mobile-friendly web map application for the Lakeside Commons / East Lake / West Lake / South Lake Park
trail network and Blaine Wetland Sanctuary, built for GEOG 777 Project 2.

Built with **Leaflet** + **esri-leaflet**, pulling all data from **hosted feature layers on ArcGIS
Online (AGOL)**. No build tools, npm, or bundler required — just open it in a browser (ideally
through VS Code's "Live Server" extension, since browsers block some requests from `file://` paths).

## 1. Project structure

```
lakes-parks-trail-explorer-leaflet/
├── index.html          # App shell / layout
├── css/
│   └── style.css        # Mobile-first responsive styling
├── js/
│   ├── config.js         # <-- EDIT THIS: paste your AGOL feature layer URLs here
│   └── app.js             # Map init + the 4 required functions
└── README.md
```

## 2. Libraries used (all via CDN, no install needed)

- **Leaflet** (`leaflet@1.9.4`) — the map itself
- **esri-leaflet** (`esri-leaflet@3.0.12`) — lets Leaflet read/write AGOL hosted feature layers directly
  (`L.esri.featureLayer`, `.query()`, `.setWhere()`, `.addFeature()`)
- **esri-leaflet-basemaps** (`esri-leaflet-basemaps@2.0.5`) — optional, gives you Esri basemap tiles
  (Topographic, Streets, Imagery, etc.) without needing your own tile server. Swap for a plain
  `L.tileLayer(...)` (e.g. OpenStreetMap) in `app.js` if you'd rather not use it.

## 3. Before you run it: publish your layers to AGOL

You need **6 hosted feature layers** (5 data layers + 1 basemap, per the assignment; the reports
layer doubles as your required user-submitted layer):

| Layer key        | Suggested geometry | Notes |
|-------------------|--------------------|-------|
| `parkBoundary`     | Polygon             | Outline of the combined lakes parks + wetland sanctuary |
| `trails`            | Polyline             | Include a `TrailType` field (e.g. Paved / Natural Surface / Boardwalk) |
| `recreation`        | Point                | Include an `ActivityType` field (e.g. Playground, Boat Launch) |
| `accommodations`    | Point                | Restrooms, water fountains, parking, benches, shelters — include a `Type` field |
| `landmarks`          | Point                | Scenic overlooks, wetland viewpoints, etc. |
| `reports`            | Point (editable)     | **User-submitted data.** Must have editing (Create) enabled in AGOL. Fields: `SubmittedBy`, `Email`, `IssueType`, `Description`, `SubmittedDate` (Date) |

Publish each as a **Feature Layer** in ArcGIS Online, then copy each layer's REST endpoint URL
(found on the layer's Overview page, ends in `/FeatureServer/0`).

For `reports`, make sure **Editing → Create** capability is enabled, and set sharing so that
anonymous/public users can add features.

## 4. Configure the app

Open `js/config.js` and:

1. Paste each layer's URL into the matching `url:` field.
2. Adjust `filterField` / `filterOptions` for `trails`, `recreation`, and `accommodations` to match
   the actual attribute field names and values in your data.
3. Adjust `reportFields` if you named your reports-layer fields differently.
4. Set `initialExtent.center` to the true centroid of your park area — note Leaflet uses
   **`[lat, lng]`** order (opposite of the ArcGIS API for JS, in case you compare against an
   earlier version of this project).
5. Optional fallback: set `useHostedReportLayer: false` and fill in `externalSurveyUrl` if you'd
   rather route the "Report an issue" button to an external survey instead of submitting directly
   into the `reports` feature layer.

## 5. Run it

Easiest option in VS Code:

1. Install the **Live Server** extension.
2. Right-click `index.html` → "Open with Live Server."
3. Allow location access when prompted (needed for the Current Location and Report functions).

Alternatively, from a terminal in the project folder:

```bash
npx serve .
```

## 6. How this maps to the Project 2 requirements

- **5 data layers:** `parkBoundary`, `trails`, `recreation`, `accommodations`, `landmarks` (basemap
  is the 6th visual layer via `CONFIG.basemap`).
- **User-submitted layer:** `reports`, populated through the in-app Report form.
- **4+ functions (excluding pan/zoom):**
  1. **Search** — `setupSearch()` in `js/app.js`. Queries each searchable `L.esri.featureLayer`
     directly with `.query().where(...)` and lists matches; clicking a result zooms/highlights it.
  2. **Filter** — `setupFilterPanel()`, calls `.setWhere()` on the selected layer with an expression
     built from the chosen attribute value (e.g. trail type).
  3. **Current location** — `setupLocateButton()`, uses the browser Geolocation API to center the
     map and drop a marker at the visitor's position.
  4. **User submission** — `setupReportForm()`, validates the form, optionally captures GPS
     coordinates, and adds a new feature to the `reports` layer via `featureLayer.addFeature()`
     (or opens an external survey if `useHostedReportLayer` is `false`).
- **Mobile-friendly / responsive:** `css/style.css` uses a mobile-first layout — the side panel
  slides in as an overlay on small screens and docks permanently on wider (desktop) screens.

## 7. Notes / things to double check once your data is live

- `esri-leaflet`'s `.query()`/`.setWhere()` send standard SQL `WHERE` clauses to the feature
  service — same syntax you'd use in ArcGIS, so double-check your field names match exactly
  (case-sensitive on some servers).
- Confirm the `Name` field used by Search (`searchFields`/`searchDisplayField` in `config.js`)
  matches your published schema — rename in config if your field is called something else
  (e.g. `TrailName`).
- Test that anonymous submission to the `reports` layer actually works from AGOL's sharing
  settings; if it fails, check the browser console — `addFeature()`'s error callback will surface
  a permissions/auth error there.
- If a layer with many features loads slowly, esri-leaflet supports `where`, `simplifyFactor`, and
  `precision` options on `L.esri.featureLayer(...)` to trim payload size — worth adding once you
  have real data volumes to test against.
