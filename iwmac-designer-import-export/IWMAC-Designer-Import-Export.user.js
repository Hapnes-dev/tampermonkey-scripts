// ==UserScript==
// @name         IWMAC Designer Import/Export
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.3.1
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

var IWDIE_VERSION = '1.3.1';
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
      '#manager_widget_iwdie fieldset{margin-top:4px}',
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
      /* 2x2 grid keeps the fieldset two button-rows tall — four stacked
         btn_full rows made the whole manager sidebar overflow into a
         scrollbar on 1280-class windows. */
      var half = "class='btn_full ui-button ui-corner-all' style='width:49%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'";
      var html = [
        "<div id='manager_widget_iwdie'>",
        '  <fieldset>',
        '    <legend>Panel JSON</legend>',
        "    <div style='display:flex;gap:2%'>",
        "      <button id='iwdie_export_btn' " + half + " onclick=\"window.__IWDIE.doExport()\">Export JSON</button>",
        "      <button id='iwdie_copy_btn' " + half + " onclick=\"window.__IWDIE.doCopyJson()\">Copy JSON</button>",
        '    </div>',
        "    <div style='display:flex;gap:2%'>",
        "      <button id='iwdie_import_btn' " + half + " onclick=\"window.__IWDIE.openImportPanel()\">Insert JSON…</button>",
        "      <button id='iwdie_ai_btn' " + half + " title='Background → Adobe Illustrator (.ai / .svg)' onclick=\"window.__IWDIE.doExportBackgroundAi()\">BG → .ai</button>",
        '    </div>',
        '  </fieldset>',
        '</div>'].join('\n');
      w7.insertAdjacentHTML('afterend', html);
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

    function doExport() {
      buildEnvelopeAsync().then(function (env) {
        if (!env) return;
        var name = iwdieBuildExportFilename(env.source_plant_id, env.panel_name);
        var blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        hostOk('Exported ' + iwdieSummarize(env.panel) + (env.background_embedded ? ' + background' : '') + ' → ' + name);
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

      /* Raster background: rebuild as a single-page PDF named .ai —
         Illustrator opens it as an artboard (panel-sized) with the image. */
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
    }, 800);
    // keep the interval running forever (cheap) so the fieldset survives any
    // host re-render of the sidebar; ensureFieldset() is idempotent.
    ensureFieldset();
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
    buildBackgroundFilename: iwdieBuildBackgroundFilename
  };
}
