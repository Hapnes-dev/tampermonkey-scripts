// ==UserScript==
// @name         IWMAC Designer Import/Export
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.43.0
// @description  Export the current panel as JSON / insert panel JSON into the canvas on the IWMAC Designer (legacy.iwmac.local) — copy a panel's look between panels and plants, with driver-id rebinding and embedded background image + parameter-selector Excel export
// @author       hapnes-dev
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @supportURL   https://github.com/hapnes-dev/tampermonkey-scripts/issues
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js
// @match        http://legacy.iwmac.local/iwmac_designer_v4/*
// @match        https://legacy.iwmac.local/iwmac_designer_v4/*
// @match        https://hapnes-dev.github.io/iwmac-vector/app/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// ==/UserScript==

/*
 * Pure helpers live above the browser body so Node can require() this file
 * for unit checks (same layout as Logic-Designer-Import-Export.user.js).
 * The host internals this script drives are documented in
 * iwmac-designer-reference/CLAUDE.md.
 */

'use strict';

var IWDIE_VERSION = '1.43.0';
var IWDIE_FORMAT = 'iwmac-designer-panel';
var IWDIE_FORMAT_VERSION = 1;

/** The document fields getPanelDataFromDOM() produces (in this order). */
var IWDIE_DOC_KEYS = ['plant_id', 'panel_name', 'panel_width', 'panel_height',
  'org_image_name', 'image_name', 'saved_by', 'single_objects', 'containers', 'graphics'];

/** The two blob fields that dominate an export by size and carry no structure. */
var IWDIE_BLOB_KEYS = ['image_data', 'image_svg_trace'];

/** How many colours iwdieBuildPalette() derives for a vector trace. */
var IWDIE_TRACE_PALETTE_COLORS = 24;

/** Paths shorter than this are dropped from the embedded structural trace. */
var IWDIE_TRACE_STRUCTURE_PATHOMIT = 32;

/* Tracing a supersampled copy of the background is what makes the small labels
   survive. Panel text is drawn at about 8 px, so at 1:1 a glyph stroke is a
   single pixel and its antialiasing dominates the edge the tracer fits; drawing
   the source twice as large with smoothing OFF first turns every source pixel
   into a clean 2x2 block, and the fitted outlines land on the real edges.
   Measured on a 1400x750 panel: the share of pixels in a label row that differ
   from the source by more than 30/255 falls from 7.9% to 1.7%.

   It must be nearest-neighbour. The same test with smoothing ON scored 9.7%,
   worse than not supersampling at all, because interpolated pixels invent
   colours that the quantizer then scatters across the palette.

   2x is the whole win: 3x and 4x both scored 1.6% for 2.3x and 4x the time.
   The cost is roughly the pixel count, near a second per megapixel, so it is
   gated on size — a photo background can already take minutes and quadrupling
   that is not worth 6 percentage points on text that a photo does not have. */
var IWDIE_TRACE_SUPERSAMPLE = 2;
var IWDIE_TRACE_SUPERSAMPLE_MAX_PX = 2000000;  // 2 Mpx in, 8 Mpx traced
var IWDIE_TRACE_MAX_EDGE = 8192;               // stay well inside canvas limits

/** 2 when the source is small enough to be worth tracing enlarged, else 1. */
function iwdieTraceScaleFor(width, height, maxPx, maxEdge) {
  var w = Number(width), h = Number(height);
  var limit = maxPx || IWDIE_TRACE_SUPERSAMPLE_MAX_PX;
  var edge = maxEdge || IWDIE_TRACE_MAX_EDGE;
  if (!(w > 0) || !(h > 0)) return 1;
  if (w * h > limit) return 1;
  if (w * IWDIE_TRACE_SUPERSAMPLE > edge || h * IWDIE_TRACE_SUPERSAMPLE > edge) return 1;
  return IWDIE_TRACE_SUPERSAMPLE;
}

/**
 * A trace taken from a supersampled copy carries coordinates in the enlarged
 * pixel space. The export embeds that SVG beside objects whose posLeft/posTop
 * are in panel pixels, and the standalone .svg is opened as an artboard the
 * size of the panel, so both need the source coordinate system back: the outer
 * viewBox returns to the source size and the traced geometry is scaled into it.
 * Pure so Node can test it.
 */
function iwdieRescaleTraceSvg(svg, scale, width, height) {
  var s = String(svg == null ? '' : svg);
  if (!scale || scale === 1 || s.indexOf('<svg') !== 0) return s;
  var open = s.indexOf('>');
  var close = s.lastIndexOf('</svg>');
  if (open === -1 || close === -1 || close < open) return s;
  var head = s.slice(0, open + 1);
  var body = s.slice(open + 1, close);
  var box = 'viewBox="0 0 ' + width + ' ' + height + '"';
  head = /viewBox="[^"]*"/.test(head)
    ? head.replace(/viewBox="[^"]*"/, box)
    : head.slice(0, head.length - 1) + ' ' + box + '>';
  return head + '<g transform="scale(' + (1 / scale) + ')">' + body + '</g></svg>';
}

/**
 * Decoded byte length of a base64 payload, computed from the string length
 * instead of by decoding it — labelling a 116 kB background should not cost a
 * full decode.
 */
function iwdieBase64ByteLength(b64) {
  var s = String(b64 == null ? '' : b64).replace(/[^A-Za-z0-9+/=]/g, '');
  if (s.length < 4) return 0;
  var pad = s.charAt(s.length - 1) === '=' ? (s.charAt(s.length - 2) === '=' ? 2 : 1) : 0;
  return Math.floor(s.length / 4) * 3 - pad;
}

/** First maxBytes of a base64 payload, decoded. Null if it cannot be decoded. */
function iwdieBase64Head(b64, maxBytes) {
  var chars = Math.ceil((maxBytes || 32) / 3) * 4;
  var s = String(b64 == null ? '' : b64).slice(0, chars);
  s = s.slice(0, Math.floor(s.length / 4) * 4);
  if (!s) return null;
  var bin;
  if (typeof atob === 'function') { try { bin = atob(s); } catch (e) { return null; } }
  else if (typeof Buffer !== 'undefined') bin = Buffer.from(s, 'base64').toString('binary');
  else return null;
  var out = new Uint8Array(bin.length), i;
  for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Pixel size of an embedded background, read from the image header alone. PNG
 * and GIF put it at a fixed offset, so 32 bytes are enough; JPEG hides it
 * behind a segment walk and SVG has no pixel size at all, so both return null
 * rather than pay a full decode for a label.
 */
function iwdieImageHeaderSize(dataUrl) {
  var m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)/.exec(String(dataUrl == null ? '' : dataUrl));
  if (!m) return null;
  var b = iwdieBase64Head(m[1], 32);
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { // PNG IHDR
    return { width: ((b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0),
             height: ((b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0) };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {                  // GIF, little-endian
    return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  return null;
}

/** What the image_data blob is, so a reader never has to open it to find out. */
function iwdieBackgroundInfo(dataUrl, orgImageName) {
  var url = String(dataUrl == null ? '' : dataUrl);
  if (!url) return null;
  var mime = /^data:([^;,]*)/.exec(url);
  var b64 = /;base64,([\s\S]*)$/.exec(url);
  var size = iwdieImageHeaderSize(url);
  if (!size && /^data:image\/svg\+xml/i.test(url)) size = iwdieSvgSize(iwdieSvgTextFromDoc({ image_data: url }));
  return {
    field: 'image_data',
    mime: (mime && mime[1]) || null,
    width: size ? size.width : null,
    height: size ? size.height : null,
    bytes: b64 ? iwdieBase64ByteLength(b64[1]) : null,
    source_name: orgImageName || null
  };
}

/* ---------- the embedded reading contract (ai_guide) and the export summary ----------
 *
 * An export has two kinds of reader: the importer in this script, which reads
 * structure only, and an AI assistant (a Copilot agent, usually) that is handed
 * the file together with a plant's parameter list or equipment order and asked
 * to analyse, extend, relink or rebuild the panel. The assistant has no access
 * to this source and often none to the reference kit, so the file explains
 * itself: what every key is for, which values are allowed, how objects relate
 * to containers, parameters and the background, what must be preserved when a
 * file is edited, and how a valid file is produced from nothing.
 *
 * Everything under ai_guide and summary is documentation and derived fact. The
 * importer never reads either, so a file that lacks them, or carries a stale
 * copy, imports exactly the same — which is why the file format version did
 * not move. The guide has its own version so a reader can tell the generations
 * apart.
 */

/** Generation of the embedded guide; independent of IWDIE_FORMAT_VERSION. */
var IWDIE_AI_GUIDE_VERSION = 2;

/**
 * One row per object field, in the order the host writes them. The same 17
 * fields sit on every entry of single_objects[] and of containers[].items[].
 * Rows are flat on purpose: iwdieStringifyEnvelope() then writes the schema as
 * one row per line, which reads as a table.
 */
var IWDIE_OBJECT_SCHEMA = [
  { field: 'obj_id', type: 'string', required: 'yes', meaning: 'Which palette object this is (its type). An exact id from object_catalogue in this guide or copied from an existing object; an unknown id draws nothing at all. Case and underscores matter.', example: 'number_v3_60px_dark_no_conn' },
  { field: 'name', type: 'string', required: 'yes', meaning: 'Sequential label "object_0", "object_1", ... in array order, no gaps or duplicates within single_objects. The importer renumbers it on insert, so it carries no identity: never match objects between files by name.', example: 'object_12' },
  { field: 'id', type: 'string', required: 'yes', allowed: 'the literal "driver_id"', meaning: 'A host type marker, identical on every object. Not an identifier and not a parameter id. Never change it.', example: 'driver_id' },
  { field: 'posWidth', type: 'integer (pixels)', required: 'yes', meaning: 'Box width. Copy it from an existing object of the same obj_id; never derive it from how wide the text looks.', example: 62 },
  { field: 'posHeight', type: 'integer (pixels)', required: 'yes', meaning: 'Box height.', example: 22 },
  { field: 'posLeft', type: 'integer (pixels)', required: 'yes', meaning: 'X position from the left edge of the canvas (of the container, for a container item). Emit a plain number: a missing or non-numeric value silently lands the object at 0, and a string such as "120px" is read as 120.', example: 1169 },
  { field: 'posTop', type: 'integer (pixels)', required: 'yes', meaning: 'Y position from the top edge of the canvas (of the container, for a container item).', example: 58 },
  { field: 'zIndex', type: 'string', required: 'yes', allowed: 'digits as a string ("110"), or "default"', meaning: 'Stacking order; higher paints on top. Copy the value used by objects of the same role in this file. "default" makes array order the stacking order, so a label emitted before a duct disappears under it.', example: '110' },
  { field: 'tag_text', type: 'string or null', required: 'yes', meaning: 'The visible caption: an instrument code ("RT401 °C"), a header, a label. Objects that show only a value or a symbol ignore it. A single space " " is the palette default on live-value widgets and null occurs on container items; preserve either exactly and never turn one into the other.', example: 'Tilluft' },
  { field: 'linked', type: 'string', required: 'yes', allowed: '"true" or "false"', meaning: 'Whether the host treats the object as bound. Real exports say "true" on every object, because the host sets it on load whenever driver_id is not the literal "driver_id", even when driver_id is empty. A newly authored unlinked object says "false". It proves nothing about whether the binding is valid.', example: 'true' },
  { field: 'link_name', type: 'string', required: 'yes', meaning: 'Host bookkeeping: the literal "link_name" on exported objects, "" on newly authored ones. Never a panel name or a destination.', example: 'link_name' },
  { field: 'link_tag', type: 'string', required: 'yes', meaning: 'IWMAC system tag written by the host tagger (the Tag column of the parameter export); "" or "NA" on most objects. Copy it, never compose one.', example: '' },
  { field: 'sub_group', type: 'string', required: 'yes', meaning: 'Parameter instance letter ("A", "B") from the parameter source (its SGR column); "" when not tagged.', example: '' },
  { field: 'driver_id', type: 'string', required: 'yes', meaning: 'The parameter binding: the full plant-prefixed parameter string, "<plant_id>_<DRIVER>_<address>", copied verbatim from one row of the plant parameter source (its Driver ID column). "" on an exported object that is not linked; the literal "driver_id" on a newly authored unlinked object; on sub_page_* navigation objects the numeric id of the target panel ("16"). Never construct, edit, translate or guess one.', example: '10242_AK3_AKC_0_111_0_0_2532' },
  { field: 'unit_id', type: 'string', required: 'yes', meaning: 'The unit (controller) the parameter belongs to, as the Designer\'s UNITS list names it and the parameter export\'s Unit ID column carries it ("V01", "2180", "000:111"); "" when not linked. The literal string "undefined" occurs in real exports; preserve it.', example: '000:111' },
  { field: 'unit_ref', type: 'string', required: 'yes', meaning: 'Optional stable unit reference; "" in practically every export. Leave it as found.', example: '' },
  { field: 'alias_text', type: 'string', required: 'yes', meaning: 'What the signal is, in words: the parameter description shown to the person who links the object, and the key by which a whole panel is relinked on another plant. "new text" is the Designer default on unbound scaffold objects; keep it.', example: 'u17 Ther Air' }
];

/** One row per container key, as the host writes a plain objects_container. */
var IWDIE_CONTAINER_SCHEMA = [
  { field: 'id', type: 'string', required: 'yes', meaning: 'Container kind; "objects_container" on every production container.', example: 'objects_container' },
  { field: 'unique_id', type: 'string', required: 'yes', meaning: 'MUST contain "custom_" ("custom_30"). A container whose unique_id lacks that substring is silently dropped on insert; the host renumbers it anyway.', example: 'custom_30' },
  { field: 'name', type: 'string', required: 'yes', meaning: '"objects_container_<n>", renumbered on insert.', example: 'objects_container_30' },
  { field: 'type', type: 'string', required: 'yes', allowed: '"container_c" (content only), "container_hc" (header + content), "container_hcf" (header, content, footer), "container_cf" (content + footer)', meaning: 'Layout type.', example: 'container_c' },
  { field: 'container_type', type: 'string', required: 'yes', allowed: '"objects_container" or "table_container"', meaning: 'Flavour. A table_container carries extra keys (num_of_rows, num_of_col, descr_width, val_width, cells, last_y, header_descr) that must be preserved and must not be added to an objects_container.', example: 'objects_container' },
  { field: 'className', type: 'string', required: 'yes', meaning: 'CSS class; equals container_type on production containers.', example: 'objects_container' },
  { field: 'header_footer', type: 'array', required: 'yes', meaning: 'Header and footer rows as {type: "header" or "footer", text, function: "none", function_id: "none"}; an empty array on a plain container.', example: '[]' },
  { field: 'linked', type: 'string', required: 'yes', meaning: 'Host bookkeeping; "0" unless the container is bound to a unit.', example: '0' },
  { field: 'linked_to', type: 'string', required: 'yes', meaning: 'Host bookkeeping; "0" unless bound.', example: '0' },
  { field: 'width', type: 'integer (pixels)', required: 'yes', meaning: 'Container box width. Metadata, not a clip: items may extend past it.', example: 52 },
  { field: 'height', type: 'integer (pixels)', required: 'yes', meaning: 'Container box height.', example: 44 },
  { field: 'left', type: 'integer (pixels)', required: 'yes', meaning: 'X position of the container on the canvas.', example: 920 },
  { field: 'top', type: 'integer (pixels)', required: 'yes', meaning: 'Y position of the container on the canvas.', example: 352 },
  { field: 'zIndex', type: 'integer', required: 'yes', meaning: 'A JSON number here (4), unlike objects, where it is a string.', example: 4 },
  { field: 'items', type: 'array of object entries', required: 'yes', meaning: 'The objects inside the container: the same 17 fields as single_objects entries, positioned relative to the container. See schema.container_item.', example: '[ {object entry}, ... ]' },
  { field: 'title', type: 'string', required: 'no', meaning: 'Custom attribute the host adds; "Objects Container" on production containers.', example: 'Objects Container' }
];

/** One row per key of the panel document, in host order. */
var IWDIE_PANEL_SCHEMA = [
  { field: 'plant_id', type: 'string', required: 'no', meaning: 'The plant the panel belongs to ("3157"); "" for a plant-neutral template. The plant number is also the prefix of every parameter driver_id on that plant.', example: '3157' },
  { field: 'panel_name', type: 'string', required: 'no', meaning: 'The panel name as the Designer shows it.', example: '360.001 Ventilasjon' },
  { field: 'panel_width', type: 'string (CSS length)', required: 'recommended', meaning: 'Canvas width with the px suffix; "1400px" on a standard panel. Without it the panel size is not applied on insert.', example: '1400px' },
  { field: 'panel_height', type: 'string (CSS length)', required: 'recommended', meaning: 'Canvas height with the px suffix; "750px" on a standard panel.', example: '750px' },
  { field: 'org_image_name', type: 'string', required: 'no', meaning: 'Server-side name of the background picture; "" when the panel has none.', example: '00-blank-sidebar-1400x750' },
  { field: 'image_name', type: 'string', required: 'no', meaning: 'Host bookkeeping, normally "".', example: '' },
  { field: 'saved_by', type: 'string', required: 'no', meaning: 'Who saved the panel. Write your agent name when you create or modify a file.', example: 'copilot' },
  { field: 'single_objects', type: 'array of object entries', required: 'yes', meaning: 'Free objects placed directly on the canvas, in creation order. See schema.object_entry.', example: '[ {object entry}, ... ]' },
  { field: 'containers', type: 'array of containers', required: 'yes', meaning: 'Grouped objects (table rows, room cards). [] on most panels. See schema.container.', example: '[]' },
  { field: 'graphics', type: 'array', required: 'yes', meaning: 'Opaque host graphics records. Preserve verbatim; never author one; [] on almost every panel.', example: '[]' },
  { field: 'converted', type: 'string', required: 'no', allowed: '"true"', meaning: 'Present as "true" when a background picture is embedded in image_data.', example: 'true' },
  { field: 'image_svg', type: 'string (SVG markup)', required: 'no', meaning: 'AI-authored background artwork: starts with "<svg", carries a viewBox matching the panel size, contains no <script>. Insert converts it into image_data, and Export writes it back when the panel still carries it, so the drawing survives the round trip as editable vector. Author one when the plant has no background picture for this panel; never as a replacement for a supplied raster, which is copied verbatim. See drawing_style for how the house draws ducts, zones and the exchanger.', example: '<svg viewBox="0 0 1400 750" ...>' }
];

/** One row per top-level key of the export file, in file order. */
function iwdieFileLayout() {
  return [
    { key: 'format', type: 'string', required: 'yes', set_by: 'fixed', meaning: 'File type marker, always "' + IWDIE_FORMAT + '". Checked before anything else is read; any other value is refused.' },
    { key: 'version', type: 'integer', required: 'yes', set_by: 'fixed', meaning: 'File format version, always ' + IWDIE_FORMAT_VERSION + '.' },
    { key: 'exported_at', type: 'string (ISO 8601)', required: 'no', set_by: 'exporter or agent', meaning: 'When the file was produced.' },
    { key: 'generator', type: 'string', required: 'no', set_by: 'exporter or agent', meaning: 'Who produced the file: "IWDIE v' + IWDIE_VERSION + '" for an export. Write your own agent name when you generate or modify a file.' },
    { key: 'ai_guide', type: 'object', required: 'no', set_by: 'exporter', meaning: 'This guide (guide_version ' + IWDIE_AI_GUIDE_VERSION + '). The importer ignores it. Keep it as it is when you return a file, or omit it; never edit it.' },
    { key: 'source_plant_id', type: 'string or null', required: 'no', set_by: 'exporter or agent', meaning: 'The plant the panel came from; the same value as panel.plant_id. Informational.' },
    { key: 'panel_name', type: 'string or null', required: 'no', set_by: 'exporter or agent', meaning: 'Copy of panel.panel_name for readers; keep the two equal.' },
    { key: 'panel_width', type: 'string or null', required: 'no', set_by: 'exporter or agent', meaning: 'Copy of panel.panel_width for readers; keep the two equal.' },
    { key: 'panel_height', type: 'string or null', required: 'no', set_by: 'exporter or agent', meaning: 'Copy of panel.panel_height for readers; keep the two equal.' },
    { key: 'counts', type: 'object', required: 'recommended', set_by: 'exporter or agent', meaning: '{single_objects, containers, graphics}: the lengths of the three arrays in panel. Recompute after adding or removing anything; the importer warns when they disagree.' },
    { key: 'summary', type: 'object', required: 'no', set_by: 'exporter', meaning: 'Facts derived from this panel at export time (object types, linking, units, z-index values, extent). Read it to orient; drop it or recompute it when you return a changed file, because a stale summary misleads the next reader.' },
    { key: 'background_embedded', type: 'boolean', required: 'no', set_by: 'exporter or agent', meaning: 'true when image_data carries the background picture.' },
    { key: 'background', type: 'object or null', required: 'no', set_by: 'exporter', meaning: 'What the image_data blob is (field, mime, width, height, bytes, source_name) so it never has to be opened.' },
    { key: 'panel', type: 'object', required: 'yes', set_by: 'exporter or agent', meaning: 'The panel document itself, the only part the importer draws. See schema.panel.' },
    { key: 'image_data', type: 'string (data URL)', required: 'no', set_by: 'exporter or agent', meaning: 'The background picture as base64, one very long line, deliberately last. Copy it byte-for-byte or omit it; never retype, re-encode or edit it. Older exports carry it inside panel instead; both places are read.' },
    { key: 'image_svg_trace', type: 'string (SVG markup)', required: 'no', set_by: 'exporter', meaning: 'A coarse vector trace of the background, for reading where things are (see structure). Input only: the importer discards it. Never copy it into image_svg.' },
    { key: 'change_log', type: 'array', required: 'no', set_by: 'agent', meaning: 'Optional. When you modify a file you may append entries {when, by, change} here. It is the only sanctioned place for notes; the importer ignores it.' }
  ];
}

/**
 * Facts about the panel that a reader would otherwise count by hand: which
 * palette objects it uses and how often, how many objects carry a parameter
 * binding and to which units, the z-index values in play, how far the content
 * reaches. Pure; the importer never reads it.
 */
function iwdieSummarizeDoc(doc) {
  var single = (doc && Array.isArray(doc.single_objects)) ? doc.single_objects : [];
  var containers = (doc && Array.isArray(doc.containers)) ? doc.containers : [];
  var graphics = (doc && Array.isArray(doc.graphics)) ? doc.graphics : [];
  var isObj = function (o) { return o != null && typeof o === 'object' && !Array.isArray(o); };
  var all = [];          // every object entry, free or contained
  var placed = [];       // [entry, absoluteLeft, absoluteTop]
  var itemCount = 0;
  single.forEach(function (o) {
    if (!isObj(o)) return;
    all.push(o);
    placed.push([o, parseInt(o.posLeft, 10) || 0, parseInt(o.posTop, 10) || 0]);
  });
  containers.forEach(function (c) {
    if (!isObj(c) || !Array.isArray(c.items)) return;
    var cl = parseInt(c.left, 10) || 0, ct = parseInt(c.top, 10) || 0;
    c.items.forEach(function (o) {
      if (!isObj(o)) return;
      all.push(o);
      itemCount++;
      placed.push([o, cl + (parseInt(o.posLeft, 10) || 0), ct + (parseInt(o.posTop, 10) || 0)]);
    });
  });

  function tally(list, keyName, pick) {
    var counts = {}, order = [];
    list.forEach(function (o) {
      var v = pick(o);
      if (v === undefined) return;
      if (!Object.prototype.hasOwnProperty.call(counts, v)) { counts[v] = 0; order.push(v); }
      counts[v]++;
    });
    order.sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0); });
    return order.map(function (v) { var row = {}; row[keyName] = v; row.objects = counts[v]; return row; });
  }
  function str(v) { return v == null ? '' : String(v); }

  var linkedToParameter = 0, navigation = 0, unlinked = 0, other = 0;
  all.forEach(function (o) {
    var id = str(o.driver_id);
    if (/^\d+_/.test(id)) linkedToParameter++;
    else if (id === '' || id === 'driver_id') unlinked++;
    else if (/^\d+$/.test(id) && /^sub_page/.test(str(o.obj_id))) navigation++;
    else other++;
  });

  var extent = null;
  placed.forEach(function (p) {
    var o = p[0], l = p[1], t = p[2];
    var r = l + (parseInt(o.posWidth, 10) || 0), b = t + (parseInt(o.posHeight, 10) || 0);
    if (!extent) extent = { min_left: l, min_top: t, max_right: r, max_bottom: b };
    else {
      if (l < extent.min_left) extent.min_left = l;
      if (t < extent.min_top) extent.min_top = t;
      if (r > extent.max_right) extent.max_right = r;
      if (b > extent.max_bottom) extent.max_bottom = b;
    }
  });
  var canvasW = doc ? parseInt(doc.panel_width, 10) : NaN;
  var canvasH = doc ? parseInt(doc.panel_height, 10) : NaN;
  var outside = 0;
  if (!isNaN(canvasW) && !isNaN(canvasH)) {
    placed.forEach(function (p) {
      var o = p[0];
      // same 2 px of grace as the geometry check: the house's own headers overhang a 1400 canvas by one
      if (p[1] < -2 || p[2] < -2 || p[1] + (parseInt(o.posWidth, 10) || 0) > canvasW + 2 || p[2] + (parseInt(o.posHeight, 10) || 0) > canvasH + 2) outside++;
    });
  }
  var withTag = 0, aliases = {}, aliasCount = 0;
  all.forEach(function (o) {
    if (str(o.tag_text).trim()) withTag++;
    var a = str(o.alias_text);
    if (a && !Object.prototype.hasOwnProperty.call(aliases, a)) { aliases[a] = true; aliasCount++; }
  });

  var roles = tally(all, 'role', function (o) { return iwdieRoleOf(o.obj_id); });

  var COLUMN = 1145;
  var headers = [];
  placed.forEach(function (p) {
    var o = p[0];
    if (!/header/.test(str(o.obj_id))) return;
    headers.push({ title: str(o.tag_text).trim(), left: p[1], top: p[2], width: parseInt(o.posWidth, 10) || 0 });
  });
  headers.sort(function (a, b) { return a.left - b.left || a.top - b.top; });
  headers.forEach(function (h, i) {
    var next = null;
    for (var k = i + 1; k < headers.length; k++) { if (Math.abs(headers[k].left - h.left) < 60) { next = headers[k]; break; } }
    var below = 0;
    placed.forEach(function (p) {
      var o = p[0];
      if (!IWDIE_LIVE_ROLES[iwdieRoleOf(o.obj_id)]) return;
      if (Math.abs(p[1] - h.left) > 300) return;
      if (p[2] > h.top && (!next || p[2] < next.top)) below++;
    });
    h.live_objects_below = below;
  });
  var column = placed.filter(function (p) { return p[1] >= COLUMN; });
  var bands = [], ys = [];
  placed.forEach(function (p) { if (p[1] < COLUMN && IWDIE_LIVE_ROLES[iwdieRoleOf(p[0].obj_id)]) ys.push(p[2]); });
  ys.sort(function (a, b) { return a - b; });
  ys.forEach(function (y) {
    var last = bands[bands.length - 1];
    if (last && y - last.bottom <= 40) { last.bottom = y; last.objects++; }
    else bands.push({ top: y, bottom: y, objects: 1 });
  });
  var svgText = iwdieSvgTextFromDoc(doc);
  var ducts = svgText ? iwdieDuctLinesFromSvg(svgText) : null;
  var layout = {
    what: 'Where things are on this panel, derived from the objects (and from the artwork when it is authored SVG). Sections are the header bars in reading order; value_bands are rows of live objects on the drawing; duct_lines are straight runs parsed from the artwork - curves are not listed.',
    settings_column: column.length ? { from_x: COLUMN, objects: column.length } : null,
    sections: headers,
    value_bands: bands,
    duct_lines: ducts && ducts.length ? ducts : null
  };

  return {
    what: 'Facts derived from this panel when it was exported. Orientation only: the object entries are the truth. Drop or recompute this block when you return a changed file.',
    objects: {
      single_objects: single.length,
      containers: containers.length,
      container_items: itemCount,
      graphics: graphics.length,
      total_object_entries: all.length
    },
    roles: roles,
    layout: layout,
    object_types_used: tally(all, 'obj_id', function (o) { return str(o.obj_id); }),
    linking: {
      linked_to_a_parameter: linkedToParameter,
      navigation_links: navigation,
      unlinked: unlinked,
      other_driver_id_values: other,
      note: 'linked_to_a_parameter counts driver_id values of the form "<plant>_<DRIVER>_...". It says the binding is present in the file, not that it resolves on the plant.'
    },
    units_referenced: tally(all, 'unit_id', function (o) { var u = str(o.unit_id); return u === '' ? undefined : u; }),
    driver_id_plant_prefixes: tally(all, 'plant_prefix', function (o) { var m = /^(\d+)_/.exec(str(o.driver_id)); return m ? m[1] : undefined; }),
    z_index_values: tally(all, 'zIndex', function (o) { return o.zIndex == null ? 'missing' : String(o.zIndex); }),
    text: { objects_with_tag_text: withTag, distinct_alias_texts: aliasCount },
    extent: {
      canvas_width: isNaN(canvasW) ? null : canvasW,
      canvas_height: isNaN(canvasH) ? null : canvasH,
      min_left: extent ? extent.min_left : null,
      min_top: extent ? extent.min_top : null,
      max_right: extent ? extent.max_right : null,
      max_bottom: extent ? extent.max_bottom : null,
      objects_outside_canvas: (!isNaN(canvasW) && !isNaN(canvasH)) ? outside : null
    }
  };
}

/** A complete object entry with the values a newly authored, unlinked object carries. */
function iwdieExampleUnlinkedObject() {
  return {
    obj_id: 'number_v3_label_11px_norm', name: 'object_0', id: 'driver_id',
    posWidth: 100, posHeight: 20, posLeft: 40, posTop: 60, zIndex: '1100',
    tag_text: 'Tilluft', linked: 'false', link_name: '', link_tag: '', sub_group: '',
    driver_id: 'driver_id', unit_id: '', unit_ref: '', alias_text: 'Caption above the supply-air value box'
  };
}

/** A linked entry taken from this export when it has one, else a shaped template with unmistakable placeholders. */
function iwdieExampleLinkedObject(doc) {
  var found = null;
  iwdieEachDriverId(doc, function (id, obj) { if (!found && /^\d+_/.test(id)) found = obj; });
  var out = {};
  if (found) {
    IWDIE_OBJECT_FIELDS.forEach(function (k) { out[k] = Object.prototype.hasOwnProperty.call(found, k) ? found[k] : ''; });
    return out;
  }
  return {
    obj_id: 'number_v3_60px_dark_no_conn', name: 'object_1', id: 'driver_id',
    posWidth: 60, posHeight: 22, posLeft: 1190, posTop: 80, zIndex: '110',
    tag_text: ' ', linked: 'true', link_name: 'link_name', link_tag: '', sub_group: '',
    driver_id: '<Driver ID copied verbatim from one row of the parameter source>',
    unit_id: '<Unit ID of that row>', unit_ref: '',
    alias_text: '<Alias text of that row>'
  };
}

/** The smallest complete file the importer accepts: one label on a blank standard canvas. */
function iwdieExampleMinimalFile() {
  var object = iwdieExampleUnlinkedObject();
  return {
    format: IWDIE_FORMAT,
    version: IWDIE_FORMAT_VERSION,
    generator: '<your agent name>',
    source_plant_id: '',
    panel_name: 'Example',
    panel_width: '1400px',
    panel_height: '750px',
    counts: { single_objects: 1, containers: 0, graphics: 0 },
    background_embedded: false,
    panel: {
      plant_id: '', panel_name: 'Example', panel_width: '1400px', panel_height: '750px',
      org_image_name: '', image_name: '', saved_by: '<your agent name>',
      single_objects: [object], containers: [], graphics: []
    }
  };
}

/** A plain container holding one item, in host shape. Clone real ones rather than authoring from this. */
function iwdieExampleContainer() {
  return {
    id: 'objects_container', unique_id: 'custom_0', name: 'objects_container_0',
    type: 'container_c', container_type: 'objects_container', className: 'objects_container',
    header_footer: [], linked: '0', linked_to: '0',
    width: 52, height: 44, left: 920, top: 352, zIndex: 4,
    items: [{
      obj_id: 'number_v3_label_11px_norm', name: 'object_0', id: 'driver_id',
      posWidth: 50, posHeight: 20, posLeft: 0, posTop: 0, zIndex: '1100',
      tag_text: 'Arb. sp.', linked: 'true', link_name: 'link_name', link_tag: '', sub_group: '',
      driver_id: '', unit_id: '', unit_ref: '', alias_text: 'new text'
    }],
    title: 'Objects Container'
  };
}

/**
 * The reading contract an AI agent needs to work on this file without opening
 * either blob and without access to this source. Sits near the top because
 * that is where a reader that only reads the first part of a large file looks.
 *
 * summary (optional) is the iwdieSummarizeDoc() result for the same document;
 * with it the guide describes the file it is actually in — a panel whose
 * objects all live in containers is told so, instead of being sent to an empty
 * single_objects[] (the failure recorded on plant 4731).
 */
function iwdieBuildAiGuide(hasBackground, constantFields, summary, doc) {
  var skip = [];
  if (hasBackground) skip.push('image_data');
  var s = summary && summary.objects ? summary : null;
  var hasContainers = !!(s && s.objects.containers > 0);
  var onlyContainers = !!(s && s.objects.single_objects === 0 && s.objects.container_items > 0);

  var readOrder = ['counts', 'summary', 'background'];
  if (onlyContainers) readOrder.push('panel.containers[].items');
  else {
    readOrder.push('panel.single_objects');
    if (hasContainers || !s) readOrder.push('panel.containers');
  }

  var coordinates = 'posLeft and posTop are pixels from the top-left corner of the background picture, which is also the canvas (panel_width x panel_height); posWidth and posHeight are the object box. Free objects in panel.single_objects[] use canvas coordinates directly. Objects inside a container (panel.containers[].items[]) are positioned relative to that container: absolute left = container.left + item.posLeft, absolute top = container.top + item.posTop. Compute absolute positions only to reason about layout; never write them back into an item.';
  if (onlyContainers) coordinates += ' In this file every object is a container item and panel.single_objects[] is empty, so every object coordinate you read is container-relative.';
  else if (hasContainers) coordinates += ' This file has both: ' + s.objects.single_objects + ' free objects and ' + s.objects.container_items + ' container items.';

  return {
    guide_version: IWDIE_AI_GUIDE_VERSION,
    quick_start: IWDIE_QUICK_START,
    purpose: 'IWMAC Designer panel export, written by the IWMAC Designer Import/Export userscript. A panel is a set of palette objects placed at pixel positions over one background picture; some panels group objects in containers (table rows, room cards). The same format is what the userscript imports, so a file you return is inserted into the Designer exactly as written.',
    how_to_use: {
      reading: 'Read counts, then summary.roles for what the panel shows and summary.layout for where its sections, value bands and duct runs are, then background for the picture and the object arrays. Every object entry has the same 17 fields (schema.object_entry). The fields that differ between objects describe the panel; the ones listed in constant_fields do not.',
      modifying: 'Change only what the request names, inside panel.single_objects[] and panel.containers[]. Copy every untouched object byte-for-byte, keep array order, recompute counts, keep ai_guide as it is, drop or recompute summary, and return the complete file as a .json attachment. Rules: when_modifying and when_adding_objects.',
      creating: 'Read quick_start. Decide which rows belong on the panel (parameter_selection), pick each row\'s object (signal_to_object) and its place (layout), draw the picture to drawing_style, caption to caption_conventions, and grow examples.starter_ventilation rather than an empty array. Link from the plant parameter source (linking), run self_check, answer with raw JSON only.'
    },
    read_order: readOrder,
    read_order_by_task: IWDIE_READ_ORDER_BY_TASK,
    skip_fields: skip,
    skip_reason: skip.length
      ? 'One very long line of base64. It is placed last so everything above stays readable, and "background" already states its mime, pixel size and byte count.'
      : 'This export carries no embedded picture.',
    coordinates: coordinates,
    file_layout: iwdieFileLayout(),
    schema: {
      panel: IWDIE_PANEL_SCHEMA,
      object_entry: IWDIE_OBJECT_SCHEMA,
      container: IWDIE_CONTAINER_SCHEMA,
      container_item: 'The same 17 fields as schema.object_entry, with three differences: posLeft/posTop are relative to the container, tag_text may be null, and names may repeat across containers (identity is the position within the container). zIndex is still a string.',
      graphic: 'Opaque host records {id, name, attributes, styles, graphic_def, links}. Preserve verbatim when present; never author or edit one.'
    },
    relationships: [
      'object.obj_id -> one entry of object_catalogue: decides what is drawn, whether the object can carry a driver_id, and whether it shows tag_text.',
      'object.driver_id -> one row of the plant parameter source (the Driver ID column of the parameter export, or a row of the iw_gen_driver_parameters dump). unit_id, alias_text, link_tag and sub_group come from the same row; the plant prefix of the driver_id equals panel.plant_id.',
      'container.items[] -> objects positioned relative to container.left/top. A container is one row or card of a grid, not a category; the plain objects_container is what production uses.',
      'counts.* -> the lengths of panel.single_objects, panel.containers and panel.graphics.',
      'background, image_data, panel.converted, panel.org_image_name -> one background picture; every object position is measured against its pixels (background.width x background.height, normally the canvas size).',
      'image_svg_trace -> derived from image_data; reading material only, never rendered.',
      'sub_page_* objects -> driver_id holds the numeric id of the panel they navigate to, not a parameter.',
      'top-level panel_name, panel_width, panel_height, source_plant_id -> copies of panel.panel_name, panel.panel_width, panel.panel_height, panel.plant_id for readers.'
    ],
    identifiers: {
      obj_id: 'Never generated. Copied from the palette catalogue or from an existing object of the same kind.',
      name: 'Generated: "object_<index>" in array order from 0 within single_objects. Renumbered on insert, so it never identifies an object between two files; match objects by obj_id, alias_text, tag_text and position instead.',
      container_unique_id_and_name: '"custom_<n>" and "objects_container_<n>", sequential from 0; unique_id must contain "custom_". Renumbered on insert.',
      driver_id: 'Never generated. Copied verbatim from one row of the plant parameter source. "" on an exported unlinked object, the literal "driver_id" on a newly authored unlinked object, a numeric panel id on sub_page_* objects (from the Designer panel list).',
      unit_id: 'Never generated. Copied verbatim from the same parameter row (Unit ID column).',
      plant_id: 'source_plant_id and panel.plant_id name the plant; "" for a plant-neutral template. When a panel is inserted on another plant the importer offers to rewrite the plant prefix of every driver_id; the rest of the id is plant-specific and only the target plant\'s parameter source can supply it.'
    },
    linking: {
      unlinked_new_object: { id: 'driver_id', driver_id: 'driver_id', linked: 'false', link_name: '', link_tag: '', sub_group: '', unit_id: '', unit_ref: '' },
      unlinked_exported_object: 'driver_id "" with linked "true" and link_name "link_name" is how the Designer itself writes an object nobody has linked. Leave it as found; do not convert it to the new-object placeholders unless asked for a template.',
      linked_object: 'driver_id = the parameter string, unit_id = its unit, alias_text = its description, linked "true"; id stays "driver_id" and link_name stays as found. See examples.linked_object.',
      alias_shapes: {
        what: 'The Alias text column is written by whatever created the unit, so its shape is predictable and can be reconstructed before any panel exists.',
        modbus_units: 'System number, tag and description joined by hyphens - "360.02-RT40-Temperatur Inntak"; a point with no tag drops the middle part - "360.02-Systemvender". Reconstructing the alias from a Modbus point list matched all 272 rows of one plant, so an agent can prepare its bindings from the point list alone and confirm them against the parameter export.',
        vendor_units: 'A vendor path instead - "SNE00108D12A900/Local Hardware IO.JV40 Start tilluftsvifte [  ]" on BACnet, Danfoss names on AK-PC packs. Nothing is derivable: match on the description and copy the row.',
        caution: 'A reconstructed alias is a lookup key, never a binding. Only a row in this plant parameter source gives driver_id and unit_id.'
      },
      parameter_source_columns: {
        'Driver ID': 'object.driver_id, copied verbatim',
        'Unit ID': 'object.unit_id, copied verbatim',
        'Unit name': 'which unit (system) the row belongs to; match it to the panel or section, e.g. "360.001 Ventilasjon"',
        'Alias text': 'object.alias_text, and the text to match a row by',
        'Tag': 'object.link_tag',
        'SGR': 'object.sub_group',
        'Application': '"Analog values" rows feed value boxes; "Digital IO" rows feed LEDs, alarms and state symbols',
        'Access': 'a setpoint object needs a Read/write row; readings use Read rows',
        'Eng unit / Type': 'sanity check that the row matches the object\'s role (temperature, %, Pa, boolean)'
      },
      rules: [
        'Copy driver_id and unit_id verbatim from exactly one row; never build, edit, translate or reuse one from another plant.',
        'Match a row by unit (Unit name), parameter description (Alias text) and object role: readings to value boxes, states to LEDs and alarms, writable rows to setpoint objects.',
        'linked "true" with a driver_id is only structurally linked. Only a row in the plant\'s own parameter source proves the binding; a familiar suffix or a matching prefix proves nothing.',
        'A parameter you cannot find stays unlinked: keep the object, give it an alias_text that says what it should show, and report the gap in your answer rather than inside the file.',
        'Relinking a panel on another plant is done by alias_text against that plant\'s parameter source; the prefix rewrite alone does not make ids resolve.'
      ]
    },
    z_index: {
      meaning: 'zIndex is stacking order: higher paints on top. Objects carry it as a string of digits, containers as a JSON number. "default" is legal but makes array order the stacking order, which hides labels under ducts and value boxes under artwork.',
      rule: 'Copy the zIndex of an existing object with the same role in this file (summary.z_index_values lists the values in use). Never emit "default" into a panel whose objects carry numbers, and never reorder a band to fix a geometry problem.',
      bands_seen_on_ventilation_panels: '5 ducts and headers, 15 dummy arrows, 20 navigation buttons, 40 equipment bodies, 110 value boxes, 375 alarms, LEDs, pumps and valves, 1100 labels. Other panel types use other bands; the supplied file always wins.'
    },
    when_modifying: [
      'Every object you were not asked to change stays byte-for-byte identical: same 17 fields, same values, same JSON types (object zIndex "110" is a string, container zIndex 4 is a number), same whitespace inside strings, same array position.',
      'Placement and linking are different jobs. A move changes posLeft/posTop only; a resize changes posWidth/posHeight only; a link changes driver_id, unit_id, alias_text and linked only. Do one unless the request asks for both.',
      'Delete an object by removing its whole entry; never blank its fields. "Remove the parameter" means clear driver_id, unit_id, unit_ref and alias_text and keep the object with its geometry.',
      'Do not renumber, sort, deduplicate or reorder objects: array order is creation order and, where zIndex is "default", stacking order.',
      'Do not normalise text: a single-space tag_text, a null tag_text, "new text", "undefined", double spaces, odd encodings and trailing punctuation are real values that round-trip through the Designer.',
      'Leave image_data, panel.converted, org_image_name, background, image_svg_trace, containers and graphics alone unless the request is about them. A replaced background whose pixel size differs invalidates every stored coordinate.',
      'Recompute counts after adding or removing anything, and keep the top-level panel_name, panel_width and panel_height equal to panel.*.',
      'Keys outside this schema are dropped by the Designer on the next export, so never store information in new keys; use change_log for notes.'
    ],
    when_adding_objects: [
      'Clone the most similar existing object (same obj_id and role) from this file or from a production export of the same panel type, then change only what differs: position, tag_text, alias_text, and the binding when a parameter row exists.',
      'Take obj_id only from the palette catalogue or an existing object; take posWidth, posHeight and zIndex from the cloned object, never from how large the text looks.',
      'Append at the end of the array with name "object_<next index>". Positions are integers inside the canvas (0..panel_width, 0..panel_height) unless the panel type scrolls (list panels, room-control tables).',
      'A new unlinked object carries linking.unlinked_new_object values and an alias_text that says what it should show, so a person can link it later.',
      'Never put a live object over descriptive text; text, icon and value each get their own rectangle.',
      'To add a container, clone a complete one from this file or a reference export (every key, unique_id containing "custom_"); do not hand-author one from the schema alone.'
    ],
    when_creating: [
      'Start from what the plant has: the unit list and parameter list (the userscript\'s parameter export, columns in linking.parameter_source_columns) or the order and equipment list. One panel usually shows one unit or system ("360.001 Ventilasjon"). Each reading to display becomes one value object, each state one LED, alarm or state object, each caption one label object, each group one header object.',
      'Copy the geometry of a real export of the same panel type when you have one: positions, sizes, zIndex and object vocabulary, with only the plant-specific content replaced. With no export to copy, build from layout (where things go, in measured pixels), signal_to_object (which object a parameter row wants) and parameter_selection (which rows belong on a panel at all) - and say in your answer that the geometry is derived, not cloned.',
      'Set panel.plant_id and source_plant_id to the target plant number when the file is for one plant, or "" for a reusable template; set generator and panel.saved_by to your agent name.',
      'Link from the parameter source when it is supplied (linking); otherwise leave every object unlinked with a descriptive alias_text and say so in your answer.',
      'A production panel sits on a drawing. Copy the plant\'s own background when it has one — Maskin, Oversikt, curve and most Ventilasjon panels do, and that raster is copied verbatim, never redrawn. When the plant has none, author one in image_svg to the house construction in drawing_style: ducts, the rotary exchanger and the zone boxes belong in the artwork, while fans, filters, dampers, coils, pumps, values and alarms stay objects, because only an object can show a signal.',
      'Leave containers and graphics as [] unless the panel type is container-built (list panels, room-control tables); then clone the container structure from a reference export.'
    ],
    object_catalogue: IWDIE_OBJECT_CATALOGUE,
    signal_to_object: IWDIE_SIGNAL_TO_OBJECT,
    layout: IWDIE_LAYOUT,
    parameter_selection: IWDIE_PARAMETER_SELECTION,
    drawing_style: IWDIE_DRAWING_STYLE,
    caption_conventions: IWDIE_CAPTION_CONVENTIONS,
    self_check: IWDIE_SELF_CHECK,
    common_mistakes: IWDIE_COMMON_MISTAKES,
    validate_before_returning: [
      'format is exactly "' + IWDIE_FORMAT + '" and version is ' + IWDIE_FORMAT_VERSION + '.',
      'panel is an object holding single_objects, containers and graphics, all three arrays (empty arrays are fine).',
      'Every object entry, free or in a container, has all 17 fields of schema.object_entry: obj_id is a known palette id, posLeft/posTop/posWidth/posHeight are integers, zIndex is a string, id is "driver_id".',
      'single_objects names run object_0 .. object_<n-1> with no gaps or duplicates.',
      'counts.single_objects, counts.containers and counts.graphics equal the array lengths.',
      'Every container unique_id contains "custom_", its zIndex is a number, and its items follow schema.object_entry.',
      'Every driver_id and unit_id you wrote is copied from one row of the supplied parameter source; none is invented, edited or taken from another plant.',
      'No object you were not asked to change differs from the input, and the array order is unchanged.',
      'Text is UTF-8 ("°C", "æøå"); the file is strict JSON with no comments, trailing commas, single quotes or markdown fences; the first character is "{" and the last is "}"; nothing is truncated or abbreviated. An "..." inside an array makes the whole file unusable.',
      'A long file is returned as a downloadable .json attachment: a chat answer cut off mid-array cannot be imported.'
    ],
    when_information_is_missing: [
      'Never invent an obj_id, driver_id, unit_id, unit_ref, plant_id, navigation target or coordinate. An invented id looks linked and reads nothing.',
      'A parameter you cannot resolve stays unlinked: driver_id "driver_id" and linked "false" on a new object, the original binding untouched on an existing one; alias_text says what it should show.',
      'Unknown size or position: copy from an object of the same obj_id in this file or a reference export; if none exists, say the value is unverified.',
      'Unknown panel size: "1400px" by "750px" is the standard canvas.',
      'Open questions, assumptions and gaps go in your chat answer or in change_log, never in new keys inside panel or on an object.',
      'If you cannot read a knowledge file or the parameter source, say so and stop; do not substitute a document you wrote yourself.'
    ],
    examples: {
      unlinked_new_object: iwdieExampleUnlinkedObject(),
      linked_object: iwdieExampleLinkedObject(doc),
      container: iwdieExampleContainer(),
      minimal_file: iwdieExampleMinimalFile(),
      starter_ventilation: iwdieExampleStarterVentilation()
    },
    object_fields: IWDIE_OBJECT_FIELDS,
    constant_fields: constantFields || null,
    constant_fields_note: constantFields
      ? 'These hold the same value on every object in this export. The host requires them, but they say nothing about this panel — read the fields that differ.'
      : 'Every object field varies across this export.',
    do_not: [
      'Do not change "format" or "version", and do not invent a wrapper, a schema or a format name of your own — "format" is checked before anything else is read.',
      'Do not edit ai_guide, and do not add prose, notes or provenance keys anywhere except change_log; a file that looks improvised is refused.',
      'Do not renumber, reorder or deduplicate objects, and do not "fix" overlaps, out-of-canvas containers or odd-looking values you were not asked about.',
      'Do not construct, translate or copy driver_id or unit_id values across plants; copy them from the target plant\'s parameter source or leave the object unlinked.',
      'Do not re-encode, redraw or retype image_data, and never copy image_svg_trace into image_svg.',
      'Do not answer with a description, a plan or a summary of a panel; the deliverable is the complete file.'
    ]
  };
}

/**
 * Envelope layout is chosen for readers, human and machine: identity first,
 * then the guide, the counts, the summary and the background label, then the
 * panel itself, and only then the blobs. image_data and image_svg_trace are lifted out of the panel
 * document so they land at the very end of the file instead of in the middle
 * of it — they used to be 80-86% of an export, sitting between the objects and
 * the closing brace. Nothing is dropped, so the file still imports on its own;
 * iwdieEnvelopeDoc() puts them back on the way in.
 */
function iwdieBuildEnvelope(doc, meta) {
  meta = meta || {};
  var bg = typeof doc.image_data === 'string' && doc.image_data ? doc.image_data : '';
  var trace = typeof doc.image_svg_trace === 'string' && doc.image_svg_trace ? doc.image_svg_trace : '';
  var panel = {}, k;
  for (k in doc) {
    if (!Object.prototype.hasOwnProperty.call(doc, k)) continue;
    if (IWDIE_BLOB_KEYS.indexOf(k) !== -1) continue;
    panel[k] = doc[k];
  }
  var summary = iwdieSummarizeDoc(doc);
  var env = {
    format: IWDIE_FORMAT,
    version: IWDIE_FORMAT_VERSION,
    exported_at: meta.exported_at || new Date().toISOString(),
    generator: 'IWDIE v' + IWDIE_VERSION,
    ai_guide: iwdieBuildAiGuide(!!bg, iwdieConstantObjectFields(doc.single_objects), summary, doc),
    source_plant_id: doc.plant_id != null ? String(doc.plant_id) : null,
    panel_name: doc.panel_name || null,
    panel_width: doc.panel_width || null,
    panel_height: doc.panel_height || null,
    counts: {
      single_objects: (doc.single_objects || []).length,
      containers: (doc.containers || []).length,
      graphics: (doc.graphics || []).length
    },
    summary: summary,
    background_embedded: doc.converted === 'true' && !!bg,
    background: bg ? iwdieBackgroundInfo(bg, doc.org_image_name) : null
  };
  env.panel = panel;
  if (bg) env.image_data = bg;        // big payloads last, for human readers
  if (trace) { env.image_svg_trace = trace; iwdieNoteTraceInAiGuide(env); }
  return env;
}

/**
 * The panel document as the importer wants it: blobs back inside. Exports
 * written before 1.17.0 keep image_data and image_svg_trace in the panel and
 * are returned untouched, which is what makes every older file still import.
 */
/** An object with no nested object or array — one that fits on a line. */
function iwdieIsFlatObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  for (var key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    var inner = value[key];
    if (inner !== null && typeof inner === 'object') return false;
  }
  return true;
}

/**
 * JSON.stringify(env, null, 2), except that an array whose every element is a
 * flat object is written one element per line.
 *
 * Indenting every field of every object turns 58 objects into 1104 lines — 19
 * lines each, of which six fields are the same on all 58 — so a reader scrolls
 * a thousand lines to see what is really a 58-row table, and cannot compare two
 * objects without holding both in their head. One object per line makes it 60
 * lines, 24% fewer characters, and each object directly comparable with the one
 * above it. It stays valid JSON and parses back identically; only the
 * whitespace differs, so every importer and validator is unaffected.
 *
 * Pure, so Node can check the round trip.
 */
function iwdieStringifyEnvelope(value, indent) {
  indent = indent == null ? 2 : indent;
  function pad(width) { var s = ''; while (s.length < width) s += ' '; return s; }
  function ser(node, depth) {
    var here = pad(depth * indent), inner = pad((depth + 1) * indent), i, parts;
    if (node === null || typeof node !== 'object') return JSON.stringify(node);
    if (Array.isArray(node)) {
      if (!node.length) return '[]';
      var oneLine = true;
      for (i = 0; i < node.length; i++) {
        if (!iwdieIsFlatObject(node[i])) { oneLine = false; break; }
      }
      parts = [];
      for (i = 0; i < node.length; i++) {
        parts.push(inner + (oneLine ? JSON.stringify(node[i]) : ser(node[i], depth + 1)));
      }
      return '[\n' + parts.join(',\n') + '\n' + here + ']';
    }
    var keys = Object.keys(node);
    if (!keys.length) return '{}';
    parts = [];
    for (i = 0; i < keys.length; i++) {
      parts.push(inner + JSON.stringify(keys[i]) + ': ' + ser(node[keys[i]], depth + 1));
    }
    return '{\n' + parts.join(',\n') + '\n' + here + '}';
  }
  return ser(value, 0);
}

/**
 * Fields carrying one value on every object in this export.
 *
 * The host reads all 17 fields off every object, so they must all be written —
 * but on a measured Maskin export six of them (`id`, `link_name`, `link_tag`,
 * `linked`, `sub_group`, `unit_ref`) hold the same value 58 times over. That is
 * a third of every line, repeated, telling a reader nothing about this panel.
 * Naming them once lets a reader ignore them instead of re-reading them.
 */
function iwdieConstantObjectFields(objects) {
  var list = Array.isArray(objects) ? objects.filter(function (o) {
    return o && typeof o === 'object' && !Array.isArray(o);
  }) : [];
  if (list.length < 2) return null;
  var out = null, key, first = list[0];
  for (key in first) {
    if (!Object.prototype.hasOwnProperty.call(first, key)) continue;
    var value = first[key];
    if (value !== null && typeof value === 'object') continue;
    var same = true;
    for (var i = 1; i < list.length; i++) {
      if (list[i][key] !== value) { same = false; break; }
    }
    if (same) { if (!out) out = {}; out[key] = value; }
  }
  return out;
}

/**
 * Describe the trace in the guide once it exists.
 *
 * The guide is built by iwdieBuildEnvelope() and the trace is attached
 * afterwards by iwdiePrepareExportTrace(), so at build time there is never a
 * trace to declare.
 *
 * It is described rather than skipped. Until 1.19.0 the embedded trace was the
 * full-fidelity one — 12 337 paths and 2060 kB, 88% of the file — which no
 * agent could read, so the only sane advice was to ignore it. Now it is traced
 * for structure instead (451 paths, 141 kB on the same panel), which is small
 * enough to read and is the whole reason the field exists.
 */
/** Shapes in an SVG, for a count a reader can compare against an autotrace. */
function iwdieCountSvgShapes(svg) {
  return (String(svg || '').match(/<(path|rect|circle|ellipse|line|polyline|polygon|use)\b/g) || []).length;
}

/**
 * The panel's own artwork came back with it (SVG background). Say so, and drop
 * the trace description: the two never both apply, and an agent told to read a
 * "coarse trace" would ignore the pristine drawing sitting in panel.image_svg.
 */
function iwdieNoteArtworkInAiGuide(env, svg) {
  if (!env || typeof env !== 'object') return env;
  var guide = env.ai_guide;
  if (!guide || typeof guide !== 'object') return env;
  delete guide.structure;
  guide.artwork = {
    field: 'panel.image_svg',
    shapes: iwdieCountSvgShapes(svg),
    what: 'The background of this panel is authored vector artwork, returned verbatim — the same markup that drew it, not a trace of the pixels.',
    use: 'Edit it as SVG when the drawing must change: move a duct, add a branch, resize a zone box. Keep the viewBox and the panel size. Insert re-applies it, so the drawing stays editable for the next round.',
    also: 'image_data holds the same artwork as a data URL and stays the rendered background. Move an object only together with the part of the drawing it sits on.'
  };
  return env;
}

function iwdieNoteTraceInAiGuide(env) {
  if (!env || typeof env !== 'object') return env;
  var guide = env.ai_guide;
  if (!guide || typeof guide !== 'object') return env;
  var trace = String(env.image_svg_trace || '');
  // both directions: a file that lost its trace must lose the description too,
  // or the guide sends a reader looking for a field that is not there
  if (!trace) { delete guide.structure; return env; }
  delete guide.artwork;
  guide.structure = {
    field: 'image_svg_trace',
    paths: (trace.match(/<path/g) || []).length,
    what: 'A coarse vector trace of the background picture: equipment outlines, pipe runs and frames, in panel coordinates. Small paths are dropped, so there is no text in it. The shapes are grouped as the drawing\'s objects, each <g id> named by what it is: Kanaler / Kanal-avtrekk / Kanal-tilluft / Kanal-uteluft (a duct run with its casing, core line and arrows), Sone (a zone box), Sidefelt (the side column), Gjenvinner (the heat exchanger), Symbol, Pil; Kant is an anti-aliasing remnant.',
    use: 'Read it to find where things are — a group\'s path coordinates are the place to put the objects that belong to it — then use panel.single_objects[] for what they are. tag_text and alias_text carry the labels, spelled properly.',
    not: 'It is reading material only. Insert deletes it, and it is never the artwork; image_data is.'
  };
  return env;
}

function iwdieEnvelopeDoc(env) {
  var panel = env && env.panel;
  if (panel == null || typeof panel !== 'object') return panel;
  var lifted = IWDIE_BLOB_KEYS.filter(function (k) {
    return typeof env[k] === 'string' && env[k] && panel[k] == null;
  });
  if (!lifted.length) return panel;
  var d = {}, k;
  for (k in panel) { if (Object.prototype.hasOwnProperty.call(panel, k)) d[k] = panel[k]; }
  lifted.forEach(function (key) { d[key] = env[key]; });
  return d;
}

/**
 * Accepts: the IWDIE envelope, a bare panel document, or the server's
 * array-of-one wrapping ([{...doc}], which is how V3load_design_panel
 * replies). Returns {doc, meta} or {errors:[...]}.
 */
function iwdieParsePayload(parsed) {
  if (parsed == null || typeof parsed !== 'object') {
    return iwdieReject(parsed, ['Not a JSON object — expected an exported panel .json file.']);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return iwdieReject(parsed, ['Empty array — no panel document inside.']);
    return iwdieParsePayload(parsed[0]);
  }
  if (parsed.format === IWDIE_FORMAT) {
    if (parsed.version > IWDIE_FORMAT_VERSION) {
      return iwdieReject(parsed, ['File version ' + parsed.version + ' is newer than this script understands (' + IWDIE_FORMAT_VERSION + '). Update the script.']);
    }
    if (parsed.panel == null || typeof parsed.panel !== 'object') {
      return iwdieReject(parsed, ['Envelope has no "panel" document inside. The wrapper is correct but the panel itself is missing — "panel" must be an object holding single_objects[].']);
    }
    return { doc: iwdieEnvelopeDoc(parsed), meta: parsed };
  }
  if (parsed.format) {
    return iwdieReject(parsed, ['Unknown format "' + parsed.format + '" — this is not an IWMAC Designer panel export' +
      (parsed.format === 'vv-fbx-sketch' ? ' (it is a VV Designer logic sketch — wrong tool)' : '') + '.',
      '"format" must be exactly "' + IWDIE_FORMAT + '". It is checked before anything else is read, so no other value can import — however correct the rest of the file is.']);
  }
  // bare document?
  if (Array.isArray(parsed.single_objects) || Array.isArray(parsed.containers)) {
    return { doc: parsed, meta: null };
  }
  return iwdieReject(parsed, ['Unrecognized JSON — expected {format:"' + IWDIE_FORMAT + '", panel:{...}} or a bare panel document with single_objects[].']);
}

/* ---------- why an AI-written file was rejected, and how to say so back ---------- */

/** The 17 fields the host reads off every object (V3scripts.js:486-503). */
var IWDIE_OBJECT_FIELDS = ['obj_id', 'name', 'id', 'posWidth', 'posHeight', 'posLeft', 'posTop',
  'zIndex', 'tag_text', 'linked', 'link_name', 'link_tag', 'sub_group', 'driver_id',
  'unit_id', 'unit_ref', 'alias_text'];

/**
 * The palette an agent may draw from. Generated from the designer's own live
 * palette dump (820 entries) narrowed to the ids production actually uses: the
 * object census over 22 compiled panels on 6 plants, plus every id on the real
 * Ventilasjon panels. An unknown obj_id renders broken, and before 1.23.0 the
 * only list of legal ids lived in an internal briefing, so an agent holding one
 * export could copy the ids it saw and no more.
 */
var IWDIE_OBJECT_CATALOGUE = {
  how_to_use: 'Pick ids from here; never invent one. Text goes in tag_text and the signal in alias_text, except on equipment, where tag_text is the short name (JV401) and alias_text the description. signal_to_object says which id a given parameter row wants.',
  sizes: 'The size after each id is the palette default. Production stretches headers, banners and duct pieces to the run they cover and leaves symbols at their own size - number_v3_header_grey75 is 60x25 in the palette and 250x20 on every panel that uses it. When this file already has an object in the role you are adding, copy its size.',
  uses: 'uses counts that id across the 22 compiled production panels. A high count is the house habit for the role; uses=0 means legal but rare, and most of those are ventilation pieces that only appear on duct drawings.',
  by_role: {
    header: [
      'number_v3_header_grey75 60x25 uses=6 - header_grey75',
    ],
    label: [
      'number_v3_label_11px_norm 77x20 uses=36 - 11px Normal',
      'number_v3_label_10px_bold 77x20 uses=35 - 10px Bold',
      'number_v3_label_12px_bold 77x20 uses=7 - 12px  Bold',
      'number_v3_label_8px_norm 77x20 uses=7 - 8px Normal',
      'number_v3_label_11px_bold 77x20 uses=2 - 11px Bold',
      'number_v3_label_10px_norm 77x20 uses=0 - 10px Normal',
    ],
    value: [
      'number_v3_value_only 50x20 uses=419 - Value Only',
      'number_v3_40px_no_conn_no_tag 50x20 uses=182 - 40px  Box , No Tag',
      'number_v3_white_value_only 50x20 uses=60 - Value Only White',
      'number_v3_60px_dark_no_conn_no_tag 50x20 uses=15 - 60px Dark Box , No Tag',
      'number_v3_60px_no_conn_no_tag 50x20 uses=9 - 60px  Box , No Tag',
      'number_v3_60px_dark_no_conn 61x21 uses=8 - 60px Dark  No connector',
      'number_v3_60px_no_conn 61x21 uses=8 - 60px No connector',
    ],
    value_conn: [
      'number_v3_R_45px_con_down 45x38 uses=27 - 45px Conn - down',
      'number_v3_R_45px_con_left 62x20 uses=22 - 45px Conn - Left',
      'number_v3_R_45px_con_top 45x38 uses=18 - 45px Conn - top',
      'number_v3_R_45px_con_right 62x20 uses=17 - 45px Conn - Right',
      'number_v3_40px_dark_con_down 41x26 uses=4 - dark reference box, connector down; the cascade setpoint on a duct',
    ],
    value_tag: [
      'number_v3_R_45px_no_conn_tag_up_center 45x20 uses=27 - 45px No conn up center tag',
      'number_v3_R_40px_no_conn_tag_up_center 41x21 uses=25 - 40px No conn up center tag',
      'number_v3_R_45px_no_conn_bott_center 45x20 uses=12 - 45px No conn bott center tag',
      'number_v3_R_60px_no_conn_tag_up_center 60x20 uses=11 - 60px No conn up center tag',
      'number_v3_R_40px_no_conn_tag_up_left 41x21 uses=4 - 40px No conn up left tag',
      'number_v3_R_45px_no_conn_tag_up_left 45x20 uses=0 - 45px No conn up left tag',
    ],
    enum: [
      'number_v3_custom_json_obj 61x21 uses=21 - Free width JSON Obj box',
      'number_v3_60px_json_obj 61x21 uses=0 - Free width JSON Obj box',
    ],
    alarm: [
      'V3_R_34px_circular_alarm_nrm 34x34 uses=219 - 34px Animated Circular Alarmicon',
      'V3_R_28px_circular_cooling_nrm 28x28 uses=152 - 28px Circular Cooling icon',
      'V3_R_28px_circular_defrost_nrm 28x28 uses=152 - 28px Circular Defrost icon',
      'V3_R_24px_anim_rg_alarm_nrm 24x24 uses=18 - 24px anim/grey alarmbell',
      'V3_ok_alarm_nrm 60x20 uses=10 - CO2 Alarm Normal',
    ],
    led: [
      'V3_led_13px_circ_grey_green 13x13 uses=20 - 13px Grey-Green',
      'V3_led_21px_square_grey_red 21x21 uses=3 - 21px Grey-Red',
      'V3_led_16px_circ_grey_red 16x16 uses=2 - 16px Grey-Red',
      'V3_led_16px_circ_grey_yellow 16x16 uses=0 - 16px Grey-Yellow',
      'V3_led_18px_circ_grey_red 18x18 uses=0 - 18px Grey-Red',
    ],
    fan: [
      'V3_58px_fan_left_nrm 59x59 uses=8 - 58px Fan - Left',
      'V3_58px_fan_right_nrm 59x59 uses=4 - 58px Fan -Right',
    ],
    pump: [
      'V3_21px_single_pump_grey_green_down 21x21 uses=21 - 21px Single pump down',
      'V3_21px_single_pump_grey_green_left 21x21 uses=12 - 21px Single pump left',
      'V3_21px_single_pump_grey_green_up 21x21 uses=7 - 21px Single pump Up',
    ],
    valve: [
      'number_v3_dummy_3way_motor_right 30x19 uses=0 - Dummy 3-way motor right',
      'v3_3w_valve_right_down_nrm 22x18 uses=0 - 3Way-Valve Digital',
    ],
    coil: [
      'number_v3_cooler_2-way 38x132 uses=0 - Cooler 2-Way',
      'number_v3_el_heater 38x65 uses=0 - El-Heater',
      'number_v3_heater_3_way 38x132 uses=0 - Heater 3-Way',
    ],
    filter: [
      'number_v3_filter_only 27x53 uses=4 - Filter only',
      'numberV3_filter_with_diff_press 100x82 uses=0 - Filter w/diff pressure',
    ],
    damper: [
      'V3_horis_damper_flow-left_nrm 36x26 uses=0 - Damper horiz flow-left',
      'V3_vert_damper_flow-up_inv 26x36 uses=0 - Damper vertical flow-up',
      'number_v3_dummy_resirc_damp_hor 36x26 uses=0 - Dummy Damper Resirc Horisontal',
      'number_v3_dummy_resirc_damp_vert 26x36 uses=0 - Dummy Damper Resirc Vertical',
    ],
    duct: [
      'number_v3_exhaust_pipe_horisontal 51x19 uses=11 - Pipe Horisontal',
      'number_v3_exhaust_pipe_vertical 19x51 uses=2 - Pipe Vertical',
      'number_v3_dummy_21x17_Arrow_Left 21x17 uses=0 - Arrow Left',
      'number_v3_dummy_21x17_Arrow_Right 21x17 uses=0 - Arrow Right',
      'number_v3_dummy_6x15_Line_Small_Down 6x15 uses=0 - Small Connector',
      'number_v3_exhaust_connector_up 19x39 uses=0 - Connector Up',
      'number_v3_fresh_pipe_horisontal 51x19 uses=0 - Pipe Horosontal',
      'number_v3_supply_connector_down 19x39 uses=0 - Connector Down',
      'number_v3_supply_pipe_horisontal 51x19 uses=0 - Pipe Horisontal',
      'number_v3_supply_pipe_vertical 19x51 uses=0 - Pipe Vertical',
    ],
    zone: [
      'number_360_room 100x339 uses=0 - Room',
      'number_360_vb 37x52 uses=0 - heating coil',
      'number_360_vg_rot 60x324 uses=0 - VG Roterende',
    ],
    sensor: [
      'number_v3_rc_temp_48 49x21 uses=4 - 48px temperature',
      'numberV3_outside_temp 79x50 uses=0 - Outsite temp',
    ],
    akpc: [
      'V3_akpc_772_781_781A_783_contr 80x80 uses=40 - Controller Groups state 0-8',
      'V3_akpc_782A_suct 80x80 uses=18 - Suction Groups',
      'V3_akpc_783_781A_782A_cond 80x80 uses=8 - Condensing Group',
    ],
    button: [
      'V3_81x21_enebled_disabled_nrm 80x21 uses=10 - Enebled - Disabled',
    ],
  }
};

/** Ten lines that produce a valid, house-shaped file even if nothing else is read. */
var IWDIE_QUICK_START = [
  '1. One JSON object: format "iwmac-designer-panel", version 1, counts, panel{plant_id, panel_name, panel_width "1400px", panel_height "750px", single_objects[], containers[], graphics[]}.',
  '2. Every object has the same 17 fields (schema.object_entry); a new unlinked one uses linking.unlinked_new_object.',
  '3. obj_id only from object_catalogue; never invent one.',
  '4. Which object a parameter row wants: signal_to_object. Where it goes: layout. Which rows belong on a panel at all: parameter_selection.',
  '5. The picture is artwork (panel.image_svg, drawn to drawing_style) or the plant\'s own background; fans, filters, dampers, coils, pumps, values and alarms are objects on top of it.',
  '6. tag_text is what the operator reads (caption_conventions); alias_text is the signal, and the key a linker matches.',
  '7. Link only by copying driver_id and unit_id from one row of the plant parameter source; otherwise leave driver_id "driver_id" and linked "false".',
  '8. zIndex bands: 5 ducts and headers, 40 equipment, 110 values, 375 bells, LEDs and pumps, 1100 labels.',
  '9. Run self_check before returning; Insert runs the same checks and shows the report before anything touches the canvas.',
  '10. Grow examples.starter_ventilation rather than starting from an empty array.'
];

/** Which parts of this file matter for which job, so 45 kB of guide is not read for a one-line edit. */
var IWDIE_READ_ORDER_BY_TASK = {
  to_understand_a_panel: ['counts', 'summary.roles', 'summary.layout', 'background', 'panel.single_objects', 'artwork or structure when present'],
  to_modify_a_panel: ['when_modifying', 'when_adding_objects', 'schema.object_entry', 'linking', 'self_check'],
  to_create_a_panel: ['quick_start', 'parameter_selection', 'signal_to_object', 'layout', 'drawing_style', 'caption_conventions', 'object_catalogue', 'examples.starter_ventilation', 'self_check'],
  to_link_or_relink: ['linking', 'summary.linking', 'summary.units_referenced']
};

/** What production writes in tag_text, by role. Read off real panels, not invented. */
var IWDIE_CAPTION_CONVENTIONS = {
  value_with_caption: 'Instrument code, a space, the unit: "RT52 °C", "RD50 Pa", "SB40 %". The unit is part of the caption; the number comes from the binding.',
  output_under_equipment: '"Padrag %" under a fan or coil; a flow box reads " Luftmengde" or " Sp.rom" with a LEADING space - production uses a non-breaking space (U+00A0) to nudge a centred caption. Copy it byte for byte; never trim it.',
  equipment: 'The short code only - "JV40", "KA50", "QD50", "SB43" - and the description in alias_text.',
  setpoint_box: 'tag_text is a single space " "; the words come from a number_v3_label_10px_bold to its right ("Settpunkt butikk °C").',
  section_header: 'Norwegian, as production writes it: "Butikk settpunkt", "Kontor settpunkt", "Status og vendere", "Vifteregulering", "Temperaturregulering".',
  bell_or_led: 'tag_text "" (empty). The alarm description is alias_text and appears on hover and in the linker.',
  zone_and_room: 'Zone name as a bold label ("Butikk", "Kontor"); room sensors as "RT-60" style codes above their box, " Snitt" for an average.',
  never: 'No value written into tag_text, no unit on an equipment code, no translation of the plant\'s own wording.'
};

/**
 * obj_id -> role, from the catalogue. Used by summary.roles, the geometry checks
 * and any reader that wants "how many setpoints" instead of "how many
 * number_v3_60px_dark_no_conn_no_tag".
 */
var IWDIE_ROLE_INDEX = (function () {
  var index = {};
  var roles = IWDIE_OBJECT_CATALOGUE.by_role;
  Object.keys(roles).forEach(function (role) {
    roles[role].forEach(function (row) { index[String(row).split(' ')[0]] = role; });
  });
  return index;
})();

function iwdieRoleOf(objId) {
  var id = String(objId == null ? '' : objId);
  if (Object.prototype.hasOwnProperty.call(IWDIE_ROLE_INDEX, id)) return IWDIE_ROLE_INDEX[id];
  if (/^sub_page/.test(id)) return 'navigation';
  if (/label/.test(id)) return 'label';
  if (/header/.test(id)) return 'header';
  if (/alarm/.test(id)) return 'alarm';
  if (/led/i.test(id)) return 'led';
  return 'other';
}

/** Roles that show a live value or a state: the ones that must not sit on each other. */
var IWDIE_LIVE_ROLES = { value: 1, value_conn: 1, value_tag: 1, enum: 1, alarm: 1, led: 1, sensor: 1 };

/** The artwork as text, from panel.image_svg or an SVG data URL in image_data. */
function iwdieDecodeBase64Text(b64) {
  var clean = String(b64 || '').replace(/\s+/g, '');
  try {
    if (typeof atob === 'function') {
      var bin = atob(clean), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
      return decodeURIComponent(escape(bin));
    }
  } catch (e) { /* fall through to Buffer */ }
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
  return '';
}

function iwdieSvgTextFromDoc(doc) {
  if (!doc) return '';
  if (typeof doc.image_svg === 'string' && /^\s*<svg/i.test(doc.image_svg)) return doc.image_svg;
  var url = String(doc.image_data || '');
  if (!/^data:image\/svg\+xml/i.test(url)) return '';
  var m = /;base64,([\s\S]*)$/.exec(url);
  if (m) return iwdieDecodeBase64Text(m[1]);
  var q = /^data:[^,]*,([\s\S]*)$/.exec(url);
  try { return q ? decodeURIComponent(q[1]) : ''; } catch (e) { return ''; }
}

/** Pixel size of an SVG from its viewBox, else width/height attributes. */
function iwdieSvgSize(svgText) {
  var s = String(svgText || '');
  var vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(s);
  if (vb) return { width: Math.round(parseFloat(vb[1])), height: Math.round(parseFloat(vb[2])) };
  var w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(s);
  var h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(s);
  if (w && h) return { width: Math.round(parseFloat(w[1])), height: Math.round(parseFloat(h[1])) };
  return null;
}

/**
 * Straight duct runs in authored artwork: every path whose d is "M x y H x2" or
 * "M x y V y2" (the house construction draws each duct as one such path), plus
 * thin rects. Enough to tell an agent where a con_down or con_top may attach;
 * curves and diagonals are left out and said so.
 */
function iwdieDuctLinesFromSvg(svgText) {
  var s = String(svgText || '');
  if (!s) return null;
  var lines = [], seen = {};
  var add = function (orientation, at, from, to) {
    if (from > to) { var t = from; from = to; to = t; }
    var key = orientation + at + ':' + from + '-' + to;
    if (seen[key]) return;
    seen[key] = true;
    lines.push({ orientation: orientation, at: at, from: from, to: to });
  };
  var re = /<path\b[^>]*\bd\s*=\s*["']\s*M\s*([\d.]+)[\s,]+([\d.]+)\s*([HV])\s*([\d.]+)(?:\s*([HV])\s*([\d.]+))?\s*["']/gi, m;
  while ((m = re.exec(s)) !== null) {
    var x = Math.round(+m[1]), y = Math.round(+m[2]);
    if (m[3].toUpperCase() === 'H') { add('horizontal', y, x, Math.round(+m[4])); if (m[5]) add('vertical', Math.round(+m[4]), y, Math.round(+m[6])); }
    else { add('vertical', x, y, Math.round(+m[4])); if (m[5]) add('horizontal', Math.round(+m[4]), x, Math.round(+m[6])); }
  }
  var rr = /<rect\b([^>]*)>/gi, r;
  while ((r = rr.exec(s)) !== null) {
    var a = r[1];
    var g = function (name) { var mm = new RegExp('\\b' + name + '\\s*=\\s*["\']([\\d.]+)', 'i').exec(a); return mm ? +mm[1] : NaN; };
    var rx = g('x'), ry = g('y'), rw = g('width'), rh = g('height');
    if ([rx, ry, rw, rh].some(isNaN)) continue;
    if (rh <= 20 && rw > 40) add('horizontal', Math.round(ry + rh / 2), Math.round(rx), Math.round(rx + rw));
    else if (rw <= 20 && rh > 40) add('vertical', Math.round(rx + rw / 2), Math.round(ry), Math.round(ry + rh));
  }
  lines.sort(function (p, q) { return p.orientation < q.orientation ? -1 : p.orientation > q.orientation ? 1 : p.at - q.at || p.from - q.from; });
  return lines;
}

/**
 * Geometry an agent gets wrong without seeing the picture: things off the
 * canvas, live objects on top of each other, the drawing running under the
 * settings column, one alias shown twice, ids the catalogue does not know.
 * Warnings, never refusals - a real panel may do any of these on purpose.
 */
/**
 * Geometry and linking checks for an incoming panel. Returns the warnings - things
 * worth fixing. Findings that describe house practice rather than a fault (v1.30.0)
 * go into `notes` instead, when the caller passes an array for them: one signal
 * shown on two objects, and an alarm or LED dot placed on the corner of a value box.
 * A caller that passes no array gets the warnings alone, as before.
 *
 * `details` (v1.31.0), when given an object, maps each message string to
 * {lead, items, why}: the headline, EVERY item the message only samples, and the
 * explanation - so the dialog can show a short line with the full list folded
 * under it. The message strings themselves are unchanged.
 */
/** "1 object" / "3 objects" - for headlines people read, where "object(s)" does not. */
function iwdieN(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

var IWDIE_STATUS_ROLES = { alarm: 1, led: 1 };

function iwdieCheckPanelGeometry(doc, notes, details) {
  var warnings = [];
  notes = Array.isArray(notes) ? notes : [];
  details = (details && typeof details === 'object') ? details : {};
  var say = function (list, message, lead, items, why) {
    list.push(message);
    details[message] = { lead: lead, items: items.slice(), why: why || '' };
  };
  var so = (doc && Array.isArray(doc.single_objects)) ? doc.single_objects : [];
  if (!so.length) return warnings;
  var W = parseInt(doc.panel_width, 10), H = parseInt(doc.panel_height, 10);
  var num = function (v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
  var box = function (o) { return { l: num(o.posLeft), t: num(o.posTop), r: num(o.posLeft) + num(o.posWidth), b: num(o.posTop) + num(o.posHeight) }; };
  var label = function (o) { return (o.tag_text && String(o.tag_text).trim()) || (o.alias_text && String(o.alias_text).trim()) || o.obj_id; };

  var outside = [];
  if (!isNaN(W) && !isNaN(H)) {
    // 2 px of grace: the house's own 250-wide headers sit at x 1151 and overhang a 1400 canvas by one
    so.forEach(function (o) { var b = box(o); if (b.l < -2 || b.t < -2 || b.r > W + 2 || b.b > H + 2) outside.push(label(o)); });
  }
  if (outside.length) {
    say(warnings, outside.length + ' object(s) reach outside the ' + W + 'x' + H + ' canvas: ' + outside.slice(0, 3).join(', ') + (outside.length > 3 ? ', …' : ''),
      iwdieN(outside.length, 'object reaches', 'objects reach') + ' outside the ' + W + '×' + H + ' canvas', outside, 'they will be cut off or out of reach');
  }

  var live = so.filter(function (o) { return IWDIE_LIVE_ROLES[iwdieRoleOf(o.obj_id)]; });
  var overlaps = [], dots = [];
  for (var i = 0; i < live.length; i++) {
    var A = box(live[i]);
    for (var j = i + 1; j < live.length; j++) {
      var B = box(live[j]);
      if (A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b) {
        var pair = label(live[i]) + ' / ' + label(live[j]);
        // an alarm or LED dot on a value box is placed there on purpose; two values on each other are not
        var status = IWDIE_STATUS_ROLES[iwdieRoleOf(live[i].obj_id)] || IWDIE_STATUS_ROLES[iwdieRoleOf(live[j].obj_id)];
        (status ? dots : overlaps).push(pair);
      }
    }
  }
  if (overlaps.length) {
    say(warnings, overlaps.length + ' pair(s) of live objects overlap: ' + overlaps.slice(0, 3).join('; ') + (overlaps.length > 3 ? '; …' : ''),
      iwdieN(overlaps.length, 'pair of value boxes sits', 'pairs of value boxes sit') + ' on top of each other', overlaps, 'one hides the other on the panel');
  }
  if (dots.length) {
    say(notes, dots.length + ' alarm or LED dot(s) sit on a value box: ' + dots.slice(0, 3).join('; ') + (dots.length > 3 ? '; …' : '') + ' - the usual way to mark a value with its alarm.',
      iwdieN(dots.length, 'alarm or LED dot sits', 'alarm or LED dots sit') + ' on a value box', dots, 'the usual way to mark a value with its alarm');
  }

  var COLUMN = 1145;
  var hasColumn = so.some(function (o) { return /header/.test(String(o.obj_id)) && num(o.posLeft) >= COLUMN; });
  if (hasColumn) {
    var crossing = so.filter(function (o) { var b = box(o); return b.l < COLUMN && b.r > COLUMN + 5; }).map(label);
    if (crossing.length) {
      say(warnings, crossing.length + ' object(s) run from the drawing into the settings column (x ' + COLUMN + '): ' + crossing.slice(0, 3).join(', ') + (crossing.length > 3 ? ', …' : ''),
        iwdieN(crossing.length, 'object runs', 'objects run') + ' from the drawing into the settings column', crossing, 'the column starts at x ' + COLUMN);
    }
  }

  var seen = {}, dup = [];
  so.forEach(function (o) {
    if (String(o.linked) !== 'true') return;
    var a = String(o.alias_text || '').trim();
    if (!a) return;
    if (seen[a]) { if (seen[a] === 1) dup.push(a); seen[a]++; } else seen[a] = 1;
  });
  if (dup.length) {
    say(notes, dup.length + ' signal(s) are shown on more than one object: ' + dup.slice(0, 2).join(' | ') + (dup.length > 2 ? ' | …' : '') + ' - usual for a damper pair on one command, or a status shown in the drawing and the sidebar.',
      iwdieN(dup.length, 'signal is', 'signals are') + ' shown on more than one object',
      dup.map(function (a) { return a + ' (×' + seen[a] + ')'; }),
      'usual for a damper pair on one command, or a status in the drawing and the sidebar');
  }

  // listed under any role, even "other", is known; only an id the catalogue has never seen is flagged
  var unknown = {};
  so.forEach(function (o) {
    var id = String(o.obj_id || '');
    if (Object.prototype.hasOwnProperty.call(IWDIE_ROLE_INDEX, id) || /^sub_page/.test(id)) return;
    unknown[id] = (unknown[id] || 0) + 1;
  });
  var unk = Object.keys(unknown);
  if (unk.length) {
    say(warnings, unk.length + ' obj_id(s) the catalogue does not list: ' + unk.slice(0, 3).join(', ') + (unk.length > 3 ? ', …' : '') + ' - legal if they are palette ids, broken if typed from memory.',
      iwdieN(unk.length, 'object type', 'object types') + ' the catalogue does not list', unk.map(function (id) { return id + ' (×' + unknown[id] + ')'; }),
      'fine if they are real palette ids, broken if typed from memory');
  }
  return warnings;
}

/**
 * Every check Insert runs, on a file that has not touched the canvas: JSON,
 * envelope, document shape, counts, geometry, authored SVG, and the plant
 * prefix of the bindings. Plus the facts an author wants read back: what the
 * file shows, where its sections are, whether it carries a picture. Verdicts:
 * "refused" (Insert would block it), "warnings" (Insert would take it and warn),
 * "clean". `notes` (v1.30.0) are findings that describe house practice rather
 * than a fault; they never change the verdict, so a file with notes and nothing
 * else is "clean". Pure so the node checks can drive it; the modal only renders it.
 */
function iwdieCheckFile(text, opts) {
  opts = opts || {};
  var out = { verdict: 'refused', errors: [], warnings: [], notes: [], facts: [], details: {}, overview: null, doc: null, meta: null };
  var parsed;
  try { parsed = JSON.parse(String(text == null ? '' : text)); }
  catch (e) {
    var bad = (typeof iwdieDiagnoseBadJson === 'function') ? iwdieDiagnoseBadJson(String(text || ''), e.message) : { errors: ['Not valid JSON: ' + e.message] };
    out.errors = bad.errors || ['Not valid JSON: ' + e.message];
    if (bad.diagnosis) out.diagnosis = bad.diagnosis;
    return out;
  }
  var res = iwdieParsePayload(parsed);
  if (res.errors) {
    out.errors = res.errors.slice();
    if (res.diagnosis) out.diagnosis = res.diagnosis;
    return out;
  }
  out.doc = res.doc; out.meta = res.meta;
  var v = iwdieValidateDoc(res.doc, { allowEmpty: true });
  out.errors = v.errors.slice();
  out.warnings = v.warnings.slice();
  out.warnings = out.warnings.concat(iwdieCheckEnvelopeCounts(res.meta, res.doc));
  if (res.doc && typeof res.doc.image_svg === 'string' && res.doc.image_svg) {
    out.errors = out.errors.concat(iwdieValidateSvg(res.doc.image_svg));
  }
  if (!out.errors.length) out.warnings = out.warnings.concat(iwdieCheckPanelGeometry(res.doc, out.notes, out.details));

  var so = (res.doc && Array.isArray(res.doc.single_objects)) ? res.doc.single_objects : [];
  var total = so.length + ((res.doc && Array.isArray(res.doc.containers)) ? res.doc.containers.length : 0);
  if (total === 0 && !iwdieDocHasBackground(res.doc) && !(res.doc && res.doc.image_svg)) {
    out.errors.push('Panel document is empty — no objects, no containers, no background.');
  }

  var summary = iwdieSummarizeDoc(res.doc);
  var f = out.facts;
  f.push((res.meta && res.meta.format === IWDIE_FORMAT ? 'Envelope' : 'Bare panel document') +
    (res.meta && res.meta.generator ? ', written by ' + res.meta.generator : '') +
    (res.doc && res.doc.panel_name ? ' — panel "' + res.doc.panel_name + '"' : '') +
    (res.doc && res.doc.plant_id ? ' on plant ' + res.doc.plant_id : ', no plant id') + '.');
  f.push(summary.objects.single_objects + ' object(s), ' + summary.objects.containers + ' container(s), ' + summary.objects.graphics + ' graphic(s).');
  if (summary.roles && summary.roles.length) {
    f.push('Roles: ' + summary.roles.slice(0, 7).map(function (r) { return r.objects + ' ' + r.role; }).join(', ') + (summary.roles.length > 7 ? ', …' : '.'));
  }
  f.push('Linked to a parameter: ' + summary.linking.linked_to_a_parameter + '; unlinked: ' + summary.linking.unlinked +
    (summary.linking.navigation_links ? '; navigation: ' + summary.linking.navigation_links : '') + '.');
  if (summary.units_referenced.length) {
    f.push('Units: ' + summary.units_referenced.map(function (u) { return u.unit_id + ' (' + u.objects + ')'; }).join(', ') + '.');
  }
  var prefixes = summary.driver_id_plant_prefixes.map(function (p) { return p.plant_prefix; });
  if (prefixes.length) f.push('Driver ids carry plant prefix ' + prefixes.join(', ') + '.');
  if (opts.plantId && prefixes.length && prefixes.some(function (p) { return String(p) !== String(opts.plantId); })) {
    out.warnings.push('Bindings carry plant prefix ' + prefixes.filter(function (p) { return String(p) !== String(opts.plantId); }).join(', ') +
      ' but this is plant ' + opts.plantId + ' — Insert will offer to rewrite the prefix, and the rest of each id only resolves if that plant has the same parameters.');
  }
  if (summary.layout && summary.layout.sections && summary.layout.sections.length) {
    f.push('Sections: ' + summary.layout.sections.map(function (h) { return h.title || '(untitled)'; }).join(' / ') + '.');
  }
  if (summary.layout && summary.layout.duct_lines && summary.layout.duct_lines.length) {
    f.push(summary.layout.duct_lines.length + ' straight duct run(s) in the artwork.');
  }
  if (res.doc && res.doc.image_svg) f.push('Background: authored SVG artwork (panel.image_svg), ' + iwdieCountSvgShapes(res.doc.image_svg) + ' shapes.');
  else if (iwdieDocHasBackground(res.doc)) f.push('Background: embedded picture (image_data).');
  else f.push('Background: none — Insert takes it, Compile renders no picture behind the objects.');
  if (summary.extent && summary.extent.objects_outside_canvas) f.push(summary.extent.objects_outside_canvas + ' object(s) outside the canvas.');

  // v1.31.0: the same read-back as fields, for the dialog's at-a-glance grid
  out.overview = {
    panel: (res.doc && res.doc.panel_name) || '',
    plant: (res.doc && res.doc.plant_id) ? String(res.doc.plant_id) : '',
    generator: (res.meta && res.meta.generator) || '',
    here: opts.plantId ? String(opts.plantId) : '',
    objects: summary.objects.single_objects, containers: summary.objects.containers, graphics: summary.objects.graphics,
    linked: summary.linking.linked_to_a_parameter, unlinked: summary.linking.unlinked,
    units: summary.units_referenced.map(function (u) { return u.unit_id + ' (' + u.objects + ')'; }),
    prefixes: prefixes,
    background: (res.doc && res.doc.image_svg) ? 'SVG artwork' : iwdieDocHasBackground(res.doc) ? 'embedded picture' : 'none',
    sections: (summary.layout && summary.layout.sections || []).map(function (h) { return h.title || '(untitled)'; }),
    roles: (summary.roles || []).map(function (r) { return r.objects + ' ' + r.role; }),
    ducts: (summary.layout && summary.layout.duct_lines) ? summary.layout.duct_lines.length : 0
  };

  out.verdict = out.errors.length ? 'refused' : (out.warnings.length ? 'warnings' : 'clean');
  if (out.verdict === 'refused' && !out.diagnosis && res.doc) out.diagnosis = iwdieDiagnoseDoc(res.doc, out.errors, out.warnings);
  return out;
}

function iwdieEscHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * The check report as the Insert dialog shows it - pure, so node can test what the
 * user sees. v1.31.0 layout, top to bottom: a verdict banner; an at-a-glance grid
 * of what the file is; errors, warnings and notes as short headlines, each with
 * its full list folded under "show all"; the rest of the read-back folded under
 * "File details". Per-object findings of one kind are grouped into one line.
 * Notes never colour the verdict: a clean file with notes is green.
 * Returns {className, html}; the modal adds the buttons and wires them.
 */
var IWDIE_FINDING_GROUPS = [
  { re: /^single_objects\[(\d+)\]\.(\w+) is missing\/non-numeric — it will land at 0\.$/,
    item: function (m) { return 'object ' + m[1] + ': ' + m[2]; },
    lead: function (n) { return iwdieN(n, 'position field is missing or not a number', 'position fields are missing or not numbers'); },
    why: 'those objects land at 0' },
  { re: /^single_objects\[(\d+)\] has no "obj_id"/,
    item: function (m) { return 'object ' + m[1]; },
    lead: function (n) { return iwdieN(n, 'object has no obj_id', 'objects have no obj_id'); },
    why: 'the designer cannot draw an object without its type' },
  { re: /^single_objects\[(\d+)\] is not an object\./,
    item: function (m) { return 'entry ' + m[1]; },
    lead: function (n) { return iwdieN(n, 'entry in single_objects is not an object', 'entries in single_objects are not objects'); },
    why: '' },
  { re: /^containers\[(\d+)\] is not an object\./,
    item: function (m) { return 'entry ' + m[1]; },
    lead: function (n) { return iwdieN(n, 'entry in containers is not an object', 'entries in containers are not objects'); },
    why: '' }
];

/** Findings as the dialog lists them: one {lead, why, items} per kind. Messages
 *  that name one object each are folded into a single line by
 *  IWDIE_FINDING_GROUPS; messages with an entry in `details` take its headline
 *  and full list; anything else is shown as it is. */
function iwdieGroupFindings(list, details) {
  var out = [], buckets = [];
  (list || []).forEach(function (msg) {
    for (var g = 0; g < IWDIE_FINDING_GROUPS.length; g++) {
      var m = IWDIE_FINDING_GROUPS[g].re.exec(msg);
      if (m) {
        if (!buckets[g]) { buckets[g] = { group: IWDIE_FINDING_GROUPS[g], items: [] }; out.push(buckets[g]); }
        buckets[g].items.push(IWDIE_FINDING_GROUPS[g].item(m));
        return;
      }
    }
    var d = details && details[msg];
    out.push(d ? { lead: d.lead, why: d.why, items: d.items } : { lead: msg, why: '', items: [] });
  });
  return out.map(function (x) {
    return x.group ? { lead: x.group.lead(x.items.length), why: x.group.why, items: x.items } : x;
  });
}

/** One finding per line: the headline in bold, why it matters after it, and the
 *  full list folded under "show all" so a long one never floods the dialog. */
function iwdieFindingsHtml(list, details) {
  var esc = iwdieEscHtml;
  return '<ul class="iwdie-findings">' + iwdieGroupFindings(list, details).map(function (f) {
    var items = f.items || [];
    return '<li><b>' + esc(f.lead) + '</b>' + (f.why ? ' <span class="iwdie-why">— ' + esc(f.why) + '</span>' : '') +
      (items.length ? '<details class="iwdie-items"><summary>' + (items.length === 1 ? 'show it' : 'show all ' + items.length) +
        '</summary><ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' : '') + '</li>';
  }).join('') + '</ul>';
}

function iwdieDiagnosisHtml(diag) {
  var esc = iwdieEscHtml;
  if (!diag || !diag.headline) return '';
  return '<div class="iwdie-diag"><b>' + esc(diag.headline) + '</b>' +
    (diag.facts && diag.facts.length ? '<ul>' + diag.facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
}

function iwdieCheckReportHtml(result, fileName) {
  var esc = iwdieEscHtml;
  var notes = result.notes || [];
  var nw = result.warnings.length;
  var title = result.verdict === 'refused' ? '⛔ This file cannot be inserted' :
    result.verdict === 'warnings' ? '⚠ Ready to insert — ' + iwdieN(nw, 'warning', 'warnings') + ' to look at' :
    '✅ Ready to insert';
  var sub = result.verdict === 'refused' ? 'Fix the errors below first. Nothing has touched the canvas.' :
    result.verdict === 'warnings' ? 'It goes in as it is — the warnings say what may look wrong on the panel.' :
    'Every check passes' + (notes.length ? ' — ' + iwdieN(notes.length, 'thing', 'things') + ' good to know below.' : '.');
  var html = '<div class="iwdie-verdict"><div class="iwdie-v-title">' + esc(title) + '</div>' +
    '<div class="iwdie-v-sub">' + esc(sub) + '</div>' +
    (fileName ? '<div class="iwdie-v-file">' + esc(fileName) + '</div>' : '') + '</div>';

  var ov = result.overview;
  if (ov) {
    var cell = function (k, v) { return '<div class="iwdie-g-k">' + esc(k) + '</div><div class="iwdie-g-v">' + esc(v) + '</div>'; };
    var plant = ov.plant ? (ov.here && ov.here !== ov.plant ? ov.plant + ' (you are on ' + ov.here + ')' : ov.plant) : '—';
    html += '<div class="iwdie-glance">' +
      cell('Panel', ov.panel || '—') +
      cell('Plant', plant) +
      cell('Contents', iwdieCountPhrase(ov.objects, ov.containers, ov.graphics)) +
      cell('Linked', ov.linked + ' linked · ' + ov.unlinked + ' unlinked') +
      cell('Background', ov.background) +
      cell('Made by', ov.generator || '—') + '</div>';
  }

  if (result.errors.length) {
    html += '<div class="iwdie-sec iwdie-sec-bad"><div class="iwdie-sec-h">Errors — fix these first</div>' + iwdieFindingsHtml(result.errors, result.details) + '</div>';
  }
  if (result.verdict === 'refused') html += iwdieDiagnosisHtml(result.diagnosis);
  if (nw) html += '<div class="iwdie-sec iwdie-sec-warn"><div class="iwdie-sec-h">Warnings</div>' + iwdieFindingsHtml(result.warnings, result.details) + '</div>';
  if (notes.length && result.verdict !== 'refused') {
    html += '<div class="iwdie-sec iwdie-sec-info iwdie-notes"><div class="iwdie-sec-h">ℹ Good to know <span class="iwdie-hint">nothing to fix</span></div>' +
      iwdieFindingsHtml(notes, result.details) + '</div>';
  }

  var more = [];
  if (ov) {
    if (ov.sections.length) more.push('Sections: ' + ov.sections.join(' / '));
    if (ov.roles.length) more.push('Roles: ' + ov.roles.join(', '));
    if (ov.units.length) more.push('Units: ' + ov.units.join(', '));
    if (ov.prefixes.length) more.push('Driver ids carry plant prefix ' + ov.prefixes.join(', '));
    if (ov.ducts) more.push(iwdieN(ov.ducts, 'straight duct run', 'straight duct runs') + ' in the artwork');
  } else {
    more = (result.facts || []).slice();
  }
  if (more.length) {
    html += '<details class="iwdie-more"' + (result.verdict === 'refused' ? ' open' : '') + '><summary>File details</summary><ul>' +
      more.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
  }
  return {
    className: 'iwdie-errlist' + (result.verdict === 'warnings' ? ' iwdie-warn' : result.verdict === 'clean' ? ' iwdie-ok' : ''),
    html: html
  };
}

/** The dialog when Insert itself stops (v1.31.0): the check report's red banner
 *  and grouped findings, for a failure found at insert time. opts.title and
 *  opts.sub replace the banner's two lines - for the one failure that comes
 *  after the canvas was touched, "nothing was changed" would be untrue. */
function iwdieBlockedReportHtml(errors, warnings, diagnosis, opts) {
  var esc = iwdieEscHtml;
  opts = opts || {};
  var html = '<div class="iwdie-verdict"><div class="iwdie-v-title">' + esc(opts.title || '⛔ Not inserted') + '</div>' +
    '<div class="iwdie-v-sub">' + esc(opts.sub || 'Nothing on the canvas was changed.') + '</div></div>' +
    '<div class="iwdie-sec iwdie-sec-bad"><div class="iwdie-sec-h">' + ((errors || []).length === 1 ? 'Why' : 'Errors — fix these first') + '</div>' +
    iwdieFindingsHtml(errors || [], null) + '</div>' +
    iwdieDiagnosisHtml(diagnosis);
  if (warnings && warnings.length) {
    html += '<div class="iwdie-sec iwdie-sec-warn"><div class="iwdie-sec-h">Warnings</div>' + iwdieFindingsHtml(warnings, null) + '</div>';
  }
  return { className: 'iwdie-errlist', html: html };
}

/** "128 objects", "12 objects and 1 container", "nothing" - for buttons and toasts. */
function iwdieCountPhrase(objects, containers, graphics) {
  var parts = [];
  if (objects) parts.push(iwdieN(objects, 'object', 'objects'));
  if (containers) parts.push(iwdieN(containers, 'container', 'containers'));
  if (graphics) parts.push(iwdieN(graphics, 'graphic', 'graphics'));
  if (!parts.length) return 'nothing';
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/**
 * The verdict on an insert that has happened (v1.31.0). The colour answers one
 * question - did everything in the file reach the canvas? (v1.31.1):
 *   green  every object and container handed to the designer is on the canvas,
 *          counted afterwards with the serializer Save uses; no graphics were
 *          skipped; the background went on, or you chose to keep yours.
 *   red    anything did not arrive - objects or containers, graphics, the background.
 *   amber  only when the canvas could not be counted, so the answer is unknown.
 * What the check found in the file - warnings, notes, bindings to another plant -
 * is returned as `findings` and listed under the insert's own lines. It never
 * colours the toast: the user saw it before pressing Insert, and it describes the
 * file, not the insert.
 *
 * o = {summary, inserted, expected, found, countFailed, cleared, rebound,
 *      background: applied|kept|failed|none, backgroundError, graphicsSkipped,
 *      graphicsReason: present|failed, foreign, warnings, notes, details, quick}
 * Returns {tone: good|caution|err, title, lines, findings, footer}; tone maps
 * onto the toast's colours.
 */
function iwdieInsertOutcome(o) {
  o = o || {};
  var warnings = o.warnings || [];
  var notes = o.notes || [];
  var details = o.details || {};
  var lead = function (m) { return (details[m] && details[m].lead) || m; };
  var inserted = Number(o.inserted) || 0;
  var counted = !o.countFailed && o.found != null && !isNaN(Number(o.found));
  var found = counted ? Number(o.found) : null;
  var expected = Number(o.expected) || 0;
  var missing = (counted && found < expected) ? Math.min(expected - found, inserted) : 0;
  var foreign = Number(o.foreign) || 0;
  var skipped = Number(o.graphicsSkipped) || 0;

  var lines = [];
  if (o.cleared) lines.push('Replaced the panel: the ' + iwdieN(o.cleared, 'object', 'objects') + ' on it were cleared first.');
  lines.push('From the file: ' + (o.summary || iwdieN(inserted, 'object', 'objects')) + '.');
  if (counted && inserted) {
    lines.push(missing ? missing + ' of the ' + inserted + ' did not appear on the canvas — the designer dropped them.'
      : (inserted === 1 ? 'It is on the canvas.' : 'All ' + inserted + ' are on the canvas.'));
  }
  if (o.countFailed) lines.push('The canvas could not be counted afterwards — look the panel over before you save.');
  if (o.rebound) lines.push(String(o.rebound) + '.');
  if (o.background === 'applied') lines.push('Background applied.');
  else if (o.background === 'kept') lines.push('The panel kept its own background, as you chose.');
  else if (o.background === 'failed') lines.push('The file’s background could not be applied' + (o.backgroundError ? ': ' + o.backgroundError : '') + '.');
  if (skipped) {
    lines.push(iwdieN(skipped, 'graphic was', 'graphics were') + ' skipped — ' +
      (o.graphicsReason === 'failed' ? 'the designer could not load them.' : 'the canvas already has graphics, and the designer replaces rather than merges them.'));
  }
  if (o.quick) lines.push('Inserted without the check — overlaps, objects outside the panel and unknown types were not looked for.');

  var findings = [];
  if (foreign) findings.push('⚠ ' + iwdieN(foreign, 'object still points', 'objects still point') + ' at another plant’s drivers and will not link here');
  warnings.slice(0, 3).forEach(function (w) { findings.push('⚠ ' + lead(w)); });
  if (warnings.length > 3) findings.push('⚠ … and ' + (warnings.length - 3) + ' more');
  notes.forEach(function (n) { findings.push('ℹ ' + lead(n)); });

  var tone, title;
  var nothing = inserted > 0 && missing >= inserted;
  if (nothing || missing || skipped || o.background === 'failed') {
    tone = 'err';
    title = nothing ? '⛔ Nothing from the file appeared on the canvas'
      : missing ? '⛔ Inserted — but ' + iwdieN(missing, 'object', 'objects') + ' did not appear'
      : skipped ? '⛔ Inserted — but ' + iwdieN(skipped, 'graphic was', 'graphics were') + ' skipped'
      : '⛔ Inserted — but the background did not apply';
  } else if (o.countFailed) {
    tone = 'caution';
    title = '⚠ Inserted — but the canvas could not be counted';
  } else {
    tone = 'good';
    title = '✅ Inserted — everything went in';
  }
  return { tone: tone, title: title, lines: lines, findings: findings,
    footer: 'Nothing is saved yet — use the designer’s own Save when you are happy.' };
}

/** The same report as plain text, for pasting back to the AI that wrote the file. */
function iwdieCheckReportText(result, fileName) {
  var L = [];
  var notes = result.notes || [];
  L.push('IWDIE check of ' + (fileName || 'the file') + ': ' +
    (result.verdict === 'refused' ? 'REFUSED — Insert would block this file.' :
     result.verdict === 'warnings' ? 'accepted with ' + result.warnings.length + ' warning(s).' :
     'clean' + (notes.length ? ', with ' + notes.length + ' note(s) for information.' : '.')));
  if (result.facts.length) { L.push(''); L.push('Facts:'); result.facts.forEach(function (x) { L.push('- ' + x); }); }
  if (result.errors.length) { L.push(''); L.push('Errors (fix these first):'); result.errors.forEach(function (x) { L.push('- ' + x); }); }
  var d = result.diagnosis;
  if (d && d.headline) { L.push(''); L.push('Diagnosis: ' + d.headline); (d.facts || []).forEach(function (x) { L.push('- ' + x); }); }
  if (result.warnings.length) { L.push(''); L.push('Warnings:'); result.warnings.forEach(function (x) { L.push('- ' + x); }); }
  if (notes.length) { L.push(''); L.push('Notes (for information - nothing to fix):'); notes.forEach(function (x) { L.push('- ' + x); }); }
  L.push('');
  L.push('Return the complete corrected .json file; keep every object you were not asked to change byte for byte.');
  return L.join('\n');
}

/**
 * A complete, correct Ventilasjon seed: eleven unlinked objects on a two-run
 * drawing, every position from layout, every id from the catalogue. Grow it;
 * do not start from an empty array.
 */
function iwdieExampleStarterVentilation() {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 750">'
    + '<rect x="1145" y="0" width="255" height="750" fill="#CDD2D7" opacity="0.5"/>'
    + '<rect x="1000" y="240" width="140" height="300" rx="16" fill="#CDD2D7" stroke="#FFFFFF" stroke-width="5"/>'
    + '<g fill="none" stroke="#FFFFFF" stroke-width="16" stroke-linecap="round"><path d="M58 238 H1000"/><path d="M58 428 H300"/><path d="M360 428 H1000"/></g>'
    + '<g fill="none" stroke-width="2" stroke-linecap="round"><path d="M58 238 H1000" stroke="#F3C96A"/><path d="M58 428 H300" stroke="#B0E0EF"/><path d="M360 428 H1000" stroke="#F79E7A"/></g>'
    + '<rect x="298" y="197" width="64" height="320" rx="32" fill="#CED1D2" stroke="#A6A6A9" stroke-width="1.5"/>'
    + '<rect x="306" y="205" width="48" height="304" rx="24" fill="none" stroke="#FFFFFF" stroke-width="3"/>'
    + '</svg>';
  var n = 0;
  var obj = function (objId, w, h, x, y, z, tag, alias) {
    return { obj_id: objId, name: 'object_' + (n++), id: 'driver_id', posWidth: w, posHeight: h, posLeft: x, posTop: y,
      zIndex: z, tag_text: tag, linked: 'false', link_name: '', link_tag: '', sub_group: '',
      driver_id: 'driver_id', unit_id: '', unit_ref: '', alias_text: alias };
  };
  var objects = [
    obj('number_v3_label_12px_bold', 50, 20, 430, 10, '1100', 'VENTILASJON 360.001 - <PLANT>', ''),
    obj('V3_R_34px_circular_alarm_nrm', 34, 34, 384, 8, '375', '', 'Communication error'),
    obj('V3_58px_fan_left_nrm', 59, 59, 186, 209, '40', 'JV50', 'JV50 Start avtrekksvifte'),
    obj('number_v3_R_45px_con_top', 46, 38, 192, 266, '110', 'Padrag %', 'LR50 Padrag avtrekksvifte'),
    obj('V3_R_34px_circular_alarm_nrm', 34, 34, 250, 208, '375', '', 'JV50 Feil avtrekksvifte'),
    obj('number_v3_R_45px_con_down', 46, 38, 120, 363, '110', 'RT40 °C', 'RT40 Temperatur inntak'),
    obj('V3_58px_fan_right_nrm', 59, 59, 380, 399, '40', 'JV40', 'JV40 Start tilluftsvifte'),
    obj('number_v3_label_10px_bold', 50, 20, 1008, 246, '1100', 'Butikk', ''),
    obj('number_v3_R_40px_no_conn_tag_up_left', 42, 22, 1076, 296, '110', 'RT-60', 'RT60 Temperatur butikk'),
    obj('number_v3_header_grey75', 250, 20, 1150, 20, '5', 'Butikk settpunkt', ''),
    obj('number_v3_60px_dark_no_conn_no_tag', 62, 22, 1175, 52, '110', ' ', 'Settpunkt romtemperatur butikk'),
    obj('number_v3_label_10px_bold', 50, 20, 1245, 54, '1100', 'Settpunkt butikk °C', '')
  ];
  return {
    format: IWDIE_FORMAT, version: IWDIE_FORMAT_VERSION, generator: '<your agent name>',
    source_plant_id: '', panel_name: '360.001 Ventilasjon', panel_width: '1400px', panel_height: '750px',
    counts: { single_objects: objects.length, containers: 0, graphics: 0 },
    background_embedded: true,
    panel: { plant_id: '', panel_name: '360.001 Ventilasjon', panel_width: '1400px', panel_height: '750px',
      org_image_name: '', image_name: '', saved_by: '<your agent name>', image_svg: svg,
      single_objects: objects, containers: [], graphics: [] }
  };
}

/**
 * Which object a parameter row wants. Cross-tabulated over 202 linked objects
 * in two production Ventilasjon panels: dark boxes carried setpoints 17 times
 * of 22, con_down carried duct temperatures 12 of 16, the alarm bell carried a
 * fault 12 of 16, and fans and pumps carried start/drift every time. Keyed on
 * the parameter export's own columns so an agent can decide mechanically.
 */
var IWDIE_SIGNAL_TO_OBJECT = {
  how_to_use: 'Read the parameter row first - Application, Access, Type and Eng unit decide the object. The description only decides where it goes.',
  rules: [
    'Analog values + Read + a unit, a sensor on a duct -> number_v3_R_45px_con_down above the duct or number_v3_R_45px_con_top below it, with the connector pointing at the duct.',
    'Analog values + Read/write, a value the operator sets -> number_v3_60px_dark_no_conn_no_tag in the settings column, with a number_v3_label_10px_bold caption beside it.',
    'Analog values + Read, a motor output in % -> number_v3_R_45px_con_top under the fan, coil or valve it drives.',
    'Analog values + Read, an air flow -> number_v3_R_60px_no_conn_tag_up_center above the fan.',
    'Analog values + Read, a room temperature -> number_v3_R_40px_no_conn_tag_up_left inside the zone box, one column per zone.',
    'Analog values + Read, a calculated reference the operator only watches -> number_v3_40px_dark_con_down on the duct it belongs to.',
    'Digital IO + Read, the description says feil, alarm, utlost, vakt, frost or brann -> V3_R_34px_circular_alarm_nrm beside the component it names.',
    'Digital IO + Read, smoke or fire -> V3_led_18px_circ_grey_red; a plant-wide A- or B-alarm -> V3_led_16px_circ_grey_red or _grey_yellow in the settings column.',
    'Digital IO, start or drift of a fan or a pump -> link the equipment object itself (V3_58px_fan_left_nrm, V3_21px_single_pump_grey_green_up). Do not add a separate LED next to it.',
    'Digital IO, a damper or a valve -> link the damper or valve object.',
    'Integral values, or any value with a state list (systemvender, driftsmodus, valg) -> number_v3_60px_json_obj or number_v3_custom_json_obj.',
    'Application Alarm (COM_ERR, COM_STAT) -> one V3_R_34px_circular_alarm_nrm near the panel title.',
    'A reading with no unit and no state list is usually a constant or a tuning value: leave it off the panel rather than giving it a box.'
  ]
};

/**
 * Where things go. Numbers measured on a production Ventilasjon panel, because
 * "copy a real export" is no help to an agent that was given none.
 */
var IWDIE_LAYOUT = {
  canvas: '1400 x 750. The drawing lives left of x 1145; the settings column owns x 1145-1400 and nothing from the drawing crosses into it.',
  settings_column: 'Header bar at x 1150, 250 wide, 20 high. Value boxes at x 1175, captions at x 1245. Rows 25-30 apart, sections separated by a header bar. A section is a heading plus three to five rows.',
  ventilation_anatomy: 'Extract run across the top flowing right to left, supply run below it flowing left to right, rotary exchanger across both, zone boxes at the right end of the runs, special extracts on a branch above the extract run, coil branches dropping off the supply run towards their zone.',
  attach: 'Measured: a con_down value sits about 30 px above the duct centre line, a con_top value about 28 px below it, a flow box about 67 px above, an alarm bell within 40 px of the component it names, and a pump within 40 px of its coil.',
  reading_order: 'Along the air path, not alphabetically: intake, damper, filter, exchanger, fan, coils, duct sensor, zone.'
};

/**
 * Which parameters belong on a panel at all. A plant list is 200-800 rows; a
 * panel is 80-120 objects, and picking is most of the work.
 */
var IWDIE_PARAMETER_SELECTION = {
  belongs: 'Every sensor on the flow path, every motor with its status and its output, every alarm the plant can raise, the zone temperatures, and the handful of setpoints an operator actually changes.',
  stays_off: 'Manual-override enables and their values, controller tuning (P-band, I-time, sequence breakpoints), commissioning constants (K-factors, signal min and max), and any reading already shown elsewhere on the panel.',
  scale: 'Roughly a third of a plant list reaches the panel. If every row has a box, the selection was never made - say so rather than shipping it.',
  say_what_you_left_out: 'Name the groups you left off in your answer, not in the file. The next person needs to know it was a decision.'
};

/** Assertions an agent can run over its own file before returning it. */
var IWDIE_SELF_CHECK = [
  'counts.single_objects, .containers and .graphics equal the array lengths.',
  'Every object has all 17 fields of schema.object_entry, obj_id is in object_catalogue, and posLeft, posTop, posWidth and posHeight are integers.',
  'Every object lies inside the canvas: posLeft + posWidth <= panel_width and posTop + posHeight <= panel_height.',
  'No two value, setpoint, LED or bell objects overlap. A label may sit beside one, never on it.',
  'Nothing except the settings column reaches past x 1145.',
  'Every linked object carries a driver_id and a unit_id copied from one parameter row; every unlinked one carries driver_id "driver_id" and linked "false".',
  'No two objects carry the same alias_text unless the same signal is deliberately shown twice - then say which, and why.',
  'zIndex is a string of digits from the bands in z_index, not "default", on a panel whose other objects carry numbers.'
];

/** What goes wrong, from panels that had to be rebuilt. */
var IWDIE_COMMON_MISTAKES = [
  'Drawing ducts as flat coloured bars. A duct is a white casing with a thin coloured core (drawing_style); flat bars are the visible tell that a panel was authored blind.',
  'Letting the drawing run under the settings column, or a zone box past x 1145.',
  'Captions colliding: two value boxes 40 px apart print their captions on top of each other. Leave 60 px between boxes that carry a caption.',
  'An alarm bell parked in open space instead of beside its component - the operator cannot tell what it belongs to.',
  'A value box for a signal that has no parameter row. If nothing can be linked to it, it shows nothing: leave it out and say so.',
  'Placing objects against a background that is about to be replaced. If the artwork moves, everything standing on it moves too.',
  'Copying a driver_id or unit_id from another plant because the suffix looked familiar. Only a row in this plant parameter source proves a binding.'
];

var IWDIE_DRAWING_STYLE = {
  canvas: '1400 x 750. Leave x 1145-1400 for the settings column, and keep the drawing left of it.',
  duct: 'Not a solid bar: a WHITE casing 16 wide with round caps, and a 2 wide coloured core on the same centre line. Draw both from one path so they stay together.',
  duct_colours: { avtrekk: '#F3C96A', tilluft: '#F79E7A', uteluft: '#B0E0EF' },
  zone_box: 'Rounded rectangle, fill #CDD2D7, white border 5 wide, rx 16. One per zone at the end of the runs.',
  exchanger: 'Rounded pill, fill #CED1D2 with a #A6A6A9 hairline, a white inner pill 3 wide inset 8, and a grey triangle at each end. Place it across both runs.',
  settings_band: '#CDD2D7 at about half opacity behind the settings column.',
  in_the_artwork: 'Ducts, exchanger, zone boxes, flow arrows, enclosures.',
  stays_objects: 'Fans, filters, dampers, coils, pumps, valves, values, setpoints, LEDs, alarm bells and every label — only an object can show a signal or be linked.',
  never: 'No fake numbers, no drawn bells or LEDs, no text where a label object belongs, no dark fills.',
  how_common: 'Surveyed over 20 MENY plants: a background picture is on 82% of Oversikt panels, 63% of Energi, 50% of Ventilasjon and 20% of Maskin. Check what this plant has before deciding to draw one.'
};

/** Wrap an error list with a diagnosis and a paste-back prompt for the AI. */
function iwdieReject(parsed, errors) {
  return { errors: errors, diagnosis: iwdieDiagnosePayload(parsed, errors) };
}

/**
 * Did an AI improvise a document instead of producing an export? The tell is a
 * self-describing format name plus prose/provenance keys the importer never
 * reads. Only consulted on payloads that already failed the format check.
 */
function iwdieLooksImprovised(parsed) {
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  var fmt = String(parsed.format || '').toLowerCase();
  if (/spec|demo|draft|example|proposal|mock|sample|template|概/.test(fmt)) return true;
  var keys = Object.keys(parsed).join(' ').toLowerCase();
  return /source_note|source_document|disclaimer|assumption|limitation|caveat|explanation/.test(keys);
}

/** Structured "what is this file, actually" report. Pure — no DOM. */
function iwdieDiagnosePayload(parsed, errors) {
  var facts = [];
  var isObj = parsed != null && typeof parsed === 'object' && !Array.isArray(parsed);
  var keys = isObj ? Object.keys(parsed) : [];
  if (isObj) {
    facts.push('format: ' + (parsed.format == null ? '(missing)' : JSON.stringify(parsed.format)));
    facts.push('top-level keys: ' + (keys.length ? keys.join(', ') : '(none)'));
    var panel = (parsed.panel && typeof parsed.panel === 'object') ? parsed.panel : null;
    var so = Array.isArray(parsed.single_objects) ? parsed.single_objects
      : (panel && Array.isArray(panel.single_objects) ? panel.single_objects : null);
    facts.push('single_objects[]: ' + (so ? so.length + ' objects' : 'not found'));
    if (!panel && parsed.format === IWDIE_FORMAT) facts.push('panel: missing');
  } else if (Array.isArray(parsed)) {
    facts.push('top level is an array of ' + parsed.length + ' item(s)');
  } else {
    facts.push('top level is ' + (parsed === null ? 'null' : typeof parsed));
  }
  var improvised = iwdieLooksImprovised(parsed);
  return {
    improvised: improvised,
    facts: facts,
    headline: improvised
      ? 'This looks like a document the AI wrote *about* a panel, not a panel file. The importer reads structure only — it never reads notes, summaries or descriptions.'
      : 'The file did not match the import contract.',
    aiPrompt: iwdieBuildAiFixPrompt(parsed, errors, facts, improvised)
  };
}

/**
 * Text that would not even parse. The dominant cause with a chat-window AI is
 * truncation — the answer was cut off mid-array — and the second is markdown
 * fencing or prose wrapped around the JSON. Both are worth naming, because
 * "Unexpected end of JSON input" tells the user nothing actionable.
 */
function iwdieDiagnoseBadJson(text, message) {
  var s = String(text == null ? '' : text);
  var trimmed = s.trim();
  var errors = ['Not valid JSON: ' + message];
  var facts = ['length: ' + s.length + ' characters'];
  var first = trimmed.slice(0, 1);
  var last = trimmed.slice(-1);
  facts.push('starts with: ' + (first ? JSON.stringify(first) : '(empty)'));
  facts.push('ends with: ' + (last ? JSON.stringify(last) : '(empty)'));

  var depth = 0, inStr = false, escNext = false, minDepth = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (escNext) { escNext = false; continue; }
    if (inStr) {
      if (ch === '\\') escNext = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth < minDepth) minDepth = depth; }
  }
  var fenced = /^```/.test(trimmed) || /```\s*$/.test(trimmed);
  var truncated = depth > 0 || inStr;
  if (fenced) {
    errors.push('The text is wrapped in a markdown code fence (```). Paste the JSON only — the fence is not part of the file.');
  }
  if (truncated) {
    errors.push('The JSON is incomplete: ' + (inStr ? 'it stops in the middle of a string' : depth + ' bracket(s) never close') +
      '. The answer was cut off before it finished — this is the usual outcome when a chat assistant is asked for a long panel inline.');
    facts.push('unclosed brackets at end of text: ' + depth);
  }
  if (!fenced && !truncated && first && first !== '{' && first !== '[') {
    errors.push('The text starts with prose, not with "{". Anything before the opening brace has to go.');
  }

  var L = [];
  L.push('The JSON you produced could not be parsed by the IWMAC Designer Import/Export userscript (v' + IWDIE_VERSION + '). Nothing was imported.');
  L.push('');
  L.push('PARSER ERROR');
  L.push('- ' + message);
  L.push('');
  L.push('WHAT ARRIVED');
  facts.forEach(function (f) { L.push('- ' + f); });
  L.push('');
  L.push('WHAT TO DO');
  if (truncated) {
    L.push('- Your answer was cut off before the JSON closed. Do not paste panel JSON into the chat window.');
    L.push('- Attach it as a downloadable .json file instead, or reduce the object count until the whole file fits, and verify the last character you emit is "}".');
    L.push('- Never end a file mid-array and never add "... (truncated)", "// rest omitted" or any similar placeholder. A partial file cannot be imported.');
  }
  if (fenced) {
    L.push('- Emit the raw JSON with no markdown code fence around it.');
  }
  L.push('- No commentary before or after the JSON. The first character must be "{" and the last must be "}".');
  L.push('- No comments (// or /* */), no trailing commas, no single quotes — strict JSON only.');
  L.push('- Re-read your own output and confirm it parses before answering.');
  L.push('');
  L.push('Return the complete corrected JSON file and nothing else.');

  return {
    errors: errors,
    diagnosis: {
      improvised: false,
      facts: facts,
      headline: truncated ? 'The file is incomplete — it was cut off before the JSON finished.'
        : 'The text is not parseable JSON.',
      aiPrompt: L.join('\n')
    }
  };
}

/**
 * A correction message the user can paste straight back to the AI that produced
 * the file. States what arrived, why it was refused, and the exact shape wanted.
 */
function iwdieBuildAiFixPrompt(parsed, errors, facts, improvised) {
  var L = [];
  L.push('The JSON you produced was REJECTED by the IWMAC Designer Import/Export userscript (v' + IWDIE_VERSION + '). Nothing was imported. Read this, then return the corrected file.');
  L.push('');
  L.push('WHAT ARRIVED');
  (facts || []).forEach(function (f) { L.push('- ' + f); });
  L.push('');
  L.push('WHY IT WAS REFUSED');
  (errors || []).forEach(function (e) { L.push('- ' + e); });
  L.push('');
  L.push('DO NOT');
  L.push('- Do not invent a format name, a schema, or a wrapper of your own. "' + IWDIE_FORMAT + '" is the only accepted value.');
  L.push('- Do not answer with a description, a specification, a plan or a summary of a panel. The only valid answer is the panel file itself.');
  L.push('- Do not invent obj_id, driver_id, unit_id or navigation target ids. An invented id looks linked and is not.');
  if (improvised) {
    L.push('- If you could not open your knowledge files (AI-BRIEFING.txt, DESIGN-OBJECT-CATALOG.md, VENTILATION-GEOMETRY-CONTRACT.md), SAY SO AND STOP. Do not substitute a document you wrote yourself. An unreadable knowledge file is the actual problem and has to be reported, not worked around — a made-up file cannot be imported and wastes the attempt.');
  }
  L.push('');
  L.push('REQUIRED SHAPE — return exactly this, with nothing before or after it');
  L.push('{');
  L.push('  "format": "' + IWDIE_FORMAT + '",');
  L.push('  "version": ' + IWDIE_FORMAT_VERSION + ',');
  L.push('  "generator": "<your name>",');
  L.push('  "source_plant_id": "",');
  L.push('  "panel_name": "<panel name>",');
  L.push('  "panel_width": "1400px",');
  L.push('  "panel_height": "750px",');
  L.push('  "counts": { "single_objects": <n>, "containers": 0, "graphics": 0 },');
  L.push('  "background_embedded": false,');
  L.push('  "panel": {');
  L.push('    "plant_id": "",');
  L.push('    "panel_name": "<panel name>",');
  L.push('    "panel_width": "1400px",');
  L.push('    "panel_height": "750px",');
  L.push('    "org_image_name": "",');
  L.push('    "image_name": "",');
  L.push('    "saved_by": "copilot",');
  L.push('    "single_objects": [ ... ],');
  L.push('    "containers": [],');
  L.push('    "graphics": []');
  L.push('  }');
  L.push('}');
  L.push('');
  L.push('EVERY ENTRY IN single_objects[] — all ' + IWDIE_OBJECT_FIELDS.length + ' fields, every time:');
  L.push('  ' + IWDIE_OBJECT_FIELDS.join(', '));
  L.push('');
  L.push('{ "obj_id": "<exact id from DESIGN-OBJECT-CATALOG.md>", "name": "object_0", "id": "driver_id",');
  L.push('  "posWidth": 80, "posHeight": 24, "posLeft": 120, "posTop": 300, "zIndex": "default",');
  L.push('  "tag_text": "<text shown on the panel>", "linked": "false", "link_name": "", "link_tag": "",');
  L.push('  "sub_group": "", "driver_id": "driver_id", "unit_id": "", "unit_ref": "",');
  L.push('  "alias_text": "<what the signal is>" }');
  L.push('');
  L.push('RULES THAT GET A FILE REJECTED OR SILENTLY BROKEN');
  L.push('- obj_id must be an id that exists in the palette catalogue. An object with no obj_id cannot be drawn at all.');
  L.push('- posLeft / posTop / posWidth / posHeight are integer pixels. Emit them as numbers. A missing value, or text that does not start with a digit ("center", "auto"), silently lands the object at 0,0 in the top-left corner. A string like "120px" or "50%" is read as its leading number — 120 and 50 — which is almost never the position you meant.');
  L.push('- "name" is "object_0", "object_1", ... sequential, no gaps, no duplicates.');
  L.push('- For an unlinked panel: "id" and "driver_id" are the literal string "driver_id", "linked" is the string "false", and link_name / link_tag / sub_group / unit_id / unit_ref are empty strings.');
  L.push('- "counts" must equal the real array lengths.');
  L.push('- The canvas is 1400 x 750. Objects outside it are not visible.');
  L.push('- Every file the userscript exports carries an "ai_guide" with the complete field-by-field contract, the linking rules and worked examples — read it and follow it. You may keep or omit "ai_guide" and "summary" in your answer; never edit them.');
  L.push('- A panel sits on a drawing: copy the plant\'s own background when it has one, else author it in "image_svg" to the construction in ai_guide.drawing_style. Ducts, exchanger and zone boxes go in the artwork; fans, filters, dampers, coils, pumps, values and alarms stay objects.');
  L.push('');
  L.push('Return the corrected JSON file and nothing else.');
  return L.join('\n');
}

/** Structural validation. Returns {errors:[], warnings:[]} — empty errors = importable.
 *
 *  opts.allowEmpty (v1.10.0) waives the "document is empty" rejection: the
 *  background-only import reads nothing but the artwork, so a file with no
 *  objects at all is a legitimate input there. Every other rule still applies —
 *  objects that *are* present are validated the same way, because a background-
 *  only import can be run against a full export too. */
function iwdieValidateDoc(doc, opts) {
  var errors = [];
  var warnings = [];
  var allowEmpty = !!(opts && opts.allowEmpty);
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { errors: ['Panel document is not an object.'], warnings: warnings };
  }
  var so = doc.single_objects;
  var co = doc.containers;
  var gr = doc.graphics;
  if (so != null && !Array.isArray(so)) errors.push('"single_objects" must be an array.');
  if (co != null && !Array.isArray(co)) errors.push('"containers" must be an array.');
  if (gr != null && !Array.isArray(gr)) errors.push('"graphics" must be an array.');
  var nObj = Array.isArray(so) ? so.length : 0;
  var nCon = Array.isArray(co) ? co.length : 0;
  var nGra = Array.isArray(gr) ? gr.length : 0;
  if (nObj + nCon + nGra === 0 && !allowEmpty) errors.push('Panel document is empty — no single_objects, containers or graphics.');
  if (Array.isArray(so)) {
    for (var i = 0; i < so.length; i++) {
      var o = so[i];
      if (o == null || typeof o !== 'object') { errors.push('single_objects[' + i + '] is not an object.'); continue; }
      if (!o.obj_id || typeof o.obj_id !== 'string') {
        errors.push('single_objects[' + i + '] has no "obj_id" (the palette object type) — the designer cannot draw it.');
      }
      ['posLeft', 'posTop', 'posWidth', 'posHeight'].forEach(function (k) {
        if (o[k] == null || isNaN(parseInt(o[k], 10))) {
          warnings.push('single_objects[' + i + '].' + k + ' is missing/non-numeric — it will land at 0.');
        }
      });
    }
  }
  if (Array.isArray(co)) {
    for (var j = 0; j < co.length; j++) {
      var c = co[j];
      if (c == null || typeof c !== 'object') { errors.push('containers[' + j + '] is not an object.'); }
    }
  }
  if (!doc.panel_width || !doc.panel_height) warnings.push('No panel_width/panel_height — panel size will not be applied.');
  return { errors: errors, warnings: warnings };
}

/**
 * The envelope's counts against the arrays the importer will actually use.
 * A mismatch is the commonest bookkeeping slip in an AI-edited file — an
 * object added, counts left alone — and it never blocks an import, because the
 * arrays are what gets drawn; it is reported so the file can be fixed.
 * Returns warning strings; empty when there is nothing to say.
 */
function iwdieCheckEnvelopeCounts(meta, doc) {
  var warnings = [];
  if (!meta || meta.counts == null || typeof meta.counts !== 'object' || !doc) return warnings;
  ['single_objects', 'containers', 'graphics'].forEach(function (key) {
    var declared = meta.counts[key];
    if (declared == null) return;
    var actual = Array.isArray(doc[key]) ? doc[key].length : 0;
    if (Number(declared) !== actual) {
      warnings.push('counts.' + key + ' says ' + declared + ' but panel.' + key + ' holds ' + actual +
        ' — the array was used; set counts to the real lengths.');
    }
  });
  return warnings;
}

/**
 * The envelope was accepted but the panel document itself is broken. Report the
 * shape that arrived so the AI can see which of its objects are at fault.
 */
function iwdieDiagnoseDoc(doc, errors, warnings) {
  var facts = [];
  var so = (doc && Array.isArray(doc.single_objects)) ? doc.single_objects : [];
  facts.push('single_objects[]: ' + so.length + ' objects');
  facts.push('containers[]: ' + ((doc && Array.isArray(doc.containers)) ? doc.containers.length : 0) +
    ', graphics[]: ' + ((doc && Array.isArray(doc.graphics)) ? doc.graphics.length : 0));
  facts.push('panel size: ' + ((doc && doc.panel_width) || '(missing)') + ' x ' + ((doc && doc.panel_height) || '(missing)'));
  var noId = [];
  var badPos = [];
  for (var i = 0; i < so.length; i++) {
    var o = so[i];
    if (o == null || typeof o !== 'object') continue;
    if (!o.obj_id || typeof o.obj_id !== 'string') noId.push(i);
    for (var k = 0; k < 4; k++) {
      var key = ['posLeft', 'posTop', 'posWidth', 'posHeight'][k];
      if (o[key] == null || isNaN(parseInt(o[key], 10))) { badPos.push(i + '.' + key); break; }
    }
  }
  if (noId.length) facts.push('objects with no obj_id: ' + noId.slice(0, 12).join(', ') + (noId.length > 12 ? ' …(' + noId.length + ' total)' : ''));
  if (badPos.length) facts.push('objects with bad geometry: ' + badPos.slice(0, 12).join(', ') + (badPos.length > 12 ? ' …(' + badPos.length + ' total)' : ''));
  return {
    improvised: false,
    facts: facts,
    headline: 'The wrapper was accepted — the panel document inside it is what failed.',
    aiPrompt: iwdieBuildAiFixPrompt(doc, (errors || []).concat(warnings || []), facts, false)
  };
}

/** Deep copy + fill defaults so the host loaders never see undefined. */
function iwdieNormalizeDoc(doc) {
  var d = JSON.parse(JSON.stringify(doc));
  if (!Array.isArray(d.single_objects)) d.single_objects = [];
  if (!Array.isArray(d.containers)) d.containers = [];
  if (!Array.isArray(d.graphics)) d.graphics = [];
  d.single_objects.forEach(function (o) {
    // load_new_ver_objects reads these unconditionally (V3scripts.js:486-503)
    if (o.tag_text == null) o.tag_text = '';
    if (o.link_name == null) o.link_name = '';
    if (o.link_tag == null) o.link_tag = '';
    if (o.sub_group == null) o.sub_group = '';
    if (o.driver_id == null) o.driver_id = 'driver_id';
    if (o.unit_id == null) o.unit_id = '';
    if (o.unit_ref == null) o.unit_ref = '';
    if (o.alias_text == null) o.alias_text = '';
    if (o.zIndex == null) o.zIndex = 'default';
    ['posLeft', 'posTop', 'posWidth', 'posHeight'].forEach(function (k) {
      o[k] = parseInt(o[k], 10) || 0;
    });
  });
  d.containers.forEach(function (c) {
    if (c == null || typeof c !== 'object') return;
    // load_new_ver_containers routes on unique_id: only containers whose
    // unique_id contains "custom_" are instantiated (the template branch is an
    // empty stub, V3scripts.js:684) — and the host renames name/unique_id from
    // its own counter anyway, so forcing the routing marker is lossless.
    if (typeof c.unique_id !== 'string' || c.unique_id.indexOf('custom_') === -1) {
      c.unique_id = 'custom_import';
    }
    if (!Array.isArray(c.items)) c.items = [];
  });
  return d;
}

/**
 * Source plant detection: doc.plant_id first, else the majority
 * <digits>_ prefix across driver_ids (they are plant-prefixed:
 * "10113_AK3_AKC_0_11_1_0_7").
 */
function iwdieDetectSourcePlant(doc) {
  if (doc && doc.plant_id != null && String(doc.plant_id).match(/^\d+$/)) return String(doc.plant_id);
  var counts = {};
  var best = null;
  iwdieEachDriverId(doc, function (id) {
    var m = /^(\d+)_/.exec(id);
    if (!m) return;
    counts[m[1]] = (counts[m[1]] || 0) + 1;
    if (best === null || counts[m[1]] > counts[best]) best = m[1];
  });
  return best;
}

/** Walk every driver_id in the document (single objects + container items). */
function iwdieEachDriverId(doc, fn) {
  function scan(list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (o) {
      if (o == null || typeof o !== 'object') return;
      if (typeof o.driver_id === 'string' && o.driver_id && o.driver_id !== 'driver_id') fn(o.driver_id, o);
      // containers carry their child objects in nested arrays; scan every array prop
      Object.keys(o).forEach(function (k) {
        if (Array.isArray(o[k])) scan(o[k]);
      });
    });
  }
  if (doc) { scan(doc.single_objects); scan(doc.containers); }
}

function iwdieCountRebindable(doc, fromPlant) {
  var n = 0;
  var prefix = fromPlant + '_';
  iwdieEachDriverId(doc, function (id) { if (id.indexOf(prefix) === 0) n++; });
  return n;
}

/** Rewrite "<from>_..." driver_id prefixes to "<to>_...". Returns {doc, rebound, skippedForeign}. */
function iwdieRebindDriverIds(doc, fromPlant, toPlant) {
  var d = JSON.parse(JSON.stringify(doc));
  var rebound = 0;
  var skippedForeign = 0;
  var prefix = fromPlant + '_';
  iwdieEachDriverId(d, function (id, obj) {
    if (id.indexOf(prefix) === 0) {
      obj.driver_id = toPlant + '_' + id.slice(prefix.length);
      rebound++;
    } else if (/^\d+_/.test(id) && id.indexOf(toPlant + '_') !== 0) {
      skippedForeign++;
    }
  });
  d.plant_id = String(toPlant);
  return { doc: d, rebound: rebound, skippedForeign: skippedForeign };
}

/** Driver ids that belong to neither source nor target plant (silently dead after import). */
function iwdieListForeignDriverIds(doc, plantId) {
  var foreign = [];
  iwdieEachDriverId(doc, function (id, obj) {
    var m = /^(\d+)_/.exec(id);
    if (m && m[1] !== String(plantId)) {
      foreign.push({ driver_id: id, alias_text: obj.alias_text || '' });
    }
  });
  return foreign;
}

function iwdieSummarize(doc) {
  return (doc.single_objects || []).length + ' objects, ' +
    (doc.containers || []).length + ' containers, ' +
    (doc.graphics || []).length + ' graphics';
}

function iwdieSanitizeName(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'panel';
}

function iwdieBuildExportFilename(plantId, panelName, now) {
  var d = now || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  var stamp = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  return 'iwmac-panel_' + (plantId || 'plant') + '_' + iwdieSanitizeName(panelName) + '_' + stamp + '.json';
}

/**
 * Raw SVG markup -> a data: URL the designer accepts as a background
 * (verified live: CSS background + Image() both load it at full size).
 * This is what lets an AI *author* the artwork — SVG is just text, so no
 * base64 step is required of the model.
 */
function iwdieSvgToDataUrl(svg) {
  var s = String(svg == null ? '' : svg).trim();
  if (s.indexOf('<svg') !== 0) return null;
  var b64;
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    b64 = Buffer.from(s, 'utf8').toString('base64');
  } else if (typeof btoa === 'function') {
    b64 = btoa(unescape(encodeURIComponent(s)));
  } else {
    return null;
  }
  return 'data:image/svg+xml;base64,' + b64;
}

/** Structural sanity for AI-authored background SVG. */
function iwdieValidateSvg(svg) {
  var errors = [];
  var s = String(svg == null ? '' : svg).trim();
  if (s.indexOf('<svg') !== 0) { errors.push('"image_svg" must start with <svg.'); return errors; }
  if (s.indexOf('</svg>') < 0) errors.push('"image_svg" has no closing </svg> tag.');
  if (!/viewBox\s*=/.test(s) && !(/width\s*=/.test(s) && /height\s*=/.test(s))) {
    errors.push('"image_svg" needs a viewBox (or width+height) so it scales to the panel.');
  }
  if (/<script/i.test(s)) errors.push('"image_svg" must not contain <script>.');
  return errors;
}

/** Does this document carry artwork of its own — embedded raster or authored
 *  SVG? The background-only import is exactly the case where that is the whole
 *  payload, so the question is asked before the objects are looked at. */
function iwdieDocHasBackground(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.converted === 'true' && doc.image_data) return true;
  return typeof doc.image_svg === 'string' && doc.image_svg.length > 0;
}

/** Attach a background image (data: URL) to a panel document the host-native
 *  way — renderPanel/iw_set_base_image consume converted:"true" + image_data. */
function iwdieAttachBackground(doc, dataUrl, fileName) {
  var d = JSON.parse(JSON.stringify(doc));
  d.converted = 'true';
  d.image_data = String(dataUrl);
  if (fileName && !d.org_image_name) d.org_image_name = String(fileName);
  return d;
}

/* ---- background → Illustrator export helpers (v1.3.0) ----
   Modern .ai files are PDF-based and Illustrator opens any PDF as editable
   artwork on an artboard, so a hand-built single-page PDF named .ai is the
   dependency-free way to hand a raster background to Illustrator. SVG
   backgrounds are already vector — Illustrator opens .svg natively, and
   rasterizing them into a PDF would destroy the very thing worth editing,
   so those are exported as .svg instead. */

/** data: URL -> { mime, bytes(Uint8Array) }. Handles base64 and URL-encoded. */
function iwdieParseDataUrl(dataUrl) {
  var m = /^data:([^;,]*)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl == null ? '' : dataUrl));
  if (!m) return null;
  var bin, i;
  if (m[2]) {
    if (typeof atob === 'function') bin = atob(m[3]);
    else if (typeof Buffer !== 'undefined') bin = Buffer.from(m[3], 'base64').toString('binary');
    else return null;
  } else {
    try { bin = decodeURIComponent(m[3]); } catch (e) { bin = m[3]; }
  }
  var bytes = new Uint8Array(bin.length);
  for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return { mime: m[1] || 'application/octet-stream', bytes: bytes };
}

/** Is this background URL / mime an SVG? */
function iwdieIsSvgBackground(mimeOrUrl) {
  var s = String(mimeOrUrl == null ? '' : mimeOrUrl).toLowerCase();
  return s.indexOf('image/svg') !== -1 || /\.svg(\?|#|$)/.test(s);
}

/**
 * File extension for saving a background verbatim. The point of a verbatim
 * save is that nothing is re-encoded, so the name has to follow whatever the
 * bytes already are — a data: URL's mime, or the path's own suffix.
 */
function iwdieBackgroundExt(mimeOrUrl) {
  var s = String(mimeOrUrl == null ? '' : mimeOrUrl).toLowerCase();
  if (iwdieIsSvgBackground(s)) return 'svg';
  if (s.indexOf('image/jpeg') !== -1 || s.indexOf('image/jpg') !== -1 || /\.jpe?g(\?|#|$)/.test(s)) return 'jpg';
  if (s.indexOf('image/gif') !== -1 || /\.gif(\?|#|$)/.test(s)) return 'gif';
  if (s.indexOf('image/webp') !== -1 || /\.webp(\?|#|$)/.test(s)) return 'webp';
  return 'png';
}

/** The mime that goes with iwdieBackgroundExt(), for the rare fetch that
 *  answers without a Content-Type. */
function iwdieBackgroundMime(ext) {
  var e = String(ext == null ? '' : ext).toLowerCase();
  if (e === 'svg') return 'image/svg+xml';
  if (e === 'jpg') return 'image/jpeg';
  return 'image/' + (e || 'png');
}

/** CSS color string → [r,g,b]. Unknown / empty → white. */
function iwdieParseCssColor(s) {
  s = String(s == null ? '' : s).trim();
  var m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    var h = m[1];
    return [parseInt(h.charAt(0) + h.charAt(0), 16), parseInt(h.charAt(1) + h.charAt(1), 16), parseInt(h.charAt(2) + h.charAt(2), 16)];
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  return [255, 255, 255];
}

function iwdieImageHasTransparency(rgba) {
  if (!rgba || !rgba.length) return false;
  var i;
  for (i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}

/**
 * Src-over flatten onto an opaque fill. Output alpha is 255.
 *
 * Panel backgrounds are hard-edged: on a measured Oversikt/Maskin drawing 98%
 * of pixels are alpha 0 or 255 (735k fully transparent, 257k fully opaque, 21k
 * partial). Both of those cases are a whole-word move rather than three
 * multiply-and-rounds, so they run through a Uint32 view and only the
 * remaining 2% pay the blend — 19.8 ms to 3.1 ms on 1400x750, byte-identical
 * output. The word views are host-endian, so the fill word is assembled by
 * writing the four bytes rather than by shifting literals into place.
 *
 * Pass `out` to write in place (out === rgba is safe: every pixel is read
 * before it is written). Omit it and the function stays pure, which is how the
 * unit tests use it.
 */
function iwdieFlattenRgbaOnto(rgba, fillRgb, out) {
  var fr = fillRgb[0], fg = fillRgb[1], fb = fillRgb[2];
  out = out || new Uint8ClampedArray(rgba.length);
  var whole = rgba.length >= 4 && (rgba.length % 4) === 0 &&
    rgba.buffer && out.buffer && (rgba.byteOffset % 4) === 0 && (out.byteOffset % 4) === 0;
  var i, a, ia;
  if (whole) {
    var fill = new Uint8Array(4);
    fill[0] = fr; fill[1] = fg; fill[2] = fb; fill[3] = 255;
    var fillWord = new Uint32Array(fill.buffer)[0];
    var src32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
    var out32 = new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
    var p, word, alpha;
    for (p = 0; p < src32.length; p++) {
      word = src32[p];
      alpha = rgba[(p << 2) + 3];
      if (alpha === 255) { out32[p] = word; continue; }
      if (alpha === 0) { out32[p] = fillWord; continue; }
      i = p << 2;
      a = alpha / 255; ia = 1 - a;
      out[i]     = Math.round(rgba[i] * a + fr * ia);
      out[i + 1] = Math.round(rgba[i + 1] * a + fg * ia);
      out[i + 2] = Math.round(rgba[i + 2] * a + fb * ia);
      out[i + 3] = 255;
    }
    return out;
  }
  for (i = 0; i < rgba.length; i += 4) {
    a = rgba[i + 3] / 255; ia = 1 - a;
    out[i]     = Math.round(rgba[i] * a + fr * ia);
    out[i + 1] = Math.round(rgba[i + 1] * a + fg * ia);
    out[i + 2] = Math.round(rgba[i + 2] * a + fb * ia);
    out[i + 3] = 255;
  }
  return out;
}

/** How many placeable items a collected panel document carries. */
function iwdieCountDocItems(doc) {
  if (!doc || typeof doc !== 'object') return 0;
  return (doc.single_objects || []).length + (doc.containers || []).length + (doc.graphics || []).length;
}

/**
 * Trace palette from the drawing's OWN colours. The tracer's sampled palette
 * washes flat schematics to grey: it samples evenly across the image, which
 * on a ~99% white/grey drawing gives 16 near-greys, and the thin coloured
 * pipe runs (orange hot gas, blue suction, yellow liquid) snap to the nearest
 * grey. Instead: bucket near-identical shades (5 bits/channel), rank buckets
 * by pixel count, represent each by its most frequent exact colour, drop
 * shades within 24/channel of an already-picked colour (anti-aliasing halos),
 * then append up to 8 remaining saturated colours so thin coloured lines get
 * a slot even though greys dominate by count. Returns null for photo-like
 * images (>3000 buckets) — the tracer's own sampling handles those better.
 * Pure (no DOM) so Node can unit-test it.
 */
function iwdieBuildPalette(imgData, maxColors) {
  maxColors = maxColors || 24;
  var d = imgData.data;
  // A Uint32Array indexed by the 15-bit bucket replaces the object-of-objects
  // this used to build: same counts, ~3.5x faster on a 1.05 Mpx panel (26 ms
  // to 7.4 ms). Exact colours go in one flat Map instead of a nested object
  // per bucket, and the per-bucket winner is picked afterwards — the Map keeps
  // first-seen order, so ties still go to the colour seen first, as before.
  var counts = new Uint32Array(32768);
  var exact = new Map();
  var i, k, bk;
  for (i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    bk = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    counts[bk]++;
    k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    exact.set(k, (exact.get(k) || 0) + 1);
  }
  var keys = [];
  for (bk = 0; bk < counts.length; bk++) { if (counts[bk]) keys.push(bk); }
  if (!keys.length || keys.length > 3000) return null;
  var best = new Int32Array(32768);
  var bestCount = new Uint32Array(32768);
  best.fill(-1);
  exact.forEach(function (n, colour) {
    var b = ((((colour >> 16) & 255) >> 3) << 10) | ((((colour >> 8) & 255) >> 3) << 5) | ((colour & 255) >> 3);
    if (n > bestCount[b]) { bestCount[b] = n; best[b] = colour; }
  });
  keys.sort(function (a, b) { return counts[b] - counts[a]; });
  var floor = Math.max(8, Math.round(imgData.width * imgData.height / 20000));
  var toRGB = function (kk) { return { r: (kk >> 16) & 255, g: (kk >> 8) & 255, b: kk & 255, a: 255 }; };
  var isSat = function (kk) {
    var r = (kk >> 16) & 255, g = (kk >> 8) & 255, b = kk & 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx > 90 && (mx - mn) / mx > 0.25;
  };
  var near = function (pal, kk) {
    var r = (kk >> 16) & 255, g = (kk >> 8) & 255, b = kk & 255;
    for (var q = 0; q < pal.length; q++) {
      if (Math.max(Math.abs(pal[q].r - r), Math.abs(pal[q].g - g), Math.abs(pal[q].b - b)) < 24) return true;
    }
    return false;
  };
  // A colour that covers half a percent of the image is a fill, not an
  // anti-aliasing halo, however close it sits to one already picked: the house
  // zone boxes (205,210,215) are 9 from the canvas grey (204,205,206) and were
  // folded into it on every trace before 1.28.0.
  var dominant = Math.max(floor, Math.round(imgData.width * imgData.height / 200));
  var pal = [], j;
  for (j = 0; j < keys.length && pal.length < maxColors; j++) {
    if (counts[keys[j]] < floor && pal.length >= 8) break;
    if (pal.length && counts[keys[j]] < dominant && near(pal, best[keys[j]])) continue;
    pal.push(toRGB(best[keys[j]]));
  }
  var extra = 0;
  for (; j < keys.length && extra < 8; j++) {
    if (counts[keys[j]] < Math.max(24, floor >> 1)) break;
    if (isSat(best[keys[j]]) && !near(pal, best[keys[j]])) { pal.push(toRGB(best[keys[j]])); extra++; }
  }
  return iwdieMergeBlendColours(pal, IWDIE_TRACE_BLEND_TOLERANCE);
}

/** A halo is a blend of two real colours, within this distance of the line between them. */
var IWDIE_TRACE_BLEND_TOLERANCE = 14;

/**
 * Anti-aliasing halos sit on the straight line between the two colours they
 * blend, in RGB. Drop a palette colour that lies within tol of the segment
 * between two colours kept before it, well away from both ends. The palette
 * arrives in pixel-count order, so the ends tested are the dominant colours,
 * and two genuinely different greys a few units apart both survive.
 */
function iwdieMergeBlendColours(pal, tol) {
  var kept = [], i, j, k;
  for (k = 0; k < pal.length; k++) {
    var c = pal[k], blend = false;
    for (i = 0; i < kept.length && !blend; i++) {
      for (j = i + 1; j < kept.length && !blend; j++) {
        var a = kept[i], b = kept[j];
        var abr = b.r - a.r, abg = b.g - a.g, abb = b.b - a.b;
        var len2 = abr * abr + abg * abg + abb * abb;
        if (len2 < 400) continue;
        var t = ((c.r - a.r) * abr + (c.g - a.g) * abg + (c.b - a.b) * abb) / len2;
        if (t < 0.12 || t > 0.88) continue;
        var dr = c.r - (a.r + abr * t), dg = c.g - (a.g + abg * t), db = c.b - (a.b + abb * t);
        if (Math.sqrt(dr * dr + dg * dg + db * db) <= tol) blend = true;
      }
    }
    if (!blend) kept.push(c);
  }
  return kept;
}

/** Colours the house artwork is drawn in, so a traced layer can carry a name. */
var IWDIE_TRACE_LAYER_NAMES = [
  ['Avtrekk-kjerne', [243, 201, 106]], ['Tilluft-kjerne', [247, 158, 122]], ['Uteluft-kjerne', [176, 224, 239]],
  ['Soner', [205, 210, 215]], ['Gjenvinner', [206, 209, 210]], ['Gjenvinner-kant', [166, 166, 169]],
  ['Piler', [105, 124, 134]], ['Symboler', [90, 90, 93]], ['Hvitt', [255, 255, 255]], ['Bakgrunn', [204, 205, 206]]
];

/** The house colour a traced fill belongs to (within 12 per channel), or null. */
function iwdieTraceColourRole(rgb) {
  var best = null, bestD = 1e9, i;
  for (i = 0; i < IWDIE_TRACE_LAYER_NAMES.length; i++) {
    var c = IWDIE_TRACE_LAYER_NAMES[i][1];
    var d = Math.max(Math.abs(c[0] - rgb[0]), Math.abs(c[1] - rgb[1]), Math.abs(c[2] - rgb[2]));
    if (d < bestD) { bestD = d; best = IWDIE_TRACE_LAYER_NAMES[i][0]; }
  }
  return bestD <= 12 ? best : null;
}

function iwdieTraceHex(rgb) {
  return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase();
}

function iwdieTraceLayerName(rgb, used) {
  var hex = iwdieTraceHex(rgb);
  var name = iwdieTraceColourRole(rgb) || 'Farge-' + hex.slice(1);
  if (used[name]) { used[name]++; name += '-' + used[name]; } else used[name] = 1;
  return { name: name, hex: hex };
}

/**
 * What a traced shape is, from its own colour and the colours nested inside
 * or joined to it. A white shape is a duct casing when a core line runs with
 * it, a zone when zone grey sits inside it, a symbol when symbol grey does;
 * the cores, zones, the exchanger ring, arrows and symbols name themselves.
 */
var IWDIE_TRACE_OBJECT_NAMES = {
  'Avtrekk-kjerne': 'Kjerne-avtrekk', 'Tilluft-kjerne': 'Kjerne-tilluft', 'Uteluft-kjerne': 'Kjerne-uteluft',
  'Soner': 'Sone', 'Gjenvinner': 'Gjenvinner-flate', 'Gjenvinner-kant': 'Symbol',
  'Piler': 'Pil', 'Symboler': 'Symbol', 'Hvitt': 'Hvit-flate', 'Bakgrunn': 'Flate'
};
var IWDIE_TRACE_CORE_ROLES = ['Avtrekk-kjerne', 'Tilluft-kjerne', 'Uteluft-kjerne'];
var IWDIE_TRACE_DUCT_ROLES = { 'Avtrekk-kjerne': 1, 'Tilluft-kjerne': 1, 'Uteluft-kjerne': 1, 'Hvitt': 1, 'Piler': 1 };

/** Kanal-avtrekk, Kanal-tilluft, Kanal-uteluft; Kanaler when cores of more than one colour run together; null without a core. */
function iwdieTraceDuctName(inside) {
  var cores = IWDIE_TRACE_CORE_ROLES.filter(function (r) { return inside[r]; });
  if (cores.length > 1) return 'Kanaler';
  if (cores.length === 1) return 'Kanal-' + cores[0].split('-')[0].toLowerCase();
  return null;
}

/**
 * ownRole: the shape's own house colour (null when none). inside: the roles
 * of everything nested in or joined to it. info.sliver: a thin anti-aliasing
 * remnant; info.assembly: a duct assembly (no shape of its own);
 * info.member: a shape inside an assembly; info.sidebar: zone grey running
 * the height of the canvas at its right edge — the house side column.
 */
function iwdieTraceObjectName(ownRole, inside, hex, info) {
  inside = inside || {}; info = info || {};
  if (info.sliver) return 'Kant';
  if (info.assembly) return iwdieTraceDuctName(inside) || (inside.Hvitt ? 'Hvit-flate' : 'Pil');
  if (info.member && ownRole === 'Hvitt') return 'Kapsling';
  if (ownRole === 'Hvitt') return iwdieTraceDuctName(inside) || (inside.Soner ? 'Sone' : inside.Symboler ? 'Symbol' : 'Hvit-flate');
  if (ownRole === 'Soner') return info.sidebar ? 'Sidefelt' : 'Sone';
  // the exchanger is the ring with the white pill inside; the same grey without one is a valve stem or a frame
  if (ownRole === 'Gjenvinner-kant') return inside.Hvitt ? 'Gjenvinner' : 'Symbol';
  if (ownRole && IWDIE_TRACE_OBJECT_NAMES[ownRole]) return IWDIE_TRACE_OBJECT_NAMES[ownRole];
  return 'Form-' + String(hex || '#000000').slice(1);
}

/** Ray casting: is the point inside the polygon ring (array of [x, y])? */
function iwdiePointInRing(pt, ring) {
  var c = false, i, j, n = ring.length;
  for (i = 0, j = n - 1; i < n; j = i++) {
    var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Above this many shapes the nesting search (n^2) is skipped and the trace is grouped by colour. */
var IWDIE_TRACE_OBJECT_LIMIT = 3000;

/**
 * Nesting, from the traced shapes. A quantised image gives disjoint regions,
 * so a shape lying inside another's outer ring can only sit in a hole of it:
 * a zone's grey inside its white border, the exchanger's inner pill inside its
 * ring, a symbol's white inside its outline. Each shape gets the smallest such
 * enclosing shape as its parent — bounding box first, then a vote over up to
 * twelve of its outline points, because a nested shape often starts exactly
 * where the enclosing outline does and a single point would land on the edge.
 * Returns the top-level shapes, largest first; every item gains .parent and
 * .children (children largest first).
 */
function iwdieTraceObjectTree(items) {
  var i, j, k, n = items.length;
  var tol = 0.6;
  var contains = function (a, b) {
    if (a.area <= b.area) return false;
    if (b.bbox[0] < a.bbox[0] - tol || b.bbox[1] < a.bbox[1] - tol || b.bbox[2] > a.bbox[2] + tol || b.bbox[3] > a.bbox[3] + tol) return false;
    var ring = b.ring, step = Math.max(1, Math.floor(ring.length / 12)), hits = 0, tested = 0;
    for (k = 0; k < ring.length; k += step) { tested++; if (iwdiePointInRing(ring[k], a.ring)) hits++; }
    return hits * 2 > tested;
  };
  for (i = 0; i < n; i++) { items[i].parent = null; items[i].children = []; }
  if (n <= IWDIE_TRACE_OBJECT_LIMIT) {
    for (i = 0; i < n; i++) {
      var best = null;
      for (j = 0; j < n; j++) {
        if (i === j || (best && items[j].area >= best.area)) continue;
        if (contains(items[j], items[i])) best = items[j];
      }
      items[i].parent = best;
      if (best) best.children.push(items[i]);
    }
  }
  var byArea = function (a, b) { return b.area - a.area; };
  for (i = 0; i < n; i++) items[i].children.sort(byArea);
  return items.filter(function (it) { return !it.parent; }).sort(byArea);
}

/**
 * A duct in these drawings is a coloured core line with a white strip along
 * each side and arrows on top — shapes that touch but do not nest, so the
 * containment tree leaves them apart. Top-level shapes of those colours that
 * touch (within 1.5 px; 8 px for an arrow, which sits a little off the casing
 * end) are joined into one assembly, named by the core colours in it: the
 * whole network where ducts join, Kanal-uteluft where a run stands alone.
 * Zones, symbols and the exchanger keep to the containment tree. Returns the
 * new top-level list, largest first.
 */
function iwdieTraceBoxesTouch(a, b, gap) {
  var dx = Math.max(0, a.bbox[0] - b.bbox[2], b.bbox[0] - a.bbox[2]);
  var dy = Math.max(0, a.bbox[1] - b.bbox[3], b.bbox[1] - a.bbox[3]);
  return dx <= gap && dy <= gap;
}

function iwdieTraceAssemblies(tops) {
  var n = tops.length, root = [], i, j;
  for (i = 0; i < n; i++) root[i] = i;
  var find = function (x) { while (root[x] !== x) { root[x] = root[root[x]]; x = root[x]; } return x; };
  for (i = 0; i < n; i++) {
    if (!IWDIE_TRACE_DUCT_ROLES[tops[i].role] || tops[i].sliver) continue;
    for (j = i + 1; j < n; j++) {
      if (!IWDIE_TRACE_DUCT_ROLES[tops[j].role] || tops[j].sliver) continue;
      if (iwdieTraceBoxesTouch(tops[i], tops[j], (tops[i].role === 'Piler' || tops[j].role === 'Piler') ? 8 : 1.5)) root[find(i)] = find(j);
    }
  }
  var groups = {}, order = [], r;
  for (i = 0; i < n; i++) { r = find(i); if (!groups[r]) { groups[r] = []; order.push(r); } groups[r].push(tops[i]); }
  var byArea = function (a, b) { return b.area - a.area; };
  var out = order.map(function (key) {
    var members = groups[key];
    if (members.length === 1) return members[0];
    var bbox = [1e9, 1e9, -1e9, -1e9];
    members.forEach(function (m) {
      m.member = true;
      bbox[0] = Math.min(bbox[0], m.bbox[0]); bbox[1] = Math.min(bbox[1], m.bbox[1]);
      bbox[2] = Math.max(bbox[2], m.bbox[2]); bbox[3] = Math.max(bbox[3], m.bbox[3]);
    });
    return { assembly: true, role: null, hex: '', d: '', children: members.sort(byArea), bbox: bbox,
      area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) };
  });
  // an anti-aliasing remnant rides inside the smallest object it touches, so
  // the top level lists the drawing's things and not two dozen edge crumbs
  var keep = [];
  out.forEach(function (it) {
    if (!it.sliver) { keep.push(it); return; }
    var host = null;
    for (j = 0; j < out.length; j++) {
      var o = out[j];
      if (o === it || o.sliver) continue;
      if (iwdieTraceBoxesTouch(it, o, 1.5) && (!host || o.area < host.area)) host = o;
    }
    if (host) host.children.push(it); else keep.push(it);
  });
  return keep.sort(byArea);
}

/**
 * The trace as Illustrator wants it: the supersample scale baked into the
 * coordinates instead of a transform group, no stroke/opacity noise, the
 * full-canvas plate as a single rect, a title and a description — and the
 * shapes grouped as the drawing's objects: nesting (iwdieTraceObjectTree),
 * then duct assemblies (iwdieTraceAssemblies), each group named by what it is
 * (Kanaler, Kanal-uteluft, Sone, Gjenvinner, Symbol, Pil …) and stacked back
 * to front. Canvas-coloured islands are dropped when the plate is there (they
 * render the same), thin anti-aliasing remnants are named Kant. Colour layers
 * mixed every casing, zone border and pill into one "Hvitt"; an object is what
 * a person selects. Pure string work, so Node can hold it to the tracer's
 * output.
 */
function iwdieTidyTraceSvg(svg, scale, width, height) {
  var s = String(svg == null ? '' : svg);
  scale = scale || 1;
  var re = /<path\b([^>]*?)\/?>(?:<\/path>)?/g, m;
  var items = [], plate = null;
  var dec = scale === 1 ? 0 : 1;
  var num = function (n) { var v = Number(n) / scale; return dec ? String(Math.round(v * 10) / 10) : String(Math.round(v)); };
  var rgbOf = function (f) { var k = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(f); return k ? [+k[1], +k[2], +k[3]] : [0, 0, 0]; };
  while ((m = re.exec(s)) !== null) {
    var attrs = m[1];
    var fill = (/fill="([^"]+)"/.exec(attrs) || [])[1] || 'none';
    var d = (/\bd="([^"]*)"/.exec(attrs) || [])[1] || '';
    if (!d) continue;
    d = d.replace(/-?\d+(?:\.\d+)?/g, num);
    var nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, i;
    for (i = 0; i + 1 < nums.length; i += 2) {
      if (nums[i] < minx) minx = nums[i]; if (nums[i] > maxx) maxx = nums[i];
      if (nums[i + 1] < miny) miny = nums[i + 1]; if (nums[i + 1] > maxy) maxy = nums[i + 1];
    }
    if (!plate && minx <= 0 && miny <= 0 && maxx >= width - 1 && maxy >= height - 1) { plate = fill; continue; }
    if (plate && fill === plate) continue; // canvas-coloured island: the plate shows through identically
    // the outer ring is the first subpath; the tracer appends holes after it
    var outer = (d.split(/(?=M)/)[0].match(/-?\d+(?:\.\d+)?/g) || []).map(Number), ring = [];
    for (i = 0; i + 1 < outer.length; i += 2) ring.push([outer[i], outer[i + 1]]);
    var rgb = rgbOf(fill), role = iwdieTraceColourRole(rgb);
    var w = Math.max(0, maxx - minx), h = Math.max(0, maxy - miny);
    items.push({ d: d, fill: fill, rgb: rgb, hex: iwdieTraceHex(rgb), role: role, bbox: [minx, miny, maxx, maxy], area: w * h, ring: ring,
      // a thin line or a crumb of a fill colour is an anti-aliasing remnant; a
      // core line is thin by design and a symbol stroke is a symbol
      sliver: (Math.min(w, h) <= 2.5 || w * h < 100) && IWDIE_TRACE_CORE_ROLES.indexOf(role) < 0 && role !== 'Symboler',
      sidebar: role === 'Soner' && maxx >= width - 1 && h >= 0.9 * height });
  }
  var out = [];
  if (plate) {
    out.push('  <g id="Bakgrunn">\n    <rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + iwdieTraceHex(rgbOf(plate)) + '"/>\n  </g>');
  }
  var nested = items.length <= IWDIE_TRACE_OBJECT_LIMIT;
  if (!nested) {
    // thousands of shapes (a photo): one group per colour, as 1.28.0 did
    var byFill = {}, order = [];
    items.forEach(function (it) { if (!byFill[it.fill]) { byFill[it.fill] = []; order.push(it.fill); } byFill[it.fill].push(it); });
    order.sort(function (a, b) { return byFill[b].length - byFill[a].length; });
    var used = { Bakgrunn: 1 };
    order.forEach(function (fill) {
      var nm = iwdieTraceLayerName(byFill[fill][0].rgb, used);
      out.push('  <g id="' + nm.name + '" fill="' + nm.hex + '">\n' +
        byFill[fill].map(function (it) { return '    <path d="' + it.d + '"/>'; }).join('\n') + '\n  </g>');
    });
  } else {
    var tops = iwdieTraceAssemblies(iwdieTraceObjectTree(items));
    var counts = {}, seen = {};
    var nameOf = function (node) {
      var inside = {};
      (function walk(x) { x.children.forEach(function (c) { if (c.role) inside[c.role] = true; walk(c); }); })(node);
      return iwdieTraceObjectName(node.role, inside, node.hex, node);
    };
    (function label(list) { list.forEach(function (it) { it.name = nameOf(it); counts[it.name] = (counts[it.name] || 0) + 1; label(it.children); }); })(tops);
    var idFor = function (it) {
      if (counts[it.name] < 2) return it.name;
      seen[it.name] = (seen[it.name] || 0) + 1;
      return it.name + '-' + seen[it.name];
    };
    // the top-level objects take the low numbers; what nests inside follows
    tops.forEach(function (it) { it.id = idFor(it); });
    (function number(list) { list.forEach(function (it) { if (!it.id) it.id = idFor(it); number(it.children); }); })(tops);
    var emit = function (it, depth) {
      var pad = new Array(depth + 2).join('  ');
      var str = pad + '<g id="' + it.id + '">\n';
      if (it.d) str += pad + '  <path fill="' + it.hex + '" d="' + it.d + '"/>\n';
      it.children.forEach(function (c) { str += emit(c, depth + 1); });
      return str + pad + '</g>\n';
    };
    tops.forEach(function (it) { out.push(emit(it, 0).replace(/\n$/, '')); });
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '">\n' +
    '  <title>Panel background, traced</title>\n' +
    '  <desc>Vector trace of the panel background' + (nested ?
      ' as objects: each drawn thing is a group holding what sits inside it or runs with it (a duct network with its casing, core lines and arrows; a zone with its border; the exchanger with its rings), named by what it is (Kanaler, Kanal-avtrekk, Kanal-tilluft, Kanal-uteluft, Sone, Gjenvinner, Symbol, Pil; Kant is an anti-aliasing remnant), stacked back to front' :
      ': one group per colour, named after the house palette where it matches') +
    ', coordinates in panel pixels' + (scale > 1 ? ' (traced at ' + scale + 'x and scaled back)' : '') + '. The full-canvas plate is a single rect.</desc>\n' +
    out.join('\n') + '\n</svg>\n';
}

/** Tracer options for a trace someone will edit: straight lines stay straight, specks go. */
function iwdieTraceOptionsIllustrator(scale) {
  return {
    numberofcolors: 16, ltres: 1, qtres: 1, pathomit: 32 * (scale || 1),
    rightangleenhance: true, roundcoords: 1, strokewidth: 0,
    linefilter: false, viewbox: true, desc: false, colorquantcycles: 1
  };
}

/**
 * The trace worker's source, and the message it expects. These are one unit and
 * are built by one pair of functions on purpose: the worker reads its inputs off
 * e.data by name, so a key the payload does not send is not an error anywhere —
 * the worker just silently skips that step. That is how v1.17.0 shipped a worker
 * asking for paletteColors while the payload never carried it, which dropped the
 * derived palette and let the tracer fall back to its own 16 sampled colours,
 * turning every flat schematic grey. iwdieTraceWorkerInputs() names the contract
 * so a test can hold the two sides together.
 */
var IWDIE_TRACE_WORKER_INPUTS = ['img', 'opts', 'paletteColors'];

/**
 * Everything iwdieBuildPalette reaches for besides its own body, as source text
 * the worker can evaluate. The palette function is lifted into the worker by
 * Function.prototype.toString, which carries the body and nothing it closes
 * over: 1.28.0 made it call iwdieMergeBlendColours and read
 * IWDIE_TRACE_BLEND_TOLERANCE, the worker threw ReferenceError on its first
 * message, and the catch fell back to tracing on the main thread — which is
 * how the tab went "Page Unresponsive" for the length of the job. The check
 * suite runs the built worker source in a bare context so the next helper added
 * here breaks a test instead of a browser.
 */
function iwdieTraceWorkerDeps() {
  return [
    'var IWDIE_TRACE_BLEND_TOLERANCE=' + IWDIE_TRACE_BLEND_TOLERANCE + ';',
    iwdieMergeBlendColours.toString()
  ];
}

/**
 * The worker runs the tracer's own sequential pipeline step by step instead of
 * one imagedataToSVG call, so it can report where it is: {progress:{phase,
 * i, n, rgb}} before the palette scan, before quantisation, before each colour
 * layer (with that layer's colour, so the panel can name it), and before the
 * SVG string. The final message is {svg} or {err}. iwdieTraceProgress() turns a
 * progress message into a bar position and a line of text.
 */
function iwdieBuildTraceWorkerCode(tracerSrc, paletteSrc, deps) {
  return 'var IT=new (' + tracerSrc + ')();\n' +
    (deps || []).join('\n') + '\n' +
    'var BP=' + paletteSrc + ';\n' +
    'var say=function(p){postMessage({progress:p})};\n' +
    'onmessage=function(e){try{' +
    'var o=IT.checkoptions(e.data.opts);' +
    'if(e.data.paletteColors){say({phase:"palette"});var p=BP(e.data.img,e.data.paletteColors);if(p)o.pal=p;}' +
    'say({phase:"quantize",n:o.pal?o.pal.length:o.numberofcolors});' +
    'var ii=IT.colorquantization(e.data.img,o);' +
    'var td={layers:[],palette:ii.palette,width:ii.array[0].length-2,height:ii.array.length-2};' +
    'for(var c=0;c<ii.palette.length;c++){var pc=ii.palette[c];say({phase:"layer",i:c,n:ii.palette.length,rgb:[pc.r,pc.g,pc.b]});' +
    'td.layers.push(IT.batchtracepaths(IT.internodes(IT.pathscan(IT.layeringstep(ii,c),o.pathomit),o),o.ltres,o.qtres));}' +
    'say({phase:"svg"});' +
    'postMessage({svg:IT.getsvgstring(td,o)})}catch(err){postMessage({err:String(err)})}};';
}

/** One bar position and one line of text per stage the trace reports. */
function iwdieTraceProgress(p) {
  p = p || {};
  var n = Math.max(1, Number(p.n) || 1), i = Math.max(0, Number(p.i) || 0);
  switch (p.phase) {
    case 'palette': return { pct: 5, line: 'Reading the colours of the picture' };
    case 'quantize': return { pct: 10, line: 'Sorting every pixel into ' + (p.n ? p.n + ' colours' : 'its colour') };
    case 'layer': {
      var name = p.rgb ? iwdieTraceLayerName(p.rgb, {}).name : '';
      return { pct: 14 + Math.round(76 * i / n), line: 'Tracing colour ' + (i + 1) + ' of ' + n + (name ? ' - ' + name : '') };
    }
    case 'svg': return { pct: 91, line: 'Writing the paths' };
    case 'tidy': return { pct: 95, line: 'Grouping the shapes into objects' };
    case 'main-thread': return { pct: 8, line: 'No worker available - tracing on the main thread, the browser is busy for a moment' };
    case 'done': return { pct: 100, line: 'Done' };
    default: return { pct: 2, line: 'Reading the pixels' };
  }
}

function iwdieBuildTraceWorkerPayload(imgData, opts, paletteColors) {
  return {
    img: { width: imgData.width, height: imgData.height, data: imgData.data },
    opts: opts,
    paletteColors: paletteColors || 0
  };
}

/** Every e.data.<key> the worker source reads — the payload must supply each. */
function iwdieTraceWorkerInputs(code) {
  var found = {}, re = /e\.data\.([A-Za-z_$][\w$]*)/g, m;
  while ((m = re.exec(String(code || ''))) !== null) found[m[1]] = true;
  return Object.keys(found).sort();
}

function iwdieNormalizeTraceSvg(svg) {
  var s = String(svg == null ? '' : svg).trim();
  if (!s || iwdieValidateSvg(s).length > 0 || !/<\/svg>\s*$/i.test(s)) return null;
  return s;
}

function iwdiePrepareExportTrace(env, deps) {
  deps = deps || {};
  var panel = env && env.panel;
  if (!panel || typeof panel !== 'object') return Promise.reject(new Error('Export envelope has no panel document.'));
  // 1.17.0 keeps both blobs on the envelope; older shapes carried them on the
  // panel, and prepareExportTrace is called directly by the tests, so read both.
  var bg = String((env.image_data != null ? env.image_data : panel.image_data) || '');
  delete env.image_svg_trace;
  delete panel.image_svg_trace;
  delete panel.image_svg;         // re-export must not carry a stale one
  iwdieNoteTraceInAiGuide(env);   // the guide follows the file, not the intent
  if (!/^data:image\//i.test(bg)) return Promise.resolve({ env: env, traceNote: '' });

  if (iwdieIsSvgBackground(bg)) {
    return Promise.resolve().then(function () {
      var parsed;
      try { parsed = iwdieParseDataUrl(bg); }
      catch (error) { throw new Error('Embedded SVG background could not be decoded: ' + error); }
      if (!parsed || typeof deps.decodeUtf8 !== 'function') throw new Error('Embedded SVG background could not be decoded.');
      var svg;
      try { svg = deps.decodeUtf8(parsed.bytes); }
      catch (error) { throw new Error('Embedded SVG background could not be decoded: ' + error); }
      svg = iwdieNormalizeTraceSvg(svg);
      if (!svg) throw new Error('Embedded SVG background did not contain valid SVG.');
      // The background IS the artwork here, not a trace of one. Hand it back as
      // panel.image_svg — the field Insert reads — so the drawing round-trips as
      // editable vector instead of coming back as an autotrace of its own pixels.
      panel.image_svg = svg;
      iwdieNoteArtworkInAiGuide(env, svg);
      return { env: env, traceNote: ' + editable artwork (' + iwdieCountSvgShapes(svg) + ' shapes)' };
    });
  }

  if (typeof deps.traceRaster !== 'function') return Promise.reject(new Error('Background tracer is unavailable.'));
  return Promise.resolve().then(function () {
    return deps.traceRaster(bg);
  }).then(function (svg) {
    svg = iwdieNormalizeTraceSvg(svg);
    if (!svg) throw new Error('Vector trace did not produce valid SVG.');
    env.image_svg_trace = svg;
    iwdieNoteTraceInAiGuide(env);
    return {
      env: env,
      traceNote: ' + vector structure (' + ((svg.match(/<path\b/g) || []).length) + ' paths)'
    };
  });
}

function iwdieCompleteExport(env, deps) {
  deps = deps || {};
  return iwdiePrepareExportTrace(env, deps).then(function (result) {
    if (typeof deps.download !== 'function') throw new Error('Export downloader is unavailable.');
    deps.download(result.env, result.traceNote);
    return result;
  });
}

/**
 * Build a minimal single-page PDF containing one image XObject — the file
 * Illustrator opens as an artboard (1 px = 1 pt) with the image placed 1:1.
 * opts: { width, height, filter: 'FlateDecode' (raw RGB deflated) or
 *         'DCTDecode' (JPEG bytes as-is), data: Uint8Array }
 * Returns a Uint8Array. Pure + synchronous so Node can unit-test it.
 */
function iwdieBuildImagePdf(opts) {
  var w = Math.max(1, Math.round(opts.width));
  var h = Math.max(1, Math.round(opts.height));
  var filter = opts.filter === 'DCTDecode' ? 'DCTDecode' : 'FlateDecode';
  function enc(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; }
  var parts = [], pos = 0, offsets = [];
  function push(u8) { parts.push(u8); pos += u8.length; }
  function pushStr(s) { push(enc(s)); }

  pushStr('%PDF-1.4\n%âãÏÓ\n');
  offsets[1] = pos; pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = pos; pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  offsets[3] = pos; pushStr('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] ' +
    '/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n');
  offsets[4] = pos;
  pushStr('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /' + filter +
    ' /Length ' + opts.data.length + ' >>\nstream\n');
  push(opts.data);
  pushStr('\nendstream\nendobj\n');
  var content = 'q\n' + w + ' 0 0 ' + h + ' 0 0 cm\n/Im0 Do\nQ\n';
  offsets[5] = pos;
  pushStr('5 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
  var xrefPos = pos;
  function pad10(n) { var s = String(n); while (s.length < 10) s = '0' + s; return s; }
  var xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (var i = 1; i <= 5; i++) xref += pad10(offsets[i]) + ' 00000 n \n';
  pushStr(xref + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  var out = new Uint8Array(pos), o = 0;
  for (var k = 0; k < parts.length; k++) { out.set(parts[k], o); o += parts[k].length; }
  return out;
}

/** iwmac-bg_<plant>_<panel>_<stamp>.<ext> */
function iwdieBuildBackgroundFilename(plantId, panelName, ext, now) {
  var d = now || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  var stamp = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  return 'iwmac-bg_' + (plantId || 'plant') + '_' + iwdieSanitizeName(panelName) + '_' + stamp + '.' + (ext || 'ai');
}

/* ===================== vendored: imagetracerjs 1.2.6 =====================
   Raster -> vector SVG tracer by Andras Jankovics (The Unlicense / public
   domain), https://github.com/jankovicsandras/imagetracerjs - embedded
   verbatim so the userscript stays one self-contained file. Used by the
   Background -> Illustrator button's optional vector-trace mode. */
/*
	imagetracer.js version 1.2.6
	Simple raster image tracer and vectorizer written in JavaScript.
	andras@jankovics.net
*/

/*

The Unlicense / PUBLIC DOMAIN

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to http://unlicense.org/

*/

(function(){ 'use strict';

function ImageTracer(){
	var _this = this;

	this.versionnumber = '1.2.6',

	////////////////////////////////////////////////////////////
	//
	//  API
	//
	////////////////////////////////////////////////////////////

	// Loading an image from a URL, tracing when loaded,
	// then executing callback with the scaled svg string as argument
	this.imageToSVG = function( url, callback, options ){
		options = _this.checkoptions(options);
		// loading image, tracing and callback
		_this.loadImage(
			url,
			function(canvas){
				callback(
					_this.imagedataToSVG( _this.getImgdata(canvas), options )
				);
			},
			options
		);
	},// End of imageToSVG()

	// Tracing imagedata, then returning the scaled svg string
	this.imagedataToSVG = function( imgd, options ){
		options = _this.checkoptions(options);
		// tracing imagedata
		var td = _this.imagedataToTracedata( imgd, options );
		// returning SVG string
		return _this.getsvgstring(td, options);
	},// End of imagedataToSVG()

	// Loading an image from a URL, tracing when loaded,
	// then executing callback with tracedata as argument
	this.imageToTracedata = function( url, callback, options ){
		options = _this.checkoptions(options);
		// loading image, tracing and callback
		_this.loadImage(
				url,
				function(canvas){
					callback(
						_this.imagedataToTracedata( _this.getImgdata(canvas), options )
					);
				},
				options
		);
	},// End of imageToTracedata()

	// Tracing imagedata, then returning tracedata (layers with paths, palette, image size)
	this.imagedataToTracedata = function( imgd, options ){
		options = _this.checkoptions(options);

		// 1. Color quantization
		var ii = _this.colorquantization( imgd, options );

		if(options.layering === 0){// Sequential layering

			// create tracedata object
			var tracedata = {
				layers : [],
				palette : ii.palette,
				width : ii.array[0].length-2,
				height : ii.array.length-2
			};

			// Loop to trace each color layer
			for(var colornum=0; colornum<ii.palette.length; colornum++){

				// layeringstep -> pathscan -> internodes -> batchtracepaths
				var tracedlayer =
					_this.batchtracepaths(

						_this.internodes(

							_this.pathscan(
								_this.layeringstep( ii, colornum ),
								options.pathomit
							),

							options

						),

						options.ltres,
						options.qtres

					);

				// adding traced layer
				tracedata.layers.push(tracedlayer);

			}// End of color loop

		}else{// Parallel layering
			// 2. Layer separation and edge detection
			var ls = _this.layering( ii );

			// Optional edge node visualization
			if(options.layercontainerid){ _this.drawLayers( ls, _this.specpalette, options.scale, options.layercontainerid ); }

			// 3. Batch pathscan
			var bps = _this.batchpathscan( ls, options.pathomit );

			// 4. Batch interpollation
			var bis = _this.batchinternodes( bps, options );

			// 5. Batch tracing and creating tracedata object
			var tracedata = {
				layers : _this.batchtracelayers( bis, options.ltres, options.qtres ),
				palette : ii.palette,
				width : imgd.width,
				height : imgd.height
			};

		}// End of parallel layering

		// return tracedata
		return tracedata;

	},// End of imagedataToTracedata()

	this.optionpresets = {
		'default': {

			// Tracing
			corsenabled : false,
			ltres : 1,
			qtres : 1,
			pathomit : 8,
			rightangleenhance : true,

			// Color quantization
			colorsampling : 2,
			numberofcolors : 16,
			mincolorratio : 0,
			colorquantcycles : 3,

			// Layering method
			layering : 0,

			// SVG rendering
			strokewidth : 1,
			linefilter : false,
			scale : 1,
			roundcoords : 1,
			viewbox : false,
			desc : false,
			lcpr : 0,
			qcpr : 0,

			// Blur
			blurradius : 0,
			blurdelta : 20

		},
		'posterized1': { colorsampling:0, numberofcolors:2 },
		'posterized2': { numberofcolors:4, blurradius:5 },
		'curvy': { ltres:0.01, linefilter:true, rightangleenhance:false },
		'sharp': { qtres:0.01, linefilter:false },
		'detailed': { pathomit:0, roundcoords:2, ltres:0.5, qtres:0.5, numberofcolors:64 },
		'smoothed': { blurradius:5, blurdelta: 64 },
		'grayscale': { colorsampling:0, colorquantcycles:1, numberofcolors:7 },
		'fixedpalette': { colorsampling:0, colorquantcycles:1, numberofcolors:27 },
		'randomsampling1': { colorsampling:1, numberofcolors:8 },
		'randomsampling2': { colorsampling:1, numberofcolors:64 },
		'artistic1': { colorsampling:0, colorquantcycles:1, pathomit:0, blurradius:5, blurdelta: 64, ltres:0.01, linefilter:true, numberofcolors:16, strokewidth:2 },
		'artistic2': { qtres:0.01, colorsampling:0, colorquantcycles:1, numberofcolors:4, strokewidth:0 },
		'artistic3': { qtres:10, ltres:10, numberofcolors:8 },
		'artistic4': { qtres:10, ltres:10, numberofcolors:64, blurradius:5, blurdelta: 256, strokewidth:2 },
		'posterized3': { ltres: 1, qtres: 1, pathomit: 20, rightangleenhance: true, colorsampling: 0, numberofcolors: 3,
			mincolorratio: 0, colorquantcycles: 3, blurradius: 3, blurdelta: 20, strokewidth: 0, linefilter: false,
			roundcoords: 1, pal: [ { r: 0, g: 0, b: 100, a: 255 }, { r: 255, g: 255, b: 255, a: 255 } ] }
	},// End of optionpresets

	// creating options object, setting defaults for missing values
	this.checkoptions = function(options){
		options = options || {};
		// Option preset
		if(typeof options === 'string'){
			options = options.toLowerCase();
			if( _this.optionpresets[options] ){ options = _this.optionpresets[options]; }else{ options = {}; }
		}
		// Defaults
		var ok = Object.keys(_this.optionpresets['default']);
		for(var k=0; k<ok.length; k++){
			if(!options.hasOwnProperty(ok[k])){ options[ok[k]] = _this.optionpresets['default'][ok[k]]; }
		}
		// options.pal is not defined here, the custom palette should be added externally: options.pal = [ { 'r':0, 'g':0, 'b':0, 'a':255 }, {...}, ... ];
		// options.layercontainerid is not defined here, can be added externally: options.layercontainerid = 'mydiv'; ... <div id="mydiv"></div>
		return options;
	},// End of checkoptions()

	////////////////////////////////////////////////////////////
	//
	//  Vectorizing functions
	//
	////////////////////////////////////////////////////////////

	// 1. Color quantization
	// Using a form of k-means clustering repeatead options.colorquantcycles times. http://en.wikipedia.org/wiki/Color_quantization
	this.colorquantization = function( imgd, options ){
		var arr = [], idx=0, cd,cdl,ci, paletteacc = [], pixelnum = imgd.width * imgd.height, i, j, k, cnt, palette;

		// imgd.data must be RGBA, not just RGB
		if( imgd.data.length < pixelnum * 4 ){
			var newimgddata = new Uint8ClampedArray(pixelnum * 4);
			for(var pxcnt = 0; pxcnt < pixelnum ; pxcnt++){
				newimgddata[pxcnt*4  ] = imgd.data[pxcnt*3  ];
				newimgddata[pxcnt*4+1] = imgd.data[pxcnt*3+1];
				newimgddata[pxcnt*4+2] = imgd.data[pxcnt*3+2];
				newimgddata[pxcnt*4+3] = 255;
			}
			imgd.data = newimgddata;
		}// End of RGBA imgd.data check

		// Filling arr (color index array) with -1
		for( j=0; j<imgd.height+2; j++ ){ arr[j]=[]; for(i=0; i<imgd.width+2 ; i++){ arr[j][i] = -1; } }

		// Use custom palette if pal is defined or sample / generate custom length palette
		if(options.pal){
			palette = options.pal;
		}else if(options.colorsampling === 0){
			palette = _this.generatepalette(options.numberofcolors);
		}else if(options.colorsampling === 1){
			palette = _this.samplepalette( options.numberofcolors, imgd );
		}else{
			palette = _this.samplepalette2( options.numberofcolors, imgd );
		}

		// Selective Gaussian blur preprocessing
		if( options.blurradius > 0 ){ imgd = _this.blur( imgd, options.blurradius, options.blurdelta ); }

		// Repeat clustering step options.colorquantcycles times
		for( cnt=0; cnt < options.colorquantcycles; cnt++ ){

			// Average colors from the second iteration
			if(cnt>0){
				// averaging paletteacc for palette
				for( k=0; k < palette.length; k++ ){

					// averaging
					if( paletteacc[k].n > 0 ){
						palette[k] = {  r: Math.floor( paletteacc[k].r / paletteacc[k].n ),
										g: Math.floor( paletteacc[k].g / paletteacc[k].n ),
										b: Math.floor( paletteacc[k].b / paletteacc[k].n ),
										a:  Math.floor( paletteacc[k].a / paletteacc[k].n ) };
					}

					// Randomizing a color, if there are too few pixels and there will be a new cycle
					if( ( paletteacc[k].n/pixelnum < options.mincolorratio ) && ( cnt < options.colorquantcycles-1 ) ){
						palette[k] = {  r: Math.floor(Math.random()*255),
										g: Math.floor(Math.random()*255),
										b: Math.floor(Math.random()*255),
										a: Math.floor(Math.random()*255) };
					}

				}// End of palette loop
			}// End of Average colors from the second iteration

			// Reseting palette accumulator for averaging
			for( i=0; i < palette.length; i++ ){ paletteacc[i] = { r:0, g:0, b:0, a:0, n:0 }; }

			// loop through all pixels
			for( j=0; j < imgd.height; j++ ){
				for( i=0; i < imgd.width; i++ ){

					// pixel index
					idx = (j*imgd.width+i)*4;

					// find closest color from palette by measuring (rectilinear) color distance between this pixel and all palette colors
					ci=0; cdl = 1024; // 4 * 256 is the maximum RGBA distance
					for( k=0; k<palette.length; k++ ){

						// In my experience, https://en.wikipedia.org/wiki/Rectilinear_distance works better than https://en.wikipedia.org/wiki/Euclidean_distance
						cd = Math.abs(palette[k].r-imgd.data[idx]) + Math.abs(palette[k].g-imgd.data[idx+1]) + Math.abs(palette[k].b-imgd.data[idx+2]) + Math.abs(palette[k].a-imgd.data[idx+3]);

						// Remember this color if this is the closest yet
						if(cd<cdl){ cdl = cd; ci = k; }

					}// End of palette loop

					// add to palettacc
					paletteacc[ci].r += imgd.data[idx  ];
					paletteacc[ci].g += imgd.data[idx+1];
					paletteacc[ci].b += imgd.data[idx+2];
					paletteacc[ci].a += imgd.data[idx+3];
					paletteacc[ci].n++;

					// update the indexed color array
					arr[j+1][i+1] = ci;

				}// End of i loop
			}// End of j loop

		}// End of Repeat clustering step options.colorquantcycles times

		return { array:arr, palette:palette };

	},// End of colorquantization()

	// Sampling a palette from imagedata
	this.samplepalette = function( numberofcolors, imgd ){
		var idx, palette=[];
		for(var i=0; i<numberofcolors; i++){
			idx = Math.floor( Math.random() * imgd.data.length / 4 ) * 4;
			palette.push({ r:imgd.data[idx  ], g:imgd.data[idx+1], b:imgd.data[idx+2], a:imgd.data[idx+3] });
		}
		return palette;
	},// End of samplepalette()

	// Deterministic sampling a palette from imagedata: rectangular grid
	this.samplepalette2 = function( numberofcolors, imgd ){
		var idx, palette=[], ni = Math.ceil(Math.sqrt(numberofcolors)), nj = Math.ceil(numberofcolors/ni),
			vx = imgd.width / (ni+1), vy = imgd.height / (nj+1);
		for(var j=0; j<nj; j++){
			for(var i=0; i<ni; i++){
				if(palette.length === numberofcolors){
					break;
				}else{
					idx = Math.floor( ((j+1)*vy) * imgd.width + ((i+1)*vx) ) * 4;
					palette.push( { r:imgd.data[idx], g:imgd.data[idx+1], b:imgd.data[idx+2], a:imgd.data[idx+3] } );
				}
			}
		}
		return palette;
	},// End of samplepalette2()

	// Generating a palette with numberofcolors
	this.generatepalette = function(numberofcolors){
		var palette = [], rcnt, gcnt, bcnt;
		if(numberofcolors<8){

			// Grayscale
			var graystep = Math.floor(255/(numberofcolors-1));
			for(var i=0; i<numberofcolors; i++){ palette.push({ r:i*graystep, g:i*graystep, b:i*graystep, a:255 }); }

		}else{

			// RGB color cube
			var colorqnum = Math.floor(Math.pow(numberofcolors, 1/3)), // Number of points on each edge on the RGB color cube
				colorstep = Math.floor(255/(colorqnum-1)), // distance between points
				rndnum = numberofcolors - colorqnum*colorqnum*colorqnum; // number of random colors

			for(rcnt=0; rcnt<colorqnum; rcnt++){
				for(gcnt=0; gcnt<colorqnum; gcnt++){
					for(bcnt=0; bcnt<colorqnum; bcnt++){
						palette.push( { r:rcnt*colorstep, g:gcnt*colorstep, b:bcnt*colorstep, a:255 } );
					}// End of blue loop
				}// End of green loop
			}// End of red loop

			// Rest is random
			for(rcnt=0; rcnt<rndnum; rcnt++){ palette.push({ r:Math.floor(Math.random()*255), g:Math.floor(Math.random()*255), b:Math.floor(Math.random()*255), a:Math.floor(Math.random()*255) }); }

		}// End of numberofcolors check

		return palette;
	},// End of generatepalette()

	// 2. Layer separation and edge detection
	// Edge node types ( ▓: this layer or 1; ░: not this layer or 0 )
	// 12  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓
	// 48  ░░  ░░  ░░  ░░  ░▓  ░▓  ░▓  ░▓  ▓░  ▓░  ▓░  ▓░  ▓▓  ▓▓  ▓▓  ▓▓
	//     0   1   2   3   4   5   6   7   8   9   10  11  12  13  14  15
	this.layering = function(ii){
		// Creating layers for each indexed color in arr
		var layers = [], val=0, ah = ii.array.length, aw = ii.array[0].length, n1,n2,n3,n4,n5,n6,n7,n8, i, j, k;

		// Create layers
		for(k=0; k<ii.palette.length; k++){
			layers[k] = [];
			for(j=0; j<ah; j++){
				layers[k][j] = [];
				for(i=0; i<aw; i++){
					layers[k][j][i]=0;
				}
			}
		}

		// Looping through all pixels and calculating edge node type
		for(j=1; j<ah-1; j++){
			for(i=1; i<aw-1; i++){

				// This pixel's indexed color
				val = ii.array[j][i];

				// Are neighbor pixel colors the same?
				n1 = ii.array[j-1][i-1]===val ? 1 : 0;
				n2 = ii.array[j-1][i  ]===val ? 1 : 0;
				n3 = ii.array[j-1][i+1]===val ? 1 : 0;
				n4 = ii.array[j  ][i-1]===val ? 1 : 0;
				n5 = ii.array[j  ][i+1]===val ? 1 : 0;
				n6 = ii.array[j+1][i-1]===val ? 1 : 0;
				n7 = ii.array[j+1][i  ]===val ? 1 : 0;
				n8 = ii.array[j+1][i+1]===val ? 1 : 0;

				// this pixel's type and looking back on previous pixels
				layers[val][j+1][i+1] = 1 + n5 * 2 + n8 * 4 + n7 * 8 ;
				if(!n4){ layers[val][j+1][i  ] = 0 + 2 + n7 * 4 + n6 * 8 ; }
				if(!n2){ layers[val][j  ][i+1] = 0 + n3*2 + n5 * 4 + 8 ; }
				if(!n1){ layers[val][j  ][i  ] = 0 + n2*2 + 4 + n4 * 8 ; }

			}// End of i loop
		}// End of j loop

		return layers;
	},// End of layering()

	// 2. Layer separation and edge detection
	// Edge node types ( ▓: this layer or 1; ░: not this layer or 0 )
	// 12  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓
	// 48  ░░  ░░  ░░  ░░  ░▓  ░▓  ░▓  ░▓  ▓░  ▓░  ▓░  ▓░  ▓▓  ▓▓  ▓▓  ▓▓
	//     0   1   2   3   4   5   6   7   8   9   10  11  12  13  14  15
	this.layeringstep = function(ii,cnum){
		// Creating layers for each indexed color in arr
		var layer = [], val=0, ah = ii.array.length, aw = ii.array[0].length, n1,n2,n3,n4,n5,n6,n7,n8, i, j, k;

		// Create layer
		for(j=0; j<ah; j++){
			layer[j] = [];
			for(i=0; i<aw; i++){
				layer[j][i]=0;
			}
		}

		// Looping through all pixels and calculating edge node type
		for(j=1; j<ah; j++){
			for(i=1; i<aw; i++){
				layer[j][i] =
					( ii.array[j-1][i-1]===cnum ? 1 : 0 ) +
					( ii.array[j-1][i]===cnum ? 2 : 0 ) +
					( ii.array[j][i-1]===cnum ? 8 : 0 ) +
					( ii.array[j][i]===cnum ? 4 : 0 )
				;
			}// End of i loop
		}// End of j loop

		return layer;
	},// End of layeringstep()

	// Point in polygon test
	this.pointinpoly = function( p, pa ){
		var isin=false;

		for(var i=0,j=pa.length-1; i<pa.length; j=i++){
			isin =
				( ((pa[i].y > p.y) !== (pa[j].y > p.y)) && (p.x < (pa[j].x - pa[i].x) * (p.y - pa[i].y) / (pa[j].y - pa[i].y) + pa[i].x) )
				? !isin : isin;
		}

		return isin;
	},

	// Lookup tables for pathscan
	// pathscan_combined_lookup[ arr[py][px] ][ dir ] = [nextarrpypx, nextdir, deltapx, deltapy];
	this.pathscan_combined_lookup = [
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1]],// arr[py][px]===0 is invalid
		[[ 0, 1, 0,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 2,-1, 0]],
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 1, 0,-1], [ 0, 0, 1, 0]],
		[[ 0, 0, 1, 0], [-1,-1,-1,-1], [ 0, 2,-1, 0], [-1,-1,-1,-1]],

		[[-1,-1,-1,-1], [ 0, 0, 1, 0], [ 0, 3, 0, 1], [-1,-1,-1,-1]],
		[[13, 3, 0, 1], [13, 2,-1, 0], [ 7, 1, 0,-1], [ 7, 0, 1, 0]],
		[[-1,-1,-1,-1], [ 0, 1, 0,-1], [-1,-1,-1,-1], [ 0, 3, 0, 1]],
		[[ 0, 3, 0, 1], [ 0, 2,-1, 0], [-1,-1,-1,-1], [-1,-1,-1,-1]],

		[[ 0, 3, 0, 1], [ 0, 2,-1, 0], [-1,-1,-1,-1], [-1,-1,-1,-1]],
		[[-1,-1,-1,-1], [ 0, 1, 0,-1], [-1,-1,-1,-1], [ 0, 3, 0, 1]],
		[[11, 1, 0,-1], [14, 0, 1, 0], [14, 3, 0, 1], [11, 2,-1, 0]],
		[[-1,-1,-1,-1], [ 0, 0, 1, 0], [ 0, 3, 0, 1], [-1,-1,-1,-1]],

		[[ 0, 0, 1, 0], [-1,-1,-1,-1], [ 0, 2,-1, 0], [-1,-1,-1,-1]],
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 1, 0,-1], [ 0, 0, 1, 0]],
		[[ 0, 1, 0,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 2,-1, 0]],
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1]]// arr[py][px]===15 is invalid
	],

	// 3. Walking through an edge node array, discarding edge node types 0 and 15 and creating paths from the rest.
	// Walk directions (dir): 0 > ; 1 ^ ; 2 < ; 3 v
	this.pathscan = function( arr, pathomit ){
		var paths=[], pacnt=0, pcnt=0, px=0, py=0, w = arr[0].length, h = arr.length,
			dir=0, pathfinished=true, holepath=false, lookuprow;

		for(var j=0; j<h; j++){
			for(var i=0; i<w; i++){
				if( (arr[j][i] == 4) || ( arr[j][i] == 11) ){ // Other values are not valid

					// Init
					px = i; py = j;
					paths[pacnt] = {};
					paths[pacnt].points = [];
					paths[pacnt].boundingbox = [px,py,px,py];
					paths[pacnt].holechildren = [];
					pathfinished = false;
					pcnt=0;
					holepath = (arr[j][i]==11);
					dir = 1;

					// Path points loop
					while(!pathfinished){

						// New path point
						paths[pacnt].points[pcnt] = {};
						paths[pacnt].points[pcnt].x = px-1;
						paths[pacnt].points[pcnt].y = py-1;
						paths[pacnt].points[pcnt].t = arr[py][px];

						// Bounding box
						if( (px-1) < paths[pacnt].boundingbox[0] ){ paths[pacnt].boundingbox[0] = px-1; }
						if( (px-1) > paths[pacnt].boundingbox[2] ){ paths[pacnt].boundingbox[2] = px-1; }
						if( (py-1) < paths[pacnt].boundingbox[1] ){ paths[pacnt].boundingbox[1] = py-1; }
						if( (py-1) > paths[pacnt].boundingbox[3] ){ paths[pacnt].boundingbox[3] = py-1; }

						// Next: look up the replacement, direction and coordinate changes = clear this cell, turn if required, walk forward
						lookuprow = _this.pathscan_combined_lookup[ arr[py][px] ][ dir ];
						arr[py][px] = lookuprow[0]; dir = lookuprow[1]; px += lookuprow[2]; py += lookuprow[3];

						// Close path
						if( (px-1 === paths[pacnt].points[0].x ) && ( py-1 === paths[pacnt].points[0].y ) ){
							pathfinished = true;

							// Discarding paths shorter than pathomit
							if( paths[pacnt].points.length < pathomit ){
								paths.pop();
							}else{

								paths[pacnt].isholepath = holepath ? true : false;

								// Finding the parent shape for this hole
								if(holepath){

									var parentidx = 0, parentbbox = [-1,-1,w+1,h+1];
									for(var parentcnt=0; parentcnt < pacnt; parentcnt++){
										if( (!paths[parentcnt].isholepath) &&
											_this.boundingboxincludes( paths[parentcnt].boundingbox , paths[pacnt].boundingbox ) &&
											_this.boundingboxincludes( parentbbox , paths[parentcnt].boundingbox ) &&
											_this.pointinpoly( paths[pacnt].points[0], paths[parentcnt].points )
										){
											parentidx = parentcnt;
											parentbbox = paths[parentcnt].boundingbox;
										}
									}

									paths[parentidx].holechildren.push( pacnt );

								}// End of holepath parent finding

								pacnt++;

							}

						}// End of Close path

						pcnt++;

					}// End of Path points loop

				}// End of Follow path

			}// End of i loop
		}// End of j loop

		return paths;
	},// End of pathscan()

	this.boundingboxincludes = function( parentbbox, childbbox ){
		return ( ( parentbbox[0] < childbbox[0] ) && ( parentbbox[1] < childbbox[1] ) && ( parentbbox[2] > childbbox[2] ) && ( parentbbox[3] > childbbox[3] ) );
	},// End of boundingboxincludes()

	// 3. Batch pathscan
	this.batchpathscan = function( layers, pathomit ){
		var bpaths = [];
		for(var k in layers){
			if(!layers.hasOwnProperty(k)){ continue; }
			bpaths[k] = _this.pathscan( layers[k], pathomit );
		}
		return bpaths;
	},

	// 4. interpollating between path points for nodes with 8 directions ( East, SouthEast, S, SW, W, NW, N, NE )
	this.internodes = function( paths, options ){
		var ins = [], palen=0, nextidx=0, nextidx2=0, previdx=0, previdx2=0, pacnt, pcnt;

		// paths loop
		for(pacnt=0; pacnt<paths.length; pacnt++){

			ins[pacnt] = {};
			ins[pacnt].points = [];
			ins[pacnt].boundingbox = paths[pacnt].boundingbox;
			ins[pacnt].holechildren = paths[pacnt].holechildren;
			ins[pacnt].isholepath = paths[pacnt].isholepath;
			palen = paths[pacnt].points.length;

			// pathpoints loop
			for(pcnt=0; pcnt<palen; pcnt++){

				// next and previous point indexes
				nextidx = (pcnt+1)%palen; nextidx2 = (pcnt+2)%palen; previdx = (pcnt-1+palen)%palen; previdx2 = (pcnt-2+palen)%palen;

				// right angle enhance
				if( options.rightangleenhance && _this.testrightangle( paths[pacnt], previdx2, previdx, pcnt, nextidx, nextidx2 ) ){

					// Fix previous direction
					if(ins[pacnt].points.length > 0){
						ins[pacnt].points[ ins[pacnt].points.length-1 ].linesegment = _this.getdirection(
								ins[pacnt].points[ ins[pacnt].points.length-1 ].x,
								ins[pacnt].points[ ins[pacnt].points.length-1 ].y,
								paths[pacnt].points[pcnt].x,
								paths[pacnt].points[pcnt].y
							);
					}

					// This corner point
					ins[pacnt].points.push({
						x : paths[pacnt].points[pcnt].x,
						y : paths[pacnt].points[pcnt].y,
						linesegment : _this.getdirection(
								paths[pacnt].points[pcnt].x,
								paths[pacnt].points[pcnt].y,
								(( paths[pacnt].points[pcnt].x + paths[pacnt].points[nextidx].x ) /2),
								(( paths[pacnt].points[pcnt].y + paths[pacnt].points[nextidx].y ) /2)
							)
					});

				}// End of right angle enhance

				// interpolate between two path points
				ins[pacnt].points.push({
					x : (( paths[pacnt].points[pcnt].x + paths[pacnt].points[nextidx].x ) /2),
					y : (( paths[pacnt].points[pcnt].y + paths[pacnt].points[nextidx].y ) /2),
					linesegment : _this.getdirection(
							(( paths[pacnt].points[pcnt].x + paths[pacnt].points[nextidx].x ) /2),
							(( paths[pacnt].points[pcnt].y + paths[pacnt].points[nextidx].y ) /2),
							(( paths[pacnt].points[nextidx].x + paths[pacnt].points[nextidx2].x ) /2),
							(( paths[pacnt].points[nextidx].y + paths[pacnt].points[nextidx2].y ) /2)
						)
				});

			}// End of pathpoints loop

		}// End of paths loop

		return ins;
	},// End of internodes()

	this.testrightangle = function( path, idx1, idx2, idx3, idx4, idx5 ){
		return ( (( path.points[idx3].x === path.points[idx1].x) &&
				  ( path.points[idx3].x === path.points[idx2].x) &&
				  ( path.points[idx3].y === path.points[idx4].y) &&
				  ( path.points[idx3].y === path.points[idx5].y)
				 ) ||
				 (( path.points[idx3].y === path.points[idx1].y) &&
				  ( path.points[idx3].y === path.points[idx2].y) &&
				  ( path.points[idx3].x === path.points[idx4].x) &&
				  ( path.points[idx3].x === path.points[idx5].x)
				 )
		);
	},// End of testrightangle()

	this.getdirection = function( x1, y1, x2, y2 ){
		var val = 8;
		if(x1 < x2){
			if     (y1 < y2){ val = 1; }// SouthEast
			else if(y1 > y2){ val = 7; }// NE
			else            { val = 0; }// E
		}else if(x1 > x2){
			if     (y1 < y2){ val = 3; }// SW
			else if(y1 > y2){ val = 5; }// NW
			else            { val = 4; }// W
		}else{
			if     (y1 < y2){ val = 2; }// S
			else if(y1 > y2){ val = 6; }// N
			else            { val = 8; }// center, this should not happen
		}
		return val;
	},// End of getdirection()

	// 4. Batch interpollation
	this.batchinternodes = function( bpaths, options ){
		var binternodes = [];
		for (var k in bpaths) {
			if(!bpaths.hasOwnProperty(k)){ continue; }
			binternodes[k] = _this.internodes(bpaths[k], options);
		}
		return binternodes;
	},

	// 5. tracepath() : recursively trying to fit straight and quadratic spline segments on the 8 direction internode path

	// 5.1. Find sequences of points with only 2 segment types
	// 5.2. Fit a straight line on the sequence
	// 5.3. If the straight line fails (distance error > ltres), find the point with the biggest error
	// 5.4. Fit a quadratic spline through errorpoint (project this to get controlpoint), then measure errors on every point in the sequence
	// 5.5. If the spline fails (distance error > qtres), find the point with the biggest error, set splitpoint = fitting point
	// 5.6. Split sequence and recursively apply 5.2. - 5.6. to startpoint-splitpoint and splitpoint-endpoint sequences

	this.tracepath = function( path, ltres, qtres ){
		var pcnt=0, segtype1, segtype2, seqend, smp = {};
		smp.segments = [];
		smp.boundingbox = path.boundingbox;
		smp.holechildren = path.holechildren;
		smp.isholepath = path.isholepath;

		while(pcnt < path.points.length){
			// 5.1. Find sequences of points with only 2 segment types
			segtype1 = path.points[pcnt].linesegment; segtype2 = -1; seqend=pcnt+1;
			while(
				((path.points[seqend].linesegment === segtype1) || (path.points[seqend].linesegment === segtype2) || (segtype2 === -1))
				&& (seqend < path.points.length-1) ){

				if((path.points[seqend].linesegment!==segtype1) && (segtype2===-1)){ segtype2 = path.points[seqend].linesegment; }
				seqend++;

			}
			if(seqend === path.points.length-1){ seqend = 0; }

			// 5.2. - 5.6. Split sequence and recursively apply 5.2. - 5.6. to startpoint-splitpoint and splitpoint-endpoint sequences
			smp.segments = smp.segments.concat( _this.fitseq(path, ltres, qtres, pcnt, seqend) );

			// forward pcnt;
			if(seqend>0){ pcnt = seqend; }else{ pcnt = path.points.length; }

		}// End of pcnt loop

		return smp;
	},// End of tracepath()

	// 5.2. - 5.6. recursively fitting a straight or quadratic line segment on this sequence of path nodes,
	// called from tracepath()
	this.fitseq = function( path, ltres, qtres, seqstart, seqend ){
		// return if invalid seqend
		if( (seqend>path.points.length) || (seqend<0) ){ return []; }
		// variables
		var errorpoint=seqstart, errorval=0, curvepass=true, px, py, dist2;
		var tl = (seqend-seqstart); if(tl<0){ tl += path.points.length; }
		var vx = (path.points[seqend].x-path.points[seqstart].x) / tl,
			vy = (path.points[seqend].y-path.points[seqstart].y) / tl;

		// 5.2. Fit a straight line on the sequence
		var pcnt = (seqstart+1) % path.points.length, pl;
		while(pcnt != seqend){
			pl = pcnt-seqstart; if(pl<0){ pl += path.points.length; }
			px = path.points[seqstart].x + vx * pl; py = path.points[seqstart].y + vy * pl;
			dist2 = (path.points[pcnt].x-px)*(path.points[pcnt].x-px) + (path.points[pcnt].y-py)*(path.points[pcnt].y-py);
			if(dist2>ltres){curvepass=false;}
			if(dist2>errorval){ errorpoint=pcnt; errorval=dist2; }
			pcnt = (pcnt+1)%path.points.length;
		}
		// return straight line if fits
		if(curvepass){ return [{ type:'L', x1:path.points[seqstart].x, y1:path.points[seqstart].y, x2:path.points[seqend].x, y2:path.points[seqend].y }]; }

		// 5.3. If the straight line fails (distance error>ltres), find the point with the biggest error
		var fitpoint = errorpoint; curvepass = true; errorval = 0;

		// 5.4. Fit a quadratic spline through this point, measure errors on every point in the sequence
		// helpers and projecting to get control point
		var t=(fitpoint-seqstart)/tl, t1=(1-t)*(1-t), t2=2*(1-t)*t, t3=t*t;
		var cpx = (t1*path.points[seqstart].x + t3*path.points[seqend].x - path.points[fitpoint].x)/-t2 ,
			cpy = (t1*path.points[seqstart].y + t3*path.points[seqend].y - path.points[fitpoint].y)/-t2 ;

		// Check every point
		pcnt = seqstart+1;
		while(pcnt != seqend){
			t=(pcnt-seqstart)/tl; t1=(1-t)*(1-t); t2=2*(1-t)*t; t3=t*t;
			px = t1 * path.points[seqstart].x + t2 * cpx + t3 * path.points[seqend].x;
			py = t1 * path.points[seqstart].y + t2 * cpy + t3 * path.points[seqend].y;

			dist2 = (path.points[pcnt].x-px)*(path.points[pcnt].x-px) + (path.points[pcnt].y-py)*(path.points[pcnt].y-py);

			if(dist2>qtres){curvepass=false;}
			if(dist2>errorval){ errorpoint=pcnt; errorval=dist2; }
			pcnt = (pcnt+1)%path.points.length;
		}
		// return spline if fits
		if(curvepass){ return [{ type:'Q', x1:path.points[seqstart].x, y1:path.points[seqstart].y, x2:cpx, y2:cpy, x3:path.points[seqend].x, y3:path.points[seqend].y }]; }
		// 5.5. If the spline fails (distance error>qtres), find the point with the biggest error
		var splitpoint = fitpoint; // Earlier: Math.floor((fitpoint + errorpoint)/2);

		// 5.6. Split sequence and recursively apply 5.2. - 5.6. to startpoint-splitpoint and splitpoint-endpoint sequences
		return _this.fitseq( path, ltres, qtres, seqstart, splitpoint ).concat(
				_this.fitseq( path, ltres, qtres, splitpoint, seqend ) );

	},// End of fitseq()

	// 5. Batch tracing paths
	this.batchtracepaths = function(internodepaths,ltres,qtres){
		var btracedpaths = [];
		for(var k in internodepaths){
			if(!internodepaths.hasOwnProperty(k)){ continue; }
			btracedpaths.push( _this.tracepath(internodepaths[k],ltres,qtres) );
		}
		return btracedpaths;
	},

	// 5. Batch tracing layers
	this.batchtracelayers = function(binternodes, ltres, qtres){
		var btbis = [];
		for(var k in binternodes){
			if(!binternodes.hasOwnProperty(k)){ continue; }
			btbis[k] = _this.batchtracepaths(binternodes[k], ltres, qtres);
		}
		return btbis;
	},

	////////////////////////////////////////////////////////////
	//
	//  SVG Drawing functions
	//
	////////////////////////////////////////////////////////////

	// Rounding to given decimals https://stackoverflow.com/questions/11832914/round-to-at-most-2-decimal-places-in-javascript
	this.roundtodec = function(val,places){ return +val.toFixed(places); },

	// Getting SVG path element string from a traced path
	this.svgpathstring = function( tracedata, lnum, pathnum, options ){

		var layer = tracedata.layers[lnum], smp = layer[pathnum], str='', pcnt;

		// Line filter
		if(options.linefilter && (smp.segments.length < 3)){ return str; }

		// Starting path element, desc contains layer and path number
		str = '<path '+
			( options.desc ? ('desc="l '+lnum+' p '+pathnum+'" ') : '' ) +
			_this.tosvgcolorstr(tracedata.palette[lnum], options) +
			'd="';

		// Creating non-hole path string
		if( options.roundcoords === -1 ){
			str += 'M '+ smp.segments[0].x1 * options.scale +' '+ smp.segments[0].y1 * options.scale +' ';
			for(pcnt=0; pcnt<smp.segments.length; pcnt++){
				str += smp.segments[pcnt].type +' '+ smp.segments[pcnt].x2 * options.scale +' '+ smp.segments[pcnt].y2 * options.scale +' ';
				if(smp.segments[pcnt].hasOwnProperty('x3')){
					str += smp.segments[pcnt].x3 * options.scale +' '+ smp.segments[pcnt].y3 * options.scale +' ';
				}
			}
			str += 'Z ';
		}else{
			str += 'M '+ _this.roundtodec( smp.segments[0].x1 * options.scale, options.roundcoords ) +' '+ _this.roundtodec( smp.segments[0].y1 * options.scale, options.roundcoords ) +' ';
			for(pcnt=0; pcnt<smp.segments.length; pcnt++){
				str += smp.segments[pcnt].type +' '+ _this.roundtodec( smp.segments[pcnt].x2 * options.scale, options.roundcoords ) +' '+ _this.roundtodec( smp.segments[pcnt].y2 * options.scale, options.roundcoords ) +' ';
				if(smp.segments[pcnt].hasOwnProperty('x3')){
					str += _this.roundtodec( smp.segments[pcnt].x3 * options.scale, options.roundcoords ) +' '+ _this.roundtodec( smp.segments[pcnt].y3 * options.scale, options.roundcoords ) +' ';
				}
			}
			str += 'Z ';
		}// End of creating non-hole path string

		// Hole children
		for( var hcnt=0; hcnt < smp.holechildren.length; hcnt++){
			var hsmp = layer[ smp.holechildren[hcnt] ];
			// Creating hole path string
			if( options.roundcoords === -1 ){

				if(hsmp.segments[ hsmp.segments.length-1 ].hasOwnProperty('x3')){
					str += 'M '+ hsmp.segments[ hsmp.segments.length-1 ].x3 * options.scale +' '+ hsmp.segments[ hsmp.segments.length-1 ].y3 * options.scale +' ';
				}else{
					str += 'M '+ hsmp.segments[ hsmp.segments.length-1 ].x2 * options.scale +' '+ hsmp.segments[ hsmp.segments.length-1 ].y2 * options.scale +' ';
				}

				for(pcnt = hsmp.segments.length-1; pcnt >= 0; pcnt--){
					str += hsmp.segments[pcnt].type +' ';
					if(hsmp.segments[pcnt].hasOwnProperty('x3')){
						str += hsmp.segments[pcnt].x2 * options.scale +' '+ hsmp.segments[pcnt].y2 * options.scale +' ';
					}

					str += hsmp.segments[pcnt].x1 * options.scale +' '+ hsmp.segments[pcnt].y1 * options.scale +' ';
				}

			}else{

				if(hsmp.segments[ hsmp.segments.length-1 ].hasOwnProperty('x3')){
					str += 'M '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].x3 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].y3 * options.scale ) +' ';
				}else{
					str += 'M '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].x2 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].y2 * options.scale ) +' ';
				}

				for(pcnt = hsmp.segments.length-1; pcnt >= 0; pcnt--){
					str += hsmp.segments[pcnt].type +' ';
					if(hsmp.segments[pcnt].hasOwnProperty('x3')){
						str += _this.roundtodec( hsmp.segments[pcnt].x2 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[pcnt].y2 * options.scale ) +' ';
					}
					str += _this.roundtodec( hsmp.segments[pcnt].x1 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[pcnt].y1 * options.scale ) +' ';
				}


			}// End of creating hole path string

			str += 'Z '; // Close path

		}// End of holepath check

		// Closing path element
		str += '" />';

		// Rendering control points
		if(options.lcpr || options.qcpr){
			for(pcnt=0; pcnt<smp.segments.length; pcnt++){
				if( smp.segments[pcnt].hasOwnProperty('x3') && options.qcpr ){
					str += '<circle cx="'+ smp.segments[pcnt].x2 * options.scale +'" cy="'+ smp.segments[pcnt].y2 * options.scale +'" r="'+ options.qcpr +'" fill="cyan" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
					str += '<circle cx="'+ smp.segments[pcnt].x3 * options.scale +'" cy="'+ smp.segments[pcnt].y3 * options.scale +'" r="'+ options.qcpr +'" fill="white" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
					str += '<line x1="'+ smp.segments[pcnt].x1 * options.scale +'" y1="'+ smp.segments[pcnt].y1 * options.scale +'" x2="'+ smp.segments[pcnt].x2 * options.scale +'" y2="'+ smp.segments[pcnt].y2 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
					str += '<line x1="'+ smp.segments[pcnt].x2 * options.scale +'" y1="'+ smp.segments[pcnt].y2 * options.scale +'" x2="'+ smp.segments[pcnt].x3 * options.scale +'" y2="'+ smp.segments[pcnt].y3 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
				}
				if( (!smp.segments[pcnt].hasOwnProperty('x3')) && options.lcpr){
					str += '<circle cx="'+ smp.segments[pcnt].x2 * options.scale +'" cy="'+ smp.segments[pcnt].y2 * options.scale +'" r="'+ options.lcpr +'" fill="white" stroke-width="'+ options.lcpr * 0.2 +'" stroke="black" />';
				}
			}

			// Hole children control points
			for( var hcnt=0; hcnt < smp.holechildren.length; hcnt++){
				var hsmp = layer[ smp.holechildren[hcnt] ];
				for(pcnt=0; pcnt<hsmp.segments.length; pcnt++){
					if( hsmp.segments[pcnt].hasOwnProperty('x3') && options.qcpr ){
						str += '<circle cx="'+ hsmp.segments[pcnt].x2 * options.scale +'" cy="'+ hsmp.segments[pcnt].y2 * options.scale +'" r="'+ options.qcpr +'" fill="cyan" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
						str += '<circle cx="'+ hsmp.segments[pcnt].x3 * options.scale +'" cy="'+ hsmp.segments[pcnt].y3 * options.scale +'" r="'+ options.qcpr +'" fill="white" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
						str += '<line x1="'+ hsmp.segments[pcnt].x1 * options.scale +'" y1="'+ hsmp.segments[pcnt].y1 * options.scale +'" x2="'+ hsmp.segments[pcnt].x2 * options.scale +'" y2="'+ hsmp.segments[pcnt].y2 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
						str += '<line x1="'+ hsmp.segments[pcnt].x2 * options.scale +'" y1="'+ hsmp.segments[pcnt].y2 * options.scale +'" x2="'+ hsmp.segments[pcnt].x3 * options.scale +'" y2="'+ hsmp.segments[pcnt].y3 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
					}
					if( (!hsmp.segments[pcnt].hasOwnProperty('x3')) && options.lcpr){
						str += '<circle cx="'+ hsmp.segments[pcnt].x2 * options.scale +'" cy="'+ hsmp.segments[pcnt].y2 * options.scale +'" r="'+ options.lcpr +'" fill="white" stroke-width="'+ options.lcpr * 0.2 +'" stroke="black" />';
					}
				}
			}
		}// End of Rendering control points

		return str;

	},// End of svgpathstring()

	// Converting tracedata to an SVG string
	this.getsvgstring = function( tracedata, options ){

		options = _this.checkoptions(options);

		var w = tracedata.width * options.scale, h = tracedata.height * options.scale;

		// SVG start
		var svgstr = '<svg ' + (options.viewbox ? ('viewBox="0 0 '+w+' '+h+'" ') : ('width="'+w+'" height="'+h+'" ')) +
			'version="1.1" xmlns="http://www.w3.org/2000/svg" desc="Created with imagetracer.js version '+_this.versionnumber+'" >';

		// Drawing: Layers and Paths loops
		for(var lcnt=0; lcnt < tracedata.layers.length; lcnt++){
			for(var pcnt=0; pcnt < tracedata.layers[lcnt].length; pcnt++){

				// Adding SVG <path> string
				if( !tracedata.layers[lcnt][pcnt].isholepath ){
					svgstr += _this.svgpathstring( tracedata, lcnt, pcnt, options );
				}

			}// End of paths loop
		}// End of layers loop

		// SVG End
		svgstr+='</svg>';

		return svgstr;

	},// End of getsvgstring()

	// Comparator for numeric Array.sort
	this.compareNumbers = function(a,b){ return a - b; },

	// Convert color object to rgba string
	this.torgbastr = function(c){ return 'rgba('+c.r+','+c.g+','+c.b+','+c.a+')'; },

	// Convert color object to SVG color string
	this.tosvgcolorstr = function(c, options){
		return 'fill="rgb('+c.r+','+c.g+','+c.b+')" stroke="rgb('+c.r+','+c.g+','+c.b+')" stroke-width="'+options.strokewidth+'" opacity="'+c.a/255.0+'" ';
	},

	// Helper function: Appending an <svg> element to a container from an svgstring
	this.appendSVGString = function(svgstr,parentid){
		var div;
		if(parentid){
			div = document.getElementById(parentid);
			if(!div){
				div = document.createElement('div');
				div.id = parentid;
				document.body.appendChild(div);
			}
		}else{
			div = document.createElement('div');
			document.body.appendChild(div);
		}
		div.innerHTML += svgstr;
	},

	////////////////////////////////////////////////////////////
	//
	//  Canvas functions
	//
	////////////////////////////////////////////////////////////

	// Gaussian kernels for blur
	this.gks = [ [0.27901,0.44198,0.27901], [0.135336,0.228569,0.272192,0.228569,0.135336], [0.086776,0.136394,0.178908,0.195843,0.178908,0.136394,0.086776],
	             [0.063327,0.093095,0.122589,0.144599,0.152781,0.144599,0.122589,0.093095,0.063327], [0.049692,0.069304,0.089767,0.107988,0.120651,0.125194,0.120651,0.107988,0.089767,0.069304,0.049692] ],

	// Selective Gaussian blur for preprocessing
	this.blur = function(imgd,radius,delta){
		var i,j,k,d,idx,racc,gacc,bacc,aacc,wacc;

		// new ImageData
		var imgd2 = { width:imgd.width, height:imgd.height, data:[] };

		// radius and delta limits, this kernel
		radius = Math.floor(radius); if(radius<1){ return imgd; } if(radius>5){ radius = 5; } delta = Math.abs( delta ); if(delta>1024){ delta = 1024; }
		var thisgk = _this.gks[radius-1];

		// loop through all pixels, horizontal blur
		for( j=0; j < imgd.height; j++ ){
			for( i=0; i < imgd.width; i++ ){

				racc = 0; gacc = 0; bacc = 0; aacc = 0; wacc = 0;
				// gauss kernel loop
				for( k = -radius; k < radius+1; k++){
					// add weighted color values
					if( (i+k > 0) && (i+k < imgd.width) ){
						idx = (j*imgd.width+i+k)*4;
						racc += imgd.data[idx  ] * thisgk[k+radius];
						gacc += imgd.data[idx+1] * thisgk[k+radius];
						bacc += imgd.data[idx+2] * thisgk[k+radius];
						aacc += imgd.data[idx+3] * thisgk[k+radius];
						wacc += thisgk[k+radius];
					}
				}
				// The new pixel
				idx = (j*imgd.width+i)*4;
				imgd2.data[idx  ] = Math.floor(racc / wacc);
				imgd2.data[idx+1] = Math.floor(gacc / wacc);
				imgd2.data[idx+2] = Math.floor(bacc / wacc);
				imgd2.data[idx+3] = Math.floor(aacc / wacc);

			}// End of width loop
		}// End of horizontal blur

		// copying the half blurred imgd2
		var himgd = new Uint8ClampedArray(imgd2.data);

		// loop through all pixels, vertical blur
		for( j=0; j < imgd.height; j++ ){
			for( i=0; i < imgd.width; i++ ){

				racc = 0; gacc = 0; bacc = 0; aacc = 0; wacc = 0;
				// gauss kernel loop
				for( k = -radius; k < radius+1; k++){
					// add weighted color values
					if( (j+k > 0) && (j+k < imgd.height) ){
						idx = ((j+k)*imgd.width+i)*4;
						racc += himgd[idx  ] * thisgk[k+radius];
						gacc += himgd[idx+1] * thisgk[k+radius];
						bacc += himgd[idx+2] * thisgk[k+radius];
						aacc += himgd[idx+3] * thisgk[k+radius];
						wacc += thisgk[k+radius];
					}
				}
				// The new pixel
				idx = (j*imgd.width+i)*4;
				imgd2.data[idx  ] = Math.floor(racc / wacc);
				imgd2.data[idx+1] = Math.floor(gacc / wacc);
				imgd2.data[idx+2] = Math.floor(bacc / wacc);
				imgd2.data[idx+3] = Math.floor(aacc / wacc);

			}// End of width loop
		}// End of vertical blur

		// Selective blur: loop through all pixels
		for( j=0; j < imgd.height; j++ ){
			for( i=0; i < imgd.width; i++ ){

				idx = (j*imgd.width+i)*4;
				// d is the difference between the blurred and the original pixel
				d = Math.abs(imgd2.data[idx  ] - imgd.data[idx  ]) + Math.abs(imgd2.data[idx+1] - imgd.data[idx+1]) +
					Math.abs(imgd2.data[idx+2] - imgd.data[idx+2]) + Math.abs(imgd2.data[idx+3] - imgd.data[idx+3]);
				// selective blur: if d>delta, put the original pixel back
				if(d>delta){
					imgd2.data[idx  ] = imgd.data[idx  ];
					imgd2.data[idx+1] = imgd.data[idx+1];
					imgd2.data[idx+2] = imgd.data[idx+2];
					imgd2.data[idx+3] = imgd.data[idx+3];
				}
			}
		}// End of Selective blur

		return imgd2;

	},// End of blur()

	// Helper function: loading an image from a URL, then executing callback with canvas as argument
	this.loadImage = function(url,callback,options){
		var img = new Image();
		if(options && options.corsenabled){ img.crossOrigin = 'Anonymous'; }
		img.onload = function(){
			var canvas = document.createElement('canvas');
			canvas.width = img.width;
			canvas.height = img.height;
			var context = canvas.getContext('2d');
			context.drawImage(img,0,0);
			callback(canvas);
		};
		img.src = url;
	},

	// Helper function: getting ImageData from a canvas
	this.getImgdata = function(canvas){
		var context = canvas.getContext('2d');
		return context.getImageData(0,0,canvas.width,canvas.height);
	},

	// Special palette to use with drawlayers()
	this.specpalette = [
		{r:0,g:0,b:0,a:255}, {r:128,g:128,b:128,a:255}, {r:0,g:0,b:128,a:255}, {r:64,g:64,b:128,a:255},
		{r:192,g:192,b:192,a:255}, {r:255,g:255,b:255,a:255}, {r:128,g:128,b:192,a:255}, {r:0,g:0,b:192,a:255},
		{r:128,g:0,b:0,a:255}, {r:128,g:64,b:64,a:255}, {r:128,g:0,b:128,a:255}, {r:168,g:168,b:168,a:255},
		{r:192,g:128,b:128,a:255}, {r:192,g:0,b:0,a:255}, {r:255,g:255,b:255,a:255}, {r:0,g:128,b:0,a:255}
	],

	// Helper function: Drawing all edge node layers into a container
	this.drawLayers = function(layers,palette,scale,parentid){
		scale = scale||1;
		var w,h,i,j,k;

		// Preparing container
		var div;
		if(parentid){
			div = document.getElementById(parentid);
			if(!div){
				div = document.createElement('div');
				div.id = parentid;
				document.body.appendChild(div);
			}
		}else{
			div = document.createElement('div');
			document.body.appendChild(div);
		}

		// Layers loop
		for (k in layers) {
			if(!layers.hasOwnProperty(k)){ continue; }

			// width, height
			w=layers[k][0].length; h=layers[k].length;

			// Creating new canvas for every layer
			var canvas = document.createElement('canvas'); canvas.width=w*scale; canvas.height=h*scale;
			var context = canvas.getContext('2d');

			// Drawing
			for(j=0; j<h; j++){
				for(i=0; i<w; i++){
					context.fillStyle = _this.torgbastr(palette[ layers[k][j][i]%palette.length ]);
					context.fillRect(i*scale,j*scale,scale,scale);
				}
			}

			// Appending canvas to container
			div.appendChild(canvas);
		}// End of Layers loop
	}// End of drawlayers

	;// End of function list

}// End of ImageTracer object

// export as AMD module / Node module / browser or worker variable
if(typeof define === 'function' && define.amd){
	define(function() { return new ImageTracer(); });
}else if(typeof module !== 'undefined'){
	module.exports = new ImageTracer();
}else if(typeof self !== 'undefined'){
	self.ImageTracer = new ImageTracer();
}else window.ImageTracer = new ImageTracer();

})();
/* =================== end vendored imagetracerjs =================== */

/* capture the tracer instance in both environments: in Node the lib just
   assigned itself to module.exports (our own exports overwrite that at the
   bottom of this file); in the browser/Tampermonkey it attached to window. */
var IWDIE_TRACER = (typeof module !== 'undefined' && module.exports && module.exports.imagedataToSVG) ? module.exports
  : (typeof window !== 'undefined' && window.ImageTracer && window.ImageTracer.imagedataToSVG) ? window.ImageTracer : null;

/* =============== parameter-selector xlsx export (pure part) ===============
 * Turns the PARAMETER SELECTOR popup's w2ui paramgrid records (the selected
 * regulator's full parameter list — w2ui keeps every row client-side) into
 * the row model consumed by the xlsx writer in the browser body. The writer
 * and this row shape mirror supermarket-superuser's export block; keep the
 * two visually in sync (same style indexes, band layout, autofilter rules).
 */

// Cell style indexes into xlsxStylesXml()'s cellXfs (browser body).
var XLSX_STYLE_DEFAULT = 0;
var XLSX_STYLE_HEADER = 1;   // bold white on blue
var XLSX_STYLE_GROUP = 2;    // bold white on blue band (same look as the header)
var XLSX_STYLE_UNIT = 3;     // bold white on gray-blue (unit band, all-units export)

var IWDIE_PARAM_EXPORT_HEADER = ['Group', 'Unit ID', 'Unit name', 'Alias text', 'Access', 'Eng unit', 'Type', 'Application', 'Tag', 'SGR', 'Driver ID'];
var IWDIE_PARAM_EXPORT_COL_WIDTHS = [22, 18, 30, 46, 16, 10, 12, 16, 14, 8, 38];

function iwdieParamAccessLabel(rw) {
  var value = String(rw || '').trim().toLowerCase();
  if (value === 'rw') return 'Read/write';
  if (value === 'vrw') return 'Read/write (virtual)';
  if (value === 'vr') return 'Read (virtual)';
  if (value === 'r') return 'Read';
  return value;
}

/* rows: [{cells, style?, outline?}] — header row (style 1), then one
 * header-blue collapsible band per parameter group (style 2) with the group's
 * parameters at outlineLevel 1, in grid order. The Group, Unit ID and Unit
 * name columns are repeated on every data row so Excel AutoFilter
 * sorting/filtering keeps working. unitId/unitName are the selected
 * regulator's ID and Name exactly as the UNITS list shows them (V01 /
 * 360.001 Ventilasjon) — id first, name right after it. A row carrying its
 * own unit_id/unit_name wins, so a mixed grid still labels correctly.
 * The three columns are named after the popup's own ALIAS TEXT / UNIT ID /
 * UNIT NAME fields, so Alias text — not Name — heads the parameter text. */
function iwdieBuildParamExportRows(records, unitId, unitName) {
  function clean(v) {
    return String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }
  var fallbackUnitId = clean(unitId);
  var fallbackUnitName = clean(unitName);
  var rows = [{ cells: IWDIE_PARAM_EXPORT_HEADER.slice(), style: XLSX_STYLE_HEADER }];
  var order = [];
  var groups = {};
  (records || []).forEach(function (r) {
    if (!r) return;
    var g = clean(r.group) || '-';
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(r);
  });
  order.forEach(function (groupName) {
    var members = groups[groupName];
    var band = [groupName + ' (' + members.length + ')'];
    while (band.length < IWDIE_PARAM_EXPORT_HEADER.length) band.push('');
    rows.push({ cells: band, style: XLSX_STYLE_GROUP });
    members.forEach(function (r) {
      rows.push({
        cells: [groupName, clean(r.unit_id) || fallbackUnitId, clean(r.unit_name) || fallbackUnitName,
          clean(r.alias_text), iwdieParamAccessLabel(r.rw), clean(r.eng_unit),
          clean(r.data_type), clean(r.application), clean(r.tag), clean(r.sgr), clean(r.driver_id)],
        outline: 1
      });
    });
  });
  return rows;
}

var IWDIE_ALLUNITS_EXPORT_HEADER = ['Unit ID', 'Unit name', 'Group', 'Alias text', 'Access', 'Eng unit', 'Type', 'Application', 'Tag', 'SGR', 'Driver ID'];
var IWDIE_ALLUNITS_COL_WIDTHS = [18, 30, 22, 46, 16, 10, 12, 16, 14, 8, 38];

/* unitBlocks: [{ unitLabel, unitId, unitName, records }] — the whole plant in
 * one sheet with a two-level outline: a gray-blue unit band per unit (collapse
 * a whole unit), header-blue group bands inside it (outline 1), parameters at
 * outline 2. The unit band carries the id in column A and the name plus the
 * parameter count in column B, the same ID / Name split the UNITS list shows.
 * The Unit ID, Unit name and Group columns repeat on every data row so
 * AutoFilter sorting and filtering keep working plant-wide. Units with no
 * parameters are dropped here; the caller reports how many. */
function iwdieBuildAllUnitsExportRows(unitBlocks) {
  function clean(v) {
    return String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }
  function pad(cells) {
    while (cells.length < IWDIE_ALLUNITS_EXPORT_HEADER.length) cells.push('');
    return cells;
  }
  var rows = [{ cells: IWDIE_ALLUNITS_EXPORT_HEADER.slice(), style: XLSX_STYLE_HEADER }];
  (unitBlocks || []).forEach(function (block) {
    var records = (block && block.records) || [];
    if (!records.length) return;
    var blockUnitId = clean(block.unitId);
    var blockUnitName = clean(block.unitName) || clean(block.unitLabel) || '-';
    rows.push({ cells: pad([blockUnitId, blockUnitName + ' (' + records.length + ')']), style: XLSX_STYLE_UNIT });
    var order = [];
    var groups = {};
    records.forEach(function (r) {
      if (!r) return;
      var g = clean(r.group) || '-';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(r);
    });
    order.forEach(function (groupName) {
      var members = groups[groupName];
      rows.push({ cells: pad(['', '', groupName + ' (' + members.length + ')']), style: XLSX_STYLE_GROUP, outline: 1 });
      members.forEach(function (r) {
        rows.push({
          cells: [clean(r.unit_id) || blockUnitId, clean(r.unit_name) || blockUnitName, groupName,
            clean(r.alias_text), iwdieParamAccessLabel(r.rw), clean(r.eng_unit),
            clean(r.data_type), clean(r.application), clean(r.tag), clean(r.sgr), clean(r.driver_id)],
          outline: 2
        });
      });
    });
  });
  return rows;
}

function iwdieBuildParamExportFilename(plantId, unitLabel, now) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  var d = now || new Date();
  var stamp = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  var unit = String(unitLabel || 'unit').replace(/[\\/?*\[\]:]/g, '-').replace(/\s+/g, '-');
  return 'parameters_' + (plantId || 'plant') + '_' + unit + '_' + stamp + '.xlsx';
}

/* ===================== Drawings: the shape model (Draw background, v1.32.0) =====================
   Draw mode (1.32.0 to 1.35.0) drew a list of shapes in panel coordinates and kept
   them, with the untouched picture under them, in chunks of the PNG it made. Edit in
   VectorCraft took its place in 1.36.0. What stays is pure, so node can test it: the
   shape model, its cleaning and its SVG - which the component library, Edit in
   VectorCraft and the .ai export use - and the reading of those chunks, so a
   background drawn in Draw still opens with its shapes. */

/** iTXt keyword of the chunk that holds the drawing as JSON. */
var IWDIE_DRAW_KEYWORD = 'iwdie-draw';
/** Private ancillary chunk with the base picture's own bytes: lowercase first
 *  letter = ancillary, so every viewer skips it; lowercase second = private;
 *  uppercase third = the reserved bit PNG requires; lowercase fourth = safe to copy. */
var IWDIE_DRAW_BASE_CHUNK = 'iwBs';

/** A finite number rounded to 1/100, or null. */
function iwdieDrawNum(v) {
  var n = Number(v);
  return (v !== null && v !== '' && isFinite(n)) ? Math.round(n * 100) / 100 : null;
}

/** A colour the drawing may carry - #rgb or #rrggbb - or null for none. */
function iwdieDrawColor(c) {
  return (typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) ? c.toLowerCase() : null;
}

/** A shape as it may be trusted: a known type, finite numbers, checked colours,
 *  text as text - or null to drop it. The drawing travels inside a picture that
 *  Insert can bring from any file, so it is cleaned on the way in. */
function iwdieDrawShape(s, depth) {
  if (!s || typeof s !== 'object') return null;
  depth = depth || 0;
  var n = iwdieDrawNum, st = (s.st && typeof s.st === 'object') ? s.st : {};
  var style = {
    stroke: iwdieDrawColor(st.stroke), fill: iwdieDrawColor(st.fill),
    sw: Math.max(0, Math.min(60, n(st.sw) || 0)), dash: !!st.dash, arrow: !!st.arrow
  };
  // v1.33.0, for drawings imported from Illustrator: an explicit dash pattern, caps, joins
  if (Array.isArray(st.da)) {
    var da = st.da.slice(0, 12).map(n).filter(function (v) { return v !== null && v >= 0; });
    if (da.length && da.some(function (v) { return v > 0; })) style.da = da;
  }
  if (st.cap === 'round' || st.cap === 'square') style.cap = st.cap;
  if (st.join === 'round' || st.join === 'bevel') style.join = st.join;
  var op = n(st.op);
  if (op !== null && op < 1) style.op = Math.max(0, op);
  if (s.t === 'd') {
    var dd = iwdieDrawCleanD(s.d);
    return dd ? { t: 'd', d: dd, rule: s.rule === 'evenodd' ? 'evenodd' : '', st: style } : null;
  }
  if (s.t === 'group') {
    if (depth > 8) return null;
    var items = (Array.isArray(s.items) ? s.items : []).slice(0, 5000)
      .map(function (c) { return iwdieDrawShape(c, depth + 1); }).filter(Boolean);
    return items.length ? { t: 'group', name: typeof s.name === 'string' ? s.name.slice(0, 80) : '', items: items } : null;
  }
  var pt = function (p) {
    return (Array.isArray(p) && n(p[0]) !== null && n(p[1]) !== null) ? [n(p[0]), n(p[1])] : null;
  };
  if (s.t === 'rect') {
    var x = n(s.x), y = n(s.y), w = n(s.w), h = n(s.h);
    if (x === null || y === null || !(w > 0) || !(h > 0)) return null;
    return { t: 'rect', x: x, y: y, w: w, h: h, rx: Math.max(0, Math.min(1000, n(s.rx) || 0)), st: style };
  }
  if (s.t === 'ellipse') {
    var cx = n(s.cx), cy = n(s.cy), rx = n(s.rx), ry = n(s.ry);
    if (cx === null || cy === null || !(rx > 0) || !(ry > 0)) return null;
    return { t: 'ellipse', cx: cx, cy: cy, rx: rx, ry: ry, st: style };
  }
  if (s.t === 'line') {
    var pts = (Array.isArray(s.pts) ? s.pts : []).slice(0, 5000).map(pt).filter(Boolean);
    if (pts.length < 2) return null;
    return { t: 'line', pts: pts, closed: !!s.closed, st: style };
  }
  if (s.t === 'path') {
    var nodes = (Array.isArray(s.nodes) ? s.nodes : []).slice(0, 5000).map(function (k) {
      if (!k || typeof k !== 'object') return null;
      var kx = n(k.x), ky = n(k.y);
      if (kx === null || ky === null) return null;
      var or = function (a, d) { var q = n(a); return q === null ? d : q; };
      return { x: kx, y: ky, ix: or(k.ix, kx), iy: or(k.iy, ky), ox: or(k.ox, kx), oy: or(k.oy, ky) };
    }).filter(Boolean);
    if (nodes.length < 2) return null;
    return { t: 'path', nodes: nodes, closed: !!s.closed, st: style };
  }
  if (s.t === 'text') {
    var tx = n(s.x), ty = n(s.y), text = (typeof s.text === 'string') ? s.text.slice(0, 500) : '';
    if (tx === null || ty === null || !text.trim()) return null;
    return { t: 'text', x: tx, y: ty, text: text, size: Math.max(4, Math.min(200, n(s.size) || 13)), st: style };
  }
  return null;
}

/** A whole list of shapes, cleaned; anything unusable is left out. */
function iwdieDrawShapes(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20000).map(function (s) { return iwdieDrawShape(s, 0); }).filter(Boolean);
}

/** SVG path data as Draw keeps it: absolute M, L, C and Z only, every number
 *  finite and rounded - rebuilt from its tokens, so nothing else gets through. */
function iwdieDrawCleanD(d) {
  if (typeof d !== 'string' || d.length > 400000) return null;
  var toks = d.match(/[MLCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!toks || toks.join('').length < d.replace(/[\s,]/g, '').length) return null;   // anything else in it
  var need = { M: 2, L: 2, C: 6, Z: 0 }, out = [], i = 0, started = false;
  while (i < toks.length) {
    var c = toks[i++];
    if (!(c in need)) return null;
    if (c !== 'M' && !started) return null;
    started = true;
    var part = c;
    for (var k = 0; k < need[c]; k++) {
      var v = iwdieDrawNum(toks[i++]);
      if (v === null || i > toks.length) return null;
      part += (k ? ' ' : '') + v;
    }
    out.push(part);
  }
  return out.length ? out.join(' ') : null;
}

/** A library's components as they may be trusted. The library is kept in the
 *  browser's storage between sessions, so it is cleaned on the way in, the same
 *  way a drawing is. */
function iwdieDrawLibItems(list) {
  var str = function (v) { return typeof v === 'string' ? v.slice(0, 80) : ''; };
  return (Array.isArray(list) ? list : []).slice(0, 5000).map(function (it) {
    if (!it || typeof it !== 'object') return null;
    var shapes = iwdieDrawShapes(it.shapes);
    if (!shapes.length) return null;
    var w = iwdieDrawNum(it.w), h = iwdieDrawNum(it.h);
    return { name: str(it.name), layer: str(it.layer), w: w > 0 ? w : 0, h: h > 0 ? h : 0, shapes: shapes };
  }).filter(Boolean);
}

function iwdieDrawFmt(v) { return String(Math.round(v * 100) / 100); }

function iwdieDrawEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The id of the arrowhead marker for one colour - one marker per colour, because
 *  a marker cannot take the colour of the line that uses it in every browser. */
function iwdieDrawArrowId(color) { return 'iwdie-arrow-' + String(color || '#000000').replace('#', ''); }

function iwdieDrawMarkerSvg(color) {
  return '<marker id="' + iwdieDrawArrowId(color) + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5"' +
    ' markerUnits="strokeWidth" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + color + '"/></marker>';
}

function iwdieDrawStyleAttrs(st, isText) {
  var op = (typeof st.op === 'number' && st.op < 1) ? ' opacity="' + iwdieDrawFmt(st.op) + '"' : '';
  if (isText) return ' fill="' + (st.fill || 'none') + '"' + op;
  var stroked = !!(st.stroke && st.sw > 0);
  var a = ' fill="' + (st.fill || 'none') + '" stroke="' + (stroked ? st.stroke : 'none') + '"' + op;
  if (stroked) {
    a += ' stroke-width="' + iwdieDrawFmt(st.sw) + '"';
    if (st.da) a += ' stroke-dasharray="' + st.da.map(iwdieDrawFmt).join(' ') + '"';
    else if (st.dash) a += ' stroke-dasharray="' + iwdieDrawFmt(st.sw * 4) + ' ' + iwdieDrawFmt(st.sw * 3) + '"';
    if (st.cap) a += ' stroke-linecap="' + st.cap + '"';
    if (st.join) a += ' stroke-linejoin="' + st.join + '"';
  }
  return a;
}

/** SVG path data for pen nodes: a straight segment where neither end has a handle,
 *  a cubic where either has; closed paths return to the first node. */
function iwdieDrawPathD(nodes, closed) {
  var f = iwdieDrawFmt;
  if (!nodes || !nodes.length) return '';
  var seg = function (a, b) {
    var straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
    return straight ? ' L' + f(b.x) + ' ' + f(b.y)
      : ' C' + f(a.ox) + ' ' + f(a.oy) + ' ' + f(b.ix) + ' ' + f(b.iy) + ' ' + f(b.x) + ' ' + f(b.y);
  };
  var d = 'M' + f(nodes[0].x) + ' ' + f(nodes[0].y);
  for (var i = 1; i < nodes.length; i++) d += seg(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 1) d += seg(nodes[nodes.length - 1], nodes[0]) + ' Z';
  return d;
}

/** One shape as an SVG element. `extra` is appended inside the tag - the editor
 *  adds its data-i there; the picture and the .svg download add nothing. */
function iwdieDrawShapeSvg(s, extra) {
  var f = iwdieDrawFmt, st = s.st;
  extra = extra || '';
  if (s.t === 'group') {
    // the name rides along as data-name, which VectorCraft (and Illustrator) show as the group's name
    return '<g' + (s.name ? ' data-name="' + iwdieDrawEsc(s.name) + '"' : '') + extra + '>' + s.items.map(function (c) { return iwdieDrawShapeSvg(c); }).join('') + '</g>';
  }
  if (s.t === 'image') {
    // a picture of an IWMAC object (v1.43.0), as large as fits its box
    return '<image x="' + f(s.x || 0) + '" y="' + f(s.y || 0) + '" width="' + f(s.w) + '" height="' + f(s.h) + '" preserveAspectRatio="xMidYMid meet" href="' +
      iwdieDrawEsc(s.src) + '"' + extra + '/>';
  }
  if (s.t === 'd') {
    var mk = (st.arrow && st.stroke && st.sw > 0) ? ' marker-end="url(#' + iwdieDrawArrowId(st.stroke) + ')"' : '';
    return '<path d="' + s.d + '"' + (s.rule ? ' fill-rule="evenodd"' : '') + iwdieDrawStyleAttrs(st) + mk + extra + '/>';
  }
  if (s.t === 'rect') {
    return '<rect x="' + f(s.x) + '" y="' + f(s.y) + '" width="' + f(s.w) + '" height="' + f(s.h) + '"' +
      (s.rx > 0 ? ' rx="' + f(s.rx) + '"' : '') + iwdieDrawStyleAttrs(st) + extra + '/>';
  }
  if (s.t === 'ellipse') {
    return '<ellipse cx="' + f(s.cx) + '" cy="' + f(s.cy) + '" rx="' + f(s.rx) + '" ry="' + f(s.ry) + '"' +
      iwdieDrawStyleAttrs(st) + extra + '/>';
  }
  var marker = (st.arrow && !s.closed && st.stroke && st.sw > 0) ? ' marker-end="url(#' + iwdieDrawArrowId(st.stroke) + ')"' : '';
  if (s.t === 'line') {
    return '<' + (s.closed ? 'polygon' : 'polyline') + ' points="' +
      s.pts.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '"' + iwdieDrawStyleAttrs(st) + marker + extra + '/>';
  }
  if (s.t === 'path') {
    return '<path d="' + iwdieDrawPathD(s.nodes, s.closed) + '"' + iwdieDrawStyleAttrs(st) + marker + extra + '/>';
  }
  if (s.t === 'text') {
    return '<text x="' + f(s.x) + '" y="' + f(s.y) + '" font-family="Arial, Helvetica, sans-serif" font-size="' + f(s.size) + '"' +
      (s.bold ? ' font-weight="600"' : '') + iwdieDrawStyleAttrs(st, true) + extra + '>' + iwdieDrawEsc(s.text) + '</text>';
  }
  return '';
}

/** The markers a list of shapes needs, once per arrow colour. */
function iwdieDrawDefsSvg(shapes) {
  var seen = {};
  var walk = function (list) {
    (list || []).forEach(function (s) {
      if (s && s.t === 'group') walk(s.items);
      else if (s && s.st && s.st.arrow && s.st.stroke) seen[s.st.stroke] = 1;
    });
  };
  walk(shapes);
  return Object.keys(seen).map(iwdieDrawMarkerSvg).join('');
}

/** The shape under x' = ax*x + bx, y' = ay*y + by: a move when both a are 1, a
 *  resize otherwise, a mirror when one is negative. Line widths, corner radii and
 *  text sizes do not scale, as in Illustrator by default. */
function iwdieDrawMap(s, ax, bx, ay, by) {
  var N = iwdieDrawNum;
  var X = function (x) { return N(ax * x + bx); }, Y = function (y) { return N(ay * y + by); };
  if (s.t === 'group') {
    return { t: 'group', name: s.name, items: s.items.map(function (k) { return iwdieDrawMap(k, ax, bx, ay, by); }) };
  }
  var c = JSON.parse(JSON.stringify(s));
  if (s.t === 'd') {
    var nums = s.d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [], at = 0;
    c.d = s.d.replace(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g, function () {
      var v = parseFloat(nums[at]), r = (at % 2 === 0) ? X(v) : Y(v);
      at++;
      return String(r);
    });
    return c;
  }
  if (s.t === 'rect') {
    var x1 = X(s.x), x2 = X(s.x + s.w), y1 = Y(s.y), y2 = Y(s.y + s.h);
    c.x = Math.min(x1, x2); c.w = Math.max(1, N(Math.abs(x2 - x1)));
    c.y = Math.min(y1, y2); c.h = Math.max(1, N(Math.abs(y2 - y1)));
  } else if (s.t === 'ellipse') {
    c.cx = X(s.cx); c.cy = Y(s.cy);
    c.rx = Math.max(0.5, N(Math.abs(ax) * s.rx)); c.ry = Math.max(0.5, N(Math.abs(ay) * s.ry));
  } else if (s.t === 'line') {
    c.pts = s.pts.map(function (p) { return [X(p[0]), Y(p[1])]; });
  } else if (s.t === 'path') {
    c.nodes = s.nodes.map(function (k) { return { x: X(k.x), y: Y(k.y), ix: X(k.ix), iy: Y(k.iy), ox: X(k.ox), oy: Y(k.oy) }; });
  } else if (s.t === 'text') {
    c.x = X(s.x); c.y = Y(s.y);
  }
  return c;
}

/* ---- PNG chunks ---- */

var IWDIE_PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
var iwdiePngCrcTable = null;

function iwdiePngCrc32(bytes) {
  if (!iwdiePngCrcTable) {
    iwdiePngCrcTable = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      iwdiePngCrcTable[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ iwdiePngCrcTable[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** A PNG's chunks in file order as [{type, data}], or null when the bytes are
 *  not a whole PNG. */
function iwdiePngChunks(u8) {
  if (!u8 || u8.length < 20) return null;
  for (var i = 0; i < 8; i++) if (u8[i] !== IWDIE_PNG_SIGNATURE[i]) return null;
  var out = [], p = 8;
  while (p + 12 <= u8.length) {
    var len = ((u8[p] << 24) >>> 0) + (u8[p + 1] << 16) + (u8[p + 2] << 8) + u8[p + 3];
    if (p + 12 + len > u8.length) return null;
    var type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    out.push({ type: type, data: u8.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return (out.length && out[0].type === 'IHDR' && out[out.length - 1].type === 'IEND') ? out : null;
}

/** Chunks back into PNG bytes, every CRC computed afresh. */
function iwdiePngBuild(chunks) {
  var total = 8;
  chunks.forEach(function (c) { total += 12 + c.data.length; });
  var out = new Uint8Array(total), p = 8;
  out.set(IWDIE_PNG_SIGNATURE, 0);
  chunks.forEach(function (c) {
    var len = c.data.length, td = new Uint8Array(4 + len);
    for (var i = 0; i < 4; i++) td[i] = c.type.charCodeAt(i) & 0xFF;
    td.set(c.data, 4);
    var crc = iwdiePngCrc32(td);
    out[p] = (len >>> 24) & 255; out[p + 1] = (len >>> 16) & 255; out[p + 2] = (len >>> 8) & 255; out[p + 3] = len & 255;
    out.set(td, p + 4);
    out[p + 8 + len] = (crc >>> 24) & 255; out[p + 9 + len] = (crc >>> 16) & 255;
    out[p + 10 + len] = (crc >>> 8) & 255; out[p + 11 + len] = crc & 255;
    p += 12 + len;
  });
  return out;
}

function iwdieUtf8Encode(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(s));
  return new Uint8Array(Buffer.from(String(s), 'utf8'));
}

function iwdieUtf8Decode(u8) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(u8);
  return Buffer.from(u8).toString('utf8');
}

/** {keyword, text} from an iTXt chunk body; null for a compressed one, which Draw
 *  mode never writes. */
function iwdiePngReadITxt(data) {
  var z = data.indexOf(0);
  if (z < 1 || z + 2 >= data.length || data[z + 1] !== 0) return null;
  var lang = data.indexOf(0, z + 3);
  if (lang < 0) return null;
  var trans = data.indexOf(0, lang + 1);
  if (trans < 0) return null;
  return {
    keyword: String.fromCharCode.apply(null, Array.prototype.slice.call(data.subarray(0, z))),
    text: iwdieUtf8Decode(data.subarray(trans + 1))
  };
}

/** What kind of picture the bytes are, by their first bytes rather than a name. */
function iwdieSniffMime(b) {
  if (!b || b.length < 4) return 'application/octet-stream';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  var head = '';
  for (var i = 0; i < Math.min(b.length, 1024); i++) head += String.fromCharCode(b[i]);
  return /<svg[\s>]/i.test(head) ? 'image/svg+xml' : 'application/octet-stream';
}

function iwdieBytesToBase64(u8) {
  if (typeof Buffer !== 'undefined' && Buffer.from) return Buffer.from(u8).toString('base64');
  var s = '';
  for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What Draw mode left inside a PNG: {drawing: {w, h, shapes}, base: {mime, bytes} | null},
 *  or null when it left nothing. The shapes come back cleaned. */
function iwdieDrawExtract(png) {
  var chunks = iwdiePngChunks(png);
  if (!chunks) return null;
  var drawing = null, base = null;
  chunks.forEach(function (c) {
    if (c.type === 'iTXt' && !drawing) {
      var t = iwdiePngReadITxt(c.data);
      if (t && t.keyword === IWDIE_DRAW_KEYWORD) { try { drawing = JSON.parse(t.text); } catch (e) { drawing = null; } }
    } else if (c.type === IWDIE_DRAW_BASE_CHUNK && !base && c.data.length) {
      var bytes = new Uint8Array(c.data);
      base = { mime: iwdieSniffMime(bytes), bytes: bytes };
    }
  });
  if (!drawing || typeof drawing !== 'object' || Array.isArray(drawing)) return null;
  return {
    drawing: { w: iwdieDrawNum(drawing.w), h: iwdieDrawNum(drawing.h), shapes: iwdieDrawShapes(drawing.shapes) },
    base: base
  };
}

/* ---- Zstandard decoder (RFC 8878) ----
   Illustrator 2020+ stores a document's native data (the part that holds the
   objects outside the artboard) as "%AI24_ZStandard_Data" + one zstd frame, and
   browsers' DecompressionStream has no zstd. Decoding only, whole buffer in
   memory, no dictionaries; skippable frames are skipped; the checksum is read
   but not verified. */

var IWDIE_ZSTD_LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64,
  128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
var IWDIE_ZSTD_LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16];
var IWDIE_ZSTD_ML_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387,
  32771, 65539];
var IWDIE_ZSTD_ML_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
var IWDIE_ZSTD_LL_DEFAULT = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1,
  1, -1, -1, -1, -1];
var IWDIE_ZSTD_ML_DEFAULT = [1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];
var IWDIE_ZSTD_OF_DEFAULT = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];

function iwdieZstdHighBit(v) { return 31 - Math.clz32(v); }

/** Backward bit reader over src[start, end): zstd's FSE and Huffman streams are
 *  read from the last byte towards the first, after its padding marker. */
function iwdieZstdBackBits(src, start, end) {
  var last = src[end - 1];
  if (!last) throw new Error('zstd: bitstream without its end marker');
  return { src: src, start: start, pos: (end - start) * 8 - (8 - iwdieZstdHighBit(last)), base: start };
}

/** Read n (0..32) bits; past the start of the stream it reads zeros and the
 *  position goes negative, which is how the end is detected. */
function iwdieZstdRead(br, n) {
  if (!n) return 0;
  var v = 0, got = 0;
  while (got < n) {
    var take = Math.min(n - got, 24);
    br.pos -= take;
    var p = br.pos, val = 0;
    for (var i = 0; i < take; i++) {
      var bit = p + i, byteIndex = bit >> 3;
      if (bit >= 0 && byteIndex < (br.src.length - br.base)) val |= ((br.src[br.base + byteIndex] >> (bit & 7)) & 1) << i;
    }
    v = v * Math.pow(2, take) + val;   // higher bits were read first
    got += take;
  }
  return v;
}

/** An FSE decoding table from normalised counts. */
function iwdieZstdFseTable(norm, accuracyLog) {
  var size = 1 << accuracyLog, high = size - 1, symbol = new Uint16Array(size), nbBits = new Uint8Array(size),
    baseline = new Uint16Array(size), next = [];
  for (var s = 0; s < norm.length; s++) {
    if (norm[s] === -1) { symbol[high--] = s; next[s] = 1; } else next[s] = norm[s];
  }
  var step = (size >> 1) + (size >> 3) + 3, mask = size - 1, pos = 0;
  for (s = 0; s < norm.length; s++) {
    for (var i = 0; i < norm[s]; i++) {
      symbol[pos] = s;
      do { pos = (pos + step) & mask; } while (pos > high);
    }
  }
  if (pos !== 0) throw new Error('zstd: bad FSE distribution');
  for (var u = 0; u < size; u++) {
    var sym = symbol[u], ns = next[sym]++;
    nbBits[u] = accuracyLog - iwdieZstdHighBit(ns);
    baseline[u] = (ns << nbBits[u]) - size;
  }
  return { log: accuracyLog, symbol: symbol, nbBits: nbBits, baseline: baseline };
}

/** An FSE table description at src[pos]: {table, end}. */
function iwdieZstdReadFse(src, pos, maxSymbol, maxLog) {
  var bitPos = 0;
  var bits = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++, bitPos++) v |= ((src[pos + (bitPos >> 3)] >> (bitPos & 7)) & 1) << i;
    return v;
  };
  var peek = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) { var b = bitPos + i; v |= ((src[pos + (b >> 3)] >> (b & 7)) & 1) << i; }
    return v;
  };
  var log = bits(4) + 5;
  if (log > maxLog) throw new Error('zstd: FSE accuracy too large');
  var remaining = (1 << log) + 1, threshold = 1 << log, nb = log + 1, sym = 0, norm = [], prev0 = false;
  while (remaining > 1 && sym <= maxSymbol) {
    if (prev0) {
      var rep;
      do { rep = bits(2); for (var r = 0; r < rep; r++) norm[sym++] = 0; } while (rep === 3);
      if (sym > maxSymbol) break;
    }
    var max = (2 * threshold - 1) - remaining, count, low = peek(nb - 1);
    if (low < max) { count = low; bitPos += nb - 1; }
    else { count = peek(nb); if (count >= threshold) count -= max; bitPos += nb; }
    count--;
    remaining -= count < 0 ? -count : count;
    norm[sym++] = count;
    prev0 = count === 0;
    while (remaining < threshold) { nb--; threshold >>= 1; }
  }
  if (remaining !== 1) throw new Error('zstd: FSE counts do not add up');
  while (norm.length <= maxSymbol && norm.length < sym) norm.push(0);
  return { table: iwdieZstdFseTable(norm, log), end: pos + ((bitPos + 7) >> 3) };
}

function iwdieZstdHuffTable(weights) {
  var total = 0, i;
  for (i = 0; i < weights.length; i++) if (weights[i]) total += 1 << (weights[i] - 1);
  if (!total) throw new Error('zstd: empty Huffman weights');
  var maxBits = iwdieZstdHighBit(total) + 1, rest = (1 << maxBits) - total;
  if (rest & (rest - 1)) throw new Error('zstd: Huffman weights do not complete a tree');
  weights = weights.concat([iwdieZstdHighBit(rest) + 1]);
  var size = 1 << maxBits, symbol = new Uint8Array(size), nbBits = new Uint8Array(size), at = 0;
  for (var w = 1; w <= maxBits; w++) {
    for (var s = 0; s < weights.length; s++) {
      if (weights[s] !== w) continue;
      var span = 1 << (w - 1), len = maxBits + 1 - w;
      for (var k = 0; k < span; k++) { symbol[at] = s; nbBits[at] = len; at++; }
    }
  }
  return { maxBits: maxBits, symbol: symbol, nbBits: nbBits };
}

/** Huffman tree description at src[pos]: {table, end}. */
function iwdieZstdReadHuff(src, pos) {
  var head = src[pos], weights = [];
  if (head < 128) {
    var start = pos + 1, f = iwdieZstdReadFse(src, start, 255, 6), br = iwdieZstdBackBits(src, f.end, start + head);
    var t = f.table, s1 = iwdieZstdRead(br, t.log), s2 = iwdieZstdRead(br, t.log);
    for (;;) {
      weights.push(t.symbol[s1]);
      s1 = t.baseline[s1] + iwdieZstdRead(br, t.nbBits[s1]);
      if (br.pos < 0) { weights.push(t.symbol[s2]); break; }
      weights.push(t.symbol[s2]);
      s2 = t.baseline[s2] + iwdieZstdRead(br, t.nbBits[s2]);
      if (br.pos < 0) { weights.push(t.symbol[s1]); break; }
      if (weights.length > 255) throw new Error('zstd: too many Huffman weights');
    }
    return { table: iwdieZstdHuffTable(weights), end: start + head };
  }
  var n = head - 127;
  for (var i = 0; i < n; i++) {
    var b = src[pos + 1 + (i >> 1)];
    weights.push(i & 1 ? b & 15 : b >> 4);
  }
  return { table: iwdieZstdHuffTable(weights), end: pos + 1 + ((n + 1) >> 1) };
}

function iwdieZstdHuffStream(src, start, end, table, out, outPos, count) {
  var br = iwdieZstdBackBits(src, start, end), mb = table.maxBits;
  for (var i = 0; i < count; i++) {
    var save = br.pos, peek = iwdieZstdRead(br, mb);
    br.pos = save - table.nbBits[peek];
    out[outPos + i] = table.symbol[peek];
  }
  if (br.pos !== 0) throw new Error('zstd: Huffman stream size mismatch');
}

function iwdieZstdSeqTable(src, pos, mode, defaults, defaultLog, maxSymbol, maxLog, prev) {
  if (mode === 0) return { table: iwdieZstdFseTable(defaults, defaultLog), end: pos };
  if (mode === 1) return { table: { log: 0, symbol: [src[pos]], nbBits: [0], baseline: [0] }, end: pos + 1 };
  if (mode === 2) return iwdieZstdReadFse(src, pos, maxSymbol, maxLog);
  if (!prev) throw new Error('zstd: repeat mode without a previous table');
  return { table: prev, end: pos };
}

/** All frames of a zstd buffer, concatenated. */
function iwdieZstdDecompress(src) {
  var cap = 1 << 16, out = new Uint8Array(cap), outLen = 0, pos = 0;
  var grow = function (need) {
    if (outLen + need <= cap) return;
    while (outLen + need > cap) cap *= 2;
    var n = new Uint8Array(cap); n.set(out.subarray(0, outLen)); out = n;
  };
  while (pos + 4 <= src.length) {
    var magic = (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24)) >>> 0;
    pos += 4;
    if ((magic & 0xFFFFFFF0) === 0x184D2A50) {           // skippable frame
      pos += 4 + (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24));
      continue;
    }
    if (magic !== 0xFD2FB528) {
      if (outLen) break;                                   // padding after the last frame
      throw new Error('zstd: not a zstd frame');
    }
    var fhd = src[pos++], fcsFlag = fhd >> 6, single = (fhd >> 5) & 1, checksum = (fhd >> 2) & 1, dictFlag = fhd & 3;
    if (!single) pos++;                                    // window descriptor: everything stays in memory anyway
    if (dictFlag) {
      var did = [0, 1, 2, 4][dictFlag], dictId = 0;
      for (var q = 0; q < did; q++) dictId |= src[pos + q] << (8 * q);
      if (dictId) throw new Error('zstd: frames that need a dictionary are not supported');
      pos += did;
    }
    pos += [single ? 1 : 0, 2, 4, 8][fcsFlag];
    var rep = [1, 4, 8], huff = null, llT = null, ofT = null, mlT = null, last = 0;
    while (!last) {
      if (pos + 3 > src.length) throw new Error('zstd: the data ends early');
      var bh = src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16);
      pos += 3;
      last = bh & 1;
      var type = (bh >> 1) & 3, size = bh >> 3;
      if (pos + (type === 1 ? 1 : size) > src.length) throw new Error('zstd: the data ends early');
      if (type === 0) { grow(size); out.set(src.subarray(pos, pos + size), outLen); outLen += size; pos += size; continue; }
      if (type === 1) { grow(size); out.fill(src[pos], outLen, outLen + size); outLen += size; pos += 1; continue; }
      if (type !== 2) throw new Error('zstd: reserved block type');
      var blockEnd = pos + size;
      // literals
      var lh = src[pos], lType = lh & 3, sf = (lh >> 2) & 3, litSize, compSize = 0, streams = 1, lit;
      if (lType < 2) {
        if (sf === 0 || sf === 2) { litSize = lh >> 3; pos += 1; }
        else if (sf === 1) { litSize = (lh >> 4) + (src[pos + 1] << 4); pos += 2; }
        else { litSize = (lh >> 4) + (src[pos + 1] << 4) + (src[pos + 2] << 12); pos += 3; }
        if (lType === 0) { lit = src.subarray(pos, pos + litSize); pos += litSize; }
        else { lit = new Uint8Array(litSize); lit.fill(src[pos]); pos += 1; }
      } else {
        var hdrBytes = sf < 2 ? 3 : sf === 2 ? 4 : 5, bitsEach = sf < 2 ? 10 : sf === 2 ? 14 : 18, hv = 0;
        for (var hb = 0; hb < hdrBytes; hb++) hv += src[pos + hb] * Math.pow(2, 8 * hb);
        streams = sf === 0 ? 1 : 4;
        litSize = Math.floor(hv / 16) % Math.pow(2, bitsEach);
        compSize = Math.floor(hv / Math.pow(2, 4 + bitsEach)) % Math.pow(2, bitsEach);
        pos += hdrBytes;
        var litEnd = pos + compSize;
        if (lType === 2) { var h = iwdieZstdReadHuff(src, pos); huff = h.table; pos = h.end; }
        else if (!huff) throw new Error('zstd: treeless literals without a previous tree');
        lit = new Uint8Array(litSize);
        if (streams === 1) iwdieZstdHuffStream(src, pos, litEnd, huff, lit, 0, litSize);
        else {
          var s1 = src[pos] | (src[pos + 1] << 8), s2 = src[pos + 2] | (src[pos + 3] << 8), s3 = src[pos + 4] | (src[pos + 5] << 8);
          var st = pos + 6, per = Math.floor((litSize + 3) / 4), bounds = [st, st + s1, st + s1 + s2, st + s1 + s2 + s3, litEnd];
          for (var k = 0; k < 4; k++) iwdieZstdHuffStream(src, bounds[k], bounds[k + 1], huff, lit, k * per, k < 3 ? per : litSize - 3 * per);
        }
        pos = litEnd;
      }
      // sequences
      var nbSeq = src[pos++];
      if (nbSeq >= 128) {
        if (nbSeq < 255) nbSeq = ((nbSeq - 128) << 8) + src[pos++];
        else { nbSeq = src[pos] + (src[pos + 1] << 8) + 0x7F00; pos += 2; }
      }
      var litPos = 0;
      if (nbSeq) {
        var modes = src[pos++];
        var r1 = iwdieZstdSeqTable(src, pos, modes >> 6, IWDIE_ZSTD_LL_DEFAULT, 6, 35, 9, llT); llT = r1.table; pos = r1.end;
        var r2 = iwdieZstdSeqTable(src, pos, (modes >> 4) & 3, IWDIE_ZSTD_OF_DEFAULT, 5, 31, 8, ofT); ofT = r2.table; pos = r2.end;
        var r3 = iwdieZstdSeqTable(src, pos, (modes >> 2) & 3, IWDIE_ZSTD_ML_DEFAULT, 6, 52, 9, mlT); mlT = r3.table; pos = r3.end;
        var br = iwdieZstdBackBits(src, pos, blockEnd);
        var sLL = iwdieZstdRead(br, llT.log), sOF = iwdieZstdRead(br, ofT.log), sML = iwdieZstdRead(br, mlT.log);
        for (var n = 0; n < nbSeq; n++) {
          var ofCode = ofT.symbol[sOF], mlCode = mlT.symbol[sML], llCode = llT.symbol[sLL];
          var ofVal = Math.pow(2, ofCode) + iwdieZstdRead(br, ofCode);
          var ml = IWDIE_ZSTD_ML_BASE[mlCode] + iwdieZstdRead(br, IWDIE_ZSTD_ML_BITS[mlCode]);
          var ll = IWDIE_ZSTD_LL_BASE[llCode] + iwdieZstdRead(br, IWDIE_ZSTD_LL_BITS[llCode]);
          var offset;
          if (ofVal > 3) { offset = ofVal - 3; rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = offset; }
          else {
            var idx = ofVal - 1 + (ll === 0 ? 1 : 0);
            if (idx === 0) offset = rep[0];
            else {
              offset = idx === 3 ? rep[0] - 1 : rep[idx];
              if (idx !== 1) rep[2] = rep[1];
              rep[1] = rep[0];
              rep[0] = offset;
            }
          }
          if (n < nbSeq - 1) {
            sLL = llT.baseline[sLL] + iwdieZstdRead(br, llT.nbBits[sLL]);
            sML = mlT.baseline[sML] + iwdieZstdRead(br, mlT.nbBits[sML]);
            sOF = ofT.baseline[sOF] + iwdieZstdRead(br, ofT.nbBits[sOF]);
          }
          grow(ll + ml);
          out.set(lit.subarray(litPos, litPos + ll), outLen);
          outLen += ll; litPos += ll;
          if (offset > outLen) throw new Error('zstd: match offset before the start');
          var from = outLen - offset;
          if (offset >= ml) { out.copyWithin(outLen, from, from + ml); outLen += ml; }
          else { for (var c = 0; c < ml; c++) out[outLen++] = out[from + c]; }
        }
        if (br.pos !== 0) throw new Error('zstd: sequence stream size mismatch');
      }
      var restLen = lit.length - litPos;
      grow(restLen);
      out.set(lit.subarray(litPos), outLen);
      outLen += restLen;
      pos = blockEnd;
    }
    if (checksum) pos += 4;
  }
  return out.slice(0, outLen);
}

/* ---- CMYK colours through the document's own ICC profile ----
   Illustrator writes a CMYK document's colours as CMYK; what the screen shows is
   their conversion through the profile embedded in the file. The naive formula
   is far off (a pale grey comes out bluish), so the profile's A2B0 (perceptual)
   lookup table is evaluated here: input curves, a multilinear CLUT, output
   curves to Lab D50, then the Bradford-adapted sRGB matrix and gamma. Profiles
   with 8- or 16-bit LUTs (mft1/mft2 - every Adobe CMYK profile) are read; any
   other kind returns null and the naive formula is used. */

function iwdieIccTag(u8, sig) {
  var n = ((u8[128] << 24) | (u8[129] << 16) | (u8[130] << 8) | u8[131]) >>> 0;
  for (var i = 0; i < n && 132 + 12 * i + 12 <= u8.length; i++) {
    var p = 132 + 12 * i;
    if (String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]) === sig) {
      return { off: ((u8[p + 4] << 24) | (u8[p + 5] << 16) | (u8[p + 6] << 8) | u8[p + 7]) >>> 0,
               len: ((u8[p + 8] << 24) | (u8[p + 9] << 16) | (u8[p + 10] << 8) | u8[p + 11]) >>> 0 };
    }
  }
  return null;
}

/** A CMYK (0..1 each) to '#rrggbb' converter for an ICC profile, or null. */
function iwdieIccCmykConverter(u8) {
  if (!u8 || u8.length < 132) return null;
  var str = function (o) { return String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]); };
  if (str(16) !== 'CMYK') return null;
  var pcs = str(20), tag = iwdieIccTag(u8, 'A2B0') || iwdieIccTag(u8, 'A2B1');
  if (!tag || tag.off + 52 > u8.length) return null;
  var o = tag.off, type = str(o);
  if (type !== 'mft2' && type !== 'mft1') return null;
  var wide = type === 'mft2', inCh = u8[o + 8], outCh = u8[o + 9], grid = u8[o + 10];
  if (inCh !== 4 || outCh !== 3 || grid < 2) return null;
  var n = wide ? (u8[o + 48] << 8) | u8[o + 49] : 256, m = wide ? (u8[o + 50] << 8) | u8[o + 51] : 256;
  if (n < 2 || m < 2) return null;
  var p = o + (wide ? 52 : 48), size = wide ? 2 : 1, top = wide ? 65535 : 255;
  var cells = Math.pow(grid, inCh);
  if (p + (inCh * n + cells * outCh + outCh * m) * size > u8.length) return null;   // a damaged profile, not a huge table
  var val = function (at) { return (wide ? (u8[at] << 8) | u8[at + 1] : u8[at]) / top; };
  var inT = [], outT = [], i, j;
  for (i = 0; i < inCh; i++) { var t = new Float64Array(n); for (j = 0; j < n; j++) t[j] = val(p + (i * n + j) * size); inT.push(t); }
  p += inCh * n * size;
  var clut = new Float64Array(cells * outCh);
  for (i = 0; i < cells * outCh; i++) clut[i] = val(p + i * size);
  p += cells * outCh * size;
  for (i = 0; i < outCh; i++) { var u = new Float64Array(m); for (j = 0; j < m; j++) u[j] = val(p + (i * m + j) * size); outT.push(u); }
  var curve = function (t, x) {
    var f = Math.max(0, Math.min(1, x)) * (t.length - 1), k = Math.min(t.length - 2, Math.floor(f));
    return t[k] + (t[k + 1] - t[k]) * (f - k);
  };
  var cache = {};
  return function (c, mm, y, k) {
    var key = [c, mm, y, k].map(function (v) { return Math.round(v * 10000); }).join(',');
    if (cache[key]) return cache[key];
    var x = [curve(inT[0], c), curve(inT[1], mm), curve(inT[2], y), curve(inT[3], k)];
    var base = [], frac = [];
    for (var d = 0; d < 4; d++) {
      var g = x[d] * (grid - 1), b = Math.min(grid - 2, Math.floor(g));
      base.push(b); frac.push(g - b);
    }
    var res = [0, 0, 0];
    for (var corner = 0; corner < 16; corner++) {
      var w = 1, idx = 0;
      for (d = 0; d < 4; d++) {
        var bit = (corner >> (3 - d)) & 1;
        w *= bit ? frac[d] : 1 - frac[d];
        idx = idx * grid + base[d] + bit;
      }
      if (!w) continue;
      for (var ch = 0; ch < 3; ch++) res[ch] += w * clut[idx * 3 + ch];
    }
    var e = [curve(outT[0], res[0]), curve(outT[1], res[1]), curve(outT[2], res[2])], X, Y, Z;
    if (pcs === 'Lab ') {
      var L = wide ? e[0] * 65535 / 65280 * 100 : e[0] * 100;
      var A = wide ? e[1] * 65535 / 256 - 128 : e[1] * 255 - 128;
      var B = wide ? e[2] * 65535 / 256 - 128 : e[2] * 255 - 128;
      var fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
      var inv = function (f) { return f > 6 / 29 ? f * f * f : 3 * (6 / 29) * (6 / 29) * (f - 4 / 29); };
      X = 0.9642 * inv(fx); Y = inv(fy); Z = 0.8249 * inv(fz);
    } else {
      X = e[0] * 65535 / 32768; Y = e[1] * 65535 / 32768; Z = e[2] * 65535 / 32768;
    }
    var lin = [3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z,
      0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z];
    var hex = '#' + lin.map(function (v) {
      v = Math.max(0, Math.min(1, v));
      v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      var s = Math.round(v * 255).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
    cache[key] = hex;
    return hex;
  };
}

/** The naive CMYK formula - only when there is no usable profile. */
function iwdieCmykNaive(c, m, y, k) {
  return '#' + [c, m, y].map(function (v) {
    var s = Math.round(255 * (1 - v) * (1 - k)).toString(16);
    return s.length < 2 ? '0' + s : s;
  }).join('');
}

/* ---- Illustrator .ai: the objects outside the artboard (v1.33.0) ----
   A PDF-compatible .ai has two copies of the drawing. The PDF page shows the
   artboard only; the native document - zstd- or zlib-compressed in the
   AIPrivateData streams - holds everything, including the components a designer
   keeps around the artboard. The native art is Illustrator's PostScript-like
   line format. Symbol instances carry their art commented out ("%_") as "AI
   Local Art"; plugin groups carry theirs between X= and X+. Text lives in a
   separate text document and is not read; neither are pictures, gradients and
   clipping, which Draw cannot show. */

function iwdieLatin1(u8) {
  var s = '';
  for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}

/** A PostScript string's content as text: escapes resolved, and UTF-8 decoded
 *  when it is UTF-8 - Illustrator writes names that way (Rør, not RÃ¸r). */
function iwdieAiText(s) {
  var raw = String(s).replace(/\\([nrtbf\\()]|[0-7]{1,3})/g, function (m, e) {
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8) & 255);
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[e] || e;
  });
  if (!/[\x80-\xff]/.test(raw)) return raw;
  try {
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 255;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return raw;
  }
}

/** An object's name as people wrote it: Illustrator's unique ids turn spaces
 *  into underscores and number duplicates as _2_, _3_. */
function iwdieAiName(id) {
  return String(id || '').replace(/_\d+_$/, '')
    .replace(/_x([0-9A-Fa-f]{1,6})_/g, function (m, h) { var c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCharCode(c > 0xFFFF ? 0xFFFD : c) : ''; })
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Where each PDF object starts, by number - the last definition wins, as in an
 *  incrementally saved file. Only "N G obj" at the start of a line counts. */
function iwdiePdfIndex(text) {
  var idx = {}, re = /(?:^|[\r\n])(\d+)\s+\d+\s+obj\b/g, m;
  while ((m = re.exec(text))) idx[m[1]] = m.index + m[0].length;
  return idx;
}

/** Object `num`'s stream: {dict, data, filter}; data is still encoded. */
function iwdiePdfStream(u8, text, idx, num) {
  var at = idx[num];
  if (at === undefined) return null;
  var s = text.indexOf('stream', at), e = text.indexOf('endobj', at);
  if (s < 0 || (e >= 0 && e < s)) return null;
  var dict = text.slice(at, s), start = s + 6;
  if (text.charCodeAt(start) === 13) start++;
  if (text.charCodeAt(start) === 10) start++;
  var lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict), len = -1;
  if (lm && !lm[2]) len = parseInt(lm[1], 10);
  else if (lm && idx[lm[1]] !== undefined) len = parseInt(text.slice(idx[lm[1]], idx[lm[1]] + 40), 10);
  if (!(len >= 0) || start + len > u8.length) len = text.indexOf('endstream', start) - start;
  if (!(len >= 0)) return null;
  var fm = /\/Filter\s*\/(\w+)/.exec(dict);
  return { dict: dict, data: u8.subarray(start, start + len), filter: fm ? fm[1] : null };
}

/** The pieces of a .ai: its native-data blocks in order, the CMYK ICC profile
 *  of its PDF page if there is one, and whether it is a bare PostScript .ai.
 *  Blocks and profile may still be Flate-encoded (`filter`). */
function iwdieAiContainer(u8) {
  var text = iwdieLatin1(u8);
  if (text.indexOf('%!PS-Adobe') === 0) return { bare: true, blocks: [{ data: u8, filter: null }], icc: null };
  if (text.indexOf('%PDF-') !== 0) throw new Error('this is not an Illustrator file');
  var idx = iwdiePdfIndex(text), refs = [], re = /\/AIPrivateData(\d+)\s+(\d+)\s+\d+\s+R/g, m;
  while ((m = re.exec(text))) refs.push([parseInt(m[1], 10), m[2]]);
  if (!refs.length) throw new Error('the file has no Illustrator data in it - it was saved without "Create PDF Compatible File", or by another program');
  var seen = {};
  refs = refs.filter(function (r) { if (seen[r[0]]) return false; seen[r[0]] = 1; return true; }).sort(function (a, b) { return a[0] - b[0]; });
  var blocks = refs.map(function (r) {
    var st = iwdiePdfStream(u8, text, idx, r[1]);
    if (!st) throw new Error('Illustrator data block ' + r[0] + ' is missing');
    return { data: st.data, filter: st.filter };
  });
  var icc = null, ir = /\/ICCBased\s+(\d+)\s+\d+\s+R/g;
  while (!icc && (m = ir.exec(text))) {
    var st2 = iwdiePdfStream(u8, text, idx, m[1]);
    if (st2 && /\/N\s+4\b/.test(st2.dict)) icc = { data: st2.data, filter: st2.filter };
  }
  return { bare: false, blocks: blocks, icc: icc };
}

/** The native document from the joined blocks: decompressed here when it is
 *  zstd (Illustrator 2020+); {inflate: bytes} when it is zlib (older), which the
 *  browser inflates asynchronously. Older files put a plain header block before
 *  the compressed part, so the marker is looked for, not assumed at the start. */
function iwdieAiNative(joined) {
  var head = iwdieLatin1(joined.subarray(0, Math.min(joined.length, 1 << 17)));
  var z = head.indexOf('%AI24_ZStandard_Data'), c = head.indexOf('%AI12_CompressedData');
  if (z >= 0) return { bytes: iwdieZstdDecompress(joined.subarray(z + 20)) };
  if (c >= 0) return { inflate: joined.subarray(c + 20) };
  return { bytes: joined };
}

/** Illustrator's native art as a tree: {artboards: [{x0, y0, x1, y1}],
 *  layers: [{name, visible, items}]}. Items are {kind: 'group', name, children}
 *  or {kind: 'path', name, d, rule, style}, in native coordinates (y up); hidden
 *  ones carry hidden: true. Each line is read as PostScript: numbers, arrays,
 *  strings and names go on a stack and every operator takes what it needs - a
 *  line may carry several ("0 J 0 j 1 w 10 M []0 d"). Paint state carries over
 *  from object to object, as Illustrator writes only what changes. Compound
 *  paths come out as one path, so their holes stay holes. */
function iwdieAiParse(text) {
  // Each artboard records its two corners, in either order (Illustrator 23 writes
  // PositionPoint2 first, 30 writes PositionPoint1 first), in ruler-origin units.
  var artboards = [], ab = /%_(-?[\d.]+) (-?[\d.]+) \/RealPointRelToROrigin\r?\n?%_ \(PositionPoint([12])\)/g, am, corner = {};
  while ((am = ab.exec(text))) {
    corner[am[3]] = [+am[1], +am[2]];
    if (corner['1'] && corner['2']) {
      var p1 = corner['1'], p2 = corner['2'];
      artboards.push({ x0: Math.min(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]), x1: Math.max(p1[0], p2[0]), y1: Math.max(p1[1], p2[1]) });
      corner = {};
    }
  }
  var start = text.indexOf('%AI5_BeginLayer');
  var lines = text.slice(start < 0 ? 0 : start).split(/\r\n?|\n/);
  var layers = [], layer = null, stack = [], last = null, hidden = false;
  var st = { fill: null, stroke: null, w: 1, cap: 0, join: 0, da: null, rule: 0, op: 1 };
  var path = [], clip = false, inSymbolDef = 0, inText = 0, inRaster = false, inst = null, instArt = 0, instHead = false;
  var tokRe = /\[[^\]]*\]|\((?:\\.|[^\\)])*\)|\/[^\s\/\[\]()]+|[^\s\[\]()]+/g, num = /^-?\d*\.?\d+(?:[eE][-+]?\d+)?$/;
  var parentList = function () {
    var top = stack.length ? stack[stack.length - 1] : null;
    return top ? (top.kind === 'compound' ? null : top.children) : (layer ? layer.items : null);
  };
  // "1 Xw" hides the next object Illustrator writes
  var push = function (item) {
    if (hidden) { item.hidden = true; hidden = false; }
    var list = parentList();
    if (list) list.push(item);
    last = item;
  };
  var paint = function (op) {
    return { fill: /^[fFbB]$/.test(op) ? st.fill : null, stroke: /^[sSbB]$/.test(op) ? st.stroke : null,
      w: st.w, cap: st.cap, join: st.join, da: st.da, op: st.op };
  };
  var emit = function (op) {
    if (/^[fsbn]$/.test(op) && path.length && path[path.length - 1] !== 'Z') path.push('Z');
    var paints = !clip && /^[fFsSbB]$/.test(op), d = path.join(' ');
    var top = stack.length ? stack[stack.length - 1] : null;
    if (d && top && top.kind === 'compound') {
      if (!clip) top.parts.push(d);
      if (paints && !top.style) top.style = paint(op);
      top.rule = st.rule;
    } else if (d && paints) {
      push({ kind: 'path', name: '', d: d, rule: st.rule, style: paint(op) });
    }
    path = []; clip = false;
  };
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    if (!line) continue;
    if (line.charCodeAt(0) === 37) {                                   // '%'
      if (line.indexOf('%AI5_BeginLayer') === 0) { layer = { name: '', visible: true, items: [] }; layers.push(layer); stack = []; last = null; hidden = false; continue; }
      if (line.indexOf('%AI5_EndLayer') === 0) { layer = null; continue; }
      if (line.indexOf('%AI14_BeginSymbol') === 0) { inSymbolDef++; continue; }
      if (line.indexOf('%AI10_EndSymbol') === 0) { inSymbolDef--; continue; }
      if (line.indexOf('%AI5_BeginRaster') === 0) { inRaster = true; continue; }
      if (line.indexOf('%AI5_EndRaster') === 0) { inRaster = false; continue; }
      if (inSymbolDef || inRaster) continue;
      if (line.indexOf('%_/XMLUID : (') === 0) {
        var nm = /\((.*?)\) ; \(AI10_ArtUID\)/.exec(line);
        if (nm && !(inst && !instArt) && last && !last.name) last.name = iwdieAiText(nm[1]);
        continue;
      }
      if (inst && line.indexOf('%_') === 0) {
        var inner = line.slice(2).trim();
        if (inner === 'X=') {
          if (++instArt === 1) {
            var g = { kind: 'group', name: inst.name, children: [] };
            if (inst.hidden) g.hidden = true;
            push(g); stack.push(g);
          }
          continue;
        }
        if (inner === 'X+') { if (--instArt === 0) { last = stack.pop() || last; inst = null; } continue; }
        if (instArt > 0) line = inner; else continue;                // the local art is drawn, its dictionaries are not
      } else continue;
    }
    if (inSymbolDef || inRaster) continue;
    var trimmed = line.trim();
    if (inText) {                                                      // /AI11Text : ... ; is skipped whole
      if (/:\s*$/.test(trimmed)) inText++;
      else if (/^;/.test(trimmed)) inText--;
      continue;
    }
    if (trimmed.indexOf('/AI11Text') === 0) { inText = 1; continue; }
    if (trimmed.indexOf('/SymbolInstance') === 0) {
      var sn = /^\(((?:\\.|[^\\)])*)\)/.exec((lines[li + 1] || '').trim());
      inst = { name: sn ? iwdieAiText(sn[1]) : 'symbol', hidden: hidden }; instHead = true; hidden = false;
      continue;
    }
    if (instHead) { if (trimmed === ';') instHead = false; continue; }  // the instance header: ref, matrix, ';'
    var toks = trimmed.match(tokRe) || [], ops = [];
    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti], c0 = t.charAt(0);
      if (num.test(t)) { ops.push(parseFloat(t)); continue; }
      if (c0 === '[') { ops.push(t.slice(1, -1).trim().split(/\s+/).filter(function (v) { return num.test(v); }).map(parseFloat)); continue; }
      if (c0 === '(') { ops.push(t.slice(1, -1)); continue; }
      if (c0 === '/') { ops.push(t); continue; }
      var n = [];
      for (var oi = 0; oi < ops.length; oi++) if (typeof ops[oi] === 'number') n.push(ops[oi]);
      var L = n.length;
      switch (t) {
        case 'k': if (L >= 4) st.fill = { cmyk: n.slice(L - 4) }; break;
        case 'K': if (L >= 4) st.stroke = { cmyk: n.slice(L - 4) }; break;
        case 'Xa': if (L >= 3) st.fill = { rgb: n.slice(L - 3) }; break;
        case 'XA': if (L >= 3) st.stroke = { rgb: n.slice(L - 3) }; break;
        case 'g': if (L >= 1) st.fill = { cmyk: [0, 0, 0, 1 - n[L - 1]] }; break;
        case 'G': if (L >= 1) st.stroke = { cmyk: [0, 0, 0, 1 - n[L - 1]] }; break;
        case 'w': if (L >= 1) st.w = n[L - 1]; break;
        case 'J': if (L >= 1) st.cap = n[L - 1]; break;
        case 'j': if (L >= 1) st.join = n[L - 1]; break;
        case 'XR': if (L >= 1) st.rule = n[L - 1]; break;
        case 'Xy': if (L >= 5) st.op = Math.max(0, Math.min(1, n[L - 4])); break;   // mode opacity isolated knockout ...
        case 'Xw': if (L >= 1) hidden = n[L - 1] === 1; break;
        case 'Lb': if (L >= 1 && layer) layer.visible = n[Math.max(0, L - 14)] !== 0; break;
        case 'd': {
          var arr = null;
          for (var ai = 0; ai < ops.length; ai++) if (Array.isArray(ops[ai])) arr = ops[ai];
          st.da = arr && arr.length ? arr : null;
          break;
        }
        case 'm': if (L >= 2) path.push('M' + n[L - 2] + ' ' + n[L - 1]); break;
        case 'l': case 'L': if (L >= 2) path.push('L' + n[L - 2] + ' ' + n[L - 1]); break;
        case 'c': case 'C': if (L >= 6) path.push('C' + n.slice(L - 6).join(' ')); break;
        case 'v': case 'V': if (L >= 4) path.push('V' + n.slice(L - 4).join(' ')); break;
        case 'y': case 'Y': if (L >= 4) path.push('Y' + n.slice(L - 4).join(' ')); break;
        case 'h': if (path.length && path[path.length - 1] !== 'Z') path.push('Z'); break;
        case 'W': clip = true; break;
        case 'f': case 'F': case 's': case 'S': case 'b': case 'B': case 'n': case 'N': emit(t); break;
        case 'u': case 'q': case 'X=': {
          var grp = { kind: 'group', name: '', children: [], clip: t === 'q' };
          push(grp); stack.push(grp); break;
        }
        case '*u': {
          var cp = { kind: 'compound', parts: [], style: null, rule: st.rule, hidden: hidden };
          hidden = false;
          stack.push(cp); break;
        }
        case '*U': {
          var done = stack.pop();
          if (done && done.kind === 'compound' && done.parts.length && done.style) {
            var whole = { kind: 'path', name: '', d: done.parts.join(' '), rule: done.rule, style: done.style };
            if (done.hidden) whole.hidden = true;
            push(whole);
          }
          break;
        }
        case 'U': case 'Q': case 'X+': {
          var closed = stack.pop();
          if (closed) last = closed;
          break;
        }
        case 'Ln': {
          for (var si = ops.length - 1; si >= 0; si--) if (typeof ops[si] === 'string' && ops[si].charAt(0) !== '/') { if (layer) layer.name = iwdieAiText(ops[si]); break; }
          break;
        }
        default: break;
      }
      ops = [];
    }
  }
  return { artboards: artboards, layers: layers };
}

/* Path data with Illustrator's v/y shorthands resolved, as absolute M/L/C/Z. */
function iwdieAiPathD(d) {
  var out = [], cx = 0, cy = 0, sx = 0, sy = 0;
  d.split(/ (?=[MLCVYZ])/).forEach(function (seg) {
    var c = seg.charAt(0), n = seg.slice(1).trim() ? seg.slice(1).trim().split(/\s+/).map(parseFloat) : [];
    if (c === 'M') { cx = sx = n[0]; cy = sy = n[1]; out.push(['M', cx, cy]); }
    else if (c === 'L') { cx = n[0]; cy = n[1]; out.push(['L', cx, cy]); }
    else if (c === 'C') { out.push(['C'].concat(n)); cx = n[4]; cy = n[5]; }
    else if (c === 'V') { out.push(['C', cx, cy, n[0], n[1], n[2], n[3]]); cx = n[2]; cy = n[3]; }
    else if (c === 'Y') { out.push(['C', n[0], n[1], n[2], n[3], n[2], n[3]]); cx = n[2]; cy = n[3]; }
    else if (c === 'Z') { out.push(['Z']); cx = sx; cy = sy; }
  });
  return out;
}

/** The visible objects of a parsed .ai that lie wholly outside its artboard(s),
 *  as a Draw library: {items: [{name, layer, w, h, shapes}], hidden} - items in
 *  their own coordinates (top-left 0, 0, y down), colours converted by
 *  `color(c, m, y, k)`; `hidden` counts the objects outside the artboard that
 *  were left out for being hidden in Illustrator. Groups bigger than `maxSize`
 *  are opened into their children, so a sheet of components becomes the
 *  components. */
function iwdieAiLibrary(parsed, color, maxSize) {
  maxSize = maxSize || 700;
  var abs = parsed.artboards.length ? parsed.artboards : [];
  var top = abs.length ? Math.max.apply(null, abs.map(function (a) { return a.y1; })) : 0;
  var left = abs.length ? Math.min.apply(null, abs.map(function (a) { return a.x0; })) : 0;
  var hidden = 0;
  var hex = function (c) {
    if (!c) return null;
    if (c.rgb) return '#' + c.rgb.map(function (v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
    return color(c.cmyk[0], c.cmyk[1], c.cmyk[2], c.cmyk[3]);
  };
  var union = function (list) {
    return list.reduce(function (a, k) { return { x0: Math.min(a.x0, k.box.x0), y0: Math.min(a.y0, k.box.y0), x1: Math.max(a.x1, k.box.x1), y1: Math.max(a.y1, k.box.y1) }; }, list[0].box);
  };
  // native y up, origin at the artboard's top-left -> panel coordinates; what is
  // hidden keeps its box, so it can be told apart from what was never outside
  var conv = function (item, hid) {
    hid = hid || !!item.hidden;
    if (item.kind === 'path') {
      var segs = iwdieAiPathD(item.d), xs = [], ys = [];
      var d = segs.map(function (s) {
        if (s[0] === 'Z') return 'Z';
        var o = s[0];
        for (var i = 1; i < s.length; i += 2) {
          var x = Math.round((s[i] - left) * 100) / 100, y = Math.round((top - s[i + 1]) * 100) / 100;
          xs.push(x); ys.push(y); o += (i > 1 ? ' ' : '') + x + ' ' + y;
        }
        return o;
      }).join(' ');
      if (!xs.length) return null;
      var box = { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
      if (hid) return { hid: true, box: box };
      var sty = item.style, cap = ['butt', 'round', 'square'][sty.cap] || 'butt', join = ['miter', 'round', 'bevel'][sty.join] || 'miter';
      var st = { stroke: hex(sty.stroke), fill: hex(sty.fill), sw: sty.stroke ? sty.w : 0,
        dash: false, arrow: false, da: sty.da, cap: cap, join: join };
      if (sty.op < 1) st.op = sty.op;
      return { shape: { t: 'd', d: d, rule: item.rule ? 'evenodd' : '', st: st }, box: box };
    }
    var all = (item.children || []).map(function (k) { return conv(k, hid); }).filter(Boolean);
    if (!all.length) return null;
    var shown = all.filter(function (k) { return !k.hid; });
    if (!shown.length) return { hid: true, box: union(all), kids: all };
    return { shape: { t: 'group', name: iwdieAiName(item.name), items: shown.map(function (k) { return k.shape; }) }, box: union(shown), kids: all };
  };
  var art = { x0: 0, y0: 0, x1: abs.length ? Math.max.apply(null, abs.map(function (a) { return a.x1; })) - left : 0, y1: abs.length ? top - Math.min.apply(null, abs.map(function (a) { return a.y0; })) : 0 };
  var outside = function (b) { return b.x1 < art.x0 || b.x0 > art.x1 || b.y1 < art.y0 || b.y0 > art.y1; };
  var lib = [];
  var take = function (c, layerName) {
    if (!c) return;
    var w = c.box.x1 - c.box.x0, h = c.box.y1 - c.box.y0;
    if (c.kids && (w > maxSize || h > maxSize)) { c.kids.forEach(function (k) { take(k, layerName); }); return; }
    if (!outside(c.box)) {
      // a group straddling the artboard may still hold components that are outside it
      if (c.kids) c.kids.forEach(function (k) { take(k, layerName); });
      return;
    }
    if (c.hid) { hidden++; return; }
    var shape = iwdieDrawMap(c.shape, 1, -c.box.x0, 1, -c.box.y0);
    lib.push({ name: (shape.t === 'group' && shape.name) || '', layer: layerName, w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100,
      shapes: shape.t === 'group' ? shape.items : [shape] });
  };
  parsed.layers.forEach(function (l) {
    l.items.forEach(function (it) { take(conv(it, l.visible === false), l.name); });
  });
  return { items: lib, hidden: hidden };
}

/* ===================== Illustrator export (v1.34.0): a real .ai =====================
   A plain PDF does not give Illustrator layers: measured in Illustrator itself,
   optional content groups land in one "Layer 1" with hidden layers shown, every
   filled and stroked shape splits in two, and an SVG's top-level groups stay
   groups. Illustrator builds its layers only from its own editing data, the
   AIPrivateData that every .ai carries next to its PDF page - the data the
   library already reads. So the export writes that data: the PostScript-like
   art program, zlib-compressed after "%AI12_CompressedData" (Illustrator
   refuses it uncompressed), split into 64 KB blocks on the page's
   /PieceInfo /Illustrator /Private, with a plain PDF page beside it for every
   other viewer.

   What was measured to land right (Illustrator, 2026-10-11): layers with lock,
   visibility and print flags; named groups; paths with fill and stroke as one
   object; compound paths with their holes; opacity; dashes, caps and joins; an
   embedded picture with its alpha channel; point text in Arial (opened as
   legacy text that Illustrator updates on request); everything exactly on the
   artboard. Coordinates are the panel's with y negated: the artboard's top
   left is 0, 0, and %AI3_TemplateBox must be W/2, H/2 - Illustrator shifts the
   art by the difference. */

/** A number as the art program writes it: at most three decimals, never -0. */
function iwdieAiNum(v) {
  var n = Math.round(Number(v) * 1000) / 1000;
  return (n === 0 || !isFinite(n)) ? '0' : String(n);
}

/** Text as one PostScript string literal in Latin-1, escaped. */
function iwdieAiLatin1Text(s) {
  var map = { '→': '->', '←': '<-', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '*', '…': '...', '€': 'EUR' };
  var out = '';
  String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').split('').forEach(function (ch) {
    var c = ch.charCodeAt(0);
    if (map[ch]) out += map[ch];
    else if (c < 32) return;
    else if (c > 255) out += '?';
    else if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else out += ch;
  });
  return out;
}

/** A name as Illustrator writes names: UTF-8 bytes in a PostScript string. */
function iwdieAiUtf8Text(s) {
  var t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ');
  try { t = unescape(encodeURIComponent(t)); } catch (e) {}
  return t.replace(/[()\\]/g, function (c) { return '\\' + c; });
}

/** A name in Illustrator's own unique-id form (its SVG id scheme): spaces become
 *  "_", letters, digits, "_", "." and "-" stay, anything else in ASCII becomes
 *  _xHH_, and the rest goes in as UTF-8 bytes - which is how Illustrator writes Rør.
 *  A leading digit, "." or "-" is encoded too, as XML ids cannot start with one. */
function iwdieAiXmlId(name) {
  var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 120), out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i), c = s.charCodeAt(i);
    if (ch === ' ') out += '_';
    else if (c > 127) out += ch;
    else if (/[A-Za-z0-9_.\-]/.test(ch) && !(i === 0 && /[0-9.\-]/.test(ch))) out += ch;
    else out += '_x' + c.toString(16).toUpperCase() + '_';
  }
  try { out = unescape(encodeURIComponent(out)); } catch (e) {}
  return out;
}

/** Every XMLUID made unique, the way Illustrator numbers a repeated name: Name, Name_2_,
 *  Name_3_. Illustrator refuses a file in which two objects share one. */
function iwdieAiUniqueIds(lines) {
  var used = {}, re = /^%_\/XMLUID : \((.*)\) ; \(AI10_ArtUID\) ,$/;
  return lines.map(function (line) {
    var m = re.exec(line);
    if (!m) return line;
    var id = m[1], n = 1;
    while (used[id]) id = m[1] + '_' + (++n) + '_';
    used[id] = 1;
    return '%_/XMLUID : (' + id + ') ; (AI10_ArtUID) ,';
  });
}

/** fill or stroke colour: "c m y k r g b Xa" (XA for the stroke) - RGB with its CMYK beside it. */
function iwdieAiColour(hex, stroke) {
  var c = iwdieDrawColor(hex);
  if (!c) return null;
  if (c.length === 4) c = '#' + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2) + c.charAt(3) + c.charAt(3);
  var r = parseInt(c.substr(1, 2), 16) / 255, g = parseInt(c.substr(3, 2), 16) / 255, b = parseInt(c.substr(5, 2), 16) / 255;
  var k = 1 - Math.max(r, g, b), d = 1 - k;
  var cmy = d > 0 ? [(1 - r - k) / d, (1 - g - k) / d, (1 - b - k) / d] : [0, 0, 0];
  return cmy.concat([k, r, g, b]).map(iwdieAiNum).join(' ') + (stroke ? ' XA' : ' Xa');
}

var IWDIE_AI_CAPS = { butt: 0, round: 1, square: 2 };
var IWDIE_AI_JOINS = { miter: 0, round: 1, bevel: 2 };

/** The paint state an object starts with. */
function iwdieAiStyleLines(st, text) {
  st = st || {};
  var out = ['0 A', '0 Xw', '0 O', '0 R'];
  var fill = iwdieAiColour(st.fill, false), stroke = text ? null : iwdieAiColour(st.stroke, true);
  if (fill) out.push(fill);
  if (stroke) out.push(stroke);
  var op = (typeof st.op === 'number' && st.op >= 0 && st.op < 1) ? st.op : 1;
  out.push('0 ' + iwdieAiNum(op) + ' 0 0 0 Xy');
  if (!text) {
    var sw = Math.max(0, Number(st.sw) || 0), dash = [];
    if (Array.isArray(st.da) && st.da.length) dash = st.da.length % 2 ? st.da.concat(st.da) : st.da;
    else if (st.dash && sw > 0) dash = [sw * 4, sw * 3];
    out.push((IWDIE_AI_CAPS[st.cap] || 0) + ' J ' + (IWDIE_AI_JOINS[st.join] || 0) + ' j ' + iwdieAiNum(sw || 1) + ' w 10 M [' +
      dash.map(iwdieAiNum).join(' ') + ']0 d');
  }
  out.push('0 XR');
  return out;
}

/** The operator that ends a path: what it paints, and whether it closes. */
function iwdieAiPaintOp(st, closed) {
  st = st || {};
  var fill = !!iwdieDrawColor(st.fill), stroke = !!(iwdieDrawColor(st.stroke) && Number(st.sw) > 0);
  if (fill && stroke) return closed ? 'b' : 'B';
  if (fill) return closed ? 'f' : 'F';
  if (stroke) return closed ? 's' : 'S';
  return closed ? 'n' : 'N';
}

/** The lines that name the object written just before them. */
function iwdieAiNameLines(name) {
  var id = iwdieAiXmlId(name);
  return id ? ['%_/ArtDictionary :', '%_/XMLUID : (' + id + ') ; (AI10_ArtUID) ,', '%_;', '%_'] : [];
}

/* Panel coordinates (y down) to art coordinates (y up, artboard top at 0). */
function iwdieAiPt(x, y) { return iwdieAiNum(x) + ' ' + iwdieAiNum(-y); }

/** One subpath as segment lines; `segs` are [cmd, …numbers] with absolute M/L/C. A closed
 *  subpath repeats its first point, as Illustrator writes it - left out, the last anchor is lost. */
function iwdieAiSubpathLines(segs, closed) {
  var out = [], first = null, last = null;
  segs.forEach(function (s) {
    if (s[0] === 'M') { first = [s[1], s[2]]; last = first; out.push(iwdieAiPt(s[1], s[2]) + ' m'); }
    else if (s[0] === 'L') { last = [s[1], s[2]]; out.push(iwdieAiPt(s[1], s[2]) + ' L'); }
    else if (s[0] === 'C') { last = [s[5], s[6]]; out.push(iwdieAiPt(s[1], s[2]) + ' ' + iwdieAiPt(s[3], s[4]) + ' ' + iwdieAiPt(s[5], s[6]) + ' C'); }
  });
  if (closed && first && last && (Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6)) out.push(iwdieAiPt(first[0], first[1]) + ' L');
  return out;
}

/** A Draw shape's outline as subpaths of [cmd, …] segments, with whether each closes. */
function iwdieAiShapeSubpaths(s) {
  var K = 0.5522847498;
  if (s.t === 'rect') {
    var x = s.x, y = s.y, w = s.w, h = s.h, r = Math.max(0, Math.min(Number(s.rx) || 0, w / 2, h / 2)), k = r * K;
    if (!(r > 0)) return [{ segs: [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h]], closed: true }];
    return [{ closed: true, segs: [
      ['M', x + r, y], ['L', x + w - r, y], ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r],
      ['L', x + w, y + h - r], ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
      ['L', x + r, y + h], ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r],
      ['L', x, y + r], ['C', x, y + r - k, x + r - k, y, x + r, y]] }];
  }
  if (s.t === 'ellipse') {
    var cx = s.cx, cy = s.cy, rx = s.rx, ry = s.ry;
    return [{ closed: true, segs: [
      ['M', cx + rx, cy], ['C', cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry],
      ['C', cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy],
      ['C', cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry],
      ['C', cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy]] }];
  }
  if (s.t === 'line') {
    return [{ closed: !!s.closed, segs: s.pts.map(function (p, i) { return [i ? 'L' : 'M', p[0], p[1]]; }) }];
  }
  if (s.t === 'path') {
    var n = s.nodes, segs = [['M', n[0].x, n[0].y]];
    var seg = function (a, b) {
      var straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
      segs.push(straight ? ['L', b.x, b.y] : ['C', a.ox, a.oy, b.ix, b.iy, b.x, b.y]);
    };
    for (var i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
    if (s.closed) seg(n[n.length - 1], n[0]);
    return [{ closed: !!s.closed, segs: segs }];
  }
  if (s.t === 'd') {
    var toks = String(s.d).match(/[MLCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [], subs = [], cur = null, at = 0;
    var num = function () { return parseFloat(toks[at++]); };
    while (at < toks.length) {
      var c = toks[at++];
      if (c === 'M') { cur = { closed: false, segs: [['M', num(), num()]] }; subs.push(cur); }
      else if (c === 'L' && cur) cur.segs.push(['L', num(), num()]);
      else if (c === 'C' && cur) cur.segs.push(['C', num(), num(), num(), num(), num(), num()]);
      else if (c === 'Z' && cur) cur.closed = true;
    }
    return subs;
  }
  return [];
}

/** An arrowhead at the end of an open line or path, the way Draw's marker draws it. */
function iwdieAiArrowLines(s) {
  var st = s.st || {}, sw = Number(st.sw) || 0, col = iwdieDrawColor(st.stroke);
  if (!st.arrow || !col || !(sw > 0) || s.closed) return [];
  var subs = iwdieAiShapeSubpaths(s), segs = subs.length ? subs[subs.length - 1].segs : [];
  if (segs.length < 2) return [];
  var last = segs[segs.length - 1], end = last[0] === 'C' ? [last[5], last[6]] : [last[1], last[2]];
  var prevSeg = segs[segs.length - 2], from = last[0] === 'C' ? [last[3], last[4]] : (prevSeg[0] === 'C' ? [prevSeg[5], prevSeg[6]] : [prevSeg[1], prevSeg[2]]);
  var dx = end[0] - from[0], dy = end[1] - from[1], len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0)) return [];
  dx /= len; dy /= len;
  var tip = [end[0] + dx * sw, end[1] + dy * sw], base = [end[0] - dx * 4 * sw, end[1] - dy * 4 * sw], px = -dy * 2.5 * sw, py = dx * 2.5 * sw;
  return iwdieAiStyleLines({ fill: col, op: st.op }).concat([
    iwdieAiPt(base[0] + px, base[1] + py) + ' m', iwdieAiPt(tip[0], tip[1]) + ' L', iwdieAiPt(base[0] - px, base[1] - py) + ' L',
    iwdieAiPt(base[0] + px, base[1] + py) + ' L', 'f']);
}

/** Point text, written in the legacy form Illustrator still reads (and updates on request). */
function iwdieAiTextLines(s, name) {
  var st = s.st || {};
  return iwdieAiStyleLines({ fill: st.fill || '#000000', op: st.op }, true).concat([
    '0 To', '1 0 0 1 ' + iwdieAiPt(s.x, s.y) + ' 0 Tp', 'TP', '0 Tr',
    '/_ArialMT ' + iwdieAiNum(s.size || 13) + ' Tf',
    '0 Ts 100 Tz 0 Tt 1 TA 0 0 5 TC 100 100 200 TW 0 0 0 Ti 0 Ta 0 Tq 0 0 Tl 0 Tc 0 Tw',
    '(' + iwdieAiLatin1Text(s.text) + ') Tx', '(\\r) TX', 'TO'
  ], iwdieAiNameLines(name));
}

/** A Draw shape as art lines. Groups keep their name; a shape with an arrow becomes a group of two. */
function iwdieAiShapeLines(s, name) {
  if (!s || typeof s !== 'object') return [];
  if (s.t === 'group') {
    var inner = [];
    (s.items || []).forEach(function (c) { inner = inner.concat(iwdieAiShapeLines(c)); });
    return inner.length ? ['0 A', '0 Xw', 'u'].concat(inner, ['U'], iwdieAiNameLines(name || s.name)) : [];
  }
  if (s.t === 'text') return iwdieAiTextLines(s, name);
  var subs = iwdieAiShapeSubpaths(s);
  if (!subs.length) return [];
  var st = s.st || {}, evenodd = s.rule === 'evenodd', out;
  if (subs.length === 1) {
    out = iwdieAiStyleLines(st).concat(evenodd ? ['1 XR'] : [], iwdieAiSubpathLines(subs[0].segs, subs[0].closed), [iwdieAiPaintOp(st, subs[0].closed)]);
  } else {
    // several subpaths are one compound path, so holes stay holes
    out = ['0 A', '0 Xw', '*u'].concat(iwdieAiStyleLines(st));
    subs.forEach(function (sp) {
      out = out.concat([evenodd ? '1 XR' : '0 XR'], iwdieAiSubpathLines(sp.segs, sp.closed), [iwdieAiPaintOp(st, sp.closed)]);
    });
    out.push('*U');
  }
  var arrow = iwdieAiArrowLines(s);
  if (arrow.length) return ['0 A', '0 Xw', 'u'].concat(out, arrow, ['U'], iwdieAiNameLines(name));
  return out.concat(iwdieAiNameLines(name));
}

/** Illustrator's layer colours, by index. */
var IWDIE_AI_LAYER_COLOURS = [[79, 128, 255], [255, 79, 79], [79, 255, 79], [79, 79, 255], [255, 255, 79], [255, 79, 255], [79, 255, 255]];

/** A layer: `Lb` carries visible, preview, unlocked, printing, dimmed, …, colour. */
function iwdieAiLayerLines(layer, index) {
  var ci = index % IWDIE_AI_LAYER_COLOURS.length, rgb = IWDIE_AI_LAYER_COLOURS[ci];
  var lb = [layer.visible === false ? 0 : 1, 1, layer.locked ? 0 : 1, layer.print === false ? 0 : 1, layer.dimmed ? 1 : 0, 0, 1, ci,
    rgb[0], rgb[1], rgb[2], 0, 50, 0].join(' ') + ' Lb';
  return ['%AI5_BeginLayer', lb, '(' + iwdieAiUtf8Text(layer.name) + ') Ln', '0 A', '0 Xw'].concat(layer.lines || [], ['LB', '%AI5_EndLayer--']);
}

/** An embedded picture: RGBA pixels (top row first) drawn over the rectangle x, y, w, h of
 *  the panel. Illustrator reads the rows bottom-up with this matrix, and wants the alpha bytes
 *  after all the colour samples and a bare LF after XI. Returns the text before and after
 *  the samples and the samples themselves. */
function iwdieAiRasterParts(rgba, pw, ph, x, y, w, h, name) {
  var n = pw * ph, data = new Uint8Array(n * 4), o = 0, a = n * 3, row, col, i;
  for (row = ph - 1; row >= 0; row--) {
    for (col = 0; col < pw; col++) {
      i = (row * pw + col) * 4;
      data[o++] = rgba[i]; data[o++] = rgba[i + 1]; data[o++] = rgba[i + 2];
      data[a++] = rgba[i + 3];
    }
  }
  var m = '[ ' + [w / pw, 0, 0, -h / ph, x, -(y + h)].map(iwdieAiNum).join(' ') + ' ]';
  return {
    head: ['0 A', '0 Xw', '0 1 0 0 0 Xy', '%AI5_File:', '%AI5_BeginRaster', '() 1 XG', '/DeviceRGB XN', m + ' ' + pw + ' ' + ph + ' 0 Xh',
      m + ' 0 0 ' + pw + ' ' + ph + ' ' + pw + ' ' + ph + ' 8 3 1 17 1 0 4 4 0 0', '%%BeginData: ' + (n * 3 + 4)],
    data: data,
    tail: ['%%EndData', 'XH', '%AI5_EndRaster', 'N'].concat(iwdieAiNameLines(name))
  };
}

/** The header comments: also stored on their own as AIMetaData. */
function iwdieAiHeaderLines(o) {
  var W = o.width, H = o.height, d = o.date || new Date();
  var p2 = function (v) { return (v < 10 ? '0' : '') + v; };
  var hh = d.getHours() % 12 || 12;
  return [
    '%!PS-Adobe-3.0 ',
    '%%Creator: Adobe Illustrator(R) 24.0',
    '%%AI8_CreatorVersion: 24.0.0',
    '%%For: (' + iwdieAiLatin1Text(o.author || 'IWMAC Designer Import/Export') + ') ()',
    '%%Title: (' + iwdieAiLatin1Text(o.title || 'background.ai') + ')',
    '%%CreationDate: ' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + '/' + d.getFullYear() + ' ' + hh + ':' + p2(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'),
    '%%Canvassize: 16383',
    '%%BoundingBox: 0 ' + (-H) + ' ' + W + ' 0',
    '%%HiResBoundingBox: 0 ' + (-H) + ' ' + W + ' 0',
    '%%DocumentProcessColors: Cyan Magenta Yellow Black',
    '%AI5_FileFormat 14.0',
    '%AI12_BuildNumber: 1',
    '%AI3_ColorUsage: Color',
    '%AI7_ImageSettings: 0',
    '%%RGBProcessColor: 0 0 0 ([Registration])',
    '%AI3_Cropmarks: 0 ' + (-H) + ' ' + W + ' 0',
    '%AI3_TemplateBox: ' + iwdieAiNum(W / 2) + ' ' + iwdieAiNum(H / 2) + ' ' + iwdieAiNum(W / 2) + ' ' + iwdieAiNum(H / 2),
    '%AI3_TileBox: 0 ' + (-H) + ' ' + W + ' 0',
    '%AI3_DocumentPreview: None',
    '%AI5_ArtSize: 14400 14400',
    '%AI5_RulerUnits: 6',
    '%AI9_ColorModel: 1',
    '%AI5_ArtFlags: 0 0 0 1 0 0 1 0 0',
    '%AI5_TargetResolution: 800',
    '%AI5_NumLayers: ' + (o.layers || []).length,
    '%%EndComments'
  ];
}

/** The whole editing-data program: header, setup with the artboard, the layers (bottom first),
 *  trailer. A layer may carry one picture ({raster: iwdieAiRasterParts(…)}) under its lines. */
function iwdieAiProgram(o) {
  var W = o.width, H = o.height;
  var setup = ['%%BeginProlog', '%%EndProlog', '%%BeginSetup',
    '%AI9_BeginDocumentData', '%_/Document :', '%_/Dictionary :', '%_/Array :', '%_/Dictionary :',
    '%_' + iwdieAiNum(8191.5 - W / 2) + ' ' + iwdieAiNum(8191.5 - H / 2) + ' /RealPoint', '%_ (RulerOrigin) ,',
    '%_(' + iwdieAiLatin1Text(o.artboardName || 'Artboard 1') + ') /UnicodeString (Name) ,', '%_1 /Real (PAR) ,',
    '%_' + W + ' ' + (-H) + ' /RealPointRelToROrigin', '%_ (PositionPoint2) ,',
    '%_0 0 /RealPointRelToROrigin', '%_ (PositionPoint1) ,',
    '%_1 /Bool (IsArtboardSelected) ,', '%_0 /Bool (IsArtboardDefaultName) ,',
    '%_; ,', '%_; (ArtboardArray) ,', '%_; /NotRecorded ,', '%_;', '%AI9_EndDocumentData', '%%EndSetup'];
  var chunks = [], text = iwdieAiHeaderLines(o).concat(setup), used = [];
  var flush = function (lines) { if (lines.length) { chunks.push(lines); used.push(lines); } };
  (o.layers || []).forEach(function (layer, i) {
    var L = iwdieAiLayerLines(layer, i);
    if (layer.raster) {
      // the picture goes last in its layer, over the layer's own lines (the canvas plate)
      var at = L.lastIndexOf('LB'), r = layer.raster;
      flush(text.concat(L.slice(0, at), r.head));
      chunks.push('XI\n');
      chunks.push(r.data);
      text = r.tail.concat(L.slice(at));
    } else {
      text = text.concat(L);
    }
  });
  flush(text.concat(['%%PageTrailer', 'gsave annotatepage grestore showpage', '%%Trailer', '%%EOF']));
  // names are made unique across the whole document, then the text is joined
  var all = [];
  used.forEach(function (lines) { all = all.concat(lines); });
  all = iwdieAiUniqueIds(all);
  var k2 = 0;
  chunks = chunks.map(function (c) {
    if (typeof c !== 'object' || c instanceof Uint8Array) return c;
    var part = all.slice(k2, k2 + c.length);
    k2 += c.length;
    return part.join('\r\n') + '\r\n';
  });
  var total = 0;
  chunks.forEach(function (c) { total += c.length; });
  var out = new Uint8Array(total), pos = 0;
  chunks.forEach(function (c) {
    if (typeof c === 'string') { for (var k = 0; k < c.length; k++) out[pos++] = c.charCodeAt(k) & 255; }
    else { out.set(c, pos); pos += c.length; }
  });
  return out;
}

/** The .ai file: a one-page PDF whose page shows `preview` (a JPEG or Flate RGB picture of the
 *  whole artboard, for every viewer that is not Illustrator), carrying the editing data
 *  `privateData` (header + "%AI12_CompressedData" + the zlib-compressed program) in 64 KB blocks. */
function iwdieAiPdf(o) {
  var W = Math.max(1, Math.round(o.width)), H = Math.max(1, Math.round(o.height));
  var enc = function (s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  var parts = [], pos = 0, offs = [], objs = [];
  var push = function (u8) { parts.push(u8); pos += u8.length; };
  var d = o.date || new Date(), p2 = function (v) { return (v < 10 ? '0' : '') + v; };
  var stamp = 'D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  var priv = o.privateData, blocks = [], BLOCK = 65536;
  for (var b = 0; b < priv.length; b += BLOCK) blocks.push(priv.subarray(b, Math.min(priv.length, b + BLOCK)));
  if (!blocks.length) blocks.push(new Uint8Array(0));
  var meta = enc(o.meta || '');
  var pv = o.preview, content = enc('q\n' + W + ' 0 0 ' + H + ' 0 0 cm\n/Im0 Do\nQ\n');
  // object numbers: 1 catalog, 2 pages, 3 page, 4 contents, 5 image, 6 info, 7 Illustrator, 8 Private, 9 AIMetaData, 10.. blocks
  var privKeys = blocks.map(function (x, i) { return '/AIPrivateData' + (i + 1) + ' ' + (10 + i) + ' 0 R'; }).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] = '<< /Type /Page /Parent 2 0 R /ArtBox [0 0 ' + W + ' ' + H + '] /BleedBox [0 0 ' + W + ' ' + H + '] /CropBox [0 0 ' + W + ' ' + H + '] ' +
    '/MediaBox [0 0 ' + W + ' ' + H + '] /TrimBox [0 0 ' + W + ' ' + H + '] /LastModified (' + stamp + ') /PieceInfo << /Illustrator 7 0 R >> ' +
    '/Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 4 0 R >>';
  objs[4] = { dict: '<< /Length ' + content.length + ' >>', data: content };
  objs[5] = { dict: '<< /Type /XObject /Subtype /Image /Width ' + pv.width + ' /Height ' + pv.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /' +
    (pv.filter === 'DCTDecode' ? 'DCTDecode' : 'FlateDecode') + ' /Length ' + pv.data.length + ' >>', data: pv.data };
  objs[6] = '<< /Title (' + iwdieAiLatin1Text(o.title || 'background') + ') /Creator (IWMAC Designer Import/Export' + (o.version ? ' ' + o.version : '') +
    ') /Producer (IWMAC Designer Import/Export) /CreationDate (' + stamp + ') >>';
  objs[7] = '<< /LastModified (' + stamp + ') /Private 8 0 R >>';
  objs[8] = '<< /AIMetaData 9 0 R ' + privKeys + ' /ContainerVersion 11 /CreatorVersion 24 /NumBlock ' + blocks.length + ' /RoundtripStreamType 1 /RoundtripVersion 17 >>';
  objs[9] = { dict: '<< /Length ' + meta.length + ' >>', data: meta };
  blocks.forEach(function (blk, i) { objs[10 + i] = { dict: '<< /Length ' + blk.length + ' >>', data: blk }; });
  push(enc('%PDF-1.6\n%âãÏÓ\n'));
  for (var n = 1; n < objs.length; n++) {
    offs[n] = pos;
    var ob = objs[n];
    if (typeof ob === 'string') push(enc(n + ' 0 obj\n' + ob + '\nendobj\n'));
    else { push(enc(n + ' 0 obj\n' + ob.dict + '\nstream\n')); push(ob.data); push(enc('\nendstream\nendobj\n')); }
  }
  var xrefAt = pos, pad = function (v) { var s = String(v); while (s.length < 10) s = '0' + s; return s; };
  var xref = 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (var k = 1; k < objs.length; k++) xref += pad(offs[k]) + ' 00000 n \n';
  push(enc(xref + 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n'));
  var out = new Uint8Array(pos), at = 0;
  parts.forEach(function (p) { out.set(p, at); at += p.length; });
  return out;
}

/** The private data block: the header, the marker, then the zlib-compressed program. */
function iwdieAiPrivateData(meta, compressed) {
  var head = meta + '%AI12_CompressedData', out = new Uint8Array(head.length + compressed.length);
  for (var i = 0; i < head.length; i++) out[i] = head.charCodeAt(i) & 255;
  out.set(compressed, head.length);
  return out;
}

/** The panel's objects as a reference layer: each one's box and its label, where the live
 *  values will sit over the background. */
function iwdieAiObjectLines(objects) {
  var out = [];
  (objects || []).forEach(function (o) {
    var x = parseFloat(o.posLeft), y = parseFloat(o.posTop), w = parseFloat(o.posWidth), h = parseFloat(o.posHeight);
    if (!isFinite(x) || !isFinite(y) || !(w > 0) || !(h > 0)) return;
    var label = (o.tag_text && String(o.tag_text).trim()) || (o.alias_text && String(o.alias_text).trim()) || String(o.obj_id || 'object');
    var box = iwdieAiShapeLines({ t: 'rect', x: x, y: y, w: w, h: h, rx: 0, st: { stroke: '#4f80ff', fill: null, sw: 0.75, da: [3, 2] } });
    var txt = iwdieAiShapeLines({ t: 'text', x: x, y: y - 2, text: label.slice(0, 60), size: 7, st: { fill: '#4f80ff' } });
    out = out.concat(['0 A', '0 Xw', 'u'], box, txt, ['U'], iwdieAiNameLines(label));
  });
  return out;
}

/** ImageTracer's path data (M, L, Q, Z, absolute) as Draw path data: the quadratic
 *  curves raised to cubics, which is all Illustrator's art program draws. */
function iwdieAiQuadToCubic(d) {
  var toks = String(d == null ? '' : d).match(/[MLQZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/gi) || [], out = [], i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  var n = function () { return parseFloat(toks[i++]); }, f = function (v) { return String(Math.round(v * 100) / 100); };
  while (i < toks.length) {
    var c = String(toks[i++]).toUpperCase();
    if (c === 'M') { cx = sx = n(); cy = sy = n(); out.push('M' + f(cx) + ' ' + f(cy)); }
    else if (c === 'L') { cx = n(); cy = n(); out.push('L' + f(cx) + ' ' + f(cy)); }
    else if (c === 'Q') {
      var qx = n(), qy = n(), x = n(), y = n();
      out.push('C' + f(cx + 2 / 3 * (qx - cx)) + ' ' + f(cy + 2 / 3 * (qy - cy)) + ' ' + f(x + 2 / 3 * (qx - x)) + ' ' + f(y + 2 / 3 * (qy - y)) + ' ' + f(x) + ' ' + f(y));
      cx = x; cy = y;
    } else if (c === 'Z') { out.push('Z'); cx = sx; cy = sy; }
    else return null;
  }
  return out.length ? out.join(' ') : null;
}

/** The tidied trace (iwdieTidyTraceSvg) as Draw shapes for the .ai: its named groups stay
 *  groups, every path becomes path data. The canvas plate is left out - the picture's
 *  layer has its own. */
function iwdieAiTraceShapes(svg) {
  var s = String(svg == null ? '' : svg), re = /<g\b([^>]*)>|<\/g>|<path\b([^>]*?)\/?>/g, m;
  var root = { items: [] }, stack = [root];
  var close = function () {
    var g = stack.pop();
    if (g.items.length) stack[stack.length - 1].items.push({ t: 'group', name: g.name, items: g.items });
  };
  while ((m = re.exec(s))) {
    if (m[0].charAt(1) === '/') { if (stack.length > 1) close(); continue; }
    if (m[0].indexOf('<g') === 0) {
      var idm = /\bid="([^"]*)"/.exec(m[1] || '');
      stack.push({ name: idm ? iwdieAiName(idm[1]) : '', items: [] });
      continue;
    }
    var attrs = m[2] || '', fm = /\bfill="([^"]*)"/.exec(attrs), dm = /\bd="([^"]*)"/.exec(attrs);
    var d = dm ? iwdieAiQuadToCubic(dm[1]) : null;
    if (d) stack[stack.length - 1].items.push({ t: 'd', d: d, rule: '', st: { fill: fm ? fm[1] : '#000000', stroke: null, sw: 0 } });
  }
  while (stack.length > 1) close();
  return iwdieDrawShapes(root.items);
}


/* ===================== Edit in VectorCraft (v1.35.0): the pure part =====================
   VectorCraft (an open-source Illustrator in Rust, MIT OR Apache-2.0) runs as an
   unmodified official web build on https://hapnes-dev.github.io/iwmac-vector/app/. This
   script runs on both pages. The Designer hands the panel over as an SVG with
   layers; the editor's page drops it in and catches the SVG saved there; Tampermonkey's
   storage carries both ways. The SVG comes back with VectorCraft's own document inside
   it (Preserve Editing Capabilities) and is kept in the background PNG, so the next edit
   reopens exactly that document. */

/** Where the editor lives. */
var IWDIE_VC_URL = 'https://hapnes-dev.github.io/iwmac-vector/app/';
/** Private PNG chunk with the VectorCraft SVG: ancillary, private, safe to copy. */
var IWDIE_VC_CHUNK = 'iwVc';
/** Where the component library is kept (v1.36.0): Tampermonkey's storage, which the Designer and
 *  the editor's page share - the whole library, and a small note of what it holds. These are top-level
 *  so they are set before the editor's page runs, which happens before the rest of the page setup. */
var IWDIE_LIB_KEY = 'iwdie.library.v1';
var IWDIE_LIB_META_KEY = 'iwdie.library.meta';
/** Where Draw (1.33.0 to 1.35.0) kept it: the Designer's own localStorage. */
var IWDIE_LIB_OLD_KEY = 'iwdie.draw.library.v1';

/** The panel as an SVG VectorCraft opens with layers: Bakgrunn (the canvas colour and the
 *  picture), Tegning (Draw's shapes) and, hidden, Panelobjekter (each object's box and label). */
function iwdieVcSvg(o) {
  var W = Math.max(1, Math.round(o.width)), H = Math.max(1, Math.round(o.height)), esc = iwdieDrawEsc, f = iwdieDrawFmt;
  var shapes = Array.isArray(o.shapes) ? o.shapes : [], objects = Array.isArray(o.objects) ? o.objects : [];
  var out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
  if (o.title) out.push('  <title>' + esc(o.title) + '</title>');
  var defs = iwdieDrawDefsSvg(shapes);
  if (defs) out.push('  <defs>' + defs + '</defs>');
  out.push('  <g id="Bakgrunn" data-name="Bakgrunn">');
  var plate = iwdieDrawColor(o.plate);
  if (plate) out.push('    <rect width="' + W + '" height="' + H + '" fill="' + plate + '"/>');
  if (o.picture && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(o.picture)) {
    out.push('    <image width="' + W + '" height="' + H + '" preserveAspectRatio="none" xlink:href="' + o.picture + '"/>');
  }
  out.push('  </g>');
  out.push('  <g id="Tegning" data-name="Tegning">');
  shapes.forEach(function (sh) { out.push('    ' + iwdieDrawShapeSvg(sh)); });
  out.push('  </g>');
  if (objects.length) {
    out.push('  <g id="Panelobjekter" data-name="Panelobjekter" display="none">');
    objects.forEach(function (ob) {
      var x = parseFloat(ob.posLeft), y = parseFloat(ob.posTop), w = parseFloat(ob.posWidth), h = parseFloat(ob.posHeight);
      if (!isFinite(x) || !isFinite(y) || !(w > 0) || !(h > 0)) return;
      var label = (ob.tag_text && String(ob.tag_text).trim()) || (ob.alias_text && String(ob.alias_text).trim()) || String(ob.obj_id || 'object');
      out.push('    <g data-name="' + esc(label.slice(0, 60)) + '"><rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) +
        '" fill="none" stroke="#4f80ff" stroke-width="0.75" stroke-dasharray="3 2"/><text x="' + f(x) + '" y="' + f(y - 2) +
        '" font-family="Arial" font-size="7" fill="#4f80ff">' + esc(label.slice(0, 60)) + '</text></g>');
    });
    out.push('  </g>');
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

/** The SVG with an explicit size on its root, so a browser draws it at that size. */
function iwdieVcSized(svg, w, h) {
  var s = String(svg || ''), m = /<svg\b[^>]*>/i.exec(s);
  if (!m) return null;
  var tag = m[0].replace(/\s(width|height)\s*=\s*"[^"]*"/g, '').replace(/^<svg\b/i, '<svg width="' + Math.round(w) + '" height="' + Math.round(h) + '"');
  return s.slice(0, m.index) + tag + s.slice(m.index + m[0].length);
}

/** A VectorCraft SVG with Draw's shapes added as a layer of their own, for a drawing made in
 *  the Designer over a background that came from VectorCraft. VectorCraft then reads the
 *  visible art (its stored document no longer matches), layers and all. */
function iwdieVcMergeShapes(svg, shapes) {
  var s = String(svg || ''), at = s.lastIndexOf('</svg>');
  if (at < 0 || !shapes || !shapes.length) return s;
  var defs = iwdieDrawDefsSvg(shapes);
  var layer = '<g id="Tegning_Designer" data-name="Tegning (Designer)">' + (defs ? '<defs>' + defs + '</defs>' : '') +
    shapes.map(function (sh) { return iwdieDrawShapeSvg(sh); }).join('') + '</g>\n';
  return s.slice(0, at) + layer + s.slice(at);
}

/** The PNG with a VectorCraft document stored in it: an SVG as plain text in iwVc, or bytes
 *  given with the chunk to keep them in (iwVz: compressed, v1.38.0). The picture is that
 *  document's rendering now, so an older copy and any Draw drawing (and the picture it was
 *  drawn on) go; viewers skip the chunk. */
function iwdieVcEmbed(png, doc, type) {
  var chunks = iwdiePngChunks(png);
  if (!chunks) throw new Error('the picture to embed in is not a PNG');
  var keep = chunks.filter(function (c) {
    if (c.type === IWDIE_VC_CHUNK || c.type === IWDIE_VC_ZCHUNK || c.type === IWDIE_DRAW_BASE_CHUNK) return false;
    if (c.type === 'iTXt') { var t = iwdiePngReadITxt(c.data); if (t && t.keyword === IWDIE_DRAW_KEYWORD) return false; }
    return true;
  });
  var end = keep.pop();
  keep.push({ type: type || IWDIE_VC_CHUNK, data: typeof doc === 'string' ? iwdieUtf8Encode(doc) : doc });
  keep.push(end);
  return iwdiePngBuild(keep);
}

/** The VectorCraft SVG a PNG carries as plain text (iwVc), or null; a compressed one (iwVz)
 *  is read in the browser, which unpacks it. */
function iwdieVcExtract(png) {
  var chunks = iwdiePngChunks(png);
  if (!chunks) return null;
  for (var i = 0; i < chunks.length; i++) {
    if (chunks[i].type === IWDIE_VC_CHUNK && chunks[i].data.length) {
      var t = iwdieUtf8Decode(chunks[i].data);
      return /<svg\b/i.test(t) ? t : null;
    }
  }
  return null;
}

/* ===================== Komponenter as a VectorCraft library (v1.37.0) =====================
   VectorCraft keeps reusable art in its Libraries panel. A library is a .vclibrary file (JSON)
   whose graphics are each a native VectorCraft document with a PNG thumbnail, and a .vclibrary
   dropped on the app's window is imported as a library. So the component library goes to
   VectorCraft as one: each component a graphic, each Illustrator layer a group of the library,
   and a graphic dragged onto the drawing (or double-clicked) lands as a group with its name.
   The documents are written in format version 1, as VectorCraft's own example files are: one
   artboard, one layer, the component a group of paths, each path anchors with their handles,
   its fill and its stroke. */

/** Clean path data - absolute M, L, C and Z, as drawings and components keep it - as
 *  VectorCraft's subpaths: anchors with their in and out handles. A closing point that repeats
 *  the first, as Illustrator writes it, is the first anchor. */
function iwdieVcSubpaths(d) {
  var t = String(d || '').match(/[MLCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  var subs = [], cur = null, start = null, i = 0;
  var num = function (k) { return parseFloat(t[k]); };
  var pt = function (x, y) { return { x: x, y: y }; };
  var anchor = function (x, y) { return { p: pt(x, y), in: pt(x, y), out: pt(x, y), kind: 'Corner' }; };
  var open = function (x, y) { cur = { anchors: [anchor(x, y)], closed: false }; subs.push(cur); start = pt(x, y); };
  var close = function () {
    if (!cur) return;
    var A = cur.anchors, f = A[0], l = A[A.length - 1];
    if (A.length > 1 && Math.abs(f.p.x - l.p.x) < 0.005 && Math.abs(f.p.y - l.p.y) < 0.005) { f.in = l.in; A.pop(); }
    cur.closed = true;
    cur = null;
  };
  while (i < t.length) {
    var c = t[i++];
    if (c === 'M') { open(num(i), num(i + 1)); i += 2; }
    else if (c === 'L') {
      if (!cur) open(start ? start.x : 0, start ? start.y : 0);
      cur.anchors.push(anchor(num(i), num(i + 1)));
      i += 2;
    } else if (c === 'C') {
      if (!cur) open(start ? start.x : 0, start ? start.y : 0);
      cur.anchors[cur.anchors.length - 1].out = pt(num(i), num(i + 1));
      var a = anchor(num(i + 4), num(i + 5));
      a.in = pt(num(i + 2), num(i + 3));
      cur.anchors.push(a);
      i += 6;
    } else if (c === 'Z') close();
  }
  var ok = function (q) { return isFinite(q.x) && isFinite(q.y); };
  return subs.filter(function (s) {
    return s.anchors.length > 1 && s.anchors.every(function (a) { return ok(a.p) && ok(a.in) && ok(a.out); });
  });
}

/** A drawing's colour (#rgb or #rrggbb) as VectorCraft's paint; none for none. */
function iwdieVcPaint(hex) {
  var c = iwdieDrawColor(hex);
  if (!c) return { type: 'none' };
  if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  var ch = function (k) { return Math.round(parseInt(c.substr(k, 2), 16) / 255 * 1e6) / 1e6; };
  return { type: 'solid', color: { model: 'rgb', r: ch(1), g: ch(3), b: ch(5) } };
}

/** A shape's style as VectorCraft's appearance: its fill, then its stroke with cap, join and dashes. */
function iwdieVcAppearance(st) {
  st = st || {};
  var items = [];
  if (st.fill) items.push({ kind: 'fill', paint: iwdieVcPaint(st.fill) });
  if (st.stroke && st.sw > 0) {
    var s = { kind: 'stroke', paint: iwdieVcPaint(st.stroke), width: st.sw };
    if (st.cap === 'round') s.cap = 'Round'; else if (st.cap === 'square') s.cap = 'Square';
    if (st.join === 'round') s.join = 'Round'; else if (st.join === 'bevel') s.join = 'Bevel';
    var da = (Array.isArray(st.da) && st.da.length) ? st.da : (st.dash ? [8, 6] : null);
    if (da) s.dash = { pattern: da, offset: 0, align_corners: false };
    items.push(s);
  }
  return { items: items };
}

/** A component's shape as a VectorCraft node: a group (with its name), a path, point text
 *  (v1.40.0, in Source Sans 3, which VectorCraft carries) or a picture (v1.43.0, its PNG kept in
 *  `ids.images`). Anything else is left out. `ids.next` numbers the nodes. */
function iwdieVcNode(s, ids) {
  if (!s) return null;
  if (s.t === 'group') {
    var kids = (s.items || []).map(function (c) { return iwdieVcNode(c, ids); }).filter(Boolean);
    if (!kids.length) return null;
    var g = { id: ids.next++, kind: { type: 'group', children: kids, clip: false } };
    if (s.name) g.name = s.name;
    return g;
  }
  if (s.t === 'text') {
    if (!s.text || !isFinite(s.x) || !isFinite(s.y)) return null;
    var ink = iwdieVcPaint(s.st && s.st.fill);
    return { id: ids.next++, appearance: { items: [] }, kind: { type: 'text', kind: { kind: 'point' }, xf: [1, 0, 0, 1, s.x, s.y],
      runs: [{ text: String(s.text), style: { font_family: 'Source Sans 3', font_style: s.bold ? 'Semibold' : 'Regular', size: s.size > 0 ? s.size : 12, tracking: 0,
        baseline_shift: 0, h_scale: 100, v_scale: 100, rotation: 0, fill: ink.type === 'none' ? iwdieVcPaint('#000000') : ink,
        stroke: { type: 'none' }, stroke_width: 0, underline: false, strikethrough: false, all_caps: false } }],
      para: { justify: 'Left', left_indent: 0, right_indent: 0, first_line_indent: 0, space_before: 0, space_after: 0, hyphenate: false } } };
  }
  if (s.t === 'image') {
    // a picture (v1.43.0): its PNG among the document's images, drawn into its box as large as fits
    var png = /^data:image\/png;base64,([A-Za-z0-9+\/=]+)$/.exec(String(s.src || ''));
    if (!png || !(s.iw > 0) || !(s.ih > 0) || !(s.w > 0) || !(s.h > 0) || !ids.images) return null;
    var key = 'iwdie-' + iwdieVcPixelHash(iwdieUtf8Encode(png[1]));
    ids.images[key] = { mime: 'image/png', data: png[1] };
    var k = Math.min(s.w / s.iw, s.h / s.ih), dx = (s.w - s.iw * k) / 2, dy = (s.h - s.ih * k) / 2;
    return { id: ids.next++, kind: { type: 'image', key: key, width: s.iw, height: s.ih, xf: [k, 0, 0, k, (s.x || 0) + dx, (s.y || 0) + dy] } };
  }
  if (s.t !== 'd') return null;
  var subs = iwdieVcSubpaths(s.d);
  if (!subs.length) return null;
  var n = { id: ids.next++, appearance: iwdieVcAppearance(s.st), kind: { type: 'path', path: { subpaths: subs }, rule: s.rule === 'evenodd' ? 'EvenOdd' : 'NonZero' } };
  if (s.st && typeof s.st.op === 'number' && s.st.op < 1) n.opacity = s.st.op;
  return n;
}

/** One component as a native VectorCraft document (.vectorcraft, format version 1): an artboard
 *  round it, one layer, the component a group named as it is. -> JSON text */
function iwdieVcNativeDoc(item) {
  var ids = { next: 3, images: {} }, name = (item && item.name) || 'Komponent';
  var kids = ((item && item.shapes) || []).map(function (s) { return iwdieVcNode(s, ids); }).filter(Boolean);
  var top = { id: ids.next++, name: name, kind: { type: 'group', children: kids, clip: false } };
  var w = Math.max(0, +item.w || 0), h = Math.max(0, +item.h || 0);
  return JSON.stringify({
    format: 'vectorcraft', version: 1, generator: 'IWMAC Designer Import/Export ' + IWDIE_VERSION,
    document: {
      version: 1, title: name, units: 'Points', color_mode: 'Rgb',
      artboards: [{ id: 1, name: name, rect: { x0: -1, y0: -1, x1: w + 1, y1: h + 1 }, show_center_mark: false, show_cross_hairs: false }],
      layers: [{ id: 2, name: 'Layer 1', kind: { type: 'layer', color: { Preset: 0 }, template: false, printable: true, children: [top] } }],
      next_id: ids.next, grid: { spacing: 72, subdivisions: 8 }, guides: [], images: {}, graphic_styles: [], swatch_groups: [], swatches: [],
      symbols: [], raster_effects_ppi: 72
    },
    images: ids.images
  });
}

/** The component library as a .vclibrary file: a graphic per component (an unnamed one is
 *  called after its layer and number), a group per Illustrator layer, in the file's order.
 *  `thumbs[k]` is component k's PNG thumbnail as base64, or empty. `opts` names another library
 *  and the prefix of its graphics' ids (v1.40.0): {name, prefix}. -> JSON text */
function iwdieVcLibraryFile(lib, thumbs, opts) {
  opts = opts || {};
  var graphics = [], groups = [], byName = {}, count = {}, prefix = opts.prefix || 'iwdie-';
  ((lib && lib.items) || []).forEach(function (it, k) {
    var layer = it.layer || 'Komponenter', id = prefix + (k + 1);
    count[layer] = (count[layer] || 0) + 1;
    graphics.push({ id: id, name: it.name || (layer + ' ' + count[layer]), width: it.w, height: it.h,
      data: iwdieBytesToBase64(iwdieUtf8Encode(iwdieVcNativeDoc(it))), thumbnail: (thumbs && thumbs[k]) || '' });
    if (!byName[layer]) { byName[layer] = { name: layer, items: [] }; groups.push(byName[layer]); }
    byName[layer].items.push({ kind: 'graphic', item: id });
  });
  return JSON.stringify({ name: opts.name || ('Komponenter' + (lib && lib.file ? ' - ' + lib.file : '')), colors: [], charStyles: [], paraStyles: [],
    graphics: graphics, groups: groups });
}

/** A component's thumbnail as SVG, at most `max` px a side (VectorCraft takes up to 256),
 *  with a little room round it. -> {svg, w, h} */
function iwdieVcThumbSvg(item, max) {
  max = max || 128;
  var pad = 2, w = Math.max(+item.w || 0, 1) + 2 * pad, h = Math.max(+item.h || 0, 1) + 2 * pad;
  var k = Math.min(4, max / Math.max(w, h)), W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  var defs = iwdieDrawDefsSvg(item.shapes);
  return { w: W, h: H, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="' +
    [-pad, -pad, w, h].map(iwdieDrawFmt).join(' ') + '">' + (defs ? '<defs>' + defs + '</defs>' : '') +
    item.shapes.map(function (s) { return iwdieDrawShapeSvg(s); }).join('') + '</svg>' };
}

/* ===================== Ready for Image Trace, and lighter documents (v1.38.0) =====================
   VectorCraft's Image Trace follows the pixels it is given. A panel picture has small text and
   anti-aliased edges: traced as it is, the text breaks up; enlarged smoothly, every in-between
   shade along an edge becomes shapes of its own (38,535 paths, 32 MB, for a Maskin panel).
   Enlarged three times and with every pixel set to the picture's own flat colours, it traces
   clean: the edges where the enlargement puts them, the text whole, only the real colours.
   And a traced panel is a big document, so the one kept in the background PNG is compressed,
   and stored without VectorCraft's own copy of it when that would still be too big. */

/** Private PNG chunk with the VectorCraft SVG, zlib-compressed (v1.38.0; iwVc holds it plain). */
var IWDIE_VC_ZCHUNK = 'iwVz';
/** Compressed bytes a kept VectorCraft document may take before it is kept without its own
 *  embedded copy (Preserve Editing Capabilities). Every viewer of the panel loads them. */
var IWDIE_VC_BUDGET = 1024 * 1024;

/** The flat colours a picture is made of: its exact colours covering at least 0.02 % of it each,
 *  near-twins merged, and the in-between shades of anti-aliased edges left out - a colour on the
 *  line between two kept colours, rarer than half the rarer of them. At most 16, the commonest
 *  first. `flat`: those colours cover nearly all of it, which a photo's do not.
 *  -> {colors: [[r, g, b]], covered, flat} */
function iwdieVcFlatPalette(rgba, w, h) {
  var n = w * h, count = new Map(), i, key;
  for (i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    count.set(key, (count.get(key) || 0) + 1);
  }
  var min = Math.max(1, n * 0.0002), cand = [], covered = 0;
  count.forEach(function (c, k) { if (c >= min) { cand.push([k, c]); covered += c; } });
  cand.sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
  var d2 = function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
  var pal = [];
  cand.forEach(function (e) {
    var c = [(e[0] >> 16) & 255, (e[0] >> 8) & 255, e[0] & 255], j, m;
    for (j = 0; j < pal.length; j++) if (d2(pal[j].c, c) < 225) { pal[j].n += e[1]; return; }
    for (j = 0; j < pal.length; j++) {
      for (m = j + 1; m < pal.length; m++) {
        var a = pal[j].c, b = pal[m].c, ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
        if (!L) continue;
        var t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / L;
        if (t < 0.12 || t > 0.88) continue;
        if (d2([a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]], c) < 64 && e[1] < 0.5 * Math.min(pal[j].n, pal[m].n)) return;
      }
    }
    if (pal.length < 16) pal.push({ c: c, n: e[1] });
  });
  var share = n ? covered / n : 0;
  return { colors: pal.map(function (p) { return p.c; }), covered: Math.round(share * 1000) / 1000, flat: share >= 0.85 && pal.length > 1 };
}

/** Every pixel of `rgba` set to its nearest colour of `colors`, and fully opaque or fully clear.
 *  Changes `rgba` and returns it. */
function iwdieVcSnap(rgba, colors) {
  var cache = new Map();
  for (var i = 0; i + 3 < rgba.length; i += 4) {
    var key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2], best = cache.get(key);
    if (best === undefined) {
      var bd = Infinity;
      for (var j = 0; j < colors.length; j++) {
        var c = colors[j], x = c[0] - rgba[i], y = c[1] - rgba[i + 1], z = c[2] - rgba[i + 2], d = x * x + y * y + z * z;
        if (d < bd) { bd = d; best = j; }
      }
      cache.set(key, best);
    }
    var col = colors[best];
    rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2];
    rgba[i + 3] = rgba[i + 3] < 128 ? 0 : 255;
  }
  return rgba;
}

/** How much to enlarge a picture before it is traced: three times, less for a big one, so that
 *  at most 12 million pixels are traced. */
function iwdieVcTraceScale(w, h) {
  return Math.max(1, Math.min(3, Math.sqrt(12e6 / Math.max(1, w * h))));
}

/** The background picture in an SVG: its first embedded PNG or JPEG covering at least half of
 *  `w` × `h` (any size when they are not given), else the largest. -> {start, end, href} with
 *  `start`/`end` the href value's place in `svg`, or null */
function iwdieVcFindPicture(svg, w, h) {
  var s = String(svg || ''), re = /<image\b[^>]*>/gi, m, best = null;
  while ((m = re.exec(s))) {
    var tag = m[0], href = /\s(?:xlink:)?href\s*=\s*"(data:image\/(?:png|jpeg);base64,[A-Za-z0-9+\/=\s]+)"/i.exec(tag);
    if (!href) continue;
    var num = function (a) { var r = new RegExp('\\s' + a + '\\s*=\\s*"\\s*([\\d.]+)').exec(tag); return r ? parseFloat(r[1]) : 0; };
    var start = m.index + href.index + href[0].indexOf('"') + 1, hit = { start: start, end: start + href[1].length, href: href[1] };
    if (w > 0 && h > 0 && num('width') * num('height') >= 0.5 * w * h) return hit;
    if (!best || hit.href.length > best.href.length) best = hit;
  }
  return best;
}

/** A VectorCraft SVG without the copy of its document it carries (Preserve Editing
 *  Capabilities): what VectorCraft draws stays as it is, so it reopens as the same layers and
 *  paths, and an emptied <metadata> goes too. */
function iwdieVcStripEditing(svg) {
  return String(svg || '')
    .replace(/[ \t]*<vectorcraft:document\b[\s\S]*?<\/vectorcraft:document>[ \t]*\r?\n?/g, '')
    .replace(/[ \t]*<metadata>\s*<\/metadata>[ \t]*\r?\n?/g, '');
}

/** The VectorCraft document a PNG keeps: {type: 'iwVz' (compressed) | 'iwVc' (plain), data}, the
 *  compressed one first, or null. */
function iwdieVcChunk(png) {
  var chunks = iwdiePngChunks(png);
  if (!chunks) return null;
  var plain = null;
  for (var i = 0; i < chunks.length; i++) {
    if (!chunks[i].data.length) continue;
    if (chunks[i].type === IWDIE_VC_ZCHUNK) return { type: IWDIE_VC_ZCHUNK, data: chunks[i].data };
    if (chunks[i].type === IWDIE_VC_CHUNK && !plain) plain = { type: IWDIE_VC_CHUNK, data: chunks[i].data };
  }
  return plain;
}

/** A short hash of bytes (FNV-1a), to name a picture by what it is (v1.43.0). */
function iwdieVcPixelHash(d) {
  var h = 2166136261;
  for (var i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ===================== IWMAC objects in VectorCraft (v1.40.0) =====================
   The Designer's own objects - values, labels, alarms, fans, pumps... - as a VectorCraft library
   of placeholders, one per id of the object catalogue at its palette size, grouped by role.
   Placed on the drawing and saved back, each placeholder becomes that object in the panel, where
   it was placed and at the size it was given, and leaves the background picture. A placeholder
   is a group named "IWMAC <obj_id>": that name is what makes it one. */

/** The name every placeholder starts with. */
var IWDIE_VC_OBJ_PREFIX = 'IWMAC ';
/** The library's name in VectorCraft's Libraries panel. */
var IWDIE_VC_OBJ_LIBRARY = 'IWMAC-objekter';
/** What each role of the catalogue is called in the library. */
var IWDIE_VC_OBJ_ROLES = {
  header: 'Headers', label: 'Labels', value: 'Values', value_conn: 'Values with connector', value_tag: 'Values with tag',
  enum: 'Lists', alarm: 'Alarms', led: 'LEDs', fan: 'Fans', pump: 'Pumps', valve: 'Valves', coil: 'Coils', filter: 'Filters',
  damper: 'Dampers', duct: 'Ducts', zone: 'Zones', sensor: 'Sensors', akpc: 'AK-PC groups', button: 'Buttons'
};
/** Roles whose object shows a text of its own: the placeholder carries it, to be written over. */
var IWDIE_VC_OBJ_TEXT = { header: 'Header', label: 'Label', value_tag: 'Tag' };
/** Stacking order by role - the bands seen on production panels - for a panel with no object
 *  of that kind or role yet to copy it from. Dummy arrows are 15. */
var IWDIE_VC_OBJ_Z = {
  header: '5', duct: '5', button: '20', fan: '40', coil: '40', filter: '40', damper: '40', zone: '40', akpc: '40',
  value: '110', value_conn: '110', value_tag: '110', enum: '110', sensor: '110',
  alarm: '375', led: '375', pump: '375', valve: '375', label: '1100'
};

/** How each object looks and how big it is on the Designer's canvas (v1.43.0), from its own two
 *  registries (reference_data, 2026-10-10): the render definition's size, which is what production
 *  panels place (a "40px Box" 42 × 22, the header 250 × 20) - labels size to their text and are
 *  placed 50 wide - its picture under /iw_icons/ (the render definition's file, else the palette's),
 *  its default tag text, whether it has a tag, and what the placeholder shows: the picture, the
 *  label's text, or the header's bar. The Designer's live `controls` and pictures refine it.
 *  id -> [w, h, picture, tag, has a tag, kind] */
var IWDIE_VC_OBJ_LOOK = {
  'number_v3_header_grey75': [250, 20, 'V3/assets/grey75_header.png', 'INFO', 1, 'bar'],
  'number_v3_label_11px_norm': [50, 20, 'V3/assets/11pxn.png', 'Label', 1, 'label'],
  'number_v3_label_10px_bold': [50, 20, 'V3/assets/10pxb.png', 'Label', 1, 'label'],
  'number_v3_label_12px_bold': [50, 20, 'V3/assets/12pxb.png', 'Label', 1, 'label'],
  'number_v3_label_8px_norm': [50, 20, 'V3/assets/8pxn.png', 'Label', 1, 'label'],
  'number_v3_label_11px_bold': [50, 20, 'V3/assets/11pxb.png', 'Label', 1, 'label'],
  'number_v3_label_10px_norm': [50, 20, 'V3/assets/10pxn.png', 'Label', 1, 'label'],
  'number_v3_value_only': [50, 20, 'V3/textboxes/black_val_only.png', '', 0, 'picture'],
  'number_v3_40px_no_conn_no_tag': [42, 22, 'V3/textboxes/62x22_plain_textbox.png', '', 1, 'picture'],
  'number_v3_white_value_only': [50, 20, 'V3/textboxes/white_val_only.png', '', 0, 'picture'],
  'number_v3_60px_dark_no_conn_no_tag': [62, 22, 'V3/textboxes/60px_dark_no_conn.png', '', 1, 'picture'],
  'number_v3_60px_no_conn_no_tag': [62, 22, 'V3/textboxes/62x22_plain_textbox.png', '', 1, 'picture'],
  'number_v3_60px_dark_no_conn': [62, 22, 'V3/textboxes/60px_dark_no_conn.png', 'RT-XX', 1, 'picture'],
  'number_v3_60px_no_conn': [62, 22, 'V3/textboxes/62x22_plain_textbox.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_45px_con_down': [46, 38, 'V3/textboxes/45px_connector_down.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_45px_con_left': [62, 22, 'V3/textboxes/45px_connector_left.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_45px_con_top': [46, 38, 'V3/textboxes/45px_connector_up.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_45px_con_right': [62, 22, 'V3/textboxes/45px_connector_right.png', 'RT-XX', 1, 'picture'],
  'number_v3_40px_dark_con_down': [41, 26, 'V3/textboxes/41x26_RefTemp_LineDown.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_45px_no_conn_tag_up_center': [46, 22, 'V3/textboxes/46x21_plain_textbox.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_40px_no_conn_tag_up_center': [42, 22, 'V3/textboxes/41x21_plain_textbox.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_45px_no_conn_bott_center': [46, 22, 'V3/textboxes/46x21_plain_textbox.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_60px_no_conn_tag_up_center': [62, 22, 'V3/textboxes/62x22_plain_textbox.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_40px_no_conn_tag_up_left': [42, 22, 'V3/textboxes/41x21_plain_textbox.png', 'RT-XX', 1, 'picture'],
  'number_v3_R_45px_no_conn_tag_up_left': [46, 22, 'V3/textboxes/46x21_plain_textbox.png', 'RT-XX', 1, 'picture'],
  'number_v3_custom_json_obj': [60, 20, 'V3/textboxes/110px_no_conn.png', 'RT-XX', 1, 'picture'],
  'number_v3_60px_json_obj': [60, 20, 'V3/textboxes/60px_dark_no_conn.png', 'RT-XX', 1, 'picture'],
  'V3_R_34px_circular_alarm_nrm': [34, 34, 'V3/refrigeration/status_symbols/BellPumping_34.gif', '', 0, 'picture'],
  'V3_R_28px_circular_cooling_nrm': [28, 28, 'V3/refrigeration/status_symbols/FreezeIcon_28.png', '', 0, 'picture'],
  'V3_R_28px_circular_defrost_nrm': [28, 28, 'V3/refrigeration/status_symbols/DefrostIcon_28.png', '', 0, 'picture'],
  'V3_R_24px_anim_rg_alarm_nrm': [24, 24, 'V3/refrigeration/status_symbols/anim_alarm_24.gif', '', 0, 'picture'],
  'V3_ok_alarm_nrm': [61, 21, 'V3/refrigeration/status_symbols/alarm.png', '', 0, 'picture'],
  'V3_led_13px_circ_grey_green': [13, 13, 'V3/indicators/13x13_cir_led_green.png', '', 0, 'picture'],
  'V3_led_21px_square_grey_red': [21, 21, 'V3/indicators/21x21_sq_led_red.png', '', 0, 'picture'],
  'V3_led_16px_circ_grey_red': [16, 16, 'V3/indicators/16x16_cir_led_red.png', '', 0, 'picture'],
  'V3_led_16px_circ_grey_yellow': [16, 16, 'V3/indicators/16x16_cir_led_yellow.png', '', 0, 'picture'],
  'V3_led_18px_circ_grey_red': [18, 18, 'V3/indicators/18x18_cir_led_red.png', '', 0, 'picture'],
  'V3_58px_fan_left_nrm': [59, 59, 'V3/hvac/fans/58x58_fan_left_on.png', 'JV50', 1, 'picture'],
  'V3_58px_fan_right_nrm': [59, 59, 'V3/hvac/fans/58x58_fan_right_on.png', 'JV40', 1, 'picture'],
  'V3_21px_single_pump_grey_green_down': [21, 21, 'V3/pumps/21x21_single_pump_down_on.png', 'JP40', 1, 'picture'],
  'V3_21px_single_pump_grey_green_left': [21, 21, 'V3/pumps/21x21_single_pump_left_on.png', 'JP40', 1, 'picture'],
  'V3_21px_single_pump_grey_green_up': [21, 21, 'V3/pumps/21x21_single_pump_up_on.png', 'JP40', 1, 'picture'],
  'number_v3_dummy_3way_motor_right': [30, 19, 'V3/valves/30x19_3way_motor_right.png', '', 1, 'picture'],
  'v3_3w_valve_right_down_nrm': [22, 18, 'V3/valves/3valve_Right_Down_ON.png', '', 0, 'picture'],
  'number_v3_cooler_2-way': [38, 132, 'V3/hvac/heatexchangers/38x132cooler_2way_colored.png', 'LK401', 1, 'picture'],
  'number_v3_el_heater': [40, 85, 'V3/hvac/heatexchangers/38x65_electric_heater.png', 'LV402', 1, 'picture'],
  'number_v3_heater_3_way': [40, 210, 'V3/hvac/heatexchangers/38x189_heater_colored.png', 'LV401', 1, 'picture'],
  'number_v3_filter_only': [27, 70, 'V3/hvac/filters/27x53_filter_only.png', 'MF401', 1, 'picture'],
  'numberV3_filter_with_diff_press': [90, 83, 'V3/textboxes/filter_with_diffpressure.png', 'QD401', 1, 'picture'],
  'V3_horis_damper_flow-left_nrm': [36, 26, 'V3/hvac/dampers/36x26_hor_plain_damper_open.png', 'KA401', 1, 'picture'],
  'V3_vert_damper_flow-up_inv': [26, 36, 'V3/hvac/dampers/26x36_ver_flow_up_damper_closed.png', 'KA402', 1, 'picture'],
  'number_v3_dummy_resirc_damp_hor': [42, 42, 'V3/hvac/dampers/dampers_dummy_portrait.png', 'KA-XX', 1, 'picture'],
  'number_v3_dummy_resirc_damp_vert': [70, 40, 'V3/hvac/dampers/dampers_dummy_landscape.png', 'KA-XX', 1, 'picture'],
  'number_v3_exhaust_pipe_horisontal': [50, 18, 'V3/hvac/ducts/exhaust_pipe_horisontal.png', '', 1, 'picture'],
  'number_v3_exhaust_pipe_vertical': [18, 50, 'V3/hvac/ducts/exhaust_pipe_vertical.png', '', 1, 'picture'],
  'number_v3_dummy_21x17_Arrow_Left': [21, 17, 'V3/connectors/21x17_Arrow_Left.png', '', 1, 'picture'],
  'number_v3_dummy_21x17_Arrow_Right': [21, 17, 'V3/connectors/21x17_Arrow_Right.png', '', 1, 'picture'],
  'number_v3_dummy_6x15_Line_Small_Down': [6, 15, 'V3/connectors/6x15_Line_Small_Down.png', '', 1, 'picture'],
  'number_v3_exhaust_connector_up': [18, 50, 'V3/hvac/ducts/exhaust_connector_up.png', '', 1, 'picture'],
  'number_v3_fresh_pipe_horisontal': [50, 18, 'V3/hvac/ducts/fresh_pipe_horisontal.png', '', 1, 'picture'],
  'number_v3_supply_connector_down': [18, 50, 'V3/hvac/ducts/supply_connector_down.png', '', 1, 'picture'],
  'number_v3_supply_pipe_horisontal': [50, 18, 'V3/hvac/ducts/supply_pipe_horisontal.png', '', 1, 'picture'],
  'number_v3_supply_pipe_vertical': [18, 50, 'V3/hvac/ducts/supply_pipe_vertical.png', '', 1, 'picture'],
  'number_360_room': [100, 339, 'V3/dummy/360_room.png', '', 1, 'picture'],
  'number_360_vb': [37, 70, 'V3/dummy/360_vb.png', '', 1, 'picture'],
  'number_360_vg_rot': [60, 343, 'V3/dummy/360_vg_rot.png', '', 1, 'picture'],
  'number_v3_rc_temp_48': [49, 21, 'V3/roomcontrol/temp_val_48.png', '', 1, 'picture'],
  'numberV3_outside_temp': [79, 50, 'V3/textboxes/utetemp.png', 'RT-90', 1, 'picture'],
  'V3_akpc_772_781_781A_783_contr': [81, 21, 'V3/refrigeration/status_symbols/danfoss/state_ready_grey.png', '', 0, 'picture'],
  'V3_akpc_782A_suct': [81, 21, 'V3/refrigeration/status_symbols/danfoss/normal_control.png', '', 0, 'picture'],
  'V3_akpc_783_781A_782A_cond': [81, 21, 'V3/refrigeration/status_symbols/danfoss/stopped.png', '', 0, 'picture'],
  'V3_81x21_enebled_disabled_nrm': [81, 21, 'V3/buttons/81x21_State_Enabled.png', '', 0, 'picture']
};
/** Where the Designer leaves the objects' looks for the editor's page: sizes and pictures. */
var IWDIE_VC_LOOKS_KEY = 'iwdie.vc.looks';

var iwdieVcObjCache = null;

/** The object catalogue as a list, in its order: [{id, w, h, role, desc, pic, tag, hasTag, kind}], at
 *  the size the Designer draws each object (IWDIE_VC_OBJ_LOOK; the catalogue's own sizes are the
 *  palette's). */
function iwdieVcObjectCatalog() {
  if (iwdieVcObjCache) return iwdieVcObjCache;
  var out = [], roles = (IWDIE_OBJECT_CATALOGUE && IWDIE_OBJECT_CATALOGUE.by_role) || {};
  Object.keys(roles).forEach(function (role) {
    (roles[role] || []).forEach(function (line) {
      var m = /^(\S+)\s+(\d+)x(\d+)\b(?:.*?\s-\s+(.*))?$/.exec(String(line));
      if (!m) return;
      var desc = String(m[4] || '').split(';')[0].replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
      var look = IWDIE_VC_OBJ_LOOK[m[1]] || [+m[2], +m[3], '', '', 0, 'picture'];
      out.push({ id: m[1], w: look[0], h: look[1], role: role, desc: desc, pic: look[2], tag: look[3], hasTag: !!look[4], kind: look[5] });
    });
  });
  return (iwdieVcObjCache = out);
}

/** The catalogue by id. */
function iwdieVcObjectIndex() {
  var known = {};
  iwdieVcObjectCatalog().forEach(function (o) { known[o.id] = o; });
  return known;
}

/** The catalogue with what the Designer gave of each object's look (`looks`, by id: {w, h, src,
 *  iw, ih, bar}): its live size, and its picture as a PNG data URL with that picture's own size
 *  and, for the header, the colour of its bar. Without looks, the catalogue as it is. */
function iwdieVcObjects(looks) {
  return iwdieVcObjectCatalog().map(function (o) {
    var l = looks && looks[o.id], c = {};
    Object.keys(o).forEach(function (k) { c[k] = o[k]; });
    if (!l) return c;
    if (l.w >= 1 && l.h >= 1) { c.w = Math.round(l.w); c.h = Math.round(l.h); }
    if (typeof l.src === 'string' && /^data:image\/png;base64,/.test(l.src) && l.iw > 0 && l.ih > 0) { c.src = l.src; c.iw = l.iw; c.ih = l.ih; }
    if (/^#[0-9a-f]{6}$/i.test(l.bar || '')) c.bar = l.bar;
    return c;
  });
}

/** The size of a placeholder's text, or 0 when the object is too small for one. */
function iwdieVcObjectTextSize(o) {
  var size = Math.min(8, o.h - 6);
  return (o.w >= 30 && size >= 6) ? size : 0;
}

/** What a placeholder without the object's picture says inside its box: the default text of an
 *  object that shows its own (Label, Header, Tag), else what the object is - without the size the
 *  box already shows - as far as it fits, cut after a whole word where that keeps most of it; ''
 *  for an object too small. */
function iwdieVcObjectCaption(o) {
  var size = iwdieVcObjectTextSize(o);
  if (!size) return '';
  var text = IWDIE_VC_OBJ_TEXT[o.role] || String(o.desc || o.id).replace(/^\d+px\s+/i, '').replace(/\s+-\s*/g, ' ');
  var room = Math.floor((o.w - 6) / (size * 0.5));
  if (text.length <= room) return text;
  if (room < 6) return '';
  var cut = text.slice(0, room - 1), trim = function (s) { return s.replace(/[\s,]+$/, ''); };
  var whole = trim(/\s/.test(text.charAt(room - 1)) ? cut : cut.replace(/\s*\S*$/, ''));
  return (whole.length >= (room - 1) * 0.6 ? whole : trim(cut)) + '…';
}

/** One object's placeholder as a library item, at the size the Designer draws it, inside a dashed
 *  box in the blue of the hidden layer of panel objects (v1.43.0):
 *  - a label: its text, at the label's own size and weight;
 *  - the header: its bar, with its text in white;
 *  - anything else, with the Designer's picture of it: that picture, and its tag text under it
 *    when it has a tag (JV50 on a fan), to be written over;
 *  - without the picture: the light box of v1.40.0, with what the object is in it. */
function iwdieVcObjectItem(o) {
  var w = o.w, h = o.h, box = 'M0 0 L' + w + ' 0 L' + w + ' ' + h + ' L0 ' + h + ' Z', shapes = [];
  var line = function (fill, op) { return { t: 'd', d: box, rule: '', st: { stroke: '#4f80ff', fill: fill, sw: 1, dash: false, arrow: false, da: [3, 2], op: op } }; };
  var text = function (x, y, s, size, fill, bold) {
    return { t: 'text', x: x, y: Math.round(y * 100) / 100, text: s, size: size, bold: !!bold, st: { stroke: null, fill: fill, sw: 0, dash: false, arrow: false } };
  };
  if (o.kind === 'label') {
    var px = +(/(\d+)px/.exec(o.id) || [0, 11])[1];
    shapes.push(line(null, 0.6), text(2, (h + px * 0.7) / 2, o.tag || 'Label', px, '#3c4650', /bold/.test(o.id)));
  } else if (o.kind === 'bar') {
    shapes.push({ t: 'd', d: box, rule: '', st: { stroke: null, fill: o.bar || '#6b7782', sw: 0, dash: false, arrow: false } });
    shapes.push(line(null, 0.6), text(6, (h + 11 * 0.7) / 2, o.tag || 'Header', 11, '#ffffff', true));
  } else if (o.src) {
    shapes.push({ t: 'image', x: 0, y: 0, w: w, h: h, src: o.src, iw: o.iw, ih: o.ih });
    shapes.push(line(null, 0.6));
    if (o.hasTag && o.tag) shapes.push(text(0, h + 9, o.tag, 8, '#3c4650'));
  } else {
    shapes.push(line('#eaf1ff', 0.8));
    var caption = iwdieVcObjectCaption(o), size = iwdieVcObjectTextSize(o);
    if (caption) shapes.push(text(3, (h + size * 0.7) / 2, caption, size, '#2f5fbf'));
  }
  return { name: IWDIE_VC_OBJ_PREFIX + o.id, layer: IWDIE_VC_OBJ_ROLES[o.role] || o.role, w: w, h: h, shapes: shapes };
}

/** The placeholders of the whole catalogue as library items, in its order, with the Designer's
 *  looks when there are any. */
function iwdieVcObjectItems(looks) {
  return iwdieVcObjects(looks).map(iwdieVcObjectItem);
}

/** One placeholder as an SVG file (v1.41.0), to be dropped on the drawing: VectorCraft places a
 *  dropped SVG centred on the drop point, as one group named after the file. Its text is in
 *  Source Sans 3, a font VectorCraft carries. */
function iwdieVcObjectSvg(o) {
  var it = iwdieVcObjectItem(o), f = iwdieDrawFmt;
  var parts = it.shapes.map(function (s) {
    if (s.t !== 'text') return iwdieDrawShapeSvg(s);
    return '<text x="' + f(s.x) + '" y="' + f(s.y) + '" font-family="Source Sans 3" font-size="' + f(s.size) + '"' +
      (s.bold ? ' font-weight="600"' : '') + ' fill="' + s.st.fill + '">' + iwdieDrawEsc(s.text) + '</text>';
  });
  // the tag text under the box is the file's too, so the SVG reaches to it; the box stays at 0, 0
  var vh = Math.max(it.h, it.shapes.reduce(function (m, s) { return s.t === 'text' ? Math.max(m, Math.ceil(s.y + 2)) : m; }, 0));
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + it.w + '" height="' + vh + '" viewBox="0 0 ' + it.w + ' ' + vh + '">' +
    parts.join('') + '</svg>';
}

/** The catalogue's objects whose id, description or role holds every word of `query`, in the
 *  catalogue's order (v1.41.0, the IWMAC menu's search). */
function iwdieVcObjectSearch(query) {
  var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return iwdieVcObjectCatalog().filter(function (o) {
    var hay = (o.id + ' ' + o.desc + ' ' + o.role + ' ' + (IWDIE_VC_OBJ_ROLES[o.role] || '')).toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  });
}

/** The catalogue id a placeholder's name stands for - "IWMAC number_v3_value_only", or the id
 *  VectorCraft's SVG gives it: "IWMAC_number_v3_value_only", "-2" added for the second - or
 *  null for a name that is no placeholder. A file's extension, which a dropped file's name
 *  brings, is no part of it. */
function iwdieVcObjectId(name) {
  var m = /^IWMAC[ _]+(\S+)$/.exec(String(name || '').trim());
  if (!m) return null;
  var known = iwdieVcObjectIndex();
  if (known[m[1]]) return m[1];
  var bare = m[1].replace(/-\d+$/, '').replace(/\.(svg|vectorcraft)$/i, '');
  return known[bare] ? bare : null;
}

/** The placeholders found in a saved drawing ([{id, x, y, w, h, text}], in panel pixels) as
 *  Designer objects: the 17 fields of an unlinked object, at the stacking order of the panel's
 *  own objects of that kind or role, else of its band. One that is already on the panel - an
 *  object of that kind within 2 px of it, as after an earlier save - is counted, not repeated.
 *  Its text becomes tag_text on a label, the header and an object with a tag (JV401 on a fan).
 *  `existing` is the panel's objects. -> {objects, already} */
function iwdieVcDesignerObjects(found, existing) {
  var known = iwdieVcObjectIndex();
  var have = (existing || []).filter(function (e) { return e && typeof e === 'object'; });
  var near = function (a, b) { var n = parseFloat(a); return isFinite(n) && Math.abs(n - b) <= 2; };
  var zOf = function (o) {
    var z = function (e) { return /^\d+$/.test(String(e.zIndex)) ? String(e.zIndex) : null; };
    var same = have.filter(function (e) { return e.obj_id === o.id && z(e); })[0] ||
      have.filter(function (e) { var k = known[e.obj_id]; return k && k.role === o.role && z(e); })[0];
    if (same) return z(same);
    if (o.role === 'duct' && /arrow/i.test(o.id)) return '15';
    return IWDIE_VC_OBJ_Z[o.role] || '110';
  };
  var objects = [], already = 0;
  (found || []).forEach(function (f) {
    var o = f && known[f.id];
    if (!o || !isFinite(f.x) || !isFinite(f.y) || !(f.w > 0) || !(f.h > 0)) return;
    var x = Math.round(f.x), y = Math.round(f.y), w = Math.max(1, Math.round(f.w)), h = Math.max(1, Math.round(f.h));
    var there = have.concat(objects).some(function (e) {
      return e.obj_id === o.id && near(e.posLeft, x) && near(e.posTop, y) && near(e.posWidth, w) && near(e.posHeight, h);
    });
    if (there) { already++; return; }
    // its text is the object's tag text: a label's or the header's as written; on an object with a
    // tag, as written, its default included (v1.43.0); not what a placeholder without the object's
    // picture says the object is, and nothing for an object without a tag
    var text = String(f.text || '').replace(/\s+/g, ' ').trim();
    if (o.kind !== 'label' && o.kind !== 'bar' && (!o.hasTag || text === iwdieVcObjectCaption(o))) text = '';
    objects.push({ obj_id: o.id, name: 'object_0', id: 'driver_id', posWidth: w, posHeight: h, posLeft: x, posTop: y, zIndex: zOf(o),
      tag_text: text, linked: 'false', link_name: '', link_tag: '', sub_group: '', driver_id: 'driver_id', unit_id: '', unit_ref: '', alias_text: '' });
  });
  return { objects: objects, already: already };
}

/** The placeholders of a saved drawing taken out of it, to become objects: each group whose
 *  name makes it one goes, with all it holds (one inside another is part of it). `doc` is the
 *  drawing parsed as XML; `measure(groups)` gives each one's box in panel pixels ({x, y, w, h}),
 *  {hidden: true} for a hidden one, which stays as it is, or null, in order. One without a box
 *  goes too, and is counted. -> {found: [{id, x, y, w, h, text}], skipped} */
function iwdieVcTakePlaceholders(doc, measure) {
  var groups = doc.getElementsByTagName('g'), picked = [];
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i], id = iwdieVcObjectId(g.getAttribute('data-name') || g.getAttribute('id'));
    if (!id) continue;
    var inner = false;
    for (var p = g.parentNode; p && p.nodeType === 1 && !inner; p = p.parentNode) {
      for (var j = 0; j < picked.length; j++) if (picked[j].g === p) { inner = true; break; }
    }
    if (!inner) picked.push({ g: g, id: id });
  }
  if (!picked.length) return { found: [], skipped: 0 };
  var boxes = measure(picked.map(function (q) { return q.g; })) || [], found = [], skipped = 0;
  picked.forEach(function (q, k) {
    var box = boxes[k], texts = q.g.getElementsByTagName('text'), words = [];
    if (box && box.hidden) return;
    for (var t = 0; t < texts.length; t++) {
      var spans = texts[t].getElementsByTagName('tspan');
      if (!spans.length) words.push(texts[t].textContent);
      for (var s = 0; s < spans.length; s++) words.push(spans[s].textContent);
    }
    if (box && box.w > 0 && box.h > 0) found.push({ id: q.id, x: box.x, y: box.y, w: box.w, h: box.h, text: words.join(' ') });
    else skipped++;
    if (q.g.parentNode) q.g.parentNode.removeChild(q.g);
  });
  return { found: found, skipped: skipped };
}

/* ===================== Sync to IWMAC Designer (v1.42.0) =====================
   Ctrl+S in the editor offers to sync the drawing to the Designer tab it came from. The Designer
   sets it as the panel's background and uploads its PNG to the plant's pictures on the server, as
   Manage Images' Upload to server (designer_site/iw_upload_image.php) and Set background
   (imagesetValue) do. */

/** Where this script notes the pictures it uploaded, by plant: a name of its own may be written
 *  over by a later sync, a picture it did not upload never is. */
var IWDIE_VC_UPLOADS_KEY = 'iwdie.vc.uploads';

/** The name a panel's picture is uploaded under: plant, panel and day, as the plants' own pictures
 *  are named ("2349_oversikt_100326.png"), with "-2", "-3"... while that name is taken by a
 *  picture this script did not upload. `taken`: the names on the server; `ours`: the ones this
 *  script uploaded. æ, ø and å are written ae, o and a, and anything but letters, digits, dots
 *  and dashes "_". */
function iwdieVcUploadName(plant, panel, date, taken, ours) {
  var latin = String(panel || '').replace(/æ/g, 'ae').replace(/Æ/g, 'Ae').replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/å/g, 'a').replace(/Å/g, 'A');
  var safe = latin.replace(/[^A-Za-z0-9.-]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '') || 'panel';
  var d = date || new Date(), two = function (v) { return (v < 10 ? '0' : '') + v; };
  var plantPart = String(plant || '').replace(/[^A-Za-z0-9]+/g, '');
  var stem = (plantPart ? plantPart + '_' : '') + safe + '_' + two(d.getDate()) + two(d.getMonth() + 1) + two(d.getFullYear() % 100);
  var set = function (list) { var o = {}; (list || []).forEach(function (n) { o[String(n).toLowerCase()] = 1; }); return o; };
  var onServer = set(taken), mine = set(ours);
  for (var k = 1; k < 100; k++) {
    var name = stem + (k > 1 ? '-' + k : '') + '.png', low = name.toLowerCase();
    if (!onServer[low] || mine[low]) return name;
  }
  return stem + '-' + d.getTime() + '.png';
}

/** The pictures' names in the server's list of a plant's pictures (designer_site/iw_get_image.php:
 *  <data><name>…</name><file>…</file></data>…). */
function iwdieVcImageNames(xml) {
  var out = [], re = /<name>\s*([^<]*?)\s*<\/name>/gi, m;
  while ((m = re.exec(String(xml || '')))) if (m[1]) out.push(m[1]);
  return out;
}

/** The server's answer to an upload, read as Upload to server reads it: JSON {status, message},
 *  taken when status == 1. Anything else is a refusal, shown as text. -> {ok, message} */
function iwdieVcUploadReply(text) {
  var s = String(text || '').trim(), j = null;
  try { j = JSON.parse(s); } catch (e) { j = null; }
  if (j && typeof j === 'object') {
    // get_image.htm compares loosely (status == 1): 1, "1" and true all count
    var ok = j.status === 1 || j.status === '1' || j.status === true;
    return { ok: ok, message: j.message == null ? '' : String(j.message) };
  }
  return { ok: false, message: s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'the server gave no answer' };
}

/* ===================== browser body ===================== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    var W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (W.__IWDIE_LOADED) return;
    W.__IWDIE_LOADED = true;
    // On the VectorCraft page (v1.35.0) only the bridge runs; the Designer part does not belong there.
    if (location.hostname === 'hapnes-dev.github.io' || document.getElementById('vectorcraft_canvas')) { vcAppSide(); return; }

    /* ---------- styles ---------- */
    var CSS = [
      '.iwdie-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(25,25,25,.95);color:#fff;',
      '  padding:10px 18px;border-radius:6px;font:13px/1.5 Roboto,Arial,sans-serif;z-index:2147483647;max-width:640px;box-shadow:0 4px 18px rgba(0,0,0,.4);white-space:pre-line}',
      '.iwdie-toast.iwdie-err{background:rgba(140,30,30,.96)}',
      '.iwdie-toast.iwdie-good{background:rgba(30,110,50,.96)}',
      '.iwdie-toast.iwdie-caution{background:rgba(150,100,10,.96)}',
      /* An insert's outcome (v1.31.0): title, facts, the save reminder, and a × */
      '.iwdie-toast.iwdie-rich{white-space:normal;text-align:left;min-width:360px;max-width:600px;max-height:60vh;overflow:auto;padding:12px 40px 12px 16px}',
      '.iwdie-t-title{font-weight:700;font-size:14px}',
      '.iwdie-t-lines{margin:6px 0 0;padding:0;list-style:none}',
      '.iwdie-t-lines li{margin:3px 0}',
      '.iwdie-t-sub{margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.25);font-size:11px;letter-spacing:.03em;text-transform:uppercase;opacity:.8}',
      '.iwdie-t-findings{margin-top:3px}',
      '.iwdie-t-foot{margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.25);font-size:12px;opacity:.85}',
      '.iwdie-t-x{position:absolute;top:6px;right:8px;width:24px;height:24px;border:none;background:transparent;color:#fff;opacity:.75;font:18px/24px Arial,sans-serif;cursor:pointer;padding:0;border-radius:4px}',
      '.iwdie-t-x:hover{opacity:1;background:rgba(255,255,255,.15)}',
      '.iwdie-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483647}',
      '.iwdie-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:520px;max-width:92vw;max-height:86vh;overflow:auto;',
      '  background:#fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);z-index:2147483647;font:13px/1.5 Roboto,Arial,sans-serif;color:#222;padding:18px 20px}',
      '.iwdie-panel h3{margin:0 0 10px;font-size:15px}',
      '.iwdie-panel label{display:block;margin:10px 0 4px;font-weight:500}',
      '.iwdie-drop{border:2px dashed #9aa7b3;border-radius:6px;padding:18px;text-align:center;color:#556;margin:8px 0;cursor:pointer}',
      '.iwdie-drop:hover,.iwdie-drop:focus{border-color:#2f6fb2;outline:none}',
      '.iwdie-drop.iwdie-over{border-color:#2f6fb2;color:#2f6fb2;background:#eef5fc}',
      /* The Insert dialog (v1.31.0): the source form, then the review in its place */
      '.iwdie-panel.iwdie-import{width:600px}',
      '.iwdie-intro{color:#3b4550;margin:0 0 4px}',
      '.iwdie-pick{color:#2f6fb2;text-decoration:underline;font-weight:600}',
      '.iwdie-or{margin:12px 0 4px;color:#7a8590;font-size:12px}',
      '.iwdie-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}',
      '.iwdie-actions .iwdie-btn{margin:0}',
      '.iwdie-actions .iwdie-link{margin-left:auto}',
      '.iwdie-btn.iwdie-quick{background:#fff;color:#2f6fb2;box-shadow:inset 0 0 0 1px #2f6fb2}',
      '.iwdie-btn.iwdie-quick:hover{background:#eef4fa}',
      '.iwdie-link{background:none;border:none;color:#2f6fb2;cursor:pointer;font:13px Roboto,Arial,sans-serif;padding:6px 2px}',
      '.iwdie-link:hover{text-decoration:underline}',
      '.iwdie-review-foot{position:sticky;bottom:-18px;margin:10px -20px -18px;padding:10px 20px 14px;background:#fff;border-top:1px solid #e1e6eb}',
      '.iwdie-review-foot .iwdie-actions{margin-top:0}',
      '.iwdie-foot-note{margin-top:8px;color:#5a6570;font-size:12px}',
      '.iwdie-options{margin-top:14px;border-top:1px solid #e1e6eb;padding-top:8px}',
      '.iwdie-options>summary{cursor:pointer;color:#3b4550;font-weight:500;user-select:none}',
      '.iwdie-options .iwdie-opt{margin-top:8px}',
      '.iwdie-panel textarea{width:100%;height:110px;box-sizing:border-box;font:12px/1.4 Consolas,monospace}',
      '.iwdie-btn{display:inline-block;background:#2f6fb2;color:#fff;border:none;border-radius:4px;padding:7px 14px;margin:8px 8px 0 0;cursor:pointer;font:13px Roboto,Arial,sans-serif}',
      '.iwdie-btn:hover{background:#265d96}',
      '.iwdie-btn.iwdie-secondary{background:#7a8794}',
      /* The check report (v1.31.0): the verdict banner carries the colour, each
         section its own, and long lists fold away under "show all". */
      '.iwdie-errlist{margin:2px 0 0}',
      '.iwdie-verdict{border:1px solid #e3b3b3;border-left:5px solid #c0392b;border-radius:7px;padding:11px 14px;margin:0 0 10px;background:#fdecec}',
      '.iwdie-errlist.iwdie-warn .iwdie-verdict{background:#fff6df;border-color:#ecd08a;border-left-color:#d49a00}',
      '.iwdie-errlist.iwdie-ok .iwdie-verdict{background:#e9f6ec;border-color:#a9d3a9;border-left-color:#2e8b47}',
      '.iwdie-v-title{font-size:15px;font-weight:700;line-height:1.35}',
      '.iwdie-v-sub{margin-top:3px;color:#3b4550}',
      '.iwdie-v-file{margin-top:5px;font:11.5px Consolas,monospace;color:#6b7580;overflow-wrap:anywhere}',
      '.iwdie-glance{display:grid;grid-template-columns:max-content 1fr max-content 1fr;gap:5px 12px;padding:9px 12px;margin:0 0 10px;border:1px solid #e1e6eb;border-radius:6px;background:#fafbfc;font-size:12.5px}',
      '.iwdie-g-k{color:#7a8590}',
      '.iwdie-g-v{font-weight:500;overflow-wrap:anywhere}',
      '.iwdie-sec{border:1px solid #d5dbe1;border-radius:6px;padding:8px 12px;margin:0 0 10px}',
      '.iwdie-sec-bad{background:#fdf0f0;border-color:#e3b3b3}',
      '.iwdie-sec-warn{background:#fff8e6;border-color:#e6c77a}',
      '.iwdie-sec-info{background:#eef4fb;border-color:#c5d8ee}',
      '.iwdie-sec-h{font-weight:700;margin-bottom:2px}',
      '.iwdie-sec-h .iwdie-hint{font-weight:400;margin-left:4px}',
      '.iwdie-findings{margin:0;padding-left:18px}',
      '.iwdie-findings>li{margin:6px 0 0;line-height:1.45}',
      '.iwdie-why{color:#4a545e}',
      '.iwdie-items summary,.iwdie-more summary{cursor:pointer;color:#2f6fb2;font-size:12px;user-select:none;width:max-content}',
      '.iwdie-items ul{margin:4px 0 2px;padding-left:16px;max-height:150px;overflow:auto;font:12px/1.5 Consolas,monospace;color:#444}',
      '.iwdie-more{margin:0 0 4px;font-size:12.5px;color:#3b4550}',
      '.iwdie-more ul{margin:6px 0 0;padding-left:18px}',
      '.iwdie-more li{margin:3px 0}',
      '.iwdie-diag{background:#fff;border:1px solid #e3b3b3;border-radius:5px;padding:8px 12px;margin:8px 0}',
      '.iwdie-diag ul{margin:6px 0 0;padding-left:18px}',
      '.iwdie-diag li{font-family:Consolas,monospace;font-size:12px;color:#444}',
      '.iwdie-fixtext{display:block;width:100%;box-sizing:border-box;height:220px;margin-top:8px;font:11px Consolas,monospace;white-space:pre;overflow:auto;border:1px solid #c3c9cf;border-radius:4px;padding:8px;background:#fbfbfb}',
      '.iwdie-x{position:absolute;top:6px;right:8px;width:26px;height:26px;border:none;background:transparent;color:#66788a;font:18px/26px Arial,sans-serif;cursor:pointer;border-radius:4px;padding:0}',
      '.iwdie-x:hover{background:#e8edf2;color:#222}',
      '.iwdie-choice{border:1px solid #d5dbe1;border-radius:6px;padding:10px 12px;margin:10px 0;background:#f7f9fb}',
      '.iwdie-choice>div{margin-top:6px;color:#445;font-size:12.5px;line-height:1.45}',
      '.iwdie-choice .iwdie-btn{margin:0}',
      /* Background-only switch (v1.10.0). Highlighted when armed, because it
         changes what every other control in the dialog ends up doing. */
      '.iwdie-opt{border:1px solid #d5dbe1;border-radius:6px;padding:10px 12px;margin:10px 0;background:#f7f9fb}',
      '.iwdie-opt.iwdie-on{border-color:#2f6fb2;background:#eef4fa}',
      '.iwdie-opt label{display:flex;align-items:flex-start;gap:8px;margin:0;font-weight:600;cursor:pointer}',
      '.iwdie-opt input{margin:2px 0 0}',
      '.iwdie-opt .iwdie-hint{margin-top:6px;color:#445;font-size:12.5px;line-height:1.45}',
      '.iwdie-hint{color:#778;font-size:11.5px;margin-top:6px}',
      /* Fact strip for the mid-import questions — the numbers the answer
         depends on, out of the prose and impossible to miss. */
      '.iwdie-facts{margin:10px 0;padding:10px 12px;border:1px solid #cfdcea;border-radius:6px;background:#eef4fa;font-size:13px;line-height:1.6}',
      '.iwdie-facts div+div{margin-top:4px}',
      '.iwdie-facts code{font:12px Consolas,monospace;background:#fff;border:1px solid #d5dbe1;border-radius:3px;padding:1px 5px}',
      '.iwdie-arrow{color:#2f6fb2;font-weight:700;margin:0 6px}',
      /* Export Background (v1.34.0), in VectorCraft's Medium Dark: its tokens as custom
         properties, so other dialogs can follow. Flat panel, 1 px border, radius 6, choice
         cards with a 2 px accent ring, one blue pill for the one action. */
      '.iwdie-vc{--vc-panel:#535353;--vc-panel-darker:#424242;--vc-input:#454545;--vc-border:#383838;--vc-divider:#4b4b4b;--vc-text:#d1d1d1;',
      '  --vc-text-strong:#ffffff;--vc-text-dim:#b0b0b0;--vc-text-disabled:#7a7a7a;--vc-hover:#606060;--vc-button-border:#747474;--vc-accent:#378ef0;',
      '  --vc-accent-strong:#1473e6;--vc-font:"Source Sans 3","Source Sans Pro","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
      '.iwdie-vc-back{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.12)}',
      '.iwdie-vc-dlg{position:fixed;left:50%;top:calc(50% - 40px);transform:translate(-50%,-50%);z-index:2147483647;width:460px;max-width:calc(100vw - 60px);',
      '  max-height:calc(100vh - 40px);overflow:auto;padding:22px;box-sizing:border-box;background:var(--vc-panel);border:1px solid var(--vc-border);border-radius:6px;',
      '  box-shadow:0 8px 14px rgba(0,0,0,.55);font:400 13px/1.326 var(--vc-font);color:var(--vc-text);text-align:left}',
      '.iwdie-vc-dlg h2{margin:0 0 4px;font:600 16px/1.326 var(--vc-font);color:var(--vc-text);border:0;padding:0;background:none}',
      /* v1.34.2: the Designer's V3_designer.css ends a rule with ", span" - every span on the
         page gets #5e6468, 14 px and weight 500 - so the option labels went dark on dark. */
      '.iwdie-vc-dlg span{color:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;font-family:inherit}',
      '.iwdie-vc-sub{margin:0 0 14px;font-size:11.5px;color:var(--vc-text-dim)}',
      '.iwdie-vc-sub b{color:var(--vc-text);font-weight:600}',
      '.iwdie-vc-cards{display:grid;gap:8px}',
      '.iwdie-vc-card{display:grid;grid-template-columns:13px 1fr;column-gap:8px;align-items:start;padding:8px 12px;background:var(--vc-panel-darker);border-radius:6px;transition:background 80ms}',
      '.iwdie-vc-card:hover,.iwdie-vc-card.iwdie-on{background:var(--vc-hover)}',
      '.iwdie-vc-card.iwdie-on{box-shadow:inset 0 0 0 2px var(--vc-accent)}',
      '.iwdie-vc-card.iwdie-off{opacity:.45;pointer-events:none}',
      '.iwdie-vc-dlg input[type=radio],.iwdie-vc-dlg input[type=checkbox]{-webkit-appearance:none;appearance:none;width:13px;height:13px;margin:2px 0 0;flex:0 0 13px;',
      '  border:1px solid var(--vc-button-border);background:var(--vc-input);box-sizing:border-box}',
      '.iwdie-vc-dlg input[type=radio]{border-radius:50%}',
      '.iwdie-vc-dlg input[type=checkbox]{border-radius:2px}',
      '.iwdie-vc-dlg input[type=radio]:checked{background:radial-gradient(#fff 2.5px,transparent 3px),var(--vc-accent-strong);border-color:var(--vc-accent-strong)}',
      '.iwdie-vc-dlg input[type=checkbox]:checked{background:var(--vc-accent-strong) url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 13 13%27%3E%3Cpath d=%27M3 6.6l2.4 2.4L10 4.2%27 fill=%27none%27 stroke=%27%23fff%27 stroke-width=%271.6%27/%3E%3C/svg%3E") center/13px 13px no-repeat;border-color:var(--vc-accent-strong)}',
      '.iwdie-vc-dlg input:disabled{opacity:.5}',
      '.iwdie-vc-t{font:600 12.5px var(--vc-font);color:var(--vc-text-strong)}',
      '.iwdie-vc-d{margin-top:2px;font-size:11.5px;color:var(--vc-text-dim)}',
      '.iwdie-vc-opts{margin-top:7px;display:none}',
      '.iwdie-vc-card.iwdie-on .iwdie-vc-opts{display:block}',
      '.iwdie-vc-opt{display:flex;align-items:flex-start;gap:7px;margin:5px 0 0;font-size:12.5px;color:var(--vc-text);font-weight:400}',
      '.iwdie-vc-opt small{color:var(--vc-text-dim);font-size:11.5px}',
      '.iwdie-vc-opt.iwdie-off{color:var(--vc-text-disabled)}',
      '.iwdie-vc-hint{margin-top:12px;font-size:11.5px;color:var(--vc-text-dim)}',
      '.iwdie-vc-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
      '.iwdie-vc-pill{height:28px;min-width:72px;padding:0 16px;border:0;border-radius:14px;font:600 12.5px var(--vc-font);cursor:default;transition:background 80ms}',
      '.iwdie-vc-primary{background:var(--vc-accent-strong);color:#fff}',
      '.iwdie-vc-primary:hover{background:var(--vc-accent)}',
      '.iwdie-vc-secondary{background:transparent;color:var(--vc-text);box-shadow:inset 0 0 0 1.5px var(--vc-text-dim)}',
      '.iwdie-vc-secondary:hover{background:var(--vc-hover)}',
      '.iwdie-vc-pill:focus-visible,.iwdie-vc-card:focus-visible{outline:1px solid var(--vc-accent);outline-offset:1px}',
      '#manager_widget_iwdie fieldset{margin-top:4px}',
      /* The host hard-codes #manager_div to height:900px (overflow-y:auto);
         the added full-size button rows make the content taller, so the
         sidebar must be allowed to fit its content. NO viewport cap: the
         v1.3.3 calc(100vh - 110px) cap made short windows clip/scroll the
         last fieldset inside the sidebar. Instead the sidebar simply grows
         (min-height keeps the host's original column look) and overflow is
         forced visible so it can never grow an internal scrollbar - on
         short windows the page's own scroll reaches the bottom, exactly
         like it does for tall canvases. */
      '#manager_div{height:auto !important;min-height:900px !important;max-height:none !important;overflow:visible !important}',
      /* THE actual clipper (found v1.5.5): the host wraps the whole sidebar
         in #master_wrapper, hard-coded height:900px + overflow hidden — it
         cut the last ~18px of the Panel JSON fieldset at ANY window size
         (the constant "little cut off" under the final button). Relax it the
         same way as #manager_div: grow with content, never clip. */
      '#master_wrapper{height:auto !important;min-height:900px !important;overflow:visible !important}',
      /* Compact mode — applied by updateCompact() ONLY when the full column
         would not fit the window (measured, with hysteresis): tightens the
         8px fieldset gaps to 4px and trims fieldset paddings, reclaiming
         ~68px so the whole Panel JSON fieldset stays visible on ~1080p
         windows. Button size is untouched (28px); on tall windows the
         sidebar keeps the host's stock spacing. */
      '#manager_div.iwdie-compact fieldset{margin-top:4px !important;padding-top:4px !important;padding-bottom:6px !important}',
      '#manager_div.iwdie-compact #manager_widget_iwdie button{margin-top:2px !important}',
      /* Parameter-selector export button: our own td injected after the host's
         UNIT NAME item (w2ui toolbar "nolinkable_toolbar"). Own element, own
         handler — deliberately NOT a w2ui toolbar item, so the host's
         radio/checked state machine ("PS Select which item adds to Label")
         cannot be disturbed by clicking it. */
      '#iwdie_param_export_td .w2ui-button,#iwdie_param_export_all_td .w2ui-button{cursor:pointer;margin-left:6px;border:1px solid transparent;border-radius:4px}',
      '#iwdie_param_export_td .w2ui-button:hover,#iwdie_param_export_all_td .w2ui-button:hover{background:#eef5fc;border-color:#9aa7b3}',
      /* Export-all progress panel. The overlay is load-bearing, not cosmetic:
         it keeps the user from clicking the units grid while the walk drives
         it, which would corrupt the snapshots. */
      '.iwdie-progress-panel{width:420px}',
      '.iwdie-progress-panel h3{margin-bottom:14px}',
      '.iwdie-progress-track{height:18px;background:#e4e9ee;border-radius:9px;overflow:hidden;margin:10px 0 8px}',
      '.iwdie-progress-fill{height:100%;width:0;background:#2f6fb2;border-radius:9px;transition:width .2s}',
      '.iwdie-progress-line{font-size:13px;color:#334;min-height:18px}',
      '.iwdie-progress-sub{font-size:12px;color:#778;margin-top:2px}',
      '.iwdie-progress-note{font-size:11.5px;color:#996a00;background:#fdf6e3;border:1px solid #e8d9a0;border-radius:5px;padding:6px 10px;margin-top:10px}',
      ''].join('\n');
    try {
      if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); }
      else { var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
    } catch (e) {
      var st2 = document.createElement('style'); st2.textContent = CSS; document.head.appendChild(st2);
    }

    /* ---------- tiny UI helpers ---------- */
    /* Where overlays and toasts must live to be SEEN. The PARAMETER SELECTOR's
       jQuery-UI wrapper carries z-index 2147483646 — one below the int32 max —
       so anything appended to <body> paints and hit-tests beneath it, however
       high its own z-index. While that dialog is open, script UI is therefore
       reparented into the wrapper; its stacking context puts our elements on
       top and lets real clicks reach them. */
    function overlayParent() {
      var pp = document.getElementById('param_popup');
      if (pp) {
        var dlg = pp.closest('.ui-dialog');
        if (dlg && dlg.style.display !== 'none') return dlg;
      }
      return document.body;
    }

    /* tone (v1.30.0): 'good' green for a finished insert, 'caution' amber for one
       that went in with warnings; isErr still wins and paints it red. */
    /* One toast at a time (v1.31.0): a new one replaces the last, so two never
       stack unreadably on the same spot. Hovering holds it. */
    var liveToast = null;

    function showToastEl(t, ms) {
      if (liveToast && liveToast.parentNode) liveToast.remove();
      liveToast = t;
      overlayParent().appendChild(t);
      var timer = null;
      var arm = function () {
        clearTimeout(timer);
        timer = setTimeout(function () { t.remove(); if (liveToast === t) liveToast = null; }, ms);
      };
      t.addEventListener('mouseenter', function () { clearTimeout(timer); });
      t.addEventListener('mouseleave', arm);
      arm();
    }

    function toast(msg, isErr, ms, tone) {
      try {
        var t = document.createElement('div');
        t.className = 'iwdie-toast' + (isErr ? ' iwdie-err' : tone ? ' iwdie-' + tone : '');
        t.textContent = msg;
        showToastEl(t, ms || 5000);
      } catch (e) { /* noop */ }
    }

    /** An insert's outcome (iwdieInsertOutcome) as a toast: the title, one line
     *  per fact about the insert, then what the check found in the file under a
     *  label of its own (v1.31.1) - so a ⚠ about the layout on a green toast
     *  reads as the file's, not as a failed insert - the save reminder, and ×
     *  to close. Green goes by itself, later the more it has to say; amber and
     *  red stay until closed, because they say something did not go in. */
    function outcomeToast(out) {
      var list = function (items, cls) {
        return '<ul class="' + cls + '">' + items.map(function (l) { return '<li>' + iwdieEscHtml(l) + '</li>'; }).join('') + '</ul>';
      };
      var lines = out.lines || [], findings = out.findings || [];
      try {
        var t = document.createElement('div');
        t.className = 'iwdie-toast iwdie-rich iwdie-' + out.tone;
        t.setAttribute('role', out.tone === 'good' ? 'status' : 'alert');
        t.innerHTML = '<button class="iwdie-t-x" title="Close">×</button>' +
          '<div class="iwdie-t-title">' + iwdieEscHtml(out.title) + '</div>' +
          (lines.length ? list(lines, 'iwdie-t-lines') : '') +
          (findings.length ? '<div class="iwdie-t-sub">From the check — about the file, not the insert</div>' +
            list(findings, 'iwdie-t-lines iwdie-t-findings') : '') +
          (out.footer ? '<div class="iwdie-t-foot">' + iwdieEscHtml(out.footer) + '</div>' : '');
        t.querySelector('.iwdie-t-x').addEventListener('click', function () {
          t.remove();
          if (liveToast === t) liveToast = null;
        });
        showToastEl(t, out.tone === 'good' ? Math.min(30000, 8000 + 1500 * (lines.length + findings.length)) : 60000);
      } catch (e) {
        toast(out.title + '\n' + lines.concat(findings).join('\n'), out.tone === 'err', 15000, out.tone === 'err' ? '' : out.tone);
      }
    }

    function hostOk(msg) { if (typeof W.V3ok_message === 'function') { try { W.V3ok_message(msg); return; } catch (e) {} } toast(msg); }

    /* ---------- host readiness ---------- */
    function hostReady() {
      return typeof W.getPanelDataFromDOM === 'function' &&
        typeof W.get_plant_id === 'function' &&
        typeof W.DesignPanelHandler === 'function' &&
        typeof W.UpdateObjectWorker === 'function' &&
        !!document.getElementById('manager_widget7');
    }

    /* ---------- sidebar fieldset (inline onclick — the sidebar is loaded with
       innerHTML += which would strip addEventListener handlers) ---------- */
    function ensureFieldset() {
      var existing = document.querySelectorAll('#manager_widget_iwdie');
      for (var i = 1; i < existing.length; i++) existing[i].remove(); // de-dupe
      if (existing.length > 0) return;
      var w7 = document.getElementById('manager_widget7');
      if (!w7) return;
      /* Four stacked buttons at the host's standard btn_full size; the
         sidebar-height relaxation in the injected CSS keeps the manager
         sidebar scrollbar-free (see the #manager_div rule above). */
      var html = [
        "<div id='manager_widget_iwdie'>",
        '  <fieldset>',
        '    <legend>Panel JSON</legend>',
        "    <button id='iwdie_export_btn' class='btn_full ui-button ui-corner-all' onclick=\"window.__IWDIE.doExport()\">Export JSON</button>",
        "    <button id='iwdie_import_btn' class='btn_full ui-button ui-corner-all' onclick=\"window.__IWDIE.openImportPanel()\">Insert JSON…</button>",
        "    <button id='iwdie_vc_btn' class='btn_full ui-button ui-corner-all' title='Edit the background in VectorCraft, a vector editor, in a new tab - saving there updates this panel' onclick=\"window.__IWDIE.editInVectorCraft()\">Edit in VectorCraft…</button>",
        "    <button id='iwdie_ai_btn' class='btn_full ui-button ui-corner-all' title='Background → Adobe Illustrator (.ai / .svg)' onclick=\"window.__IWDIE.doExportBackgroundAi()\">Background → Illustrator</button>",
        '  </fieldset>',
        '</div>'].join('\n');
      w7.insertAdjacentHTML('afterend', html);
    }

    /* Toggle the sidebar's compact spacing based on whether the full column
       fits the window. Hysteresis: turning compact OFF regrows the column by
       ~68px, so only leave compact when the regrown height would also fit —
       otherwise the class would flap on every check. */
    function updateCompact() {
      var md = document.getElementById('manager_div');
      var ours = document.getElementById('manager_widget_iwdie');
      if (!md || !ours) return;
      var fs = ours.querySelector('fieldset');
      if (!fs) return;
      var bottom = fs.getBoundingClientRect().bottom;
      var compact = md.classList.contains('iwdie-compact');
      if (!compact && bottom > window.innerHeight) md.classList.add('iwdie-compact');
      else if (compact && bottom + 74 < window.innerHeight) md.classList.remove('iwdie-compact');
    }

    /* ---------- current panel context ---------- */
    function currentPanelName() {
      // get_value() is the host's own "current panel" accessor (selected option
      // text of #plant_panels_select). last_save_name defaults to the stale
      // literal "test" and only the XML save path updates it — use it last.
      try { if (typeof W.get_value === 'function') { var v = W.get_value(); if (v) return v; } } catch (e) {}
      var sel = document.getElementById('plant_panels_select');
      if (sel && sel.value) return sel.value;
      try {
        if (W.last_save_name && typeof W.last_save_name === 'string' && W.last_save_name !== 'test') return W.last_save_name;
      } catch (e) {}
      return 'panel';
    }

    function currentPlantId() {
      try { return String(W.get_plant_id()); } catch (e) {}
      var m = /[?&]plant_id=(\d+)/.exec(location.search);
      return m ? m[1] : '';
    }

    /* ---------- collect current canvas into the host's own document ----------
       allowEmpty: an object-less panel is not automatically a mistake. A
       background-only panel (an "Oversikt" picture nobody has linked out from
       yet) is exactly the case where the picture still needs to come out — the
       export path decides that, not the collector. */
    function collectCurrentDoc(allowEmpty) {
      if (!hostReady()) { toast('IWMAC Designer not ready yet — host functions missing.', true); return null; }
      // the host's own save path resets these before collecting (container_tool.js)
      W.obj_data = []; W.container_data = []; W.container_items = [];
      var imgName = '';
      try { imgName = W.$('#main_image').attr('main_image') || ''; } catch (e) {}
      var doc;
      try {
        doc = W.getPanelDataFromDOM(currentPlantId(), currentPanelName(), imgName, W.get_user_name());
      } catch (e) {
        toast('Collecting the panel failed: ' + e, true);
        return null;
      }
      if (!doc) { toast('Collecting the panel failed — the host returned nothing.', true); return null; }
      if (!allowEmpty && iwdieCountDocItems(doc) === 0) {
        toast('Canvas is empty — load a panel first (Retrieve → Load), then export.', true);
        return null;
      }
      return doc;
    }

    /* ---------- background embedding ----------
       The host's own embedded-image format: converted:"true" + image_data
       (renderPanel consumes it via iw_set_base_image). If the canvas bg is
       already a data: URL we lift it; if it is a server URL we fetch+encode. */
    function embedBackground(doc) {
      return new Promise(function (resolve) {
        var bg = '';
        try { bg = W.$('#main_image').css('background-image') || ''; } catch (e) {}
        var m = /url\("?(.*?)"?\)/.exec(bg);
        if (!m || !m[1]) { resolve(doc); return; }
        var url = m[1];
        if (url.indexOf('data:') === 0) {
          doc.converted = 'true';
          doc.image_data = url;
          resolve(doc);
          return;
        }
        fetch(url, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(function (blob) {
          var fr = new FileReader();
          fr.onload = function () { doc.converted = 'true'; doc.image_data = fr.result; resolve(doc); };
          fr.onerror = function () { resolve(doc); };
          fr.readAsDataURL(blob);
        }).catch(function () {
          // keep org_image_name reference only
          resolve(doc);
        });
      });
    }

    /* ---------- export ---------- */
    function buildEnvelopeAsync(allowEmpty) {
      var doc = collectCurrentDoc(allowEmpty);
      if (!doc) return Promise.resolve(null);
      return embedBackground(doc).then(function (d) { return iwdieBuildEnvelope(d); });
    }

    /* shared tracer options, tuned for the flat schematic style
       (numberofcolors only applies when no custom palette is derived) */
    function traceOpts() {
      return {
        numberofcolors: 16, ltres: 0.5, qtres: 0.5, pathomit: 4,
        rightangleenhance: true, roundcoords: 1, strokewidth: 0,
        linefilter: false, viewbox: true, desc: false,
        // the palette is derived from the image already; letting the tracer
        // re-average it over its own assignment drifts a 2000-pixel colour into
        // whatever light pixels land nearest - the fresh-air blue vanished that way
        colorquantcycles: 1
      };
    }

    /* traceOpts + a palette from the drawing's own colours, so flat
       schematics keep their pipe colours instead of washing to grey.

       Only the main-thread fallback needs this: traceInWorker derives the same
       palette inside the worker now, which is where a 26-72 ms scan of a
       1.05 Mpx buffer belongs. Deriving it out here first was what forced the
       old "MUST run before traceInWorker" ordering — the transfer detaches the
       buffer, so nothing could read it afterwards. */
    /* The embedded trace exists so an AI can read where things are, and a
       12 337-path 2 MB drawing cannot do that — it is bigger than the context
       it has to fit in. Dropping paths shorter than IWDIE_TRACE_STRUCTURE_PATHOMIT
       points removes the text speckle and keeps the equipment: measured on a
       Maskin panel, 451 paths and 141 kB instead of 12 337 and 2060 kB, with
       every pipe run, the vessel, the gascooler and its fans, the compressors
       and the field pills still in place. Text is lost, which costs nothing —
       the labels are in single_objects[].tag_text, spelled properly. */
    function traceOptsStructure() {
      var o = traceOpts();
      o.pathomit = IWDIE_TRACE_STRUCTURE_PATHOMIT;
      return o;
    }

    function traceOptsStructureFor(imgData) {
      var o = traceOptsStructure();
      var pal = iwdieBuildPalette(imgData, IWDIE_TRACE_PALETTE_COLORS);
      if (pal) o.pal = pal;
      return o;
    }

    function traceOptsFor(imgData) {
      var o = traceOpts();
      var pal = iwdieBuildPalette(imgData, IWDIE_TRACE_PALETTE_COLORS);
      if (pal) o.pal = pal;
      return o;
    }

    /* The pixels the tracer should see: the background composited onto the
       canvas colour, enlarged by iwdieTraceScaleFor() when the source is small
       enough to be worth it. Returns {data, scale} or null. Built fresh each
       time because the worker transfer detaches the buffer. */
    function buildTraceSource(img, w, h, fillCss, forceScale) {
      var scale = forceScale || iwdieTraceScaleFor(w, h);
      var cw = w * scale, ch = h * scale;
      try {
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.imageSmoothingEnabled = false; // nearest, or the trace gets worse
        ctx.fillStyle = fillCss;
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        return { data: ctx.getImageData(0, 0, cw, ch), scale: scale };
      } catch (e) { return null; }
    }

    function traceRasterBackground(bg) {
      if (!IWDIE_TRACER) return Promise.reject(new Error('Background tracer is unavailable.'));
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error('Background image has no size.')); return; }
          var fillCss = grabBackgroundFillColor();
          // structure, not fidelity: this trace is read, not printed, so it is
          // taken at 1x with small paths dropped. Supersampling it would cost 4x
          // the time to add detail that is then thrown away.
          var got = buildTraceSource(img, w, h, fillCss, 1);
          if (!got) { reject(new Error('Could not read background image pixels for tracing.')); return; }
          var prog = openTraceProgress('Tracing the background for the export');
          var finish = function (svg) {
            prog.step({ phase: 'tidy' });
            var out = iwdieTidyTraceSvg(svg, got.scale, w, h);
            prog.close();
            resolve(out);
          };
          var job = traceInWorker(got.data, traceOptsStructure(), IWDIE_TRACE_PALETTE_COLORS, prog.step);
          prog.onCancel(job.cancel);
          job.promise.then(finish).catch(function (workerError) {
            if (!workerError || workerError.kind !== 'no-worker') {
              prog.close();
              reject(workerError && workerError.kind === 'cancelled'
                ? new Error('Trace cancelled - the export was stopped.')
                : new Error('Vector trace failed: ' + (workerError && workerError.message ? workerError.message : workerError)));
              return;
            }
            // no worker (old browser / strict CSP): the main thread does it,
            // after the panel has painted. The first buffer was transferred
            // into the worker, so both the pixels and the palette are taken again.
            prog.step({ phase: 'main-thread' });
            setTimeout(function () {
              try {
                var again = buildTraceSource(img, w, h, fillCss, 1);
                if (!again) throw new Error('could not rebuild the pixels');
                finish(IWDIE_TRACER.imagedataToSVG(again.data, traceOptsStructureFor(again.data)));
              } catch (fallbackError) {
                prog.close();
                reject(new Error('Vector trace failed in worker and main-thread fallback: ' + workerError + '; ' + fallbackError));
              }
            }, 80);
          });
        };
        img.onerror = function () { reject(new Error('Background image failed to load.')); };
        img.src = bg;
      });
    }

    /* quiet: the caller reports both files in one message instead — two
       hostOk() calls would just overwrite each other. Returns the filename. */
    function downloadEnvelope(env, traceNote, quiet) {
      var name = iwdieBuildExportFilename(env.source_plant_id, env.panel_name);
      var blob = new Blob([iwdieStringifyEnvelope(env)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      if (!quiet) hostOk('Exported ' + iwdieSummarize(env.panel) + (env.background_embedded ? ' + background' : '') + traceNote + ' → ' + name);
      return name;
    }

    /* Background-only export (v1.11.0). An "Oversikt" panel that nobody has
       linked out from yet collects as zero objects, and refusing to export it
       was the one case where the button had nothing to offer — while being
       exactly the case where the picture is what you need: hand the image to
       an AI, let it place the link hotspots, insert the result back as JSON.
       So: save the picture verbatim (no re-encode, no trace — a trace of a
       photo background costs minutes and a template has no use for it) and
       the background-only envelope beside it, as the schema to fill in. */
    function exportBackgroundOnly(env) {
      var url = grabBackgroundUrl();
      var plant = env.source_plant_id, panel = env.panel_name;
      if (!url) {
        toast('Nothing to export — the canvas has no objects and no background picture.\n' +
          'Load a panel first (Retrieve → Load).', true, 8000);
        return;
      }
      return flattenBackgroundForSave(url, grabBackgroundFillColor()).then(function (got) {
        var ext = iwdieBackgroundExt(got.mime || url);
        var imgName = iwdieBuildBackgroundFilename(plant, panel, ext);
        downloadBytes(got.bytes, imgName, got.mime || iwdieBackgroundMime(ext));
        // the envelope follows as a second download in the same gesture; both
        // files are reported once, after the second one has actually fired
        setTimeout(function () {
          var jsonName = downloadEnvelope(env, '', true);
          hostOk('Canvas is empty — exported the picture instead → ' + imgName + ' (' +
            Math.round(got.bytes.length / 1024) + ' kB, ' + (env.panel_width || '?') + ' × ' + (env.panel_height || '?') +
            '), plus ' + jsonName + ' as the background-only template to add objects to. ' +
            'Chrome asks once per site before the second file — allow it, and Keep both.');
        }, 400);
      }).catch(function (error) {
        toast('Could not save the background picture: ' + (error && error.message ? error.message : error), true, 8000);
      });
    }

    function doExport() {
      buildEnvelopeAsync(true).then(function (env) {
        if (!env) return null;
        if (iwdieCountDocItems(env.panel) === 0) return exportBackgroundOnly(env);
        return iwdieCompleteExport(env, {
          decodeUtf8: function (bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); },
          traceRaster: traceRasterBackground,
          download: downloadEnvelope
        });
      }).catch(function (error) {
        toast('Export blocked: ' + (error && error.message ? error.message : error) + '\nNo JSON was downloaded.', true, 9000);
      });
    }

    /* ---------- background → Illustrator (.ai / .svg) ---------- */
    function downloadBytes(bytes, name, mime) {
      var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }

    function grabBackgroundUrl() {
      var bg = '';
      try { bg = W.$('#main_image').css('background-image') || ''; } catch (e) {}
      var m = /url\("?(.*?)"?\)/.exec(bg);
      return m && m[1] ? m[1] : '';
    }

    /* The colour the designer paints *behind* a transparent PNG. Oversikt
       panels routinely store the floorplan as holes in the PNG (alpha 0) and
       let #main_image's CSS background-color show through — rgb(204,204,204)
       on the live host. Exporting those bytes as-is makes viewers composite
       the holes onto black. */
    function grabBackgroundFillColor() {
      try {
        var c = W.$('#main_image').css('background-color');
        if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c;
      } catch (e) {}
      return 'rgb(204, 204, 204)';
    }

    /* Opaque PNG/JPG stays the original bytes. A PNG with any alpha is
       flattened onto the canvas CSS background-color and re-encoded as PNG
       so the file matches what the designer shows. */
    function flattenBackgroundForSave(url, fillCss) {
      return new Promise(function (resolve, reject) {
        // The original bytes are only wanted on the opaque branch, where they
        // are handed back untouched. Fetching them up front meant a full
        // decode — and, for a background held as a server URL rather than a
        // data: URL, a whole HTTP round trip — thrown away every time the
        // picture had alpha, which is the normal case for these panels.
        var keepOriginal = function () { return fetchBackgroundBytes(url); };
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) { keepOriginal().then(resolve, reject); return; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          var imgd;
          try {
            ctx.drawImage(img, 0, 0);
            imgd = ctx.getImageData(0, 0, w, h);
          } catch (e) { keepOriginal().then(resolve, reject); return; }
          if (!iwdieImageHasTransparency(imgd.data)) { keepOriginal().then(resolve, reject); return; }
          var fill = iwdieParseCssColor(fillCss);
          // flatten into the buffer already owned rather than allocating a
          // second one the size of the image
          iwdieFlattenRgbaOnto(imgd.data, fill, imgd.data);
          try { ctx.putImageData(imgd, 0, 0); }
          catch (e) { keepOriginal().then(resolve, reject); return; }
          var finish = function (bytes) { resolve({ mime: 'image/png', bytes: bytes }); };
          if (typeof canvas.toBlob === 'function') {
            canvas.toBlob(function (blob) {
              if (!blob) { reject(new Error('could not flatten background')); return; }
              blob.arrayBuffer().then(function (ab) { finish(new Uint8Array(ab)); }).catch(reject);
            }, 'image/png');
          } else {
            var parsed = iwdieParseDataUrl(canvas.toDataURL('image/png'));
            if (!parsed) { reject(new Error('could not flatten background')); return; }
            finish(parsed.bytes);
          }
        };
        img.onerror = function () { reject(new Error('Could not load the background image')); };
        img.src = url;
      });
    }

    /* The background's own bytes, whatever they are — a data: URL is decoded
       in place, a server URL is fetched. Never re-encoded, so a PNG stays the
       exact PNG the panel shows. -> Promise<{mime, bytes}> */
    function fetchBackgroundBytes(url) {
      if (String(url).indexOf('data:') === 0) {
        var parsed = iwdieParseDataUrl(url);
        if (!parsed) return Promise.reject(new Error('the embedded background data URL could not be decoded'));
        return Promise.resolve(parsed);
      }
      return fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var mime = (r.headers.get('content-type') || '').split(';')[0];
        return r.arrayBuffer().then(function (ab) { return { mime: mime || '', bytes: new Uint8Array(ab) }; });
      });
    }

    /* raw deflate via the browser's native zlib (Chrome 80+) */
    function deflateBytes(u8) {
      if (typeof CompressionStream === 'undefined') return Promise.reject(new Error('CompressionStream unavailable'));
      var stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }

    /* The trace used to announce itself with one toast and then go quiet for
       the length of the job; when the worker broke in 1.28.0 and the job moved
       to the main thread, the only feedback left was Chrome's "Page
       Unresponsive". A centred panel with a bar, the stage the worker reports,
       the elapsed time and a Cancel that terminates the worker. */
    function openTraceProgress(title) {
      var overlay = document.createElement('div');
      overlay.className = 'iwdie-overlay';
      var panel = document.createElement('div');
      panel.className = 'iwdie-panel iwdie-progress-panel';
      panel.innerHTML = [
        '<h3>' + title + '</h3>',
        '<div class="iwdie-progress-line" id="iwdie_trace_line">Reading the pixels</div>',
        '<div class="iwdie-progress-track"><div class="iwdie-progress-fill" id="iwdie_trace_fill" style="width:2%"></div></div>',
        '<div class="iwdie-progress-sub" id="iwdie_trace_sub">0 s</div>',
        '<button class="iwdie-btn iwdie-secondary" id="iwdie_trace_cancel" style="margin-top:12px">Cancel</button>'
      ].join('\n');
      overlay.appendChild(panel);
      overlayParent().appendChild(overlay);
      var t0 = Date.now(), cancelled = false, onCancel = null;
      var line = panel.querySelector('#iwdie_trace_line');
      var fill = panel.querySelector('#iwdie_trace_fill');
      var sub = panel.querySelector('#iwdie_trace_sub');
      var btn = panel.querySelector('#iwdie_trace_cancel');
      var tick = setInterval(function () { sub.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 500);
      btn.addEventListener('click', function () {
        cancelled = true;
        btn.disabled = true;
        line.textContent = 'Cancelling...';
        if (onCancel) onCancel();
      });
      return {
        step: function (p) { var st = iwdieTraceProgress(p); fill.style.width = st.pct + '%'; line.textContent = st.line; },
        close: function () { clearInterval(tick); overlay.remove(); },
        onCancel: function (fn) { onCancel = fn; },
        cancelled: function () { return cancelled; }
      };
    }

    function traceError(kind, msg) {
      var e = new Error(String(msg && msg.message ? msg.message : msg));
      e.kind = kind;
      return e;
    }

    /* Run the vendored tracer in a Web Worker so long traces (photo
       backgrounds can take minutes) never freeze the tab. The whole library
       is one self-contained constructor, so its source can be lifted into
       the worker via Function.prototype.toString — no second copy needed.
       Returns {promise, cancel}. The promise rejects with e.kind 'no-worker'
       when no worker could be started (old browser, CSP without blob:
       worker-src) — the one case a main-thread fallback is for — 'cancelled'
       when cancel() was called, and 'worker' when the trace itself failed,
       which must never be retried on the main thread: that is the freeze. */
    function traceInWorker(imgData, opts, paletteColors, onProgress) {
      var handle = { cancel: function () {} };
      handle.promise = new Promise(function (resolve, reject) {
        var src, paletteSrc, deps;
        try {
          src = IWDIE_TRACER.constructor.toString();
          paletteSrc = iwdieBuildPalette.toString();
          deps = iwdieTraceWorkerDeps();
        } catch (e) { reject(traceError('no-worker', e)); return; }
        // The palette scan is lifted in the same way as the tracer itself, by
        // source: it is a pure function of the ImageData, and running it here
        // keeps a 26-72 ms pass over a 4 MB buffer off the UI thread.
        var code = iwdieBuildTraceWorkerCode(src, paletteSrc, deps);
        var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        var w;
        try { w = new Worker(url); } catch (e) { URL.revokeObjectURL(url); reject(traceError('no-worker', e)); return; }
        var done = function () { URL.revokeObjectURL(url); try { w.terminate(); } catch (e) {} };
        handle.cancel = function () { done(); reject(traceError('cancelled', 'cancelled')); };
        w.onmessage = function (ev) {
          var d = ev.data || {};
          if (d.progress) { if (onProgress) { try { onProgress(d.progress); } catch (e) { /* noop */ } } return; }
          done();
          if (d.svg) resolve(d.svg); else reject(traceError('worker', d.err || 'trace failed'));
        };
        w.onerror = function (ev) { done(); reject(traceError('worker', ev.message || 'error')); };
        w.postMessage(iwdieBuildTraceWorkerPayload(imgData, opts, paletteColors), [imgData.data.buffer]);
      });
      return handle;
    }

    function doExportBackgroundAi() {
      if (!hostReady()) { toast('IWMAC Designer not ready yet — host functions missing.', true); return; }
      var url = grabBackgroundUrl();
      if (!url) { toast('This panel has no background image. Load a panel with one (Retrieve → Load) first.', true); return; }
      var plant = currentPlantId(), panel = currentPanelName();

      /* SVG background: already vector — hand Illustrator the .svg itself
         (File → Open edits it natively; a PDF re-wrap would rasterize it). */
      if (iwdieIsSvgBackground(url)) {
        var deliverSvg = function (bytes) {
          var name = iwdieBuildBackgroundFilename(plant, panel, 'svg');
          downloadBytes(bytes, name, 'image/svg+xml');
          hostOk('Background is SVG — vector already. Saved ' + name + '; open it directly in Illustrator (File → Open).');
        };
        if (url.indexOf('data:') === 0) {
          var parsed = iwdieParseDataUrl(url);
          if (parsed) { deliverSvg(parsed.bytes); return; }
          toast('Could not decode the SVG background data URL.', true);
          return;
        }
        fetch(url, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        }).then(function (ab) { deliverSvg(new Uint8Array(ab)); })
          .catch(function (e) { toast('Could not fetch the SVG background: ' + e, true); });
        return;
      }

      /* Raster background: a PNG has no vectors to carry over, so offer the
         deliveries in a proper dialog (v1.6.0; used to be a bare confirm) —
         an automatic vector TRACE (editable shapes; small text becomes
         outlines) as .svg, the pixel-exact image as a PDF-based .ai artboard,
         or (v1.11.0) the picture verbatim, which is what an AI asked to place
         link hotspots on the panel actually wants. */
      var saveVerbatim = function () {
        flattenBackgroundForSave(url, grabBackgroundFillColor()).then(function (got) {
          var ext = iwdieBackgroundExt(got.mime || url);
          var name = iwdieBuildBackgroundFilename(plant, panel, ext);
          downloadBytes(got.bytes, name, got.mime || iwdieBackgroundMime(ext));
          hostOk('Background saved → ' + name + ' (' + Math.round(got.bytes.length / 1024) + ' kB, canvas colour under transparent pixels).');
        }).catch(function (e) { toast('Could not save the background picture: ' + e, true); });
      };

      var startRasterExport = function (wantTrace) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { toast('Background image has no size?', true); return; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        var fillCss = grabBackgroundFillColor();
        ctx.fillStyle = fillCss;
        ctx.fillRect(0, 0, w, h); // composite any alpha onto the canvas CSS colour
        ctx.drawImage(img, 0, 0);
        if (wantTrace) {
          // the trace gets its own buffer, enlarged when the source is small
          // enough — the artboard branch below must stay at native resolution
          var got = buildTraceSource(img, w, h, fillCss);
          if (!got) { toast('Could not read the image pixels for tracing.', true); return; }
          var svgName = iwdieBuildBackgroundFilename(plant, panel + ' traced', 'svg');
          var t0 = Date.now();
          var prog = openTraceProgress('Tracing the background to vectors');
          var deliverTrace = function (traced, scale) {
            prog.step({ phase: 'tidy' });
            traced = iwdieTidyTraceSvg(traced, scale, w, h);
            prog.step({ phase: 'done' });
            prog.close();
            downloadBytes(traced, svgName, 'image/svg+xml');
            hostOk('Background traced to vectors in ' + Math.round((Date.now() - t0) / 100) / 10 + ' s → ' + svgName + ' (' +
              ((traced.match(/<path/g) || []).length) + ' paths in ' + ((traced.match(/^  <g id=/mg) || []).length) + ' objects' +
              (scale > 1 ? ', traced at ' + scale + '×' : '') +
              '). Open in Illustrator (File → Open); each drawn thing is a group named by what it is, the canvas plate is one rect.');
          };
          var failed = function (e) {
            prog.close();
            if (e && e.kind === 'cancelled') { toast('Trace cancelled - nothing was saved.'); return; }
            toast('Vector trace failed: ' + (e && e.message ? e.message : e), true, 8000);
          };
          var job = traceInWorker(got.data, iwdieTraceOptionsIllustrator(got.scale), IWDIE_TRACE_PALETTE_COLORS, prog.step);
          prog.onCancel(job.cancel);
          job.promise.then(function (svg) { deliverTrace(svg, got.scale); }).catch(function (e) {
            if (!e || e.kind !== 'no-worker') { failed(e); return; }
            // no worker available (old browser / strict CSP): trace on the
            // main thread after letting the panel paint first
            prog.step({ phase: 'main-thread' });
            setTimeout(function () {
              try {
                var again = buildTraceSource(img, w, h, fillCss); // first buffer was transferred away
                if (!again) throw new Error('could not rebuild the pixels');
                var illu = iwdieTraceOptionsIllustrator(again.scale);
                var illuPal = iwdieBuildPalette(again.data, IWDIE_TRACE_PALETTE_COLORS);
                if (illuPal) illu.pal = illuPal;
                deliverTrace(IWDIE_TRACER.imagedataToSVG(again.data, illu), again.scale);
              }
              catch (e2) { failed(e2); }
            }, 80);
          });
          return;
        }
        // artboard path: native resolution, the pixels go into the PDF as-is
        var rgba = null, rgb, i, j;
        try { rgba = ctx.getImageData(0, 0, w, h).data; } catch (e) { rgba = null; }
        var name = iwdieBuildBackgroundFilename(plant, panel, 'ai');
        var finish = function (pdf, note) {
          downloadBytes(pdf, name, 'application/pdf');
          hostOk('Background exported for Illustrator → ' + name + ' (' + w + '×' + h + note + '). Open it in Illustrator like any .ai/PDF.');
        };
        var jpegFallback = function () {
          var parsed = iwdieParseDataUrl(canvas.toDataURL('image/jpeg', 0.95));
          if (!parsed) { toast('Could not encode the background.', true); return; }
          finish(iwdieBuildImagePdf({ width: w, height: h, filter: 'DCTDecode', data: parsed.bytes }), ', JPEG');
        };
        if (!rgba) { jpegFallback(); return; }
        rgb = new Uint8Array(w * h * 3);
        for (i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
        deflateBytes(rgb).then(function (flated) {
          finish(iwdieBuildImagePdf({ width: w, height: h, filter: 'FlateDecode', data: flated }), ', lossless');
        }).catch(jpegFallback);
      };
      img.onerror = function () { toast('Could not load the background image (' + String(url).slice(0, 80) + '…)', true); };
      img.src = url;
      };
      openExportDialog(url, plant, panel, {
        svg: IWDIE_TRACER ? function () { startRasterExport(true); } : null,
        raw: saveVerbatim
      });
    }


    /* ---------- the component library (v1.33.0; in VectorCraft since v1.36.0) ----------
       Illustrator files for Maskin panels keep their components - compressors, valves, pumps,
       symbols - around the artboard, and VectorCraft's own .ai reader leaves those out. Import
       .ai… on the components tab reads them here, into Tampermonkey's storage, where the
       Designer and the editor's page both reach them. Nothing leaves the browser. */

    function libStore(lib) {
      GM_setValue(IWDIE_LIB_KEY, { v: 1, file: lib.file, imported: lib.imported, hidden: lib.hidden, noArtboard: lib.noArtboard,
        items: lib.items.map(function (it) { return { name: it.name, layer: it.layer, w: it.w, h: it.h, shapes: it.shapes }; }) });
      GM_setValue(IWDIE_LIB_META_KEY, { file: lib.file, imported: lib.imported, count: lib.items.length });
    }

    /** A stored library as it may be trusted, or null: it is cleaned on the way in, the
     *  same way a drawing is. */
    function libClean(o) {
      var items = (o && typeof o === 'object') ? iwdieDrawLibItems(o.items) : [];
      if (!items.length) return null;
      return { file: typeof o.file === 'string' ? o.file.slice(0, 200) : '', imported: typeof o.imported === 'string' ? o.imported : '',
        hidden: Math.max(0, parseInt(o.hidden, 10) || 0), noArtboard: !!o.noArtboard, items: items };
    }

    function libLoad() {
      try { return libClean(GM_getValue(IWDIE_LIB_KEY, null)); } catch (e) { return null; }
    }

    /** A library imported in Draw (1.33.0 to 1.35.0) lives in the Designer's own storage:
     *  copied over once, so the editor's page has it too. The old copy stays where it is. */
    function libMigrate() {
      try {
        if (GM_getValue(IWDIE_LIB_META_KEY, null)) return;
        var raw = window.localStorage.getItem(IWDIE_LIB_OLD_KEY), lib = libClean(raw ? JSON.parse(raw) : null);
        if (lib) libStore(lib);
      } catch (e) {}
    }

    function libNextFrame() {
      return new Promise(function (resolve) { setTimeout(resolve, 30); });   // lets a status line show before a long step
    }

    /** zlib data inflated by the browser. A PDF stream may carry a byte or two
     *  past the end of its data, which DecompressionStream reports as an error
     *  after it has produced everything - so what came out is kept. */
    function libInflate(u8) {
      var DS = typeof DecompressionStream === 'function' ? DecompressionStream : (W && W.DecompressionStream);
      if (typeof DS !== 'function') return Promise.reject(new Error('this browser cannot unpack it (no DecompressionStream)'));
      var ds = new DS('deflate'), writer = ds.writable.getWriter(), reader = ds.readable.getReader(), chunks = [], total = 0;
      writer.write(u8).then(null, function () {});
      writer.close().then(null, function () {});
      var pump = function () {
        return reader.read().then(function (r) {
          if (r.done) return null;
          chunks.push(r.value);
          total += r.value.length;
          return pump();
        });
      };
      return pump().then(null, function (e) { if (!total) throw e; }).then(function () {
        var out = new Uint8Array(total), o = 0;
        chunks.forEach(function (c) { out.set(c, o); o += c.length; });
        return out;
      });
    }

    function libDecode(block) {
      if (!block.filter) return Promise.resolve(block.data);
      if (block.filter === 'FlateDecode') return libInflate(block.data);
      return Promise.reject(new Error('its data is packed as ' + block.filter + ', which cannot be read here'));
    }

    /** The components of an Illustrator file: its visible objects wholly outside the
     *  artboard. `step(html)` hears each stage. -> Promise<{file, imported, hidden, noArtboard, items}> */
    function libRead(file, step) {
      var esc2 = iwdieEscHtml, name = String(file.name || 'the file'), box = null;
      step('Reading <b>' + esc2(name) + '</b>…');
      return file.arrayBuffer().then(function (ab) {
        box = iwdieAiContainer(new Uint8Array(ab));
        return Promise.all(box.blocks.map(libDecode));
      }).then(function (parts) {
        var total = 0, o = 0;
        parts.forEach(function (p) { total += p.length; });
        var joined = new Uint8Array(total);
        parts.forEach(function (p) { joined.set(p, o); o += p.length; });
        step('Unpacking <b>' + esc2(name) + '</b>…');
        return libNextFrame().then(function () { return iwdieAiNative(joined); });
      }).then(function (nat) {
        return Promise.all([nat.bytes || libInflate(nat.inflate), box.icc ? libDecode(box.icc).then(null, function () { return null; }) : null]);
      }).then(function (r) {
        step('Finding the objects around the artboard…');
        return libNextFrame().then(function () {
          var color = (r[1] && iwdieIccCmykConverter(r[1])) || iwdieCmykNaive;
          var parsed = iwdieAiParse(iwdieLatin1(r[0])), res = iwdieAiLibrary(parsed, color);
          return { file: name, imported: new Date().toISOString(), hidden: res.hidden, noArtboard: !parsed.artboards.length, items: iwdieDrawLibItems(res.items) };
        });
      });
    }

    /* ---------- Edit in VectorCraft (v1.35.0): the editor's side ----------
       Runs on the VectorCraft page opened for a job (#job=…). It drops the panel's SVG on the
       canvas once the app has started, then the component library into Libraries (v1.37.0) and
       the Designer's own objects as placeholders (v1.40.0), shows how to save, and catches the SVG the app saves - a blob download - to hand it back
       through Tampermonkey's storage instead. */
    /** The banner on the editor's page: a title, a text, buttons, and a line for news. */
    function vcBanner(titleHtml, bodyHtml, actions) {
      if (!document.getElementById('iwdie-vcb-style')) {
        var css = [
          // the drawing's top left: clear of the Libraries panel on the right and of the dialogs' buttons
          // and not selectable: Ctrl+A in VectorCraft would select its text as well (v1.39.0)
          '.iwdie-vcb{position:fixed;left:56px;top:76px;z-index:2147483647;width:340px;padding:12px 30px 12px 14px;box-sizing:border-box;background:#424242;',
          '  border:1px solid #383838;border-radius:6px;box-shadow:0 4px 7px rgba(0,0,0,.47);font:400 12.5px/1.45 "Source Sans 3","Segoe UI",Roboto,Arial,sans-serif;color:#d1d1d1;-webkit-user-select:none;user-select:none}',
          '.iwdie-vcb b{color:#ffffff;font-weight:600}',
          '.iwdie-vcb .iwdie-vcb-t{font-weight:600;color:#ffffff;margin-bottom:4px;cursor:default;user-select:none}',
          '.iwdie-vcb .iwdie-vcb-t::before{content:"\\25BE";color:#b0b0b0;font-weight:400;margin-right:5px}',
          // folded: the title alone, a small tab over the drawing's corner
          '.iwdie-vcb.iwdie-min{width:auto;padding:6px 30px 6px 12px}',
          '.iwdie-vcb.iwdie-min .iwdie-vcb-t{margin:0;white-space:nowrap}',
          '.iwdie-vcb.iwdie-min .iwdie-vcb-t::before{content:"\\25B8"}',
          '.iwdie-vcb.iwdie-min .iwdie-vcb-b,.iwdie-vcb.iwdie-min .iwdie-vcb-a,.iwdie-vcb.iwdie-min .iwdie-vcb-n{display:none}',
          '.iwdie-vcb .iwdie-vcb-s{margin-top:6px;color:#8fd19e}',
          '.iwdie-vcb .iwdie-vcb-c,.iwdie-vcb .iwdie-vcb-o{margin-top:6px}',
          '.iwdie-vcb .iwdie-vcb-e{margin-top:6px;color:#ff9f9f}',
          '.iwdie-vcb .iwdie-vcb-x{position:absolute;top:5px;right:6px;width:20px;height:20px;border:0;background:transparent;color:#b0b0b0;font:16px/20px Arial,sans-serif;cursor:default;padding:0}',
          '.iwdie-vcb .iwdie-vcb-x:hover{color:#ffffff}',
          '.iwdie-vcb .iwdie-vcb-a{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}',
          '.iwdie-vcb .iwdie-vcb-a button{height:24px;padding:0 12px;border:0;border-radius:12px;background:transparent;color:#d1d1d1;box-shadow:inset 0 0 0 1.5px #b0b0b0;',
          '  font:600 12px "Source Sans 3","Segoe UI",Roboto,Arial,sans-serif;cursor:default}',
          '.iwdie-vcb .iwdie-vcb-a button:hover{background:#606060;color:#ffffff}'
        ].join('\n');
        var st = document.createElement('style');
        st.id = 'iwdie-vcb-style';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
      }
      var esc2 = iwdieEscHtml, el = document.createElement('div'), handlers = {}, auto = true, timer = null;
      el.className = 'iwdie-vcb';
      el.innerHTML = '<button class="iwdie-vcb-x" title="Hide">×</button><div class="iwdie-vcb-t" title="Fold or unfold">' + titleHtml + '</div><div class="iwdie-vcb-b">' + bodyHtml + '</div>' +
        ((actions && actions.length) ? '<div class="iwdie-vcb-a">' + actions.map(function (a) {
          return '<button data-act="' + esc2(a.act) + '"' + (a.title ? ' title="' + esc2(a.title) + '"' : '') + '>' + esc2(a.label) + '</button>';
        }).join('') + '</div>' : '') + '<div class="iwdie-vcb-n"></div>';
      document.body.appendChild(el);
      // it folds by itself a while after it has said something, until it is folded or unfolded by hand
      var fold = function (on) { el.classList.toggle('iwdie-min', !!on); };
      var later = function (ms) {
        if (timer) clearTimeout(timer);
        timer = auto ? setTimeout(function () { fold(true); }, ms) : null;
      };
      el.addEventListener('click', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('.iwdie-vcb-t')) {
          auto = false;
          if (timer) clearTimeout(timer);
          fold(!el.classList.contains('iwdie-min'));
          return;
        }
        var b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!b) return;
        if (b.classList.contains('iwdie-vcb-x')) { el.style.display = 'none'; return; }
        var fn = handlers[b.getAttribute('data-act')];
        if (fn) fn();
      });
      return {
        el: el,
        on: function (act, fn) { handlers[act] = fn; },
        /** Fold after `ms`, unless it has been folded or unfolded by hand. */
        later: later,
        /** News; `keep` (instructions) leaves the banner open until it is folded by hand. */
        note: function (html, bad, keep) {
          var n = el.querySelector('.iwdie-vcb-n');
          n.className = 'iwdie-vcb-n ' + (bad ? 'iwdie-vcb-e' : 'iwdie-vcb-s');
          n.innerHTML = html;
          el.style.display = '';
          fold(false);
          if (keep) { if (timer) clearTimeout(timer); timer = null; } else later(12000);
        }
      };
    }

    /** `fn` once the app has started. The first start downloads the editor, which may take a while. */
    function vcWhenReady(fn, note) {
      var tries = 0;
      var go = function () {
        if (!document.getElementById('vectorcraft_canvas') || document.getElementById('vectorcraft_loading')) {
          if (++tries > 720) { note('The editor did not start - reload this tab.', true); return; }
          setTimeout(go, 250);
          return;
        }
        setTimeout(fn, 1500);
      };
      go();
    }

    /** Drop a file on the app, as one dragged from the desktop. On the drawing (`at` 'center') a
     *  fresh app opens a document as a document, and an open one places what it is given; on the
     *  menu bar ('menu') a library file goes to Libraries, document or not. At a point of the
     *  page (`at` {x, y}, v1.41.0), an open document places it centred there. */
    function vcDropFile(data, name, type, at) {
      var canvas = document.getElementById('vectorcraft_canvas');
      if (!canvas) throw new Error('the editor is not there');
      var r = canvas.getBoundingClientRect(), dt = new W.DataTransfer(), point = at && typeof at === 'object';
      dt.items.add(new W.File([data], name, { type: type }));
      var x = point ? at.x : r.left + r.width / 2, y = point ? at.y : at === 'menu' ? r.top + 12 : r.top + r.height / 2;
      ['dragenter', 'dragover', 'drop'].forEach(function (t) {
        canvas.dispatchEvent(new W.DragEvent(t, { clientX: x, clientY: y, bubbles: true, cancelable: true, dataTransfer: dt }));
      });
    }

    /** A library as a .vclibrary file, its thumbnails drawn here; `opts` as iwdieVcLibraryFile's.
     *  -> Promise<text> */
    function vcLibraryText(lib, opts) {
      var thumbs = [], k = 0;
      var next = function () {
        if (k >= lib.items.length) return Promise.resolve(iwdieVcLibraryFile(lib, thumbs, opts));
        var t = iwdieVcThumbSvg(lib.items[k], 128), img = new Image();
        return new Promise(function (resolve) {
          img.onload = function () {
            try {
              var c = document.createElement('canvas');
              c.width = t.w; c.height = t.h;
              c.getContext('2d').drawImage(img, 0, 0, t.w, t.h);
              thumbs[k] = c.toDataURL('image/png').split(',')[1] || '';
            } catch (e) { thumbs[k] = ''; }
            resolve();
          };
          img.onerror = function () { thumbs[k] = ''; resolve(); };
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t.svg);
        }).then(function () { k++; return next(); });
      };
      return next();
    }

    /** Ready for Image Trace (v1.38.0): a copy of the panel whose picture is enlarged (three
     *  times, less for a big one) and set to its own flat colours, opened as a new document in
     *  this tab's VectorCraft. Saves from it go to the Designer like any other. -> Promise */
    function vcSharpen(job, say) {
      var esc2 = iwdieEscHtml, svg = iwdieVcStripEditing(job.svg), pic = iwdieVcFindPicture(svg);
      if (!pic) { say('This panel has no picture to make ready for Image Trace.', true); return Promise.resolve(); }
      say('Making the picture ready for Image Trace…');
      return loadPicture(pic.href).then(function (img) {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var c1 = document.createElement('canvas');
        c1.width = w; c1.height = h;
        var g1 = c1.getContext('2d');
        g1.drawImage(img, 0, 0);
        var pal = iwdieVcFlatPalette(g1.getImageData(0, 0, w, h).data, w, h);
        if (!pal.flat) return { flat: false };
        var k = iwdieVcTraceScale(w, h), W2 = Math.round(w * k), H2 = Math.round(h * k);
        var c3 = document.createElement('canvas');
        c3.width = W2; c3.height = H2;
        var g3 = c3.getContext('2d');
        g3.imageSmoothingEnabled = true;
        g3.imageSmoothingQuality = 'high';
        g3.drawImage(img, 0, 0, W2, H2);
        var id = g3.getImageData(0, 0, W2, H2);
        iwdieVcSnap(id.data, pal.colors);
        g3.putImageData(id, 0, 0);
        return { flat: true, url: c3.toDataURL('image/png'), colors: pal.colors.length, k: Math.round(k * 10) / 10 };
      }).then(function (r) {
        if (!r.flat) {
          say('This picture is not made of flat colours (a photo?): Image Trace would turn it into thousands of specks. Keep it as a picture, or trace a part of it.', true);
          return;
        }
        var name = String(job.name || 'panel.svg').replace(/\.svg$/i, '') + '-trace.svg';
        vcDropFile(svg.slice(0, pic.start) + r.url + svg.slice(pic.end), name, 'image/svg+xml', 'menu');
        say('A copy is open in a new tab here, <b>' + esc2(name) + '</b>, its picture ' + r.k + '× sharper in its ' + r.colors + ' own colours. ' +
          'Select the picture → <b>Image Trace ▾</b> → <b>16 Colors</b> → <b>Expand</b>, then save from that tab as usual. ' +
          'Do it before you edit: the copy starts from the panel as it opened.', false, true);
      }, function (e) { say('The picture could not be made ready: ' + esc2(String((e && e.message) || e)), true); });
    }

    /** Put the component library into the running app's Libraries panel; `say(html, bad)` hears
     *  how it went. */
    function vcSendLibrary(lib, say) {
      return vcLibraryText(lib).then(function (text) {
        vcDropFile(text, 'Komponenter.vclibrary', 'application/json', 'menu');
        say('<b>' + iwdieN(lib.items.length, 'component', 'components') + '</b> in <b>Libraries</b> (right), as “Komponenter' +
          (lib.file ? ' - ' + iwdieEscHtml(lib.file) : '') + '”: drag one onto the drawing, or double-click it.');
      }).then(null, function (e) { say('The components could not be added: ' + iwdieEscHtml(String((e && e.message) || e)), true); });
    }

    /* ---------- the IWMAC menu (v1.41.0) ----------
       VectorCraft draws its menus itself, on its canvas, and they take nothing from outside. So the
       IWMAC objects have a menu of their own in the same bar, after Help: the roles, each with a
       submenu of its objects, and a search. An object chosen there is placed where the next click
       on the drawing lands, as a file dropped there: VectorCraft places a dropped SVG centred on the
       drop point, as one group named after the file - "IWMAC <obj_id>", which makes it a
       placeholder, as one dragged from Libraries. */
    /** The IWMAC menu on the editor's page; `say(html, bad)` hears what went wrong. */
    function vcObjectMenu(say, looks) {
      if (document.getElementById('iwdie-vcm')) return;
      var esc2 = iwdieEscHtml, all = iwdieVcObjects(looks), byId = {}, roles = [], byRole = {};
      all.forEach(function (o) {
        byId[o.id] = o;
        if (!byRole[o.role]) { byRole[o.role] = []; roles.push(o.role); }
        byRole[o.role].push(o);
      });
      var font = '"Source Sans 3","Segoe UI",Roboto,Arial,sans-serif';
      var css = [
        // the title in VectorCraft's bar, after Help, as its own titles are: 13 px, the bar's text colour, the hover fill
        '.iwdie-vcm{position:fixed;left:419px;top:4px;height:24px;padding:0 6px;box-sizing:border-box;border-radius:3px;z-index:2147483646;',
        '  font:400 13px/24px ' + font + ';color:#d1d1d1;cursor:default;-webkit-user-select:none;user-select:none}',
        '.iwdie-vcm:hover,.iwdie-vcm.iwdie-on{background:#606060;color:#ffffff}',
        // its menus as VectorCraft's: the panel colour, a 1 px border, 6 px corners and margin, the popup shadow
        '.iwdie-vcm-m{position:fixed;z-index:2147483646;min-width:230px;max-height:calc(100vh - 40px);overflow-y:auto;padding:6px;box-sizing:border-box;',
        '  background:#535353;border:1px solid #383838;border-radius:6px;box-shadow:0 4px 7px rgba(0,0,0,.47);',
        '  font:400 13px/1.326 ' + font + ';color:#d1d1d1;-webkit-user-select:none;user-select:none}',
        '.iwdie-vcm-i{display:flex;align-items:center;gap:8px;height:24px;padding:0 6px;border-radius:3px;white-space:nowrap;cursor:default}',
        '.iwdie-vcm-i:hover,.iwdie-vcm-i.iwdie-on{background:#606060;color:#ffffff}',
        '.iwdie-vcm-l{flex:1}',
        '.iwdie-vcm-k{color:#b0b0b0;font-size:11.5px}',
        '.iwdie-vcm-i:hover .iwdie-vcm-k,.iwdie-vcm-i.iwdie-on .iwdie-vcm-k{color:#e4e4e4}',
        '.iwdie-vcm-p{flex:none;width:44px;height:22px;display:flex;align-items:center;justify-content:center}',
        '.iwdie-vcm-p img{max-width:44px;max-height:22px}',
        '.iwdie-vcm-h{padding:2px 6px 4px;color:#b0b0b0;font-size:11px;line-height:1.4}',
        '.iwdie-vcm-x{height:1px;background:#4b4b4b;margin:5px 0}',
        '.iwdie-vcm-s{display:block;width:100%;height:26px;box-sizing:border-box;margin:0 0 6px;padding:0 7px;background:#454545;border:1px solid #5f5f5f;',
        '  border-radius:2px;color:#ffffff;font:400 12.5px ' + font + ';outline:none}',
        '.iwdie-vcm-s:focus{border-color:#378ef0}',
        '.iwdie-vcm-s::placeholder{color:#b0b0b0}',
        '.iwdie-vcm-n{padding:4px 6px;color:#b0b0b0}',
        // while one is being placed: a note by the pointer
        '.iwdie-vcm-t{position:fixed;z-index:2147483647;pointer-events:none;padding:4px 8px;background:#535353;border:1px solid #383838;border-radius:6px;',
        '  box-shadow:0 4px 7px rgba(0,0,0,.47);font:400 12px ' + font + ';color:#d1d1d1;white-space:nowrap}',
        '.iwdie-vcm-t b{color:#ffffff;font-weight:600}'
      ].join('\n');
      var st = document.createElement('style');
      st.id = 'iwdie-vcm-style';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
      var title = document.createElement('div');
      title.id = 'iwdie-vcm';
      title.className = 'iwdie-vcm';
      title.textContent = 'IWMAC';
      title.title = 'The IWMAC Designer’s objects, to place on the drawing';
      document.body.appendChild(title);

      var menu = null, sub = null, pending = null, placing = null, tag = null, downAt = null, swallow = false, pointer = { x: 0, y: 0 };
      // the Designer's picture of the object (v1.43.0), else a box in its proportions
      var preview = function (o) {
        if (o.src) return '<img src="' + o.src + '" alt="">';
        var k = Math.min(42 / o.w, 20 / o.h), w = Math.max(3, Math.round(o.w * k)), h = Math.max(3, Math.round(o.h * k));
        return '<svg width="' + w + '" height="' + h + '"><rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (h - 1) +
          '" fill="#eaf1ff" stroke="#4f80ff" stroke-width="1" stroke-dasharray="2 1.5"/></svg>';
      };
      var objectRow = function (o) {
        return '<div class="iwdie-vcm-i" data-id="' + esc2(o.id) + '" title="' + esc2(IWDIE_VC_OBJ_PREFIX + o.id) + '"><span class="iwdie-vcm-p">' + preview(o) + '</span>' +
          '<span class="iwdie-vcm-l">' + esc2(o.desc || o.id) + '</span><span class="iwdie-vcm-k">' + o.w + ' × ' + o.h + '</span></div>';
      };
      var roleRow = function (r) {
        return '<div class="iwdie-vcm-i" data-role="' + esc2(r) + '"><span class="iwdie-vcm-l">' + esc2(IWDIE_VC_OBJ_ROLES[r] || r) + '</span>' +
          '<span class="iwdie-vcm-k">' + byRole[r].length + '</span><span class="iwdie-vcm-k">▸</span></div>';
      };
      var mine = function (t) { return !!(t && t.closest && t.closest('.iwdie-vcm,.iwdie-vcm-m,.iwdie-vcb')); };
      // the drawing, as far as the page can tell: clear of the tool bar, the dock, the bars above and below
      var inDrawing = function (x, y) {
        var c = document.getElementById('vectorcraft_canvas'), r = c && c.getBoundingClientRect();
        return !!r && x > r.left + 52 && x < r.right - 345 && y > r.top + 72 && y < r.bottom - 56;
      };
      var closeSub = function () {
        if (sub) { sub.parentNode.removeChild(sub); sub = null; }
        if (menu) Array.prototype.forEach.call(menu.querySelectorAll('.iwdie-vcm-i.iwdie-on'), function (r) { r.classList.remove('iwdie-on'); });
      };
      // the keyboard back to VectorCraft, which hears keys only while its canvas has the focus
      var refocus = function () {
        var c = document.getElementById('vectorcraft_canvas');
        try { if (c && document.activeElement !== c) c.focus({ preventScroll: true }); } catch (e) {}
      };
      var close = function () {
        clearTimeout(pending);
        closeSub();
        var had = !!menu && (menu.contains(document.activeElement) || document.activeElement === document.body);
        if (menu) { menu.parentNode.removeChild(menu); menu = null; }
        title.classList.remove('iwdie-on');
        if (had) refocus();
      };
      var stop = function () {
        placing = null; downAt = null;
        if (tag) { tag.parentNode.removeChild(tag); tag = null; }
      };
      var follow = function () {
        if (tag) { tag.style.left = (pointer.x + 16) + 'px'; tag.style.top = (pointer.y + 18) + 'px'; }
      };
      var choose = function (o) {
        close();
        stop();
        placing = o;
        tag = document.createElement('div');
        tag.className = 'iwdie-vcm-t';
        tag.innerHTML = '<b>' + esc2(o.desc || o.id) + '</b> ' + o.w + ' × ' + o.h + ' - click where it goes · Shift+click for more · Esc stops';
        document.body.appendChild(tag);
        follow();
      };
      var place = function (o, at) {
        try { vcDropFile(iwdieVcObjectSvg(o), IWDIE_VC_OBJ_PREFIX + o.id, 'image/svg+xml', at); }
        catch (e) { say('<b>' + esc2(o.desc || o.id) + '</b> could not be placed: ' + esc2(String((e && e.message) || e)), true); }
        refocus();
      };
      var rowOf = function (e) { return e.target && e.target.closest ? e.target.closest('.iwdie-vcm-i') : null; };
      var openSub = function (role, row) {
        if (sub && sub.getAttribute('data-role') === role) return;
        closeSub();
        sub = document.createElement('div');
        sub.className = 'iwdie-vcm-m';
        sub.setAttribute('data-role', role);
        sub.innerHTML = '<div class="iwdie-vcm-h">' + esc2(IWDIE_VC_OBJ_ROLES[role] || role) + '</div>' + byRole[role].map(objectRow).join('');
        document.body.appendChild(sub);
        var mr = menu.getBoundingClientRect(), rr = row.getBoundingClientRect();
        sub.style.left = (mr.right - 2) + 'px';
        sub.style.top = Math.max(4, Math.min(rr.top - 7, window.innerHeight - sub.offsetHeight - 4)) + 'px';
        row.classList.add('iwdie-on');
        sub.addEventListener('mouseover', function () { clearTimeout(pending); });
        sub.addEventListener('click', function (e) { var r = rowOf(e); if (r && byId[r.getAttribute('data-id')]) choose(byId[r.getAttribute('data-id')]); });
      };
      var open = function () {
        stop();
        menu = document.createElement('div');
        menu.className = 'iwdie-vcm-m';
        menu.innerHTML = '<input class="iwdie-vcm-s" type="text" placeholder="Search: fan, value, alarm…" spellcheck="false" autocomplete="off">' +
          '<div class="iwdie-vcm-list"></div><div class="iwdie-vcm-x"></div>' +
          '<div class="iwdie-vcm-h">Choose one, then click where it goes on the drawing.<br>Saved back, each becomes that object in the panel.</div>';
        var r = title.getBoundingClientRect();
        menu.style.left = r.left + 'px';
        menu.style.top = (r.bottom + 3) + 'px';
        document.body.appendChild(menu);
        title.classList.add('iwdie-on');
        var input = menu.querySelector('.iwdie-vcm-s'), list = menu.querySelector('.iwdie-vcm-list');
        var fill = function () {
          var q = input.value.trim(), hits = q ? iwdieVcObjectSearch(q).map(function (o) { return byId[o.id]; }) : null;
          closeSub();
          list.innerHTML = !hits ? roles.map(roleRow).join('') : hits.length ? hits.map(objectRow).join('') : '<div class="iwdie-vcm-n">No IWMAC object matches.</div>';
        };
        fill();
        // what is typed here is the search's, not VectorCraft's shortcuts'
        ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut'].forEach(function (t) {
          input.addEventListener(t, function (e) { e.stopPropagation(); });
        });
        input.addEventListener('input', fill);
        input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          var first = list.querySelector('[data-id]');
          if (first) choose(byId[first.getAttribute('data-id')]);
        });
        menu.addEventListener('mouseover', function (e) {
          var row = rowOf(e);
          if (!row) return;
          clearTimeout(pending);
          // with a submenu open, a moment's grace: the pointer may only be crossing this row on its way there
          pending = setTimeout(function () {
            if (!menu) return;
            if (row.getAttribute('data-role')) openSub(row.getAttribute('data-role'), row); else closeSub();
          }, sub ? 150 : 0);
        });
        menu.addEventListener('click', function (e) {
          var row = rowOf(e);
          if (!row) return;
          if (row.getAttribute('data-role')) openSub(row.getAttribute('data-role'), row);
          else if (byId[row.getAttribute('data-id')]) choose(byId[row.getAttribute('data-id')]);
        });
        setTimeout(function () { try { input.focus(); } catch (e) {} }, 0);
      };
      title.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      title.addEventListener('click', function () { if (menu) close(); else open(); });

      window.addEventListener('pointermove', function (e) { pointer = { x: e.clientX, y: e.clientY }; follow(); }, true);
      // Placing: the press on the drawing is this script's, not VectorCraft's - all of the click is
      // kept from it - and the object is dropped where the press was. Anywhere else it stops.
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'].forEach(function (type) {
        window.addEventListener(type, function (e) {
          if (type === 'pointerdown') {
            if (menu && !mine(e.target)) close();
            swallow = false;
            if (!placing || mine(e.target)) return;
            if (e.button !== 0 || !inDrawing(e.clientX, e.clientY)) { stop(); return; }
            swallow = true;
            downAt = { x: e.clientX, y: e.clientY };
          }
          if (!swallow) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (type === 'pointerup' && placing && downAt) {
            var o = placing, at = downAt;
            downAt = null;
            if (!e.shiftKey) stop();
            place(o, at);
          }
          if (type === 'click') swallow = false;
        }, true);
      });
      window.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || (!placing && !menu)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (placing) stop(); else close();
      }, true);
    }

    /* ---------- Ctrl+S: Sync to IWMAC Designer (v1.42.0) ----------
       Ctrl+S on the editor's page offers to sync the drawing to the Designer tab it came from.
       VectorCraft has no way in but its own Save. A document it has saved as SVG once is saved
       again straight away. The first time, its Save As is answered here as the banner used to ask
       it of the user - Format SVG, OK, Preserve Editing Capabilities, OK - by clicks where those
       dialogs sit, centred in the window, and only once egui's own text field shows that the
       dialog is there. The SVG then goes to the Designer as any SVG save from this page does. */
    /** The Save chooser on Ctrl+S; `say(html, bad, keep)` hears how it went; `state` is shared
     *  with the catcher of saves ({caught, editing, download}). */
    function vcSaveSync(job, say, state) {
      if (document.getElementById('iwdie-vcs-style')) return;
      var esc2 = iwdieEscHtml, font = '"Source Sans 3","Segoe UI",Roboto,Arial,sans-serif';
      var css = [
        // a VectorCraft dialog: the panel colour, a 1 px border, 6 px corners, the window shadow, 22 px padding
        '.iwdie-vcs{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483646;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;',
        '  font:400 13px/1.4 ' + font + ';color:#d1d1d1;-webkit-user-select:none;user-select:none}',
        '.iwdie-vcs-d{width:430px;box-sizing:border-box;padding:22px;background:#535353;border:1px solid #383838;border-radius:6px;box-shadow:0 8px 14px rgba(0,0,0,.55)}',
        '.iwdie-vcs-t{font-size:16px;font-weight:600;color:#ffffff;margin-bottom:14px}',
        '.iwdie-vcs-o{display:block;width:100%;margin:0 0 8px;padding:10px 12px;box-sizing:border-box;text-align:left;background:#454545;border:1px solid #5f5f5f;',
        '  border-radius:4px;color:#d1d1d1;font:inherit;cursor:default}',
        '.iwdie-vcs-o b{display:block;color:#ffffff;font-weight:600;font-size:13px;margin-bottom:2px}',
        '.iwdie-vcs-o span{display:block;color:#b0b0b0;font-size:12px}',
        '.iwdie-vcs-o:hover{background:#606060}',
        '.iwdie-vcs-o.iwdie-on{border-color:#378ef0;box-shadow:inset 0 0 0 1px #378ef0}',
        '.iwdie-vcs-a{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}',
        '.iwdie-vcs-b{height:28px;padding:0 16px;border:0;border-radius:14px;background:transparent;color:#d1d1d1;box-shadow:inset 0 0 0 1.5px #b0b0b0;',
        '  font:600 12.5px ' + font + ';cursor:default}',
        '.iwdie-vcs-b:hover{background:#606060;color:#ffffff}',
        '.iwdie-vcs-p{background:#1473e6;color:#ffffff;box-shadow:none}',
        '.iwdie-vcs-p:hover{background:#378ef0}',
        // while VectorCraft's own dialogs are being answered: the pointer is kept off them
        '.iwdie-vcs-g{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483645;cursor:progress}'
      ].join('\n');
      var st = document.createElement('style');
      st.id = 'iwdie-vcs-style';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);

      var chooser = null, chosen = 0, busy = false, passing = false;
      var canvas = function () { return document.getElementById('vectorcraft_canvas'); };
      var wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
      // Waits are counted in the page's frames as well as in time: VectorCraft draws, and takes a click
      // on what it drew, a frame at a time, and a tab in the background draws no frames at all - or one
      // a second - so a wait in time alone can run ahead of it.
      var raf = W.requestAnimationFrame ? W.requestAnimationFrame.bind(W) : function (fn) { return setTimeout(fn, 16); };
      var settle = function (ms, n) {
        return wait(ms).then(function () {
          return new Promise(function (resolve) { var left = n; (function tick() { if (--left < 0) resolve(); else raf(tick); })(); });
        });
      };
      // true as soon as test() holds, false after `n` frames
      var until = function (test, n) {
        return new Promise(function (resolve) {
          var left = n;
          (function tick() {
            if (test()) resolve(true);
            else if (--left < 0) resolve(false);
            else raf(tick);
          })();
        });
      };
      // a key as egui hears one, on its canvas, past this script's own Ctrl+S
      var key = function (k, code, mods) {
        var c = canvas();
        if (!c) return;
        try { c.focus({ preventScroll: true }); } catch (e) {}
        passing = true;
        try {
          ['keydown', 'keyup'].forEach(function (type) {
            c.dispatchEvent(new W.KeyboardEvent(type, { key: k, code: code, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, bubbles: true, cancelable: true }));
          });
        } finally { passing = false; }
      };
      // a click as egui hears one, `dx`, `dy` from the window's centre: the pointer there, pressed, released
      var tap = function (dx, dy) {
        var c = canvas();
        if (!c) return Promise.resolve();
        var x = window.innerWidth / 2 + dx, y = window.innerHeight / 2 + dy;
        var ev = function (type, buttons) {
          c.dispatchEvent(new W.PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: buttons, pointerId: 1, pointerType: 'mouse',
            isPrimary: true, bubbles: true, cancelable: true }));
        };
        ev('pointermove', 0);
        return wait(80).then(function () { ev('pointerdown', 1); return wait(80); }).then(function () { ev('pointerup', 0); });
      };
      // egui gives the focus to its hidden text field while one of its own fields has it: a save dialog's file name
      var typing = function () {
        var a = document.activeElement;
        return !!a && a.tagName === 'INPUT' && a.type === 'text' && !(a.closest && a.closest('.iwdie-vcb,.iwdie-vcm-m,.iwdie-vcs'));
      };
      var sync = function () {
        if (busy) return;
        if (typing()) {
          say('Finish what is being typed in VectorCraft first (Esc), then <b>Ctrl+S</b> again.', true);
          return;
        }
        busy = true;
        // while it syncs, a save in another format is held back and noted: it is no file the user asked for
        state.download = 0;
        state.syncing = true;
        state.other = 0;
        var before = state.caught;
        var saved = function () { return state.caught > before; };
        // VectorCraft's Save As, answered where its dialogs sit: Format SVG, OK, Preserve Editing Capabilities,
        // OK. `k` slows it down: each step waits for its dialog or menu to settle, k × 300 ms and k × 15 frames.
        var answer = function (k) {
          var guard = document.createElement('div');
          guard.className = 'iwdie-vcs-g';
          document.body.appendChild(guard);
          var done = function (ok) { if (guard.parentNode) guard.parentNode.removeChild(guard); return ok; };
          var step = function () { return settle(300 * k, 15 * k); };
          return step().then(function () { return tap(5, -159); }).then(step)          // Format ▾
            .then(function () { return tap(-92, -40); }).then(step)                     // SVG
            .then(function () {
              // the menu took the keyboard from the file name; if it did not, the clicks went astray: no more
              if (typing()) return false;
              return tap(154, 19)                                                       // OK
                .then(function () { return until(function () { return typing() || state.other; }, 240 * k); })
                .then(function () { return typing(); });
            })
            .then(function (options) {
              // SVG Options gives its first field the keyboard: it is open, and the clicks went where they should
              if (!options) return false;
              return step()
                .then(function () { return state.editing ? null : tap(-185, 106).then(step); })   // Preserve Editing Capabilities
                .then(function () { return tap(154, 194); })                                     // OK
                .then(function () { return until(saved, 1200); });
            })
            .then(done, function () { return done(false); });
        };
        // Save As (again): when an answer went faster than the menus, the save came in VectorCraft's own
        // format and was held back - so once more, twice as slowly, up to three times
        var saveAs = function (k, tries) {
          state.other = 0;
          key('S', 'KeyS', { ctrl: true, shift: true });
          return until(typing, 480).then(function (open) { return open ? answer(k) : false; }).then(function (ok) {
            return ok || !state.other || tries <= 1 ? ok : saveAs(k * 2, tries - 1);
          });
        };
        say('Syncing to the Designer…');
        key('s', 'KeyS', { ctrl: true });
        until(function () { return saved() || typing() || state.other; }, 480).then(function () {
          if (saved()) return true;
          if (typing()) return answer(1).then(function (ok) { return ok || !state.other ? ok : saveAs(2, 2); });
          // this document saves in another format, as it was saved here before: Save As, to make it SVG
          return state.other ? saveAs(1, 3) : false;
        }).then(function (ok) {
          busy = false;
          state.syncing = false;
          if (!ok) {
            say('VectorCraft did not save it. If its Save As is open, finish it by hand: Format <b>SVG</b> → OK → tick ' +
              '<b>Preserve Editing Capabilities</b> → OK - that syncs all the same.', true, true);
          }
        });
      };
      var close = function () {
        if (chooser) { chooser.parentNode.removeChild(chooser); chooser = null; }
        var c = canvas();
        try { if (c) c.focus({ preventScroll: true }); } catch (e) {}
      };
      var choose = function (act) {
        close();
        if (act === 'sync') sync();
        else if (act === 'file') {
          // VectorCraft's own Save As; what it saves in the next five minutes goes to Downloads
          state.download = Date.now() + 300000;
          key('S', 'KeyS', { ctrl: true, shift: true });
        }
      };
      var mark = function () {
        if (!chooser) return;
        Array.prototype.forEach.call(chooser.querySelectorAll('.iwdie-vcs-o'), function (b, k) { b.classList.toggle('iwdie-on', k === chosen); });
      };
      var open = function () {
        if (chooser) return;
        chooser = document.createElement('div');
        chooser.className = 'iwdie-vcs';
        chooser.innerHTML = '<div class="iwdie-vcs-d" role="dialog" aria-label="Save"><div class="iwdie-vcs-t">Save</div>' +
          '<button class="iwdie-vcs-o" data-act="sync"><b>Sync to IWMAC Designer</b><span>' + (job.panel ? '“' + esc2(job.panel) + '”' : 'The panel') +
          ' gets this drawing as its background, and its PNG goes to the plant’s pictures on the server.</span></button>' +
          '<button class="iwdie-vcs-o" data-act="file"><b>Save a file…</b><span>VectorCraft’s own Save As: a format and its options, to Downloads.</span></button>' +
          '<div class="iwdie-vcs-a"><button class="iwdie-vcs-b" data-act="cancel">Cancel</button><button class="iwdie-vcs-b iwdie-vcs-p" data-act="ok">OK</button></div></div>';
        document.body.appendChild(chooser);
        chosen = 0;
        mark();
        chooser.addEventListener('click', function (e) {
          var b = e.target && e.target.closest ? e.target.closest('button') : null;
          if (!b && e.target === chooser) { close(); return; }
          if (!b) return;
          var act = b.getAttribute('data-act');
          if (act === 'cancel') close();
          else if (act === 'ok') choose(chosen ? 'file' : 'sync');
          else choose(act);
        });
      };
      // Ctrl+S is this script's while the drawing is a job's; the chooser has the keyboard while it is open
      window.addEventListener('keydown', function (e) {
        if (passing) return;
        if (chooser) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.key === 'Escape') close();
          else if (e.key === 'Enter') choose(chosen ? 'file' : 'sync');
          else if (/^(ArrowUp|ArrowDown|Tab)$/.test(e.key)) { chosen = 1 - chosen; mark(); }
          return;
        }
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !(e.code === 'KeyS' || e.key === 's' || e.key === 'S')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!busy) open();
      }, true);
    }

    function vcAppSide() {
      if (typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function') return;
      var m = /[#&]job=([A-Za-z0-9_-]+)/.exec(location.hash || ''), job = null;
      try { job = GM_getValue('iwdie.vc.job', null); } catch (e) { job = null; }
      if (!m || !job || job.id !== m[1] || typeof job.svg !== 'string') return;
      var esc2 = iwdieEscHtml, lib = libLoad(), busy = false;
      var ui = vcBanner('IWMAC Designer · ' + esc2(job.panel || 'panel') + (job.plant ? ' (plant ' + esc2(job.plant) + ')' : ''),
        'To send it back: <b>Ctrl+S</b> → <b>Sync to IWMAC Designer</b>. The panel’s background updates and its PNG goes to the plant’s ' +
        'pictures; keep editing and sync again for more.<div class="iwdie-vcb-c"></div><div class="iwdie-vcb-o"></div>',
        [{ act: 'trace', label: 'Ready for Image Trace', title: 'Open a copy whose picture is enlarged and set to its own flat colours, so Image Trace makes clean shapes of it' },
          { act: 'aibg', label: 'Background from .ai…', title: 'Open the panel’s own Illustrator file here as a document of its own, to paste in place as the background' },
          { act: 'import', label: 'Components from .ai…', title: 'Read the components around an Illustrator file’s artboard into Libraries; they replace the ones kept' }]);
      var note = ui.note;
      // what the components line says: where they are, or how to get them
      var comp = function (html, bad) {
        var c = ui.el.querySelector('.iwdie-vcb-c');
        c.className = 'iwdie-vcb-c' + (bad ? ' iwdie-vcb-e' : '');
        c.innerHTML = 'Komponenter: ' + html;
      };
      comp(lib ? iwdieN(lib.items.length, 'component', 'components') + ' from <b>' + esc2(lib.file || 'an Illustrator file') + '</b> - in Libraries once the editor has started.'
        : 'none yet. <b>Components from .ai…</b> reads the objects placed around an Illustrator file’s artboard - where Maskin files keep them - into VectorCraft’s Libraries.');
      // the Designer's own objects, as placeholders that become them when saved back (v1.40.0)
      var looks = null;
      try { looks = (GM_getValue(IWDIE_VC_LOOKS_KEY, null) || {}).items || null; } catch (e) { looks = null; }
      var objItems = iwdieVcObjectItems(looks);
      var objLine = function (html, bad) {
        var o = ui.el.querySelector('.iwdie-vcb-o');
        o.className = 'iwdie-vcb-o' + (bad ? ' iwdie-vcb-e' : '');
        o.innerHTML = 'IWMAC objects: ' + html;
      };
      objLine(iwdieN(objItems.length, 'kind', 'kinds') + ' - in the <b>IWMAC</b> menu up top, and in Libraries, once the editor has started.');
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ai,.pdf,application/pdf,application/postscript,application/illustrator';
      input.style.display = 'none';
      ui.el.appendChild(input);
      ui.on('import', function () { if (!busy) input.click(); });
      var aiInput = document.createElement('input');
      aiInput.type = 'file';
      aiInput.accept = '.ai,.pdf,.eps,application/pdf,application/postscript,application/illustrator';
      aiInput.style.display = 'none';
      ui.el.appendChild(aiInput);
      ui.on('aibg', function () { aiInput.click(); });
      aiInput.addEventListener('change', function () {
        var f = aiInput.files && aiInput.files[0];
        aiInput.value = '';
        if (!f) return;
        f.arrayBuffer().then(function (ab) {
          vcWhenReady(function () {
            // on the menu bar a file opens as a document; on the drawing it would be placed as art
            try { vcDropFile(new Uint8Array(ab), String(f.name || 'background.ai'), f.type || 'application/pdf', 'menu'); }
            catch (e) { note('<b>' + esc2(String(f.name || 'The file')) + '</b> could not be opened here: ' + esc2(String((e && e.message) || e)), true); return; }
            note('<b>' + esc2(String(f.name || 'The file')) + '</b> is open in a new tab here, its artboard as vectors. To make it this panel’s background: ' +
              'there, <b>Ctrl+A</b> and <b>Ctrl+C</b>; back in the panel’s tab, click the <b>Bakgrunn</b> layer in Layers, then <b>Ctrl+Shift+V</b> ' +
              '(Edit ▸ Paste in Place) - it lands where it was on the artboard. Hide or delete the old picture, then save as usual.', false, true);
          }, note);
        }, function (e) { note('<b>' + esc2(String(f.name || 'The file')) + '</b> could not be read: ' + esc2(String((e && e.message) || e)), true); });
      });
      var sharpening = false;
      ui.on('trace', function () {
        if (sharpening) return;
        sharpening = true;
        vcWhenReady(function () {
          vcSharpen(job, note).then(function () { sharpening = false; }, function () { sharpening = false; });
        }, note);
      });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        input.value = '';
        if (!f || busy) return;
        busy = true;
        libRead(f, function (html) { comp(html); }).then(function (got) {
          if (!got.items.length) {
            comp('<b>' + esc2(got.file) + '</b> has no objects outside its artboard' + (got.hidden ? ' that are not hidden' : '') + ' - nothing changed.', true);
            return;
          }
          libStore(got);
          lib = got;
          return new Promise(function (resolve) { vcWhenReady(resolve, note); }).then(function () { return vcSendLibrary(got, comp); });
        }).then(function () { busy = false; }, function (e) {
          busy = false;
          comp('<b>' + esc2(String(f.name || 'The file')) + '</b> could not be read: ' + esc2(String((e && e.message) || e)) + '.', true);
        });
      });
      // what the app saves arrives as a blob download: keep the blobs, and send an SVG back instead of downloading it
      var blobs = {}, make = W.URL.createObjectURL, revoke = W.URL.revokeObjectURL, click = W.HTMLAnchorElement.prototype.click;
      var hhmm = function () { var d = new Date(), p = function (v) { return (v < 10 ? '0' : '') + v; }; return p(d.getHours()) + ':' + p(d.getMinutes()); };
      var download = function (blob, name) {
        var u = make.call(W.URL, blob), a2 = document.createElement('a');
        a2.href = u; a2.download = name;
        document.body.appendChild(a2);
        click.call(a2);
        a2.remove();
        setTimeout(function () { try { revoke.call(W.URL, u); } catch (e) {} }, 60000);
      };
      // The Designer answers every save: 'received' once it starts on it, then 'applied', 'refused'
      // or 'failed'. No answer means no Designer tab is listening any more (closed, reloaded,
      // discarded): the save then goes to Downloads instead, so no work is lost.
      var pending = null, canAck = typeof GM_addValueChangeListener === 'function' && typeof GM_deleteValue === 'function';
      // the SVG saves caught, whether one kept VectorCraft's document, until when a save is for Downloads,
      // and while a sync runs, when a save in another format was held back (v1.42.0)
      var saves = { caught: 0, editing: false, download: 0, syncing: false, other: 0 };
      if (canAck) {
        GM_addValueChangeListener('iwdie.vc.ack.' + job.id, function (key, old, val) {
          if (!val || !val.state || !pending) return;
          if (val.state === 'received') {
            if (pending.timer) { clearTimeout(pending.timer); pending.timer = null; }
            note('Received by the Designer - updating the panel…');
            return;
          }
          var was = pending;
          pending = null;
          if (was.timer) clearTimeout(was.timer);
          try { GM_deleteValue(key); } catch (e) {}
          if (val.state === 'applied') {
            var placed = +val.placed || 0, already = +val.already || 0, skipped = +val.skipped || 0;
            note('✓ The panel’s background was updated at ' + hhmm() + (was.editing ? '.' :
              ' - as plain SVG (without <b>Preserve Editing Capabilities</b>): the next edit opens its layers and paths.') +
              (placed ? ' <b>' + iwdieN(placed, 'IWMAC object', 'IWMAC objects') + '</b> placed in the panel' + (already ? ' (' + already + ' there already)' : '') + '.'
                : already ? ' Its IWMAC objects were in the panel already.' : '') +
              (skipped ? ' ' + iwdieN(skipped, 'placeholder', 'placeholders') + ' had no size (hidden?) and became no object.' : '') +
              (val.objError ? ' The IWMAC objects were not placed: ' + esc2(String(val.objError)) + ' - save again to try again.' : '') +
              (val.uploaded ? ' Its PNG is in the plant’s pictures as <b>' + esc2(String(val.uploaded)) + '</b>.' : '') +
              (val.uploadError ? ' Its PNG was not uploaded to the plant’s pictures: ' + esc2(String(val.uploadError)) + '.' : '') +
              (placed ? ' A placeholder becomes its object once: saved again where it is, it is skipped; moved, it is placed again. ' +
                'Move the objects in the Designer from now on, or delete the placeholders here.' : ''), !!val.objError || !!val.uploadError, placed > 0);
          } else {
            note('Not applied: ' + esc2(String(val.msg || val.state)), true);
          }
        });
      }
      W.URL.createObjectURL = function (obj) {
        var url = make.call(W.URL, obj);
        try { if (obj && typeof obj.size === 'number' && typeof obj.slice === 'function') blobs[url] = obj; } catch (e) {}
        return url;
      };
      W.URL.revokeObjectURL = function (url) {
        delete blobs[url];
        return revoke.call(W.URL, url);
      };
      W.HTMLAnchorElement.prototype.click = function () {
        var a = this, b = a && a.download ? blobs[a.href] : null;
        if (b && saves.download) {
          // Save a file… on Ctrl+S (v1.42.0): this one is for Downloads
          var forFile = Date.now() < saves.download;
          saves.download = 0;
          if (forFile) return click.apply(this, arguments);
        }
        if (b && saves.syncing && !/\.svg$/i.test(a.download)) {
          // a sync's save in another format, as the document was saved before: held back; the sync makes it SVG
          saves.other = Date.now();
          return undefined;
        }
        if (b && /\.svg$/i.test(a.download)) {
          var name = String(a.download), key = 'iwdie.vc.result.' + job.id;
          saves.caught++;
          b.text().then(function (text) {
            if (!/<svg\b/i.test(text)) throw new Error('the saved file is not an SVG');
            var editing = /vectorcraft:document/.test(text);
            if (editing) saves.editing = true;
            if (pending && pending.timer) clearTimeout(pending.timer);
            var mine = pending = { editing: editing, timer: null };
            GM_setValue(key, { svg: text, name: name, at: Date.now(), editing: editing });
            if (!canAck) {
              pending = null;
              note('✓ Sent to the panel at ' + hhmm() + '.');
              return;
            }
            note('Sending to the Designer…');
            mine.timer = setTimeout(function () {
              if (pending !== mine) return;
              pending = null;
              try { GM_deleteValue(key); } catch (e) {}
              download(b, name);
              note('No Designer tab answered - the panel was closed or reloaded - so the SVG went to <b>Downloads</b> instead. ' +
                'Open <b>Edit in VectorCraft</b> from the Designer again to send work back.', true);
            }, 8000);
          }).then(null, function (e) { note('Not sent: ' + esc2(String((e && e.message) || e)), true); });
          return undefined;
        }
        if (b && /\.svgz$/i.test(a.download)) note('Saved as SVG Compressed, which goes to Downloads - choose <b>SVG</b> to send it to the panel.', true);
        return click.apply(this, arguments);
      };
      // the panel first, as a fresh app opens it as a document; then the libraries, a moment apart,
      // through the menu bar, which sends a library to Libraries even with a document open: the
      // components, then the IWMAC objects
      var libText = lib ? vcLibraryText(lib) : null;
      var objText = vcLibraryText({ items: objItems }, { name: IWDIE_VC_OBJ_LIBRARY, prefix: 'iwmac-obj-' });
      var pause = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
      var failed = function (say, what) {
        return function (e) { say(what + ' could not be added: ' + esc2(String((e && e.message) || e)), true); };
      };
      vcWhenReady(function () {
        try { vcDropFile(job.svg, job.name || 'panel.svg', 'image/svg+xml', 'center'); }
        catch (e) { note('The panel could not be opened here: ' + esc2(String((e && e.message) || e)), true); return; }
        ui.later(20000);
        try { vcObjectMenu(note, looks); } catch (e) { objLine('The IWMAC menu could not be added: ' + esc2(String((e && e.message) || e)), true); }
        try { vcSaveSync(job, note, saves); } catch (e) { note('Ctrl+S could not be set to sync: ' + esc2(String((e && e.message) || e)), true); }
        (libText ? libText.then(function (text) {
          return pause(1200).then(function () {
            vcDropFile(text, 'Komponenter.vclibrary', 'application/json', 'menu');
            comp('<b>' + iwdieN(lib.items.length, 'component', 'components') + '</b> in <b>Libraries</b> (right), as “Komponenter' +
              (lib.file ? ' - ' + esc2(lib.file) : '') + '”: drag one onto the drawing, or double-click it.');
          });
        }).then(null, failed(comp, 'The components')) : Promise.resolve()).then(function () {
          return objText.then(function (text) {
            return pause(1200).then(function () {
              vcDropFile(text, 'IWMAC-objekter.vclibrary', 'application/json', 'menu');
              objLine('<b>' + iwdieN(objItems.length, 'kind', 'kinds') + '</b>: the <b>IWMAC</b> menu up top - choose one, click where it goes - or ' +
                '<b>Libraries</b>, “' + esc2(IWDIE_VC_OBJ_LIBRARY) + '”. Size it, write its text (JV401) over the one it has. Saved back, each becomes that object in the panel.');
            });
          }).then(null, failed(objLine, 'The IWMAC objects'));
        });
      }, note);
    }

    /* ---------- Edit in VectorCraft (v1.35.0): the Designer's side ---------- */
    /** Edit in VectorCraft… on the sidebar (v1.36.0, in place of Draw background…): the panel
     *  straight into the editor, in a new tab. */
    function doEditInVectorCraft() {
      if (!hostReady()) { toast('IWMAC Designer not ready yet — host functions missing.', true); return; }
      if (typeof GM_setValue !== 'function' || typeof GM_addValueChangeListener !== 'function') {
        toast('This needs Tampermonkey’s storage (GM_setValue) - update Tampermonkey and the script.', true, 8000);
        return;
      }
      var tab = W.open('about:blank', '_blank');          // opened now, inside the click, or the browser blocks it
      if (!tab) { toast('The browser blocked the new tab - allow pop-ups for this page, then try again.', true, 10000); return; }
      try { tab.opener = null; } catch (e) {}             // the editor's page gets no handle on this one
      libMigrate();
      var url = grabBackgroundUrl();
      var info = { url: url, bg: null, found: null, objects: exportPanelObjects(), size: exportPanelSize(), plant: currentPlantId(), panel: currentPanelName() };
      // the objects' looks for the editor's page (v1.43.0); without them it shows boxes
      var looked = vcObjectLooks().then(null, function () { return null; });
      // a background that cannot be read must not become an empty one in the editor
      (url ? fetchBackgroundBytes(url) : Promise.resolve(null)).then(function (bg) {
        return looked.then(function () { return bg; });
      }).then(function (bg) {
        info.bg = bg;
        info.found = (bg && iwdieSniffMime(bg.bytes) === 'image/png') ? iwdieDrawExtract(bg.bytes) : null;
        vcStartEdit(info, tab);
      }, function (e) {
        try { tab.close(); } catch (e2) {}
        toast('The background picture could not be read, so VectorCraft was not opened: ' + ((e && e.message) || e), true, 10000);
      });
    }

    /** The VectorCraft SVG a picture keeps, unpacked when it is kept compressed (v1.38.0).
     *  -> Promise<svg text | null> */
    function vcDocumentOf(bytes) {
      var ch = (bytes && iwdieSniffMime(bytes) === 'image/png') ? iwdieVcChunk(bytes) : null;
      if (!ch) return Promise.resolve(null);
      var text = function (u8) { var t = iwdieUtf8Decode(u8); return /<svg\b/i.test(t) ? t : null; };
      if (ch.type !== IWDIE_VC_ZCHUNK) return Promise.resolve(text(ch.data));
      return libInflate(ch.data).then(text, function () { return null; });
    }

    /** The SVG as the background PNG keeps it (v1.38.0): compressed, and without VectorCraft's
     *  own copy of the document when that would weigh more than IWDIE_VC_BUDGET. Without
     *  CompressionStream, as plain text. -> Promise<{type, data, lean, full}> */
    function vcPack(svg) {
      return deflateBytes(iwdieUtf8Encode(svg)).then(function (z) {
        var full = { type: IWDIE_VC_ZCHUNK, data: z, lean: false, full: z.length };
        if (z.length <= IWDIE_VC_BUDGET) return full;
        var lean = iwdieVcStripEditing(svg);
        if (lean.length === svg.length) return full;
        return deflateBytes(iwdieUtf8Encode(lean)).then(function (z2) { return { type: IWDIE_VC_ZCHUNK, data: z2, lean: true, full: z.length }; });
      }).then(null, function () { return { type: IWDIE_VC_CHUNK, data: iwdieUtf8Encode(svg), lean: false, full: 0 }; });
    }

    /** Open the panel in the tab given: the VectorCraft document the background came from
     *  when it has one, else an SVG of the picture, any drawing in it and the panel's objects. */
    function vcStartEdit(info, tab) {
      var size = info.size, fill = grabBackgroundFillColor() || '#e5e7ea', vc = false;
      var shapes = info.found ? info.found.drawing.shapes : [];
      var base = info.found ? info.found.base : (info.bg ? { mime: info.bg.mime, bytes: info.bg.bytes } : null);
      var build = vcDocumentOf(info.bg && info.bg.bytes).then(function (doc) {
        return doc || (info.found && info.found.base ? vcDocumentOf(info.found.base.bytes) : null);
      }).then(function (doc) {
        if (doc) { vc = true; return shapes.length ? iwdieVcMergeShapes(doc, shapes) : doc; }
        return exportPaint(base && base.bytes, base && base.mime, size, null).then(function (c) {
          var hex = '#' + iwdieParseCssColor(fill).map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
          return iwdieVcSvg({ width: size.w, height: size.h, plate: hex, picture: base ? c.toDataURL('image/png') : null, shapes: shapes, objects: info.objects,
            title: (info.panel || 'Panel') + (info.plant ? ' - plant ' + info.plant : '') });
        });
      });
      build.then(function (svg) {
        var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var safe = String(info.panel || 'panel').replace(/[^A-Za-z0-9æøåÆØÅ._-]+/g, '-').replace(/^-+|-+$/g, '') || 'panel';
        var job = { id: id, svg: svg, name: 'iwmac-' + (info.plant || 'plant') + '-' + safe + '.svg', panel: info.panel || '', plant: info.plant || '', at: Date.now(), version: IWDIE_VERSION };
        GM_setValue('iwdie.vc.job', job);
        GM_addValueChangeListener('iwdie.vc.result.' + id, function (key, old, val) {
          if (!val || !val.svg) return;
          try { GM_deleteValue(key); } catch (e) {}
          // the editor's tab waits for this answer, and saves to Downloads when none comes
          vcApplyResult(val, info, function (state, msg, extra) {
            var a = { state: state, msg: msg || '', at: Date.now() };
            if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
            try { GM_setValue('iwdie.vc.ack.' + id, a); } catch (e) {}
          });
        });
        var url = IWDIE_VC_URL + '#job=' + id;
        if (tab && !tab.closed) tab.location.href = url; else tab = W.open(url, '_blank');
        if (!tab) { toast('The browser blocked the new tab - allow pop-ups for this page, then try again.', true, 10000); return; }
        var what = vc
          ? 'The VectorCraft document behind this background' + (shapes.length ? ', with the drawing from Draw on a layer of its own,' : '')
          : (base ? 'The picture' : 'An empty ' + size.w + ' × ' + size.h + ' canvas') +
            (shapes.length ? ', the drawing from Draw (' + iwdieN(shapes.length, 'shape', 'shapes') + ')' : '') + ' and the panel’s objects (on a hidden layer)';
        outcomeToast({
          tone: 'good', title: 'Opening in VectorCraft',
          lines: [what + ' - in a new tab.',
            'Press Ctrl+S there and choose Sync to IWMAC Designer: the picture comes straight back to this background, and its PNG goes to the plant’s pictures.',
            'The Designer’s own objects are in its IWMAC menu, after Help, and in its Libraries panel: placed and saved back, each becomes that object here. ' +
              'Your components from Illustrator are in Libraries too, once read.'],
          footer: 'Nothing leaves the browser. The first start downloads the editor (about 20 MB); after that it is cached.'
        });
      }).then(null, function (e) {
        try { if (tab && !tab.closed) tab.close(); } catch (e2) {}
        toast('VectorCraft could not be opened: ' + ((e && e.message) || e), true, 10000);
      });
    }

    /* ---------- IWMAC objects (v1.40.0): placeholders saved back become objects ---------- */
    /** An element's box in its drawing's viewport: the union of its shapes' boxes, each through
     *  its own transform - its text left out, which may run past the box - or, with no shape in
     *  it, its own. Hidden, by itself or by what holds it: {hidden: true}. VectorCraft leaves
     *  hidden objects out of its SVG; another editor may not. -> {x, y, w, h} | {hidden} | null */
    function vcBox(g) {
      for (var a = g; a && a.nodeType === 1; a = a.parentNode) if (a.getAttribute('display') === 'none') return { hidden: true };
      var box = null;
      var add = function (el) {
        var b, m;
        try { b = el.getBBox(); m = el.getCTM(); } catch (e) { return; }
        if (!b || !m || !(b.width > 0 || b.height > 0)) return;
        [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].forEach(function (p) {
          var x = m.a * p[0] + m.c * p[1] + m.e, y = m.b * p[0] + m.d * p[1] + m.f;
          if (!box) box = { x0: x, y0: y, x1: x, y1: y };
          else { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); }
        });
      };
      var shapes = g.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon');
      for (var i = 0; i < shapes.length; i++) add(shapes[i]);
      if (!box) add(g);
      return box ? { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 } : null;
    }

    /** The boxes of `groups` (placeholders in `doc`), in panel pixels: measured on a copy of the
     *  drawing laid out at the panel's size, out of sight, as the background is drawn - the copy
     *  without its pictures, styles, scripts, handlers and links, which a measurement does not
     *  need and which must not run or load here. */
    function vcMeasure(doc, groups, size) {
      groups.forEach(function (g, k) { g.setAttribute('data-iwdie-ph', String(k)); });
      var root = document.importNode(doc.documentElement, true);
      groups.forEach(function (g) { g.removeAttribute('data-iwdie-ph'); });
      Array.prototype.slice.call(root.querySelectorAll('script,style,foreignObject,image,metadata,iframe,audio,video')).forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      Array.prototype.slice.call(root.querySelectorAll('*')).concat([root]).forEach(function (el) {
        Array.prototype.slice.call(el.attributes).forEach(function (a) {
          var n = a.name.toLowerCase();
          if (n.indexOf('on') === 0 || (/(^|:)href$/.test(n) && a.value.charAt(0) !== '#')) el.removeAttribute(a.name);
        });
      });
      root.setAttribute('width', String(Math.round(size.w)));
      root.setAttribute('height', String(Math.round(size.h)));
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-30000px;top:0;width:' + Math.round(size.w) + 'px;height:' + Math.round(size.h) + 'px;overflow:hidden;visibility:hidden;pointer-events:none';
      host.appendChild(root);
      (document.body || document.documentElement).appendChild(host);
      try {
        return groups.map(function (g, k) {
          var el = root.querySelector('[data-iwdie-ph="' + k + '"]');
          return el ? vcBox(el) : null;
        });
      } finally {
        host.parentNode.removeChild(host);
      }
    }

    /** A saved drawing without its placeholders, and what they were: the SVG as it came when it
     *  has none. With them gone it is kept without VectorCraft's own copy of the document, which
     *  still has them (and whose check of the drawing no longer matches it), so the next edit
     *  opens what is left. -> {svg, found, skipped} */
    function vcPlaceholders(svg, size) {
      var none = { svg: svg, found: [], skipped: 0 };
      if (!/IWMAC[ _]/.test(svg)) return none;
      var doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return none;
      var took = iwdieVcTakePlaceholders(doc, function (groups) { return vcMeasure(doc, groups, size); });
      if (!took.found.length && !took.skipped) return none;
      var out = new XMLSerializer().serializeToString(doc);
      if (!/^<\?xml/.test(out)) out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
      return { svg: iwdieVcStripEditing(out), found: took.found, skipped: took.skipped };
    }

    /** Placeholders as objects on the panel, through the Designer's own loader, as Insert puts
     *  them there. -> {placed, already, error} */
    function vcPlaceObjects(found) {
      var made = iwdieVcDesignerObjects(found, exportPanelObjects());
      if (!made.objects.length) return { placed: 0, already: made.already, error: '' };
      try {
        new W.DesignPanelHandler().load_new_ver_objects(iwdieNormalizeDoc({ single_objects: made.objects }).single_objects);
      } catch (e) {
        return { placed: 0, already: made.already, error: String((e && e.message) || e) };
      }
      renumberCanvasNames();
      try { W.UpdateObjectWorker(); } catch (e) {}
      try { if (!document.getElementById('mouse_selector') && typeof W.make_mouse_selector === 'function') W.make_mouse_selector(); } catch (e) {}
      return { placed: made.objects.length, already: made.already, error: '' };
    }

    /* ---------- Sync to IWMAC Designer (v1.42.0): the picture uploaded ---------- */
    /** A path of the Designer's own site, from the page this runs on. */
    function vcDesignerUrl(path) {
      return new URL(path, location.href).href;
    }

    /** The plant as the Designer's own pages name it to the server (cust_id). */
    function vcCustId() {
      try { if (typeof W.get_cust_id === 'function' && W.get_cust_id()) return String(W.get_cust_id()); } catch (e) {}
      return String(currentPlantId() || '');
    }

    /** The background's PNG uploaded to the plant's pictures, as Manage Images' Upload to server
     *  does it: the same request, read the same way. Its name is chosen at the first sync of an
     *  edit (iwdieVcUploadName) and written over by the later ones. -> Promise<{ok, name, message}> */
    function vcUploadPng(bytes, info) {
      var cust = vcCustId();
      if (!cust) return Promise.resolve({ ok: false, name: '', message: 'the plant is not known here' });
      var kept = function () {
        var all = {};
        try { all = GM_getValue(IWDIE_VC_UPLOADS_KEY, {}) || {}; } catch (e) { all = {}; }
        return all;
      };
      var naming = info.uploadName ? Promise.resolve(info.uploadName) :
        fetch(vcDesignerUrl('designer_site/iw_get_image.php?cust_id=' + encodeURIComponent(cust)), { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) { return r.ok ? r.text() : ''; }, function () { return ''; })
          .then(function (xml) {
            var ours = kept()[cust];
            info.uploadName = iwdieVcUploadName(info.plant || cust, info.panel, new Date(), iwdieVcImageNames(xml), Array.isArray(ours) ? ours : []);
            return info.uploadName;
          });
      return naming.then(function (name) {
        var form = new FormData();
        form.append('userfile', new Blob([bytes], { type: 'image/png' }), name);
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = ctl ? setTimeout(function () { ctl.abort(); }, 60000) : null;
        return fetch(vcDesignerUrl('designer_site/iw_upload_image.php?cust_id=' + encodeURIComponent(cust)),
          { method: 'POST', body: form, credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
          .then(function (r) { return r.text(); })
          .then(function (text) {
            var reply = iwdieVcUploadReply(text);
            if (reply.ok) {
              try {
                var all = kept(), list = Array.isArray(all[cust]) ? all[cust] : [];
                if (list.indexOf(name) < 0) list.push(name);
                all[cust] = list.slice(-200);
                GM_setValue(IWDIE_VC_UPLOADS_KEY, all);
              } catch (e) {}
            }
            return { ok: reply.ok, name: name, message: reply.message };
          }, function (e) {
            return { ok: false, name: name, message: (e && e.name === 'AbortError') ? 'the server did not answer within a minute' : String((e && e.message) || e) };
          })
          .then(function (r) { if (timer) clearTimeout(timer); return r; });
      });
    }

    /* ---------- the IWMAC objects' looks (v1.43.0) ---------- */
    /** A picture of the Designer's as PNG: a data URL, its size, and the mean colour of its opaque
     *  pixels (the header's bar). -> Promise<{url, w, h, mean}> */
    function vcIconPng(url) {
      return fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) {
        var u = URL.createObjectURL(blob);
        return loadPicture(u).then(function (img) {
          URL.revokeObjectURL(u);
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!(w > 0 && h > 0)) throw new Error('an empty picture');
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          var d = g.getImageData(0, 0, w, h).data, r = 0, gg = 0, b = 0, n = 0;
          for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
          var hex = function (v) { v = Math.round(v / Math.max(1, n)); return (v < 16 ? '0' : '') + v.toString(16); };
          return { url: c.toDataURL('image/png'), w: w, h: h, mean: n ? '#' + hex(r) + hex(gg) + hex(b) : '' };
        }, function (e) { URL.revokeObjectURL(u); throw e; });
      });
    }

    /** Each IWMAC object's size as the Designer draws it - its live render definition, `controls` -
     *  and its picture from /iw_icons/, as PNG, left in Tampermonkey's storage for the editor's page.
     *  Kept a week; fetched again sooner when the catalogue has an object they lack. -> Promise<looks> */
    function vcObjectLooks() {
      var cat = iwdieVcObjectCatalog(), kept = null;
      try { kept = GM_getValue(IWDIE_VC_LOOKS_KEY, null); } catch (e) { kept = null; }
      if (kept && kept.items && kept.at > Date.now() - 7 * 864e5 && cat.every(function (o) { return kept.items[o.id]; })) return Promise.resolve(kept.items);
      var ctl = W.controls || {}, items = {};
      return Promise.all(cat.map(function (o) {
        var live = null, w = o.w, h = o.h, pic = o.pic;
        try { live = ctl[o.id]; } catch (e) { live = null; }
        if (live) {
          var lw = parseFloat(live.width), lh = parseFloat(live.height);
          if (lw >= 8) w = lw;              // a label's render width is a stub: it sizes to its text
          if (lh >= 8) h = lh;
          if (typeof live.file === 'string' && live.file) pic = live.file;
        }
        var look = items[o.id] = { w: w, h: h };
        if (!pic) return null;
        return vcIconPng(vcDesignerUrl('../iw_icons/' + pic)).then(function (p) {
          look.src = p.url; look.iw = p.w; look.ih = p.h;
          if (p.mean) look.bar = p.mean;
        }, function () {});
      })).then(function () {
        try { GM_setValue(IWDIE_VC_LOOKS_KEY, { at: Date.now(), items: items }); } catch (e) {}
        return items;
      });
    }

    /** What VectorCraft saved, as the panel's background: drawn at panel size, with the SVG
     *  (and VectorCraft's own document inside it) kept in the PNG for the next edit. The IWMAC
     *  placeholders in it come out of the picture and become their objects (v1.40.0). */
    function vcApplyResult(val, info, ack) {
      ack = ack || function () {};
      var svg = String(val.svg || '');
      if (!/<svg\b/i.test(svg) || svg.length > 40 * 1024 * 1024) {
        toast('VectorCraft sent something that is not a usable SVG.', true, 8000);
        ack('failed', 'The Designer could not use it: it is not a usable SVG.');
        return;
      }
      // the Designer changes panels without reloading, and this listener outlives that
      var panelNow = currentPanelName(), plantNow = currentPlantId();
      if ((info.panel && panelNow !== info.panel) || (info.plant && plantNow !== String(info.plant))) {
        toast('A VectorCraft save for “' + info.panel + '” arrived, but “' + panelNow + '” is open now. Nothing was changed - open “' +
          info.panel + '” again, then save again in VectorCraft.', true, 12000);
        ack('refused', 'The Designer has “' + panelNow + '” open now, not “' + info.panel + '”. Open that panel there, then save again.');
        return;
      }
      ack('received');
      var size = exportPanelSize(), ph;
      try { ph = vcPlaceholders(svg, size); } catch (e) {
        toast('The IWMAC objects in the VectorCraft save could not be read, so nothing was changed: ' + ((e && e.message) || e), true, 10000);
        ack('failed', 'The Designer could not read the IWMAC objects in it: ' + ((e && e.message) || e));
        return;
      }
      svg = ph.svg;
      var sized = iwdieVcSized(svg, size.w, size.h);
      var url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
      loadPicture(url).then(function (img) {
        URL.revokeObjectURL(url);
        var c = document.createElement('canvas');
        c.width = size.w; c.height = size.h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = grabBackgroundFillColor() || '#ffffff';
        ctx.fillRect(0, 0, size.w, size.h);
        ctx.drawImage(img, 0, 0, size.w, size.h);
        return new Promise(function (resolve, reject) {
          c.toBlob(function (blob) {
            if (!blob) { reject(new Error('the browser would not encode the PNG')); return; }
            blob.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, reject);
          }, 'image/png');
        });
      }).then(function (pngBytes) {
        return vcPack(svg).then(function (pack) { return { png: pngBytes, pack: pack }; });
      }).then(function (r) {
        var pack = r.pack, withDoc = iwdieVcEmbed(r.png, pack.data, pack.type), mi = document.getElementById('main_image');
        var dataUrl = 'data:image/png;base64,' + iwdieBytesToBase64(withDoc);
        W.iw_set_base_image((mi && mi.style.width) || (size.w + 'px'), (mi && mi.style.height) || (size.h + 'px'), dataUrl);
        try { if (!W.$('#main_image').attr('org_image_name')) W.$('#main_image').attr('org_image_name', 'iwdie-vectorcraft.png'); } catch (e) {}
        var objs = ph.found.length ? vcPlaceObjects(ph.found) : { placed: 0, already: 0, error: '' };
        var lines = [Math.round(withDoc.length / 1024) + ' kB, ' + size.w + ' × ' + size.h + ' px' +
          (pack.lean ? ' - kept as plain SVG, without VectorCraft’s own copy of the document (' + (Math.round(pack.full / 104857.6) / 10) +
            ' MB compressed), so the picture stays light: the next edit opens the same layers and paths.'
            : ph.found.length || ph.skipped ? ' - kept as plain SVG without the IWMAC placeholders: the next edit opens what is left, layers and paths.'
            : val.editing ? ', with the VectorCraft document inside, compressed, for the next edit.'
            : ' - saved as plain SVG (without Preserve Editing Capabilities): the next edit opens its layers and paths.')];
        if (objs.error) lines.push('The IWMAC objects could not be placed: ' + objs.error + '. Their placeholders are out of the picture; save again in VectorCraft to try again.');
        else if (objs.placed) lines.push(iwdieN(objs.placed, 'IWMAC object', 'IWMAC objects') +
          (objs.placed === 1 ? ' placed where its placeholder was' : ' placed where their placeholders were') + ' - unlinked, to link as any new object' +
          (objs.already ? '; ' + objs.already + ' there already' : '') + '.');
        else if (objs.already) lines.push('Its IWMAC objects were on the panel already, where their placeholders are.');
        if (ph.skipped) lines.push(iwdieN(ph.skipped, 'placeholder', 'placeholders') + ' had no size (hidden?) and became no object.');
        // and its PNG to the plant's pictures, as Upload to server does, named on the panel as Set background names it (v1.42.0)
        return vcUploadPng(withDoc, info).then(function (up) {
          if (up.ok) {
            try {
              if (typeof W.imagesetValue === 'function') W.imagesetValue(up.name, size.w, size.h, dataUrl);
              else W.$('#main_image').attr('org_image_name', up.name);
            } catch (e) {}
            lines.push('Its PNG is in the plant’s pictures on the server as ' + up.name + '.');
          } else {
            lines.push('Its PNG was not uploaded to the plant’s pictures: ' + up.message + '. The background is set all the same.');
          }
          outcomeToast({
            tone: objs.error || !up.ok ? 'caution' : 'good', title: objs.placed ? '✅ Background and IWMAC objects from VectorCraft' : '✅ Background updated from VectorCraft',
            lines: lines,
            footer: 'The panel is not saved yet — use the designer’s own Save when you are happy.'
          });
          ack('applied', Math.round(withDoc.length / 1024) + ' kB', { placed: objs.placed, already: objs.already, skipped: ph.skipped, objError: objs.error,
            uploaded: up.ok ? up.name : '', uploadError: up.ok ? '' : up.message });
        });
      }).then(null, function (e) {
        try { URL.revokeObjectURL(url); } catch (e2) {}
        toast('The VectorCraft picture could not be used: ' + ((e && e.message) || e), true, 10000);
        ack('failed', 'The Designer could not use the picture: ' + ((e && e.message) || e));
      });
    }

    /* ---------- Export Background (v1.34.0) ----------
       What used to be three blue buttons is one choice and one Export, in
       VectorCraft's style: choice cards, the options of the chosen one under it,
       Cancel and the blue pill at the bottom right, Enter and Esc. The .ai is a
       real Illustrator document now - see iwdieAiProgram. */
    var exportDialog = null;

    function closeExportDialog() {
      if (exportDialog) { exportDialog.back.remove(); exportDialog.dlg.remove(); exportDialog = null; }
      document.removeEventListener('keydown', onExportDialogKeydown, true);
    }

    function onExportDialogKeydown(ev) {
      if (!exportDialog) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeExportDialog(); }
      else if (ev.key === 'Enter' && !(ev.target && ev.target.tagName === 'BUTTON')) { ev.preventDefault(); ev.stopPropagation(); exportDialog.go(); }
    }

    /** The panel's size as the canvas shows it. */
    function exportPanelSize() {
      var mi = document.getElementById('main_image'), w = 0, h = 0;
      try { w = parseInt(W.$(mi).css('width'), 10); h = parseInt(W.$(mi).css('height'), 10); } catch (e) {}
      if (!(w > 0) && mi) w = mi.clientWidth;
      if (!(h > 0) && mi) h = mi.clientHeight;
      return { w: w > 0 ? w : 1400, h: h > 0 ? h : 750 };
    }

    /** The panel's objects, quietly: the reference layer is a nice-to-have, never a reason to fail. */
    function exportPanelObjects() {
      try {
        W.obj_data = []; W.container_data = []; W.container_items = [];
        var imgName = '';
        try { imgName = W.$('#main_image').attr('main_image') || ''; } catch (e) {}
        var doc = W.getPanelDataFromDOM(currentPlantId(), currentPanelName(), imgName, W.get_user_name());
        return (doc && Array.isArray(doc.single_objects)) ? doc.single_objects.filter(function (o) { return o && typeof o === 'object' && o.posLeft !== undefined; }) : [];
      } catch (e) { return []; }
    }

    function openExportDialog(url, plant, panelName, deliver) {
      closeExportDialog();
      var esc2 = iwdieEscHtml, size = exportPanelSize(), objects = exportPanelObjects();
      fetchBackgroundBytes(url).then(null, function () { return null; }).then(function (bg) {
        var found = (bg && iwdieSniffMime(bg.bytes) === 'image/png') ? iwdieDrawExtract(bg.bytes) : null;
        var nShapes = found ? found.drawing.shapes.length : 0;
        var back = document.createElement('div');
        back.className = 'iwdie-vc iwdie-vc-back';
        var dlg = document.createElement('div');
        dlg.className = 'iwdie-vc iwdie-vc-dlg';
        dlg.setAttribute('role', 'dialog');
        dlg.setAttribute('aria-label', 'Export Background');
        var card = function (value, title, desc, opts, on, off) {
          return '<div class="iwdie-vc-card' + (on ? ' iwdie-on' : '') + (off ? ' iwdie-off' : '') + '" data-fmt="' + value + '">' +
            '<input type="radio" name="iwdie_vc_fmt" value="' + value + '"' + (on ? ' checked' : '') + (off ? ' disabled' : '') + '>' +
            '<div><div class="iwdie-vc-t">' + title + '</div><div class="iwdie-vc-d">' + desc + '</div>' + (opts ? '<div class="iwdie-vc-opts">' + opts + '</div>' : '') + '</div></div>';
        };
        var opt = function (key, label, note, checked, disabled) {
          return '<label class="iwdie-vc-opt' + (disabled ? ' iwdie-off' : '') + '"><input type="checkbox" data-opt="' + key + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
            '<span>' + label + (note ? ' <small>' + note + '</small>' : '') + '</span></label>';
        };
        var sub = ['<b>' + esc2(panelName || 'This panel') + '</b>', size.w + ' × ' + size.h + ' px'];
        if (nShapes) sub.push('a drawing of ' + iwdieN(nShapes, 'shape', 'shapes'));
        if (objects.length) sub.push(iwdieN(objects.length, 'object', 'objects'));
        dlg.innerHTML = [
          '<h2>Export Background</h2>',
          '<div class="iwdie-vc-sub">' + sub.join(' · ') + '</div>',
          '<div class="iwdie-vc-cards" role="radiogroup">',
          card('ai', 'Illustrator document (.ai)',
            'Opens in Illustrator with layers: the picture locked at the bottom, the drawing as editable shapes on top, the panel’s objects on a hidden reference layer.',
            opt('drawing', 'Drawing as editable shapes', nShapes ? '(' + iwdieN(nShapes, 'shape', 'shapes') + ')' : '(this background has none)', !!nShapes, !nShapes) +
            opt('objects', 'Panel objects, on a hidden layer', objects.length ? '(' + objects.length + ')' : '(none found)', !!objects.length, !objects.length) +
            opt('trace', 'Vector trace of the picture, on a hidden layer', IWDIE_TRACER ? '(seconds to minutes)' : '(not available here)', false, !IWDIE_TRACER),
            true, false),
          card('svg', 'SVG — vector trace',
            'The picture traced to editable shapes in its own colours, grouped and named by what they are. Small text becomes outlines; retype it in Illustrator.',
            '', false, !deliver.svg),
          card('raw', 'Picture as-is (.PNG / .JPG)',
            'Byte for byte as the designer shows it, transparent holes filled with the canvas colour. The one to hand an AI that should look at the panel.',
            '', false, false),
          '</div>',
          '<div class="iwdie-vc-hint">If the drawing’s own Illustrator file (.ai) is in your archive, editing that beats any export.</div>',
          '<div class="iwdie-vc-foot"><button class="iwdie-vc-pill iwdie-vc-secondary" data-act="cancel">Cancel</button>' +
          '<button class="iwdie-vc-pill iwdie-vc-primary" data-act="export">Export</button></div>'
        ].join('');
        document.body.appendChild(back);
        document.body.appendChild(dlg);
        var choose = function (value) {
          Array.prototype.forEach.call(dlg.querySelectorAll('.iwdie-vc-card'), function (c) {
            var on = c.getAttribute('data-fmt') === value;
            c.classList.toggle('iwdie-on', on);
            c.querySelector('input[type=radio]').checked = on;
          });
        };
        var go = function () {
          var picked = dlg.querySelector('input[name=iwdie_vc_fmt]:checked'), fmt = picked ? picked.value : 'ai';
          var flag = function (k) { var el = dlg.querySelector('[data-opt="' + k + '"]'); return !!(el && el.checked && !el.disabled); };
          var opts = { drawing: flag('drawing'), objects: flag('objects'), trace: flag('trace') };
          closeExportDialog();
          if (fmt === 'svg' && deliver.svg) deliver.svg();
          else if (fmt === 'raw') deliver.raw();
          else exportIllustratorDocument({ url: url, bg: bg, found: found, objects: objects, size: size, plant: plant, panel: panelName }, opts);
        };
        dlg.addEventListener('click', function (ev) {
          var act = ev.target.closest ? ev.target.closest('[data-act]') : null;
          if (act) { if (act.getAttribute('data-act') === 'export') go(); else closeExportDialog(); return; }
          if (ev.target.closest && ev.target.closest('.iwdie-vc-opts')) return;
          var c = ev.target.closest ? ev.target.closest('.iwdie-vc-card') : null;
          if (c && !c.classList.contains('iwdie-off')) choose(c.getAttribute('data-fmt'));
        });
        dlg.addEventListener('dblclick', function (ev) {
          var c = ev.target.closest ? ev.target.closest('.iwdie-vc-card') : null;
          if (c && !c.classList.contains('iwdie-off') && !(ev.target.closest && ev.target.closest('.iwdie-vc-opts'))) { choose(c.getAttribute('data-fmt')); go(); }
        });
        back.addEventListener('mousedown', closeExportDialog);
        document.addEventListener('keydown', onExportDialogKeydown, true);
        exportDialog = { back: back, dlg: dlg, go: go };
        try { dlg.querySelector('[data-act="export"]').focus(); } catch (e) {}
      });
    }

    function loadPicture(src) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('a picture would not load')); };
        img.src = src;
      });
    }

    /** Paint the base the way the canvas shows it - its CSS size, position and
     *  repeat - so a picture that is not exactly panel-sized lands where the canvas shows it. */
    function paintPlaced(ctx, img, d) {
      var W0 = d.w, H0 = d.h;
      var iw = img.naturalWidth || img.width || W0, ih = img.naturalHeight || img.height || H0;
      var w = iw, h = ih, sz = String(d.place.size || 'auto').trim().split(/\s+/);
      if (sz[0] === 'cover' || sz[0] === 'contain') {
        var k = (sz[0] === 'cover' ? Math.max : Math.min)(W0 / iw, H0 / ih);
        w = iw * k; h = ih * k;
      } else {
        var len = function (v, full) { if (!v || v === 'auto') return null; var n = parseFloat(v); return isNaN(n) ? null : (/%$/.test(v) ? full * n / 100 : n); };
        var a = len(sz[0], W0), b = len(sz.length > 1 ? sz[1] : 'auto', H0);
        if (a !== null && b !== null) { w = a; h = b; }
        else if (a !== null) { w = a; h = ih * a / iw; }
        else if (b !== null) { h = b; w = iw * b / ih; }
      }
      var ps = String(d.place.pos || '0% 0%').trim().split(/\s+/);
      var off = function (v, free) { var n = parseFloat(v) || 0; return /%$/.test(v) ? free * n / 100 : n; };
      var x = off(ps[0], W0 - w), y = off(ps.length > 1 ? ps[1] : '0%', H0 - h);
      var rep = String(d.place.repeat || 'repeat');
      var rx = rep === 'repeat' || rep === 'repeat-x' || /^repeat\s/.test(rep);
      var ry = rep === 'repeat' || rep === 'repeat-y' || /\srepeat$/.test(rep);
      if (!(w >= 1 && h >= 1)) return;
      var x0 = rx ? x - Math.ceil(x / w) * w : x, y0 = ry ? y - Math.ceil(y / h) * h : y;
      for (var yy = y0; yy < H0; yy += h) {
        for (var xx = x0; xx < W0; xx += w) {
          ctx.drawImage(img, xx, yy, w, h);
          if (!rx) break;
        }
        if (!ry) break;
      }
    }

    /** A picture drawn onto a panel-sized canvas the way the canvas shows it: its CSS size,
     *  position and repeat, over `fill` when one is given. -> Promise<canvas> */
    function exportPaint(bytes, mime, size, fill) {
      var mi = document.getElementById('main_image'), cs = mi ? getComputedStyle(mi) : null;
      var place = { size: cs ? cs.backgroundSize : 'auto', pos: cs ? cs.backgroundPosition : '0% 0%', repeat: cs ? cs.backgroundRepeat : 'no-repeat' };
      var c = document.createElement('canvas');
      c.width = size.w; c.height = size.h;
      var ctx = c.getContext('2d');
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, size.w, size.h); }
      if (!bytes) return Promise.resolve(c);
      return loadPicture('data:' + (mime || 'image/png') + ';base64,' + iwdieBytesToBase64(bytes)).then(function (img) {
        paintPlaced(ctx, img, { w: size.w, h: size.h, place: place });
        return c;
      });
    }

    /** The picture as the tracer wants it, traced in the worker (or, without one, here). -> Promise<tidied svg> */
    function exportTrace(canvas, size, fill) {
      return loadPicture(canvas.toDataURL('image/png')).then(function (img) {
        var got = buildTraceSource(img, size.w, size.h, fill);
        if (!got) throw new Error('the picture’s pixels could not be read for tracing');
        var prog = openTraceProgress('Tracing the picture for the .ai');
        var job = traceInWorker(got.data, iwdieTraceOptionsIllustrator(got.scale), IWDIE_TRACE_PALETTE_COLORS, prog.step);
        prog.onCancel(job.cancel);
        return job.promise.then(null, function (e) {
          if (!e || e.kind !== 'no-worker') throw e;
          var again = buildTraceSource(img, size.w, size.h, fill), illu = iwdieTraceOptionsIllustrator(again.scale);
          var pal = iwdieBuildPalette(again.data, IWDIE_TRACE_PALETTE_COLORS);
          if (pal) illu.pal = pal;
          got = again;
          return IWDIE_TRACER.imagedataToSVG(again.data, illu);
        }).then(function (svg) {
          prog.close();
          return iwdieTidyTraceSvg(svg, got.scale, size.w, size.h);
        }, function (e) { prog.close(); throw e; });
      });
    }

    /** The .ai: the picture under the drawing on a locked layer, the drawing's shapes as
     *  Illustrator objects, the panel's objects and (on request) a trace on hidden layers -
     *  Illustrator's own editing data inside a PDF whose page shows the panel as it looks. */
    function exportIllustratorDocument(info, opts) {
      var size = info.size, fill = grabBackgroundFillColor() || '#e5e7ea';
      var name = iwdieBuildBackgroundFilename(info.plant, info.panel, 'ai');
      var base = info.found ? info.found.base : (info.bg ? { mime: info.bg.mime, bytes: info.bg.bytes } : null);
      var shapes = (opts.drawing && info.found) ? info.found.drawing.shapes : [];
      var objects = opts.objects ? info.objects : [];
      var t0 = Date.now(), traceShapes = [];
      toast('Writing the Illustrator document…', false, 4000);
      exportPaint(base && base.bytes, base && base.mime, size, null).then(function (picCanvas) {
        var job = opts.trace ? exportTrace(picCanvas, size, fill).then(function (svg) { traceShapes = iwdieAiTraceShapes(svg); }) : Promise.resolve();
        return job.then(function () { return picCanvas; });
      }).then(function (picCanvas) {
        var rgba = base ? picCanvas.getContext('2d').getImageData(0, 0, size.w, size.h).data : null;
        var lines = function (list) { var out = []; list.forEach(function (sh) { out = out.concat(iwdieAiShapeLines(sh)); }); return out; };
        var layers = [{
          name: 'Bakgrunn', locked: true,
          lines: iwdieAiShapeLines({ t: 'rect', x: 0, y: 0, w: size.w, h: size.h, rx: 0, st: { fill: '#' + iwdieParseCssColor(fill).map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join(''), stroke: null, sw: 0 } }, 'Lerret'),
          raster: rgba ? iwdieAiRasterParts(rgba, size.w, size.h, 0, 0, size.w, size.h, 'Bakgrunnsbilde') : null
        }];
        if (traceShapes.length) layers.push({ name: 'Sporing', visible: false, lines: lines(traceShapes) });
        layers.push({ name: 'Tegning', lines: lines(shapes) });
        if (objects.length) layers.push({ name: 'Panelobjekter', visible: false, print: false, lines: iwdieAiObjectLines(objects) });
        var doc = { width: size.w, height: size.h, title: name, layers: layers, artboardName: info.panel || 'Panel' };
        var header = iwdieAiHeaderLines(doc).join('\r\n') + '\r\n';
        var program = iwdieAiProgram(doc);
        // what other viewers see: the panel as the canvas shows it, drawing included
        return Promise.all([deflateBytes(program), exportPaint(info.bg && info.bg.bytes, info.bg && info.bg.mime, size, fill)]).then(function (r) {
          var jpeg = iwdieParseDataUrl(r[1].toDataURL('image/jpeg', 0.9));
          var pdf = iwdieAiPdf({
            width: size.w, height: size.h, meta: header, privateData: iwdieAiPrivateData(header, r[0]),
            preview: { width: size.w, height: size.h, filter: 'DCTDecode', data: jpeg.bytes }, title: name, version: IWDIE_VERSION
          });
          downloadBytes(pdf, name, 'application/pdf');
          var bits = ['Bakgrunn (' + (rgba ? 'the picture, locked' : 'no picture') + ')'];
          if (traceShapes.length) bits.push('Sporing (' + iwdieN(traceShapes.length, 'traced object', 'traced objects') + ', hidden)');
          bits.push('Tegning (' + (shapes.length ? iwdieN(shapes.length, 'shape', 'shapes') : 'empty, to draw on') + ')');
          if (objects.length) bits.push('Panelobjekter (' + objects.length + ', hidden)');
          hostOk('Illustrator document saved in ' + Math.max(1, Math.round((Date.now() - t0) / 100) / 10) + ' s → ' + name + ' (' + Math.round(pdf.length / 1024) + ' kB). Layers: ' +
            bits.join(', ') + '. Illustrator asks to update the text the first time - choose Update.');
        });
      }).then(null, function (e) {
        if (e && e.kind === 'cancelled') { toast('Export cancelled - nothing was saved.'); return; }
        toast('The Illustrator document could not be written: ' + ((e && e.message) || e), true, 10000);
      });
    }

    /* ---------- import modal ---------- */
    var importOverlay = null;

    function closeImportPanel() {
      if (importOverlay) { importOverlay.remove(); importOverlay = null; }
      document.removeEventListener('keydown', onPanelKeydown, true);
    }

    function onPanelKeydown(ev) {
      // A mid-import question owns Escape while it is open: the native
      // confirm() it replaces blocked the page, so Escape answered the
      // question and never reached this modal. (The replace-or-add chooser is
      // deliberately the other way round — see onModeChooserKeydown.)
      if (confirmOverlay) return;
      if (ev.key === 'Escape') { closeImportPanel(); ev.stopPropagation(); }
    }

    function openImportPanel() {
      closeImportPanel();
      importOverlay = document.createElement('div');
      importOverlay.className = 'iwdie-overlay';
      var panel = document.createElement('div');
      panel.className = 'iwdie-panel iwdie-import';
      panel.innerHTML = [
        '<button class="iwdie-x" id="iwdie_import_x" title="Close (Esc)">×</button>',
        '<h3>Insert panel JSON</h3>',
        '<div id="iwdie_source">',
        '<div class="iwdie-intro">Pick, drop or paste a panel file — exported, or written by an AI. It is checked and read back before anything touches the canvas, and nothing reaches the server until you press the designer’s own Save.</div>',
        '<div class="iwdie-drop" id="iwdie_drop" role="button" tabindex="0">📄 Drop the .json file here, or <span class="iwdie-pick">choose a file</span></div>',
        '<input type="file" id="iwdie_file" accept=".json,application/json" style="display:none">',
        '<div class="iwdie-or">…or paste the JSON text</div>',
        '<textarea id="iwdie_paste" spellcheck="false" placeholder="Paste the JSON here, then Check it (Ctrl+Enter) — or insert it straight away."></textarea>',
        '<div class="iwdie-actions">',
        '  <button class="iwdie-btn" id="iwdie_paste_btn" title="Check and read back the pasted JSON before it goes in (Ctrl+Enter)">Check</button>',
        '  <button class="iwdie-btn iwdie-quick" id="iwdie_quick_btn" title="Skip the check and insert the pasted JSON now. A file the designer cannot load is still stopped, and a panel that already holds objects still asks replace-or-add.">⚡ Insert without checking</button>',
        '  <button class="iwdie-link" id="iwdie_cancel_btn">Cancel</button>',
        '</div>',
        '<details class="iwdie-options" id="iwdie_options">',
        '  <summary>Background options</summary>',
        '  <div class="iwdie-opt" id="iwdie_bgonly_box">',
        '    <label for="iwdie_bgonly"><input type="checkbox" id="iwdie_bgonly"><span>Background picture only — insert no objects</span></label>',
        '    <div class="iwdie-hint">Takes nothing from the file but its background artwork: everything on the canvas stays where it is, and there is no replace-or-add question and no driver-id rebinding. Use it to slide re-drawn artwork in under an existing panel.</div>',
        '  </div>',
        '  <label for="iwdie_bgfile">Background image (PNG/JPG) — pick it before the .json</label>',
        '  <input type="file" id="iwdie_bgfile" accept="image/png,image/jpeg,image/gif">',
        '  <div class="iwdie-hint">Only needed when the file carries no background of its own; a picture picked here replaces the file’s.</div>',
        '</details>',
        '</div>',
        '<div id="iwdie_review" style="display:none"></div>'
      ].join('\n');
      importOverlay.appendChild(panel);
      document.body.appendChild(importOverlay);
      document.addEventListener('keydown', onPanelKeydown, true);

      importOverlay.addEventListener('mousedown', function (ev) { if (ev.target === importOverlay) closeImportPanel(); });
      panel.querySelector('#iwdie_import_x').addEventListener('click', closeImportPanel);
      panel.querySelector('#iwdie_cancel_btn').addEventListener('click', closeImportPanel);
      var bgOnlyBox = panel.querySelector('#iwdie_bgonly');
      bgOnlyBox.addEventListener('change', function () {
        panel.querySelector('#iwdie_bgonly_box').classList.toggle('iwdie-on', bgOnlyBox.checked);
      });
      var fileInput = panel.querySelector('#iwdie_file');
      fileInput.addEventListener('change', function (ev) {
        if (ev.target.files && ev.target.files[0]) readFileAndStage(ev.target.files[0]);
      });
      var drop = panel.querySelector('#iwdie_drop');
      var pick = function () { fileInput.value = ''; fileInput.click(); };
      drop.addEventListener('click', pick);
      drop.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
      });
      drop.addEventListener('dragover', function (ev) { ev.preventDefault(); drop.classList.add('iwdie-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('iwdie-over'); });
      drop.addEventListener('drop', function (ev) {
        ev.preventDefault(); drop.classList.remove('iwdie-over');
        if (ev.dataTransfer.files && ev.dataTransfer.files[0]) readFileAndStage(ev.dataTransfer.files[0]);
      });

      var paste = panel.querySelector('#iwdie_paste');
      var pastedText = function () {
        var txt = paste.value.trim();
        if (!txt) { toast('Paste the JSON first — or drop or choose a file.', true); paste.focus(); }
        return txt;
      };
      var check = function () {
        var txt = pastedText();
        if (txt) stageImportText(txt, 'pasted JSON');
      };
      panel.querySelector('#iwdie_paste_btn').addEventListener('click', check);
      paste.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); check(); }
      });
      // Insert without checking (v1.31.0): straight to the insert, no report.
      panel.querySelector('#iwdie_quick_btn').addEventListener('click', function () {
        var txt = pastedText();
        if (!txt) return;
        stagedText = txt; stagedName = 'pasted JSON';
        importFromText(txt, { quick: true });
      });
      try { paste.focus(); } catch (e) {}
    }

    /* ---------- the check before the canvas (v1.26.0, inside Insert since v1.27.0) ----------
       A picked, dropped or pasted file is checked and read back here, in the
       Insert dialog, and stays in memory; it reaches the canvas only when the
       user presses Insert now. The report copies as text for the AI that wrote
       the file, and a refused file gets the same fix-prompt the importer's own
       diagnosis produces. */
    var stagedText = '';
    var stagedName = '';

    function readFileAndStage(file) {
      var fr = new FileReader();
      fr.onload = function () { stageImportText(String(fr.result), file.name); };
      fr.onerror = function () { toast('Could not read the file.', true); };
      fr.readAsText(file);
    }

    function stageImportText(text, name) {
      stagedText = text; stagedName = name || 'the file';
      renderCheckReport(iwdieCheckFile(text, { plantId: currentPlantId() }));
    }

    /* The source form and the review take turns in the one dialog (v1.31.0):
       the report replaces the form instead of growing under it, so the verdict
       is the first thing in view and the buttons stay pinned at the bottom.
       "Choose another file" brings the form back with any pasted text intact. */
    function showReview(className, html) {
      var panel = importOverlay ? importOverlay.querySelector('.iwdie-panel') : null;
      var review = panel ? panel.querySelector('#iwdie_review') : null;
      if (!review) return null;
      panel.querySelector('#iwdie_source').style.display = 'none';
      review.className = className;
      review.innerHTML = html;
      review.style.display = '';
      panel.scrollTop = 0;
      var back = review.querySelector('#iwdie_back');
      if (back) back.addEventListener('click', showSource);
      return review;
    }

    function showSource() {
      var panel = importOverlay ? importOverlay.querySelector('.iwdie-panel') : null;
      if (!panel) return;
      var review = panel.querySelector('#iwdie_review');
      review.style.display = 'none';
      review.innerHTML = '';
      review.className = '';
      panel.querySelector('#iwdie_source').style.display = '';
      var fileInput = panel.querySelector('#iwdie_file');
      if (fileInput) fileInput.value = '';   // so the same file can be picked again
      panel.scrollTop = 0;
    }

    /** The picture picked under Background options, by name ('' if none). */
    function pickedBackgroundName() {
      var inp = importOverlay ? importOverlay.querySelector('#iwdie_bgfile') : null;
      var f = inp && inp.files && inp.files[0];
      return f ? f.name : '';
    }

    function renderCheckReport(result) {
      var report = iwdieCheckReportHtml(result, stagedName);
      var diag = result.diagnosis;
      var refused = result.verdict === 'refused';
      var ov = result.overview || {};
      var items = (ov.objects || 0) + (ov.containers || 0) + (ov.graphics || 0);
      // A file with artwork and nothing else can only mean "apply this
      // background", so the button offers that rather than Insert refusing it.
      var bgOnly = !refused && (bgOnlyRequested() || items === 0);
      var foot = [];
      if (!refused && bgOnly) {
        foot.push(items === 0 ? 'The file carries artwork only, so its background is all there is to apply — nothing on the canvas moves.'
          : '“Background picture only” is ticked — the file’s ' + iwdieCountPhrase(ov.objects, ov.containers, ov.graphics) + ' stay out.');
      }
      var picked = pickedBackgroundName();
      if (!refused && picked) foot.push('Background: your picture ' + picked + ', not the file’s.');
      var html = report.html +
        '<div class="iwdie-review-foot"><div class="iwdie-actions">' +
        (!refused ? '<button class="iwdie-btn" id="iwdie_insert_now">' +
          esc(bgOnly ? 'Apply the background only' : 'Insert ' + iwdieCountPhrase(ov.objects, ov.containers, ov.graphics)) + '</button>' : '') +
        (refused && diag && diag.aiPrompt ? '<button class="iwdie-btn" id="iwdie_copy_fix">📋 Copy the fix for the AI</button>' : '') +
        '<button class="iwdie-btn iwdie-secondary" id="iwdie_check_copy">📋 Copy report for the AI</button>' +
        '<button class="iwdie-link" id="iwdie_back">← Choose another file</button>' +
        '</div>' + (foot.length ? '<div class="iwdie-foot-note">' + foot.map(esc).join('<br>') + '</div>' : '') + '</div>';
      var review = showReview(report.className, html);
      if (!review) return;
      review.querySelector('#iwdie_check_copy').addEventListener('click', function () {
        copyToClipboard(iwdieCheckReportText(result, stagedName));
      });
      var fix = review.querySelector('#iwdie_copy_fix');
      if (fix) fix.addEventListener('click', function () { copyToClipboard(diag.aiPrompt); });
      var ins = review.querySelector('#iwdie_insert_now');
      if (ins) ins.addEventListener('click', function () { importFromText(stagedText, { bgOnly: bgOnly }); });
    }

    /** opts.quick (v1.31.0): Insert without checking — see applyImportCore.
     *  opts.bgOnly: the review found artwork only, or the box is ticked. */
    function importFromText(text, opts) {
      var parsed;
      try { parsed = JSON.parse(text); }
      catch (e) {
        var bad = iwdieDiagnoseBadJson(text, e.message);
        showErrors(bad.errors, null, bad.diagnosis);
        return;
      }
      applyImport(parsed, opts);
    }

    /** Clipboard for an http origin: navigator.clipboard is unavailable outside a
     *  secure context, so the hidden-textarea + execCommand path is the real one. */
    function copyToClipboard(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (!ok && typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied.'); },
          function () { toast('Could not copy — select the text and press Ctrl+C.', true); });
        return;
      }
      toast(ok ? 'Copied — paste it back to the AI.' : 'Could not copy — select the text and press Ctrl+C.', !ok);
    }

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    /** Insert stopped. Shown where the check report goes, in its colours and
     *  with its grouping, so the pasted text or the file is one click away for
     *  a fix. opts {title, sub}: see iwdieBlockedReportHtml. */
    function showErrors(errors, warnings, diagnosis, opts) {
      var report = iwdieBlockedReportHtml(errors, warnings, diagnosis, opts);
      var prompt = diagnosis && diagnosis.aiPrompt;
      var html = report.html +
        (prompt ? '<textarea class="iwdie-fixtext" id="iwdie_fix_text" readonly style="display:none">' + esc(prompt) + '</textarea>' : '') +
        '<div class="iwdie-review-foot"><div class="iwdie-actions">' +
        (prompt ? '<button class="iwdie-btn" id="iwdie_copy_fix">📋 Copy the fix for the AI</button>' +
          '<button class="iwdie-btn iwdie-secondary" id="iwdie_show_fix">Show it</button>' : '') +
        '<button class="iwdie-link" id="iwdie_back">← Back</button>' +
        '</div></div>';
      var review = showReview(report.className, html);
      if (!review) {
        toast('Insert stopped:\n• ' + errors.join('\n• '), true, 12000);
        return;
      }
      if (prompt) {
        review.querySelector('#iwdie_copy_fix').addEventListener('click', function () { copyToClipboard(prompt); });
        review.querySelector('#iwdie_show_fix').addEventListener('click', function () {
          var t = review.querySelector('#iwdie_fix_text');
          var shown = t.style.display !== 'none';
          t.style.display = shown ? 'none' : 'block';
          this.textContent = shown ? 'Show it' : 'Hide it';
        });
      }
    }

    /* ---------- replace-or-add chooser (v1.8.0) ---------- */
    var modeOverlay = null;

    function closeModeChooser() {
      if (modeOverlay) { modeOverlay.remove(); modeOverlay = null; }
      document.removeEventListener('keydown', onModeChooserKeydown, true);
    }

    /** Escape is deliberately not swallowed: the import modal's own handler
     *  runs too, so one press cancels the whole import rather than dropping
     *  the user back into a half-answered dialog. */
    function onModeChooserKeydown(ev) {
      if (ev.key === 'Escape') closeModeChooser();
    }

    /** The canvas already holds objects, so the import has two honest
     *  outcomes. Ask before anything is touched; cancelling changes nothing.
     *  `choose` is called with true for replace, false for add. */
    function openModeChooser(existing, choose) {
      closeModeChooser();
      var n = existing + ' object' + (existing === 1 ? '' : 's');
      modeOverlay = document.createElement('div');
      modeOverlay.className = 'iwdie-overlay';
      var panel = document.createElement('div');
      panel.className = 'iwdie-panel';
      panel.innerHTML = [
        '<button class="iwdie-x" id="iwdie_mode_x" title="Cancel (Esc)">×</button>',
        '<h3>This panel is not empty</h3>',
        '<div>The canvas already holds <b>' + n + '</b>. Choose what the import should do with them:</div>',
        '<div class="iwdie-choice">',
        '  <button class="iwdie-btn" id="iwdie_mode_replace">Replace — clear the panel first</button>',
        '  <div>Clears the ' + n + ' already on the canvas, then inserts the file, so you get <b>an exact copy of the export</b>. The background image only changes if the file carries one. The stored panel is untouched — reload without saving and the old content is back.</div>',
        '</div>',
        '<div class="iwdie-choice">',
        '  <button class="iwdie-btn" id="iwdie_mode_add">Add — keep what is here</button>',
        '  <div>Inserts the file <b>on top of</b> what is already there, for merging two panels. Importing the same file twice this way leaves every object duplicated.</div>',
        '</div>',
        '<div class="iwdie-hint">Esc or a click outside cancels. Either choice only changes the screen — the server copy is written by the designer’s own Save.</div>'
      ].join('\n');
      modeOverlay.appendChild(panel);
      document.body.appendChild(modeOverlay);
      document.addEventListener('keydown', onModeChooserKeydown, true);
      modeOverlay.addEventListener('mousedown', function (ev) {
        if (ev.target === modeOverlay) { closeModeChooser(); toast('Import cancelled — nothing was changed.'); }
      });
      panel.querySelector('#iwdie_mode_x').addEventListener('click', function () {
        closeModeChooser(); toast('Import cancelled — nothing was changed.');
      });
      panel.querySelector('#iwdie_mode_replace').addEventListener('click', function () { closeModeChooser(); choose(true); });
      panel.querySelector('#iwdie_mode_add').addEventListener('click', function () { closeModeChooser(); choose(false); });
    }

    /* ---------- mid-import question (v1.9.0) ----------
       Replaces the two window.confirm() calls. A native confirm renders as a
       browser-chrome strip with OK/Cancel, so the consequence of each answer
       had to be squeezed into one prose blob and the buttons said nothing.
       Here each answer is its own labelled button with its consequence
       underneath, in the same modal as the rest of the import. */
    var confirmOverlay = null;
    var confirmAnswer = null;

    function closeConfirmDialog() {
      if (confirmOverlay) { confirmOverlay.remove(); confirmOverlay = null; }
      confirmAnswer = null;
      document.removeEventListener('keydown', onConfirmKeydown, true);
    }

    /** Escape answers "no" and the import continues — exactly what Escape did
     *  to the native confirm this replaces. onPanelKeydown stands down while
     *  the question is open so one press cannot also close the import modal. */
    function onConfirmKeydown(ev) {
      if (ev.key !== 'Escape') return;
      var answer = confirmAnswer;
      closeConfirmDialog();
      ev.stopPropagation();
      if (answer) answer(false);
    }

    /** A two-outcome question asked mid-import. Both outcomes continue the
     *  import — neither is a cancel, which is why there is no × here.
     *  `answer` is called with true for the primary option, false for the
     *  secondary one.
     *
     *  opts: { title, intro, facts[], yes:{label,desc}, no:{label,desc} } */
    function openConfirmDialog(opts, answer) {
      closeConfirmDialog();
      confirmAnswer = answer;
      confirmOverlay = document.createElement('div');
      confirmOverlay.className = 'iwdie-overlay';
      var panel = document.createElement('div');
      panel.className = 'iwdie-panel';
      panel.innerHTML = [
        '<h3>' + opts.title + '</h3>',
        '<div>' + opts.intro + '</div>',
        (opts.facts && opts.facts.length
          ? '<div class="iwdie-facts">' + opts.facts.map(function (f) { return '<div>' + f + '</div>'; }).join('') + '</div>'
          : ''),
        '<div class="iwdie-choice">',
        '  <button class="iwdie-btn" id="iwdie_confirm_yes">' + opts.yes.label + '</button>',
        '  <div>' + opts.yes.desc + '</div>',
        '</div>',
        '<div class="iwdie-choice">',
        '  <button class="iwdie-btn iwdie-secondary" id="iwdie_confirm_no">' + opts.no.label + '</button>',
        '  <div>' + opts.no.desc + '</div>',
        '</div>',
        '<div class="iwdie-hint">' + (opts.hint || ('Esc or a click outside chooses “' + opts.no.label + '”. Either way the import continues, and nothing reaches the server until you press the designer’s own Save.')) + '</div>'
      ].join('\n');
      confirmOverlay.appendChild(panel);
      overlayParent().appendChild(confirmOverlay);
      document.addEventListener('keydown', onConfirmKeydown, true);

      function pick(yes) { closeConfirmDialog(); answer(yes); }
      confirmOverlay.addEventListener('mousedown', function (ev) { if (ev.target === confirmOverlay) pick(false); });
      panel.querySelector('#iwdie_confirm_yes').addEventListener('click', function () { pick(true); });
      panel.querySelector('#iwdie_confirm_no').addEventListener('click', function () { pick(false); });
      try { panel.querySelector('#iwdie_confirm_yes').focus(); } catch (e) {}
    }

    /* ---------- apply (replace or add) ---------- */
    /** Canvas children, for the insert bookkeeping. Counts every child of
     *  #control_container except the hidden landing field the host re-appends
     *  — deliberately not keyed on name="object_N", because containers and
     *  tables carry other names. */
    function canvasObjectCount() {
      var cc = document.getElementById('control_container');
      if (!cc) return 0;
      var n = 0;
      for (var i = 0; i < cc.children.length; i++) {
        if (cc.children[i].id === 'objects_landing_field') continue;
        n++;
      }
      return n;
    }

    /** Does the panel already hold something? Export answers this with the
     *  host's own serializer, so the replace-or-add question asks the same way:
     *  a DOM scan and getPanelDataFromDOM() disagree on container, table and
     *  graphics panels, and when the scan undercounts, the canvas reads as
     *  empty and the import adds on top of a full panel without asking.
     *
     *  Taken only where the host is at rest: before anything has been touched
     *  (applyImportCore), and once the loaders have finished (the insert's
     *  outcome, v1.31.0) — never between the clear and the host loaders, whose
     *  scratch buffers this resets the way the host's own save path does
     *  (container_tool.js). Returns null when the serializer fails. */
    function canvasCountStrict() {
      try {
        W.obj_data = []; W.container_data = []; W.container_items = [];
        var imgName = '';
        try { imgName = W.$('#main_image').attr('main_image') || ''; } catch (e) {}
        var doc = W.getPanelDataFromDOM(currentPlantId(), currentPanelName(), imgName, W.get_user_name());
        if (!doc) return null;
        return (doc.single_objects || []).length +
          (doc.containers || []).length +
          (doc.graphics || []).length;
      } catch (e) {
        return null;
      }
    }

    /** The replace-or-add count. A failure falls back to the DOM count rather
     *  than blocking the import. */
    function canvasContentCount() {
      if (typeof W.getPanelDataFromDOM !== 'function') return canvasObjectCount();
      var n = canvasCountStrict();
      return n === null ? canvasObjectCount() : n;
    }

    /** The count an insert's outcome is judged by — null when it cannot be
     *  taken, never a guess, or green would mean nothing. The host loaders are
     *  synchronous, so a shortfall is almost always real; one re-count 600 ms
     *  later still rules out a late render before the toast calls anything
     *  missing. */
    function countAfterInsert(expected, cb) {
      var found = canvasCountStrict();
      if (found !== null && found >= expected) { cb(found); return; }
      setTimeout(function () {
        var again = canvasCountStrict();
        cb(again === null ? found : (found === null ? again : Math.max(found, again)));
      }, 600);
    }

    /** After appending, renumber name="object_N" sequentially so no two canvas
     *  children share a name (the host's own paste machinery does the same —
     *  Duplicator.constructItems renames from the live child index). */
    function renumberCanvasNames() {
      var cc = document.getElementById('control_container');
      if (!cc) return;
      var idx = 0;
      for (var i = 0; i < cc.children.length; i++) {
        var el = cc.children[i];
        var nm = el.getAttribute('name') || '';
        if (/^object_\d+$/.test(nm)) el.setAttribute('name', 'object_' + (idx++));
      }
    }

    /** Replace mode: empty the canvas the way the host's own full-panel load
     *  does (DesignPanelHandler.renderPanel — the two caches first, then
     *  #control_container). The hidden landing field is kept, because only
     *  iw_set_image_org re-appends it. The graphics registry is reset for the
     *  same reason loadedGraphic.loader resets it: graphics replace, never
     *  merge. This touches the DOM only — the stored panel is unchanged until
     *  the user presses the designer's own Save. */
    function clearCanvasForReplace(knownCount) {
      var removed = (typeof knownCount === 'number' && knownCount > 0) ? knownCount : canvasObjectCount();
      try { W.objectList.clear(); } catch (e) {}
      try { W.designContainers.clear(); } catch (e) {}
      try { W.table_container.clear(); } catch (e) {}
      var cc = document.getElementById('control_container');
      if (cc) {
        var landing = document.getElementById('objects_landing_field');
        if (landing && !cc.contains(landing)) landing = null;
        try { W.$(cc).html(''); } catch (e) { cc.innerHTML = ''; }
        if (landing) cc.appendChild(landing);
      }
      try { if (W.loadedGraphic) W.loadedGraphic.loaded = []; } catch (e) {}
      return removed;
    }

    /** Read the optional background image picked in the modal (null if none). */
    function readPendingBackground(cb) {
      var inp = importOverlay ? importOverlay.querySelector('#iwdie_bgfile') : null;
      var f = inp && inp.files && inp.files[0];
      if (!f) { cb(null); return; }
      var fr = new FileReader();
      fr.onload = function () { cb({ dataUrl: String(fr.result), name: f.name }); };
      fr.onerror = function () { toast('Could not read the background image — inserting without it.', true); cb(null); };
      fr.readAsDataURL(f);
    }

    /** Is the background-only switch armed? Read at import time, not at open
     *  time, so ticking it after picking the file still counts. */
    function bgOnlyRequested() {
      var box = importOverlay ? importOverlay.querySelector('#iwdie_bgonly') : null;
      return !!(box && box.checked);
    }

    function applyImport(parsed, opts) {
      opts = opts || {};
      var bgOnly = !!opts.bgOnly || bgOnlyRequested();
      var quick = !!opts.quick;
      readPendingBackground(function (bg) { applyImportCore(parsed, bg, bgOnly, quick); });
    }

    function applyImportCore(parsed, pendingBg, bgOnly, quick) {
      var res = iwdieParsePayload(parsed);
      if (res.errors) { showErrors(res.errors, null, res.diagnosis); return; }
      // A background-only import never reads the object arrays, so a file that
      // carries artwork and nothing else is valid input here.
      var v = iwdieValidateDoc(res.doc, { allowEmpty: bgOnly });
      v.notes = [];
      v.details = {};
      v.quick = quick;
      // Insert without checking (v1.31.0) skips the checks proper — the envelope
      // counts and the layout — but never the structural test above: the host
      // loaders cannot take a document that fails it.
      if (!quick) {
        v.warnings = v.warnings.concat(iwdieCheckEnvelopeCounts(res.meta, res.doc));
        v.warnings = v.warnings.concat(iwdieCheckPanelGeometry(res.doc, v.notes, v.details));
      }
      if (v.errors.length) {
        // A file with artwork and no objects is not a broken export — it is a
        // background-only patch, and the switch above is what it is for. Say so
        // rather than making the user work out why an intact file was refused.
        var errors = v.errors.slice();
        if (!bgOnly && errors.length === 1 && /document is empty/.test(errors[0]) &&
            (pendingBg || iwdieDocHasBackground(res.doc))) {
          errors.push('It does carry a background image, though — open Background options in this dialog and tick “Background picture only” to apply just the artwork.');
        }
        showErrors(errors, v.warnings, iwdieDiagnoseDoc(res.doc, v.errors, v.warnings));
        return;
      }
      if (!hostReady()) { showErrors(['IWMAC Designer host functions are not available (page not fully loaded?).']); return; }

      // Validation passed and nothing has been touched yet — this is the point
      // to ask replace-or-add. An empty canvas has nothing to replace, so it
      // skips straight through, and so does a background-only import: it adds
      // no objects, so there is nothing for the existing ones to collide with.
      var existing = bgOnly ? 0 : canvasContentCount();
      if (existing > 0) {
        openModeChooser(existing, function (replace) { applyImportDoc(res.doc, v, pendingBg, replace, existing, false); });
        return;
      }
      applyImportDoc(res.doc, v, pendingBg, false, 0, bgOnly);
    }

    function applyImportDoc(rawDoc, v, pendingBg, replace, existing, bgOnly) {
      var doc = iwdieNormalizeDoc(rawDoc);
      // AI-authored artwork: panel.image_svg (raw SVG text) -> embedded background.
      // A file picked in the modal takes precedence over the JSON's SVG.
      if (!pendingBg && doc.image_svg) {
        var svgErrors = iwdieValidateSvg(doc.image_svg);
        if (svgErrors.length) { showErrors(svgErrors, v.warnings); return; }
        var svgUrl = iwdieSvgToDataUrl(doc.image_svg);
        if (svgUrl) { doc = iwdieAttachBackground(doc, svgUrl, doc.org_image_name || 'ai-background.svg'); }
      }
      delete doc.image_svg;
      // image_svg_trace is AI-reading material written by Export (the vector
      // trace of the raster background) — never rendered; the embedded
      // image_data stays the real background.
      delete doc.image_svg_trace;
      if (pendingBg) { doc = iwdieAttachBackground(doc, pendingBg.dataUrl, pendingBg.name); }

      // Background-only import (v1.10.0): the artwork is the whole payload.
      // Every question below this point exists because objects are about to
      // land on the canvas — replace-or-add, driver-id rebinding, and "this
      // panel already has a background" (answering that one is the whole point
      // of ticking the box). None of them apply, so the artwork goes straight
      // on and the canvas keeps everything it already holds. iw_set_base_image
      // only swaps the background — the object-clearing in the host's own load
      // path lives in renderPanel, not here — which is the same reason Add mode
      // can already apply a background over a populated canvas.
      var bgError = '';
      if (bgOnly) {
        if (!iwdieDocHasBackground(doc)) {
          showErrors([
            'This file carries no background image, so “Background picture only” has nothing to apply.',
            'Either the panel it was exported from had no artwork, or the file carries objects only. Pick a PNG/JPG under Background options to use as the background, or untick the box to insert the file’s objects instead.'
          ], v.warnings);
          return;
        }
        if (!applyBackground()) {
          showErrors(['The designer would not take the background: ' + bgError]);
          return;
        }
        closeImportPanel();
        outcomeToast({
          tone: 'good',
          title: '✅ Background applied',
          lines: [
            (doc.org_image_name ? doc.org_image_name + ' is the panel’s background now.' : 'The file’s artwork is the panel’s background now.'),
            'No objects were inserted, and nothing already on the canvas moved.'
          ],
          footer: 'Nothing is saved yet — use the designer’s own Save when you are happy.'
        });
        return;
      }

      var target = currentPlantId();
      var source = iwdieDetectSourcePlant(doc);
      var rebindNote = '';

      // The two questions below are modals now, so the rest of the import is
      // their continuation rather than the next statement. Order is unchanged:
      // rebind, then background, then the canvas itself.
      var n = (source && target && source !== target) ? iwdieCountRebindable(doc, source) : 0;
      if (n > 0) {
        openConfirmDialog({
          title: 'This panel comes from another plant',
          intro: 'Its objects are bound to driver ids from the plant it was exported from. They will not link to anything here until those ids are rewritten.',
          facts: [
            'Exported from plant <code>' + esc(source) + '</code><span class="iwdie-arrow">→</span>you are on plant <code>' + esc(target) + '</code>',
            '<b>' + n + '</b> driver id' + (n === 1 ? '' : 's') + ' can be rewritten'
          ],
          yes: {
            label: 'Rewrite the driver ids',
            desc: 'Rewrites <code>' + esc(source) + '_…</code> to <code>' + esc(target) + '_…</code> so the objects link to this plant’s drivers. Ids that name no driver here are left alone and listed afterwards.'
          },
          no: {
            label: 'Keep the original ids',
            desc: 'The objects come in exactly as exported — useful when you are only after the layout. Nothing will show live values until the ids are fixed.'
          }
        }, function (rewrite) {
          if (rewrite) {
            var rb = iwdieRebindDriverIds(doc, source, target);
            doc = rb.doc;
            rebindNote = iwdieN(rb.rebound, 'driver id', 'driver ids') + ' rewritten from plant ' + source + ' to ' + target;
          }
          askBackground();
        });
      } else {
        askBackground();
      }

      // background: only touch it if the import carries one. finish() is told
      // what became of it — none, applied, failed, or kept by the user's choice.
      function askBackground() {
        if (doc.converted !== 'true' || !doc.image_data) { finish('none'); return; }
        var hasBg = false;
        try { hasBg = (W.$('#main_image').css('background-image') || 'none') !== 'none'; } catch (e) {}
        // Replace mode already means "make this panel look like the export",
        // so the background follows without a second question.
        if (!hasBg || replace) { finish(applyBackground() ? 'applied' : 'failed'); return; }
        openConfirmDialog({
          title: 'The file carries its own background image',
          intro: 'This panel already has a background. The imported objects are positioned against the background the file was exported on, so keeping yours can leave them sitting over the wrong drawing.',
          yes: {
            label: 'Use the file’s background',
            desc: 'Swaps this panel’s background for the embedded one, so the objects land where they were drawn.'
          },
          no: {
            label: 'Keep the current background',
            desc: 'Your background stays and the objects are inserted on top of it.'
          }
        }, function (useFileBg) {
          finish(useFileBg ? (applyBackground() ? 'applied' : 'failed') : 'kept');
        });
      }

      function applyBackground() {
        try {
          W.iw_set_base_image(doc.panel_width, doc.panel_height, doc.image_data);
          if (doc.org_image_name) { W.$('#main_image').attr('org_image_name', doc.org_image_name); }
          return true;
        } catch (e) { bgError = String((e && e.message) || e); return false; }
      }

      function finish(bgStatus) {
        var foreign = iwdieListForeignDriverIds(doc, target);

        // Every question has been answered by now, so clearing here is the last
        // point at which nothing has been changed yet.
        var cleared = replace ? clearCanvasForReplace(existing) : 0;

        // append via the host's own loaders (the templates insert path)
        try {
          var handler = new W.DesignPanelHandler();
          if (doc.single_objects.length) handler.load_new_ver_objects(doc.single_objects);
          if (doc.containers.length) handler.load_new_ver_containers(doc.containers);
        } catch (e) {
          showErrors(['The designer refused the objects: ' + e], null, null, {
            title: '⛔ The designer stopped the insert',
            sub: replace ? 'The panel was cleared first — reload the page without saving to get it back.'
              : 'Anything it took before it stopped stays on the canvas — reload the page without saving to undo it.'
          });
          return;
        }
        renumberCanvasNames();

        var skippedGraphics = 0, graphicsReason = '';
        if (doc.graphics.length) {
          var canvasHasGraphics = false;
          try { canvasHasGraphics = Object.keys(W.loadedGraphic.loaded || {}).length > 0; } catch (e) {}
          if (canvasHasGraphics) {
            skippedGraphics = doc.graphics.length; graphicsReason = 'present';
          } else if (W.loadedGraphic && typeof W.loadedGraphic.loader === 'function') {
            try { W.loadedGraphic.loader(doc.graphics); } catch (e) { skippedGraphics = doc.graphics.length; graphicsReason = 'failed'; }
          } else {
            skippedGraphics = doc.graphics.length; graphicsReason = 'failed';
          }
        }

        try { W.UpdateObjectWorker(); } catch (e) {}
        try { if (!document.getElementById('mouse_selector') && typeof W.make_mouse_selector === 'function') W.make_mouse_selector(); } catch (e) {}

        closeImportPanel();

        // Green is earned, not assumed (v1.31.0): the canvas is counted the way
        // Export and the replace-or-add question count it, and compared with
        // what was handed to the designer.
        var loadedGraphics = doc.graphics.length - skippedGraphics;
        var inserted = doc.single_objects.length + doc.containers.length + loadedGraphics;
        var expected = (replace ? 0 : existing) + inserted;
        countAfterInsert(expected, function (found) {
          outcomeToast(iwdieInsertOutcome({
            summary: iwdieCountPhrase(doc.single_objects.length, doc.containers.length, loadedGraphics),
            inserted: inserted, expected: expected, found: found, countFailed: found === null,
            cleared: cleared, rebound: rebindNote, background: bgStatus, backgroundError: bgError,
            graphicsSkipped: skippedGraphics, graphicsReason: graphicsReason, foreign: foreign.length,
            warnings: (v && v.warnings) || [], notes: (v && v.notes) || [], details: (v && v.details) || {},
            quick: !!(v && v.quick)
          }));
        });
      }
    }

    /* ---------- Excel (.xlsx) writer ----------------------------------------
       Mirrors supermarket-superuser's export block byte-for-byte where
       possible (store-only ZIP + CRC32 + minimal SpreadsheetML, COM-verified
       against real Excel there) — keep the two copies in sync when editing.
       No libraries, no GM APIs: a real .xlsx that opens cleanly on any
       locale, in proper columns, without CSV separator/encoding pitfalls. */
    var XLSX_CRC_TABLE = (function () {
      var table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
      }
      return table;
    })();

    function xlsxCrc32(bytes) {
      var crc = 0xFFFFFFFF;
      for (var i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ XLSX_CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function xlsxZip(files) {
      var encoder = new TextEncoder();
      var localParts = [];
      var centralParts = [];
      var offset = 0;
      files.forEach(function (file) {
        var nameBytes = encoder.encode(file.name);
        var data = file.data;
        var crc = xlsxCrc32(data);
        var local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);   // UTF-8 filename flag
        local.setUint16(8, 0, true);        // store (no compression)
        local.setUint16(10, 0, true);       // mod time
        local.setUint16(12, 0x21, true);    // mod date (1980-01-01)
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);
        localParts.push(new Uint8Array(local.buffer), nameBytes, data);

        var central = new DataView(new ArrayBuffer(46));
        central.setUint32(0, 0x02014b50, true);
        central.setUint16(4, 20, true);
        central.setUint16(6, 20, true);
        central.setUint16(8, 0x0800, true);
        central.setUint16(10, 0, true);
        central.setUint16(12, 0, true);
        central.setUint16(14, 0x21, true);
        central.setUint32(16, crc, true);
        central.setUint32(20, data.length, true);
        central.setUint32(24, data.length, true);
        central.setUint16(28, nameBytes.length, true);
        central.setUint32(42, offset, true);
        centralParts.push(new Uint8Array(central.buffer), nameBytes);

        offset += 30 + nameBytes.length + data.length;
      });

      var centralSize = centralParts.reduce(function (sum, part) { return sum + part.length; }, 0);
      var end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, files.length, true);
      end.setUint16(10, files.length, true);
      end.setUint32(12, centralSize, true);
      end.setUint32(16, offset, true);

      return new Blob(localParts.concat(centralParts, [new Uint8Array(end.buffer)]), {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    }

    function xlsxColumnRef(index) {
      var ref = '';
      var n = index;
      do {
        ref = String.fromCharCode(65 + (n % 26)) + ref;
        n = Math.floor(n / 26) - 1;
      } while (n >= 0);
      return ref;
    }

    function xlsxEscape(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function xlsxStylesXml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF0D47A1"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1976D2"/><bgColor rgb="FF1976D2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F2FD"/><bgColor rgb="FFE3F2FD"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF455A64"/><bgColor rgb="FF455A64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    }

    function xlsxCell(ref, value, style) {
      var text = value == null ? '' : String(value);
      var styleAttr = style ? ' s="' + style + '"' : '';
      // Numeric-looking values become real numbers so Excel can sum/sort them;
      // everything else (OFF, On, alarm texts, ...) stays an inline string.
      if (text !== '' && /^-?\d+(?:\.\d+)?$/.test(text)) {
        return '<c r="' + ref + '"' + styleAttr + '><v>' + text + '</v></c>';
      }
      return '<c r="' + ref + '"' + styleAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xlsxEscape(text) + '</t></is></c>';
    }

    /* rows: [{ cells: [...], style?: cellXfs index, outline?: 1 }, ...].
       Row 1 is frozen, the whole range gets an AutoFilter (sort/filter
       dropdowns), and outline:1 rows collapse under the row above them
       (outlinePr summaryBelow=0 puts the +/- button on the group row). */
    function xlsxSheetXml(modelRows, colWidths) {
      var widths = colWidths || IWDIE_PARAM_EXPORT_COL_WIDTHS;
      var colCount = modelRows.reduce(function (max, row) { return Math.max(max, row.cells.length); }, 1);
      var maxOutline = Math.max(modelRows.reduce(function (max, row) { return Math.max(max, row.outline || 0); }, 0), 1);
      var lastCell = xlsxColumnRef(colCount - 1) + Math.max(modelRows.length, 1);
      var body = modelRows.map(function (row, rowIndex) {
        var cellsXml = row.cells.map(function (value, colIndex) {
          return xlsxCell(xlsxColumnRef(colIndex) + (rowIndex + 1), value, row.style || XLSX_STYLE_DEFAULT);
        }).join('');
        var outline = row.outline ? ' outlineLevel="' + row.outline + '"' : '';
        return '<row r="' + (rowIndex + 1) + '"' + outline + '>' + cellsXml + '</row>';
      }).join('');
      var colsXml = widths.slice(0, colCount).map(function (width, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>';
      }).join('');
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="0"/></sheetPr><dimension ref="A1:' + lastCell + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" outlineLevelRow="' + maxOutline + '"/><cols>' + colsXml + '</cols><sheetData>' + body + '</sheetData><autoFilter ref="A1:' + lastCell + '"/></worksheet>';
    }

    function buildXlsxBlob(sheets) {
      var encoder = new TextEncoder();
      var safeSheets = sheets.map(function (sheet, index) {
        return {
          name: (sheet.name || 'Sheet' + (index + 1)).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || ('Sheet' + (index + 1)),
          rows: sheet.rows,
          colWidths: sheet.colWidths
        };
      });
      var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + safeSheets.map(function (unused, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>';
      var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
      var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + safeSheets.map(function (sheet, i) { return '<sheet name="' + xlsxEscape(sheet.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>';
      var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + safeSheets.map(function (unused, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

      var files = [
        { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
        { name: '_rels/.rels', data: encoder.encode(rootRels) },
        { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
        { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
        { name: 'xl/styles.xml', data: encoder.encode(xlsxStylesXml()) }
      ];
      safeSheets.forEach(function (sheet, i) {
        files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: encoder.encode(xlsxSheetXml(sheet.rows, sheet.colWidths)) });
      });
      return xlsxZip(files);
    }

    function triggerXlsxDownload(blob, filename) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    /* ---------- parameter-selector export button ---------- */
    function doExportParams() {
      var w2 = W.w2ui;
      var ug = w2 && w2.unitgrid;
      var pg = w2 && w2.paramgrid;
      if (!ug || !pg) { toast('Parameter selector is not ready.', true); return; }
      var sel = (typeof ug.getSelection === 'function') ? ug.getSelection() : [];
      if (!sel || !sel.length) { toast('Select a regulator in the UNITS list first (tick several with the checkboxes).', true); return; }
      if (sel.length > 1) { exportSelectedUnits(sel.slice()); return; }
      var unit = ug.get(sel[0]);
      if (!unit) { toast('Select a regulator in the UNITS list first (tick several with the checkboxes).', true); return; }
      var records = pg.records || [];
      if (!records.length) { toast('No parameters loaded for this regulator.', true); return; }
      var unitLabel = String(unit.unit_name || unit.unit_id || 'unit');
      var unitIdValue = String(unit.unit_id == null ? '' : unit.unit_id);
      var unitNameValue = String(unit.unit_name == null ? '' : unit.unit_name);
      var plant = '';
      try { plant = String(W.get_plant_id() || ''); } catch (e) { }
      if (!plant) {
        var m = /[?&]plant_id=(\d+)/.exec(location.search);
        plant = m ? m[1] : 'plant';
      }
      var name = iwdieBuildParamExportFilename(plant, unitLabel, new Date());
      var blob = buildXlsxBlob([{ name: 'Parameters', rows: iwdieBuildParamExportRows(records, unitIdValue, unitNameValue) }]);
      triggerXlsxDownload(blob, name);
      W.__IWDIE.lastExport = { name: name, units: 1, params: records.length, failed: 0 };
      toast('Exported ' + records.length + ' parameters for ' + unitLabel + ' -> ' + name, false, 8000);
    }

    /* Ctrl+click multi-selection → EXPORT XLSX walks exactly those units, in
       grid order (stable workbook regardless of click order), and restores
       the full selection afterwards. No confirm dialog: an explicit
       multi-selection is the confirmation. */
    function exportSelectedUnits(selArray) {
      var ug = W.w2ui.unitgrid;
      var selSet = {};
      selArray.forEach(function (r) { selSet[r] = true; });
      var recids = (ug.records || []).map(function (r) { return r.recid; })
        .filter(function (r) { return selSet[r]; });
      var progress = openExportProgress(recids.length,
        'Exporting ' + recids.length + ' selected units to Excel');
      collectUnitBlocks({
        recids: recids,
        restore: function () { restoreUnitSelection(selArray); },
        onProgress: progress.update,
        shouldStop: progress.cancelled,
        done: function (blocks, failed, wasCancelled) {
          progress.close();
          if (wasCancelled) {
            toast('Export cancelled after ' + blocks.length + ' unit(s) - nothing downloaded, selection restored.');
            return;
          }
          var nonEmpty = blocks.filter(function (b) { return b.records.length; });
          var empty = blocks.length - nonEmpty.length;
          if (!nonEmpty.length) { toast('No parameters found on the selected units - nothing to export.', true); return; }
          var rows = iwdieBuildAllUnitsExportRows(nonEmpty);
          var total = nonEmpty.reduce(function (sum, b) { return sum + b.records.length; }, 0);
          var name = iwdieBuildParamExportFilename(currentPlantIdForExport(), nonEmpty.length + '-units', new Date());
          var blob = buildXlsxBlob([{ name: 'Units', rows: rows, colWidths: IWDIE_ALLUNITS_COL_WIDTHS }]);
          triggerXlsxDownload(blob, name);
          W.__IWDIE.lastExport = { name: name, units: nonEmpty.length, params: total, failed: failed, empty: empty };
          toast('Exported ' + total + ' parameters across ' + nonEmpty.length + ' selected units -> ' + name +
            (failed ? ' (' + failed + ' unit(s) failed to load)' : '') +
            (empty ? ' (' + empty + ' empty unit(s) skipped)' : ''), false, 8000);
        }
      });
    }

    function currentPlantIdForExport() {
      var plant = '';
      try { plant = String(W.get_plant_id() || ''); } catch (e) { }
      if (!plant) {
        var m = /[?&]plant_id=(\d+)/.exec(location.search);
        plant = m ? m[1] : 'plant';
      }
      return plant;
    }

    /* Walk every unit through the host's own click-loader (unitsClickHandler
       sync-fetches iw_load_plant.php and fills paramgrid), snapshot the grid
       after each load, then put the user's original selection back. Using the
       host's loader instead of refetching keeps this immune to the response
       format — whatever fills the grid is what gets exported. One unit per
       tick: the XHR is synchronous, so the gap is what lets the progress toast
       repaint and spares the plant server a burst. */
    /* Put the units grid back the way the user left it. One selected unit is
       re-CLICKED (reloads its paramgrid, exactly the pre-export view); a
       multi-selection is re-selected without clicks — w2ui select() does not
       trigger the host loader, so the paramgrid keeps the last walked unit,
       which is one of the selected ones. */
    function restoreUnitSelection(selArray) {
      var w2 = W.w2ui;
      var ug = w2.unitgrid;
      var pg = w2.paramgrid;
      try {
        if (!selArray || !selArray.length) { ug.selectNone(); pg.clear(); return; }
        if (selArray.length === 1) { ug.click(selArray[0]); return; }
        ug.selectNone();
        ug.select.apply(ug, selArray);
      } catch (e) { }
    }

    /* opts: { recids, restore, onProgress, shouldStop, done } — walks exactly
       the given unit recids through the host's click-loader. */
    function collectUnitBlocks(opts) {
      var w2 = W.w2ui;
      var ug = w2.unitgrid;
      var pg = w2.paramgrid;
      var recids = opts.recids;
      var onProgress = opts.onProgress;
      var shouldStop = opts.shouldStop;
      var done = opts.done;
      var blocks = [];
      var failed = 0;
      var i = 0;
      /* Some units fill paramgrid asynchronously after click(): a fast walk
         then snapshots the PREVIOUS unit's rows, or an empty grid, and loses
         parameters silently (measured live: 3 of 25 units, 621 parameters).
         driver_ids embed the unit address, so length + first/last driver_id
         change on every real reload — wait for that change, up to 1.5 s, then
         snapshot. A truly empty unit never changes and pays the full grace. */
      function fingerprint() {
        var r = pg.records || [];
        if (!r.length) return '0|';
        return r.length + '|' + (r[0].driver_id || r[0].recid) + '|' + (r[r.length - 1].driver_id || r[r.length - 1].recid);
      }
      function advance(rec) {
        i++;
        onProgress(i, recids.length, rec, blocks);
        setTimeout(step, 60);
      }
      function step() {
        if (i >= recids.length || shouldStop()) {
          opts.restore();
          done(blocks, failed, i < recids.length);
          return;
        }
        var rec = null;
        var before = fingerprint();
        var started = Date.now();
        try {
          rec = ug.get(recids[i]);
          ug.click(recids[i]);
        } catch (e) {
          failed++;
          advance(rec);
          return;
        }
        (function settle() {
          if (fingerprint() === before && Date.now() - started < 1500) {
            setTimeout(settle, 100);
            return;
          }
          blocks.push({
            unitLabel: String((rec && (rec.unit_name || rec.unit_id)) || recids[i]),
            unitId: String((rec && rec.unit_id != null) ? rec.unit_id : ''),
            unitName: String((rec && rec.unit_name != null) ? rec.unit_name : ''),
            records: (pg.records || []).map(function (r) { return Object.assign({}, r); })
          });
          advance(rec);
        })();
      }
      step();
    }

    /* Big, centered, impossible to miss — the walk freezes the page for the
       length of each unit's synchronous load, so a subtle toast reads as
       "nothing is happening". Returns {update, close, cancelled()}. */
    function openExportProgress(total, title) {
      var overlay = document.createElement('div');
      overlay.className = 'iwdie-overlay';
      var panel = document.createElement('div');
      panel.className = 'iwdie-panel iwdie-progress-panel';
      panel.innerHTML = [
        '<h3>' + (title || 'Exporting units to Excel') + '</h3>',
        '<div class="iwdie-progress-line" id="iwdie_prog_line">Starting...</div>',
        '<div class="iwdie-progress-track"><div class="iwdie-progress-fill" id="iwdie_prog_fill"></div></div>',
        '<div class="iwdie-progress-sub" id="iwdie_prog_sub">0 parameters collected</div>',
        '<div class="iwdie-progress-note">Keep this tab in the foreground - Chrome slows the walk to a crawl in a background tab.</div>',
        '<button class="iwdie-btn iwdie-secondary" id="iwdie_prog_cancel" style="margin-top:12px">Cancel</button>'
      ].join('\n');
      overlay.appendChild(panel);
      overlayParent().appendChild(overlay);
      var cancelled = false;
      var line = panel.querySelector('#iwdie_prog_line');
      var fill = panel.querySelector('#iwdie_prog_fill');
      var sub = panel.querySelector('#iwdie_prog_sub');
      var btn = panel.querySelector('#iwdie_prog_cancel');
      btn.addEventListener('click', function () {
        cancelled = true;
        btn.disabled = true;
        line.textContent = 'Cancelling after this unit...';
      });
      return {
        update: function (i, totalUnits, rec, blocks) {
          if (cancelled) return;
          line.textContent = 'Unit ' + i + ' of ' + totalUnits +
            (rec && rec.unit_name ? ': ' + rec.unit_name : '');
          fill.style.width = Math.round(100 * i / Math.max(totalUnits, 1)) + '%';
          var params = 0;
          for (var b = 0; b < blocks.length; b++) params += blocks[b].records.length;
          sub.textContent = params + ' parameters collected';
        },
        close: function () { overlay.remove(); },
        cancelled: function () { return cancelled; }
      };
    }

    function doExportAllParams() {
      var w2 = W.w2ui;
      var ug = w2 && w2.unitgrid;
      var pg = w2 && w2.paramgrid;
      if (!ug || !pg) { toast('Parameter selector is not ready.', true); return; }
      var unitCount = (ug.records || []).length;
      if (!unitCount) { toast('No units loaded in the UNITS list.', true); return; }
      // Captured before the confirm dialog, not at walk start: the selection
      // the user expects back is the one from the moment they clicked export.
      var selNow = ((typeof ug.getSelection === 'function') ? ug.getSelection() : []).slice();
      openConfirmDialog({
        /* ASCII-only strings here: the legacy page is not served as UTF-8, so
           anything non-ASCII mojibakes when the script is loaded via a plain
           script tag (the test-injection path). Tampermonkey decodes the file
           itself, but ASCII keeps both paths clean. */
        title: 'Export all units to Excel',
        intro: 'Load the parameter list of every unit in turn and download the whole plant as one workbook.',
        facts: [
          '<b>' + unitCount + '</b> units in the list',
          'Each unit is loaded into the grid exactly as if clicked, then your current selection is put back',
          'Roughly a second per unit; the loads run one at a time on purpose'
        ],
        yes: { label: 'Export all units', desc: 'Walk the list, then download parameters_&lt;plant&gt;_all-units_&hellip;.xlsx.' },
        no: { label: 'Cancel', desc: 'Do nothing.' },
        hint: 'Esc or a click outside cancels. This only reads parameter lists; nothing is written to the plant.'
      }, function (yes) {
        if (!yes) return;
        var progress = openExportProgress(unitCount, 'Exporting all units to Excel');
        collectUnitBlocks({
          recids: (ug.records || []).map(function (r) { return r.recid; }),
          restore: function () { restoreUnitSelection(selNow); },
          onProgress: progress.update,
          shouldStop: progress.cancelled,
          done: function (blocks, failed, wasCancelled) {
          progress.close();
          if (wasCancelled) {
            toast('Export cancelled after ' + blocks.length + ' unit(s) - nothing downloaded, selection restored.');
            return;
          }
          var nonEmpty = blocks.filter(function (b) { return b.records.length; });
          var empty = blocks.length - nonEmpty.length;
          if (!nonEmpty.length) { toast('No parameters found on any unit — nothing to export.', true); return; }
          var rows = iwdieBuildAllUnitsExportRows(nonEmpty);
          var total = nonEmpty.reduce(function (sum, b) { return sum + b.records.length; }, 0);
          var name = iwdieBuildParamExportFilename(currentPlantIdForExport(), 'all-units', new Date());
          var blob = buildXlsxBlob([{ name: 'All units', rows: rows, colWidths: IWDIE_ALLUNITS_COL_WIDTHS }]);
          triggerXlsxDownload(blob, name);
          W.__IWDIE.lastExport = { name: name, units: nonEmpty.length, params: total, failed: failed, empty: empty };
          toast('Exported ' + total + ' parameters across ' + nonEmpty.length + ' units -> ' + name +
            (failed ? ' (' + failed + ' unit(s) failed to load)' : '') +
            (empty ? ' (' + empty + ' empty unit(s) skipped)' : ''), false, 8000);
          }
        });
      });
    }

    /* The popup's bottom row (ALIAS TEXT / UNIT ID / UNIT NAME) is the w2ui
       toolbar "nolinkable_toolbar"; its items are radio-like ("PS Select which
       item adds to Label"), so the export control is a separate td appended
       after the UNIT NAME item td rather than a w2ui item — clicking it must
       never move the host's checked state. w2ui re-renders that toolbar on
       every popup open, wiping the td; the 800 ms installer interval re-adds
       it (idempotent, same pattern as the sidebar fieldset). */
    function makeParamExportTd(id, caption, title, handler) {
      var td = document.createElement('td');
      td.id = id;
      // Same markup shape w2ui renders for its own buttons, so the host CSS
      // styles it identically to ALIAS TEXT / UNIT ID / UNIT NAME.
      td.innerHTML = '<table class="w2ui-button" cellpadding="0" cellspacing="0"' +
        ' title="' + title + '"' +
        ' onclick="' + handler + '"><tbody><tr>' +
        '<td class="w2ui-tb-caption" style="white-space:nowrap">' + caption + '</td>' +
        '</tr></tbody></table>';
      return td;
    }

    function ensureParamExportButton() {
      // The host leaves the units grid single-select; multi-unit export needs
      // a way to accumulate. Host code reads the clicked record from the click
      // event, never the selection set, so widening the selection model does
      // not change any host behavior. Modifier-key selection (Ctrl/Shift) is
      // unreliable on at least one machine — a third-party content script
      // swallows ctrlKey clicks at window level — so the grid also gets
      // w2ui's checkbox column: plain click ticks a unit, no modifiers, and
      // the header checkbox selects every unit. Clicking the row itself still
      // single-selects and loads that unit exactly as before.
      try {
        var ugrid = W.w2ui && W.w2ui.unitgrid;
        if (ugrid && ugrid.multiSelect !== true) ugrid.multiSelect = true;
        if (ugrid && ugrid.show && ugrid.show.selectColumn !== true) {
          ugrid.show.selectColumn = true;
          ugrid.refresh();
        }
      } catch (e) { }
      var anchor = document.getElementById('tb_nolinkable_toolbar_item_add_unit_name');
      if (!anchor || !anchor.parentNode) return;
      if (!document.getElementById('iwdie_param_export_td')) {
        anchor.insertAdjacentElement('afterend', makeParamExportTd(
          'iwdie_param_export_td', 'EXPORT XLSX',
          'Download every parameter of the selected regulator(s) as Excel (.xlsx) - tick several units with the checkboxes',
          'window.__IWDIE.doExportParams()'));
      }
      if (!document.getElementById('iwdie_param_export_all_td')) {
        document.getElementById('iwdie_param_export_td').insertAdjacentElement('afterend', makeParamExportTd(
          'iwdie_param_export_all_td', 'EXPORT ALL XLSX',
          'Download every parameter of every unit on this plant as Excel (.xlsx)',
          'window.__IWDIE.doExportAllParams()'));
      }
    }

    /* ---------- console surface + install ---------- */
    W.__IWDIE = {
      version: IWDIE_VERSION,
      doExport: doExport,
      openImportPanel: openImportPanel,
      applyImport: applyImport,
      doExportBackgroundAi: doExportBackgroundAi,
      editInVectorCraft: doEditInVectorCraft,
      stageImportText: stageImportText,
      doExportParams: doExportParams,
      doExportAllParams: doExportAllParams,
      _collect: collectCurrentDoc
    };

    var installTimer = setInterval(function () {
      ensureParamExportButton();
      if (!document.getElementById('manager_widget7')) return;
      ensureFieldset();
      updateCompact();
    }, 800);
    // keep the interval running forever (cheap) so the fieldset survives any
    // host re-render of the sidebar; ensureFieldset() is idempotent and
    // updateCompact() re-evaluates after zooms/window changes too. The param
    // export button rides the same interval: its toolbar anchor only exists
    // after the PARAMETER SELECTOR popup has been opened once, and w2ui wipes
    // the td again on every re-render of that toolbar.
    try { window.addEventListener('resize', updateCompact); } catch (e) {}
    ensureFieldset();
    updateCompact();
    ensureParamExportButton();
  })();
}

/* ===================== Node test surface ===================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IWDIE_VERSION: IWDIE_VERSION,
    IWDIE_FORMAT: IWDIE_FORMAT,
    IWDIE_DOC_KEYS: IWDIE_DOC_KEYS,
    IWDIE_BLOB_KEYS: IWDIE_BLOB_KEYS,
    buildEnvelope: iwdieBuildEnvelope,
    envelopeDoc: iwdieEnvelopeDoc,
    buildAiGuide: iwdieBuildAiGuide,
    AI_GUIDE_VERSION: IWDIE_AI_GUIDE_VERSION,
    OBJECT_SCHEMA: IWDIE_OBJECT_SCHEMA,
    CONTAINER_SCHEMA: IWDIE_CONTAINER_SCHEMA,
    PANEL_SCHEMA: IWDIE_PANEL_SCHEMA,
    fileLayout: iwdieFileLayout,
    summarizeDoc: iwdieSummarizeDoc,
    exampleUnlinkedObject: iwdieExampleUnlinkedObject,
    exampleLinkedObject: iwdieExampleLinkedObject,
    exampleMinimalFile: iwdieExampleMinimalFile,
    exampleContainer: iwdieExampleContainer,
    checkEnvelopeCounts: iwdieCheckEnvelopeCounts,
    stringifyEnvelope: iwdieStringifyEnvelope,
    isFlatObject: iwdieIsFlatObject,
    constantObjectFields: iwdieConstantObjectFields,
    noteTraceInAiGuide: iwdieNoteTraceInAiGuide,
    noteArtworkInAiGuide: iwdieNoteArtworkInAiGuide,
    countSvgShapes: iwdieCountSvgShapes,
    OBJECT_CATALOGUE: IWDIE_OBJECT_CATALOGUE,
    SIGNAL_TO_OBJECT: IWDIE_SIGNAL_TO_OBJECT,
    LAYOUT: IWDIE_LAYOUT,
    PARAMETER_SELECTION: IWDIE_PARAMETER_SELECTION,
    DRAWING_STYLE: IWDIE_DRAWING_STYLE,
    SELF_CHECK: IWDIE_SELF_CHECK,
    COMMON_MISTAKES: IWDIE_COMMON_MISTAKES,
    QUICK_START: IWDIE_QUICK_START,
    CAPTION_CONVENTIONS: IWDIE_CAPTION_CONVENTIONS,
    roleOf: iwdieRoleOf,
    checkPanelGeometry: iwdieCheckPanelGeometry,
    checkFile: iwdieCheckFile,
    checkReportText: iwdieCheckReportText,
    checkReportHtml: iwdieCheckReportHtml,
    groupFindings: iwdieGroupFindings,
    insertOutcome: iwdieInsertOutcome,
    findingsHtml: iwdieFindingsHtml,
    blockedReportHtml: iwdieBlockedReportHtml,
    countPhrase: iwdieCountPhrase,
    plural: iwdieN,
    DRAW_KEYWORD: IWDIE_DRAW_KEYWORD,
    DRAW_BASE_CHUNK: IWDIE_DRAW_BASE_CHUNK,
    drawShape: iwdieDrawShape,
    drawShapes: iwdieDrawShapes,
    drawShapeSvg: iwdieDrawShapeSvg,
    drawPathD: iwdieDrawPathD,
    drawMap: iwdieDrawMap,
    drawExtract: iwdieDrawExtract,
    drawCleanD: iwdieDrawCleanD,
    drawLibItems: iwdieDrawLibItems,
    zstdDecompress: iwdieZstdDecompress,
    iccCmykConverter: iwdieIccCmykConverter,
    cmykNaive: iwdieCmykNaive,
    latin1: iwdieLatin1,
    aiText: iwdieAiText,
    aiName: iwdieAiName,
    aiContainer: iwdieAiContainer,
    aiNative: iwdieAiNative,
    aiParse: iwdieAiParse,
    aiPathD: iwdieAiPathD,
    aiLibrary: iwdieAiLibrary,
    aiNum: iwdieAiNum,
    aiLatin1Text: iwdieAiLatin1Text,
    aiUtf8Text: iwdieAiUtf8Text,
    aiXmlId: iwdieAiXmlId,
    aiUniqueIds: iwdieAiUniqueIds,
    aiColour: iwdieAiColour,
    aiShapeLines: iwdieAiShapeLines,
    aiShapeSubpaths: iwdieAiShapeSubpaths,
    aiLayerLines: iwdieAiLayerLines,
    aiRasterParts: iwdieAiRasterParts,
    aiHeaderLines: iwdieAiHeaderLines,
    aiProgram: iwdieAiProgram,
    aiPdf: iwdieAiPdf,
    aiPrivateData: iwdieAiPrivateData,
    aiObjectLines: iwdieAiObjectLines,
    aiQuadToCubic: iwdieAiQuadToCubic,
    aiTraceShapes: iwdieAiTraceShapes,
    VC_URL: IWDIE_VC_URL,
    VC_CHUNK: IWDIE_VC_CHUNK,
    vcSvg: iwdieVcSvg,
    vcSized: iwdieVcSized,
    vcMergeShapes: iwdieVcMergeShapes,
    vcEmbed: iwdieVcEmbed,
    vcExtract: iwdieVcExtract,
    vcSubpaths: iwdieVcSubpaths,
    vcPaint: iwdieVcPaint,
    vcAppearance: iwdieVcAppearance,
    vcNativeDoc: iwdieVcNativeDoc,
    vcLibraryFile: iwdieVcLibraryFile,
    vcThumbSvg: iwdieVcThumbSvg,
    VC_ZCHUNK: IWDIE_VC_ZCHUNK,
    VC_BUDGET: IWDIE_VC_BUDGET,
    vcFlatPalette: iwdieVcFlatPalette,
    vcSnap: iwdieVcSnap,
    vcTraceScale: iwdieVcTraceScale,
    vcFindPicture: iwdieVcFindPicture,
    vcStripEditing: iwdieVcStripEditing,
    vcChunk: iwdieVcChunk,
    VC_OBJ_PREFIX: IWDIE_VC_OBJ_PREFIX,
    VC_OBJ_LIBRARY: IWDIE_VC_OBJ_LIBRARY,
    VC_OBJ_Z: IWDIE_VC_OBJ_Z,
    vcObjectCatalog: iwdieVcObjectCatalog,
    vcObjectCaption: iwdieVcObjectCaption,
    vcObjectItems: iwdieVcObjectItems,
    vcObjectItem: iwdieVcObjectItem,
    vcObjects: iwdieVcObjects,
    VC_OBJ_LOOK: IWDIE_VC_OBJ_LOOK,
    VC_LOOKS_KEY: IWDIE_VC_LOOKS_KEY,
    vcPixelHash: iwdieVcPixelHash,
    vcObjectSvg: iwdieVcObjectSvg,
    vcObjectSearch: iwdieVcObjectSearch,
    VC_UPLOADS_KEY: IWDIE_VC_UPLOADS_KEY,
    vcUploadName: iwdieVcUploadName,
    vcImageNames: iwdieVcImageNames,
    vcUploadReply: iwdieVcUploadReply,
    vcObjectId: iwdieVcObjectId,
    vcDesignerObjects: iwdieVcDesignerObjects,
    vcTakePlaceholders: iwdieVcTakePlaceholders,
    vcNode: iwdieVcNode,
    pngChunks: iwdiePngChunks,
    pngCrc32: iwdiePngCrc32,
    sniffMime: iwdieSniffMime,
    bytesToBase64: iwdieBytesToBase64,
    ductLinesFromSvg: iwdieDuctLinesFromSvg,
    svgSize: iwdieSvgSize,
    exampleStarterVentilation: iwdieExampleStarterVentilation,
    backgroundInfo: iwdieBackgroundInfo,
    imageHeaderSize: iwdieImageHeaderSize,
    base64ByteLength: iwdieBase64ByteLength,
    parsePayload: iwdieParsePayload,
    diagnosePayload: iwdieDiagnosePayload,
    diagnoseDoc: iwdieDiagnoseDoc,
    diagnoseBadJson: iwdieDiagnoseBadJson,
    buildAiFixPrompt: iwdieBuildAiFixPrompt,
    looksImprovised: iwdieLooksImprovised,
    validateDoc: iwdieValidateDoc,
    normalizeDoc: iwdieNormalizeDoc,
    attachBackground: iwdieAttachBackground,
    docHasBackground: iwdieDocHasBackground,
    svgToDataUrl: iwdieSvgToDataUrl,
    validateSvg: iwdieValidateSvg,
    detectSourcePlant: iwdieDetectSourcePlant,
    eachDriverId: iwdieEachDriverId,
    countRebindable: iwdieCountRebindable,
    rebindDriverIds: iwdieRebindDriverIds,
    listForeignDriverIds: iwdieListForeignDriverIds,
    summarize: iwdieSummarize,
    sanitizeName: iwdieSanitizeName,
    buildExportFilename: iwdieBuildExportFilename,
    parseDataUrl: iwdieParseDataUrl,
    parseCssColor: iwdieParseCssColor,
    imageHasTransparency: iwdieImageHasTransparency,
    flattenRgbaOnto: iwdieFlattenRgbaOnto,
    isSvgBackground: iwdieIsSvgBackground,
    backgroundExt: iwdieBackgroundExt,
    backgroundMime: iwdieBackgroundMime,
    countDocItems: iwdieCountDocItems,
    paramExportHeader: IWDIE_PARAM_EXPORT_HEADER,
    allUnitsExportHeader: IWDIE_ALLUNITS_EXPORT_HEADER,
    buildParamExportRows: iwdieBuildParamExportRows,
    buildAllUnitsExportRows: iwdieBuildAllUnitsExportRows,
    paramAccessLabel: iwdieParamAccessLabel,
    buildParamExportFilename: iwdieBuildParamExportFilename,
    buildImagePdf: iwdieBuildImagePdf,
    buildBackgroundFilename: iwdieBuildBackgroundFilename,
    buildPalette: iwdieBuildPalette,
    TRACE_SUPERSAMPLE: IWDIE_TRACE_SUPERSAMPLE,
    TRACE_SUPERSAMPLE_MAX_PX: IWDIE_TRACE_SUPERSAMPLE_MAX_PX,
    traceScaleFor: iwdieTraceScaleFor,
    rescaleTraceSvg: iwdieRescaleTraceSvg,
    tidyTraceSvg: iwdieTidyTraceSvg,
    mergeBlendColours: iwdieMergeBlendColours,
    traceOptionsIllustrator: iwdieTraceOptionsIllustrator,
    traceLayerName: iwdieTraceLayerName,
    traceColourRole: iwdieTraceColourRole,
    traceObjectName: iwdieTraceObjectName,
    traceObjectTree: iwdieTraceObjectTree,
    traceAssemblies: iwdieTraceAssemblies,
    traceDuctName: iwdieTraceDuctName,
    pointInRing: iwdiePointInRing,
    TRACE_OBJECT_LIMIT: IWDIE_TRACE_OBJECT_LIMIT,
    traceProgress: iwdieTraceProgress,
    traceWorkerDeps: iwdieTraceWorkerDeps,
    TRACE_WORKER_INPUTS: IWDIE_TRACE_WORKER_INPUTS,
    buildTraceWorkerCode: iwdieBuildTraceWorkerCode,
    buildTraceWorkerPayload: iwdieBuildTraceWorkerPayload,
    traceWorkerInputs: iwdieTraceWorkerInputs,
    prepareExportTrace: iwdiePrepareExportTrace,
    completeExport: iwdieCompleteExport,
    tracer: IWDIE_TRACER
  };
}
