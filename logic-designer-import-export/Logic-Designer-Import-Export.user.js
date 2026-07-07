// ==UserScript==
// @name         Logic Designer Import/Export
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.1.0
// @description  Export the current VV Designer sketch to a JSON file and import it on another plant (with driver-id plant rebinding) — adds Export/Import entries to the File menu.
// @author       hapnes-dev
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-import-export/Logic-Designer-Import-Export.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-import-export/Logic-Designer-Import-Export.user.js
// @match        http://internal.iwmac.local/vv_fbx.qxs*
// @match        https://internal.iwmac.local/vv_fbx.qxs*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_addStyle
// ==/UserScript==

// ─── Pure helpers (top-level so Node tests can reach them) ──────────

// Wrap a paper.save() document in a portable export envelope.
function buildExportEnvelope({ sketch, sourcePlantId, sketchId, sketchName }) {
  return {
    format: 'vv-fbx-sketch',
    version: 1,
    exported_at: new Date().toISOString(),
    source_plant_id: sourcePlantId != null ? String(sourcePlantId) : null,
    source_sketch_id: sketchId != null ? String(sketchId) : null,
    name: sketchName || null,
    block_count: sketch.blocks.length,
    connection_count: sketch.connections.length,
    sketch: sketch,
  };
}

// Accept either the envelope or a bare paper.save() document.
// Returns { ok, sketch, envelope|null, error }.
function parseImportPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Not a JSON object.' };
  }
  var doc = null;
  var envelope = null;
  if (parsed.format === 'vv-fbx-sketch' && parsed.sketch) {
    envelope = parsed;
    doc = parsed.sketch;
  } else if (Array.isArray(parsed.blocks) && Array.isArray(parsed.connections)) {
    doc = parsed; // bare sketch document
  } else {
    return { ok: false, error: 'Unrecognized file — expected a VV sketch export or a raw sketch document.' };
  }
  if (!Array.isArray(doc.blocks) || !Array.isArray(doc.connections) || typeof doc.mode !== 'string') {
    return { ok: false, error: 'Sketch document is malformed (mode/blocks/connections missing).' };
  }
  return { ok: true, sketch: doc, envelope: envelope, error: null };
}

// Detect the plant prefix used by parameter bindings in a sketch document.
// Driver ids look like "3111_IWT_IWT_1_1_0_BAT_0" — the leading digits are the plant id.
function detectSourcePlantFromDriverIds(sketch) {
  for (var i = 0; i < sketch.blocks.length; i++) {
    var data = sketch.blocks[i].data;
    if (!data) continue;
    var ids = Array.isArray(data.driver_ids) ? data.driver_ids
      : (typeof data.driver_id === 'string' ? [data.driver_id] : []);
    for (var k = 0; k < ids.length; k++) {
      var m = /^(\d+)_/.exec(String(ids[k]));
      if (m) return m[1];
    }
  }
  return null;
}

// Count how many driver-id strings carry the given plant prefix.
function countRebindableDriverIds(sketch, fromPlant) {
  var prefix = fromPlant + '_';
  var count = 0;
  for (var i = 0; i < sketch.blocks.length; i++) {
    var data = sketch.blocks[i].data;
    if (!data) continue;
    if (Array.isArray(data.driver_ids)) {
      for (var k = 0; k < data.driver_ids.length; k++) {
        if (String(data.driver_ids[k]).indexOf(prefix) === 0) count++;
      }
    }
    if (typeof data.driver_id === 'string' && data.driver_id.indexOf(prefix) === 0) count++;
  }
  return count;
}

// Rewrite "<fromPlant>_…" driver ids to "<toPlant>_…" on a DEEP COPY of the
// sketch. Only touches the known binding fields (data.driver_ids[] and the
// legacy data.driver_id string) — nothing else is modified.
// Returns { sketch, rewritten }.
function rebindDriverIds(sketchIn, fromPlant, toPlant) {
  var sketch = JSON.parse(JSON.stringify(sketchIn));
  var prefix = fromPlant + '_';
  var rewritten = 0;
  for (var i = 0; i < sketch.blocks.length; i++) {
    var data = sketch.blocks[i].data;
    if (!data) continue;
    if (Array.isArray(data.driver_ids)) {
      for (var k = 0; k < data.driver_ids.length; k++) {
        var id = String(data.driver_ids[k]);
        if (id.indexOf(prefix) === 0) {
          data.driver_ids[k] = toPlant + '_' + id.slice(prefix.length);
          rewritten++;
        }
      }
    }
    if (typeof data.driver_id === 'string' && data.driver_id.indexOf(prefix) === 0) {
      data.driver_id = toPlant + '_' + data.driver_id.slice(prefix.length);
      rewritten++;
    }
  }
  return { sketch: sketch, rewritten: rewritten };
}

// List block types in the sketch whose bindings cannot be auto-rebound across
// plants (the user must reconfigure them via the host dialogs after import).
function listManualRebindWarnings(sketch) {
  var warnings = [];
  var calendars = 0, tagvalues = 0;
  for (var i = 0; i < sketch.blocks.length; i++) {
    var b = sketch.blocks[i];
    if ((b.type === 'CALENDAR' || b.type === 'CALENDAR_2_0') && b.data) calendars++;
    if (b.type === 'TAGVALUE' && b.data) tagvalues++;
  }
  if (calendars > 0) warnings.push(calendars + ' Calendar block(s) reference source-plant calendar ids');
  if (tagvalues > 0) warnings.push(tagvalues + ' Tag value block(s) carry source-plant unit bindings');
  return warnings;
}

// Block types present in the document but unknown to the target designer's
// palette (typically processes from a library not loaded on this plant).
function listUnknownBlockTypes(sketch, knownTypes) {
  var missing = {};
  for (var i = 0; i < sketch.blocks.length; i++) {
    var t = sketch.blocks[i].type;
    if (!(t in knownTypes)) missing[t] = true;
  }
  return Object.keys(missing);
}

// Build a safe filename for the export download.
function buildExportFilename(plantId, sketchName) {
  var safe = String(sketchName || 'canvas').replace(/[^a-z0-9_\-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'canvas';
  var d = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  return 'vv-sketch_' + (plantId || 'plant') + '_' + safe + '_' + stamp + '.json';
}

// Skip the browser-only body when loaded under Node for tests.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    'use strict';

    var SCRIPT_NAME = 'Logic Designer Import/Export';
    var VERSION = '1.1.0';
    var LOAD_FLAG = '__LDIO_LOADED';
    var W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : null) || window;
    if (W[LOAD_FLAG]) return;
    W[LOAD_FLAG] = true;

    // ─── Styles (GM_addStyle when sandboxed; <style> fallback otherwise) ──
    var CSS = '\
      .ldio-toast { position: fixed; bottom: 16px; right: 16px; z-index: 100000;\
        padding: 8px 12px; background: rgba(30,30,30,0.92); color: #fff;\
        font: 12px/1.3 sans-serif; border-radius: 4px;\
        box-shadow: 0 2px 8px rgba(0,0,0,0.3); pointer-events: none; }\
      .ldio-toast-error { background: rgba(140,30,30,0.92); }\
      .ldio-overlay { position: fixed; inset: 0; z-index: 99998;\
        background: rgba(0,0,0,0.35); }\
      .ldio-panel { position: fixed; top: 15%; left: 50%; transform: translateX(-50%);\
        z-index: 99999; width: 460px; max-width: 92vw; padding: 14px;\
        background: rgba(25,25,25,0.97); color: #d4d4d4; border-radius: 8px;\
        border: 1px solid rgba(255,255,255,0.14);\
        box-shadow: 0 8px 28px rgba(0,0,0,0.55);\
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\
      .ldio-panel h3 { margin: 0 0 10px 0; font-size: 14px; color: #fff; }\
      .ldio-file-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }\
      .ldio-file-row input[type=file] { flex: 1; color: #d4d4d4; font-size: 12px; }\
      .ldio-drop { border: 2px dashed rgba(255,255,255,0.25); border-radius: 6px;\
        padding: 14px; text-align: center; color: #9a9a9a; margin-bottom: 10px; }\
      .ldio-drop.ldio-drop-hot { border-color: #ffa500; color: #ffa500; background: rgba(255,165,0,0.06); }\
      .ldio-panel textarea { width: 100%; box-sizing: border-box; height: 84px;\
        background: #1e1e1e; color: #d4d4d4; border: 1px solid rgba(255,255,255,0.15);\
        border-radius: 4px; padding: 6px 8px; font: 11px/1.4 monospace; resize: vertical; }\
      .ldio-btn-row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }\
      .ldio-btn { background: #2a2a2a; color: #d4d4d4; border: 1px solid rgba(255,255,255,0.15);\
        border-radius: 4px; padding: 6px 14px; font-size: 12px; cursor: pointer; }\
      .ldio-btn:hover { background: #383838; }\
      .ldio-btn-primary { background: #2c5d8e; border-color: #3d7ab3; }\
      .ldio-btn-primary:hover { background: #357ab8; }\
      .ldio-version { opacity: 0.45; font-size: 10px; }\
    ';
    if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); }
    else { var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

    // ─── Toast ──────────────────────────────────────────────────────
    function toast(message, kind) {
      var el = document.createElement('div');
      el.textContent = message;
      el.className = 'ldio-toast' + (kind === 'error' ? ' ldio-toast-error' : '');
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 4500);
    }

    // ─── Export ─────────────────────────────────────────────────────
    function doExport() {
      try {
        var paper = W.logic_designer && W.logic_designer.paper;
        if (!paper) { toast('Designer not ready.', 'error'); return; }
        var blockCount = Object.keys(paper.elements || {}).filter(function (k) { return /^\d+$/.test(k); }).length;
        if (blockCount === 0) { toast('Canvas is empty — nothing to export.'); return; }

        // paper.save() clears the dirty flag as a side effect — preserve it.
        var wasChanged = paper.changed;
        var sketch = paper.save();
        paper.changed = wasChanged;

        var plantId = (W.query_string && W.query_string.plant_id) || null;
        var envelope = buildExportEnvelope({
          sketch: sketch,
          sourcePlantId: plantId,
          sketchId: W.application ? W.application.current_sketch : null,
          sketchName: W.application ? W.application.current_sketch_name : null,
        });

        var blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = buildExportFilename(plantId, envelope.name);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        toast('Exported ' + envelope.block_count + ' blocks / ' + envelope.connection_count + ' wires → ' + a.download);
      } catch (err) {
        console.error('[' + SCRIPT_NAME + '] export failed:', err);
        toast('Export failed (see console).', 'error');
      }
    }

    // ─── Import panel ───────────────────────────────────────────────
    // v1.1.0: no programmatic input.click() at all. The menu opens a panel
    // holding a VISIBLE file input — the user's own click on it is a direct
    // gesture, so the OS picker always opens (this defeated v1.0.x, where
    // Chrome dropped the transient activation before input.click() ran).
    // The panel also accepts drag-and-drop and pasted JSON.
    var panelEls = null; // { overlay, panel, input, drop, textarea }

    function closeImportPanel() {
      if (!panelEls) return;
      panelEls.overlay.remove();
      panelEls.panel.remove();
      panelEls = null;
      document.removeEventListener('keydown', onPanelKeydown, true);
    }

    function onPanelKeydown(event) {
      if (event.key === 'Escape' && panelEls) {
        event.preventDefault();
        event.stopPropagation();
        closeImportPanel();
      }
    }

    function readFileAndImport(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        closeImportPanel();
        var parsed;
        try { parsed = JSON.parse(String(reader.result)); }
        catch (e) { toast('Not valid JSON: ' + e.message, 'error'); return; }
        applyImport(parsed);
      };
      reader.onerror = function () { toast('Could not read the file.', 'error'); };
      reader.readAsText(file);
    }

    function openImportPanel() {
      if (panelEls) { closeImportPanel(); }

      var overlay = document.createElement('div');
      overlay.className = 'ldio-overlay';
      overlay.addEventListener('click', closeImportPanel);

      var panel = document.createElement('div');
      panel.className = 'ldio-panel';

      var h = document.createElement('h3');
      h.textContent = 'Import sketch (JSON)';
      panel.appendChild(h);

      // 1) Visible file input — a direct user click, always opens the picker.
      var fileRow = document.createElement('div');
      fileRow.className = 'ldio-file-row';
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', function () {
        readFileAndImport(input.files && input.files[0]);
      });
      fileRow.appendChild(input);
      panel.appendChild(fileRow);

      // 2) Drag & drop zone.
      var drop = document.createElement('div');
      drop.className = 'ldio-drop';
      drop.textContent = '…or drop a vv-sketch .json file here';
      drop.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('ldio-drop-hot'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('ldio-drop-hot'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        drop.classList.remove('ldio-drop-hot');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        readFileAndImport(f);
      });
      panel.appendChild(drop);

      // 3) Paste-JSON fallback.
      var textarea = document.createElement('textarea');
      textarea.placeholder = '…or paste the exported JSON here and press Import';
      textarea.spellcheck = false;
      panel.appendChild(textarea);

      var btnRow = document.createElement('div');
      btnRow.className = 'ldio-btn-row';
      var ver = document.createElement('span');
      ver.className = 'ldio-version';
      ver.textContent = 'LDIO v' + VERSION;
      var btns = document.createElement('span');
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ldio-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.marginRight = '6px';
      cancelBtn.addEventListener('click', closeImportPanel);
      var importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'ldio-btn ldio-btn-primary';
      importBtn.textContent = 'Import pasted JSON';
      importBtn.addEventListener('click', function () {
        var text = textarea.value.trim();
        if (!text) { toast('Paste JSON first, or pick a file above.'); return; }
        var parsed;
        try { parsed = JSON.parse(text); }
        catch (e) { toast('Not valid JSON: ' + e.message, 'error'); return; }
        closeImportPanel();
        applyImport(parsed);
      });
      btns.appendChild(cancelBtn);
      btns.appendChild(importBtn);
      btnRow.appendChild(ver);
      btnRow.appendChild(btns);
      panel.appendChild(btnRow);

      document.body.appendChild(overlay);
      document.body.appendChild(panel);
      document.addEventListener('keydown', onPanelKeydown, true);
      panelEls = { overlay: overlay, panel: panel, input: input, drop: drop, textarea: textarea };
    }

    function applyImport(parsed) {
      try {
        var paper = W.logic_designer && W.logic_designer.paper;
        if (!paper || !paper.initialized) { toast('Designer not ready — open/start the application first.', 'error'); return; }

        var res = parseImportPayload(parsed);
        if (!res.ok) { toast(res.error, 'error'); return; }
        var sketch = res.sketch;
        var envelope = res.envelope;

        // Unknown block types (processes missing from this library) degrade badly — ask first.
        var unknown = listUnknownBlockTypes(sketch, paper.blocks || {});
        if (unknown.length > 0) {
          var goOn = confirm('This sketch uses ' + unknown.length + ' block type(s) unknown on this plant/library:\n\n' +
            unknown.join(', ') + '\n\nThey may be processes from a library that is not loaded here. Import anyway?');
          if (!goOn) return;
        }

        // Plant rebinding: rewrite "<src>_" driver-id prefixes to this plant.
        var currentPlant = String((W.query_string && W.query_string.plant_id) || '');
        var sourcePlant = (envelope && envelope.source_plant_id) || detectSourcePlantFromDriverIds(sketch);
        var rebindNote = '';
        if (sourcePlant && currentPlant && String(sourcePlant) !== currentPlant) {
          var n = countRebindableDriverIds(sketch, String(sourcePlant));
          if (n > 0) {
            var doRebind = confirm('Sketch was exported from plant ' + sourcePlant + ' (this is plant ' + currentPlant + ').\n\n' +
              'Rewrite ' + n + ' parameter binding(s) "' + sourcePlant + '_…" → "' + currentPlant + '_…"?\n\n' +
              'OK = rewrite (use when the plants have the same unit layout)\n' +
              'Cancel = keep the original ids (reconfigure blocks manually)');
            if (doRebind) {
              var rb = rebindDriverIds(sketch, String(sourcePlant), currentPlant);
              sketch = rb.sketch;
              rebindNote = ' (' + rb.rewritten + ' bindings rebound to plant ' + currentPlant + ')';
            }
          }
          var warnings = listManualRebindWarnings(sketch);
          if (warnings.length > 0) {
            toast('Reconfigure after import: ' + warnings.join('; '), 'error');
          }
        }

        if (paper.changed) {
          if (!confirm('The canvas has unsaved changes. Replace it with the imported sketch?')) return;
        }

        paper.reset();
        paper.load(sketch);
        paper.changed = true; // imported content is unsaved by definition

        // This is NEW content on this plant — make Ctrl+S open the save-as
        // dialog instead of silently overwriting a previously open sketch.
        if (W.application) {
          W.application.current_sketch = null;
          W.application.current_sketch_name = null;
        }

        toast('Imported ' + sketch.blocks.length + ' blocks / ' + sketch.connections.length + ' wires' + rebindNote +
          '. Use File → Save sketch to store it on this plant.');
      } catch (err) {
        console.error('[' + SCRIPT_NAME + '] import failed:', err);
        toast('Import failed (see console).', 'error');
      }
    }

    // ─── Menu integration ───────────────────────────────────────────
    // The host rebuilds the whole menu on every mode change via
    // menu_main.creator.render(true). Patch render permanently: before each
    // render, append our Transfer section to the "file" level if missing.
    // Item ids get the parent prefix, so they surface as
    // "file_ldio_export" / "file_ldio_import".
    var ICON_EXPORT = '<li class="fa fa-fw fa-download" style="font-size:14px"></li>&nbsp;Export sketch (JSON)';
    var ICON_IMPORT = '<li class="fa fa-fw fa-upload" style="font-size:14px"></li>&nbsp;Import sketch (JSON)';

    // Resolve a click target inside the dropdown to one of our item ids.
    function resolveOwnMenuItemId(target) {
      try {
        if (!target || !target.closest) return null;
        var itemEl = target.closest('.iw_oc_menu_dropdown_item');
        if (!itemEl) return null;
        var index = itemEl.getAttribute('data-index');
        var item = W.menu_main && W.menu_main.menu_items ? W.menu_main.menu_items[index] : null;
        if (!item) return null;
        if (item.id === 'file_ldio_export' || item.id === 'file_ldio_import') return item.id;
      } catch (err) { /* fall through */ }
      return null;
    }

    // Capture-phase click handler: keeps export inside the native gesture
    // (nice for the download) and opens the import panel immediately.
    var lastHandledAt = 0;
    function onCaptureClick(event) {
      var id = resolveOwnMenuItemId(event.target);
      if (!id) return;
      lastHandledAt = Date.now();
      if (id === 'file_ldio_import') openImportPanel();
      else if (id === 'file_ldio_export') doExport();
      // Do NOT stop the event — the host's handler still runs and closes the
      // dropdown; our on_menu wrap below swallows the unknown item id.
    }

    function installMenuHooks() {
      var creator = W.menu_main.creator;
      var origRender = creator.render;
      creator.render = function (clear) {
        try {
          var fileLevel = null;
          for (var i = 0; i < this.data.length; i++) {
            if (this.data[i].id === 'file') { fileLevel = this.data[i]; break; }
          }
          if (fileLevel) {
            var present = (fileLevel.sub || []).some(function (s) { return s.id === 'file_ldio_export'; });
            if (!present) {
              this.add_header(fileLevel, 'Transfer');
              this.add(fileLevel, ICON_EXPORT, 'ldio_export');
              this.add(fileLevel, ICON_IMPORT, 'ldio_import');
            }
          }
        } catch (err) {
          console.error('[' + SCRIPT_NAME + '] menu injection failed:', err);
        }
        return origRender.call(this, clear);
      };

      // Fallback: if the capture handler didn't act (markup change, missed
      // event), the panel path still works from here — it needs no gesture.
      var origOnMenu = W.application.on_menu;
      W.application.on_menu = function (event) {
        if (event && (event.item_id === 'file_ldio_export' || event.item_id === 'file_ldio_import')) {
          if (Date.now() - lastHandledAt > 1000) {
            if (event.item_id === 'file_ldio_export') doExport();
            else openImportPanel();
          }
          return;
        }
        return origOnMenu.call(this, event);
      };

      document.addEventListener('click', onCaptureClick, true);

      // Rebuild once so the entries appear without needing a mode switch.
      try {
        if (W.logic_designer && W.logic_designer.paper && W.logic_designer.paper.initialized) {
          W.application.prepare_ui_menu(W.logic_designer.paper.mode);
        }
      } catch (err) { /* menu will pick the items up on the next natural rebuild */ }
    }

    // Wait for the host app to exist (it is created by inline page scripts).
    var installPoll = setInterval(function () {
      if (W.application && W.menu_main && W.menu_main.creator && W.logic_designer) {
        clearInterval(installPoll);
        installMenuHooks();
        console.log('[' + SCRIPT_NAME + '] v' + VERSION + ' installed.');
      }
    }, 300);

    // Expose internals for console debugging / live verification.
    W.__LDIO = { version: VERSION, doExport: doExport, openImportPanel: openImportPanel, applyImport: applyImport };
  })();
}

// ─── Node-only export footer (browser ignores this) ─────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildExportEnvelope: buildExportEnvelope,
    parseImportPayload: parseImportPayload,
    detectSourcePlantFromDriverIds: detectSourcePlantFromDriverIds,
    countRebindableDriverIds: countRebindableDriverIds,
    rebindDriverIds: rebindDriverIds,
    listManualRebindWarnings: listManualRebindWarnings,
    listUnknownBlockTypes: listUnknownBlockTypes,
    buildExportFilename: buildExportFilename,
  };
}
