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
   - mergeSegmentsBy / mergeSegmentsSumField : OPTIONAL, for "line"
     layers where a single named feature can be stored as MULTIPLE
     separate AGOL segments - e.g. a trail that splits into two paths
     around an obstacle and rejoins further along, so it exists as 2+
     rows in the layer that all share the same trail_name. Set
     mergeSegmentsBy to the field that identifies "these rows are the
     same named feature" (e.g. "trail_name") and mergeSegmentsSumField
     to the numeric field to add together (e.g. "length_mi"). When set,
     clicking ANY segment (or picking it from Search) automatically
     looks up every other segment sharing that name, highlights all of
     them together on the map, and shows their COMBINED length in the
     popup instead of just the one segment you happened to click.
     Leave both unset for layers where every feature is already a
     single, complete geometry (which is most layers/most trails) -
     nothing changes for those.
   ========================================================== */

const CONFIG = {

  // ====================================================================
  // APP / PARK IDENTITY
  // The display name used in the header bar and the browser tab title
  // (see the "PARK NAME" step near the top of app.js).
  // ====================================================================
  parkName: "Lakeside Wetlands Park App",

  // ====================================================================
  // ABOUT PANEL
  // Content shown in the "About this map" modal, opened via the (i)
  // floating button and, when showOnFirstVisit is true, automatically
  // the first time a visitor loads the app on a given device (tracked
  // with localStorage so returning visitors aren't nagged again).
  // ====================================================================
  about: {
    title: "Welcome to the Lakeside Wetlands Park App",
    body: "This interactive map helps you explore the park's trails, recreational activities, accommodations, and scenic landmarks. Use Search to find a feature by name, Filter to show only certain trail or facility types, the location button to see where you are in the park, and the report button to flag an issue you spot along the way.",
    showOnFirstVisit: true
  },

  // ====================================================================
  // WALKING DIRECTIONS
  // Used to estimate walk time on the route info panel when a person
  // gets Directions to a routable point feature (see "routable: true"
  // on individual layers below). Purely for the displayed estimate -
  // doesn't affect which route is chosen.
  // ====================================================================
  routing: {
    walkingSpeedMph: 3
  },

  // ====================================================================
  // BASEMAP / INITIAL MAP VIEW
  // Satellite imagery. Other esri-leaflet-basemaps options: "Streets",
  // "Topographic", "Oceans", "NationalGeographic", "Gray", "DarkGray",
  // "ImageryClarity" (sharper imagery), "ShadedRelief", "Terrain".
  // ====================================================================
  basemap: "Imagery",
  initialExtent: {
    center: [45.18794444, -93.19355556],
    zoom: 15
  },

  // ====================================================================
  // DATA LAYERS
  // Each entry describes one AGOL hosted feature layer and how app.js
  // should draw it, search it, filter it, and popup it.
  // ====================================================================
  layers: {

    /** Park boundary polygon. Drawn as a dashed light-green outline with
     *  a soft white halo (casingStyle) so it reads clearly against dark
     *  tree canopy in the satellite imagery, plus a light-green fill so
     *  the park area stands out at a glance. Not searchable/filterable -
     *  it's just a backdrop. popupFields: [] means the popup shows only
     *  the park's name, with no attribute rows underneath.
     */
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

    /** Trail centerlines. Rendered with the classic trail-map "tread"
     *  look - a solid orange casing underlay peeking out from behind a
     *  thin cream dashed centerline - and given a wide invisible hit
     *  area (clickTolerance) so the thin dashed line is easy to tap.
     *  filterOptions is intentionally omitted so the Filter dropdown
     *  always reflects the real values in the layer (Crosswalk, Dirt,
     *  Multi Use, Sidewalk, Wooden Bridge today) instead of a
     *  hand-typed list that can drift out of sync. mergeSegmentsBy
     *  lets trails split into multiple AGOL rows (e.g. splitting
     *  around a wetland and rejoining) report their combined length
     *  instead of just one segment's.
     */
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
      // Some trails (e.g. Blaine Wetland Sanctuary Trail) are stored as
      // more than one line segment sharing the same trail_name - for
      // example where the trail splits into two paths around a wetland
      // and rejoins further along. This tells app.js "when a segment is
      // clicked or searched, find every other segment with the same
      // trail_name and add their length_mi together" instead of only
      // showing whichever single segment happened to get clicked. Trails
      // that are already one single continuous line are unaffected -
      // they'll just report a "total" that matches their one segment.
      mergeSegmentsBy: "trail_name",
      mergeSegmentsSumField: "length_mi",
      // Classic trail-map "tread" look: a solid orange casing (the path
      // itself) with a thin cream dashed centerline drawn on top, instead
      // of a plain solid line. weight/dashArray on `style` control the
      // thin dashed line; `casingStyle` controls the wide solid underlay
      // peeking out from behind it.
      style: { color: "#fff8e1", weight: 2, dashArray: "1, 7", lineCap: "round", fill: false },
      casingStyle: { color: "#e65100", weight: 6, opacity: 0.9, lineCap: "round", fill: false },
      // How wide (in pixels) the invisible clickable "hit area" drawn on
      // top of this trail should be. Trails are drawn as a thin dashed
      // line, which is hard to tap accurately - this widens the tappable
      // area without changing how the trail actually looks. Defaults to
      // 20px if omitted; bump it up further here if trails are still
      // tricky to select.
      clickTolerance: 20,
      fieldLabels: { trail_name: "Trail Name", trail_type: "Surface Type", length_mi: "Length (mi)" }
    },

    /** Recreational activity points (ball fields, courts, playgrounds,
     *  etc). filterOptions is omitted so the Type dropdown always
     *  matches whatever activity types actually exist in AGOL. Marked
     *  routable so its popups get a "Directions from my location"
     *  button that routes along the Trails network.
     */
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
      fieldLabels: { recreation: "Activity Name", activity_t: "Type" },
      // Adds a "Directions from my location" button to this layer's
      // popups that routes along the Trails network to reach it - see
      // requestDirectionsTo() in app.js. Requires "Find my location" to
      // be turned on first.
      routable: true
    },

    /** Accommodation points (gazebos, restrooms, parking, etc), also
     *  routable and with a live-populated Type filter, same as
     *  Recreational Activities above.
     */
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
      fieldLabels: { accom_name: "Facility Name", accom_type: "Facility Type" },
      routable: true
    },

    /** Scenic landmark points. Not filterable (there's no meaningful
     *  "type" field to filter on), but still searchable and routable
     *  like the other point layers above.
     */
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
      fieldLabels: { ViewName: "Landmark Name", ViewDescri: "Description" },
      routable: true
    },

    /** User-submitted issue reports. This layer stays configured and
     *  visible even though submissions now come in through the
     *  Survey123 form below - Survey123 writes into this same hosted
     *  layer, so this is what makes those submitted reports show up as
     *  points on the map. Unlike the other layers, no popupFields list
     *  is given here on purpose: every Survey123 question shows in the
     *  popup automatically, minus the internal AGOL bookkeeping fields
     *  (see HIDDEN_ATTRIBUTE_FIELDS in app.js). hasAttachments turns on
     *  live fetching of any photo attachments for display as thumbnails.
     */
    reports: {
      title: "User Reports",
      url: "https://services.arcgis.com/HRPe58bUyBqyyiCt/arcgis/rest/services/survey123_a5302d8305ea4db6b648a0968f349ef0_results/FeatureServer/0",
      visible: true,
      searchable: false,
      filterable: false,
      geometryType: "point",
      // The popup title now comes from the "Report Title" question you
      // added in Survey123, instead of the generic "User Reports" layer
      // title. IMPORTANT: "ReportTitle" is a guess at the real field
      // name AGOL gave that question - if the popup title still shows
      // "User Reports" after this change, open a report's popup, check
      // the browser console (F12), and look for the
      // console.debug(...'actual attribute fields available'...) line -
      // it lists the real field names in this layer. Copy the exact
      // name for your title question and paste it in below.
      searchDisplayField: "ReportTitle",
      // No popupFields list here on purpose - unlike the other layers,
      // this one shows EVERY field from your Survey123 form (contact
      // info, description, whatever else you add later) automatically,
      // and only leaves out the backend/admin bookkeeping fields AGOL
      // adds itself (Editor, EditDate, Creator, CreationDate, GlobalID,
      // OBJECTID) - see HIDDEN_ATTRIBUTE_FIELDS in app.js. If a new
      // survey question shouldn't show in the popup, add its field name
      // there instead of listing every field you DO want here.
      // Survey123 photo attachments (if the person attached any) are
      // fetched live from AGOL's attachments REST endpoint and shown as
      // thumbnails in the popup, right under the title, tap/click to
      // view full size.
      hasAttachments: true,
      markerColor: "#c62828",
      fieldLabels: {
        SubmittedBy: "Submitted By",
        IssueType: "Issue Type",
        Description: "Description",
        SubmittedDate: "Date Submitted"
      }
    }
  },

  // ====================================================================
  // USER SUBMISSION BEHAVIOR
  // false = tapping the report (⚠) button opens your Survey123 form in a
  // new tab instead of the app's built-in modal. Survey123 gives people
  // a real map picker for location (not just "use my current position"),
  // plus whatever other question types/photo attachments you build into
  // the form - hence more flexible than the built-in modal.
  // ====================================================================
  useHostedReportLayer: false,
  externalSurveyUrl: "https://arcg.is/1eWyfz3",

  /** Maps the built-in report modal's form fields to the exact AGOL
   *  field names used in the reports feature layer above, so a
   *  submission through the in-app modal (when useHostedReportLayer is
   *  true) lands in the right columns.
   */
  reportFields: {
    name: "SubmittedBy",
    email: "Email",
    issueType: "IssueType",
    description: "Description",
    submittedDate: "SubmittedDate"
  }
};
