// ==UserScript==
// @name         Logic Designer Section Copy/Paste
// @namespace    https://logic-designer-section.local
// @version      1.7.0
// @description  Copy/paste selected node subgraphs (with internal wires and variable bindings) in the iwmac logic designer.
// @author       Henrik Monge
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js
// @match        http://internal.iwmac.local/vv_fbx.qxs*
// @match        https://internal.iwmac.local/vv_fbx.qxs*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

// ─── Pure helpers (top-level so Node tests can reach them) ──────────

// Build a JSON-serializable clipboard snapshot from per-node info and
// internal wires (both endpoints in the node set). Pure — no host access.
// Inputs come from the host adapter; outputs are the clipboard format.
function buildSnapshot({ nodes, wires }) {
  const refToLocalId = new Map();
  const outNodes = nodes.map((n, i) => {
    const localId = `n${i}`;
    refToLocalId.set(n.ref, localId);
    const out = {
      localId,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: n.data,
    };
    if (n.unknownType) out.unknownType = true;
    return out;
  });

  const outWires = [];
  for (const w of wires) {
    const fromLocal = refToLocalId.get(w.from?.node);
    const toLocal = refToLocalId.get(w.to?.node);
    if (!fromLocal || !toLocal) continue; // drop wires touching unselected nodes
    outWires.push({
      from: { nodeLocalId: fromLocal, pin: w.from.pin },
      to:   { nodeLocalId: toLocal, pin: w.to.pin },
    });
  }

  return {
    version: 1,
    copiedAt: new Date().toISOString(),
    nodes: outNodes,
    wires: outWires,
  };
}

// Session-scoped LIFO history of undo records. Pure — no host access.
// Records are type-discriminated ({type: 'paste' | 'delete', timestamp, payload})
// but the stack itself is opaque to record contents. Stack survives only the
// current page session (in-memory).
function createUndoHistory() {
  const stack = [];
  return {
    push(record) { stack.push(record); },
    pop() { return stack.length > 0 ? stack.pop() : null; },
    size() { return stack.length; },
    isEmpty() { return stack.length === 0; },
    clear() { stack.length = 0; },
  };
}

// Classifies a block by which pin sides it carries. Pure — no host access.
// Used by the multi-wire marquee observer to infer source/target direction.
function classifyBlockPinDirection(block) {
  const outs = Array.isArray(block?.outputs) ? block.outputs.length : 0;
  const ins = Array.isArray(block?.inputs) ? block.inputs.length : 0;
  if (outs > 0 && ins > 0) return 'bidirectional';
  if (outs > 0) return 'source-only';
  if (ins > 0) return 'target-only';
  return 'none';
}

// Pairs N source pins to M target pins, handling occupied targets and
// optional expansion of expandable-input blocks. Pure — no host access.
//
// Inputs:
//   sources:           pre-sorted-by-y array of {blockRef, pinIndex, side}
//   targetBlockRef:    the destination block's ref
//   targetPins:        array of {connected: bool, pinIndex: number}, sorted by index
//   targetSide:        'input' | 'output' — opposite of sources' side
//   startPin:          array offset into targetPins where pairing begins.
//                      For pin-click, pass the clicked pin's array index;
//                      for block-body, pass 0 (the offset is ignored beyond that).
//   targetIsPinClick:  true = user clicked a specific pin; false = block body
//   expandableMax:     null if not expandable; otherwise max_inputs cap
//
// Returns: { pairs, occupiedToDisconnect, expansionNeeded, unpaired }
//
// Block-body click: skip occupied target pins, advance to next free.
// Pin-click: take pins consecutively starting at startPin; mark occupied for disconnect.
function pairSourcesToTargets({
  sources, targetBlockRef, targetPins, targetSide, startPin, targetIsPinClick, expandableMax,
}) {
  const pairs = [];
  const occupiedToDisconnect = [];
  let expansionNeeded = null;
  let srcIdx = 0;

  // Phase 1: walk existing target pins from startPin onward.
  for (let i = startPin; i < targetPins.length && srcIdx < sources.length; i++) {
    const tp = targetPins[i];
    if (targetIsPinClick) {
      // Pin-click: take consecutive pins, mark occupied ones for disconnect.
      if (tp.connected) {
        occupiedToDisconnect.push({ dstRef: targetBlockRef, dstPin: tp.pinIndex });
      }
      pairs.push({
        srcRef: sources[srcIdx].blockRef,
        srcPin: sources[srcIdx].pinIndex,
        srcSide: sources[srcIdx].side,
        dstRef: targetBlockRef,
        dstPin: tp.pinIndex,
      });
      srcIdx++;
    } else {
      // Block-body: skip occupied pins.
      if (tp.connected) continue;
      pairs.push({
        srcRef: sources[srcIdx].blockRef,
        srcPin: sources[srcIdx].pinIndex,
        srcSide: sources[srcIdx].side,
        dstRef: targetBlockRef,
        dstPin: tp.pinIndex,
      });
      srcIdx++;
    }
  }

  // Phase 2: expansion (input side only).
  const remaining = sources.length - srcIdx;
  if (remaining > 0 && expandableMax !== null && targetSide === 'input' && targetPins.length < expandableMax) {
    const expansionCount = Math.min(remaining, expandableMax - targetPins.length);
    const newCount = targetPins.length + expansionCount;
    expansionNeeded = { newCount };
    // Add pairs for the new pin indices.
    for (let k = 0; k < expansionCount; k++) {
      const newPinIndex = targetPins.length + k;
      pairs.push({
        srcRef: sources[srcIdx].blockRef,
        srcPin: sources[srcIdx].pinIndex,
        srcSide: sources[srcIdx].side,
        dstRef: targetBlockRef,
        dstPin: newPinIndex,
      });
      srcIdx++;
    }
  }

  const unpaired = sources.length - srcIdx;
  return { pairs, occupiedToDisconnect, expansionNeeded, unpaired };
}

// Distributes N sources across M targets, 1-to-1 sliced by visual y.
// Pure — no host access.
//
// Inputs:
//   sources: array of {blockRef, pinIndex, side, y}, sorted by y
//   targets: array of {blockRef, pinCount, y, ...other-fields-passed-through}
//
// Returns: { slices, unassigned }
//   slices: array of {target, sources: [sliceOfSources]}, in target order
//   unassigned: count of leftover sources (shouldn't occur in typical use, but
//               returned defensively for callers that pass mismatched counts)
//
// Distribution rule: floor(N/M) per target, first (N mod M) targets get +1.
// Equal distribution; per-target capacity NOT considered here — that's the
// caller's responsibility (call site checks capacity BEFORE invoking).
function distributeSourcesAcrossTargets({ sources, targets }) {
  if (targets.length === 0) {
    return { slices: [], unassigned: sources.length };
  }
  const sortedSources = [...sources].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const sortedTargets = [...targets].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const n = sortedSources.length;
  const m = sortedTargets.length;
  const base = Math.floor(n / m);
  const remainder = n % m;

  const slices = [];
  let cursor = 0;
  for (let i = 0; i < m; i++) {
    const sliceSize = base + (i < remainder ? 1 : 0);
    slices.push({
      target: sortedTargets[i],
      sources: sortedSources.slice(cursor, cursor + sliceSize),
    });
    cursor += sliceSize;
  }
  return { slices, unassigned: 0 };
}

// ─── Sketch quick-open pure helpers (Node-testable) ────────────────

// Resolve a project row's visible name to its project id, given a
// load_project_list() result ([{id, name}]). Exact (trimmed) match first,
// then case-insensitive. Returns the id string, or null if unresolved.
function matchProjectId(rowName, projects) {
  if (!Array.isArray(projects) || projects.length === 0) return null;
  const name = String(rowName == null ? '' : rowName).trim();
  if (!name) return null;
  for (const p of projects) {
    if (p && String(p.name).trim() === name) return String(p.id);
  }
  const lower = name.toLowerCase();
  for (const p of projects) {
    if (p && String(p.name).trim().toLowerCase() === lower) return String(p.id);
  }
  return null;
}

// Build display fields for one sketch list entry. Pure: maps a sketch
// metadata object {id, name, date, compile_date} to display strings.
// `changed` = last changed (date), `deployed` = last deployed (compile_date).
// "Saved by" is NOT available from load_sketch_list (only after a full
// load_sketch), so it's intentionally omitted from the browse view.
function formatSketchEntry(sketch) {
  const s = sketch || {};
  const name = String(s.name == null ? '' : s.name).trim() || '(untitled)';
  const changed = String(s.date == null ? '' : s.date).trim() || '—';
  const deployed = String(s.compile_date == null ? '' : s.compile_date).trim() || '—';
  return { id: String(s.id), name, changed, deployed };
}

// Idempotency predicate for dialog re-open: the "Get started!" window is
// hidden+reused (not rebuilt), so rows reappear. The DOM code stamps a
// processed row with el.dataset.ldscpSqo = '1'. Returns true when already
// stamped, so we don't inject a second arrow.
function isRowProcessed(markerValue) {
  return typeof markerValue === 'string' && markerValue.length > 0;
}

// Parse a host alarm-row string into its parts. Format:
//   VV_<proj>_<sketch>:<pointer>:<line>   e.g. "VV_1021_3445:41:1"
// `pointer` matches paper.elements[ref].pointer (the canvas "(NN)" label).
// Pure — used by both the Node tests and the AlarmHighlight module.
function parseAlarmToken(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/VV_(\d+)_(\d+):(\d+):(\d+)/);
  if (!m) return null;
  return { proj: Number(m[1]), sketch: Number(m[2]), pointer: Number(m[3]), line: Number(m[4]) };
}

// Distinct block pointers from a list of parsed alarms, first-seen order.
// Drives the "Errors: N" pill count and flashAll(). Pure.
function distinctPointers(alarms) {
  if (!Array.isArray(alarms)) return [];
  const seen = [];
  for (const a of alarms) {
    if (a && typeof a.pointer === 'number' && !seen.includes(a.pointer)) {
      seen.push(a.pointer);
    }
  }
  return seen;
}

// Skip the browser-only body when loaded under Node for tests.
// Without this guard, the IIFE's references to unsafeWindow / GM_*
// would throw the moment Node `require()`s this file for pure-helper tests.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    'use strict';

    // ─── User-editable keyboard shortcuts ──────────────────────────
    // Each shortcut: { key: 'w' (single lowercase char), label: 'Shift+W' (menu display) }.
    // MULTIWIRE / REMOVE are Shift-only chords. PASTE_PLACE is a Ctrl chord.
    // To rebind, change both `key` and `label` so the keyboard handler AND the
    // menu entry stay in sync. PASTE_PLACE additionally has `ctrl: true` so the
    // handler knows to treat it as a Ctrl chord rather than a Shift chord.
    const SHORTCUTS = {
      MULTIWIRE:   { key: 'f', label: 'Shift+F' },
      REMOVE:      { key: 'd', label: 'Shift+D' },
      PASTE_PLACE: { key: 'b', label: 'Ctrl+B', ctrl: true },
    };

    // ═══════════════════════════════════════════════════════════════
    //  Constants & duplicate-load guard
    // ═══════════════════════════════════════════════════════════════

    const SCRIPT_NAME = 'Logic Designer Section Copy/Paste';
    const VERSION = '1.7.0';
    const LOAD_FLAG = '__LDSCP_LOADED';
    const STORE_KEY = 'ldscp:clipboard:v1';
    const PASTE_OFFSET = { x: 40, y: 40 };
    const undoHistory = createUndoHistory();

    const W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : null) || window;

    if (W[LOAD_FLAG]) return;
    W[LOAD_FLAG] = true;

    // ─── Cursor tracker (used by GhostPasteMode entry + copy anchor) ──
    // Updated by a passive document mousemove listener installed at bootstrap.
    // `lastCursorClient` is null until the user moves the mouse at least once.
    let lastCursorClient = null;
    // Refs that were selected at the most recent doCopy() — used by
    // GhostPasteMode.buildOverlay to find the live host elements to clone.
    // Not persisted — reset on reload, set on every copy. Null until first copy.
    let latestSelectionRefs = null;

    function installCursorTracker() {
      document.addEventListener('mousemove', (event) => {
        lastCursorClient = { x: event.clientX, y: event.clientY };
      }, { capture: true, passive: true });
    }

    // Project a clientX/clientY pair into the host's SVG world coordinates.
    // Returns null if the host SVG is not reachable or the conversion fails.
    // Used by doCopy (to record cursorAnchor) and by GhostPasteMode (per mousemove).
    function clientToSvgWorld(clientPt) {
      if (!clientPt) return null;
      try {
        const paper = W.logic_designer?.paper;
        const elements = paper?.elements;
        if (!elements) return null;
        // Find any element's owner SVG. Raphael shapes all share the same root.
        let svg = null;
        for (const key of Object.keys(elements)) {
          const node = elements[key]?.set?.items?.[0]?.node;
          if (node?.ownerSVGElement) { svg = node.ownerSVGElement; break; }
        }
        if (!svg || typeof svg.createSVGPoint !== 'function') return null;
        const pt = svg.createSVGPoint();
        pt.x = clientPt.x;
        pt.y = clientPt.y;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const w = pt.matrixTransform(ctm.inverse());
        return { x: w.x, y: w.y };
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] clientToSvgWorld failed:`, err);
        return null;
      }
    }

    // Inline monochrome SVG icons (Lucide-style). No network fetches.
    const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    const PASTE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>';
    // Three-dots menu icon for the launcher button.
    const MENU_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>';
    // Curved arrow pointing left ("undo"). Lucide-style.
    const UNDO_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path></svg>';
    // Three lines converging ("git-merge"-ish). Multi-wire mode icon.
    const MULTIWIRE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 9v3a6 6 0 0 0 6 6h3"></path></svg>';
    // Scissors / "remove connector" icon.
    const REMOVE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>';
    // Tag/label icon for the Paste tags menu entry.
    const TAG_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';

    // ═══════════════════════════════════════════════════════════════
    //  Host adapter — ONLY module that touches unsafeWindow / host.
    //  Implementations follow SPIKE.md. Read-side only in this task;
    //  write-side comes in Task 7.
    // ═══════════════════════════════════════════════════════════════

    const HostAdapter = (() => {
      function getDesigner() {
        const ld = W.logic_designer;
        if (!ld || !ld.paper) {
          throw new Error('[LDSCP] logic_designer.paper not available; is this the right page?');
        }
        return ld;
      }

      function getPaper() {
        return getDesigner().paper;
      }

      // A "real" canvas element key is numeric; string keys are user-block templates.
      function isNumericKey(k) {
        return /^\d+$/.test(String(k));
      }

      function getSelection() {
        const paper = getPaper();
        // Marquee selection yields string keys ('12'); Ctrl-click yields numbers (12).
        // Normalize to numbers so the rest of the adapter doesn't have to handle both.
        const sel = Array.from(paper.selected_blocks || [])
          .filter((ref) => isNumericKey(ref))
          .map(Number)
          .filter((ref) => paper.elements[ref] != null);
        return sel;
      }

      function getNodeType(ref) {
        const paper = getPaper();
        try { return paper.get_block_type(ref); }
        catch { return paper.elements[ref]?.block_type ?? null; }
      }

      function getNodePosition(ref) {
        const el = getPaper().elements[ref];
        const main = el?.set?.items?.[0];
        if (!main) return { x: 0, y: 0 };
        // Raphael stores the on-canvas position in the SVG transform matrix.
        // `matrix.e` / `matrix.f` are the translation x / y. The `_` helper
        // exposes the same values as `dx` / `dy` and is the most stable
        // accessor across Raphael versions.
        const aux = main._;
        if (aux && typeof aux.dx === 'number' && typeof aux.dy === 'number') {
          return { x: aux.dx, y: aux.dy };
        }
        const m = main.matrix;
        if (m && typeof m.e === 'number' && typeof m.f === 'number') {
          return { x: m.e, y: m.f };
        }
        // Local-attribute fallbacks (unlikely to fire but cheap to keep).
        const a = main.attrs;
        if (a) {
          if (typeof a.x === 'number' && typeof a.y === 'number') return { x: a.x, y: a.y };
          if (Array.isArray(a.path) && Array.isArray(a.path[0]) && a.path[0].length >= 3) {
            return { x: a.path[0][1] || 0, y: a.path[0][2] || 0 };
          }
        }
        return { x: 0, y: 0 };
      }

      function getNodeData(ref) {
        const paper = getPaper();
        const el = paper.elements[ref];
        const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
        return {
          type: safe(() => paper.get_block_type(ref), el?.block_type),
          func: safe(() => paper.get_block_func(ref), el?.func),
          compile_type: safe(() => paper.get_block_compile_type(ref), el?.compile_type),
          data: safe(() => paper.get_block_data(ref), el?.data),
          override: (() => {
            // get_block_override often returns null even when the element has
            // {alias_text: "..."}. Prefer the raw element override when present.
            try {
              const fromGetter = paper.get_block_override(ref);
              if (fromGetter && fromGetter.alias_text) return fromGetter;
            } catch { /* fall through */ }
            return el?.override || null;
          })(),
          config: safe(() => paper.get_block_config(ref), el?.config),
          properties: safe(() => paper.get_block_properties(ref), el?.properties),
          runtime: safe(() => paper.get_block_runtime(ref), el?.runtime),
          inputs: safe(() => paper.get_block_inputs(ref), el?.inputs),
          outputs: safe(() => paper.get_block_outputs(ref), el?.outputs),
        };
      }

      function getInternalWires(refs) {
        // Walk each selected destination block's inputs[]. Each connected input
        // points back at its source via inputs[i].connected_to = {ref, put_id}.
        // The destination pin index is the array index `i`. paper.connections
        // entries don't carry usable pin info from script, so we use the
        // per-block inputs array instead (verified via live probe).
        const paper = getPaper();
        const refSet = new Set(refs);
        const out = [];

        for (const toRef of refs) {
          const el = paper.elements[toRef];
          const inputs = el?.inputs;
          if (!Array.isArray(inputs)) continue;

          for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const inp = inputs[inputIndex];
            if (!inp || !inp.connected) continue;
            const ct = inp.connected_to;
            if (!ct) continue;

            const fromRef = ct.ref;
            const fromPin = typeof ct.put_id === 'number' ? ct.put_id : 0;
            if (typeof fromRef !== 'number') continue;
            if (!refSet.has(fromRef)) continue; // skip wires from outside the selection

            out.push({
              from: { node: fromRef, pin: fromPin },
              to:   { node: toRef, pin: inputIndex },
            });
          }
        }
        return out;
      }

      function getWiresTouchingNodes(refs) {
        // Returns every wire where at least ONE endpoint is in `refs` (vs
        // getInternalWires which requires BOTH endpoints to be in `refs`).
        // Used by the delete-interceptor to capture the full wire context
        // around blocks that are about to be deleted.
        //
        // Scans ALL canvas blocks: a wire from a deleted block to a
        // surviving block is recorded on the surviving block's inputs[]
        // array, so we have to look at the surviving block to find it.
        const paper = getPaper();
        const refSet = new Set(refs);
        const out = [];

        for (const [key, el] of Object.entries(paper.elements)) {
          if (!/^\d+$/.test(key)) continue;
          const toRef = Number(key);
          const inputs = el?.inputs;
          if (!Array.isArray(inputs)) continue;

          for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const inp = inputs[inputIndex];
            if (!inp || !inp.connected) continue;
            const ct = inp.connected_to;
            if (!ct || typeof ct.ref !== 'number') continue;

            const fromRef = ct.ref;
            const fromPin = typeof ct.put_id === 'number' ? ct.put_id : 0;

            // Keep the wire if EITHER endpoint is in refs.
            if (!refSet.has(fromRef) && !refSet.has(toRef)) continue;

            out.push({
              from: { node: fromRef, pin: fromPin },
              to:   { node: toRef, pin: inputIndex },
            });
          }
        }
        return out;
      }

      function nextRefId() {
        const paper = getPaper();
        // The host uses paper.element_pointer as the monotonic next-id counter.
        // Verified during the spike: was 23 on a 22-element canvas; matches `paper.parsed_elements`
        // length plus a small buffer. Fall back to max-of-keys + 1 if the counter is missing.
        if (typeof paper.element_pointer === 'number' && Number.isFinite(paper.element_pointer)) {
          return paper.element_pointer;
        }
        const numericKeys = Object.keys(paper.elements || {})
          .filter((k) => /^\d+$/.test(k))
          .map(Number);
        return numericKeys.length > 0 ? Math.max(...numericKeys) + 1 : 0;
      }

      function bumpRefCounter(usedRef) {
        // Manually advance paper.element_pointer past the ref we just consumed so
        // future host actions don't collide with our new nodes.
        const paper = getPaper();
        if (typeof paper.element_pointer === 'number' && paper.element_pointer <= usedRef) {
          paper.element_pointer = usedRef + 1;
        }
      }

      function createNode({ type, position, payload }) {
        // payload is the host-adapter-shaped node data from the snapshot:
        // { type, func, compile_type, data, override, config, properties, runtime, inputs, outputs }
        // Returns the new host ref (number). Throws on host failure.
        const paper = getPaper();
        const ref = nextRefId();

        // Step 1: __render_block(type, x, y, ref, override, properties)
        // override is {alias_text}; null is acceptable but the host expects an object,
        // so pass `{}` if null.
        const override = payload.override || {};
        const properties = payload.properties != null ? payload.properties : [];
        paper.__render_block(type, position.x, position.y, ref, override, properties);

        // Step 2: set_block_func
        if (payload.func != null) paper.set_block_func(ref, payload.func);

        // Step 3: set_block_data
        if (payload.data != null) paper.set_block_data(ref, payload.data);

        bumpRefCounter(ref);
        return ref;
      }

      function createWire({ fromNode, fromPin, toNode, toPin }) {
        // From SPIKE.md: paper.__connect({id, put}, {id, put}, manual: boolean)
        const paper = getPaper();
        paper.__connect({ id: fromNode, put: fromPin }, { id: toNode, put: toPin }, true);
      }

      function setSelection(refs) {
        // The host's __select_block requires a real mouse event, so we can't
        // call it from script. Instead, set paper.selected_blocks directly —
        // this is the same array the marquee path populates.
        const paper = getPaper();
        try {
          paper.selected_blocks = Array.from(refs);
        } catch (err) {
          console.warn('[LDSCP] setSelection failed (non-fatal):', err);
        }
      }

      function deleteNode(ref) {
        // Strategy 2 (verified live): temporarily set selection, call
        // __delete_selected, restore selection.
        // Strategy 1 (__delete_block_connection) failed during the spike with
        // a TypeError — it expects a connection object, not a block ref.
        const paper = getPaper();
        const restore = Array.from(paper.selected_blocks || []);
        paper.selected_blocks = [ref];
        try {
          paper.__delete_selected();
        } finally {
          paper.selected_blocks = restore.filter((r) => r !== ref);
        }
      }

      function disconnectWire({ toNode, toPin }) {
        // Verified live (see probe1–probe4): the host's true disconnect API is
        // a pair, not a single call. __disconnect_output takes the source output
        // object plus the put_connection index and removes the visual line and
        // source-side state; __disconnect_input clears the target input state
        // (host does not touch the input from the output-side call).
        //
        // Contract: idempotent. If the pin is already not connected, returns
        // false (nothing to do); the desired post-condition is achieved either
        // way. Returns true when a wire was actually removed.
        const paper = getPaper();
        const tgt = paper.elements?.[toNode];
        const input = tgt?.inputs?.[toPin];

        if (input?.connected && input.connected_to) {
          // Normal path: input still references the source, use it.
          const { ref: srcRef, put_id: srcPutId, put_connection_id: putConn, connection_id: connId } = input.connected_to;
          const srcOutput = paper.elements?.[srcRef]?.outputs?.[srcPutId];
          if (!srcOutput) {
            throw new Error(`disconnectWire: missing source output ${srcRef}:${srcPutId}`);
          }
          // The input-side's put_connection_id can desync from the source's
          // connected_to map. Verify the entry at `putConn` actually matches
          // our wire's connection_id; if not, search by connection_id.
          let effectivePutConn = putConn;
          const entryAtPutConn = srcOutput.connected_to?.[putConn];
          if (!entryAtPutConn || entryAtPutConn.connection_id !== connId) {
            for (const k of Object.keys(srcOutput.connected_to || {})) {
              if (srcOutput.connected_to[k]?.connection_id === connId) {
                effectivePutConn = k;
                break;
              }
            }
          }
          paper.__disconnect_output(srcRef, srcOutput, effectivePutConn);
          paper.__disconnect_input(toNode, input);
          return true;
        }

        // Reactive cleanup: input side is already cleared but orphan state may
        // remain on paper.connections + source.outputs.connected_to + SVG DOM
        // (host bookkeeping can desync after sequences of create/undo/create
        // /undo). Find any orphan wire records that should land on this input
        // pin and clean them up directly.
        const conns = paper.connections || [];
        const orphans = [];
        for (let i = 0; i < conns.length; i++) {
          const c = conns[i];
          if (!c?.user) continue;
          if (c.user.target !== toNode) continue;
          // Only orphans on this specific input pin — match via target input's
          // input pin index. The host doesn't expose this directly on the
          // connection, but the connection's `to` Raphael shape has a block_id
          // (target ref); pin index can't be derived without input.connected_to,
          // which is null. As a fallback, treat ALL connections whose target
          // is `toNode` and whose input pin is no longer claimed by any other
          // input as candidates. With a single orphan per pin this is safe.
          orphans.push({ index: i, conn: c });
        }
        if (orphans.length === 0) return false;

        let removedAny = false;
        // Iterate in reverse so splices don't shift later indices.
        for (let i = orphans.length - 1; i >= 0; i--) {
          const { conn } = orphans[i];
          try {
            // Remove SVG.
            try { conn.line?.remove?.(); } catch (e) {}
            try { conn.bg?.remove?.(); } catch (e) {}
            // Clean up source output's connected_to entry pointing here.
            const srcRef = conn.user.source;
            const srcEl = paper.elements?.[srcRef];
            if (srcEl?.outputs) {
              for (const op of srcEl.outputs) {
                if (!op?.connected_to) continue;
                for (const k of Object.keys(op.connected_to)) {
                  if (op.connected_to[k]?.connection_id === conn.id) {
                    delete op.connected_to[k];
                    if (typeof op.connections === 'number') op.connections = Math.max(0, op.connections - 1);
                    if (op.connections === 0) {
                      op.connected = false;
                      // Reset pin color if we have set_id + fill_color.
                      try {
                        const elShape = srcEl.set?.[op.set_id];
                        if (elShape && typeof op.fill_color !== 'undefined') {
                          elShape.attr?.('fill', op.fill_color);
                        }
                      } catch (e) {}
                    }
                  }
                }
              }
            }
            // Clean up target input's connected_to entry (the input side may be
            // still holding a stale reference; symmetric to the source-side
            // cleanup above).
            const tgtRefForCleanup = conn.user.target;
            const tgtElForCleanup = paper.elements?.[tgtRefForCleanup];
            if (tgtElForCleanup?.inputs) {
              for (const inp of tgtElForCleanup.inputs) {
                if (inp?.connected_to?.connection_id === conn.id) {
                  inp.connected = false;
                  inp.connected_to = null;
                  try {
                    const inputShape = tgtElForCleanup.set?.[inp.set_id];
                    if (inputShape && typeof inp.fill_color !== 'undefined') {
                      inputShape.attr?.('fill', inp.fill_color);
                    }
                  } catch (e) {}
                }
              }
            }
            // Remove from paper.connections.
            const idx = paper.connections.indexOf(conn);
            if (idx >= 0) paper.connections.splice(idx, 1);
            removedAny = true;
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] disconnectWire orphan cleanup failed:`, conn, err);
          }
        }
        return removedAny;
      }

      function setBlockInputCount(blockRef, newCount) {
        // Direct passthrough to the host method. Captured in v1's write-side
        // spike trace as how FORMULA blocks dynamically grow their input pins.
        const paper = getPaper();
        paper.set_block_input_count(blockRef, newCount);
      }

      function getPinAtTarget(eventTarget) {
        // Resolve a click target → { blockRef, pinIndex, side } | null.
        // The host stores pin shapes on the block's Raphael set, addressed by
        // each pin's `set_id`. Verified live via probe5–probe6: el.set[set_id]
        // returns a Raphael circle whose .node is the SVG DOM element.
        // The plan's original `outputs[i].set` assumption was wrong on this
        // host build — el.set is a per-block collection, not per-pin.
        if (!eventTarget) return null;
        const paper = getPaper();
        const elements = paper?.elements;
        if (!elements) return null;

        for (const key of Object.keys(elements)) {
          if (!/^\d+$/.test(key)) continue;
          const blockRef = Number(key);
          const el = elements[key];
          if (!el?.set) continue;

          if (Array.isArray(el.outputs)) {
            for (let i = 0; i < el.outputs.length; i++) {
              const shape = el.set[el.outputs[i]?.set_id];
              const node = shape?.node;
              if (node && (node === eventTarget || node.contains?.(eventTarget))) {
                return { blockRef, pinIndex: i, side: 'output' };
              }
            }
          }
          if (Array.isArray(el.inputs)) {
            for (let i = 0; i < el.inputs.length; i++) {
              const shape = el.set[el.inputs[i]?.set_id];
              const node = shape?.node;
              if (node && (node === eventTarget || node.contains?.(eventTarget))) {
                return { blockRef, pinIndex: i, side: 'input' };
              }
            }
          }
        }
        return null;
      }

      function getWireAtTarget(eventTarget) {
        // Resolve a click target → { connectionId, from:{node,pin}, to:{node,pin} } | null.
        // Hit-tests against c.bg.node and c.line.node (the wire's SVG path elements).
        // For orphan wires (input side cleared but visual + source state remains)
        // returns to.pin = -1 so disconnectWire's reactive cleanup can act on it.
        if (!eventTarget) return null;
        const paper = getPaper();
        const conns = paper?.connections || [];
        for (const c of conns) {
          if (!c) continue;
          const bgNode = c.bg?.node;
          const lineNode = c.line?.node;
          if (bgNode === eventTarget || lineNode === eventTarget ||
              bgNode?.contains?.(eventTarget) || lineNode?.contains?.(eventTarget)) {
            const srcRef = c?.user?.source;
            const tgtRef = c?.user?.target;
            const connId = c?.id;
            if (typeof srcRef !== 'number' || typeof tgtRef !== 'number') continue;
            const tgtEl = paper.elements?.[tgtRef];
            if (!tgtEl?.inputs) continue;
            let toPin = null;
            for (let i = 0; i < tgtEl.inputs.length; i++) {
              if (tgtEl.inputs[i]?.connected_to?.connection_id === connId) {
                toPin = i;
                break;
              }
            }
            // Orphan case: input side cleared but wire still in paper.connections.
            // Return -1 as toPin so the caller can identify and clean up.
            const srcEl = paper.elements?.[srcRef];
            const fromPinSrc = toPin !== null ? tgtEl.inputs[toPin]?.connected_to?.put_id : null;
            // NOTE: per __connect source, connected_to on the input side has
            // put_id = source output pin INDEX. Different from the output-side
            // connected_to entry. So we CAN read it here when input is healthy.
            const fromPin = typeof fromPinSrc === 'number' ? fromPinSrc : 0;
            const resolvedToPin = toPin !== null ? toPin : -1;
            return {
              connectionId: connId,
              from: { node: srcRef, pin: fromPin },
              to: { node: tgtRef, pin: resolvedToPin },
            };
          }
        }
        return null;
      }

      function getWiresInSelection(selectedRefs) {
        // Returns wires where BOTH endpoint blocks are in selectedRefs.
        // Used by Remove-mode marquee gesture.
        const refsSet = new Set(selectedRefs.map((r) => Number(r)));
        const paper = getPaper();
        const conns = paper?.connections || [];
        const out = [];
        for (const c of conns) {
          if (!c?.user) continue;
          const srcRef = c.user.source;
          const tgtRef = c.user.target;
          if (typeof srcRef !== 'number' || typeof tgtRef !== 'number') continue;
          if (!refsSet.has(srcRef) || !refsSet.has(tgtRef)) continue;
          const tgtEl = paper.elements?.[tgtRef];
          if (!tgtEl?.inputs) continue;
          let toPin = null;
          for (let i = 0; i < tgtEl.inputs.length; i++) {
            if (tgtEl.inputs[i]?.connected_to?.connection_id === c.id) {
              toPin = i;
              break;
            }
          }
          if (toPin === null) continue;
          const fromPin = tgtEl.inputs[toPin]?.connected_to?.put_id ?? 0;
          out.push({
            connectionId: c.id,
            from: { node: srcRef, pin: fromPin },
            to: { node: tgtRef, pin: toPin },
          });
        }
        return out;
      }

      function getWiresTouchingNode(blockRef) {
        // Returns all wires with either endpoint on blockRef. Shape matches
        // getWiresInSelection. Used by Remove-mode block-body click gesture.
        const ref = Number(blockRef);
        const paper = getPaper();
        const conns = paper?.connections || [];
        const out = [];
        for (const c of conns) {
          if (!c?.user) continue;
          const srcRef = c.user.source;
          const tgtRef = c.user.target;
          if (srcRef !== ref && tgtRef !== ref) continue;
          if (typeof srcRef !== 'number' || typeof tgtRef !== 'number') continue;
          const tgtEl = paper.elements?.[tgtRef];
          if (!tgtEl?.inputs) continue;
          let toPin = null;
          for (let i = 0; i < tgtEl.inputs.length; i++) {
            if (tgtEl.inputs[i]?.connected_to?.connection_id === c.id) {
              toPin = i;
              break;
            }
          }
          if (toPin === null) continue;
          const fromPin = tgtEl.inputs[toPin]?.connected_to?.put_id ?? 0;
          out.push({
            connectionId: c.id,
            from: { node: srcRef, pin: fromPin },
            to: { node: tgtRef, pin: toPin },
          });
        }
        return out;
      }

      return {
        getSelection, getNodeType, getNodePosition, getNodeData, getInternalWires, getWiresTouchingNodes, getPinAtTarget,
        getWireAtTarget, getWiresInSelection, getWiresTouchingNode,
        createNode, createWire, setSelection, deleteNode, disconnectWire, setBlockInputCount,
      };
    })();

    // Shared helper: resolve a DOM event target → block ref (numeric) or null.
    // Used by SelectionInterceptor and MultiWireMode.
    function resolveBlockRefShared(target) {
      if (!target) return null;
      try {
        const paper = W.logic_designer?.paper;
        if (!paper?.elements) return null;
        if (typeof target.block_id === 'number') return target.block_id;
        for (const [key, el] of Object.entries(paper.elements)) {
          if (!/^\d+$/.test(key)) continue;
          const items = el?.set?.items;
          if (!Array.isArray(items)) continue;
          for (const item of items) {
            const node = item?.node;
            if (!node) continue;
            if (node === target || node.contains?.(target)) {
              return Number(key);
            }
          }
        }
      } catch { /* ignore */ }
      return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Selection interceptor — Ctrl/Cmd-click toggles a block in/out
    //  of paper.selected_blocks, working across compile_type categories
    //  where the host's native handler does not.
    // ═══════════════════════════════════════════════════════════════

    const SelectionInterceptor = (() => {
      let warnedResolveFail = false;

      function onMouseDown(event) {
        const ctrl = event.ctrlKey || event.metaKey;
        if (!ctrl) return;
        // Other modifier chords may carry host meaning — pass through.
        if (event.altKey || event.shiftKey) return;
        // Don't steal Ctrl-click when the user is editing text on the page.
        if (isEditingText(event.target)) return;

        const ref = resolveBlockRefShared(event.target);
        if (ref == null && !warnedResolveFail) {
          warnedResolveFail = true;
          console.warn('[LDSCP] SelectionInterceptor could not resolve Ctrl-click target; passing through.');
        }
        if (ref == null) return; // not on a block — pass through

        const paper = W.logic_designer?.paper;
        if (!paper) return;

        // Toggle the ref in selected_blocks (normalize string/number keys to numbers).
        const current = Array.from(paper.selected_blocks || [])
          .filter((r) => /^\d+$/.test(String(r)))
          .map(Number);
        const idx = current.indexOf(ref);
        const next = idx === -1 ? [...current, ref] : current.filter((r) => r !== ref);
        paper.selected_blocks = next;

        // Best-effort visual highlight. The host's __select_block may accept
        // a real event; swallow errors if it doesn't.
        try {
          if (typeof paper.__select_block === 'function') {
            paper.__select_block(ref, event);
          }
        } catch (err) {
          // Silent — visual feedback is nice-to-have, not required.
        }

        event.preventDefault();
        event.stopPropagation();
      }

      function install() {
        document.addEventListener('mousedown', onMouseDown, true); // capture phase
      }

      return { install };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  Delete interceptor — Delete-key on selected blocks captures
    //  state before the host removes them, so doUndo can recreate.
    // ═══════════════════════════════════════════════════════════════

    const DeleteInterceptor = (() => {
      function isDeleteKey(event) {
        return event.key === 'Delete' || event.key === 'Del';
      }

      function captureBlocks(refs) {
        return refs.map((ref) => ({
          ref,
          type: HostAdapter.getNodeType(ref),
          position: HostAdapter.getNodePosition(ref),
          payload: HostAdapter.getNodeData(ref),
        }));
      }

      function onKeyDown(event) {
        if (!isDeleteKey(event)) return;
        if (isEditingText(event.target)) return;

        const sel = HostAdapter.getSelection();
        if (!sel || sel.length === 0) return; // nothing to capture; host no-ops too

        let blocks;
        let wires;
        try {
          blocks = captureBlocks(sel);
          wires = HostAdapter.getWiresTouchingNodes(sel);
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] DeleteInterceptor capture failed:`, err);
          return; // bail without pushing a partial record; host will still delete
        }

        undoHistory.push({
          type: 'delete',
          timestamp: new Date().toISOString(),
          payload: { blocks, wires },
        });

        // Intentionally do NOT preventDefault — the host's __on_shortcuts
        // handler runs as normal and performs the delete.
      }

      function install() {
        document.addEventListener('keydown', onKeyDown, true); // capture phase
      }

      return { install };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  Multi-wire mode — pick N pins on one side, finalize on the
    //  other side, create N wires top-to-bottom. Includes marquee
    //  observation for selecting whole blocks. Integrates into the
    //  existing undo stack via the 'multi-wire' record type.
    // ═══════════════════════════════════════════════════════════════

    const MultiWireMode = (() => {
      let mode = 'inactive';
      let sourceSide = null;
      const sources = []; // [{ blockRef, pinIndex, side, y, overlayEl }]

      let bannerEl = null;

      function setBanner(text) {
        if (!bannerEl) {
          bannerEl = document.createElement('div');
          bannerEl.className = 'ldscp-mode-banner';
          document.body.appendChild(bannerEl);
        }
        bannerEl.textContent = text;
      }

      function clearBanner() {
        if (bannerEl) {
          bannerEl.remove();
          bannerEl = null;
        }
      }

      function updateBanner() {
        const n = sources.length;
        const prefix = mode === 'fill' ? 'Multi-wire (fill mode — no expansion)' : 'Multi-wire';
        if (n === 0) {
          setBanner(`${prefix}: pick pins to connect. (Esc to cancel)`);
          return;
        }
        const sideLabel = sourceSide === 'output' ? (n === 1 ? 'output' : 'outputs') : (n === 1 ? 'input' : 'inputs');
        setBanner(`${prefix}: ${n} ${sideLabel} picked. Click target to finalize. (Esc to cancel)`);
      }

      // Resolves the Raphael shape for a pin using the verified per-block
      // el.set[pin.set_id] pattern (NOT the plan's original pin.set.items —
      // see probes 5–6, that field does not exist on this host).
      function getPinShape(blockRef, pinIndex, side) {
        const paper = W.logic_designer?.paper;
        const el = paper?.elements?.[blockRef];
        const pin = (side === 'output' ? el?.outputs : el?.inputs)?.[pinIndex];
        if (!el?.set || !pin) return null;
        const shape = el.set[pin.set_id];
        if (!shape?.node) return null;
        return shape;
      }

      function drawPinOverlay(blockRef, pinIndex, side) {
        // Draw an orange ring overlay on top of the pin's existing circle.
        const shape = getPinShape(blockRef, pinIndex, side);
        if (!shape) return null;
        const svg = shape.node.ownerSVGElement;
        if (!svg) return null;
        const attrs = shape.attrs || {};
        const m = shape.matrix;
        const cx = (m?.e ?? 0) + (typeof attrs.cx === 'number' ? attrs.cx : 0);
        const cy = (m?.f ?? 0) + (typeof attrs.cy === 'number' ? attrs.cy : 0);
        const r = (typeof attrs.r === 'number' ? attrs.r : 5) + 3;
        const ns = 'http://www.w3.org/2000/svg';
        const overlay = document.createElementNS(ns, 'circle');
        overlay.setAttribute('cx', String(cx));
        overlay.setAttribute('cy', String(cy));
        overlay.setAttribute('r', String(r));
        overlay.setAttribute('fill', 'none');
        overlay.setAttribute('stroke', '#ffa500');
        overlay.setAttribute('stroke-width', '2');
        overlay.style.pointerEvents = 'none';
        svg.appendChild(overlay);
        return overlay;
      }

      function pinWorldY(blockRef, pinIndex, side) {
        const shape = getPinShape(blockRef, pinIndex, side);
        if (!shape) return 0;
        const m = shape.matrix;
        const attrs = shape.attrs || {};
        return (m?.f ?? 0) + (typeof attrs.cy === 'number' ? attrs.cy : 0);
      }

      function findSourceIndex(blockRef, pinIndex) {
        return sources.findIndex((s) => s.blockRef === blockRef && s.pinIndex === pinIndex);
      }

      function addSourcePin(blockRef, pinIndex, side) {
        if (sourceSide && sourceSide !== side) return; // wrong side, ignore
        if (!sourceSide) sourceSide = side;
        const idx = findSourceIndex(blockRef, pinIndex);
        if (idx !== -1) {
          // Toggle off
          const removed = sources.splice(idx, 1)[0];
          if (removed.overlayEl) removed.overlayEl.remove();
          if (sources.length === 0) sourceSide = null;
          updateBanner();
          return;
        }
        const y = pinWorldY(blockRef, pinIndex, side);
        const overlayEl = drawPinOverlay(blockRef, pinIndex, side);
        sources.push({ blockRef, pinIndex, side, y, overlayEl });
        updateBanner();
      }

      let lastObservedSelection = null; // string-stringified array, for cheap dedupe
      let pollTimer = null;

      function readSelection() {
        const paper = W.logic_designer?.paper;
        if (!paper) return [];
        return Array.from(paper.selected_blocks || [])
          .filter((r) => /^\d+$/.test(String(r)))
          .map(Number)
          .filter((r) => paper.elements?.[r] != null);
      }

      function observeSelectionPoll() {
        if (mode !== 'collecting' && mode !== 'fill') return;
        const sel = readSelection();
        const fingerprint = JSON.stringify(sel);
        if (fingerprint === lastObservedSelection) return;
        lastObservedSelection = fingerprint;
        if (sel.length === 0) return; // ignore clears
        processMarqueeSelection(sel);
      }

      function startPolling() {
        stopPolling();
        lastObservedSelection = JSON.stringify(readSelection());
        pollTimer = setInterval(observeSelectionPoll, 150);
      }

      function stopPolling() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        lastObservedSelection = null;
      }

      function processMarqueeSelection(refs) {
        const noExpand = mode === 'fill';
        const paper = W.logic_designer?.paper;
        if (!paper) return;

        // Classify each selected block.
        const sourceOnly = [];
        const targetOnly = [];
        const bidirectional = [];
        for (const ref of refs) {
          const block = paper.elements[ref];
          const kind = classifyBlockPinDirection(block);
          if (kind === 'source-only') sourceOnly.push(ref);
          else if (kind === 'target-only') targetOnly.push(ref);
          else if (kind === 'bidirectional') bidirectional.push(ref);
        }

        // Step 1: no sources yet.
        if (sources.length === 0) {
          // All source-only → add their outputs as sources.
          if (targetOnly.length === 0 && sourceOnly.length + bidirectional.length > 0) {
            sourceSide = 'output';
            for (const ref of sourceOnly) addAllPinsOfBlock(ref, 'output');
            for (const ref of bidirectional) addAllPinsOfBlock(ref, 'output');
            return;
          }
          // All target-only → add their inputs as sources, await source gesture.
          if (sourceOnly.length === 0 && bidirectional.length === 0 && targetOnly.length > 0) {
            sourceSide = 'input';
            for (const ref of targetOnly) addAllPinsOfBlock(ref, 'input');
            return;
          }
          // Mix of source-only AND exactly one target-only → auto-finalize.
          if (sourceOnly.length > 0 && targetOnly.length === 1 && bidirectional.length === 0) {
            sourceSide = 'output';
            for (const ref of sourceOnly) addAllPinsOfBlock(ref, 'output');
            // Finalize against the single target-only block.
            const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
            const targets = [{ blockRef: targetOnly[0], startPin: 0, side: 'input', isPinClick: false, noExpand }];
            exit();
            doMultiWire({ sources: snapshot, targets });
            return;
          }
          // Mix with multiple target-only → check if we can distribute.
          // Distribute when sources fit total target capacity AND no single
          // target absorbs all (mirrors the Step 2 distribute check). Falls
          // back to "Pick a target" toast if capacity rule fails.
          if (sourceOnly.length > 0 && targetOnly.length > 1) {
            // Pre-compute source-pin count: each source-only block contributes
            // its output pin count (1 per pin); we count the total pins, not blocks.
            const sourcePinCount = sourceOnly.reduce((acc, ref) => {
              const b = paper.elements[ref];
              return acc + (Array.isArray(b?.outputs) ? b.outputs.length : 0);
            }, 0);
            const totalTargetCapacity = targetOnly.reduce((acc, ref) => {
              const b = paper.elements[ref];
              return acc + (Array.isArray(b?.inputs) ? b.inputs.length : 0);
            }, 0);
            const maxSingleTargetCapacity = targetOnly.reduce((acc, ref) => {
              const b = paper.elements[ref];
              return Math.max(acc, Array.isArray(b?.inputs) ? b.inputs.length : 0);
            }, 0);

            if (totalTargetCapacity >= sourcePinCount && maxSingleTargetCapacity < sourcePinCount) {
              // Distribute. Add all source pins, then dispatch a multi-target op.
              sourceSide = 'output';
              for (const ref of sourceOnly) addAllPinsOfBlock(ref, 'output');
              const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
              const targets = targetOnly.map((ref) => {
                // Use pin-derived y (matches sources' pinWorldY), not b.matrix
                // which is undefined on blocks in this host build.
                const y = pinWorldY(ref, 0, 'input');
                return {
                  blockRef: ref,
                  startPin: 0,
                  side: 'input',
                  isPinClick: false,
                  y,
                  noExpand,
                };
              });
              exit();
              doMultiWire({ sources: snapshot, targets });
              return;
            }

            // Capacity rule didn't fire — add sources, await user click.
            sourceSide = 'output';
            for (const ref of sourceOnly) addAllPinsOfBlock(ref, 'output');
            toast('Pick a target to pair into.');
            return;
          }
          return;
        }

        // Step 2: sources already collected. Look for opposite-side candidates.
        const oppositeSide = sourceSide === 'output' ? 'input' : 'output';
        const candidates = refs.filter((ref) => {
          const b = paper.elements[ref];
          const pins = oppositeSide === 'input' ? b?.inputs : b?.outputs;
          return Array.isArray(pins) && pins.length > 0;
        });

        // Fanout: 1 source → multiple targets (one wire per target).
        if (sources.length === 1 && candidates.length > 1) {
          const snapshot = [];
          for (let i = 0; i < candidates.length; i++) {
            // Replicate the single source N times so the slicer gives each target one wire.
            snapshot.push({ ...sources[0] });
          }
          const targets = candidates.map((ref) => {
            const y = pinWorldY(ref, 0, oppositeSide);
            return {
              blockRef: ref,
              startPin: 0,
              side: oppositeSide,
              isPinClick: false,
              y,
              noExpand: mode === 'fill',
            };
          });
          exit();
          doMultiWire({ sources: snapshot, targets });
          return;
        }

        if (candidates.length === 1) {
          const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
          const targets = [{ blockRef: candidates[0], startPin: 0, side: oppositeSide, isPinClick: false, noExpand }];
          exit();
          doMultiWire({ sources: snapshot, targets });
          return;
        }

        if (candidates.length > 1) {
          // Capacity-check: distribute if sources fit total opposite-side pin
          // capacity AND no single target absorbs all sources.
          const totalCapacity = candidates.reduce((acc, ref) => {
            const b = paper.elements[ref];
            const pins = oppositeSide === 'input' ? b?.inputs : b?.outputs;
            return acc + (Array.isArray(pins) ? pins.length : 0);
          }, 0);
          const maxSingleCapacity = candidates.reduce((acc, ref) => {
            const b = paper.elements[ref];
            const pins = oppositeSide === 'input' ? b?.inputs : b?.outputs;
            return Math.max(acc, Array.isArray(pins) ? pins.length : 0);
          }, 0);
          if (totalCapacity >= sources.length && maxSingleCapacity < sources.length) {
            // Distribute.
            const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
            const targets = candidates.map((ref) => {
              // Use pin-derived y (matches sources' pinWorldY).
              const y = pinWorldY(ref, 0, oppositeSide);
              return {
                blockRef: ref,
                startPin: 0,
                side: oppositeSide,
                isPinClick: false,
                y,
                noExpand,
              };
            });
            exit();
            doMultiWire({ sources: snapshot, targets });
            return;
          }
          toast('Multiple targets — click a specific one to pair into.');
          return;
        }

        // No opposite-side candidates — same-side blocks; extend sources.
        for (const ref of refs) {
          const b = paper.elements[ref];
          const pins = sourceSide === 'output' ? b?.outputs : b?.inputs;
          if (Array.isArray(pins) && pins.length > 0) {
            addAllPinsOfBlock(ref, sourceSide);
          }
        }
      }

      function addAllPinsOfBlock(blockRef, side) {
        const block = W.logic_designer?.paper?.elements?.[blockRef];
        const pins = side === 'output' ? block?.outputs : block?.inputs;
        if (!Array.isArray(pins)) return;
        for (let i = 0; i < pins.length; i++) {
          addSourcePin(blockRef, i, side);
        }
      }

      function enter() {
        if (mode === 'collecting' || mode === 'fill') return;
        // Mutually exclusive with remove-mode and ghost-paste.
        if (typeof RemoveConnectorsMode !== 'undefined' && RemoveConnectorsMode.isActive()) {
          RemoveConnectorsMode.exit();
        }
        if (typeof GhostPasteMode !== 'undefined' && GhostPasteMode.isActive()) {
          GhostPasteMode.exit();
        }
        mode = 'collecting';
        sourceSide = null;
        sources.length = 0;
        updateBanner();
        startPolling();
      }

      function toFillMode() {
        // Flip from auto-expand to fill-only. Sources and sourceSide preserved.
        // Polling continues (no restart needed).
        if (mode !== 'collecting') return;
        mode = 'fill';
        updateBanner();
      }

      function exit() {
        if (mode === 'inactive') return;
        mode = 'inactive';
        sourceSide = null;
        for (const s of sources) {
          if (s.overlayEl) s.overlayEl.remove();
        }
        sources.length = 0;
        clearBanner();
        stopPolling();
      }

      function toggle() {
        // Cycle: inactive → collecting (auto) → fill → inactive
        if (mode === 'inactive') {
          enter();
        } else if (mode === 'collecting') {
          toFillMode();
        } else {
          // mode === 'fill'
          exit();
        }
      }

      function isActive() {
        return mode === 'collecting' || mode === 'fill';
      }

      function onMouseDown(event) {
        if (mode !== 'collecting' && mode !== 'fill') return;
        if (event.shiftKey) return;
        const pin = HostAdapter.getPinAtTarget(event.target);

        if (pin) {
          // Pin click
          if (!sourceSide || pin.side === sourceSide) {
            event.preventDefault();
            event.stopPropagation();
            addSourcePin(pin.blockRef, pin.pinIndex, pin.side);
            return;
          }
          // Opposite-side pin click → finalize
          if (sources.length === 0) return; // no sources collected yet
          event.preventDefault();
          event.stopPropagation();
          finalizeOnPin(pin);
          return;
        }

        // No pin resolved. Try block-body finalize if we have sources.
        if (sources.length === 0) return;
        const ref = resolveBlockRefShared(event.target);
        if (ref == null) return;
        // Confirm the block has at least one pin on the opposite side
        const block = W.logic_designer?.paper?.elements?.[ref];
        const oppositeSide = sourceSide === 'output' ? 'input' : 'output';
        const oppositePins = oppositeSide === 'input' ? block?.inputs : block?.outputs;
        if (!Array.isArray(oppositePins) || oppositePins.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        finalizeOnBlock(ref);
      }

      function finalizeOnPin(targetPin) {
        const targetSide = sourceSide === 'output' ? 'input' : 'output';
        const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
        const noExpand = mode === 'fill';
        const targets = [{
          blockRef: targetPin.blockRef,
          startPin: targetPin.pinIndex,
          side: targetSide,
          isPinClick: true,
          noExpand,
        }];
        exit();
        doMultiWire({ sources: snapshot, targets });
      }

      function finalizeOnBlock(targetBlockRef) {
        const targetSide = sourceSide === 'output' ? 'input' : 'output';
        const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
        const noExpand = mode === 'fill';
        const targets = [{
          blockRef: targetBlockRef,
          startPin: 0,
          side: targetSide,
          isPinClick: false,
          noExpand,
        }];
        exit();
        doMultiWire({ sources: snapshot, targets });
      }

      function install() {
        document.addEventListener('mousedown', onMouseDown, true);
      }

      return { enter, exit, toggle, isActive, install };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  Remove-connectors mode — click wires/blocks/marquee to delete.
    //  Mutually exclusive with multi-wire mode. Undo via 'remove-batch'
    //  records (single wire removes get 'wire-remove' from WireObserver).
    //  Gesture handlers land in Tasks 10-11; this is the lifecycle shell.
    // ═══════════════════════════════════════════════════════════════

    const RemoveConnectorsMode = (() => {
      let mode = 'inactive';
      let bannerEl = null;
      let hoveredWireNode = null;
      let dragSession = null; // null or { wiresRemoved: [{from, to, connectionId}, ...] }

      function setBanner(text) {
        if (!bannerEl) {
          bannerEl = document.createElement('div');
          bannerEl.className = 'ldscp-mode-banner';
          document.body.appendChild(bannerEl);
        }
        bannerEl.textContent = text;
      }

      function clearBanner() {
        if (bannerEl) {
          bannerEl.remove();
          bannerEl = null;
        }
      }

      function clearHover() {
        if (hoveredWireNode) {
          hoveredWireNode.classList?.remove('ldscp-wire-hover');
          hoveredWireNode = null;
        }
      }

      function enter() {
        if (mode === 'active') return;
        // Mutually exclusive with multi-wire and ghost-paste.
        if (MultiWireMode.isActive()) MultiWireMode.exit();
        if (typeof GhostPasteMode !== 'undefined' && GhostPasteMode.isActive()) {
          GhostPasteMode.exit();
        }
        mode = 'active';
        setBanner('Remove mode: click wires/blocks/marquee to delete. (Esc to cancel)');
      }

      function exit() {
        if (mode === 'inactive') return;
        mode = 'inactive';
        clearHover();
        clearBanner();
        dragSession = null;
      }

      function toggle() {
        if (mode === 'active') exit();
        else enter();
      }

      function isActive() {
        return mode === 'active';
      }

      function removeWireSilent(wire) {
        // Removes a wire WITHOUT pushing an undo record. The caller is
        // responsible for accumulating removed wires and pushing one batch
        // at the end of a drag session.
        try {
          WireObserver.suppressNextRemoveFor({ toNode: wire.to.node, toPin: wire.to.pin });
          const ok = HostAdapter.disconnectWire({ toNode: wire.to.node, toPin: wire.to.pin });
          return ok;
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] removeWireSilent failed:`, err);
          return false;
        }
      }

      function onMouseDown(event) {
        if (mode !== 'active') return;
        if (event.altKey || event.shiftKey) return;
        if (event.button !== 0) return;

        // Wire hit-test first.
        const wire = HostAdapter.getWireAtTarget(event.target);
        if (wire) {
          event.preventDefault();
          event.stopPropagation();
          const ok = removeWireSilent(wire);
          dragSession = { wiresRemoved: [] };
          if (ok) dragSession.wiresRemoved.push({ from: wire.from, to: wire.to, connectionId: wire.connectionId });
          return;
        }

        // Pin click — absorb but don't start a session.
        const pin = HostAdapter.getPinAtTarget(event.target);
        if (pin) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        // Block body — single-gesture, pushes its own undo record immediately.
        const blockRef = resolveBlockRefShared(event.target);
        if (blockRef != null) {
          event.preventDefault();
          event.stopPropagation();
          removeAllWiresOfBlock(blockRef);
          return;
        }

        // Empty canvas — start an empty drag session for paint-on-drag.
        dragSession = { wiresRemoved: [] };
      }

      function onMouseMove(event) {
        if (!dragSession) return;
        if (mode !== 'active') return;
        const wire = HostAdapter.getWireAtTarget(event.target);
        if (!wire) return;
        // Dedupe: skip if already removed this session.
        for (const w of dragSession.wiresRemoved) {
          if (w.connectionId === wire.connectionId) return;
        }
        const ok = removeWireSilent(wire);
        if (ok) dragSession.wiresRemoved.push({ from: wire.from, to: wire.to, connectionId: wire.connectionId });
      }

      function onMouseUp() {
        if (!dragSession) return;
        const removed = dragSession.wiresRemoved;
        dragSession = null;
        if (removed.length === 0) return;
        // Strip connectionId for the undo payload (not needed for undo).
        const payloadWires = removed.map((w) => ({ from: w.from, to: w.to }));
        undoHistory.push({
          type: 'remove-batch',
          timestamp: new Date().toISOString(),
          payload: { wires: payloadWires },
        });
        toast(`Removed ${removed.length} wire${removed.length === 1 ? '' : 's'}.`);
      }

      function removeAllWiresOfBlock(blockRef) {
        const wires = HostAdapter.getWiresTouchingNode(blockRef);
        if (!wires || wires.length === 0) return; // no-op silently
        const removed = [];
        for (const w of wires) {
          try {
            WireObserver.suppressNextRemoveFor({ toNode: w.to.node, toPin: w.to.pin });
            const ok = HostAdapter.disconnectWire({ toNode: w.to.node, toPin: w.to.pin });
            if (ok) removed.push({ from: w.from, to: w.to });
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] removeAllWiresOfBlock failed for wire:`, w, err);
          }
        }
        if (removed.length > 0) {
          undoHistory.push({
            type: 'remove-batch',
            timestamp: new Date().toISOString(),
            payload: { wires: removed },
          });
          toast(`Removed ${removed.length} wire${removed.length === 1 ? '' : 's'}.`);
        }
      }

      function onMouseOver(event) {
        if (mode !== 'active') return;
        // Wire hover hookup lands in Task 11.
      }

      function onMouseOut(event) {
        if (mode !== 'active') return;
        // Wire hover hookup lands in Task 11.
      }

      function install() {
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);
        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('mouseout', onMouseOut, true);
      }

      return { enter, exit, toggle, isActive, install };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  GhostPasteMode — Ctrl+B paste with cursor-following ghost.
    //  Reuses the same snapshot Ctrl+V reads. Commits via applySnapshotAt.
    // ═══════════════════════════════════════════════════════════════
    const GhostPasteMode = (() => {
      let active = false;
      let bannerEl = null;
      let overlayEl = null;             // SVG <g> appended to the host paper SVG
      let svgRoot = null;               // cached host SVG element while active
      let snapshot = null;              // the clipboard snapshot for this mode session
      let anchorWorld = null;           // {x,y} in SVG world coords — the snapshot-side anchor
      let lastWorldPt = null;           // {x,y} cursor in SVG world coords (for click commit)

      function setBanner(text) {
        if (!bannerEl) {
          bannerEl = document.createElement('div');
          bannerEl.className = 'ldscp-mode-banner';
          document.body.appendChild(bannerEl);
        }
        bannerEl.textContent = text;
      }

      function clearBanner() {
        if (bannerEl) {
          bannerEl.remove();
          bannerEl = null;
        }
      }

      // Build the SVG ghost overlay: a single <g class="ldscp-ghost-overlay">
      // appended to the host's Raphael paper SVG, containing per-node
      // <g transform="translate(dx,dy)"> wrappers around cloned shape nodes
      // (or fallback labeled rectangles when the live host elements can't
      // be identified). Internal wires drawn as dashed straight lines.
      //
      // Side effects: writes svgRoot, overlayEl. Returns false if the host
      // SVG can't be located.
      function buildOverlay() {
        const paper = W.logic_designer?.paper;
        const elements = paper?.elements || {};
        let foundSvg = null;
        for (const key of Object.keys(elements)) {
          const node = elements[key]?.set?.items?.[0]?.node;
          if (node?.ownerSVGElement) { foundSvg = node.ownerSVGElement; break; }
        }
        if (!foundSvg) return false;
        svgRoot = foundSvg;

        const ns = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'ldscp-ghost-overlay');
        g.setAttribute('transform', 'translate(0,0)');

        // Prefer cloning live elements (true-to-render preview).
        const liveRefs = Array.isArray(latestSelectionRefs)
          ? latestSelectionRefs.filter((r) => elements[r] != null)
          : [];
        const refsMatchSnapshot = liveRefs.length === snapshot.nodes.length;

        if (refsMatchSnapshot) {
          for (let i = 0; i < liveRefs.length; i++) {
            const ref = liveRefs[i];
            const snapNode = snapshot.nodes[i];
            const live = elements[ref];
            const items = live?.set?.items || [];
            const nodeGroup = document.createElementNS(ns, 'g');
            const dx = snapNode.position.x - anchorWorld.x;
            const dy = snapNode.position.y - anchorWorld.y;
            nodeGroup.setAttribute('transform', `translate(${dx},${dy})`);
            for (const item of items) {
              const node = item?.node;
              if (!node) continue;
              const clone = node.cloneNode(true);
              // Strip ids to avoid id collisions with the live host tree.
              clone.removeAttribute('id');
              const idChildren = clone.querySelectorAll('[id]');
              for (let k = 0; k < idChildren.length; k++) idChildren[k].removeAttribute('id');
              // The clone carries the original absolute transform. Strip it
              // so the parent <g> translate is the only positioning.
              clone.removeAttribute('transform');
              nodeGroup.appendChild(clone);
            }
            g.appendChild(nodeGroup);
          }
        } else {
          // Fallback: labeled rectangles per snapshot node.
          for (const snapNode of snapshot.nodes) {
            const dx = snapNode.position.x - anchorWorld.x;
            const dy = snapNode.position.y - anchorWorld.y;
            const w = snapNode.data?.config?.width  ?? 80;
            const h = snapNode.data?.config?.height ?? 40;
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', String(dx));
            rect.setAttribute('y', String(dy));
            rect.setAttribute('width', String(w));
            rect.setAttribute('height', String(h));
            rect.setAttribute('fill', '#3a3a3a');
            rect.setAttribute('stroke', '#8ad');
            rect.setAttribute('stroke-width', '1');
            g.appendChild(rect);
            const label = document.createElementNS(ns, 'text');
            label.setAttribute('x', String(dx + 6));
            label.setAttribute('y', String(dy + 16));
            label.setAttribute('fill', '#d4d4d4');
            label.setAttribute('font-size', '11');
            label.textContent = snapNode.type;
            g.appendChild(label);
          }
        }

        // Internal wires as dashed straight lines between approximate
        // block midpoints. This is a guide preview, not a precise routing.
        for (const wire of snapshot.wires) {
          const fromNode = snapshot.nodes.find((n) => n.localId === wire.from.nodeLocalId);
          const toNode   = snapshot.nodes.find((n) => n.localId === wire.to.nodeLocalId);
          if (!fromNode || !toNode) continue;
          const x1 = fromNode.position.x - anchorWorld.x + 40;
          const y1 = fromNode.position.y - anchorWorld.y + 20;
          const x2 = toNode.position.x   - anchorWorld.x;
          const y2 = toNode.position.y   - anchorWorld.y + 20;
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('class', 'ldscp-ghost-overlay-wire');
          line.setAttribute('x1', String(x1));
          line.setAttribute('y1', String(y1));
          line.setAttribute('x2', String(x2));
          line.setAttribute('y2', String(y2));
          g.appendChild(line);
        }

        svgRoot.appendChild(g);
        overlayEl = g;
        return true;
      }

      function teardownOverlay() {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null;
        svgRoot = null;
      }

      // Pick the anchor point on the snapshot — the point that will be glued
      // to the cursor. If snapshot.cursorAnchor exists (copy was done with
      // mouse over canvas), use the snapshot node closest to it. Otherwise
      // fall back to the bounding-box top-left of the snapshot nodes.
      function chooseAnchor(snap) {
        if (!snap || !snap.nodes || snap.nodes.length === 0) return { x: 0, y: 0 };
        if (snap.cursorAnchor && typeof snap.cursorAnchor.x === 'number') {
          let best = snap.nodes[0];
          let bestD2 = Infinity;
          for (const n of snap.nodes) {
            const dx = n.position.x - snap.cursorAnchor.x;
            const dy = n.position.y - snap.cursorAnchor.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = n; }
          }
          return { x: best.position.x, y: best.position.y };
        }
        // Bbox top-left fallback.
        let minX = Infinity, minY = Infinity;
        for (const n of snap.nodes) {
          if (n.position.x < minX) minX = n.position.x;
          if (n.position.y < minY) minY = n.position.y;
        }
        return { x: minX, y: minY };
      }

      function enter() {
        if (active) return;
        const snap = ClipboardStore.load();
        if (!snap || !snap.nodes || snap.nodes.length === 0) {
          toast('Nothing to paste.');
          return;
        }
        const paper = W.logic_designer?.paper;
        if (!paper) {
          toast('Logic designer not ready.', 'error');
          return;
        }
        // Mutex: exit other modes.
        if (MultiWireMode.isActive()) MultiWireMode.exit();
        if (RemoveConnectorsMode.isActive()) RemoveConnectorsMode.exit();

        snapshot = snap;
        anchorWorld = chooseAnchor(snap);
        // overlayEl is populated by buildOverlay (Task 7).
        const built = buildOverlay();
        if (!built) {
          toast('Ghost-paste: could not locate canvas. Try Ctrl+V instead.', 'error');
          snapshot = null;
          return;
        }
        active = true;
        setBanner('Paste-Place — click to drop · Esc / right-click to cancel');
        // Listeners installed once at bootstrap; they bail when !active.
      }

      function exit() {
        if (!active) return;
        active = false;
        teardownOverlay();
        clearBanner();
        snapshot = null;
        anchorWorld = null;
        lastWorldPt = null;
      }

      function toggle() {
        if (active) exit();
        else enter();
      }

      function isActive() {
        return active;
      }

      function onMouseMoveGhost(event) {
        if (!active || !overlayEl) return;
        const world = clientToSvgWorld({ x: event.clientX, y: event.clientY });
        if (!world) return;
        lastWorldPt = world;
        overlayEl.setAttribute('transform', `translate(${world.x},${world.y})`);
      }

      function onClickGhost(event) {
        if (!active) return;
        if (event.button !== 0) return;
        // Only commit if the click landed inside the host SVG.
        if (!svgRoot || !svgRoot.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const world = clientToSvgWorld({ x: event.clientX, y: event.clientY }) || lastWorldPt;
        if (!world) {
          toast('Ghost-paste: could not determine drop coordinates.', 'error');
          exit();
          return;
        }
        // Capture snapshot/anchor BEFORE exit() clears them.
        const snap = snapshot;
        const anchor = anchorWorld;
        // Tear down BEFORE applying so the ghost doesn't get caught in any
        // host re-render triggered by createNode.
        exit();
        const result = applySnapshotAt({
          snapshot: snap,
          snapshotOriginAnchor: anchor,
          basePos: world,
        });
        const totalFails = result.nodeFailures.length + result.wireFailures.length;
        let msg = `Pasted ${result.okNodes} of ${result.totalRequestedNodes} nodes, `
                + `${result.okWires} of ${result.totalRequestedWires} wires.`;
        if (totalFails > 0) {
          msg += ` ${totalFails} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      function onContextMenuGhost(event) {
        if (!active) return;
        event.preventDefault();
        event.stopPropagation();
        exit();
      }

      function onKeyDownGhost(event) {
        if (!active) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          exit();
        }
      }

      function onBlurGhost() {
        if (!active) return;
        exit();
      }

      function install() {
        document.addEventListener('mousemove', onMouseMoveGhost, true);
        document.addEventListener('click', onClickGhost, true);
        document.addEventListener('contextmenu', onContextMenuGhost, true);
        document.addEventListener('keydown', onKeyDownGhost, true);
        window.addEventListener('blur', onBlurGhost);
      }

      // Exposed so other modes can mutex-exit us and so installKeyboardShortcuts
      // can call toggle()/isActive().
      return { enter, exit, toggle, isActive, install };
    })();
    // ═══════════════════════════════════════════════════════════════
    //  Wire observer — wraps paper.__connect / __disconnect_output /
    //  __disconnect_input so host-native wire create/remove gestures
    //  push undo records. Script-initiated wires (multi-wire mode,
    //  remove-mode) suppress via per-endpoint Sets cleared on first hit.
    //  Strategy verified via probes 1-3 (v3 Task 5).
    // ═══════════════════════════════════════════════════════════════

    const WireObserver = (() => {
      const suppressNextCreate = new Set();
      const suppressNextRemove = new Set();
      let originalConnect = null;
      let originalDisconnectOutput = null;
      let installed = false;
      let stateMachineRunning = false;
      let recordingActive = false;
      let prevElementsCount = -1;
      let prevConnectionsLength = -1;
      let prevPinCountFingerprint = ''; // serialized 'ref:in,out;ref:in,out;...'

      function buildPinCountFingerprint(paper) {
        // Serializes every block's input + output count to detect host-side
        // count changes (e.g. user resizing a block via host UI causes the
        // host to rebuild wires via __connect — without this fingerprint we'd
        // record 70+ spurious wire-create entries).
        if (!paper?.elements) return '';
        const parts = [];
        const keys = Object.keys(paper.elements).sort();
        for (const k of keys) {
          if (!/^\d+$/.test(k)) continue;
          const el = paper.elements[k];
          const inCount = Array.isArray(el?.inputs) ? el.inputs.length : 0;
          const outCount = Array.isArray(el?.outputs) ? el.outputs.length : 0;
          parts.push(`${k}:${inCount},${outCount}`);
        }
        return parts.join(';');
      }

      function suppressNextCreateFor({ toNode, toPin }) {
        suppressNextCreate.add(`${toNode}:${toPin}`);
      }
      function suppressNextRemoveFor({ toNode, toPin }) {
        suppressNextRemove.add(`${toNode}:${toPin}`);
      }
      const suppressNextFor = suppressNextCreateFor;

      function recordCreateFromArgs(paper, sourceBlock, targetBlock) {
        if (!sourceBlock || !targetBlock) return;
        const conn = paper?.connections?.[paper.connections.length - 1];
        if (!conn) return;
        if (conn?.user?.source !== sourceBlock.id || conn?.user?.target !== targetBlock.id) return;
        const endpoints = {
          from: { node: sourceBlock.id, pin: sourceBlock.put ?? 0 },
          to: { node: targetBlock.id, pin: targetBlock.put ?? 0 },
        };
        const key = `${endpoints.to.node}:${endpoints.to.pin}`;
        if (suppressNextCreate.has(key)) {
          suppressNextCreate.delete(key);
          return;
        }
        undoHistory.push({
          type: 'wire-create',
          timestamp: new Date().toISOString(),
          payload: endpoints,
        });
      }

      function deriveDisconnectEndpoints(paper, sourceBlockId, sourceOutput, putConnection) {
        if (!paper?.connections || !sourceOutput?.connected_to) return null;
        const entry = sourceOutput.connected_to[putConnection];
        if (!entry) return null;
        const connId = entry.connection_id;
        const targetRef = entry.ref;
        // Find the source output pin INDEX by matching putObject against the
        // block's outputs[] array. The host's __connect stores entry.put_id =
        // TARGET pin index, NOT source pin index — so we can't read it from entry.
        const sourceEl = paper.elements?.[sourceBlockId];
        if (!sourceEl?.outputs) return null;
        let fromPin = null;
        for (let i = 0; i < sourceEl.outputs.length; i++) {
          if (sourceEl.outputs[i] === sourceOutput) {
            fromPin = i;
            break;
          }
        }
        if (fromPin === null) return null;
        // Find the target input pin index by matching connection_id.
        const targetEl = paper.elements?.[targetRef];
        if (!targetEl?.inputs) return null;
        let toPin = null;
        for (let i = 0; i < targetEl.inputs.length; i++) {
          if (targetEl.inputs[i]?.connected_to?.connection_id === connId) {
            toPin = i;
            break;
          }
        }
        if (toPin === null) return null;
        return {
          from: { node: sourceBlockId, pin: fromPin },
          to: { node: targetRef, pin: toPin },
        };
      }

      function recordRemoveBeforeCall(paper, blockId, putObject, putConnection) {
        const endpoints = deriveDisconnectEndpoints(paper, blockId, putObject, putConnection);
        if (!endpoints) return;
        const key = `${endpoints.to.node}:${endpoints.to.pin}`;
        if (suppressNextRemove.has(key)) {
          suppressNextRemove.delete(key);
          return;
        }
        undoHistory.push({
          type: 'wire-remove',
          timestamp: new Date().toISOString(),
          payload: endpoints,
        });
      }

      function install() {
        if (stateMachineRunning) return;
        stateMachineRunning = true;
        tick();
      }

      function tick() {
        try {
          const paper = W.logic_designer?.paper;
          if (!paper || paper.initialized !== true) {
            recordingActive = false;
            prevElementsCount = -1;
            prevConnectionsLength = -1;
            prevPinCountFingerprint = '';
            setTimeout(tick, 500);
            return;
          }

          // Install wraps on first ready (idempotent).
          if (!installed) {
            installed = true;
            originalConnect = paper.__connect;
            paper.__connect = function (sourceBlock, targetBlock, force) {
              const result = originalConnect.call(this, sourceBlock, targetBlock, force);
              if (recordingActive) {
                const currElemCount = this.elements ? Object.keys(this.elements).length : 0;
                const currFingerprint = buildPinCountFingerprint(this);
                if (currElemCount === prevElementsCount && currFingerprint === prevPinCountFingerprint) {
                  try {
                    recordCreateFromArgs(this, sourceBlock, targetBlock);
                  } catch (err) {
                    console.error(`[${SCRIPT_NAME}] WireObserver __connect record failed:`, err);
                  }
                }
                // else: silently skip — host is mid-rebuild
              }
              return result;
            };
            originalDisconnectOutput = paper.__disconnect_output;
            paper.__disconnect_output = function (blockId, putObject, putConnection) {
              if (recordingActive) {
                const currElemCount = this.elements ? Object.keys(this.elements).length : 0;
                const currFingerprint = buildPinCountFingerprint(this);
                if (currElemCount === prevElementsCount && currFingerprint === prevPinCountFingerprint) {
                  try {
                    recordRemoveBeforeCall(this, blockId, putObject, putConnection);
                  } catch (err) {
                    console.error(`[${SCRIPT_NAME}] WireObserver __disconnect_output record failed:`, err);
                  }
                }
              }
              return originalDisconnectOutput.call(this, blockId, putObject, putConnection);
            };
          }

          const currElementsCount = paper.elements ? Object.keys(paper.elements).length : 0;
          const currConnectionsLength = paper.connections?.length ?? 0;
          const currPinCountFingerprint = buildPinCountFingerprint(paper);

          // Detect sketch swap: large element-count drop.
          const sketchSwapped = recordingActive && prevElementsCount > 4 && currElementsCount < prevElementsCount / 2;

          // Detect host-side block resize: per-block pin count changed
          // (e.g. user resized FORMULA inputs via host UI). The host rebuilds
          // wires by calling __connect for many wires — without this clear
          // those become spurious wire-create undo records.
          const blockResized = recordingActive
            && prevPinCountFingerprint !== ''
            && currPinCountFingerprint !== prevPinCountFingerprint
            && currElementsCount === prevElementsCount; // same blocks, just different pin counts

          if (sketchSwapped || blockResized) {
            if (typeof undoHistory.clear === 'function') {
              undoHistory.clear();
            } else {
              while (undoHistory.pop()) { /* drain */ }
            }
          }

          // Recording gate: active only when BOTH elements count AND pin count
          // fingerprint are stable.
          if (currElementsCount === prevElementsCount && currPinCountFingerprint === prevPinCountFingerprint) {
            recordingActive = true;
          } else {
            recordingActive = false;
          }

          prevElementsCount = currElementsCount;
          prevConnectionsLength = currConnectionsLength;
          prevPinCountFingerprint = currPinCountFingerprint;

          setTimeout(tick, 500);
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] WireObserver tick failed:`, err);
          setTimeout(tick, 1500);
        }
      }

      function uninstall() {
        stateMachineRunning = false;
        recordingActive = false;
        const paper = W.logic_designer?.paper;
        if (paper) {
          if (originalConnect) paper.__connect = originalConnect;
          if (originalDisconnectOutput) paper.__disconnect_output = originalDisconnectOutput;
        }
        originalConnect = null;
        originalDisconnectOutput = null;
        installed = false;
      }

      return { install, uninstall, suppressNextCreateFor, suppressNextRemoveFor, suppressNextFor };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  Move observer — wraps paper.__move_block so host-native block
    //  drag-to-move gestures push a 'move-batch' undo record. Contiguous
    //  calls within a short flush window coalesce into one batch so a
    //  single drag (including alt-drag-with-connected or multi-select
    //  drag, which fire one __move_block per affected block) undoes as
    //  one Ctrl+Z step.
    //
    //  The host's __move_block(block, x, y) snaps to a 10px grid via
    //  Math.round(coord/10)*10, sets block.set.transform absolutely
    //  (not by delta), and redraws every wire touching the block via
    //  paper.paper.connection(conn). Undo just calls __move_block with
    //  the recorded FROM coords — wires follow for free.
    // ═══════════════════════════════════════════════════════════════
    const MoveObserver = (() => {
      let originalMove = null;
      let installed = false;
      const SUPPRESS = new Set();      // refs whose next __move_block call is script-initiated (e.g. undo) — skip recording
      let pendingBatch = null;         // accumulator for contiguous calls
      let flushTimer = null;
      const FLUSH_MS = 50;             // coalesce window — generous given probe-2 showed sub-ms gaps between back-to-back calls

      function snap(coord) {
        return Math.round(coord / 10) * 10;
      }

      function flush() {
        if (pendingBatch && pendingBatch.length > 0) {
          undoHistory.push({
            type: 'move-batch',
            timestamp: new Date().toISOString(),
            payload: { moves: pendingBatch },
          });
        }
        pendingBatch = null;
        flushTimer = null;
      }

      function record(move) {
        if (!pendingBatch) pendingBatch = [];
        // If the same ref shows up twice in one batch (rare; nested host call),
        // keep the FIRST `from` and the LAST `to` so undo restores the original.
        const existing = pendingBatch.find((m) => m.ref === move.ref);
        if (existing) {
          existing.to = move.to;
        } else {
          pendingBatch.push(move);
        }
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, FLUSH_MS);
      }

      function install() {
        if (installed) return;
        const paper = W.logic_designer?.paper;
        // Defer until host is ready (matches WireObserver's gate). Without
        // this, install runs at script-bootstrap when paper.initialized may
        // still be false and the wrap silently no-ops forever.
        if (!paper || paper.initialized !== true || typeof paper.__move_block !== 'function') {
          setTimeout(install, 500);
          return;
        }
        originalMove = paper.__move_block;
        paper.__move_block = function (block, x, y) {
          const ref = block?.pointer;
          // Capture FROM before host overwrites it. The matrix on the main
          // shape already reflects host's previous snapped coords.
          const main = block?.set?.items?.[0];
          const fromX = (main && main.matrix && typeof main.matrix.e === 'number') ? main.matrix.e : null;
          const fromY = (main && main.matrix && typeof main.matrix.f === 'number') ? main.matrix.f : null;
          const result = originalMove.call(this, block, x, y);
          try {
            if (ref != null && fromX != null && fromY != null && !SUPPRESS.has(ref)) {
              const toX = snap(typeof x === 'number' ? x : fromX);
              const toY = snap(typeof y === 'number' ? y : fromY);
              if (fromX !== toX || fromY !== toY) {
                record({ ref, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } });
              }
            }
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] MoveObserver record failed:`, err);
          }
          SUPPRESS.delete(ref);
          return result;
        };
        installed = true;
      }

      function uninstall() {
        if (!installed) return;
        const paper = W.logic_designer?.paper;
        if (paper && originalMove) paper.__move_block = originalMove;
        originalMove = null;
        installed = false;
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        pendingBatch = null;
        SUPPRESS.clear();
      }

      function suppressNextFor(ref) {
        if (ref != null) SUPPRESS.add(ref);
      }

      return { install, uninstall, suppressNextFor };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  Clipboard store — wraps GM_setValue / GM_getValue
    // ═══════════════════════════════════════════════════════════════

    const ClipboardStore = {
      save(snapshot) {
        try {
          GM_setValue(STORE_KEY, JSON.stringify(snapshot));
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] clipboard save failed:`, err);
        }
      },
      load() {
        try {
          const raw = GM_getValue(STORE_KEY, null);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || parsed.version !== 1) return null;
          return parsed;
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] clipboard load failed:`, err);
          return null;
        }
      },
    };

    // ═══════════════════════════════════════════════════════════════
    //  Toast — transient bottom-right message
    // ═══════════════════════════════════════════════════════════════

    function toast(message, kind = 'info') {
      const el = document.createElement('div');
      el.textContent = message;
      el.className = `ldscp-toast ldscp-toast-${kind}`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Copy action — gathers selection, builds snapshot, persists.
    // ═══════════════════════════════════════════════════════════════

    function doCopy() {
      try {
        const sel = HostAdapter.getSelection();
        if (!sel || sel.length === 0) {
          toast('Select something to copy.');
          return;
        }
        const nodes = sel.map((ref) => {
          const d = HostAdapter.getNodeData(ref);
          return {
            ref,
            type: d.type,
            position: HostAdapter.getNodePosition(ref),
            data: d,
          };
        });
        const wires = HostAdapter.getInternalWires(sel);
        const snap = buildSnapshot({ nodes, wires });
        snap.cursorAnchor = clientToSvgWorld(lastCursorClient);
        ClipboardStore.save(snap);
        latestSelectionRefs = sel.slice();
        toast(`Copied ${snap.nodes.length} nodes, ${snap.wires.length} wires.`);
      } catch (err) {
        console.error(`[${SCRIPT_NAME}] copy failed:`, err);
        toast('Copy failed (see console).', 'error');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  applySnapshotAt — shared commit path for Ctrl+V offset paste
    //  and Ctrl+B ghost paste. Materializes the snapshot at the given
    //  basePos (designer-space). Records a 'paste' undo entry.
    // ═══════════════════════════════════════════════════════════════
    //
    // basePos semantics: the snapshot stores each node's original position.
    // We compute a translation vector `delta = basePos - snapshotOriginAnchor`,
    // where `snapshotOriginAnchor` is supplied by the caller:
    //   - Ctrl+V: snapshotOriginAnchor = nodes[0].position, basePos = nodes[0].position + PASTE_OFFSET
    //     -> delta = PASTE_OFFSET (original behavior).
    //   - Ctrl+B: snapshotOriginAnchor = the chosen anchor node's position (or bbox top-left),
    //     basePos = cursorDesignerCoords -> delta = cursor - anchor.
    //
    // Returns { okNodes, okWires, totalRequestedNodes, totalRequestedWires,
    //          createdRefs, nodeFailures, wireFailures } for the caller to toast on.
    function applySnapshotAt({ snapshot, snapshotOriginAnchor, basePos }) {
      const delta = {
        x: basePos.x - snapshotOriginAnchor.x,
        y: basePos.y - snapshotOriginAnchor.y,
      };

      const nodes = JSON.parse(JSON.stringify(snapshot.nodes));
      for (const n of nodes) {
        n.position.x += delta.x;
        n.position.y += delta.y;
      }

      const localToRef = new Map();
      const nodeFailures = [];

      for (const n of nodes) {
        try {
          const ref = HostAdapter.createNode({
            type: n.type,
            position: n.position,
            payload: n.data,
          });
          localToRef.set(n.localId, ref);
        } catch (err) {
          nodeFailures.push({ localId: n.localId, type: n.type, err: String(err) });
          console.error(`[${SCRIPT_NAME}] createNode failed for ${n.localId} (${n.type}):`, err);
        }
      }

      const wireFailures = [];
      for (const w of snapshot.wires) {
        const fromNode = localToRef.get(w.from.nodeLocalId);
        const toNode = localToRef.get(w.to.nodeLocalId);
        if (fromNode == null || toNode == null) {
          wireFailures.push({ wire: w, reason: 'endpoint node was not created' });
          continue;
        }
        try {
          HostAdapter.createWire({
            fromNode, fromPin: w.from.pin,
            toNode, toPin: w.to.pin,
          });
        } catch (err) {
          wireFailures.push({ wire: w, reason: String(err) });
          console.error(`[${SCRIPT_NAME}] createWire failed:`, w, err);
        }
      }

      try {
        HostAdapter.setSelection(Array.from(localToRef.values()));
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] setSelection failed (non-fatal):`, err);
      }

      const createdRefs = Array.from(localToRef.values());
      if (createdRefs.length > 0) {
        undoHistory.push({
          type: 'paste',
          timestamp: new Date().toISOString(),
          payload: { nodeRefs: createdRefs },
        });
      }

      return {
        okNodes: localToRef.size,
        okWires: snapshot.wires.length - wireFailures.length,
        totalRequestedNodes: snapshot.nodes.length,
        totalRequestedWires: snapshot.wires.length,
        createdRefs,
        nodeFailures,
        wireFailures,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    //  Paste action — recreates the saved snapshot.
    // ═══════════════════════════════════════════════════════════════

    function doPaste() {
      const snap = ClipboardStore.load();
      if (!snap) {
        toast('Nothing to paste.');
        return;
      }
      if (!snap.nodes || snap.nodes.length === 0) {
        toast('Nothing to paste.');
        return;
      }

      // Original Ctrl+V behavior: anchor on nodes[0] and offset by PASTE_OFFSET.
      const anchor = snap.nodes[0].position;
      const basePos = { x: anchor.x + PASTE_OFFSET.x, y: anchor.y + PASTE_OFFSET.y };

      const result = applySnapshotAt({
        snapshot: snap,
        snapshotOriginAnchor: anchor,
        basePos,
      });

      const totalFails = result.nodeFailures.length + result.wireFailures.length;
      let msg = `Pasted ${result.okNodes} of ${result.totalRequestedNodes} nodes, `
              + `${result.okWires} of ${result.totalRequestedWires} wires.`;
      if (totalFails > 0) {
        msg += ` ${totalFails} failed (see console).`;
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Undo action — reverses the most recent paste or delete record.
    // ═══════════════════════════════════════════════════════════════

    function doUndo() {
      const record = undoHistory.pop();
      if (!record) {
        toast('Nothing to undo.');
        return;
      }
      if (record.type === 'paste') {
        undoPaste(record);
      } else if (record.type === 'delete') {
        undoDelete(record);
      } else if (record.type === 'multi-wire') {
        undoMultiWire(record);
      } else if (record.type === 'remove-batch') {
        undoRemoveBatch(record);
      } else if (record.type === 'wire-create') {
        undoWireCreate(record);
      } else if (record.type === 'wire-remove') {
        undoWireRemove(record);
      } else if (record.type === 'tag-paste') {
        undoTagPaste(record);
      } else if (record.type === 'move-batch') {
        undoMoveBatch(record);
      } else {
        console.warn(`[${SCRIPT_NAME}] unknown undo record type:`, record.type);
        toast('Unknown undo record (see console).', 'error');
      }
    }

    function undoMoveBatch(record) {
      const paper = W.logic_designer?.paper;
      if (!paper) {
        toast('Undo move: paper not ready.', 'error');
        return;
      }
      const moves = record.payload.moves || [];
      let ok = 0;
      const failures = [];
      for (const m of moves) {
        const block = paper.elements?.[m.ref];
        if (!block) {
          failures.push({ ref: m.ref, reason: 'block no longer exists' });
          continue;
        }
        try {
          MoveObserver.suppressNextFor(m.ref);
          paper.__move_block(block, m.from.x, m.from.y);
          ok++;
        } catch (err) {
          failures.push({ ref: m.ref, reason: String(err) });
          console.error(`[${SCRIPT_NAME}] undoMoveBatch failed for ref ${m.ref}:`, err);
        }
      }
      const noun = moves.length === 1 ? 'block' : 'blocks';
      let msg = `Undid move: ${ok} of ${moves.length} ${noun} restored.`;
      if (failures.length > 0) {
        msg += ` ${failures.length} failed (see console).`;
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    function undoPaste(record) {
      const paper = W.logic_designer?.paper;
      const requested = record.payload.nodeRefs;
      const live = requested.filter((ref) => paper?.elements?.[ref] != null);
      if (live.length === 0) {
        toast('Nothing to undo (refs stale).');
        return;
      }
      const failures = [];
      for (const ref of live) {
        try {
          HostAdapter.deleteNode(ref);
        } catch (err) {
          failures.push({ ref, err: String(err) });
          console.error(`[${SCRIPT_NAME}] deleteNode failed for ${ref}:`, err);
        }
      }
      const ok = live.length - failures.length;
      let msg = `Undid paste: ${ok} of ${requested.length} nodes removed.`;
      if (failures.length > 0) {
        msg += ` ${failures.length} failed (see console).`;
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    function undoDelete(record) {
      const { blocks, wires } = record.payload;
      const oldToNew = new Map();
      const blockFailures = [];

      for (const b of blocks) {
        try {
          const newRef = HostAdapter.createNode({
            type: b.type,
            position: b.position,
            payload: b.payload,
          });
          oldToNew.set(b.ref, newRef);
        } catch (err) {
          blockFailures.push({ ref: b.ref, type: b.type, err: String(err) });
          console.error(`[${SCRIPT_NAME}] undoDelete createNode failed for ${b.ref} (${b.type}):`, err);
        }
      }

      const wireFailures = [];
      const paper = W.logic_designer?.paper;
      for (const w of wires) {
        // Translate either-side ref: if endpoint was deleted, use the new ref;
        // otherwise use the original (it's a surviving external block).
        const fromNode = oldToNew.get(w.from.node) ?? w.from.node;
        const toNode = oldToNew.get(w.to.node) ?? w.to.node;
        // Skip if either endpoint is now missing (failed recreate or
        // surviving block has since been deleted by other means).
        if (!paper?.elements?.[fromNode] || !paper.elements?.[toNode]) {
          wireFailures.push({ wire: w, reason: 'endpoint missing' });
          continue;
        }
        try {
          HostAdapter.createWire({ fromNode, fromPin: w.from.pin, toNode, toPin: w.to.pin });
        } catch (err) {
          wireFailures.push({ wire: w, reason: String(err) });
          console.error(`[${SCRIPT_NAME}] undoDelete createWire failed:`, w, err);
        }
      }

      try {
        HostAdapter.setSelection(Array.from(oldToNew.values()));
      } catch (err) {
        console.warn(`[${SCRIPT_NAME}] setSelection failed (non-fatal):`, err);
      }

      const okBlocks = oldToNew.size;
      const okWires = wires.length - wireFailures.length;
      let msg = `Restored ${okBlocks} of ${blocks.length} blocks, ${okWires} of ${wires.length} wires.`;
      const totalFails = blockFailures.length + wireFailures.length;
      if (totalFails > 0) {
        msg += ` ${totalFails} failed (see console).`;
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    function undoMultiWire(record) {
      const { createdWires, disconnectedWires } = record.payload;
      // expansions handled below (forwards/backwards-compat)
      const deleteFailures = [];
      const restoreFailures = [];

      // 1. Delete created wires.
      for (const w of createdWires) {
        try {
          HostAdapter.disconnectWire({ toNode: w.to.node, toPin: w.to.pin });
        } catch (err) {
          deleteFailures.push({ wire: w, err: String(err) });
          console.error(`[${SCRIPT_NAME}] undoMultiWire disconnectWire failed:`, w, err);
        }
      }

      // 2. Restore disconnected wires.
      for (const w of disconnectedWires) {
        try {
          HostAdapter.createWire({
            fromNode: w.from.node, fromPin: w.from.pin,
            toNode: w.to.node, toPin: w.to.pin,
          });
        } catch (err) {
          restoreFailures.push({ wire: w, err: String(err) });
          console.error(`[${SCRIPT_NAME}] undoMultiWire createWire failed:`, w, err);
        }
      }

      // 3. Shrink any expansions made (multi-target may have multiple).
      const expansionsArr = Array.isArray(record.payload.expansions)
        ? record.payload.expansions
        : (record.payload.expansion ? [record.payload.expansion] : []); // backwards-compat
      for (const exp of expansionsArr) {
        try {
          HostAdapter.setBlockInputCount(exp.ref, exp.oldCount);
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] undoMultiWire setBlockInputCount failed:`, err);
        }
      }

      const okDeleted = createdWires.length - deleteFailures.length;
      const okRestored = disconnectedWires.length - restoreFailures.length;
      const totalFails = deleteFailures.length + restoreFailures.length;
      let msg = `Undid multi-wire: ${okDeleted} wires removed, ${okRestored} wires restored.`;
      if (totalFails > 0) {
        msg += ` ${totalFails} failed (see console).`;
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    function undoWireCreate(record) {
      const { to } = record.payload;
      try {
        WireObserver.suppressNextRemoveFor({ toNode: to.node, toPin: to.pin });
        HostAdapter.disconnectWire({ toNode: to.node, toPin: to.pin });
        toast('Undid wire add.');
      } catch (err) {
        console.error(`[${SCRIPT_NAME}] undoWireCreate failed:`, err);
        toast('Undo wire add failed (see console).', 'error');
      }
    }

    function undoWireRemove(record) {
      const { from, to } = record.payload;
      try {
        WireObserver.suppressNextCreateFor({ toNode: to.node, toPin: to.pin });
        HostAdapter.createWire({ fromNode: from.node, fromPin: from.pin, toNode: to.node, toPin: to.pin });
        toast('Undid wire delete.');
      } catch (err) {
        console.error(`[${SCRIPT_NAME}] undoWireRemove failed:`, err);
        toast('Undo wire delete failed (see console).', 'error');
      }
    }

    function undoRemoveBatch(record) {
      const { wires } = record.payload;
      const failures = [];
      for (const w of wires) {
        try {
          WireObserver.suppressNextCreateFor({ toNode: w.to.node, toPin: w.to.pin });
          HostAdapter.createWire({ fromNode: w.from.node, fromPin: w.from.pin, toNode: w.to.node, toPin: w.to.pin });
        } catch (err) {
          failures.push({ wire: w, err: String(err) });
          console.error(`[${SCRIPT_NAME}] undoRemoveBatch failed:`, w, err);
        }
      }
      const ok = wires.length - failures.length;
      let msg = `Undid remove: ${ok} wire${ok === 1 ? '' : 's'} restored.`;
      if (failures.length > 0) {
        msg += ` ${failures.length} failed (see console).`;
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Paste tags — bulk-update driver_ids on selected PARAMV /
    //  WRITETOUNIT blocks via an inline textarea panel. v1.5.0.
    //  openPasteTagsPanel and applyTagPaste are defined inside
    //  mountLauncher to share closeMenu closure scope.
    // ═══════════════════════════════════════════════════════════════

    function undoTagPaste(record) {
      const { updates } = record.payload;
      const paper = W.logic_designer?.paper;
      if (!paper) {
        toast('Undo tag paste: paper not ready.', 'error');
        return;
      }
      const failures = [];
      for (const u of updates) {
        try {
          paper.set_block_data(u.ref, u.oldData);
          // Restore the visible label too (we set it to the driver_id on apply).
          if (typeof u.oldAliasText === 'string') {
            paper.set_block_override(u.ref, 'alias_text', u.oldAliasText);
          }
        } catch (err) {
          failures.push({ ref: u.ref, err: String(err) });
          console.error(`[${SCRIPT_NAME}] undoTagPaste failed for ${u.ref}:`, err);
        }
      }
      const ok = updates.length - failures.length;
      let msg = `Undid tag paste: ${ok} block${ok === 1 ? '' : 's'} restored.`;
      if (failures.length > 0) {
        msg += ` ${failures.length} failed (see console).`;
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Multi-wire orchestrator — pair sources across one or more
    //  targets, create wires. v3: accepts targets[] array; v1.3.0's
    //  single-target signature is supported by passing targets: [one].
    // ═══════════════════════════════════════════════════════════════

    function doMultiWire({ sources, targets }) {
      const paper = W.logic_designer?.paper;
      if (!paper?.elements) {
        toast('Multi-wire: paper not ready.', 'error');
        return;
      }
      if (!Array.isArray(targets) || targets.length === 0) {
        toast('Multi-wire: no target.', 'error');
        return;
      }

      // Slice sources across targets by visual y.
      const targetDescriptorsForSlicer = targets.map((t) => {
        const el = paper.elements[t.blockRef];
        const pinsArr = t.side === 'input' ? el?.inputs : el?.outputs;
        const pinCount = Array.isArray(pinsArr) ? pinsArr.length : 0;
        // y is now passed in by the caller (pin-derived, not block.matrix).
        // Fallback to 0 if absent (e.g. older single-target call sites that
        // don't set y — they only pass one target so the sort is a no-op).
        const y = typeof t.y === 'number' ? t.y : 0;
        return { ...t, pinCount, y };
      });
      const distribution = distributeSourcesAcrossTargets({ sources, targets: targetDescriptorsForSlicer });

      // Per-target: build targetPins, compute pairing, apply.
      const createdWires = [];
      const disconnectedWires = [];
      const expansions = [];
      const wireFailures = [];
      let totalPaired = 0;
      let totalUnpaired = 0;
      let totalSkipped = 0;

      for (const slice of distribution.slices) {
        if (slice.sources.length === 0) continue;
        const t = slice.target;
        const targetEl = paper.elements[t.blockRef];
        if (!targetEl) {
          console.warn(`[${SCRIPT_NAME}] doMultiWire: target block ${t.blockRef} missing.`);
          totalUnpaired += slice.sources.length;
          continue;
        }
        const targetPinsArr = t.side === 'input' ? targetEl.inputs : targetEl.outputs;
        if (!Array.isArray(targetPinsArr) || targetPinsArr.length === 0) {
          totalUnpaired += slice.sources.length;
          continue;
        }
        const targetPins = targetPinsArr.map((p, i) => ({ connected: !!p?.connected, pinIndex: i }));
        let expandableMax = null;
        if (!t.noExpand && t.side === 'input' && targetEl.config?.expandable_inputs) {
          expandableMax = typeof targetEl.config.maximum_inputs === 'number' ? targetEl.config.maximum_inputs : null;
        }

        // Rule A: skip sources whose output already feeds this target block (any pin).
        // Applies both 'output' sourceSide (multi-fanout output) and 'input' (single-wire input).
        const filteredSlice = slice.sources.filter((s) => {
          const srcEl = paper.elements[s.blockRef];
          if (!srcEl) return false;
          if (s.side === 'output') {
            const out = srcEl.outputs?.[s.pinIndex];
            if (!out?.connected_to || typeof out.connected_to !== 'object') return true;
            for (const k of Object.keys(out.connected_to)) {
              if (out.connected_to[k]?.ref === t.blockRef) return false;
            }
            return true;
          }
          // sourceSide === 'input': single connection
          const inp = srcEl.inputs?.[s.pinIndex];
          if (!inp?.connected_to) return true;
          return inp.connected_to.ref !== t.blockRef;
        });
        const skippedThisTarget = slice.sources.length - filteredSlice.length;
        totalSkipped += skippedThisTarget;

        const sortedSlice = [...filteredSlice].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
        const result = pairSourcesToTargets({
          sources: sortedSlice,
          targetBlockRef: t.blockRef,
          targetPins,
          targetSide: t.side,
          startPin: t.startPin,
          targetIsPinClick: t.isPinClick,
          expandableMax,
        });
        if (result.expansionNeeded) {
          const oldCount = targetPinsArr.length;
          try {
            HostAdapter.setBlockInputCount(t.blockRef, result.expansionNeeded.newCount);
            expansions.push({ ref: t.blockRef, oldCount, newCount: result.expansionNeeded.newCount });
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] setBlockInputCount failed for ${t.blockRef}:`, err);
            totalUnpaired += sortedSlice.length;
            continue;
          }
        }

        for (const occ of result.occupiedToDisconnect) {
          const dstEl = paper.elements[occ.dstRef];
          const inp = dstEl?.inputs?.[occ.dstPin];
          const ct = inp?.connected_to;
          const oldFromRef = typeof ct?.ref === 'number' ? ct.ref : null;
          const oldFromPin = typeof ct?.put_id === 'number' ? ct.put_id : 0;
          try {
            WireObserver.suppressNextRemoveFor({ toNode: occ.dstRef, toPin: occ.dstPin });
            const removed = HostAdapter.disconnectWire({ toNode: occ.dstRef, toPin: occ.dstPin });
            if (removed && oldFromRef !== null) {
              disconnectedWires.push({
                from: { node: oldFromRef, pin: oldFromPin },
                to: { node: occ.dstRef, pin: occ.dstPin },
              });
            }
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] disconnectWire failed for ${occ.dstRef}:${occ.dstPin}:`, err);
          }
        }

        for (const p of result.pairs) {
          const fromNode = p.srcSide === 'output' ? p.srcRef : p.dstRef;
          const fromPin = p.srcSide === 'output' ? p.srcPin : p.dstPin;
          const toNode = p.srcSide === 'output' ? p.dstRef : p.srcRef;
          const toPin = p.srcSide === 'output' ? p.dstPin : p.srcPin;
          try {
            WireObserver.suppressNextCreateFor({ toNode, toPin });
            HostAdapter.createWire({ fromNode, fromPin, toNode, toPin });
            createdWires.push({ from: { node: fromNode, pin: fromPin }, to: { node: toNode, pin: toPin } });
          } catch (err) {
            wireFailures.push({ pair: p, err: String(err) });
            console.error(`[${SCRIPT_NAME}] multi-wire createWire failed:`, p, err);
          }
        }
        totalPaired += result.pairs.length;
        totalUnpaired += result.unpaired;
      }

      // Push undo record.
      if (createdWires.length > 0 || disconnectedWires.length > 0 || expansions.length > 0) {
        undoHistory.push({
          type: 'multi-wire',
          timestamp: new Date().toISOString(),
          payload: { createdWires, disconnectedWires, expansions },
        });
      }

      // Toast summary.
      const totalRequested = totalPaired + totalUnpaired + distribution.unassigned + totalSkipped;
      let msg = `Wired ${createdWires.length} of ${totalRequested} pairs.`;
      if (disconnectedWires.length > 0) msg += ` Replaced ${disconnectedWires.length} existing.`;
      const totalLeft = totalUnpaired + distribution.unassigned;
      if (totalLeft > 0) msg += ` ${totalLeft} unpaired.`;
      if (totalSkipped > 0) msg += ` ${totalSkipped} skipped (already wired).`;
      if (wireFailures.length > 0) {
        msg += ` ${wireFailures.length} failed (see console).`;
        toast(msg, 'error');
      } else if (totalLeft > 0) {
        toast(msg, 'error');
      } else {
        toast(msg);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Styles
    // ═══════════════════════════════════════════════════════════════

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(`
        .ldscp-launcher {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 99999;
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(20, 20, 20, 0.92);
          color: #d4d4d4;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          cursor: pointer;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          transition: background 0.12s, color 0.12s;
        }
        .ldscp-launcher:hover { background: rgba(40, 40, 40, 0.96); color: #ffffff; }
        .ldscp-launcher svg { display: block; }
        .ldscp-alarm-pill {
          position: fixed;
          bottom: 56px;
          right: 16px;
          z-index: 99999;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 8px 5px 10px;
          background: rgba(140, 30, 30, 0.94);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 14px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
          user-select: none;
        }
        .ldscp-alarm-pill:hover { background: rgba(165, 40, 40, 0.96); }
        .ldscp-alarm-pill-label { white-space: nowrap; }
        .ldscp-alarm-pill-x {
          opacity: 0.7;
          font-size: 14px;
          line-height: 1;
          padding: 0 2px;
        }
        .ldscp-alarm-pill-x:hover { opacity: 1; }
        .ldscp-menu {
          position: fixed;
          right: 16px;
          bottom: 56px;
          z-index: 99999;
          min-width: 160px;
          padding: 4px;
          background: rgba(20, 20, 20, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          color: #d4d4d4;
        }
        .ldscp-menu[hidden] { display: none; }
        .ldscp-menu-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 10px;
          background: transparent;
          color: inherit;
          border: 0;
          border-radius: 4px;
          width: 100%;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .ldscp-menu-item:hover { background: rgba(255, 255, 255, 0.08); color: #ffffff; }
        .ldscp-menu-item[disabled] { opacity: 0.35; cursor: default; }
        .ldscp-menu-item svg { display: block; flex: 0 0 16px; }
        .ldscp-menu-item-kbd {
          margin-left: auto;
          opacity: 0.5;
          font-size: 11px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
        }
        .ldscp-toast {
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 99999;
          padding: 8px 12px;
          background: rgba(30, 30, 30, 0.92);
          color: #fff;
          font: 12px/1.3 sans-serif;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          pointer-events: none;
        }
        .ldscp-toast-error { background: rgba(140, 30, 30, 0.92); }
        .ldscp-mode-banner {
          position: fixed;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 99999;
          padding: 6px 14px;
          background: rgba(20, 20, 20, 0.92);
          color: #d4d4d4;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 4px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
        }
        .ldscp-wire-hover {
          stroke: #ff5555 !important;
          opacity: 0.85;
        }
        .ldscp-ghost-overlay,
        .ldscp-ghost-overlay * {
          pointer-events: none;
        }
        .ldscp-ghost-overlay {
          opacity: 0.45;
        }
        .ldscp-ghost-overlay-wire {
          stroke: #8ad;
          stroke-width: 2;
          stroke-dasharray: 4 3;
          fill: none;
        }
        .ldscp-paste-tags-panel {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 8px;
          min-width: 320px;
        }
        .ldscp-paste-tags-header {
          font-size: 13px;
          font-weight: 600;
          color: #d4d4d4;
        }
        .ldscp-paste-tags-mode {
          font-size: 11px;
          color: #9a9a9a;
          font-style: italic;
        }
        .ldscp-paste-tags-textarea {
          width: 100%;
          box-sizing: border-box;
          background: #1e1e1e;
          color: #d4d4d4;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 3px;
          padding: 6px 8px;
          font: 12px/1.4 monospace;
          resize: vertical;
          outline: none;
        }
        .ldscp-paste-tags-textarea:focus {
          border-color: rgba(255, 165, 0, 0.6);
        }
        .ldscp-paste-tags-error {
          color: #ff7676;
          font-size: 12px;
          line-height: 1.3;
        }
        .ldscp-paste-tags-buttons {
          display: flex;
          gap: 6px;
          justify-content: flex-end;
        }
        .ldscp-paste-tags-btn {
          background: #2a2a2a;
          color: #d4d4d4;
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 5px 12px;
          font-size: 12px;
          border-radius: 3px;
          cursor: pointer;
        }
        .ldscp-paste-tags-btn:hover {
          background: #353535;
        }
        .ldscp-paste-tags-btn-primary {
          background: #2c5d8e;
          border-color: #3d7ab3;
        }
        .ldscp-paste-tags-btn-primary:hover {
          background: #357ab8;
        }
        .ldscp-sqo-arrow {
          float: right;
          margin: 0 8px;
          cursor: pointer;
          color: #ff8c00;
          user-select: none;
          font-size: 20px;
          font-weight: bold;
          line-height: 1;
          text-shadow: 0 0 2px rgba(0,0,0,0.6);
          transition: transform 0.12s, color 0.12s;
        }
        .ldscp-sqo-arrow:hover { color: #ffc04d; }
        .ldscp-sqo-arrow.ldscp-sqo-open { transform: rotate(180deg); }
        .ldscp-sqo-list {
          max-height: 220px;
          overflow-y: auto;
          margin: 2px 0 6px 0;
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 4px;
        }
        .ldscp-sqo-item {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          padding: 3px 10px;
          cursor: pointer;
          color: #f0f0f0;
          font-size: 11px;
          line-height: 1.4;
        }
        .ldscp-sqo-item + .ldscp-sqo-item { border-top: 1px solid rgba(255, 255, 255, 0.06); }
        .ldscp-sqo-item:hover { background: rgba(255, 179, 0, 0.18); color: #fff; }
        .ldscp-sqo-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ldscp-sqo-meta { color: #d0d0d0; white-space: nowrap; flex: 0 0 auto; font-size: 9px; }
        .ldscp-sqo-empty, .ldscp-sqo-error { padding: 6px 12px; color: #c0c0c0; font-size: 13px; }
        .ldscp-sqo-error { color: #e8857a; }
      `);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Launcher + popup menu (bottom-right). Future features add menu items
    //  without needing more UI work.
    // ═══════════════════════════════════════════════════════════════

    function makeMenuItem(icon, label, kbd, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ldscp-menu-item';
      // Icon is a hardcoded SVG string — innerHTML is safe.
      // Label and kbd are text-typed via textContent so a future caller can
      // pass dynamic strings without XSS.
      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = icon;
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      btn.appendChild(iconSpan);
      btn.appendChild(labelSpan);
      if (kbd) {
        const kbdSpan = document.createElement('span');
        kbdSpan.className = 'ldscp-menu-item-kbd';
        kbdSpan.textContent = kbd;
        btn.appendChild(kbdSpan);
      }
      btn.addEventListener('click', onClick);
      return btn;
    }

    function mountLauncher() {
      const launcher = document.createElement('button');
      launcher.type = 'button';
      launcher.className = 'ldscp-launcher';
      launcher.title = 'Logic Designer Section Copy/Paste';
      launcher.innerHTML = MENU_ICON;

      const menu = document.createElement('div');
      menu.className = 'ldscp-menu';
      menu.hidden = true;
      menu.appendChild(makeMenuItem(COPY_ICON, 'Copy section', 'Ctrl+C', () => {
        closeMenu();
        doCopy();
      }));
      menu.appendChild(makeMenuItem(PASTE_ICON, 'Paste section', 'Ctrl+V', () => {
        closeMenu();
        doPaste();
      }));
      const undoItem = makeMenuItem(UNDO_ICON, 'Undo', 'Ctrl+Z', () => {
        closeMenu();
        doUndo();
      });
      menu.appendChild(undoItem);
      const multiwireItem = makeMenuItem(MULTIWIRE_ICON, 'Multi-wire', SHORTCUTS.MULTIWIRE.label, () => {
        closeMenu();
        MultiWireMode.toggle();
      });
      menu.appendChild(multiwireItem);
      const removeItem = makeMenuItem(REMOVE_ICON, 'Remove connectors', SHORTCUTS.REMOVE.label, () => {
        closeMenu();
        RemoveConnectorsMode.toggle();
      });
      menu.appendChild(removeItem);
      const pasteTagsItem = makeMenuItem(TAG_ICON, 'Paste tags', null, () => {
        openPasteTagsPanel();
      });
      menu.appendChild(pasteTagsItem);

      // Build the Paste-tags panel ONCE as a hidden child of the menu.
      // Toggled by openPasteTagsPanel / closeMenu; never destroyed.
      const tagsPanel = document.createElement('div');
      tagsPanel.className = 'ldscp-paste-tags-panel';
      tagsPanel.style.display = 'none';

      const tagsHeader = document.createElement('div');
      tagsHeader.className = 'ldscp-paste-tags-header';
      tagsHeader.textContent = 'Paste tags (one driver_id per line)';
      tagsPanel.appendChild(tagsHeader);

      const tagsMode = document.createElement('div');
      tagsMode.className = 'ldscp-paste-tags-mode';
      tagsPanel.appendChild(tagsMode);

      const tagsTextarea = document.createElement('textarea');
      tagsTextarea.className = 'ldscp-paste-tags-textarea';
      tagsTextarea.rows = 8;
      tagsTextarea.spellcheck = false;
      tagsTextarea.placeholder = '8830_S7MODBUS_..._3_0.10\n8830_S7MODBUS_..._3_0.11\n...';
      tagsPanel.appendChild(tagsTextarea);

      const tagsError = document.createElement('div');
      tagsError.className = 'ldscp-paste-tags-error';
      tagsError.style.display = 'none';
      tagsPanel.appendChild(tagsError);

      const tagsButtons = document.createElement('div');
      tagsButtons.className = 'ldscp-paste-tags-buttons';

      const tagsCancelBtn = document.createElement('button');
      tagsCancelBtn.type = 'button';
      tagsCancelBtn.className = 'ldscp-paste-tags-btn';
      tagsCancelBtn.textContent = 'Cancel';
      tagsCancelBtn.addEventListener('click', () => { closeMenu(); });
      tagsButtons.appendChild(tagsCancelBtn);

      const tagsApplyBtn = document.createElement('button');
      tagsApplyBtn.type = 'button';
      tagsApplyBtn.className = 'ldscp-paste-tags-btn ldscp-paste-tags-btn-primary';
      tagsApplyBtn.textContent = 'Apply';
      tagsApplyBtn.addEventListener('click', () => {
        const lines = tagsTextarea.value.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
        const result = applyTagPaste(lines);
        if (result.ok) {
          closeMenu();
        } else {
          tagsError.textContent = result.error;
          tagsError.style.display = 'block';
        }
      });
      tagsButtons.appendChild(tagsApplyBtn);
      tagsPanel.appendChild(tagsButtons);

      // Esc on the panel closes the menu.
      tagsPanel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      });

      menu.appendChild(tagsPanel);

      // closeMenu: restore all regular items, hide panel, hide menu.
      const closeMenu = () => {
        for (const item of menu.children) {
          if (item === tagsPanel) {
            item.style.display = 'none';
          } else {
            item.style.display = '';
          }
        }
        menu.hidden = true;
      };

      // openPasteTagsPanel: hide regular items, show panel, clear state, focus.
      function openPasteTagsPanel() {
        for (const item of menu.children) {
          if (item === tagsPanel) continue;
          item.style.display = 'none';
        }
        tagsTextarea.value = '';
        tagsError.style.display = 'none';
        tagsError.textContent = '';
        tagsMode.textContent = describePasteTagsMode();
        tagsPanel.style.display = '';
        setTimeout(() => tagsTextarea.focus(), 0);
      }

      // Inspect the current selection and describe which paste-tags mode
      // will apply. Single-block mode fires only when exactly one
      // WRITETOUNIT is selected; everything else falls back to 1-to-1.
      function describePasteTagsMode() {
        const paper = W.logic_designer?.paper;
        if (!paper?.elements) return 'Mode: paper not ready';
        const sel = HostAdapter.getSelection();
        const ELIGIBLE = new Set(['PARAMV', 'WRITETOUNIT']);
        let count = 0;
        let writeToUnitCount = 0;
        for (const ref of sel) {
          const el = paper.elements[ref];
          if (!el || !ELIGIBLE.has(el.block_type)) continue;
          count++;
          if (el.block_type === 'WRITETOUNIT') writeToUnitCount++;
        }
        if (count === 0) return 'Mode: no eligible blocks selected';
        if (count === 1 && writeToUnitCount === 1) {
          return 'Mode: fill one block with all driver_ids';
        }
        return `Mode: one driver_id per block (${count} selected)`;
      }

      // Performs the actual bulk-update. Returns { ok: bool, error?: string }.
      function applyTagPaste(lines) {
        if (lines.length === 0) {
          return { ok: false, error: 'No tag lines provided.' };
        }
        const paper = W.logic_designer?.paper;
        if (!paper?.elements) {
          return { ok: false, error: 'Paper not ready.' };
        }
        const sel = HostAdapter.getSelection();
        const ELIGIBLE = new Set(['PARAMV', 'WRITETOUNIT']);
        const eligible = [];
        for (const ref of sel) {
          const el = paper.elements[ref];
          if (!el) continue;
          if (!ELIGIBLE.has(el.block_type)) continue;
          const m = el?.set?.items?.[0]?.matrix;
          const y = (m && typeof m.f === 'number') ? m.f : 0;
          eligible.push({
            ref,
            y,
            blockType: el.block_type,
            oldData: el.data ? JSON.parse(JSON.stringify(el.data)) : {},
            oldAliasText: el.override?.alias_text ?? null,
          });
        }
        if (eligible.length === 0) {
          return { ok: false, error: 'No PARAMV or WRITETOUNIT in selection.' };
        }

        // Single-block mode: 1 WRITETOUNIT selected → fill its driver_ids
        // array with every pasted line. alias_text is left alone (no single
        // value would be honest for a multi-driver write).
        const isSingleBlockMode = (
          eligible.length === 1 && eligible[0].blockType === 'WRITETOUNIT'
        );
        if (isSingleBlockMode) {
          const { ref, oldData, oldAliasText } = eligible[0];
          const newData = { ...oldData, driver_ids: lines.slice() };
          try {
            paper.set_block_data(ref, newData);
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] set_block_data failed for ${ref}:`, err);
            return { ok: false, error: 'Write failed (see console).' };
          }
          undoHistory.push({
            type: 'tag-paste',
            timestamp: new Date().toISOString(),
            payload: { updates: [{ ref, oldData, oldAliasText }] },
          });
          toast(`Tagged 1 block with ${lines.length} driver_id${lines.length === 1 ? '' : 's'}.`);
          return { ok: true };
        }

        if (eligible.length !== lines.length) {
          return {
            ok: false,
            error: `${eligible.length} PARAMV/WRITETOUNIT selected but ${lines.length} lines. Adjust and retry.`,
          };
        }
        eligible.sort((a, b) => a.y - b.y);
        const updates = [];
        for (let i = 0; i < eligible.length; i++) {
          const { ref, oldData, oldAliasText } = eligible[i];
          const newDriverId = lines[i];
          const newData = { ...oldData, driver_ids: [newDriverId] };
          try {
            paper.set_block_data(ref, newData);
            // Refresh the visible label. The "true" friendly name (composed
            // from server-side unit lookup) is only known after the user
            // opens the host's edit dialog and clicks OK. Until then, show
            // the driver_id itself so the user can see the new binding and
            // knows which blocks still need their label re-resolved.
            paper.set_block_override(ref, 'alias_text', newDriverId);
            updates.push({ ref, oldData, oldAliasText });
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] set_block_data/override failed for ${ref}:`, err);
          }
        }
        if (updates.length === 0) {
          return { ok: false, error: 'All writes failed (see console).' };
        }
        undoHistory.push({
          type: 'tag-paste',
          timestamp: new Date().toISOString(),
          payload: { updates },
        });
        toast(`Tagged ${updates.length} block${updates.length === 1 ? '' : 's'}.`);
        return { ok: true };
      }
      const toggleMenu = (event) => {
        event.stopPropagation();
        if (menu.hidden) {
          // About to open — sync the undo item's disabled state.
          if (undoHistory.isEmpty()) {
            undoItem.setAttribute('disabled', '');
          } else {
            undoItem.removeAttribute('disabled');
          }
        }
        menu.hidden = !menu.hidden;
      };

      launcher.addEventListener('click', toggleMenu);
      // Click outside the menu closes it.
      document.addEventListener('click', (event) => {
        if (menu.hidden) return;
        if (menu.contains(event.target) || launcher.contains(event.target)) return;
        closeMenu();
      });
      // Esc closes it.
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !menu.hidden) closeMenu();
      });

      document.body.appendChild(launcher);
      document.body.appendChild(menu);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Keyboard shortcuts (Ctrl/Cmd + C / V on the canvas)
    // ═══════════════════════════════════════════════════════════════

    function isEditingText(target) {
      if (!target) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function hasTextSelection() {
      try {
        const sel = window.getSelection?.();
        return !!(sel && sel.toString().length > 0);
      } catch {
        return false;
      }
    }

    function installKeyboardShortcuts() {
      document.addEventListener('keydown', (event) => {
        // Esc cancels multi-wire mode (handled separately from Ctrl chord checks).
        if (event.key === 'Escape') {
          if (MultiWireMode.isActive()) {
            event.preventDefault();
            MultiWireMode.exit();
            return;
          }
          if (RemoveConnectorsMode.isActive()) {
            event.preventDefault();
            RemoveConnectorsMode.exit();
            return;
          }
          if (GhostPasteMode.isActive()) {
            event.preventDefault();
            GhostPasteMode.exit();
            return;
          }
        }

        // Shift+<key> mode toggles. Keys configured in SHORTCUTS at the top.
        // (No Ctrl/Alt/Meta modifiers.)
        if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (isEditingText(event.target)) return;
          const k = event.key.toLowerCase();
          if (k === SHORTCUTS.MULTIWIRE.key) {
            event.preventDefault();
            MultiWireMode.toggle();
            return;
          }
          if (k === SHORTCUTS.REMOVE.key) {
            event.preventDefault();
            RemoveConnectorsMode.toggle();
            return;
          }
        }

        const ctrl = event.ctrlKey || event.metaKey;
        if (!ctrl) return;
        if (event.altKey || event.shiftKey) return;
        if (isEditingText(event.target)) return;

        const key = event.key.toLowerCase();
        if (key === 'c') {
          if (hasTextSelection()) return;
          event.preventDefault();
          doCopy();
        } else if (key === 'v') {
          if (hasTextSelection()) return;
          event.preventDefault();
          doPaste();
        } else if (key === SHORTCUTS.PASTE_PLACE.key && SHORTCUTS.PASTE_PLACE.ctrl) {
          if (hasTextSelection()) return;
          event.preventDefault();
          GhostPasteMode.toggle();
        } else if (key === 'z') {
          // Ctrl+Z while any in-flight mode is active cancels the mode instead
          // of running undo. User intent: "abort the in-flight action," not
          // "step further back."
          if (MultiWireMode.isActive()) {
            event.preventDefault();
            MultiWireMode.exit();
            return;
          }
          if (RemoveConnectorsMode.isActive()) {
            event.preventDefault();
            RemoveConnectorsMode.exit();
            return;
          }
          if (GhostPasteMode.isActive()) {
            event.preventDefault();
            GhostPasteMode.exit();
            return;
          }
          // Intentionally no hasTextSelection() guard here: text selection
          // doesn't mean the user wants the browser's (nonexistent) page-text
          // undo. Our script-level undo is the only useful interpretation.
          event.preventDefault();
          doUndo();
        }
      }, true);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Sketch quick-open — augments the host "Get started!" dialog with
    //  a per-project arrow that lists the project's sketches and opens
    //  one directly. Reads logic_designer_manager (project/sketch RPC).
    //  Self-contained; no interaction with the canvas observers.
    // ═══════════════════════════════════════════════════════════════
    const SketchQuickOpen = (() => {
      // Project rows are <tr> in the splash dialog's PROJECTS table. Scope to
      // that table's id — the dialog also holds a Processes table (800+ rows)
      // sharing the .qxsTable_tr class; an unscoped selector grabs those too.
      const ROW_SEL = '#comp_application_windows_tbl_wnd_splash_projects tr.qxsTable_tr';
      const LISTROW_CLASS = 'ldscp-sqo-listrow';
      let projectsCache = null;   // load_project_list result, per dialog session
      const sketchCache = new Map(); // project_id -> sketch array, per dialog session

      function getPlantId() {
        if (W.plant_id != null) return String(W.plant_id);
        const u = new URLSearchParams(location.search).get('plant_id');
        return u != null ? String(u) : null;
      }

      function dialogVisible() {
        const box = document.getElementById('comp_application_windows_wnd_splash');
        return !!box && box.style.display !== 'none' && box.offsetParent !== null;
      }

      function findProjectRows() {
        if (!dialogVisible()) return [];
        return Array.from(document.querySelectorAll(ROW_SEL));
      }

      function clearCaches() {
        projectsCache = null;
        sketchCache.clear();
      }

      function ensureProjects(cb) {
        if (projectsCache) { cb(projectsCache); return; }
        const plantId = getPlantId();
        if (plantId == null) { cb([]); return; }
        try {
          W.logic_designer_manager.load_project_list(plantId, (projects) => {
            projectsCache = Array.isArray(projects) ? projects : [];
            cb(projectsCache);
          });
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] SketchQuickOpen load_project_list failed:`, err);
          cb([]);
        }
      }

      function attachArrow(row, projects) {
        if (isRowProcessed(row.dataset.ldscpSqo)) return;
        // row is a <tr>; its single cell's text is the project name. The
        // header row ("Project Name") matches no project -> id null -> skipped.
        const cell = row.querySelector('td');
        if (!cell) return; // header uses <th>; skip without marking (stays re-checkable)
        const projectId = matchProjectId(row.textContent, projects);
        row.dataset.ldscpSqo = '1';
        if (projectId == null) return; // can't resolve id -> no arrow, but row is marked

        const arrow = document.createElement('span');
        arrow.className = 'ldscp-sqo-arrow';
        arrow.textContent = '▾';
        arrow.title = 'Show sketches';
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          toggleList(row, projectId, arrow, cell);
        });
        cell.appendChild(arrow); // into the <td>, not the <tr> (span in tr won't render)
      }

      function attachArrows(rows, projects) {
        rows.forEach((row) => attachArrow(row, projects));
      }

      function onDialogPresent() {
        const rows = findProjectRows();
        if (rows.length === 0) return;
        ensureProjects((projects) => attachArrows(rows, projects));
      }

      function ensureSketches(projectId, cb) {
        if (sketchCache.has(projectId)) { cb(sketchCache.get(projectId)); return; }
        try {
          W.logic_designer_manager.load_sketch_list(projectId, (sketches) => {
            const arr = Array.isArray(sketches) ? sketches : [];
            sketchCache.set(projectId, arr);
            cb(arr);
          });
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] SketchQuickOpen load_sketch_list failed:`, err);
          cb(null); // null signals error (vs. [] = genuinely empty)
        }
      }

      function buildList(projectId, sketches) {
        const list = document.createElement('div');
        list.className = 'ldscp-sqo-list';
        if (sketches === null) {
          const e = document.createElement('div');
          e.className = 'ldscp-sqo-error';
          e.textContent = 'Failed to load sketches.';
          list.appendChild(e);
          return list;
        }
        if (sketches.length === 0) {
          const e = document.createElement('div');
          e.className = 'ldscp-sqo-empty';
          e.textContent = '(no sketches)';
          list.appendChild(e);
          return list;
        }
        sketches.forEach((sk) => {
          const entry = formatSketchEntry(sk);
          const item = document.createElement('div');
          item.className = 'ldscp-sqo-item';
          item.title = 'Open sketch';
          const nameEl = document.createElement('span');
          nameEl.className = 'ldscp-sqo-name';
          nameEl.textContent = entry.name;
          const metaEl = document.createElement('span');
          metaEl.className = 'ldscp-sqo-meta';
          // Last changed / last deployed, date-only (drop the HH:MM time and
          // seconds) — compact, one line.
          const day = (d) => d.split(' ')[0];
          metaEl.textContent = `chg ${day(entry.changed)} · dep ${day(entry.deployed)}`;
          item.appendChild(nameEl);
          item.appendChild(metaEl);
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            openSketch(projectId, entry.id);
          });
          list.appendChild(item);
        });
        return list;
      }

      // Wrap the list div in a <tr><td colspan> so it's a valid sibling row
      // of the project <tr> (a bare <div> can't sit between table rows).
      function makeListRow(row, list) {
        const tr = document.createElement('tr');
        tr.className = LISTROW_CLASS;
        const td = document.createElement('td');
        td.colSpan = row.cells ? row.cells.length || 1 : 1;
        td.appendChild(list);
        tr.appendChild(td);
        return tr;
      }

      function toggleList(row, projectId, arrow, cell) {
        // Collapse if our list-row is already showing. Find it by class
        // anywhere after the row (not just nextElementSibling — the host may
        // reorder rows), so collapse is robust.
        const existing = Array.from(row.parentNode.querySelectorAll(`tr.${LISTROW_CLASS}`))
          .find((tr) => tr.previousElementSibling === row);
        if (existing) { // collapse — pure DOM, no host interaction
          existing.remove();
          arrow.classList.remove('ldscp-sqo-open');
          return;
        }
        // Expand: select the project row first (qxs records selection on the
        // <td>; our stopPropagation suppressed the row's native select, and
        // the later splash-Ok needs a selected project). Only on expand, so
        // collapse stays a clean DOM op that the host can't perturb.
        if (cell) fireClick(cell);
        ensureSketches(projectId, (sketches) => {
          // re-check: user may have toggled again before the RPC returned
          const after = row.nextElementSibling;
          if (after && after.classList.contains(LISTROW_CLASS)) return;
          const listRow = makeListRow(row, buildList(projectId, sketches));
          row.parentNode.insertBefore(listRow, row.nextSibling);
          arrow.classList.add('ldscp-sqo-open');
        });
      }

      // Real click (mousedown→mouseup→click) on a host element. The qxs
      // widgets bind on these events; a bare .click() sometimes isn't enough.
      function fireClick(el) {
        if (!el) return false;
        // No `view:` — under the userscript sandbox `window` isn't the real
        // Window MouseEvent accepts, and it's optional for click dispatch.
        for (const type of ['mousedown', 'mouseup', 'click']) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        }
        return true;
      }

      // Hover an element (qxs top-menus open their dropdown on hover, not click).
      function fireHover(el) {
        if (!el) return false;
        for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        }
        return true;
      }

      // Poll up to ~tries*delayMs for fn() to return truthy, then cb(result|null).
      function pollFor(fn, cb, tries = 40, delayMs = 50) {
        const r = fn();
        if (r) { cb(r); return; }
        if (tries <= 0) { cb(null); return; }
        setTimeout(() => pollFor(fn, cb, tries - 1, delayMs), delayMs);
      }

      // Find a clickable element by visible text within a scope (default: document).
      function findByText(text, selector, scope) {
        const root = scope || document;
        const re = new RegExp(`^\\s*${text}\\s*$`, 'i');
        return Array.from(root.querySelectorAll(selector))
          .find((el) => re.test(el.textContent || el.value || '')) || null;
      }

      function openSketch(projectId, sketchId) {
        // DRIVE the host's native open click-for-click (PROBE16), then STOP at
        // the final Ok — the host runs the real load (composites, wires, error
        // screen). Manual paper.load replays dropped composites + corrupted
        // state, so we touch ZERO host APIs; we only click what a user clicks:
        //   splash Ok  ->  File menu  ->  "Load Sketch" item  ->  sketch row  ->  load-dialog Ok
        // Selecting a project then Ok runs ld.init()/paper.init() (project
        // open); File->Load Sketch opens the load dialog scoped to that project.
        const splash = document.getElementById('comp_application_windows_wnd_splash');
        const splashOk = splash && findByText('Ok', 'button.qxs_button_container, button', splash);
        if (!splashOk) { toast('Sketch open: splash Ok not found.', 'error'); return; }
        clearCaches();
        fireClick(splashOk); // -> project opens, splash closes

        // Open the File menu (qxs top-menus open on HOVER, not click), then
        // click its "Load Sketch" dropdown item (only in DOM once menu open).
        pollFor(
          () => findByText('File', '.iw_oc_menu_top_level, .iw_oc_menu_level'),
          (fileMenu) => {
            if (!fileMenu) { toast('Sketch open: File menu not found.', 'error'); return; }
            fireHover(fileMenu); fireClick(fileMenu);
            pollFor(
              () => Array.from(document.querySelectorAll('.iw_oc_menu_dropdown_item, [class*="dropdown_item"]'))
                .find((el) => /load sketch/i.test(el.textContent || '') && el.offsetParent !== null),
              (loadItem) => {
                if (!loadItem) { toast('Sketch open: "Load Sketch" item not found.', 'error'); return; }
                fireClick(loadItem);

                pollFor(
                  () => {
                    const win = document.getElementById('comp_application_windows_wnd_load');
                    if (!win || win.offsetParent === null) return null;
                    const row = Array.from(win.querySelectorAll('tr.qxsTable_tr')).find((r) => {
                      const idCell = r.querySelector('td');
                      return idCell && idCell.textContent.trim() === String(sketchId);
                    });
                    return row ? { win, row } : null;
                  },
                  (found) => {
                    if (!found) { toast('Sketch open: row not found in Load dialog.', 'error'); return; }
                    // The qxs table binds selection on the <td>, not the <tr>
                    // (PROBE15: clicking a cell set qxsTable_td_selected). Click
                    // the id cell so the dialog records the selected sketch.
                    const cell = found.row.querySelector('td') || found.row;
                    fireClick(cell);
                    // Give the table a tick to record selection, then Ok.
                    pollFor(
                      () => found.win.querySelector('.qxsTable_td_selected') || true,
                      () => {
                        const okBtn = findByText('Ok', 'button.qxs_button_container, button', found.win);
                        if (!okBtn) { toast('Sketch open: Load-dialog Ok not found.', 'error'); return; }
                        fireClick(okBtn); // host runs the full native open
                      },
                      4, 30
                    );
                  }
                );
              }
            );
          }
        );
      }

      function install() {
        if (!W.logic_designer_manager) {
          // Host RPC client absent — stay dormant, no error.
          return;
        }
        const mo = new MutationObserver(() => {
          if (dialogVisible()) onDialogPresent();
          else clearCaches();
        });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
      }

      return { install };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  AlarmHighlight — flash the block a "Virtual Values alarms" line
    //  refers to. Alarm token VV_<proj>_<sketch>:<pointer>:<line>; the
    //  <pointer> matches paper.elements[ref].pointer (the canvas "(NN)"
    //  label). No host alarm RPC exists, so we scrape the dialog DOM and
    //  retain the list so the "Errors: N" pill can re-flash after the
    //  dialog is closed. Strictly read-only — no host state mutated.
    //  Probed DOM (live, 2026-06-29): the alarm dialog is
    //  div#comp_application_window_problems_tbl_wnd_vv_alarms — a "problems"
    //  window, NOT a qxs_comlayer and NOT a comp_application_windows_wnd_*.
    //  Its rows are tr.qxsTable_tr; each Message cell holds a
    //  VV_<proj>_<sketch>:<pointer>:<line> token.
    // ═══════════════════════════════════════════════════════════════
    const AlarmHighlight = (() => {
      const ALARM_DIALOG_ID = 'comp_application_window_problems_tbl_wnd_vv_alarms';
      // The .qxs_window ancestor whose inline style toggles display:none → shown.
      // Stable id (no random suffix); observing only this element's style attr
      // means we wake on dialog open/close, NOT on every host canvas redraw.
      const ALARM_WINDOW_ID = 'comp_application_window_problems_wnd_vv_alarms';
      const ROW_TOKEN_RE = /VV_\d+_\d+:\d+:\d+/;

      let lastAlarms = [];       // [{ pointer, line, rowEl }]
      let pillEl = null;         // the fixed "Errors: N" pill
      const activeOverlays = []; // outstanding flash <rect>s, for cleanup

      // The alarm dialog by its stable id. offsetParent guards visibility —
      // the element exists (hidden) when the dialog is closed.
      function findAlarmDialog() {
        const dlg = document.getElementById(ALARM_DIALOG_ID);
        return dlg && dlg.offsetParent !== null ? dlg : null;
      }

      // Scan for the element whose .pointer equals the alarm's middle
      // number. Linear over ~tens of blocks — no index needed.
      function refByPointer(pointer) {
        const els = W.logic_designer?.paper?.elements;
        if (!els) return null;
        for (const k in els) {
          if (els[k] && els[k].pointer === pointer) return k;
        }
        return null;
      }

      // Draw an auto-fading orange rect around the block's main shape.
      function drawBlockOutline(ref) {
        const el = W.logic_designer?.paper?.elements?.[ref];
        const main = el?.set?.items?.[0];
        const node = main?.node;
        if (!node) return null;
        const svg = node.ownerSVGElement;
        if (!svg) return null;
        let box;
        try { box = node.getBBox(); } catch { return null; }
        // getBBox() is in the shape's LOCAL coords (pre-transform); the block
        // is positioned by a transform on the shape (matrix.e/f). Add that
        // translation so the rect lands ON the block, not at the SVG origin —
        // same pattern as drawPinOverlay (m.e/f + local coord).
        const m = main.matrix;
        const tx = (m && typeof m.e === 'number') ? m.e : 0;
        const ty = (m && typeof m.f === 'number') ? m.f : 0;
        const pad = 6;
        const ns = 'http://www.w3.org/2000/svg';
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(box.x + tx - pad));
        rect.setAttribute('y', String(box.y + ty - pad));
        rect.setAttribute('width', String(box.width + pad * 2));
        rect.setAttribute('height', String(box.height + pad * 2));
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', '#ffa500');
        rect.setAttribute('stroke-width', '3');
        rect.setAttribute('rx', '4');
        rect.style.pointerEvents = 'none';
        rect.style.transition = 'opacity 0.4s ease';
        svg.appendChild(rect);
        return rect;
      }

      function flash(ref) {
        if (ref == null) return;
        const rect = drawBlockOutline(ref);
        if (!rect) return;
        activeOverlays.push(rect);
        setTimeout(() => { rect.style.opacity = '0'; }, 1600);
        setTimeout(() => {
          rect.remove();
          const i = activeOverlays.indexOf(rect);
          if (i !== -1) activeOverlays.splice(i, 1);
        }, 2050);
      }

      function flashAll() {
        let missing = 0;
        for (const p of distinctPointers(lastAlarms)) {
          const ref = refByPointer(p);
          if (ref == null) { missing++; continue; }
          flash(ref);
        }
        if (missing > 0) {
          console.warn(`[${SCRIPT_NAME}] AlarmHighlight: ${missing} alarm block(s) not on this sketch.`);
        }
      }

      // Build lastAlarms from the open alarm dialog and wire each row to
      // flash its own block. Idempotent: rows already wired are skipped.
      function scrapeAlarms() {
        const dlg = findAlarmDialog();
        if (!dlg) return;
        const rows = Array.from(dlg.querySelectorAll('tr.qxsTable_tr'))
          .filter((tr) => ROW_TOKEN_RE.test(tr.textContent || ''));
        const next = [];
        for (const tr of rows) {
          const parsed = parseAlarmToken(tr.textContent);
          if (!parsed) continue;
          next.push({ pointer: parsed.pointer, line: parsed.line, rowEl: tr });
          if (tr.dataset.ldscpAlarm !== '1') {
            tr.dataset.ldscpAlarm = '1';
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => { flash(refByPointer(parsed.pointer)); });
          }
        }
        lastAlarms = next;
        renderPill();
      }

      function renderPill() {
        // Count alarm ROWS (what the dialog lists), not distinct blocks —
        // two alarms on the same block should read "Errors: 2". flashAll still
        // de-dupes by pointer so a shared block only flashes once.
        const count = lastAlarms.length;
        if (count === 0) {
          if (pillEl) { pillEl.remove(); pillEl = null; }
          return;
        }
        if (!pillEl) {
          pillEl = document.createElement('div');
          pillEl.className = 'ldscp-alarm-pill';
          pillEl.title = 'Flash blocks referenced by Virtual Values alarms';
          const label = document.createElement('span');
          label.className = 'ldscp-alarm-pill-label';
          label.addEventListener('click', flashAll);
          const close = document.createElement('span');
          close.className = 'ldscp-alarm-pill-x';
          close.textContent = '×';
          close.title = 'Dismiss';
          close.addEventListener('click', (e) => {
            e.stopPropagation();
            lastAlarms = [];
            renderPill();
          });
          pillEl.appendChild(label);
          pillEl.appendChild(close);
          document.body.appendChild(pillEl);
        }
        pillEl.querySelector('.ldscp-alarm-pill-label').textContent = `⚠ Errors: ${count}`;
      }

      function install() {
        // Observe ONLY the alarm window element's style attribute — it flips
        // display:none → shown on open. This avoids a page-wide observer that
        // would wake on every host canvas redraw. scrapeAlarms only runs when
        // the dialog is actually visible (findAlarmDialog guards on
        // offsetParent), so our own DOM writes can't loop it.
        const win = document.getElementById(ALARM_WINDOW_ID);
        if (!win) {
          // Not in the DOM yet — retry shortly (host builds dialogs lazily on
          // some loads). Bounded by the natural page lifetime; no busy loop.
          setTimeout(install, 1000);
          return;
        }
        const mo = new MutationObserver(() => {
          if (findAlarmDialog()) scrapeAlarms();
        });
        mo.observe(win, { attributes: true, attributeFilter: ['style'] });
      }

      return { install };
    })();

    // ═══════════════════════════════════════════════════════════════
    //  Bootstrap
    // ═══════════════════════════════════════════════════════════════

    mountLauncher();
    installCursorTracker();
    installKeyboardShortcuts();
    SelectionInterceptor.install();
    DeleteInterceptor.install();
    MultiWireMode.install();
    RemoveConnectorsMode.install();
    GhostPasteMode.install();
    WireObserver.install();
    MoveObserver.install();
    SketchQuickOpen.install();
    AlarmHighlight.install();

  })();
}

// ─── Node-only export footer (browser ignores this) ─────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildSnapshot, createUndoHistory, pairSourcesToTargets, classifyBlockPinDirection, distributeSourcesAcrossTargets, matchProjectId, formatSketchEntry, isRowProcessed, parseAlarmToken, distinctPointers };
}
