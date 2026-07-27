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
   ========================================================== */

(function () {

  // ---------------------------------------------------------
  // 0. LIBRARY LOAD CHECK
  // ---------------------------------------------------------
  if (typeof L === "undefined" || typeof L.esri === "undefined") {
    const banner = document.getElementById("loadError");
    if (banner) banner.classList.remove("hidden");
    console.error(
      "Leaflet or esri-leaflet did not load. Check the network tab for " +
      "blocked/failed requests to cdn.jsdelivr.net, then hard-refresh."
    );
    return;
  }

  // ---------------------------------------------------------
  // 1. PARK NAME (header + tab title)
  // ---------------------------------------------------------
  if (CONFIG.parkName) {
    const headerTitleEl = document.querySelector("#appHeader h1");
    if (headerTitleEl) headerTitleEl.textContent = CONFIG.parkName;
    document.title = CONFIG.parkName;
  }

  // ---------------------------------------------------------
  // 2. MAP INITIALIZATION
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // 2b. CUSTOM PANES (request #5 from a previous round)
  // Polygon layers (park boundary) render in a lower pane so
  // point/line layers always sit visually on top of them AND
  // receive click events first, regardless of the order they
  // finish loading from AGOL.
  // ---------------------------------------------------------
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

  // Highlights (search results) sit above everything else, and the
  // live-location blip sits above that so it's never hidden.
  map.createPane("highlightPane");
  map.getPane("highlightPane").style.zIndex = 460;

  map.createPane("locationPane");
  map.getPane("locationPane").style.zIndex = 470;

  // Holds references to every L.esri.FeatureLayer keyed by the same key used in CONFIG.layers
  const layerRegistry = {};

  // Holds the purely-decorative "casing" companion layer for any layer
  // that has a casingStyle configured, keyed the same as layerRegistry.
  // Not interactive, not clickable, not searchable - just the underlay.
  const casingLayerRegistry = {};

  // Holds decoded coded-value domain maps per layer, e.g.
  // domainMaps.trails.trail_type = { "1": "Dirt", "2": "Multi Use" }
  const domainMaps = {};

  // Cache of live "what values actually exist in this field" results,
  // keyed by layer key, used by the Filter panel (request #3). Cleared
  // whenever a layer's domain metadata arrives late so labels can be
  // re-decoded with the friendly names instead of raw codes.
  const filterValueCache = {};

  // Internal ArcGIS bookkeeping fields we don't want cluttering a popup
  const HIDDEN_ATTRIBUTE_FIELDS = [
    "OBJECTID", "objectid", "FID", "GlobalID", "globalid",
    "Shape__Length", "Shape__Area", "Shape_Length", "Shape_Area",
    "created_user", "created_date", "last_edited_user", "last_edited_date"
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function friendlyFieldLabel(layerConfig, field) {
    if (layerConfig.fieldLabels && layerConfig.fieldLabels[field]) {
      return layerConfig.fieldLabels[field];
    }
    return field
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  // Swaps a raw coded-domain value (e.g. "2") for its full text
  // (e.g. "Multi Use") if that field has a known domain.
  // Otherwise returns the value unchanged.
  function decodeValue(domains, field, value) {
    if (domains && domains[field] && Object.prototype.hasOwnProperty.call(domains[field], value)) {
      return domains[field][value];
    }
    return value;
  }

  // AGOL field names in your actual hosted layers may not match the
  // exact casing/spelling typed into config.js (e.g. config says "Name"
  // but the real field is "NAME" or "FacilityName"). This looks up a
  // field case-insensitively (and ignoring spaces/underscores) so the
  // popup still finds it, and returns both the value and the real key.
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

  // Resolves the field to use as a popup's title. Tries the configured
  // searchDisplayField (or "Name") first; if that doesn't exist on this
  // layer's real schema, falls back to any attribute whose field name
  // contains "name" (e.g. ParkName, SITE_NAME) rather than silently
  // showing the generic layer title (e.g. "Park Boundary") for every
  // feature. This heuristic isn't foolproof - if the popup title still
  // looks wrong, check the console.debug output logged below for the
  // real field list and set searchDisplayField in config.js explicitly.
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

  // Builds the HTML shown inside the popup when a feature is clicked.
  // If layerConfig.popupFields is set, ONLY those fields are shown
  // (in addition to the title field). Otherwise falls back to showing
  // every attribute minus internal Esri housekeeping fields.
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

      if (/date/i.test(wantedField) && typeof value === "number" && value > 1000000000000) {
        value = new Date(value).toLocaleDateString();
      }

      rows +=
        "<tr><th>" + escapeHtml(friendlyFieldLabel(layerConfig, wantedField)) + "</th>" +
        "<td>" + escapeHtml(value) + "</td></tr>";
    });

    // Helps pinpoint real AGOL field names in the console if a popup
    // still looks empty/wrong after this fix — compare against the
    // field names typed into config.js and adjust as needed.
    if (!nameLookup.key || !rows) {
      console.debug('Popup for layer "' + layerKey + '" — actual attribute fields available:', Object.keys(properties));
    }

    let html = "<div class='popup-card'>";
    html += "<div class='popup-layer-tag'>" + escapeHtml(layerConfig.title) + "</div>";
    html += "<h3>" + escapeHtml(title) + "</h3>";
    if (rows) {
      html += "<table class='popup-table'>" + rows + "</table>";
    }
    html += "</div>";
    return html;
  }

  // Fetches the AGOL layer's field metadata once and caches any
  // coded-value domains it finds, so buildPopupContent (and the Filter
  // panel) can decode raw codes into their full display text.
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

  // ---------------------------------------------------------
  // Load all layers from CONFIG and add to the map
  // ---------------------------------------------------------
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
        L.DomEvent.stopPropagation(e);
        const properties = (e.layer && e.layer.feature && e.layer.feature.properties) || {};
        L.popup({ maxWidth: 280 })
          .setLatLng(e.latlng)
          .setContent(buildPopupContent(layerConfig, properties, domainMaps[key], key))
          .openOn(map);
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
        } else {
          map.removeLayer(featureLayer);
          if (casingLayer) map.removeLayer(casingLayer);
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

  // ===========================================================
  // FUNCTION 1: SEARCH
  // (Request #1: highlight the real feature instead of a plain
  //  dropped bubble. Request #2: for lines like trails, fit the
  //  map to the WHOLE trail instead of zooming into its middle,
  //  highlight the full line, and mark the start/end unless it's
  //  a closed loop.)
  // ===========================================================
  function setupSearch() {
    const input = document.getElementById("searchInput");
    const searchBtn = document.getElementById("searchBtn");
    const resultsList = document.getElementById("searchResults");

    let highlightLayer = null;
    let endpointMarkers = [];
    let clearHighlightTimer = null;

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

    // Clicking anywhere else on the map dismisses the highlight.
    map.on("click", clearHighlight);

    function isClosedLoop(coords) {
      const start = coords[0];
      const end = coords[coords.length - 1];
      const dx = Math.abs(start[0] - end[0]);
      const dy = Math.abs(start[1] - end[1]);
      return dx < 1e-7 && dy < 1e-7;
    }

    function highlightFeature(feature) {
      clearHighlight();

      const geomType = feature.geometry && feature.geometry.type;
      const isPoint = geomType === "Point" || geomType === "MultiPoint";

      const geoLayer = L.geoJSON(feature, {
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
        // Fit to the WHOLE feature (the whole trail, not just its
        // midpoint) so long/looping trails are fully visible.
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
      }

      highlightLayer = geoLayer.addTo(map);

      // For line features (trails), also drop start/end markers unless
      // the trail is a closed loop, in which case the highlighted loop
      // itself is the marker and separate endpoints would be redundant.
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

      // Auto-fade the highlight after a while so it doesn't linger
      // forever, but give the user plenty of time to look at it.
      clearHighlightTimer = setTimeout(clearHighlight, 8000);
    }

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
          highlightFeature(result.feature);
        });

        resultsList.appendChild(li);
      });
    }

    searchBtn.addEventListener("click", runSearch);
    input.addEventListener("keypress", function (e) {
      if (e.key === "Enter") runSearch();
    });
  }

  // ===========================================================
  // FUNCTION 2: FILTER
  // (Request #3: value lists are now read live from each AGOL
  //  layer - and decoded through the domain if it's a
  //  coded-value field - instead of a hand-typed list that can
  //  drift out of sync with what's actually in the data. That
  //  drift was exactly why applying some filters made everything
  //  disappear: the WHERE clause was matching values, like
  //  "Paved", that don't exist in the layer at all.)
  // ===========================================================
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

    function isNumericValue(v) {
      return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(v));
    }

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

    // Loads the set of values that actually exist in the live layer for
    // its configured filterField, decoding through the domain map when
    // available. Falls back to any hand-written CONFIG filterOptions
    // immediately (in case the network call is slow), then replaces
    // that with the real, live values once they arrive.
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

      // Mirror the same filter onto the decorative casing layer (if this
      // layer has one, e.g. trails) so the wide underlay doesn't keep
      // showing trails that were just filtered out of the thin dash on top.
      if (casingLayerRegistry[key]) {
        casingLayerRegistry[key].setWhere(whereClause);
      }
    });

    clearBtn.addEventListener("click", function () {
      Object.keys(layerRegistry).forEach(function (key) {
        layerRegistry[key].setWhere("1=1");
        if (casingLayerRegistry[key]) {
          casingLayerRegistry[key].setWhere("1=1");
        }
      });
      valueSelect.value = "";
    });
  }

  // ===========================================================
  // FUNCTION 3: CURRENT LOCATION
  // (Request #4: instead of a single one-time ping, tapping the
  //  button now starts a continuously-updating "you are here"
  //  blip - powered by watchPosition - so the user's dot tracks
  //  with them as they move through the park. Tapping again
  //  turns tracking off.)
  // ===========================================================
  function setupLocateButton() {
    const locateBtn = document.getElementById("locateBtn");

    let watchId = null;
    let isTracking = false;
    let locationMarker = null;
    let accuracyCircle = null;
    let hasCentered = false;

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

    // The blip's popup content: a short label plus a real "Stop
    // tracking" button (instead of plain text), so there's always an
    // obvious, discoverable way to turn tracking off again.
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

  // ===========================================================
  // FUNCTION 4: USER SUBMISSION (Report an Issue)
  // ===========================================================
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

  // ---------------------------------------------------------
  // SIDE PANEL TOGGLE (the hamburger / "three dashed" menu)
  // ---------------------------------------------------------
  function setupSidePanelToggle() {
    const sidePanel = document.getElementById("sidePanel");
    const menuToggle = document.getElementById("menuToggle");

    menuToggle.addEventListener("click", function () {
      sidePanel.classList.toggle("open");
      sidePanel.classList.toggle("hidden");
    });
  }

  // ---------------------------------------------------------
  // INITIALIZE EVERYTHING
  // ---------------------------------------------------------
  setupSearch();
  setupFilterPanel();
  setupLocateButton();
  setupReportForm();
  setupSidePanelToggle();

})();
