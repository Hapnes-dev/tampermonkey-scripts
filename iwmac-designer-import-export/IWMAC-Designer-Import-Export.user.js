// ==UserScript==
// @name         IWMAC Designer Import/Export
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.6.0
// @description  Export the current panel as JSON / insert panel JSON into the canvas on the IWMAC Designer (legacy.iwmac.local) — copy a panel's look between panels and plants, with driver-id rebinding and embedded background image
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
// @grant        GM_setClipboard
// ==/UserScript==

/*
 * Pure helpers live above the browser body so Node can require() this file
 * for unit checks (same layout as Logic-Designer-Import-Export.user.js).
 * The host internals this script drives are documented in
 * iwmac-designer-reference/CLAUDE.md.
 */

'use strict';

var IWDIE_VERSION = '1.6.0';
var IWDIE_FORMAT = 'iwmac-designer-panel';
var IWDIE_FORMAT_VERSION = 1;

/** The document fields getPanelDataFromDOM() produces (in this order). */
var IWDIE_DOC_KEYS = ['plant_id', 'panel_name', 'panel_width', 'panel_height',
  'org_image_name', 'image_name', 'saved_by', 'single_objects', 'containers', 'graphics'];

function iwdieBuildEnvelope(doc, meta) {
  meta = meta || {};
  var env = {
    format: IWDIE_FORMAT,
    version: IWDIE_FORMAT_VERSION,
    exported_at: meta.exported_at || new Date().toISOString(),
    generator: 'IWDIE v' + IWDIE_VERSION,
    source_plant_id: doc.plant_id != null ? String(doc.plant_id) : null,
    panel_name: doc.panel_name || null,
    panel_width: doc.panel_width || null,
    panel_height: doc.panel_height || null,
    counts: {
      single_objects: (doc.single_objects || []).length,
      containers: (doc.containers || []).length,
      graphics: (doc.graphics || []).length
    },
    background_embedded: doc.converted === 'true' && !!doc.image_data
  };
  env.panel = doc; // big payload last, for human readers
  return env;
}

/**
 * Accepts: the IWDIE envelope, a bare panel document, or the server's
 * array-of-one wrapping ([{...doc}], which is how V3load_design_panel
 * replies). Returns {doc, meta} or {errors:[...]}.
 */
function iwdieParsePayload(parsed) {
  if (parsed == null || typeof parsed !== 'object') {
    return { errors: ['Not a JSON object — expected an exported panel .json file.'] };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { errors: ['Empty array — no panel document inside.'] };
    return iwdieParsePayload(parsed[0]);
  }
  if (parsed.format === IWDIE_FORMAT) {
    if (parsed.version > IWDIE_FORMAT_VERSION) {
      return { errors: ['File version ' + parsed.version + ' is newer than this script understands (' + IWDIE_FORMAT_VERSION + '). Update the script.'] };
    }
    if (parsed.panel == null || typeof parsed.panel !== 'object') {
      return { errors: ['Envelope has no "panel" document inside.'] };
    }
    return { doc: parsed.panel, meta: parsed };
  }
  if (parsed.format) {
    return { errors: ['Unknown format "' + parsed.format + '" — this is not an IWMAC Designer panel export' +
      (parsed.format === 'vv-fbx-sketch' ? ' (it is a VV Designer logic sketch — wrong tool)' : '') + '.'] };
  }
  // bare document?
  if (Array.isArray(parsed.single_objects) || Array.isArray(parsed.containers)) {
    return { doc: parsed, meta: null };
  }
  return { errors: ['Unrecognized JSON — expected {format:"' + IWDIE_FORMAT + '", panel:{...}} or a bare panel document with single_objects[].'] };
}

/** Structural validation. Returns {errors:[], warnings:[]} — empty errors = importable. */
function iwdieValidateDoc(doc) {
  var errors = [];
  var warnings = [];
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
  if (nObj + nCon + nGra === 0) errors.push('Panel document is empty — no single_objects, containers or graphics.');
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
  var buckets = Object.create(null);
  var i, k, bk;
  for (i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    bk = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    var B = buckets[bk];
    if (!B) { B = buckets[bk] = { count: 0, best: k, bestCount: 0, exact: Object.create(null) }; }
    B.count++;
    var c = (B.exact[k] || 0) + 1;
    B.exact[k] = c;
    if (c > B.bestCount) { B.bestCount = c; B.best = k; }
  }
  var keys = Object.keys(buckets);
  if (!keys.length || keys.length > 3000) return null;
  keys.sort(function (a, b) { return buckets[b].count - buckets[a].count; });
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
    var Bj = buckets[keys[j]];
    if (Bj.count < floor && pal.length >= 8) break;
    if (pal.length && near(pal, Bj.best)) continue;
    pal.push(toRGB(Bj.best));
  }
  var extra = 0;
  for (; j < keys.length && extra < 8; j++) {
    var Bx = buckets[keys[j]];
    if (Bx.count < Math.max(24, floor >> 1)) break;
    if (isSat(Bx.best) && !near(pal, Bx.best)) { pal.push(toRGB(Bx.best)); extra++; }
  }
  return pal;
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
      '.iwdie-errlist{background:#fdf0f0;border:1px solid #e3b3b3;border-radius:6px;padding:10px 14px;margin:8px 0;max-height:220px;overflow:auto}',
      '.iwdie-errlist li{margin:4px 0}',
      '.iwdie-x{position:absolute;top:6px;right:8px;width:26px;height:26px;border:none;background:transparent;color:#66788a;font:18px/26px Arial,sans-serif;cursor:pointer;border-radius:4px;padding:0}',
      '.iwdie-x:hover{background:#e8edf2;color:#222}',
      '.iwdie-choice{border:1px solid #d5dbe1;border-radius:6px;padding:10px 12px;margin:10px 0;background:#f7f9fb}',
      '.iwdie-choice>div{margin-top:6px;color:#445;font-size:12.5px;line-height:1.45}',
      '.iwdie-choice .iwdie-btn{margin:0}',
      '.iwdie-hint{color:#778;font-size:11.5px;margin-top:6px}',
      '#manager_widget_iwdie fieldset{margin-top:4px}',
      /* The host hard-codes #manager_div to height:900px (overflow-y:auto);
         a fourth full-size button row makes the content ~918px, so the
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
         (the constant "little cut off" under the 4th button). Relax it the
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
      ''].join('\n');
    try {
      if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); }
      else { var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
    } catch (e) {
      var st2 = document.createElement('style'); st2.textContent = CSS; document.head.appendChild(st2);
    }

    /* ---------- tiny UI helpers ---------- */
    function toast(msg, isErr, ms) {
      try {
        var t = document.createElement('div');
        t.className = 'iwdie-toast' + (isErr ? ' iwdie-err' : '');
        t.textContent = msg;
        document.body.appendChild(t);
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
      /* Four stacked buttons at the host's standard btn_full size; the
         sidebar-height relaxation in the injected CSS keeps the manager
         sidebar scrollbar-free (see the #manager_div rule above). */
      var html = [
        "<div id='manager_widget_iwdie'>",
        '  <fieldset>',
        '    <legend>Panel JSON</legend>',
        "    <button id='iwdie_export_btn' class='btn_full ui-button ui-corner-all' onclick=\"window.__IWDIE.doExport()\">Export JSON</button>",
        "    <button id='iwdie_copy_btn' class='btn_full ui-button ui-corner-all' onclick=\"window.__IWDIE.doCopyJson()\">Copy JSON</button>",
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

    /* ---------- collect current canvas into the host's own document ---------- */
    function collectCurrentDoc() {
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
      if (!doc || ((doc.single_objects || []).length + (doc.containers || []).length + (doc.graphics || []).length) === 0) {
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

    /* ---------- export / copy ---------- */
    function buildEnvelopeAsync() {
      var doc = collectCurrentDoc();
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
       MUST run before traceInWorker: the worker transfer detaches the
       ImageData buffer. */
    function traceOptsFor(imgData) {
      var o = traceOpts();
      var pal = iwdieBuildPalette(imgData, 24);
      if (pal) o.pal = pal;
      return o;
    }

    /* Optionally add panel.image_svg_trace to an export envelope: the vector
       trace of the raster background — AI-reading material that tells an
       agent how the drawing is STRUCTURED (Insert strips it; it is never
       rendered). SVG backgrounds are copied in as-is (already vector). */
    function finishExportWithTrace(env, done) {
      var p = env.panel || {};
      var bg = String(p.image_data || '');
      if (bg.indexOf('data:image/svg') === 0) {
        var parsed = iwdieParseDataUrl(bg);
        if (parsed) {
          try { p.image_svg_trace = new TextDecoder().decode(parsed.bytes); } catch (e) {}
        }
        done(env, p.image_svg_trace ? ' + vector structure' : '');
        return;
      }
      if (bg.indexOf('data:image/') !== 0 || !IWDIE_TRACER) { done(env, ''); return; }
      var want = window.confirm(
        'Also include a VECTOR TRACE of the background in the JSON?\n\n' +
        'It lets an AI (Copilot) read how the drawing is structured — in the\n' +
        'drawing\'s own colours — and generate matching artwork. Adds roughly\n' +
        '1–3 MB. Drawings trace in ~1–2 s in the background; photos take longer.\n\n' +
        'OK = include the trace   |   Cancel = export without it');
      if (!want) { done(env, ''); return; }
      toast('Tracing the background structure… the export downloads when done.', false, 6000);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        var deliver = function (svg) {
          p.image_svg_trace = svg;
          done(env, ' + vector structure (' + ((svg.match(/<path/g) || []).length) + ' paths)');
        };
        var imgd = ctx.getImageData(0, 0, w, h);
        var opts = traceOptsFor(imgd);
        traceInWorker(imgd, opts).then(deliver).catch(function () {
          try {
            var imgd2 = ctx.getImageData(0, 0, w, h); // first buffer was transferred away
            deliver(IWDIE_TRACER.imagedataToSVG(imgd2, opts));
          }
          catch (e) { done(env, ''); }
        });
      };
      img.onerror = function () { done(env, ''); };
      img.src = bg;
    }

    function doExport() {
      buildEnvelopeAsync().then(function (env) {
        if (!env) return;
        finishExportWithTrace(env, function (env2, traceNote) {
          var name = iwdieBuildExportFilename(env2.source_plant_id, env2.panel_name);
          var blob = new Blob([JSON.stringify(env2, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
          hostOk('Exported ' + iwdieSummarize(env2.panel) + (env2.background_embedded ? ' + background' : '') + traceNote + ' → ' + name);
        });
      });
    }

    function copyTextToClipboard(text) {
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(text); return true; }
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text); return true;
      }
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      return ok;
    }

    function doCopyJson() {
      buildEnvelopeAsync().then(function (env) {
        if (!env) return;
        var ok = copyTextToClipboard(JSON.stringify(env, null, 2));
        if (ok) hostOk('Panel JSON copied to clipboard (' + iwdieSummarize(env.panel) + (env.background_embedded ? ' + background' : '') + ')');
        else toast('Clipboard copy failed on this browser — use Export JSON instead.', true);
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
    function traceInWorker(imgData, opts) {
      return new Promise(function (resolve, reject) {
        var src;
        try { src = IWDIE_TRACER.constructor.toString(); } catch (e) { reject(e); return; }
        var code = 'var IT=new (' + src + ')();' +
          'onmessage=function(e){try{postMessage({svg:IT.imagedataToSVG(e.data.img,e.data.opts)})}catch(err){postMessage({err:String(err)})}};';
        var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        var w;
        try { w = new Worker(url); } catch (e) { URL.revokeObjectURL(url); reject(e); return; } // e.g. CSP without blob: worker-src
        var done = function () { URL.revokeObjectURL(url); try { w.terminate(); } catch (e) {} };
        w.onmessage = function (ev) { done(); if (ev.data && ev.data.svg) resolve(ev.data.svg); else reject(new Error(ev.data && ev.data.err || 'trace failed')); };
        w.onerror = function (ev) { done(); reject(new Error('worker: ' + (ev.message || 'error'))); };
        w.postMessage({ img: { width: imgData.width, height: imgData.height, data: imgData.data }, opts: opts }, [imgData.data.buffer]);
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

      /* Raster background: a PNG has no vectors to carry over, so offer two
         deliveries in a proper dialog (v1.6.0; used to be a bare confirm) —
         an automatic vector TRACE (editable shapes; small text becomes
         outlines) as .svg, or the pixel-exact image as a PDF-based .ai
         artboard. Both buttons feed the same pipeline below. */
      var startRasterExport = function (wantTrace) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { toast('Background image has no size?', true); return; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h); // composite any alpha onto white
        ctx.drawImage(img, 0, 0);
        var rgba, rgb, i, j;
        try { rgba = ctx.getImageData(0, 0, w, h).data; } catch (e) { rgba = null; }
        if (wantTrace) {
          if (!rgba) { toast('Could not read the image pixels for tracing.', true); return; }
          var svgName = iwdieBuildBackgroundFilename(plant, panel + ' traced', 'svg');
          var t0 = Date.now();
          var deliverTrace = function (traced) {
            downloadBytes(traced, svgName, 'image/svg+xml');
            hostOk('Background traced to vectors in ' + Math.round((Date.now() - t0) / 100) / 10 + ' s → ' + svgName + ' (' +
              ((traced.match(/<path/g) || []).length) + ' paths). Open in Illustrator (File → Open); retype small labels there.');
          };
          toast('Tracing background to vectors… the browser stays usable; the .svg downloads when done.', false, 6000);
          var imgd = ctx.getImageData(0, 0, w, h);
          var opts = traceOptsFor(imgd);
          traceInWorker(imgd, opts).then(deliverTrace).catch(function () {
            // no worker available (old browser / strict CSP): trace on the
            // main thread after letting the toast paint first
            toast('Tracing on the main thread — the browser will be busy for a moment…', false, 8000);
            setTimeout(function () {
              try {
                var imgd2 = ctx.getImageData(0, 0, w, h); // first buffer was transferred away
                deliverTrace(IWDIE_TRACER.imagedataToSVG(imgd2, opts));
              }
              catch (e) { toast('Vector trace failed: ' + e, true); }
            }, 80);
          });
          return;
        }
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
      openAiChooser(panel, startRasterExport);
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

    function openAiChooser(panelName, start) {
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
        '<div class="iwdie-hint">Tip: if the drawing’s Illustrator source (.ai) exists in your archive, editing that beats any trace.</div>'
      ].join('\n');
      aiChooserOverlay.appendChild(panel);
      document.body.appendChild(aiChooserOverlay);
      document.addEventListener('keydown', onAiChooserKeydown, true);
      aiChooserOverlay.addEventListener('mousedown', function (ev) { if (ev.target === aiChooserOverlay) closeAiChooser(); });
      panel.querySelector('#iwdie_ai_x').addEventListener('click', closeAiChooser);
      panel.querySelector('#iwdie_ai_svg').addEventListener('click', function () { closeAiChooser(); start(true); });
      panel.querySelector('#iwdie_ai_pix').addEventListener('click', function () { closeAiChooser(); start(false); });
    }

    /* ---------- import modal ---------- */
    var importOverlay = null;

    function closeImportPanel() {
      if (importOverlay) { importOverlay.remove(); importOverlay = null; }
      document.removeEventListener('keydown', onPanelKeydown, true);
    }

    function onPanelKeydown(ev) {
      if (ev.key === 'Escape') { closeImportPanel(); ev.stopPropagation(); }
    }

    function openImportPanel() {
      closeImportPanel();
      importOverlay = document.createElement('div');
      importOverlay.className = 'iwdie-overlay';
      var panel = document.createElement('div');
      panel.className = 'iwdie-panel';
      panel.innerHTML = [
        '<h3>Insert panel JSON</h3>',
        '<div>Objects are <b>added</b> to the current canvas (nothing is deleted). On an empty panel this recreates the exported panel 1:1. Nothing is saved to the server until you use the designer’s own Save buttons.</div>',
        '<label>Optional: background image (PNG/JPG) — pick it BEFORE the .json</label>',
        '<input type="file" id="iwdie_bgfile" accept="image/png,image/jpeg,image/gif">',
        '<label>Pick the exported .json file</label>',
        '<input type="file" id="iwdie_file" accept=".json,application/json">',
        '<div class="iwdie-drop" id="iwdie_drop">…or drop the file here</div>',
        '<label>…or paste the JSON text</label>',
        '<textarea id="iwdie_paste" spellcheck="false" placeholder="Lim inn / paste the JSON here…"></textarea>',
        '<div>',
        '  <button class="iwdie-btn" id="iwdie_paste_btn">Insert pasted JSON</button>',
        '  <button class="iwdie-btn iwdie-secondary" id="iwdie_cancel_btn">Cancel</button>',
        '</div>'
      ].join('\n');
      importOverlay.appendChild(panel);
      document.body.appendChild(importOverlay);
      document.addEventListener('keydown', onPanelKeydown, true);

      importOverlay.addEventListener('mousedown', function (ev) { if (ev.target === importOverlay) closeImportPanel(); });
      panel.querySelector('#iwdie_cancel_btn').addEventListener('click', closeImportPanel);
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
      catch (e) { showErrors(['Not valid JSON: ' + e.message]); return; }
      applyImport(parsed);
    }

    function showErrors(errors, warnings) {
      var panel = importOverlay ? importOverlay.querySelector('.iwdie-panel') : null;
      var msg = 'Import blocked:\n• ' + errors.join('\n• ');
      if (panel) {
        var old = panel.querySelector('.iwdie-errlist');
        if (old) old.remove();
        var div = document.createElement('div');
        div.className = 'iwdie-errlist';
        div.innerHTML = '<b>Import blocked — nothing was changed:</b><ul>' +
          errors.map(function (e) { return '<li>' + e.replace(/</g, '&lt;') + '</li>'; }).join('') + '</ul>' +
          (warnings && warnings.length ? '<i>Warnings:</i><ul>' + warnings.map(function (w) { return '<li>' + w.replace(/</g, '&lt;') + '</li>'; }).join('') + '</ul>' : '');
        panel.appendChild(div);
      } else {
        toast(msg, true, 9000);
      }
    }

    /* ---------- apply (append) ---------- */
    function canvasObjectCount() {
      var cc = document.getElementById('control_container');
      if (!cc) return 0;
      var n = 0;
      for (var i = 0; i < cc.children.length; i++) {
        var nm = cc.children[i].getAttribute('name') || '';
        if (/^object_\d+$/.test(nm) || /^objects_container/.test(nm)) n++;
      }
      return n;
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

    function applyImport(parsed) {
      readPendingBackground(function (bg) { applyImportCore(parsed, bg); });
    }

    function applyImportCore(parsed, pendingBg) {
      var res = iwdieParsePayload(parsed);
      if (res.errors) { showErrors(res.errors); return; }
      var v = iwdieValidateDoc(res.doc);
      if (v.errors.length) { showErrors(v.errors, v.warnings); return; }
      if (!hostReady()) { showErrors(['IWMAC Designer host functions are not available (page not fully loaded?).']); return; }

      var doc = iwdieNormalizeDoc(res.doc);
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
      var target = currentPlantId();
      var source = iwdieDetectSourcePlant(doc);
      var rebindNote = '';

      if (source && target && source !== target) {
        var n = iwdieCountRebindable(doc, source);
        if (n > 0 && window.confirm('This panel comes from plant ' + source + ' — you are on plant ' + target + '.\n\nRewrite ' + n + ' driver id' + (n === 1 ? '' : 's') + ' from "' + source + '_…" to "' + target + '_…"?\n\n(OK = rewrite so objects can link to this plant’s drivers. Cancel = keep original ids.)')) {
          var rb = iwdieRebindDriverIds(doc, source, target);
          doc = rb.doc;
          rebindNote = ', ' + rb.rebound + ' driver ids rebound ' + source + '→' + target;
        }
      }
      var foreign = iwdieListForeignDriverIds(doc, target);

      // background: only touch it if the import carries one
      var appliedBg = false;
      if (doc.converted === 'true' && doc.image_data) {
        var hasBg = false;
        try { hasBg = (W.$('#main_image').css('background-image') || 'none') !== 'none'; } catch (e) {}
        if (!hasBg || window.confirm('Also replace the panel background image with the one embedded in the file?')) {
          try {
            W.iw_set_base_image(doc.panel_width, doc.panel_height, doc.image_data);
            if (doc.org_image_name) { W.$('#main_image').attr('org_image_name', doc.org_image_name); }
            appliedBg = true;
          } catch (e) { toast('Background could not be applied: ' + e, true); }
        }
      }

      // append via the host's own loaders (the templates insert path)
      var before = canvasObjectCount();
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
      var added = canvasObjectCount() - before;
      var msg = 'Inserted ' + iwdieSummarize(doc) + rebindNote +
        (appliedBg ? ', background applied' : '') +
        (skippedGraphics ? ', ' + skippedGraphics + ' graphics skipped (canvas already has graphics)' : '') +
        '.\nNothing is saved yet — use the designer’s own Save buttons when happy.';
      if (foreign.length) {
        msg += '\n⚠ ' + foreign.length + ' object(s) still reference drivers from another plant and will not link here.';
      }
      toast(msg, foreign.length > 0, 9000);
    }

    /* ---------- console surface + install ---------- */
    W.__IWDIE = {
      version: IWDIE_VERSION,
      doExport: doExport,
      doCopyJson: doCopyJson,
      openImportPanel: openImportPanel,
      applyImport: applyImport,
      doExportBackgroundAi: doExportBackgroundAi,
      _collect: collectCurrentDoc
    };

    var installTimer = setInterval(function () {
      if (!document.getElementById('manager_widget7')) return;
      ensureFieldset();
      updateCompact();
    }, 800);
    // keep the interval running forever (cheap) so the fieldset survives any
    // host re-render of the sidebar; ensureFieldset() is idempotent and
    // updateCompact() re-evaluates after zooms/window changes too.
    try { window.addEventListener('resize', updateCompact); } catch (e) {}
    ensureFieldset();
    updateCompact();
  })();
}

/* ===================== Node test surface ===================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IWDIE_VERSION: IWDIE_VERSION,
    IWDIE_FORMAT: IWDIE_FORMAT,
    IWDIE_DOC_KEYS: IWDIE_DOC_KEYS,
    buildEnvelope: iwdieBuildEnvelope,
    parsePayload: iwdieParsePayload,
    validateDoc: iwdieValidateDoc,
    normalizeDoc: iwdieNormalizeDoc,
    attachBackground: iwdieAttachBackground,
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
    isSvgBackground: iwdieIsSvgBackground,
    buildImagePdf: iwdieBuildImagePdf,
    buildBackgroundFilename: iwdieBuildBackgroundFilename,
    buildPalette: iwdieBuildPalette,
    tracer: IWDIE_TRACER
  };
}
