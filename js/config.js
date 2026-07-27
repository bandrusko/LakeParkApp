/* ==========================================================
   Lakes Parks Trail Explorer - CONFIGURATION (Leaflet version)
   ----------------------------------------------------------
   This is the ONLY file you should need to edit once your
   ArcGIS Online (AGOL) hosted feature layers are published.

   Paste each feature layer's REST endpoint URL below. It will
   look something like:
   https://services.arcgis.com/XXXXXXXX/arcgis/rest/services/YourLayerName/FeatureServer/0

   NEW IN THIS VERSION:
   - geometryType : "polygon" | "line" | "point" -> controls draw order
     (point/line layers are placed in a pane above polygon layers so
     they are clickable first, see request #5)
   - popupFields  : exact list of attribute fields to show in the popup,
     in addition to the title field. Omit this key to fall back to the
     old "show everything except internal Esri fields" behavior.
   - filterOptions is now OPTIONAL. If you omit it (or leave it out),
     the Filter panel will automatically ask the live AGOL layer for
     whatever values actually exist in that field (and use the domain's
     friendly names if it's a coded-value domain). This means new
     values added in AGOL later (e.g. new accommodation types) show up
     automatically without editing this file. You can still hard-code
     filterOptions if you want a fixed, curated list / order.
   - casingStyle : OPTIONAL, for "line" or "polygon" layers only. Adds a
     wider, plain underlay drawn just behind the real style, e.g. a
     brown line under a trail's dashed centerline, or a white halo
     behind the park boundary. Purely decorative - not interactive/
     clickable and doesn't affect search or popups. Omit it for a
     plain single-color line/border like before.
   ========================================================== */

const CONFIG = {

  // ---------- App / park identity ----------
  parkName: "Lakes Parks & Wetland Sanctuary Trail Explorer",

  // ---------- Basemap / initial map view ----------
  // Satellite imagery. Other esri-leaflet-basemaps options: "Streets",
  // "Topographic", "Oceans", "NationalGeographic", "Gray", "DarkGray",
  // "ImageryClarity" (sharper imagery), "ShadedRelief", "Terrain".
  basemap: "Imagery",
  initialExtent: {
    center: [45.18794444, -93.19355556],
    zoom: 15
  },

  // ---------- Data layers ----------
  layers: {

    parkBoundary: {
      title: "Park Boundary",
      url: "https://services.arcgis.com/HRPe58bUyBqyyiCt/arcgis/rest/services/AllParks/FeatureServer/0",
      visible: true,
      searchable: false,
      filterable: false,
      geometryType: "polygon",
      // Popup title: app.js now tries this field first, then falls back
      // to guessing any field whose name contains "name" (e.g. ParkName,
      // SITE_NAME) so the popup shows the real park name instead of just
      // "Park Boundary". If it's still showing the wrong thing, open the
      // browser console (F12) after clicking a park - app.js logs the
      // real attribute field list there - and set the exact field name
      // below.
      searchDisplayField: "ParkName",
      // popupFields: [] means no attribute rows are shown below the
      // title - just the park's name.
      popupFields: [],
      // Lighter green outline (dashed) so it doesn't melt into dark tree
      // canopy in the satellite imagery, a soft white halo (casingStyle)
      // behind it so it reads clearly against anything underneath, and a
      // slightly more visible light-green fill so the park area itself
      // stands out at a glance.
      style: { color: "#9ccc65", weight: 3, dashArray: "8,6", fillColor: "#66bb6a", fillOpacity: 0.18 },
      casingStyle: { color: "#ffffff", weight: 6, opacity: 0.85, fill: false }
    },

    trails: {
      title: "Trails",
      url: "https://services.arcgis.com/HRPe58bUyBqyyiCt/arcgis/rest/services/Trails_(2)/FeatureServer/0",
      visible: true,
      searchable: true,
      searchDisplayField: "trail_name",
      searchFields: ["trail_name"],
      filterable: true,
      filterField: "trail_type",
      // filterOptions removed on purpose - the real values in this layer
      // are Crosswalk / Dirt / Multi Use / Sidewalk / Wooden Bridge, not
      // the old placeholder list. The filter panel now reads the real
      // values straight from the layer (see setupFilterPanel in app.js),
      // so this list no longer needs to be kept in sync by hand.
      geometryType: "line",
      // trail_name (title) + trail_type + length_mi show in the popup.
      // If trail_type is a coded-value domain field in AGOL, app.js
      // auto-fetches the domain metadata and swaps the raw code for its
      // full text (e.g. "1" -> "Natural Surface") before display.
      popupFields: ["trail_type", "length_mi"],
      // Classic trail-map "tread" look: a solid orange casing (the path
      // itself) with a thin cream dashed centerline drawn on top, instead
      // of a plain solid line. weight/dashArray on `style` control the
      // thin dashed line; `casingStyle` controls the wide solid underlay
      // peeking out from behind it.
      style: { color: "#fff8e1", weight: 2, dashArray: "1, 7", lineCap: "round", fill: false },
      casingStyle: { color: "#e65100", weight: 6, opacity: 0.9, lineCap: "round", fill: false },
      fieldLabels: { trail_name: "Trail Name", trail_type: "Surface Type", length_mi: "Length (mi)" }
    },

    recreation: {
      title: "Recreational Activities",
      url: "https://services.arcgis.com/HRPe58bUyBqyyiCt/arcgis/rest/services/LakesRecreation/FeatureServer/0",
      visible: true,
      searchable: true,
      searchDisplayField: "recreation",
      searchFields: ["recreation"],
      filterable: true,
      filterField: "activity_t",
      // Same as above - filterOptions is intentionally omitted so the
      // dropdown is always populated from what's actually in the layer
      // (Baseball, Hockey, Tennis, Basketball, Playground, Volleyball,
      // Swimming, Gaga Ball today, and anything added later).
      geometryType: "point",
      // Request: only recreation (title) + activity_t show in the popup.
      popupFields: ["activity_t"],
      markerColor: "#f9a825",
      fieldLabels: { recreation: "Activity Name", activity_t: "Type" }
    },

    accommodations: {
      title: "Accommodations",
      url: "https://services.arcgis.com/HRPe58bUyBqyyiCt/arcgis/rest/services/Accomodations/FeatureServer/0",
      visible: true,
      searchable: true,
      searchDisplayField: "accom_name",
      searchFields: ["accom_name"],
      filterable: true,
      filterField: "accom_type",
      // filterOptions intentionally omitted - populated live from the
      // layer (Gazebo, Bathrooms, Concessions, Drinking Fountain, Parking
      // today; Trail Map, Dog Cleaning Station, Garbage Can, Grill, etc.
      // will just appear automatically once they exist in AGOL).
      geometryType: "point",
      // Request: only accom_name (title) + accom_type show in the popup.
      popupFields: ["accom_type"],
      markerColor: "#6d4c41",
      fieldLabels: { accom_name: "Facility Name", accom_type: "Facility Type" }
    },

    landmarks: {
      title: "Landmarks & Scenic Views",
      url: "https://services.arcgis.com/HRPe58bUyBqyyiCt/arcgis/rest/services/ScenicViews/FeatureServer/0",
      visible: true,
      searchable: true,
      searchDisplayField: "ViewName",
      searchFields: ["ViewName"],
      filterable: false,
      geometryType: "point",
      // Request: only ViewName (title) + ViewDescri show in the popup.
      popupFields: ["ViewDescri"],
      markerColor: "#8e24aa",
      fieldLabels: { ViewName: "Landmark Name", ViewDescri: "Description" }
    },

    // User-submitted data layer. This still stays configured and visible
    // even though submissions now come in through the Survey123 form
    // below - Survey123 writes into this same hosted layer, so this is
    // what makes those submitted reports show up as points on the map.
    reports: {
      title: "User Reports",
      url: "https://services.arcgis.com/HRPe58bUyBqyyiCt/arcgis/rest/services/LakesUserReports/FeatureServer/0",
      visible: true,
      searchable: false,
      filterable: false,
      geometryType: "point",
      markerColor: "#c62828",
      fieldLabels: {
        SubmittedBy: "Submitted By",
        IssueType: "Issue Type",
        Description: "Description",
        SubmittedDate: "Date Submitted"
      }
    }
  },

  // ---------- User submission behavior ----------
  // false = tapping the report (⚠) button opens your Survey123 form in a
  // new tab instead of the app's built-in modal. Survey123 gives people
  // a real map picker for location (not just "use my current position"),
  // plus whatever other question types/photo attachments you build into
  // the form - hence more flexible than the built-in modal.
  useHostedReportLayer: false,
  externalSurveyUrl: "https://arcg.is/1eWyfz3",

  reportFields: {
    name: "SubmittedBy",
    email: "Email",
    issueType: "IssueType",
    description: "Description",
    submittedDate: "SubmittedDate"
  }
};
