/* ==========================================================
   Lakes Parks Trail Explorer - Application Logic (Leaflet version)
   ----------------------------------------------------------
   Built with Leaflet + esri-leaflet, so all data layers are
   pulled straight from AGOL hosted feature layers.

   Implements the 4 required functions:
     1. Search              -> setupSearch()      (now highlights the
                                real feature geometry + fits bounds)
     2. Filter               -> setupFilterPanel() (now reads real
                                values live from each AGOL layer)
     3. Current location     -> setupLocateButton() (now a continuous
                                "you are here" blip via watchPosition)
     4. User submission      -> setupReportForm()

   NEW: Segment merging (see mergeSegmentsBy in config.js) - a trail
   that's stored as several separate line segments sharing one name
   (e.g. one that splits into two paths and rejoins) now reports its
   FULL combined length and highlights every one of its segments
   together, whether you click it on the map or pick it from Search.
   ========================================================== */

(function () {

  // ====================================================================
  // LIBRARY LOAD CHECK
  // Bails out early with a visible on-page error banner (rather than a
  // silent blank map) if Leaflet or esri-leaflet failed to load from
  // the CDN, and logs the likely cause to the console.
  // ====================================================================
  if (typeof L === "undefined" || typeof L.esri === "undefined") {
    const banner = document.getElementById("loadError");
    if (banner) banner.classList.remove("hidden");
    console.error(
      "Leaflet or esri-leaflet did not load. Check the network tab for " +
      "blocked/failed requests to cdn.jsdelivr.net, then hard-refresh."
    );
    return;
  }

  // ====================================================================
  // PARK NAME
  // Writes CONFIG.parkName into the header title and the browser tab
  // title, so the whole app is relabeled just by editing config.js.
  // ====================================================================
  if (CONFIG.parkName) {
    const headerTitleEl = document.querySelector("#appHeader h1");
    if (headerTitleEl) headerTitleEl.textContent = CONFIG.parkName;
    document.title = CONFIG.parkName;
  }

  // ====================================================================
  // MAP INITIALIZATION
  // Creates the Leaflet map centered on CONFIG.initialExtent and loads
  // the configured esri-leaflet basemap underneath all the data layers.
  // Satellite imagery has no baked-in labels, so a matching
  // ImageryLabels reference layer is stacked on top for readability
  // (trail names, roads, water body names, etc.) whenever an imagery
  // basemap is selected.
  // ====================================================================
  const map = L.map("mapDiv", {
    zoomControl: false
  }).setView(CONFIG.initialExtent.center, CONFIG.initialExtent.zoom);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.esri.basemapLayer(CONFIG.basemap).addTo(map);

  // Satellite imagery has no street/place labels baked in, so when the
  // basemap is imagery we layer a matching reference/labels layer on top
  // for readability (trail names, roads, water body names, etc.).
  if (CONFIG.basemap === "Imagery" || CONFIG.basemap === "ImageryClarity" || CONFIG.basemap === "ImageryFirefly") {
    L.esri.basemapLayer("ImageryLabels").addTo(map);
  }

  // ====================================================================
  // CUSTOM PANES (request #5 from a previous round)
  // Polygon layers (park boundary) render in a lower pane so
  // point/line layers always sit visually on top of them AND
  // receive click events first, regardless of the order they
  // finish loading from AGOL.
  //   polygonPane / lineAndPointPane  — the two main draw panes
  //   polygonCasingPane / lineCasingPane — sit just beneath their main
  //     pane, holding each layer's decorative casingStyle underlay
  //   lineHitAreaPane — sits above the visible line/casing panes so a
  //     tap/click is captured by a wide invisible stroke first, making
  //     thin trail lines easy to tap
  //   highlightPane / locationPane — sit above everything else, for
  //     search highlights/routes and the live location blip
  // ====================================================================
  map.createPane("polygonPane");
  map.getPane("polygonPane").style.zIndex = 401;

  map.createPane("lineAndPointPane");
  map.getPane("lineAndPointPane").style.zIndex = 450;

  // "Casing" panes hold a wider, plain underlay drawn just behind a
  // layer's real line/border, used for the two-tone trail-tread and
  // boundary-halo look (see CONFIG.layers[key].casingStyle). Each sits
  // directly beneath its matching main pane so the casing peeks out
  // from behind the main line without covering anything else.
  map.createPane("polygonCasingPane");
  map.getPane("polygonCasingPane").style.zIndex = 395;

  map.createPane("lineCasingPane");
  map.getPane("lineCasingPane").style.zIndex = 440;

  // Invisible "hit area" pane for lines (e.g. trails). Sits ABOVE the
  // visible line/casing panes so a tap/click is captured by the wide
  // invisible stroke first, even though nothing is drawn differently on
  // screen - this is what makes thin trail lines easy to tap (see
  // request: "trail line is very thin and hard to click").
  map.createPane("lineHitAreaPane");
  map.getPane("lineHitAreaPane").style.zIndex = 455;

  // Highlights (search results) sit above everything else, and the
  // live-location blip sits above that so it's never hidden.
  map.createPane("highlightPane");
  map.getPane("highlightPane").style.zIndex = 460;

  map.createPane("locationPane");
  map.getPane("locationPane").style.zIndex = 470;

  /** Holds references to every L.esri.FeatureLayer keyed by the same key used in CONFIG.layers. */
  const layerRegistry = {};

  /** Holds the purely-decorative "casing" companion layer for any layer
   *  that has a casingStyle configured, keyed the same as layerRegistry.
   *  Not interactive, not clickable, not searchable - just the underlay.
   */
  const casingLayerRegistry = {};

  /** Holds the invisible wide "hit area" companion layer for line layers
   *  (e.g. trails), keyed the same as layerRegistry. This is what actually
   *  receives the click/tap - it's drawn with a much wider, fully
   *  transparent stroke over the real line so the trail is much easier to
   *  select without changing how thin/delicate it looks on screen.
   */
  const hitAreaLayerRegistry = {};

  /** Holds decoded coded-value domain maps per layer, e.g.
   *  domainMaps.trails.trail_type = { "1": "Dirt", "2": "Multi Use" }
   */
  const domainMaps = {};

  /** Cache of live "what values actually exist in this field" results,
   *  keyed by layer key, used by the Filter panel (request #3). Cleared
   *  whenever a layer's domain metadata arrives late so labels can be
   *  re-decoded with the friendly names instead of raw codes.
   */
  const filterValueCache = {};

  /** Internal ArcGIS bookkeeping fields we don't want cluttering a popup. */
  const HIDDEN_ATTRIBUTE_FIELDS = [
    "OBJECTID", "objectid", "FID", "GlobalID", "globalid",
    "Shape__Length", "Shape__Area", "Shape_Length", "Shape_Area",
    "created_user", "created_date", "last_edited_user", "last_edited_date",
    "Creator", "creator", "CreationDate", "creationdate",
    "Editor", "editor", "EditDate", "editdate"
  ];

  /** Escapes &, <, >, and " in a value so it can be safely inserted into popup HTML. */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Looks up the display label to use for a field in a popup - the
   *  layer's configured fieldLabels override if one exists, otherwise a
   *  title-cased, space-separated version of the raw field name.
   */
  function friendlyFieldLabel(layerConfig, field) {
    if (layerConfig.fieldLabels && layerConfig.fieldLabels[field]) {
      return layerConfig.fieldLabels[field];
    }
    return field
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  /** Swaps a raw coded-domain value (e.g. "2") for its full text
   *  (e.g. "Multi Use") if that field has a known domain.
   *  Otherwise returns the value unchanged.
   */
  function decodeValue(domains, field, value) {
    if (domains && domains[field] && Object.prototype.hasOwnProperty.call(domains[field], value)) {
      return domains[field][value];
    }
    return value;
  }

  /** AGOL field names in your actual hosted layers may not match the
   *  exact casing/spelling typed into config.js (e.g. config says "Name"
   *  but the real field is "NAME" or "FacilityName"). This looks up a
   *  field case-insensitively (and ignoring spaces/underscores) so the
   *  popup still finds it, and returns both the value and the real key.
   */
  function findProp(properties, wantedField) {
    if (Object.prototype.hasOwnProperty.call(properties, wantedField)) {
      return { key: wantedField, value: properties[wantedField] };
    }
    const normalize = function (s) { return String(s).toLowerCase().replace(/[\s_]/g, ""); };
    const target = normalize(wantedField);
    const actualKey = Object.keys(properties).find(function (k) { return normalize(k) === target; });
    if (actualKey) {
      return { key: actualKey, value: properties[actualKey] };
    }
    return { key: null, value: undefined };
  }

  /** Resolves the field to use as a popup's title. Tries the configured
   *  searchDisplayField (or "Name") first; if that doesn't exist on this
   *  layer's real schema, falls back to any attribute whose field name
   *  contains "name" (e.g. ParkName, SITE_NAME) rather than silently
   *  showing the generic layer title (e.g. "Park Boundary") for every
   *  feature. This heuristic isn't foolproof - if the popup title still
   *  looks wrong, check the console.debug output logged below for the
   *  real field list and set searchDisplayField in config.js explicitly.
   */
  function findBestNameField(properties, layerConfig) {
    const configuredField = layerConfig.searchDisplayField || "Name";
    const direct = findProp(properties, configuredField);
    if (direct.key) return direct;

    const candidateKey = Object.keys(properties).find(function (k) {
      return /name/i.test(k);
    });
    if (candidateKey) {
      return { key: candidateKey, value: properties[candidateKey] };
    }

    return { key: null, value: undefined };
  }

  /** Detects date/time-ish values and formats them into a readable
   *  local date + time string. Two things could otherwise go wrong and
   *  make dates look "messed up": (1) the field name doesn't happen to
   *  contain "date" so the raw epoch number (e.g. 1732820000000) got
   *  displayed as-is, or (2) AGOL returned an ISO date STRING rather
   *  than a number, which the old number-only check skipped entirely.
   *  This handles numeric epoch ms/seconds, ISO strings, and also
   *  catches an epoch-looking number even on a field name that doesn't
   *  mention "date" at all.
   */
  function formatIfDate(fieldName, value) {
    const nameSuggestsDate = /date|time/i.test(fieldName);
    const isPlausibleEpochMs = typeof value === "number" && value > 946684800000 && value < 4102444800000; // year 2000-2100 in ms

    if (!nameSuggestsDate && !isPlausibleEpochMs) return value;

    let dateObj = null;
    if (typeof value === "number") {
      // Some services report epoch SECONDS instead of milliseconds.
      dateObj = new Date(value < 1e12 ? value * 1000 : value);
    } else if (nameSuggestsDate && typeof value === "string" && value.trim() !== "") {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) dateObj = parsed;
    }

    if (!dateObj || isNaN(dateObj.getTime())) return value;

    return dateObj.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  /** Builds the popup's title HTML and its attribute-rows HTML
   *  separately (rather than one fixed blob) so the caller can decide
   *  what goes between them - e.g. photo attachments sit right under
   *  the title and above the field rows. If layerConfig.popupFields is
   *  set, ONLY those fields are shown. Otherwise falls back to showing
   *  every attribute minus internal Esri/AGOL housekeeping fields (see
   *  HIDDEN_ATTRIBUTE_FIELDS) - this is what "show whatever's in the
   *  survey, minus backend/admin info" uses for the reports layer.
   *
   *  Each field renders as a normal flowing "Label: value" line (not a
   *  two-column table) so long labels/values wrap the same way a
   *  sentence does - left to right, full popup width - instead of being
   *  squeezed into a narrow fixed-width column and breaking apart
   *  letter-by-letter.
   */
  function buildPopupContent(layerConfig, properties, domains, layerKey) {
    const nameLookup = findBestNameField(properties, layerConfig);
    const title = (nameLookup.key && decodeValue(domains, nameLookup.key, nameLookup.value)) || layerConfig.title;

    const fieldsToShow = Array.isArray(layerConfig.popupFields)
      ? layerConfig.popupFields
      : Object.keys(properties).filter(function (field) {
          return HIDDEN_ATTRIBUTE_FIELDS.indexOf(field) === -1 && field !== nameLookup.key;
        });

    let rows = "";
    fieldsToShow.forEach(function (wantedField) {
      const lookup = findProp(properties, wantedField);
      if (lookup.key === nameLookup.key) return;
      let value = lookup.value;
      if (value === null || value === undefined || value === "") return;

      value = decodeValue(domains, lookup.key, value);
      value = formatIfDate(wantedField, value);

      rows +=
        "<div class='popup-field'>" +
        "<span class='popup-field-label'>" + escapeHtml(friendlyFieldLabel(layerConfig, wantedField)) + ":</span> " +
        "<span class='popup-field-value'>" + escapeHtml(value) + "</span>" +
        "</div>";
    });

    // Helps pinpoint real AGOL field names in the console if a popup
    // still looks empty/wrong after this fix — compare against the
    // field names typed into config.js and adjust as needed.
    if (!nameLookup.key || !rows) {
      console.debug('Popup for layer "' + layerKey + '" — actual attribute fields available:', Object.keys(properties));
    }

    const titleHtml =
      "<div class='popup-layer-tag'>" + escapeHtml(layerConfig.title) + "</div>" +
      "<h3>" + escapeHtml(title) + "</h3>";
    const rowsHtml = rows ? "<div class='popup-fields'>" + rows + "</div>" : "";

    return { titleHtml: titleHtml, rowsHtml: rowsHtml };
  }

  /** Fetches the AGOL layer's field metadata once and caches any
   *  coded-value domains it finds, so buildPopupContent (and the Filter
   *  panel) can decode raw codes into their full display text.
   */
  function loadDomainMetadata(key, featureLayer) {
    if (typeof featureLayer.metadata !== "function") return;
    featureLayer.metadata(function (error, metadata) {
      if (error || !metadata || !Array.isArray(metadata.fields)) return;
      const map = {};
      metadata.fields.forEach(function (field) {
        if (field.domain && field.domain.type === "codedValue" && Array.isArray(field.domain.codedValues)) {
          const codeMap = {};
          field.domain.codedValues.forEach(function (cv) {
            codeMap[cv.code] = cv.name;
          });
          map[field.name] = codeMap;
        }
      });
      domainMaps[key] = map;

      // If the Filter panel already built its value list for this layer
      // before the domain arrived, throw that cache away so the next
      // time it's opened it re-decodes with the proper friendly names
      // instead of raw codes.
      delete filterValueCache[key];
    });
  }

  /** For layers with hasAttachments: true (e.g. Survey123 reports),
   *  fetches any photo attachments on a feature straight from AGOL's
   *  attachments REST endpoint and returns a chunk of HTML with
   *  clickable thumbnails - or an empty string if there are none / the
   *  request fails. callback(html) is always called exactly once.
   */
  function loadAttachmentPhotos(layerConfig, properties, callback) {
    const objectIdLookup = findProp(properties, "OBJECTID");
    const objectId = objectIdLookup.key ? objectIdLookup.value : findProp(properties, "FID").value;

    if (objectId === undefined || objectId === null) {
      callback("");
      return;
    }

    const baseUrl = layerConfig.url.replace(/\/+$/, "");
    const attachmentsUrl = baseUrl + "/" + objectId + "/attachments?f=json";

    fetch(attachmentsUrl)
      .then(function (response) { return response.json(); })
      .then(function (data) {
        const infos = (data && data.attachmentInfos) || [];
        const images = infos.filter(function (info) {
          return info.contentType && info.contentType.indexOf("image/") === 0;
        });

        if (!images.length) {
          callback("");
          return;
        }

        let html = '<div class="popup-photos">';
        images.forEach(function (info) {
          const imgUrl = baseUrl + "/" + objectId + "/attachments/" + info.id;
          html +=
            '<a href="' + imgUrl + '" target="_blank" rel="noopener noreferrer">' +
            '<img src="' + imgUrl + '" alt="' + escapeHtml(info.name || "Report photo") + '" loading="lazy" /></a>';
        });
        html += "</div>";
        callback(html);
      })
      .catch(function (error) {
        console.warn('Could not load photo attachments for layer "' + (layerConfig.title || "") + '":', error);
        callback("");
      });
  }

  // ====================================================================
  // SEGMENT MERGING + SHARED MAP HIGHLIGHT
  // (New: some trails - e.g. Blaine Wetland Sanctuary Trail - are
  //  stored in AGOL as several separate line segments sharing the
  //  same trail_name, typically because the trail splits into two
  //  paths around something and rejoins further along. A layer opts
  //  into this behavior via mergeSegmentsBy / mergeSegmentsSumField
  //  in config.js. When set, clicking OR searching for any one
  //  segment looks up every other segment with the same name,
  //  highlights all of them together, and reports their COMBINED
  //  length instead of just the one segment that was clicked.
  //
  //  The highlight logic itself lives at this module level (rather
  //  than inside setupSearch, where it used to live) so both the
  //  Search results list AND clicking a trail directly on the map
  //  can share the exact same "light up every segment" behavior.)
  //   clearHighlight        — removes the current highlight/endpoints
  //   highlightFeatureGroup — draws and fits to one or more features
  //   resolveTrailGroup     — looks up every segment sharing a name
  // ====================================================================

  /** Cache of merged-segment "trail groups" - every feature sharing a
   *  given mergeSegmentsBy value, plus their combined length - keyed by
   *  "layerKey::field::value" so re-clicking/re-searching the same trail
   *  later in the session doesn't re-query AGOL every time.
   */
  const segmentGroupCache = {};

  let highlightLayer = null;
  let endpointMarkers = [];
  let clearHighlightTimer = null;

  /** Removes whatever search/trail-group highlight is currently on the
   *  map, along with any Start/End endpoint markers and the pending
   *  auto-fade timer.
   */
  function clearHighlight() {
    if (highlightLayer) {
      map.removeLayer(highlightLayer);
      highlightLayer = null;
    }
    endpointMarkers.forEach(function (m) { map.removeLayer(m); });
    endpointMarkers = [];
    if (clearHighlightTimer) {
      clearTimeout(clearHighlightTimer);
      clearHighlightTimer = null;
    }
  }

  // Clicking anywhere else on the map dismisses whatever's highlighted.
  map.on("click", clearHighlight);

  /** Returns true if a line's first and last coordinates are (nearly)
   *  the same point, i.e. the line is a closed loop.
   */
  function isClosedLoop(coords) {
    const start = coords[0];
    const end = coords[coords.length - 1];
    const dx = Math.abs(start[0] - end[0]);
    const dy = Math.abs(start[1] - end[1]);
    return dx < 1e-7 && dy < 1e-7;
  }

  /** Highlights one or more GeoJSON features together as a single group
   *  and fits the map to their combined bounds. Used both for a plain
   *  single search result AND for a trail made of several merged
   *  segments - in the merged case every segment lights up together so
   *  the whole route is visible, not just whichever piece was clicked.
   *
   *  Start/End endpoint markers are only added when the group is a
   *  single, non-looping line. With multiple merged segments the places
   *  where they split and rejoin already show visually on the map, so
   *  per-segment endpoint labels would just be confusing clutter.
   */
  function highlightFeatureGroup(features) {
    clearHighlight();
    if (!features || !features.length) return;

    const geoLayer = L.geoJSON({ type: "FeatureCollection", features: features }, {
      pane: "highlightPane",
      pointToLayer: function (geojson, latlng) {
        return L.circleMarker(latlng, {
          radius: 14,
          color: "#ffeb3b",
          weight: 4,
          opacity: 1,
          fillOpacity: 0,
          pane: "highlightPane",
          className: "search-highlight-point"
        });
      },
      style: function () {
        return {
          color: "#ffeb3b",
          weight: 6,
          opacity: 0.95,
          dashArray: "8,10",
          fill: false,
          pane: "highlightPane",
          className: "search-highlight-line"
        };
      }
    });

    const bounds = geoLayer.getBounds();
    if (bounds.isValid()) {
      // Fit to the WHOLE group (every segment of the trail, not just
      // one) so a split-and-rejoin trail is fully visible at once.
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
    }

    highlightLayer = geoLayer.addTo(map);

    if (features.length === 1) {
      const feature = features[0];
      const geomType = feature.geometry && feature.geometry.type;
      const isPoint = geomType === "Point" || geomType === "MultiPoint";

      if (!isPoint && (geomType === "LineString" || geomType === "MultiLineString")) {
        const lineCoords = geomType === "LineString"
          ? feature.geometry.coordinates
          : feature.geometry.coordinates[0];

        if (lineCoords && lineCoords.length > 1 && !isClosedLoop(lineCoords)) {
          const start = lineCoords[0];
          const end = lineCoords[lineCoords.length - 1];

          const startMarker = L.circleMarker([start[1], start[0]], {
            radius: 8, color: "#ffffff", weight: 2, fillColor: "#2e7d32", fillOpacity: 1, pane: "highlightPane"
          }).bindTooltip("Start", { permanent: true, direction: "top", className: "endpoint-tooltip" }).addTo(map);

          const endMarker = L.circleMarker([end[1], end[0]], {
            radius: 8, color: "#ffffff", weight: 2, fillColor: "#c62828", fillOpacity: 1, pane: "highlightPane"
          }).bindTooltip("End", { permanent: true, direction: "top", className: "endpoint-tooltip" }).addTo(map);

          endpointMarkers.push(startMarker, endMarker);
        }
      }
    }

    // Auto-fade the highlight after a while so it doesn't linger
    // forever, but give the user plenty of time to look at it.
    clearHighlightTimer = setTimeout(clearHighlight, 8000);
  }

  /** For layers configured with mergeSegmentsBy (currently just Trails -
   *  see js/config.js), looks up every feature in that layer sharing the
   *  given feature's value for that field, and sums mergeSegmentsSumField
   *  across all of them. This is what lets a trail stored as several
   *  separate AGOL segments (e.g. one that splits into two paths and
   *  rejoins) report its FULL length instead of just whichever segment
   *  happened to be clicked or searched up.
   *
   *  callback receives { features, total, sumField } where features is
   *  the full matching group (falls back to just the one feature passed
   *  in if the layer isn't configured for merging, the feature has no
   *  value for the merge field, or the group query fails), and total is
   *  either the summed number or null if it couldn't be computed.
   */
  function resolveTrailGroup(layerConfig, key, feature, callback) {
    const mergeField = layerConfig.mergeSegmentsBy;
    const sumField = layerConfig.mergeSegmentsSumField;
    const featureLayer = layerRegistry[key];

    if (!mergeField || !featureLayer) {
      callback({ features: [feature], total: null, sumField: sumField });
      return;
    }

    const lookup = findProp(feature.properties || {}, mergeField);
    const value = lookup.value;
    if (value === null || value === undefined || value === "") {
      callback({ features: [feature], total: null, sumField: sumField });
      return;
    }

    const cacheKey = key + "::" + mergeField + "::" + String(value);
    if (segmentGroupCache[cacheKey]) {
      callback(segmentGroupCache[cacheKey]);
      return;
    }

    const isNumeric = typeof value === "number";
    const whereClause = isNumeric
      ? mergeField + " = " + value
      : mergeField + " = '" + String(value).replace(/'/g, "''") + "'";

    featureLayer.query()
      .where(whereClause)
      .run(function (error, featureCollection) {
        if (error || !featureCollection || !featureCollection.features.length) {
          console.warn('Could not load merged segments for "' + String(value) + '" in layer "' + key + '":', error);
          callback({ features: [feature], total: null, sumField: sumField });
          return;
        }

        let total = 0;
        let anyNumeric = false;
        featureCollection.features.forEach(function (f) {
          const segLookup = findProp(f.properties, sumField);
          const segValue = parseFloat(segLookup.value);
          if (!isNaN(segValue)) {
            total += segValue;
            anyNumeric = true;
          }
        });

        const result = {
          features: featureCollection.features,
          total: anyNumeric ? total : null,
          sumField: sumField
        };

        segmentGroupCache[cacheKey] = result;
        callback(result);
      });
  }

  // ====================================================================
  // WALKING DIRECTIONS (trail-network routing)
  // Builds a graph straight from the Trails layer's real line geometry
  // - each vertex becomes a graph node, each segment between two
  // consecutive vertices becomes a weighted edge (real-world distance)
  // - so a shortest-path search can route a "Directions" request along
  // the actual trail network, the way Google Maps routes along roads.
  //
  // DATA REQUIREMENT: two trails only connect at a point where they
  // share an EXACT vertex in the AGOL data. If a real-world junction
  // isn't stitched together that way, routing can't cross it there.
  //   buildTrailGraph  — loads every trail segment once and builds the
  //                      node/edge graph
  //   findNearestNode  — snaps an arbitrary lat/lng onto the graph
  //   dijkstraPath     — shortest path between two graph nodes
  //   requestDirectionsTo — entry point wired to popup buttons
  // ====================================================================

  /** Calculates the great-circle distance in meters between two lat/lng points. */
  function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = function (d) { return d * Math.PI / 180; };
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Rounds coordinates to ~11cm precision so separate trail segments
   *  that were digitized to meet at "the same" point become the exact
   *  same graph node, instead of two nodes a hair's-width apart that
   *  Dijkstra would see as disconnected.
   */
  function nodeKeyFor(lat, lng) {
    return lat.toFixed(6) + "," + lng.toFixed(6);
  }

  /** Adds a bidirectional weighted edge (real-world distance) between
   *  two coordinates to the trail graph, creating either endpoint's
   *  node first if it doesn't exist yet.
   */
  function addGraphEdge(graph, aLat, aLng, bLat, bLng) {
    const aKey = nodeKeyFor(aLat, aLng);
    const bKey = nodeKeyFor(bLat, bLng);
    if (aKey === bKey) return;
    if (!graph.nodes.has(aKey)) graph.nodes.set(aKey, { lat: aLat, lng: aLng });
    if (!graph.nodes.has(bKey)) graph.nodes.set(bKey, { lat: bLat, lng: bLng });
    const dist = haversineMeters(aLat, aLng, bLat, bLng);
    if (!graph.edges.has(aKey)) graph.edges.set(aKey, []);
    if (!graph.edges.has(bKey)) graph.edges.set(bKey, []);
    graph.edges.get(aKey).push({ to: bKey, dist: dist });
    graph.edges.get(bKey).push({ to: aKey, dist: dist });
  }

  /** Built once per session, the first time Directions is requested,
   *  then reused - a park's trail network is small enough that this is
   *  cheap, and it doesn't change while the app is open.
   */
  let trailGraph = null;
  let trailGraphCallbacks = null;

  /** Loads every Trails feature from AGOL, turns every consecutive pair
   *  of vertices in each line into a graph edge, and caches the result
   *  so subsequent Directions requests reuse the same graph instead of
   *  re-querying AGOL. Any callbacks that arrive while a build is
   *  already in flight are queued and all fired together once it's done.
   */
  function buildTrailGraph(callback) {
    if (trailGraph) { callback(trailGraph); return; }
    if (trailGraphCallbacks) { trailGraphCallbacks.push(callback); return; }
    trailGraphCallbacks = [callback];

    const trailsLayer = layerRegistry.trails;
    if (!trailsLayer) {
      trailGraph = { nodes: new Map(), edges: new Map() };
      trailGraphCallbacks.forEach(function (cb) { cb(trailGraph); });
      trailGraphCallbacks = null;
      return;
    }

    trailsLayer.query().where("1=1").run(function (error, featureCollection) {
      const graph = { nodes: new Map(), edges: new Map() };

      if (!error && featureCollection && featureCollection.features.length) {
        featureCollection.features.forEach(function (feature) {
          const geomType = feature.geometry && feature.geometry.type;
          const lines = geomType === "LineString" ? [feature.geometry.coordinates]
            : geomType === "MultiLineString" ? feature.geometry.coordinates
            : [];

          lines.forEach(function (coords) {
            for (let i = 0; i < coords.length - 1; i++) {
              addGraphEdge(graph, coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
            }
          });
        });
      } else {
        console.warn("Could not load the trail network for routing:", error);
      }

      trailGraph = graph;
      trailGraphCallbacks.forEach(function (cb) { cb(trailGraph); });
      trailGraphCallbacks = null;
    });
  }

  /** Finds the closest graph node (trail vertex) to an arbitrary lat/lng
   *  - used to snap both the walker's live location and the clicked
   *  destination onto the trail network before routing between them.
   */
  function findNearestNode(graph, lat, lng) {
    let bestKey = null, bestDist = Infinity, bestLat = null, bestLng = null;
    graph.nodes.forEach(function (node, key) {
      const d = haversineMeters(lat, lng, node.lat, node.lng);
      if (d < bestDist) { bestDist = d; bestKey = key; bestLat = node.lat; bestLng = node.lng; }
    });
    return bestKey === null ? null : { key: bestKey, lat: bestLat, lng: bestLng, dist: bestDist };
  }

  /** Plain Dijkstra shortest path by real-world distance. Trail networks
   *  for a single park are small (well under a thousand nodes), so this
   *  simple O(n²) node-scan version runs comfortably fast without
   *  needing a real priority queue.
   */
  function dijkstraPath(graph, startKey, endKey) {
    const dist = new Map([[startKey, 0]]);
    const prev = new Map();
    const visited = new Set();

    while (true) {
      let currentKey = null, currentDist = Infinity;
      dist.forEach(function (d, k) {
        if (!visited.has(k) && d < currentDist) { currentDist = d; currentKey = k; }
      });
      if (currentKey === null || currentKey === endKey) break;
      visited.add(currentKey);

      (graph.edges.get(currentKey) || []).forEach(function (edge) {
        if (visited.has(edge.to)) return;
        const newDist = currentDist + edge.dist;
        if (newDist < (dist.has(edge.to) ? dist.get(edge.to) : Infinity)) {
          dist.set(edge.to, newDist);
          prev.set(edge.to, currentKey);
        }
      });
    }

    if (!dist.has(endKey)) return null;

    const path = [endKey];
    let cur = endKey;
    while (cur !== startKey) {
      cur = prev.get(cur);
      if (cur === undefined) return null;
      path.push(cur);
    }
    path.reverse();
    return { path: path, distanceMeters: dist.get(endKey) };
  }

  /** Converts a distance in meters to miles. */
  function metersToMiles(m) { return m / 1609.344; }

  /** Formats a distance in meters into a human-readable walking-time
   *  string (e.g. "12 minutes") using CONFIG.routing.walkingSpeedMph.
   */
  function formatWalkTime(meters) {
    const mph = (CONFIG.routing && CONFIG.routing.walkingSpeedMph) || 3;
    const minutes = Math.round((metersToMiles(meters) / mph) * 60);
    return minutes < 1 ? "less than a minute" : minutes + (minutes === 1 ? " minute" : " minutes");
  }

  let routeLayer = null;
  let routeInfoEl = null;

  /** Removes the currently drawn walking route and its info panel, if any. */
  function clearRoute() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    if (routeInfoEl) { routeInfoEl.remove(); routeInfoEl = null; }
  }

  /** Builds and inserts the route info banner across the top of the map,
   *  showing the destination label, distance, and estimated walk time,
   *  with a close button wired to clearRoute().
   */
  function showRouteInfoPanel(label, meters) {
    if (routeInfoEl) routeInfoEl.remove();
    routeInfoEl = document.createElement("div");
    routeInfoEl.id = "routeInfoPanel";
    routeInfoEl.innerHTML =
      "<div class='route-info-text'>" +
      "<strong>Route to " + escapeHtml(label) + "</strong>" +
      "<span>" + metersToMiles(meters).toFixed(2) + " mi &middot; about " + formatWalkTime(meters) + " walking</span>" +
      "</div>" +
      "<button type='button' class='route-info-close' aria-label='Clear route'>&#10005;</button>";
    document.getElementById("mapContainer").appendChild(routeInfoEl);
    routeInfoEl.querySelector(".route-info-close").addEventListener("click", clearRoute);
  }

  /** Draws a walking route as three connected polylines - a dotted
   *  connector from the walker to the trail network, the solid routed
   *  path along the trails, and a dotted connector from the trail
   *  network to the destination - fits the map to the whole route, and
   *  opens the route info panel.
   */
  function drawRoute(startLatLng, endLatLng, pathLatLngs, meters, label) {
    clearHighlight();
    clearRoute();

    routeLayer = L.layerGroup();
    const trailStart = pathLatLngs[0] || endLatLng;
    const trailEnd = pathLatLngs[pathLatLngs.length - 1] || startLatLng;

    // Thin dotted connector from the walker's actual position to where
    // they join the trail network.
    L.polyline([startLatLng, trailStart], {
      color: "#01579b", weight: 3, dashArray: "2,8", opacity: 0.8, pane: "highlightPane"
    }).addTo(routeLayer);

    // The actual routed path along the trail network.
    L.polyline(pathLatLngs.length ? pathLatLngs : [startLatLng, endLatLng], {
      color: "#01579b", weight: 5, opacity: 0.95, pane: "highlightPane"
    }).addTo(routeLayer);

    // Thin dotted connector from the trail network to the actual
    // destination point.
    L.polyline([trailEnd, endLatLng], {
      color: "#01579b", weight: 3, dashArray: "2,8", opacity: 0.8, pane: "highlightPane"
    }).addTo(routeLayer);

    routeLayer.addTo(map);

    const bounds = L.latLngBounds([startLatLng, endLatLng].concat(pathLatLngs));
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 });

    showRouteInfoPanel(label, meters);
  }

  /** Entry point called from a popup's "Directions from my location"
   *  button. Requires live location tracking to already be on (so we
   *  know where to route FROM) - see setupLocateButton. Builds/reuses
   *  the trail graph, snaps both endpoints onto it, runs Dijkstra, and
   *  hands the result to drawRoute().
   */
  function requestDirectionsTo(destLat, destLng, label) {
    if (!window.__lastKnownLocation) {
      alert('Turn on "Find my location" (the pin button) first so we know your starting point.');
      return;
    }
    const startLat = window.__lastKnownLocation.latitude;
    const startLng = window.__lastKnownLocation.longitude;

    buildTrailGraph(function (graph) {
      if (!graph.nodes.size) {
        alert("The trail network isn't available for routing right now.");
        return;
      }

      const startNode = findNearestNode(graph, startLat, startLng);
      const endNode = findNearestNode(graph, destLat, destLng);
      if (!startNode || !endNode) {
        alert("Couldn't find a nearby trail to route from.");
        return;
      }

      const result = dijkstraPath(graph, startNode.key, endNode.key);
      if (!result) {
        alert(
          'No connected trail route could be found to "' + label + '". The trails near your ' +
          "location and near this destination may not be connected in the map data."
        );
        return;
      }

      const pathLatLngs = result.path.map(function (key) {
        const n = graph.nodes.get(key);
        return [n.lat, n.lng];
      });

      const totalMeters = startNode.dist + result.distanceMeters + endNode.dist;
      drawRoute([startLat, startLng], [destLat, destLng], pathLatLngs, totalMeters, label);
    });
  }

  /** Builds and opens the actual popup DOM for a feature's attributes.
   *  Split out from openFeaturePopup so both the plain single-feature
   *  path AND the merged-trail path (which needs to resolve the combined
   *  length asynchronously first) can share the exact same popup code.
   *
   *  For layers configured with routable: true (Recreation,
   *  Accommodations, Landmarks), this also adds a "Directions from my
   *  location" button that routes there along the trail network.
   */
  function renderFeaturePopup(layerConfig, key, latlng, properties, geometry) {
    const content = buildPopupContent(layerConfig, properties, domainMaps[key], key);
    const isRoutable = layerConfig.routable && geometry && geometry.type === "Point";

    function assemble(photosHtml) {
      const directionsHtml = isRoutable
        ? "<button type='button' class='btn secondary full-width get-directions-btn'>Directions from my location</button>"
        : "";
      return "<div class='popup-card'>" + content.titleHtml + (photosHtml || "") + content.rowsHtml + directionsHtml + "</div>";
    }

    const popup = L.popup({ maxWidth: 300 }).setLatLng(latlng);

    popup.setContent(assemble(layerConfig.hasAttachments ? '<div class="popup-photos-loading">Loading photos…</div>' : ""));
    popup.openOn(map);

    function attachDirectionsHandler() {
      if (!isRoutable) return;
      const el = popup.getElement();
      const btn = el && el.querySelector(".get-directions-btn");
      if (!btn) return;
      const nameLookup = findBestNameField(properties, layerConfig);
      const label = (nameLookup.key && decodeValue(domainMaps[key], nameLookup.key, nameLookup.value)) || layerConfig.title;
      btn.addEventListener("click", function () {
        requestDirectionsTo(geometry.coordinates[1], geometry.coordinates[0], label);
      });
    }
    attachDirectionsHandler();

    if (layerConfig.hasAttachments) {
      loadAttachmentPhotos(layerConfig, properties, function (photosHtml) {
        // Don't clobber the popup if the user has since closed it or
        // opened a different one.
        if (popup.isOpen()) {
          popup.setContent(assemble(photosHtml));
          attachDirectionsHandler();
        }
      });
    }
  }

  /** Opens the popup for a clicked feature. Shared by the visible line
   *  layer AND its invisible wide hit-area layer so clicking either one
   *  produces the exact same result.
   *
   *  For layers configured with mergeSegmentsBy (Trails), this first
   *  resolves every segment sharing the clicked feature's name, lights
   *  all of them up together on the map, and swaps in their combined
   *  length before the popup is drawn - so e.g. clicking any one piece
   *  of a split-and-rejoined trail shows the trail's FULL distance, not
   *  just that one piece's.
   */
  function openFeaturePopup(layerConfig, key, e) {
    L.DomEvent.stopPropagation(e);
    const feature = (e.layer && e.layer.feature) || null;
    const properties = (feature && feature.properties) || {};
    const geometry = feature && feature.geometry;

    if (layerConfig.mergeSegmentsBy && feature) {
      resolveTrailGroup(layerConfig, key, feature, function (group) {
        let propsForPopup = properties;

        if (group.total !== null && group.sumField) {
          propsForPopup = Object.assign({}, properties);
          const lookup = findProp(propsForPopup, group.sumField);
          const targetKey = lookup.key || group.sumField;
          const rounded = Math.round(group.total * 100) / 100;
          propsForPopup[targetKey] = group.features.length > 1
            ? rounded + " (" + group.features.length + " segments combined)"
            : rounded;
        }

        if (group.features.length > 1) {
          highlightFeatureGroup(group.features);
        }

        renderFeaturePopup(layerConfig, key, e.latlng, propsForPopup, geometry);
      });
      return;
    }

    renderFeaturePopup(layerConfig, key, e.latlng, properties, geometry);
  }

  // ====================================================================
  // LOAD ALL LAYERS FROM CONFIG
  // Builds one L.esri.featureLayer per entry in CONFIG.layers (plus its
  // optional casing and hit-area companion layers), wires up click
  // popups, kicks off domain-metadata loading, and builds the matching
  // visibility checkbox in the Layers panel.
  // ====================================================================
  function loadLayers() {
    const toggleListEl = document.getElementById("layerToggleList");

    Object.keys(CONFIG.layers).forEach(function (key) {
      const layerConfig = CONFIG.layers[key];

      if (!layerConfig.url || layerConfig.url.indexOf("PASTE_") === 0) {
        console.warn('Layer "' + key + '" has no URL configured yet. Skipping until you add it in js/config.js.');
        return;
      }

      // Request #5 (previous round): points/lines go in the higher pane,
      // polygons in the lower one, so they always draw above AND
      // intercept clicks first, regardless of load order.
      const pane = layerConfig.geometryType === "polygon" ? "polygonPane" : "lineAndPointPane";

      const options = {
        url: layerConfig.url,
        interactive: true,
        pane: pane,
        pointToLayer: function (geojson, latlng) {
          return L.circleMarker(latlng, {
            radius: 8,
            fillColor: layerConfig.markerColor || "#01579b",
            color: "#ffffff",
            weight: 2,
            fillOpacity: 0.95,
            interactive: true,
            pane: pane
          });
        }
      };

      // IMPORTANT: only set a "style" option for line/polygon layers.
      // esri-leaflet applies options.style() to every feature it draws,
      // including points created via pointToLayer -- so defining it for
      // point layers silently wiped out each marker's fillColor.
      if (layerConfig.geometryType !== "point") {
        options.style = function () {
          const baseStyle = layerConfig.style || { color: "#01579b", weight: 3, fill: false };
          return Object.assign({}, baseStyle, { pane: pane });
        };
      }

      const featureLayer = L.esri.featureLayer(options);

      featureLayer.on("requesterror", function (e) {
        console.warn('Layer "' + key + '" request error:', e.error && e.error.message ? e.error.message : e);
      });

      featureLayer.on("click", function (e) {
        openFeaturePopup(layerConfig, key, e);
      });

      // Purely decorative "casing" underlay (wider plain line/border
      // drawn just behind the real one) for the two-tone trail-tread /
      // boundary-halo look. Only created if the layer config has a
      // casingStyle, and only makes sense for lines and polygons.
      let casingLayer = null;
      if (layerConfig.casingStyle && layerConfig.geometryType !== "point") {
        const casingPane = layerConfig.geometryType === "polygon" ? "polygonCasingPane" : "lineCasingPane";
        casingLayer = L.esri.featureLayer({
          url: layerConfig.url,
          interactive: false,
          pane: casingPane,
          style: function () {
            return Object.assign({}, layerConfig.casingStyle, { pane: casingPane });
          }
        });
        if (layerConfig.visible !== false) {
          casingLayer.addTo(map);
        }
        casingLayerRegistry[key] = casingLayer;
      }

      // Invisible wide "hit area" layer for line features (e.g. trails).
      // Trails are drawn with a thin (weight 2) dashed centerline, which
      // is visually correct but hard to tap accurately, especially on
      // mobile. This adds a fully transparent line drawn much wider on
      // top of it, purely to make clicking/tapping the trail far more
      // forgiving - it doesn't change the trail's appearance at all.
      let hitAreaLayer = null;
      if (layerConfig.geometryType === "line") {
        const hitWeight = layerConfig.clickTolerance || 20;
        hitAreaLayer = L.esri.featureLayer({
          url: layerConfig.url,
          interactive: true,
          pane: "lineHitAreaPane",
          style: function () {
            return {
              color: "#000000",
              weight: hitWeight,
              opacity: 0,
              lineCap: "round",
              pane: "lineHitAreaPane"
            };
          }
        });
        hitAreaLayer.on("click", function (e) {
          openFeaturePopup(layerConfig, key, e);
        });
        if (layerConfig.visible !== false) {
          hitAreaLayer.addTo(map);
        }
        hitAreaLayerRegistry[key] = hitAreaLayer;
      }

      if (layerConfig.visible !== false) {
        featureLayer.addTo(map);
      }

      layerRegistry[key] = featureLayer;
      loadDomainMetadata(key, featureLayer);

      // --- Build a layer visibility toggle checkbox, with a color swatch ---
      const wrapper = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = layerConfig.visible !== false;
      checkbox.addEventListener("change", function () {
        if (checkbox.checked) {
          featureLayer.addTo(map);
          if (casingLayer) casingLayer.addTo(map);
          if (hitAreaLayer) hitAreaLayer.addTo(map);
        } else {
          map.removeLayer(featureLayer);
          if (casingLayer) map.removeLayer(casingLayer);
          if (hitAreaLayer) map.removeLayer(hitAreaLayer);
        }
      });

      const swatch = document.createElement("span");
      swatch.className = "layer-swatch";
      swatch.style.backgroundColor =
        layerConfig.markerColor ||
        (layerConfig.casingStyle && layerConfig.casingStyle.color) ||
        (layerConfig.style && layerConfig.style.color) ||
        "#888888";

      wrapper.appendChild(checkbox);
      wrapper.appendChild(swatch);
      wrapper.appendChild(document.createTextNode(layerConfig.title));
      toggleListEl.appendChild(wrapper);
    });
  }

  loadLayers();

  // ====================================================================
  // FUNCTION 1: SEARCH
  // (Request #1: highlight the real feature instead of a plain
  //  dropped bubble. Request #2: for lines like trails, fit the
  //  map to the WHOLE trail instead of zooming into its middle,
  //  highlight the full line, and mark the start/end unless it's
  //  a closed loop. New: for a mergeSegmentsBy trail, resolve and
  //  highlight EVERY segment sharing that trail's name, not just
  //  the single segment matched by the search query.)
  // ====================================================================
  function setupSearch() {
    const input = document.getElementById("searchInput");
    const searchBtn = document.getElementById("searchBtn");
    const resultsList = document.getElementById("searchResults");

    /** Queries every searchable layer for the current input text and
     *  hands the combined results to renderResults() once every layer's
     *  query has finished.
     */
    function runSearch() {
      const term = input.value.trim();
      resultsList.innerHTML = "";
      clearHighlight();

      if (!term) return;

      const searchableKeys = Object.keys(CONFIG.layers).filter(function (key) {
        return CONFIG.layers[key].searchable && layerRegistry[key];
      });

      if (searchableKeys.length === 0) {
        const li = document.createElement("li");
        li.className = "no-results";
        li.textContent = "No searchable layers configured yet.";
        resultsList.appendChild(li);
        return;
      }

      let pendingQueries = searchableKeys.length;
      let allResults = [];

      searchableKeys.forEach(function (key) {
        const layerConfig = CONFIG.layers[key];
        const featureLayer = layerRegistry[key];
        const field = (layerConfig.searchFields && layerConfig.searchFields[0]) || "Name";
        const escapedTerm = term.replace(/'/g, "''");

        featureLayer.query()
          .where("UPPER(" + field + ") LIKE UPPER('%" + escapedTerm + "%')")
          .run(function (error, featureCollection) {
            pendingQueries -= 1;

            if (error) {
              console.warn('Search query failed for layer "' + key + '":', error);
            }

            if (!error && featureCollection && featureCollection.features.length) {
              featureCollection.features.forEach(function (feature) {
                allResults.push({ layerKey: key, layerTitle: layerConfig.title, feature: feature });
              });
            }

            if (pendingQueries === 0) {
              renderResults(allResults);
            }
          });
      });
    }

    /** Renders the combined search results list, and wires each result
     *  so clicking it highlights the feature (or its whole merged-trail
     *  group) on the map.
     */
    function renderResults(results) {
      resultsList.innerHTML = "";

      if (results.length === 0) {
        const li = document.createElement("li");
        li.className = "no-results";
        li.textContent = "No matches found.";
        resultsList.appendChild(li);
        return;
      }

      results.forEach(function (result) {
        const layerConfig = CONFIG.layers[result.layerKey];
        const nameField = layerConfig.searchDisplayField || "Name";
        const rawName = result.feature.properties[nameField] || "(unnamed feature)";
        const displayName = decodeValue(domainMaps[result.layerKey], nameField, rawName);

        const li = document.createElement("li");
        li.innerHTML = "<span class='result-layer'>" + escapeHtml(layerConfig.title) + "</span>" + escapeHtml(displayName);

        li.addEventListener("click", function () {
          if (layerConfig.mergeSegmentsBy) {
            resolveTrailGroup(layerConfig, result.layerKey, result.feature, function (group) {
              highlightFeatureGroup(group.features);
            });
          } else {
            highlightFeatureGroup([result.feature]);
          }
        });

        resultsList.appendChild(li);
      });
    }

    searchBtn.addEventListener("click", runSearch);
    input.addEventListener("keypress", function (e) {
      if (e.key === "Enter") runSearch();
    });
  }

  // ====================================================================
  // FUNCTION 2: FILTER
  // (Request #3: value lists are now read live from each AGOL
  //  layer - and decoded through the domain if it's a
  //  coded-value field - instead of a hand-typed list that can
  //  drift out of sync with what's actually in the data. That
  //  drift was exactly why applying some filters made everything
  //  disappear: the WHERE clause was matching values, like
  //  "Paved", that don't exist in the layer at all.)
  // ====================================================================
  function setupFilterPanel() {
    const layerSelect = document.getElementById("filterLayerSelect");
    const valueSelect = document.getElementById("filterValueSelect");
    const applyBtn = document.getElementById("applyFilterBtn");
    const clearBtn = document.getElementById("clearFilterBtn");

    Object.keys(CONFIG.layers).forEach(function (key) {
      const layerConfig = CONFIG.layers[key];
      if (!layerConfig.filterable) return;

      const option = document.createElement("option");
      option.value = key;
      option.textContent = layerConfig.title;
      layerSelect.appendChild(option);
    });

    /** Returns true if a value looks like a number, whether it arrived
     *  as an actual number or a numeric string.
     */
    function isNumericValue(v) {
      return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(v));
    }

    /** Rebuilds the value dropdown's <option> list from whatever is
     *  currently in filterValueCache for the given layer.
     */
    function buildValueOptionsFromCache(key) {
      valueSelect.innerHTML = '<option value="">All</option>';
      const entries = filterValueCache[key] || [];
      entries.forEach(function (entry) {
        const option = document.createElement("option");
        option.value = entry.raw;
        option.textContent = entry.label;
        valueSelect.appendChild(option);
      });
    }

    /** Loads the set of values that actually exist in the live layer for
     *  its configured filterField, decoding through the domain map when
     *  available. Falls back to any hand-written CONFIG filterOptions
     *  immediately (in case the network call is slow), then replaces
     *  that with the real, live values once they arrive.
     */
    function loadFilterValues(key, callback) {
      const layerConfig = CONFIG.layers[key];
      const featureLayer = layerRegistry[key];

      if (filterValueCache[key]) {
        callback();
        return;
      }

      if (Array.isArray(layerConfig.filterOptions) && layerConfig.filterOptions.length) {
        filterValueCache[key] = layerConfig.filterOptions.map(function (v) {
          return { raw: v, label: v };
        });
        callback();
      }

      if (!featureLayer || !layerConfig.filterField) return;

      featureLayer.query()
        .fields([layerConfig.filterField])
        .returnGeometry(false)
        .where("1=1")
        .run(function (error, featureCollection) {
          if (error || !featureCollection) {
            console.warn('Could not load live filter values for "' + key + '":', error);
            return;
          }

          const seen = {};
          const entries = [];
          featureCollection.features.forEach(function (feature) {
            const lookup = findProp(feature.properties, layerConfig.filterField);
            const raw = lookup.value;
            if (raw === null || raw === undefined || raw === "") return;
            const rawKey = String(raw);
            if (seen[rawKey]) return;
            seen[rawKey] = true;

            const label = decodeValue(domainMaps[key], lookup.key, raw);
            entries.push({ raw: raw, label: label });
          });

          entries.sort(function (a, b) {
            return String(a.label).localeCompare(String(b.label));
          });

          filterValueCache[key] = entries;
          callback();
        });
    }

    /** Repopulates the value dropdown for whichever layer is currently
     *  selected, loading its live values first if they aren't cached yet.
     */
    function populateValueOptions() {
      const key = layerSelect.value;
      valueSelect.innerHTML = '<option value="">All</option>';
      if (!key) return;

      loadFilterValues(key, function () {
        // Only repaint if the user hasn't since switched to another layer.
        if (layerSelect.value === key) {
          buildValueOptionsFromCache(key);
        }
      });
    }

    layerSelect.addEventListener("change", populateValueOptions);
    populateValueOptions();

    applyBtn.addEventListener("click", function () {
      const key = layerSelect.value;
      const layerConfig = CONFIG.layers[key];
      const featureLayer = layerRegistry[key];

      if (!featureLayer || !layerConfig) return;

      const value = valueSelect.value;

      if (!value) {
        featureLayer.setWhere("1=1");
        return;
      }

      let whereClause;
      if (isNumericValue(value)) {
        // Coded-value domains are frequently stored as numbers - quoting
        // a numeric field's value breaks the query and silently returns
        // zero features, which was part of the "everything disappears" bug.
        whereClause = layerConfig.filterField + " = " + value;
      } else {
        const escapedValue = String(value).replace(/'/g, "''");
        whereClause = layerConfig.filterField + " = '" + escapedValue + "'";
      }

      featureLayer.setWhere(whereClause, function (error) {
        if (error) console.warn('Filter failed for layer "' + key + '":', error);
      });

      // Mirror the same filter onto the decorative casing layer AND the
      // invisible hit-area layer (if this layer has them, e.g. trails)
      // so neither one keeps showing/accepting clicks for features that
      // were just filtered out of the thin dash on top.
      if (casingLayerRegistry[key]) {
        casingLayerRegistry[key].setWhere(whereClause);
      }
      if (hitAreaLayerRegistry[key]) {
        hitAreaLayerRegistry[key].setWhere(whereClause);
      }
    });

    clearBtn.addEventListener("click", function () {
      Object.keys(layerRegistry).forEach(function (key) {
        layerRegistry[key].setWhere("1=1");
        if (casingLayerRegistry[key]) {
          casingLayerRegistry[key].setWhere("1=1");
        }
        if (hitAreaLayerRegistry[key]) {
          hitAreaLayerRegistry[key].setWhere("1=1");
        }
      });
      valueSelect.value = "";
    });
  }

  // ====================================================================
  // FUNCTION 3: CURRENT LOCATION
  // (Request #4: instead of a single one-time ping, tapping the
  //  button now starts a continuously-updating "you are here"
  //  blip - powered by watchPosition - so the user's dot tracks
  //  with them as they move through the park. Tapping again
  //  turns tracking off.)
  // ====================================================================
  function setupLocateButton() {
    const locateBtn = document.getElementById("locateBtn");

    let watchId = null;
    let isTracking = false;
    let locationMarker = null;
    let accuracyCircle = null;
    let hasCentered = false;

    /** Turns off continuous location tracking, clears the browser's
     *  watchPosition subscription, and removes the blip/accuracy circle
     *  from the map.
     */
    function stopTracking() {
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
      watchId = null;
      isTracking = false;
      hasCentered = false;
      locateBtn.classList.remove("locating", "tracking");
      locateBtn.title = "Find my location";

      if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
      if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
    }

    /** Moves (or creates) the "you are here" blip and its accuracy
     *  circle to a new geolocation fix, records it as
     *  window.__lastKnownLocation for routing to use, and re-centers the
     *  map only on the very first fix so panning afterward isn't
     *  interrupted.
     */
    function updateBlip(position) {
      const latlng = [position.coords.latitude, position.coords.longitude];

      window.__lastKnownLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      if (!locationMarker) {
        const blipIcon = L.divIcon({
          className: "user-location-blip",
          html: '<span class="blip-pulse"></span><span class="blip-dot"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });
        locationMarker = L.marker(latlng, {
          icon: blipIcon,
          pane: "locationPane",
          zIndexOffset: 1000,
          interactive: true
        }).bindPopup(buildLocationPopup()).addTo(map);
      } else {
        locationMarker.setLatLng(latlng);
      }

      if (position.coords.accuracy) {
        if (!accuracyCircle) {
          accuracyCircle = L.circle(latlng, {
            radius: position.coords.accuracy,
            color: "#01579b",
            weight: 1,
            fillColor: "#01579b",
            fillOpacity: 0.08,
            pane: "polygonPane"
          }).addTo(map);
        } else {
          accuracyCircle.setLatLng(latlng);
          accuracyCircle.setRadius(position.coords.accuracy);
        }
      }

      // Only snap the map to the user's position the first time we get a
      // fix, so we don't yank the view away every few seconds while
      // they're panning around to look at other parts of the park.
      if (!hasCentered) {
        map.setView(latlng, 17);
        hasCentered = true;
      }
    }

    /** Builds the blip's popup content: a short "You are here" label plus
     *  a real "Stop tracking" button (instead of plain text), so there's
     *  always an obvious, discoverable way to turn tracking off again.
     */
    function buildLocationPopup() {
      const container = document.createElement("div");
      const label = document.createElement("div");
      label.textContent = "You are here";
      label.style.marginBottom = "6px";
      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "btn secondary stop-tracking-btn";
      stopBtn.textContent = "Stop tracking";
      stopBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        stopTracking();
      });
      container.appendChild(label);
      container.appendChild(stopBtn);
      return container;
    }

    locateBtn.addEventListener("click", function () {
      if (!navigator.geolocation) {
        alert("Geolocation is not supported by this browser.");
        return;
      }

      // Already tracking: a tap here just snaps/re-centers the map back
      // onto the current position (handy after panning off to look at
      // another part of the park) - it does NOT stop tracking. Use the
      // "Stop tracking" button in the blip's popup for that.
      if (isTracking) {
        if (window.__lastKnownLocation) {
          map.setView(
            [window.__lastKnownLocation.latitude, window.__lastKnownLocation.longitude],
            Math.max(map.getZoom(), 17)
          );
        }
        return;
      }

      locateBtn.classList.add("locating");

      watchId = navigator.geolocation.watchPosition(
        function (position) {
          locateBtn.classList.remove("locating");
          locateBtn.classList.add("tracking");
          locateBtn.title = "Snap back to my location (tap the blip to stop tracking)";
          isTracking = true;
          updateBlip(position);
        },
        function (error) {
          console.error(error);
          alert("Unable to retrieve your location. Please check your device's location permissions.");
          stopTracking();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    });
  }

  // ====================================================================
  // FUNCTION 4: USER SUBMISSION (Report an Issue)
  // ====================================================================
  function setupReportForm() {
    const reportModal = document.getElementById("reportModal");
    const reportBtn = document.getElementById("reportBtn");
    const closeBtn = document.getElementById("closeReportModal");
    const form = document.getElementById("reportForm");
    const captureBtn = document.getElementById("captureLocationBtn");
    const locationStatus = document.getElementById("reportLocationStatus");
    const messageEl = document.getElementById("reportFormMessage");

    let capturedLocation = null;

    reportBtn.addEventListener("click", function () {
      if (!CONFIG.useHostedReportLayer) {
        if (!CONFIG.externalSurveyUrl || CONFIG.externalSurveyUrl.indexOf("PASTE_") === 0) {
          alert("The external survey link has not been configured yet in js/config.js.");
          return;
        }
        window.open(CONFIG.externalSurveyUrl, "_blank");
        return;
      }
      reportModal.classList.remove("hidden");
    });

    closeBtn.addEventListener("click", function () {
      reportModal.classList.add("hidden");
    });

    captureBtn.addEventListener("click", function () {
      if (!navigator.geolocation) {
        locationStatus.textContent = "Geolocation not supported on this device.";
        return;
      }
      locationStatus.textContent = "Capturing location...";

      navigator.geolocation.getCurrentPosition(
        function (position) {
          capturedLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          locationStatus.textContent =
            "Location captured: " +
            capturedLocation.latitude.toFixed(5) + ", " +
            capturedLocation.longitude.toFixed(5);
          locationStatus.classList.add("captured");
        },
        function () {
          locationStatus.textContent = "Could not capture location. You can still submit without it.";
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      messageEl.textContent = "";
      messageEl.className = "form-message";

      const name = document.getElementById("reportName").value.trim();
      const email = document.getElementById("reportEmail").value.trim();
      const issueType = document.getElementById("reportIssueType").value;
      const description = document.getElementById("reportDescription").value.trim();

      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!name || !email || !issueType || !description) {
        messageEl.textContent = "Please fill out all required fields.";
        messageEl.className = "form-message error";
        return;
      }
      if (!emailPattern.test(email)) {
        messageEl.textContent = "Please enter a valid email address.";
        messageEl.className = "form-message error";
        return;
      }
      if (description.length > 1000) {
        messageEl.textContent = "Description is too long (1000 character max).";
        messageEl.className = "form-message error";
        return;
      }

      const reportsLayer = layerRegistry.reports;
      if (!reportsLayer) {
        messageEl.textContent = "The reports layer is not configured yet. Add its URL in js/config.js.";
        messageEl.className = "form-message error";
        return;
      }

      const center = map.getCenter();
      const coords = capturedLocation || window.__lastKnownLocation || {
        latitude: center.lat,
        longitude: center.lng
      };

      const properties = {};
      properties[CONFIG.reportFields.name] = name;
      properties[CONFIG.reportFields.email] = email;
      properties[CONFIG.reportFields.issueType] = issueType;
      properties[CONFIG.reportFields.description] = description;
      properties[CONFIG.reportFields.submittedDate] = Date.now();

      const newFeature = {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [coords.longitude, coords.latitude]
        },
        properties: properties
      };

      const submitBtn = document.getElementById("submitReportBtn");
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";

      reportsLayer.addFeature(newFeature, function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Report";

        if (error) {
          console.error(error);
          messageEl.textContent = "Something went wrong submitting your report. Please try again.";
          messageEl.className = "form-message error";
          return;
        }

        messageEl.textContent = "Thank you! Your report has been submitted.";
        messageEl.className = "form-message success";
        form.reset();
        capturedLocation = null;
        locationStatus.textContent = "Location: not captured";
        locationStatus.classList.remove("captured");

        setTimeout(function () {
          reportModal.classList.add("hidden");
          messageEl.textContent = "";
        }, 1800);
      });
    });
  }

  // ====================================================================
  // ABOUT MODAL
  // Explains what the app is/does. Opens via the (i) button next
  // to the locate button at any time, and - if CONFIG.about.
  // showOnFirstVisit is true - automatically the first time a
  // visitor loads the app on this device (remembered via
  // localStorage so it doesn't nag returning visitors).
  // ====================================================================
  function setupAboutModal() {
    const about = CONFIG.about || {};
    const aboutModal = document.getElementById("aboutModal");
    const aboutBtn = document.getElementById("aboutBtn");
    const closeBtn = document.getElementById("closeAboutModal");
    const dismissBtn = document.getElementById("aboutDismissBtn");
    const titleEl = document.getElementById("aboutTitle");
    const bodyEl = document.getElementById("aboutBody");

    titleEl.textContent = about.title || "About This Map";
    bodyEl.textContent = about.body || "";

    const STORAGE_KEY = "lakesParksTrailExplorer_aboutSeen";

    /** Opens the About modal. */
    function openAbout() {
      aboutModal.classList.remove("hidden");
    }
    /** Closes the About modal and records in localStorage that this
     *  visitor has now seen it, so it won't auto-open again.
     */
    function closeAbout() {
      aboutModal.classList.add("hidden");
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch (e) {
        // Private browsing / storage disabled - not critical, the modal
        // will just show again on the visitor's next visit.
      }
    }

    aboutBtn.addEventListener("click", openAbout);
    closeBtn.addEventListener("click", closeAbout);
    dismissBtn.addEventListener("click", closeAbout);
    aboutModal.addEventListener("click", function (e) {
      if (e.target === aboutModal) closeAbout();
    });

    if (about.showOnFirstVisit !== false) {
      let alreadySeen = false;
      try {
        alreadySeen = localStorage.getItem(STORAGE_KEY) === "1";
      } catch (e) {
        alreadySeen = false;
      }
      if (!alreadySeen) {
        openAbout();
      }
    }
  }

  // ====================================================================
  // SIDE PANEL TOGGLE (the hamburger / "three dashed" menu)
  // Shows/hides the off-canvas side panel by toggling its open/hidden
  // classes whenever the header's menu button is tapped.
  // ====================================================================
  function setupSidePanelToggle() {
    const sidePanel = document.getElementById("sidePanel");
    const menuToggle = document.getElementById("menuToggle");

    menuToggle.addEventListener("click", function () {
      sidePanel.classList.toggle("open");
      sidePanel.classList.toggle("hidden");
    });
  }

  // ====================================================================
  // INITIALIZE EVERYTHING
  // ====================================================================
  setupSearch();
  setupFilterPanel();
  setupLocateButton();
  setupReportForm();
  setupAboutModal();
  setupSidePanelToggle();

})();
