// ==UserScript==
// @name         IWMAC Designer Import/Export
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.21.1
// @description  Export the current panel as JSON / insert panel JSON into the canvas on the IWMAC Designer (legacy.iwmac.local) — copy a panel's look between panels and plants, with driver-id rebinding and embedded background image + parameter-selector Excel export
// @author       hapnes-dev
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @supportURL   https://github.com/hapnes-dev/tampermonkey-scripts/issues
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js
// @match        http://legacy.iwmac.local/iwmac_designer_v4/*
// @match        https://legacy.iwmac.local/iwmac_designer_v4/*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_addStyle
// ==/UserScript==

/*
 * Pure helpers live above the browser body so Node can require() this file
 * for unit checks (same layout as Logic-Designer-Import-Export.user.js).
 * The host internals this script drives are documented in
 * iwmac-designer-reference/CLAUDE.md.
 */

'use strict';

var IWDIE_VERSION = '1.21.1';
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
  return {
    field: 'image_data',
    mime: (mime && mime[1]) || null,
    width: size ? size.width : null,
    height: size ? size.height : null,
    bytes: b64 ? iwdieBase64ByteLength(b64[1]) : null,
    source_name: orgImageName || null
  };
}

/**
 * The reading instructions an AI agent needs to work on this file without
 * opening either blob. Sits near the top because that is where an agent that
 * only reads the first part of a large file will look.
 */
function iwdieBuildAiGuide(hasBackground, constantFields) {
  var skip = [];
  if (hasBackground) skip.push('image_data');
  return {
    purpose: 'IWMAC Designer panel export. The panel is a set of objects positioned absolutely over one background picture.',
    read_order: ['counts', 'background', 'panel.single_objects', 'panel.containers'],
    skip_fields: skip,
    skip_reason: skip.length
      ? 'One very long line of base64. It is placed last so everything above stays readable, and "background" already states its mime, pixel size and byte count.'
      : 'This export carries no embedded picture.',
    coordinates: 'posLeft and posTop are pixels from the top-left of the background picture; posWidth and posHeight are the object box. There is no nesting or transform — the numbers are absolute.',
    object_fields: IWDIE_OBJECT_FIELDS,
    constant_fields: constantFields || null,
    constant_fields_note: constantFields
      ? 'These hold the same value on every object in this export. The host requires them, but they say nothing about this panel — read the fields that differ.'
      : 'Every object field varies across this export.',
    editing: 'Edit values inside panel.single_objects[] and leave every other key exactly as it is. Feed the result back with the "Insert JSON…" button in the userscript.',
    do_not: [
      'Do not change "format" or invent a new one — it is checked before anything else is read.',
      'Do not add prose, notes or provenance keys; the importer rejects files that look improvised.',
      'Do not renumber obj_id, and do not reformat the blob fields.'
    ]
  };
}

/**
 * Envelope layout is chosen for readers, human and machine: identity first,
 * then the counts and the background label, then the panel itself, and only
 * then the blobs. image_data and image_svg_trace are lifted out of the panel
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
  var env = {
    format: IWDIE_FORMAT,
    version: IWDIE_FORMAT_VERSION,
    exported_at: meta.exported_at || new Date().toISOString(),
    generator: 'IWDIE v' + IWDIE_VERSION,
    ai_guide: iwdieBuildAiGuide(!!bg, iwdieConstantObjectFields(doc.single_objects)),
    source_plant_id: doc.plant_id != null ? String(doc.plant_id) : null,
    panel_name: doc.panel_name || null,
    panel_width: doc.panel_width || null,
    panel_height: doc.panel_height || null,
    counts: {
      single_objects: (doc.single_objects || []).length,
      containers: (doc.containers || []).length,
      graphics: (doc.graphics || []).length
    },
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
function iwdieNoteTraceInAiGuide(env) {
  if (!env || typeof env !== 'object') return env;
  var guide = env.ai_guide;
  if (!guide || typeof guide !== 'object') return env;
  var trace = String(env.image_svg_trace || '');
  // both directions: a file that lost its trace must lose the description too,
  // or the guide sends a reader looking for a field that is not there
  if (!trace) { delete guide.structure; return env; }
  guide.structure = {
    field: 'image_svg_trace',
    paths: (trace.match(/<path/g) || []).length,
    what: 'A coarse vector trace of the background picture: equipment outlines, pipe runs and frames, in panel coordinates. Small paths are dropped, so there is no text in it.',
    use: 'Read it to find where things are — then use panel.single_objects[] for what they are. tag_text and alias_text carry the labels, spelled properly.',
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
  L.push('- A 360.001 Ventilasjon panel is objects-only: no image_svg, no image_data, no drawn background.');
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
  var pal = [], j;
  for (j = 0; j < keys.length && pal.length < maxColors; j++) {
    if (counts[keys[j]] < floor && pal.length >= 8) break;
    if (pal.length && near(pal, best[keys[j]])) continue;
    pal.push(toRGB(best[keys[j]]));
  }
  var extra = 0;
  for (; j < keys.length && extra < 8; j++) {
    if (counts[keys[j]] < Math.max(24, floor >> 1)) break;
    if (isSat(best[keys[j]]) && !near(pal, best[keys[j]])) { pal.push(toRGB(best[keys[j]])); extra++; }
  }
  return pal;
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

function iwdieBuildTraceWorkerCode(tracerSrc, paletteSrc) {
  return 'var IT=new (' + tracerSrc + ')();' +
    'var BP=' + paletteSrc + ';' +
    'onmessage=function(e){try{' +
    'var o=e.data.opts;' +
    'if(e.data.paletteColors){var p=BP(e.data.img,e.data.paletteColors); if(p)o.pal=p;}' +
    'postMessage({svg:IT.imagedataToSVG(e.data.img,o)})}catch(err){postMessage({err:String(err)})}};';
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
      env.image_svg_trace = svg;
      iwdieNoteTraceInAiGuide(env);
      return { env: env, traceNote: ' + vector structure' };
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
var XLSX_STYLE_GROUP = 2;    // bold dark blue on light blue band
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

/* rows: [{cells, style?, outline?}] — header row (style 1), then one light
 * blue collapsible band per parameter group (style 2) with the group's
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
 * a whole unit), light blue group bands inside it (outline 1), parameters at
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

/* ===================== browser body ===================== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    var W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    if (W.__IWDIE_LOADED) return;
    W.__IWDIE_LOADED = true;

    /* ---------- styles ---------- */
    var CSS = [
      '.iwdie-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(25,25,25,.95);color:#fff;',
      '  padding:10px 18px;border-radius:6px;font:13px/1.5 Roboto,Arial,sans-serif;z-index:100000;max-width:640px;box-shadow:0 4px 18px rgba(0,0,0,.4);white-space:pre-line}',
      '.iwdie-toast.iwdie-err{background:rgba(140,30,30,.96)}',
      '.iwdie-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998}',
      '.iwdie-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:520px;max-width:92vw;max-height:86vh;overflow:auto;',
      '  background:#fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);z-index:99999;font:13px/1.5 Roboto,Arial,sans-serif;color:#222;padding:18px 20px}',
      '.iwdie-panel h3{margin:0 0 10px;font-size:15px}',
      '.iwdie-panel label{display:block;margin:10px 0 4px;font-weight:500}',
      '.iwdie-drop{border:2px dashed #9aa7b3;border-radius:6px;padding:18px;text-align:center;color:#667;margin:8px 0}',
      '.iwdie-drop.iwdie-over{border-color:#2f6fb2;color:#2f6fb2;background:#eef5fc}',
      '.iwdie-panel textarea{width:100%;height:110px;box-sizing:border-box;font:12px/1.4 Consolas,monospace}',
      '.iwdie-btn{display:inline-block;background:#2f6fb2;color:#fff;border:none;border-radius:4px;padding:7px 14px;margin:8px 8px 0 0;cursor:pointer;font:13px Roboto,Arial,sans-serif}',
      '.iwdie-btn:hover{background:#265d96}',
      '.iwdie-btn.iwdie-secondary{background:#7a8794}',
      '.iwdie-errlist{background:#fdf0f0;border:1px solid #e3b3b3;border-radius:6px;padding:10px 14px;margin:8px 0;max-height:420px;overflow:auto}',
      '.iwdie-errlist li{margin:4px 0}',
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

    function toast(msg, isErr, ms) {
      try {
        var t = document.createElement('div');
        t.className = 'iwdie-toast' + (isErr ? ' iwdie-err' : '');
        t.textContent = msg;
        overlayParent().appendChild(t);
        setTimeout(function () { t.remove(); }, ms || 5000);
      } catch (e) { /* noop */ }
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
      /* Three stacked buttons at the host's standard btn_full size; the
         sidebar-height relaxation in the injected CSS keeps the manager
         sidebar scrollbar-free (see the #manager_div rule above). */
      var html = [
        "<div id='manager_widget_iwdie'>",
        '  <fieldset>',
        '    <legend>Panel JSON</legend>',
        "    <button id='iwdie_export_btn' class='btn_full ui-button ui-corner-all' onclick=\"window.__IWDIE.doExport()\">Export JSON</button>",
        "    <button id='iwdie_import_btn' class='btn_full ui-button ui-corner-all' onclick=\"window.__IWDIE.openImportPanel()\">Insert JSON…</button>",
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
        linefilter: false, viewbox: true, desc: false
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
      toast('Tracing the background structure… the export downloads when done.', false, 6000);
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
          var finish = function (svg) { resolve(iwdieRescaleTraceSvg(svg, got.scale, w, h)); };
          traceInWorker(got.data, traceOptsStructure(), IWDIE_TRACE_PALETTE_COLORS).then(finish).catch(function (workerError) {
            try {
              // the first buffer was transferred into the worker, so both the
              // pixels and the palette have to be taken again here
              var again = buildTraceSource(img, w, h, fillCss, 1);
              if (!again) throw new Error('could not rebuild the pixels');
              resolve(iwdieRescaleTraceSvg(
                IWDIE_TRACER.imagedataToSVG(again.data, traceOptsStructureFor(again.data)), again.scale, w, h));
            } catch (fallbackError) {
              reject(new Error('Vector trace failed in worker and main-thread fallback: ' + workerError + '; ' + fallbackError));
            }
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

    /* Run the vendored tracer in a Web Worker so long traces (photo
       backgrounds can take minutes) never freeze the tab. The whole library
       is one self-contained constructor, so its source can be lifted into
       the worker via Function.prototype.toString — no second copy needed. */
    function traceInWorker(imgData, opts, paletteColors) {
      return new Promise(function (resolve, reject) {
        var src, paletteSrc;
        try {
          src = IWDIE_TRACER.constructor.toString();
          paletteSrc = iwdieBuildPalette.toString();
        } catch (e) { reject(e); return; }
        // The palette scan is lifted in the same way as the tracer itself, by
        // source: it is a pure function of the ImageData, and running it here
        // keeps a 26-72 ms pass over a 4 MB buffer off the UI thread.
        var code = iwdieBuildTraceWorkerCode(src, paletteSrc);
        var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        var w;
        try { w = new Worker(url); } catch (e) { URL.revokeObjectURL(url); reject(e); return; } // e.g. CSP without blob: worker-src
        var done = function () { URL.revokeObjectURL(url); try { w.terminate(); } catch (e) {} };
        w.onmessage = function (ev) { done(); if (ev.data && ev.data.svg) resolve(ev.data.svg); else reject(new Error(ev.data && ev.data.err || 'trace failed')); };
        w.onerror = function (ev) { done(); reject(new Error('worker: ' + (ev.message || 'error'))); };
        w.postMessage(iwdieBuildTraceWorkerPayload(imgData, opts, paletteColors), [imgData.data.buffer]);
      });
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
          var deliverTrace = function (traced, scale) {
            traced = iwdieRescaleTraceSvg(traced, scale, w, h);
            downloadBytes(traced, svgName, 'image/svg+xml');
            hostOk('Background traced to vectors in ' + Math.round((Date.now() - t0) / 100) / 10 + ' s → ' + svgName + ' (' +
              ((traced.match(/<path/g) || []).length) + ' paths' +
              (scale > 1 ? ', traced at ' + scale + '× so the small labels survive' : '') +
              '). Open in Illustrator (File → Open); retype small labels there.');
          };
          toast('Tracing background to vectors… the browser stays usable; the .svg downloads when done.', false, 6000);
          traceInWorker(got.data, traceOpts(), IWDIE_TRACE_PALETTE_COLORS)
            .then(function (svg) { deliverTrace(svg, got.scale); })
            .catch(function () {
              // no worker available (old browser / strict CSP): trace on the
              // main thread after letting the toast paint first
              toast('Tracing on the main thread — the browser will be busy for a moment…', false, 8000);
              setTimeout(function () {
                try {
                  var again = buildTraceSource(img, w, h, fillCss); // first buffer was transferred away
                  if (!again) throw new Error('could not rebuild the pixels');
                  deliverTrace(IWDIE_TRACER.imagedataToSVG(again.data, traceOptsFor(again.data)), again.scale);
                }
                catch (e) { toast('Vector trace failed: ' + e, true); }
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
      if (!IWDIE_TRACER) { startRasterExport(false); return; }
      openAiChooser(panel, startRasterExport, saveVerbatim);
    }

    /* ---------- Background → Illustrator chooser (v1.6.0) ---------- */
    var aiChooserOverlay = null;

    function closeAiChooser() {
      if (aiChooserOverlay) { aiChooserOverlay.remove(); aiChooserOverlay = null; }
      document.removeEventListener('keydown', onAiChooserKeydown, true);
    }

    function onAiChooserKeydown(ev) {
      if (ev.key === 'Escape') { closeAiChooser(); ev.stopPropagation(); }
    }

    function openAiChooser(panelName, start, saveAsIs) {
      closeAiChooser();
      var escd = String(panelName == null ? '' : panelName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      aiChooserOverlay = document.createElement('div');
      aiChooserOverlay.className = 'iwdie-overlay';
      var panel = document.createElement('div');
      panel.className = 'iwdie-panel';
      panel.innerHTML = [
        '<button class="iwdie-x" id="iwdie_ai_x" title="Close (Esc)">×</button>',
        '<h3>Background → Illustrator</h3>',
        '<div>The background of <b>' + escd + '</b> is a pixel image (PNG/JPG). Pixels contain no vectors, so choose how Illustrator should get it:</div>',
        '<div class="iwdie-choice">',
        '  <button class="iwdie-btn" id="iwdie_ai_svg">Save as .SVG — vector trace</button>',
        '  <div>Auto-traced to <b>editable vector shapes</b> in the drawing’s own colours — pipes, pills and symbols come out clean. Small text becomes rough outlines; retype labels in Illustrator. Traces in the background: drawings take ~1–2 s, photos can take minutes (the browser stays usable, the file downloads when done). Open with <i>File → Open</i>.</div>',
        '</div>',
        '<div class="iwdie-choice">',
        '  <button class="iwdie-btn" id="iwdie_ai_pix">Save as .AI — pixels on artboard</button>',
        '  <div>The original image, <b>lossless and pixel-exact</b>, placed 1:1 on an artboard (1 px = 1 pt). Ideal as a reference or tracing layer under new artwork — zooming shows pixels, nothing is vector-editable.</div>',
        '</div>',
        '<div class="iwdie-choice">',
        '  <button class="iwdie-btn iwdie-secondary" id="iwdie_ai_raw">Save the picture as-is — .PNG / .JPG</button>',
        '  <div>The picture as the designer shows it: opaque pixels stay <b>byte-for-byte</b>; transparent holes are filled with the canvas background colour (so they do not come out black). This is the one to hand an AI (Copilot, Claude) when you want it to look at the panel and propose where the links go — an .ai or a trace only makes that harder to read.</div>',
        '</div>',
        '<div class="iwdie-hint">Tip: if the drawing’s Illustrator source (.ai) exists in your archive, editing that beats any trace.</div>'
      ].join('\n');
      aiChooserOverlay.appendChild(panel);
      document.body.appendChild(aiChooserOverlay);
      document.addEventListener('keydown', onAiChooserKeydown, true);
      aiChooserOverlay.addEventListener('mousedown', function (ev) { if (ev.target === aiChooserOverlay) closeAiChooser(); });
      panel.querySelector('#iwdie_ai_x').addEventListener('click', closeAiChooser);
      panel.querySelector('#iwdie_ai_svg').addEventListener('click', function () { closeAiChooser(); start(true); });
      panel.querySelector('#iwdie_ai_pix').addEventListener('click', function () { closeAiChooser(); start(false); });
      panel.querySelector('#iwdie_ai_raw').addEventListener('click', function () { closeAiChooser(); if (saveAsIs) saveAsIs(); });
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
      panel.className = 'iwdie-panel';
      panel.innerHTML = [
        '<h3>Import panel JSON</h3>',
        '<div>Rebuilds an exported panel on this canvas. If the panel already holds objects you are asked first whether to <b>replace</b> them or <b>add</b> to them. Nothing reaches the server — the panel only changes on screen until you press the designer’s own Save.</div>',
        '<div class="iwdie-opt" id="iwdie_bgonly_box">',
        '  <label for="iwdie_bgonly"><input type="checkbox" id="iwdie_bgonly"><span>Background picture only — insert no objects</span></label>',
        '  <div class="iwdie-hint">Takes nothing from the file but its background artwork. Every object already on the canvas stays exactly where it is, and none of the file’s objects, containers or graphics are inserted — so there is no replace-or-add question and no driver-id rebinding. Use it to slide re-drawn artwork in under an existing panel.</div>',
        '</div>',
        '<label>1. Background image (PNG/JPG) — optional, pick it before the .json</label>',
        '<input type="file" id="iwdie_bgfile" accept="image/png,image/jpeg,image/gif">',
        '<div class="iwdie-hint">Only needed when the export carries no background of its own.</div>',
        '<label>2. The exported .json file</label>',
        '<input type="file" id="iwdie_file" accept=".json,application/json">',
        '<div class="iwdie-drop" id="iwdie_drop">…or drop the .json here</div>',
        '<label>…or paste the JSON text instead</label>',
        '<textarea id="iwdie_paste" spellcheck="false" placeholder="Paste the exported JSON here…"></textarea>',
        '<div>',
        '  <button class="iwdie-btn" id="iwdie_paste_btn">Import the pasted JSON</button>',
        '  <button class="iwdie-btn iwdie-secondary" id="iwdie_cancel_btn">Cancel</button>',
        '</div>'
      ].join('\n');
      importOverlay.appendChild(panel);
      document.body.appendChild(importOverlay);
      document.addEventListener('keydown', onPanelKeydown, true);

      importOverlay.addEventListener('mousedown', function (ev) { if (ev.target === importOverlay) closeImportPanel(); });
      panel.querySelector('#iwdie_cancel_btn').addEventListener('click', closeImportPanel);
      var bgOnlyBox = panel.querySelector('#iwdie_bgonly');
      bgOnlyBox.addEventListener('change', function () {
        panel.querySelector('#iwdie_bgonly_box').classList.toggle('iwdie-on', bgOnlyBox.checked);
      });
      panel.querySelector('#iwdie_file').addEventListener('change', function (ev) {
        if (ev.target.files && ev.target.files[0]) readFileAndImport(ev.target.files[0]);
      });
      var drop = panel.querySelector('#iwdie_drop');
      drop.addEventListener('dragover', function (ev) { ev.preventDefault(); drop.classList.add('iwdie-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('iwdie-over'); });
      drop.addEventListener('drop', function (ev) {
        ev.preventDefault(); drop.classList.remove('iwdie-over');
        if (ev.dataTransfer.files && ev.dataTransfer.files[0]) readFileAndImport(ev.dataTransfer.files[0]);
      });
      panel.querySelector('#iwdie_paste_btn').addEventListener('click', function () {
        var txt = panel.querySelector('#iwdie_paste').value.trim();
        if (!txt) { toast('Nothing pasted.', true); return; }
        importFromText(txt);
      });
    }

    function readFileAndImport(file) {
      var fr = new FileReader();
      fr.onload = function () { importFromText(String(fr.result)); };
      fr.onerror = function () { toast('Could not read the file.', true); };
      fr.readAsText(file);
    }

    function importFromText(text) {
      var parsed;
      try { parsed = JSON.parse(text); }
      catch (e) {
        var bad = iwdieDiagnoseBadJson(text, e.message);
        showErrors(bad.errors, null, bad.diagnosis);
        return;
      }
      applyImport(parsed);
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

    function showErrors(errors, warnings, diagnosis) {
      var panel = importOverlay ? importOverlay.querySelector('.iwdie-panel') : null;
      var msg = 'Import blocked:\n• ' + errors.join('\n• ');
      if (panel) {
        var old = panel.querySelector('.iwdie-errlist');
        if (old) old.remove();
        var div = document.createElement('div');
        div.className = 'iwdie-errlist';
        var html = '<b>Import blocked — nothing was changed:</b><ul>' +
          errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' +
          (warnings && warnings.length ? '<i>Warnings:</i><ul>' + warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');
        if (diagnosis) {
          html += '<div class="iwdie-diag"><b>' + esc(diagnosis.headline) + '</b>' +
            '<ul>' + diagnosis.facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>' +
            '<button class="iwdie-btn" id="iwdie_copy_fix">📋 Copy the fix for the AI</button>' +
            '<button class="iwdie-btn iwdie-secondary" id="iwdie_show_fix">Show it</button>' +
            '<textarea class="iwdie-fixtext" id="iwdie_fix_text" readonly style="display:none">' +
            esc(diagnosis.aiPrompt) + '</textarea>';
        }
        div.innerHTML = html;
        panel.appendChild(div);
        if (diagnosis) {
          div.querySelector('#iwdie_copy_fix').addEventListener('click', function () {
            copyToClipboard(diagnosis.aiPrompt);
          });
          div.querySelector('#iwdie_show_fix').addEventListener('click', function () {
            var t = div.querySelector('#iwdie_fix_text');
            var shown = t.style.display !== 'none';
            t.style.display = shown ? 'none' : 'block';
            this.textContent = shown ? 'Show it' : 'Hide it';
          });
        }
      } else {
        toast(msg, true, 9000);
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
     *  Called only from applyImportCore, at the one point where nothing has
     *  been touched yet — the same place export collects, and never between
     *  the clear and the host loaders, whose scratch buffers this resets the
     *  way the host's own save path does (container_tool.js). Any failure
     *  falls back to the DOM count rather than blocking the import. */
    function canvasContentCount() {
      if (typeof W.getPanelDataFromDOM !== 'function') return canvasObjectCount();
      try {
        W.obj_data = []; W.container_data = []; W.container_items = [];
        var imgName = '';
        try { imgName = W.$('#main_image').attr('main_image') || ''; } catch (e) {}
        var doc = W.getPanelDataFromDOM(currentPlantId(), currentPanelName(), imgName, W.get_user_name());
        if (!doc) return canvasObjectCount();
        return (doc.single_objects || []).length +
          (doc.containers || []).length +
          (doc.graphics || []).length;
      } catch (e) {
        return canvasObjectCount();
      }
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

    function applyImport(parsed) {
      var bgOnly = bgOnlyRequested();
      readPendingBackground(function (bg) { applyImportCore(parsed, bg, bgOnly); });
    }

    function applyImportCore(parsed, pendingBg, bgOnly) {
      var res = iwdieParsePayload(parsed);
      if (res.errors) { showErrors(res.errors, null, res.diagnosis); return; }
      // A background-only import never reads the object arrays, so a file that
      // carries artwork and nothing else is valid input here.
      var v = iwdieValidateDoc(res.doc, { allowEmpty: bgOnly });
      if (v.errors.length) {
        // A file with artwork and no objects is not a broken export — it is a
        // background-only patch, and the switch above is what it is for. Say so
        // rather than making the user work out why an intact file was refused.
        var errors = v.errors.slice();
        if (!bgOnly && errors.length === 1 && /document is empty/.test(errors[0]) &&
            (pendingBg || iwdieDocHasBackground(res.doc))) {
          errors.push('It does carry a background image, though — tick “Background picture only — insert no objects” at the top of this dialog to apply just the artwork.');
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
      if (bgOnly) {
        if (!iwdieDocHasBackground(doc)) {
          showErrors([
            'This file carries no background image, so “Background picture only” has nothing to apply.',
            'Either the panel it was exported from had no artwork, or the file is objects-only by design (a 360.001 Ventilasjon panel is). Pick a PNG/JPG in step 1 to use as the background, or untick the box to insert the file’s objects instead.'
          ], v.warnings);
          return;
        }
        if (!applyBackground()) return;   // applyBackground() has already said why
        closeImportPanel();
        toast('Background applied' + (doc.org_image_name ? ' (' + doc.org_image_name + ')' : '') +
          ' — no objects were inserted, and nothing already on the canvas was touched.' +
          '\nNothing is saved yet — use the designer’s own Save buttons when happy.', false, 9000);
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
            rebindNote = ', ' + rb.rebound + ' driver ids rebound ' + source + '→' + target;
          }
          askBackground();
        });
      } else {
        askBackground();
      }

      // background: only touch it if the import carries one
      function askBackground() {
        if (doc.converted !== 'true' || !doc.image_data) { finish(false); return; }
        var hasBg = false;
        try { hasBg = (W.$('#main_image').css('background-image') || 'none') !== 'none'; } catch (e) {}
        // Replace mode already means "make this panel look like the export",
        // so the background follows without a second question.
        if (!hasBg || replace) { finish(applyBackground()); return; }
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
          finish(useFileBg ? applyBackground() : false);
        });
      }

      function applyBackground() {
        try {
          W.iw_set_base_image(doc.panel_width, doc.panel_height, doc.image_data);
          if (doc.org_image_name) { W.$('#main_image').attr('org_image_name', doc.org_image_name); }
          return true;
        } catch (e) { toast('Background could not be applied: ' + e, true); return false; }
      }

      function finish(appliedBg) {
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
          showErrors(['The designer refused the objects: ' + e]);
          return;
        }
        renumberCanvasNames();

        var skippedGraphics = 0;
        if (doc.graphics.length) {
          var canvasHasGraphics = false;
          try { canvasHasGraphics = Object.keys(W.loadedGraphic.loaded || {}).length > 0; } catch (e) {}
          if (!canvasHasGraphics && W.loadedGraphic && typeof W.loadedGraphic.loader === 'function') {
            try { W.loadedGraphic.loader(doc.graphics); } catch (e) { skippedGraphics = doc.graphics.length; }
          } else {
            skippedGraphics = doc.graphics.length;
          }
        }

        try { W.UpdateObjectWorker(); } catch (e) {}
        try { if (!document.getElementById('mouse_selector') && typeof W.make_mouse_selector === 'function') W.make_mouse_selector(); } catch (e) {}

        closeImportPanel();
        var msg = (cleared ? 'Replaced the panel — cleared ' + cleared + ' object' + (cleared === 1 ? '' : 's') + ' and inserted ' : 'Inserted ') +
          iwdieSummarize(doc) + rebindNote +
          (appliedBg ? ', background applied' : '') +
          (skippedGraphics ? ', ' + skippedGraphics + ' graphics skipped (canvas already has graphics)' : '') +
          '.\nNothing is saved yet — use the designer’s own Save buttons when happy.';
        if (foreign.length) {
          msg += '\n⚠ ' + foreign.length + ' object(s) still reference drivers from another plant and will not link here.';
        }
        toast(msg, foreign.length > 0, 9000);
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
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF0D47A1"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1976D2"/><bgColor rgb="FF1976D2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F2FD"/><bgColor rgb="FFE3F2FD"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF455A64"/><bgColor rgb="FF455A64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
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
    stringifyEnvelope: iwdieStringifyEnvelope,
    isFlatObject: iwdieIsFlatObject,
    constantObjectFields: iwdieConstantObjectFields,
    noteTraceInAiGuide: iwdieNoteTraceInAiGuide,
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
    TRACE_WORKER_INPUTS: IWDIE_TRACE_WORKER_INPUTS,
    buildTraceWorkerCode: iwdieBuildTraceWorkerCode,
    buildTraceWorkerPayload: iwdieBuildTraceWorkerPayload,
    traceWorkerInputs: iwdieTraceWorkerInputs,
    prepareExportTrace: iwdiePrepareExportTrace,
    completeExport: iwdieCompleteExport,
    tracer: IWDIE_TRACER
  };
}
