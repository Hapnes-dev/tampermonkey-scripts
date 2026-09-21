// ==UserScript==
// @name         Supermarket-superuser
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      5.0
// @description  filters, move mode, graphics lookup and batch editing of driver parameters, with Excel export
// @author       ØTS/MATS/Hapnes
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @match        *.plants.iwmac.local:8080/supermarket/*
// @match        *www.iwmac.local/supermarket/*
// @match        *iwmac.net/supermarket/*
// @match        *:81/supermarket/*
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/supermarket-superuser/Supermarket-superuser.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/supermarket-superuser/Supermarket-superuser.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const POC_STYLE_ID = 'sm_params_poc_style';
    // MÅ følge @version: brukes som `__SM_POC_WATCHER_VERSION`-nøkkel. Lik verdi i to installerte
    // kopier ville fått den andre til å hoppe over hele watcher-oppsettet (ingen kontekstmeny).
    const SCRIPT_VERSION = '5.0';
    const FILTER_PORTAL_ID = 'sm-poc-filter-portal';
    const GHOST_PORTAL_ID = 'sm-poc-ghost-portal';
    const UNIT_PORTAL_ID = 'sm-poc-unit-portal';
    const ALL_PARAMS_PORTAL_ID = 'sm-poc-all-params-portal';
    const ALL_PARAMS_BUTTON_ID = 'sm-poc-all-params-btn';
    const ALL_PARAMS_VIEW_ID = 'sm-poc-all-params-view';
    const UNIT_COMBO_CLASS = 'sm-poc-unit-combo';
    const SELECTED_CLASS = 'sm-poc-row-selected';
    const DRAGGING_CLASS = 'sm-poc-row-dragging';
    const DROP_TARGET_CLASS = 'sm-poc-drop-target';
    const MOVED_CLASS = 'sm-poc-row-moved';
    const DROP_BEFORE_CLASS = 'sm-poc-drop-before';
    const MIN_STABLE_TABLE_WIDTH = 160;
    const BATCH_SQL_COMMAND_LIMIT = 500;
    const BATCH_FETCH_CONCURRENCY = 4;
    const BATCH_LOOKUP_REQUEST_LIMIT = 40;
    const ALL_GROUPS_FETCH_CONCURRENCY = 6;
    const ALL_PARAMS_CACHE_FRESH_MS = 30000;
    const ALL_PARAMS_PROGRESS_RENDER_MS = 300;
    const ALL_PARAMS_PROGRESSIVE_MAX_ROWS = 700;
    const FETCH_TIMEOUT_MS = 15000;
    const DEFAULT_HINT_SUPPRESS_MS = 1800;
    // Computed-style-egenskaper som kopieres fra native knapper for pixel-lik look
    const NATIVE_BUTTON_STYLE_PROPS = [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
        'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
        'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
        'backgroundColor', 'color', 'lineHeight', 'textAlign', 'boxShadow', 'cursor'
    ];

    let measurementsTable = null;
    let settingsTable = null;
    let selectedRows = new Set();
    let activeFilters = { measurements: {}, settings: {} };
    let dropInsertBefore = null;
    let dropIndicatorRow = null;
    let draggingRows = [];
    let lastContentSignature = '';
    let reinitTimer = null;
    let draggingFromSide = null;
    let suppressObserverUntil = 0;
    let moveModeEnabled = false;
    let lastActiveTableKey = 'measurements';
    let lastActionHintAt = 0;
    let redrawTimeouts = [];
    let allParamsActive = false;
    // Highlight used_in_graphics + grafikk-paneler for valgt enhet (merget fra Supermarket-Settings_with_panelnames).
    // Overlever re-render av Vis-alle-visningen; gjelder kun nøkkelen plant|unit den ble hentet for.
    // loaded = panel-oppslaget er fullført for `key`. Badgen henger på DEN, ikke på `menus`:
    // anlegg uten meny-koder (Danfoss: get_unit_menu.php gir ["","","",""]) har paneler å vise
    // selv om ingen rader kan markeres.
    let gfxState = { key: '', loaded: false, menus: new Set(), panels: [] }; // panels: [{ id, name, elements }]
    let lastNativeContextRow = null; // sist høyreklikkede rad i IWMACs native tabell
    let settingsTabRefs = null; // { plain, selected } — native fane-knapper brukt som stilreferanse
    let allParamsBusy = false;
    let allParamsData = null;
    let allParamsGeneration = 0;
    let allParamsFetchKey = '';
    let allParamsUnitSwitchTimer = null;
    const allParamsCache = new Map();
    let allParamsSort = { key: 'groupName', direction: 'asc' };
    let allParamsFilters = {
        measurements: { groupName: '', aliasText: '', value: '', unit: '' },
        settings: { groupName: '', aliasText: '', value: '', unit: '' }
    };
    let hideZeroValuesEnabled = false;
    let pocAsleep = false;
    let allParamsOnlyGraphics = false; // filter i Vis alle parameter: bare rader som brukes i grafikk
    const pendingAttChanges = new Map();
    const selectionAnchor = { measurements: null, settings: null };
    const filterTimers = { measurements: null, settings: null };

    function isSettingsPage() {
        const hashPath = (window.location.hash || '').replace(/^#/, '').split(/[?#]/)[0];
        const pagePath = (window.location.pathname || '').split(/[?#]/)[0];
        return /\/settings\/regulators(?:\/|$)/.test(hashPath)
            || /\/settings\/regulators(?:\/|$)/.test(pagePath);
    }

    function installGlobalCompatibilityGuards() {
        if (!('christmasAudio' in window)) {
            window.christmasAudio = {
                play() {},
                pause() {},
                currentTime: 0
            };
        }
    }

    function injectStyles() {
        const old = document.getElementById(POC_STYLE_ID);
        if (old) old.remove();
        const style = document.createElement('style');
        style.id = POC_STYLE_ID;
        style.textContent = `
            .${SELECTED_CLASS} { outline: 2px solid #1976d2 !important; outline-offset: -2px; background: #e3f2fd !important; }
            .${DRAGGING_CLASS} { opacity: 0.4; }
            .${MOVED_CLASS} { background: #e8f5e9 !important; border-left: 4px solid #43a047 !important; }
            .${MOVED_CLASS} td { background: #e8f5e9 !important; }
            .sm-poc-row-pending td { box-shadow: inset 0 -2px 0 #ff9800; }
            .sm-poc-row-pending-to-settings td { background: #e8f5e9 !important; }
            .sm-poc-row-pending-to-measurements td { background: #e3f2fd !important; }
            .sm-poc-row-saved-visual td { box-shadow: inset 0 -2px 0 #66bb6a; }
            .sm-poc-row-saved-awaiting-redraw td { box-shadow: inset 0 -2px 0 #66bb6a; }
            .${DROP_TARGET_CLASS} { box-shadow: inset 0 0 0 2px #ff9800; background: #fffde7 !important; }
            .${DROP_BEFORE_CLASS} { box-shadow: inset 0 3px 0 0 #ff9800 !important; }
            #sm-poc-toolbar {
                display: flex; align-items: center; gap: 10px;
                padding: 6px 10px; margin: 0;
                background: #eceff1; border: 1px solid #b0bec5; border-radius: 4px;
                font-size: 12px; position: fixed; z-index: 2147483639;
                left: 50%; top: 6px; transform: translateX(-50%);
                width: auto; max-width: calc(100vw - 24px);
                box-sizing: border-box; box-shadow: 0 2px 8px rgba(0,0,0,0.18);
            }
            .top_bar_kiona #sm-poc-toolbar {
                position: static; transform: none; z-index: auto;
                margin: 0 10px 0 auto; padding: 3px 6px; gap: 6px;
                max-width: none; box-shadow: none;
                background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18);
                color: #fff; border-radius: 3px; flex: 0 0 auto;
            }
            .sm-poc-move-toggle {
                padding: 6px 12px; font-weight: 600; cursor: pointer;
                border: 1px solid #1976d2; border-radius: 4px; background: #fff;
                color: #1565c0;
            }
            .top_bar_kiona #sm-poc-toolbar .sm-poc-move-toggle {
                padding: 4px 8px; border-color: rgba(255,255,255,0.32);
                background: rgba(255,255,255,0.10); color: #fff; border-radius: 3px;
            }
            .sm-poc-move-toggle.sm-poc-active {
                background: #1976d2; color: #fff;
            }
            .top_bar_kiona #sm-poc-toolbar .sm-poc-move-toggle.sm-poc-active {
                background: #1976d2; border-color: #64b5f6; color: #fff;
            }
            .sm-poc-zero-toggle {
                padding: 6px 12px; font-weight: 600; cursor: pointer;
                border: 1px solid #607d8b; border-radius: 4px; background: #fff;
                color: #455a64;
            }
            .top_bar_kiona #sm-poc-toolbar .sm-poc-zero-toggle {
                padding: 4px 8px; border-color: rgba(255,255,255,0.32);
                background: rgba(255,255,255,0.10); color: #fff; border-radius: 3px;
            }
            .sm-poc-zero-toggle.sm-poc-active {
                background: #455a64; color: #fff;
            }
            .top_bar_kiona #sm-poc-toolbar .sm-poc-zero-toggle.sm-poc-active {
                background: #455a64; border-color: #90a4ae; color: #fff;
            }
            .sm-poc-save-btn {
                padding: 6px 12px; font-weight: 600; cursor: pointer;
                border: 1px solid #2e7d32; border-radius: 4px; background: #fff;
                color: #2e7d32;
            }
            .top_bar_kiona #sm-poc-toolbar .sm-poc-save-btn {
                padding: 4px 8px; border-color: rgba(129,199,132,0.75);
                background: rgba(255,255,255,0.10); color: #c8e6c9; border-radius: 3px;
            }
            .sm-poc-save-btn:disabled { opacity: 0.45; cursor: default; }
            .sm-poc-save-count { color: #2e7d32; font-weight: 600; }
            .sm-poc-toolbar-hint { color: #546e7a; font-size: 11px; }
            .top_bar_kiona #sm-poc-toolbar .sm-poc-save-count,
            .top_bar_kiona #sm-poc-toolbar .sm-poc-toolbar-hint {
                color: rgba(255,255,255,0.78);
            }
            .top_bar_kiona #sm-poc-toolbar .sm-poc-toolbar-hint { display: none; }
            .sm-poc-unit-native-hidden {
                visibility: hidden !important;
            }
            #${UNIT_PORTAL_ID} {
                /* ponytail: under IWMAC-modaler (z-index 1900) så hurtiggraf-modalen
                   ikke dekkes av enhetscomboen, men over sideinnholdet. */
                position: fixed; inset: 0; pointer-events: none; z-index: 1899;
            }
            #${UNIT_PORTAL_ID} .${UNIT_COMBO_CLASS} {
                pointer-events: auto;
            }
            #${UNIT_PORTAL_ID} .sm-poc-gfx-badge-host { position: fixed; pointer-events: auto; }
            .sm-poc-gfx-badge-host .sm-poc-gfx-badge { margin-left: 0; }
            #${ALL_PARAMS_PORTAL_ID} {
                /* ponytail: under IWMAC-modaler (z-index 1900) og under
                   enhetsportal (1899) slik at enhets-dropdownen ikke dekkes av
                   "Vis alle parameter"-knappen. Viewet dekker sideinnholdet
                   (<1898) men viker for modaler og enhetscombo. */
                position: fixed; inset: 0; pointer-events: none; z-index: 1898;
            }
            #${ALL_PARAMS_PORTAL_ID} #${ALL_PARAMS_BUTTON_ID},
            #${ALL_PARAMS_PORTAL_ID} #${ALL_PARAMS_VIEW_ID} {
                pointer-events: auto;
            }
            .${UNIT_COMBO_CLASS} {
                position: fixed; display: inline-block; min-width: 320px; max-width: min(640px, 92vw);
                font-size: 13px; color: #263238;
            }
            .sm-poc-unit-combo-control {
                display: flex; align-items: center; gap: 6px;
                width: 100%; height: 32px; box-sizing: border-box; padding: 3px 8px;
                border: 1px solid #90a4ae; border-radius: 4px; background: #fff;
                box-shadow: 0 1px 2px rgba(0,0,0,0.08); cursor: pointer; text-align: left;
            }
            .sm-poc-unit-selected-text {
                flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .sm-poc-unit-search {
                flex: 1; min-width: 0; height: 26px; box-sizing: border-box;
                border: 1px solid #b0bec5; border-radius: 3px; outline: 0; font-size: 13px;
                background: #fff; color: #263238; padding: 3px 6px;
            }
            .sm-poc-unit-open,
            .sm-poc-unit-sort,
            .sm-poc-unit-clear {
                flex: 0 0 auto; border: 0; background: transparent; cursor: pointer;
                color: #546e7a; font-size: 12px; padding: 2px 4px; border-radius: 3px;
            }
            .sm-poc-unit-open:hover,
            .sm-poc-unit-sort:hover,
            .sm-poc-unit-clear:hover {
                background: #eceff1; color: #1565c0;
            }
            .sm-poc-unit-panel {
                display: none; position: absolute; left: 0; top: calc(100% + 2px);
                width: 100%; z-index: 20; padding: 6px;
                background: #fff; border: 1px solid #90a4ae; border-radius: 4px;
                box-shadow: 0 8px 20px rgba(0,0,0,0.20); box-sizing: border-box;
            }
            .${UNIT_COMBO_CLASS}.sm-poc-unit-opened .sm-poc-unit-panel { display: block; }
            .sm-poc-unit-search-row {
                display: flex; align-items: center; gap: 4px; margin-bottom: 6px;
            }
            .sm-poc-unit-list {
                max-height: 330px; overflow: auto; border-top: 1px solid #eceff1;
            }
            .sm-poc-unit-option {
                padding: 6px 8px; cursor: pointer; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid #eceff1;
            }
            .sm-poc-unit-option:hover,
            .sm-poc-unit-option.sm-poc-unit-active {
                background: #e3f2fd;
            }
            .sm-poc-unit-option.sm-poc-unit-selected {
                background: #e8f5e9; font-weight: 600;
            }
            .sm-poc-unit-empty {
                padding: 8px; color: #78909c; font-style: italic;
            }
            .sm-poc-context-batch-item:hover { background-color: rgb(240, 240, 240) !important; }
            #${ALL_PARAMS_BUTTON_ID}.sm-poc-all-active {
                background: #1976d2 !important; color: #fff !important;
            }
            #${ALL_PARAMS_BUTTON_ID} {
                position: fixed; box-sizing: border-box; margin: 0;
                display: inline-block; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis;
            }
            #${ALL_PARAMS_BUTTON_ID}:not(.sm-poc-all-active):hover {
                filter: brightness(0.94);
            }
            .sm-poc-all-params-view {
                display: flex; flex-direction: column; gap: 8px;
                flex: 1 1 auto; min-width: 0; min-height: 0;
                width: 100%; box-sizing: border-box; padding: 0 18px 12px 18px;
                color: #263238; font-size: 12px;
                position: fixed; background: #eeeeee; z-index: 2147483636;
                overflow: hidden; max-height: 100vh;
            }
            .sm-poc-all-toolbar {
                display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
                padding: 6px 0; flex: 0 0 auto;
            }
            .sm-poc-all-toolbar input {
                width: min(420px, 46vw); padding: 5px 7px;
                border: 1px solid #b0bec5; border-radius: 3px; font-size: 12px;
            }
            .sm-poc-all-toolbar button {
                border: 1px solid #9e9e9e; background: #fff; color: #212121;
                padding: 5px 10px; border-radius: 2px; cursor: pointer;
            }
            .sm-poc-all-status { color: #546e7a; font-weight: 600; }
            .sm-poc-all-toolbar button.sm-poc-active {
                background: #1976d2; border-color: #1976d2; color: #fff; font-weight: 600;
            }
            .sm-poc-all-columns {
                display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 38px; min-height: 0; height: 100%; flex: 1 1 auto;
                overflow: hidden;
            }
            .sm-poc-all-pane {
                min-width: 0; background: #fff; border: 1px solid #cfd8dc;
                box-sizing: border-box; display: flex; flex-direction: column;
                min-height: 0; overflow: hidden;
            }
            .sm-poc-all-title {
                padding: 7px 9px; background: #eceff1; border-bottom: 1px solid #cfd8dc;
                font-weight: 700; flex: 0 0 auto;
            }
            .sm-poc-all-header-table,
            .sm-poc-all-scroll {
                width: 100%; box-sizing: border-box;
            }
            .sm-poc-all-scroll {
                flex: 1 1 auto; min-height: 0; height: 100%; overflow: auto;
                border-top: 0; overscroll-behavior: contain;
            }
            .sm-poc-all-header-table,
            .sm-poc-all-table {
                width: 100%; border-collapse: collapse; table-layout: fixed;
            }
            .sm-poc-all-header-table th {
                background: #dcdcdc; border-bottom: 1px solid #bdbdbd;
                border-right: 1px solid #bdbdbd; padding: 6px 5px;
                cursor: pointer; white-space: nowrap; box-sizing: border-box;
                font-weight: 700;
            }
            .sm-poc-all-header-table th:last-child,
            .sm-poc-all-table td:last-child { border-right: 0; }
            .sm-poc-all-filter-row th {
                padding: 3px 4px; background: #eef1f3; cursor: default;
            }
            .sm-poc-all-filter-row input {
                width: 100%; height: 20px; box-sizing: border-box;
                border: 1px solid #b0bec5; border-radius: 2px;
                padding: 2px 5px; font-size: 11px;
            }
            .sm-poc-all-filter-row input.sm-poc-col-active {
                border-color: #ff9800; background: #fffde7;
            }
            .sm-poc-all-table td {
                border-bottom: 1px solid #d0d0d0; border-right: 1px solid #d0d0d0;
                padding: 4px 5px; box-sizing: border-box;
                overflow: hidden; text-overflow: ellipsis; vertical-align: top;
            }
            .sm-poc-all-value-cell { text-align: right; }
            .sm-poc-all-unit-cell { text-align: left; }
            .sm-poc-all-table tr { cursor: default; }
            body.sm-poc-move-mode .sm-poc-all-table tr { cursor: pointer; }
            .sm-poc-all-group {
                display: inline-block; max-width: 100%; box-sizing: border-box;
                background: rgba(25,118,210,0.12); color: #1565c0;
                padding: 1px 5px; border-radius: 3px; font-size: 11px;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .sm-poc-all-context {
                position: fixed; z-index: 2147483637; width: 230px;
                background: #fff; border: 1px solid #ccc;
                box-shadow: rgba(0,0,0,0.3) 0 3px 8px 0; padding: 4px 0;
                font-family: inherit; font-size: 13px; cursor: default;
            }
            .sm-poc-all-context-item {
                position: relative; padding: 0 18px 0 28px; height: 20px;
                cursor: pointer; display: flex; box-sizing: border-box;
                color: #333; background: transparent;
            }
            .sm-poc-all-context-item:hover { background: rgb(240, 240, 240); }
            .sm-poc-all-context-item > div:first-child {
                line-height: 20px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
            }
            .sm-poc-all-context-item > div:last-child {
                line-height: 20px; color: rgb(200, 200, 200);
            }
            .sm-poc-all-context hr {
                border: 0; border-bottom: 1px solid #ccc; margin: 6px 0;
            }
            .sm-poc-used-in-graphics td {
                background: #90ee90 !important;
                box-shadow: inset 0 0 0 2px #32cd32;
            }
            td[data-sm-panels]::after {
                content: " 🖼 " attr(data-sm-panels); color: #1b5e20; font-size: 11px; font-style: italic;
            }
            .sm-poc-gfx-badge {
                display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: 10px;
                background: #1b5e20; color: #fff; padding: 3px 10px; border-radius: 10px; font-size: 12px;
            }
            .sm-poc-gfx-badge a { color: #fff; text-decoration: underline; cursor: pointer; }
            .sm-poc-gfx-badge button {
                background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.6);
                border-radius: 8px; padding: 0 6px; font-size: 11px; line-height: 18px; cursor: pointer; margin: 0;
            }
            .sm-poc-batch-modal {
                position: fixed; inset: 0; z-index: 2147483641;
                background: rgba(0,0,0,0.45); display: flex;
                align-items: center; justify-content: center;
            }
            .sm-poc-batch-box {
                width: min(620px, 94vw); max-height: 88vh; overflow: auto;
                background: #fff; color: #263238; border-radius: 8px;
                box-shadow: 0 8px 28px rgba(0,0,0,0.32);
                padding: 14px; box-sizing: border-box; font-size: 12px;
            }
            .sm-poc-batch-head {
                display: flex; align-items: center; justify-content: space-between;
                gap: 10px; margin-bottom: 12px;
            }
            .sm-poc-batch-head h2 { margin: 0; font-size: 16px; color: #263238; }
            .sm-poc-batch-grid {
                display: grid; grid-template-columns: 150px 1fr; gap: 8px 10px;
                align-items: center;
            }
            .sm-poc-batch-grid label { font-weight: 600; }
            .sm-poc-batch-grid input,
            .sm-poc-batch-grid select {
                padding: 6px 8px; border: 1px solid #b0bec5; border-radius: 4px;
                font-size: 12px; box-sizing: border-box; width: 100%;
            }
            .sm-poc-batch-actions {
                margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;
            }
            .sm-poc-batch-actions button,
            .sm-poc-scale-modal button {
                border: 0; border-radius: 4px; padding: 7px 12px; cursor: pointer; font-size: 12px;
            }
            .sm-poc-primary-btn { background: #1976d2; color: #fff; }
            .sm-poc-green-btn { background: #4caf50; color: #fff; }
            .sm-poc-orange-btn { background: #ff9800; color: #fff; }
            .sm-poc-gray-btn { background: #757575; color: #fff; }
            .sm-poc-red-btn { background: #c62828; color: #fff; }
            .sm-poc-batch-note {
                margin: 8px 0 12px; padding: 8px 10px;
                background: #e3f2fd; border-left: 4px solid #1976d2; color: #0d47a1;
            }
            .sm-poc-batch-results {
                max-height: 260px; overflow: auto; background: #f7f9fa;
                border: 1px solid #cfd8dc; border-radius: 4px; padding: 8px;
                font-family: Consolas, Monaco, monospace; white-space: pre-wrap;
            }
            .sm-poc-driver-details-table {
                width: 100%; border-collapse: collapse; table-layout: fixed;
            }
            .sm-poc-driver-details-table th,
            .sm-poc-driver-details-table td {
                padding: 5px 7px; border-bottom: 1px solid #e0e0e0;
                text-align: left; vertical-align: top; word-break: break-word;
            }
            .sm-poc-driver-details-table th {
                width: 150px; background: #f5f7f8; font-weight: 700;
            }
            .sm-poc-driver-modal .sm-poc-batch-box {
                width: min(560px, 94vw); max-height: 92vh; padding: 12px;
            }
            .sm-poc-driver-form-grid {
                display: grid; grid-template-columns: 140px 1fr; gap: 4px 8px;
                align-items: center;
            }
            .sm-poc-driver-form-grid label { font-weight: 700; color: #263238; }
            .sm-poc-driver-form-grid input,
            .sm-poc-driver-form-grid select,
            .sm-poc-driver-form-grid textarea {
                width: 100%; box-sizing: border-box; padding: 3px 6px;
                border: 1px solid #b0bec5; border-radius: 3px; font-size: 12px;
            }
            .sm-poc-driver-form-grid input[readonly] {
                background: #f5f5f5; color: #666;
            }
            .sm-poc-driver-modal button {
                border: 0; border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 12px;
            }
            .sm-poc-override-field {
                outline: 2px solid #1976d2 !important; outline-offset: 1px;
            }
            .sm-poc-meter-line { margin-bottom: 10px; line-height: 1.5; }
            .sm-poc-copy-icon {
                margin-left: 6px; background: transparent; color: #1976d2; border: 0;
                border-radius: 3px; padding: 0; cursor: pointer; width: 24px; height: 24px;
                display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;
            }
            .sm-poc-select-table {
                width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px;
            }
            .sm-poc-select-table th,
            .sm-poc-select-table td {
                padding: 7px 8px; border-bottom: 1px solid #e0e0e0;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .sm-poc-select-table tbody tr { cursor: pointer; }
            .sm-poc-select-table tbody tr:hover { background: #f5f7f8; }
            .sm-poc-scale-modal .sm-poc-batch-box { width: min(1020px, 96vw); }
            .sm-poc-scale-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .sm-poc-scale-table th,
            .sm-poc-scale-table td {
                padding: 6px; border-bottom: 1px solid #e0e0e0;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .sm-poc-scale-custom {
                display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
                gap: 8px; align-items: end; margin-top: 10px;
                padding: 10px; background: #fff8e1; border: 1px solid #ffc107; border-radius: 6px;
            }
            .sm-poc-scale-custom label { display: flex; flex-direction: column; gap: 3px; font-weight: 600; }
            /* Skalerings-presets i parameterdetaljer (portet) */
            #sm-poc-driver-presets-modal .sm-poc-dp-box { width: min(920px, 94vw); font-size: 12px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-box.sm-poc-dp-wide { width: min(1020px, 96vw); }
            #sm-poc-driver-presets-modal button { border: 0; border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
            #sm-poc-driver-presets-modal .sm-poc-batch-head { gap: 8px; }
            #sm-poc-driver-presets-modal .sm-poc-batch-head h2 { flex: 1; }
            #sm-poc-driver-presets-modal .sm-poc-dp-rawlabel { display: flex; align-items: center; gap: 6px; font-size: 12px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-rawlabel input { width: 110px; padding: 5px 7px; border: 1px solid #b0bec5; border-radius: 4px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-explain {
                margin-bottom: 12px; padding: 10px; background: #fff3e0; border-left: 4px solid #ff9800;
                border-radius: 4px; font-size: 11px; line-height: 1.5;
            }
            #sm-poc-driver-presets-modal .sm-poc-dp-explain-ok { background: #e8f5e9; border-left-color: #4caf50; }
            #sm-poc-driver-presets-modal .sm-poc-dp-explain-title { font-weight: 600; margin-bottom: 6px; color: #e65100; }
            #sm-poc-driver-presets-modal .sm-poc-dp-formula {
                margin-top: 6px; padding: 6px; background: #f5f5f5; border-radius: 3px;
                font-family: Consolas, Monaco, monospace; font-size: 10px;
            }
            #sm-poc-driver-presets-modal .sm-poc-dp-calc { margin-bottom: 12px; padding: 10px; background: #e3f2fd; border-radius: 4px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-calc-title { font-weight: 600; margin-bottom: 8px; font-size: 13px; color: #1976d2; }
            #sm-poc-driver-presets-modal .sm-poc-dp-calc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
            #sm-poc-driver-presets-modal .sm-poc-dp-calc-row input { width: 100px; padding: 4px 6px; border: 1px solid #ccc; border-radius: 3px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-muted { color: #666; font-size: 11px; margin-top: 4px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-table-wrap { max-height: 300px; overflow: auto; border: 1px solid #cfd8dc; border-radius: 4px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-calc-col {
                display: none; font-family: Consolas, Monaco, monospace; font-size: 10px; color: #666;
                max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
            }
            #sm-poc-driver-presets-modal .sm-poc-dp-wide .sm-poc-dp-calc-col { display: table-cell; }
            #sm-poc-driver-presets-modal .sm-poc-dp-wide #sm-poc-dp-c-calc { display: block; grid-column: 1 / -1; max-width: none; white-space: normal; }
            #sm-poc-driver-presets-modal .sm-poc-dp-custom {
                display: grid; grid-template-columns: 52px repeat(4, minmax(0, 1fr)) minmax(64px, auto) auto;
                gap: 6px 10px; align-items: end; margin-top: 10px; padding: 12px;
                background: #fff8e1; border: 2px solid #ffc107; border-radius: 6px;
            }
            #sm-poc-driver-presets-modal .sm-poc-dp-custom label { display: flex; flex-direction: column; gap: 3px; font-size: 10px; font-weight: 600; color: #555; min-width: 0; }
            #sm-poc-driver-presets-modal .sm-poc-dp-custom input {
                width: 100%; box-sizing: border-box; font-size: 13px; font-family: Consolas, Monaco, monospace;
                padding: 8px 6px; text-align: right; border: 1px solid #888; border-radius: 4px;
            }
            #sm-poc-driver-presets-modal .sm-poc-dp-custom-title { font-weight: 600; font-size: 12px; color: #333; padding-bottom: 6px; }
            #sm-poc-driver-presets-modal .sm-poc-dp-custom-result { font-size: 14px; font-weight: 700; color: #1976d2; text-align: right; padding-bottom: 6px; white-space: nowrap; }
            /* Strukturert Format Extra-editor (portet) */
            #sm-poc-format-extra-modal .sm-poc-fe-box { width: 520px; height: 60vh; display: flex; flex-direction: column; overflow: hidden; font-size: 12px; }
            #sm-poc-format-extra-modal .sm-poc-fe-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
            #sm-poc-format-extra-modal .sm-poc-fe-table { width: 100%; border-collapse: collapse; }
            #sm-poc-format-extra-modal .sm-poc-fe-table th { text-align: left; padding: 6px; border-bottom: 1px solid #e0e0e0; background: #f7f7f7; }
            #sm-poc-format-extra-modal .sm-poc-fe-table th:last-child { width: 48px; }
            #sm-poc-format-extra-modal .sm-poc-fe-table td { padding: 6px; border-bottom: 1px solid #e0e0e0; }
            #sm-poc-format-extra-modal .sm-poc-fe-table input { padding: 4px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; box-sizing: border-box; }
            #sm-poc-format-extra-modal .sm-poc-batch-actions button { padding: 4px 8px; }
            .sm-poc-help-btn {
                margin-left: 6px; padding: 5px 12px; border: 1px solid #90caf9; border-radius: 4px;
                background: #e3f2fd; color: #0d47a1; font-weight: 600; cursor: pointer;
            }
            .sm-poc-help-btn:hover { background: #bbdefb; }
            .sm-poc-export-btn {
                margin-left: 6px; padding: 5px 12px; border: 1px solid #66bb6a; border-radius: 4px;
                background: #e8f5e9; color: #1b5e20; font-weight: 600; cursor: pointer;
            }
            .sm-poc-export-btn:hover { background: #c8e6c9; }
            #sm-poc-toolbar.sm-poc-toolbar-kiona .sm-poc-export-btn {
                margin-left: 0; padding: 4px 8px; border-color: rgba(255,255,255,0.32);
                background: rgba(255,255,255,0.10); color: #fff; border-radius: 3px;
            }
            .sm-poc-all-toolbar .sm-poc-all-export-btn {
                border-color: #66bb6a; background: #e8f5e9; color: #1b5e20; font-weight: 600;
            }
            .sm-poc-all-toolbar .sm-poc-all-export-btn:hover { background: #c8e6c9; }
            .sm-poc-help-body { font-size: 13px; line-height: 1.55; color: #263238; }
            .sm-poc-help-body h3 {
                margin: 16px 0 6px; padding-bottom: 4px; font-size: 15px; color: #0d47a1;
                border-bottom: 1px solid #e0e0e0;
            }
            .sm-poc-help-body h3:first-child { margin-top: 0; }
            .sm-poc-help-body p { margin: 6px 0; }
            .sm-poc-help-body ul { margin: 6px 0; padding-left: 22px; }
            .sm-poc-help-body li { margin: 3px 0; }
            .sm-poc-help-body code, .sm-poc-help-body kbd {
                font-family: Consolas, Monaco, monospace; font-size: 12px;
                background: #eceff1; border-radius: 3px; padding: 1px 5px;
            }
            .sm-poc-help-body kbd { border: 1px solid #b0bec5; box-shadow: 0 1px 0 #b0bec5; }
            .sm-poc-help-body .sm-poc-help-btnref {
                display: inline-block; padding: 1px 6px; border-radius: 3px;
                background: #e8f5e9; border: 1px solid #a5d6a7; color: #1b5e20; font-weight: 600;
            }
            .sm-poc-help-toc {
                margin: 4px 0 8px; padding: 8px 10px; background: #f5f7f8;
                border-radius: 4px; font-size: 12px;
            }
            .sm-poc-help-toc a { color: #1565c0; cursor: pointer; text-decoration: none; margin-right: 10px; }
            .sm-poc-help-toc a:hover { text-decoration: underline; }
            .sm-poc-help-note {
                margin: 8px 0; padding: 8px 10px; background: #fff8e1;
                border-left: 4px solid #ffc107; border-radius: 4px; font-size: 12px;
            }
            .sm-poc-unit-picker-summary {
                margin: 8px 0; padding: 8px 10px; background: #e3f2fd; border-radius: 4px;
                font-size: 12px; line-height: 1.5; word-break: break-word;
            }
            .sm-poc-unit-picker-controls {
                display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0;
            }
            #sm-poc-unit-picker-confirm:disabled { opacity: 0.5; cursor: default; }
            .sm-poc-xunit-result-table {
                width: 100%; border-collapse: collapse; font-size: 12px;
            }
            .sm-poc-xunit-result-table th, .sm-poc-xunit-result-table td {
                padding: 5px 8px; border-bottom: 1px solid #e0e0e0; text-align: left; white-space: nowrap;
            }
            .sm-poc-xunit-result-table td.sm-poc-xunit-num { text-align: right; }
            .sm-poc-xunit-row-ok td { background: #f1f8e9; }
            .sm-poc-xunit-row-warn td { background: #fff8e1; }
            .sm-poc-xunit-row-fail td { background: #ffebee; }
            .sm-poc-xunit-status-ok { color: #2e7d32; font-weight: 600; }
            .sm-poc-xunit-status-warn { color: #f57f17; font-weight: 600; }
            .sm-poc-xunit-status-fail { color: #c62828; font-weight: 600; }
            .sm-poc-unit-picker-controls #sm-poc-unit-picker-search { flex: 1 1 180px; min-width: 140px; padding: 5px 8px; }
            .sm-poc-unit-picker-mode { display: flex; align-items: center; gap: 4px; font-size: 12px; }
            .sm-poc-unit-picker-list {
                max-height: 360px; overflow: auto; border: 1px solid #cfd8dc; border-radius: 4px;
            }
            .sm-poc-unit-picker-row {
                display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center;
                padding: 6px 10px; border-bottom: 1px solid #eceff1; cursor: pointer;
            }
            .sm-poc-unit-picker-row:hover { background: #f5f7f8; }
            .sm-poc-unit-picker-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sm-poc-unit-picker-id { color: #607d8b; font-size: 11px; font-family: monospace; white-space: nowrap; }
            .sm-poc-header-filter-wrap {
                display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0;
            }
            .sm-poc-header-label {
                display: block; font-weight: 600; line-height: 1.1;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            th.sm-poc-header-filter-cell {
                padding: 2px 4px !important;
                vertical-align: middle !important;
            }
            th.sm-poc-header-filter-cell.sm-poc-col-active {
                background: #fff3e0 !important;
            }
            th.sm-poc-header-filter-cell > .sm-poc-col-filter {
                display: block; margin-top: 2px;
            }
            .sm-poc-pane-filters {
                display: block; box-sizing: border-box;
                background: #f5f7f8; border: 1px solid #cfd8dc; border-bottom: 0;
                padding: 3px 0; margin: 0;
                position: fixed; z-index: 2;
                box-shadow: 0 1px 2px rgba(0,0,0,0.08);
            }
            #${FILTER_PORTAL_ID} {
                position: fixed; inset: 0; pointer-events: none; z-index: 2;
            }
            #${FILTER_PORTAL_ID} .sm-poc-pane-filters {
                pointer-events: auto;
            }
            #${GHOST_PORTAL_ID} {
                position: fixed; inset: 0; pointer-events: none; z-index: 1;
            }
            #${GHOST_PORTAL_ID} .sm-poc-ghost-host {
                position: fixed; pointer-events: auto; box-sizing: border-box;
                background: rgba(245, 247, 248, 0.98);
                border: 1px solid #cfd8dc; border-top: 0;
                box-shadow: 0 2px 4px rgba(0,0,0,0.12);
                max-height: 34vh; overflow: auto;
            }
            .sm-poc-ghost-title {
                padding: 3px 6px; font-size: 10px; color: #546e7a;
                background: #eef3f5; border-bottom: 1px solid #cfd8dc;
                white-space: nowrap;
            }
            .sm-poc-ghost-table {
                width: 100%; border-collapse: collapse; table-layout: fixed;
                font-size: inherit;
            }
            .sm-poc-ghost-row { cursor: grab; }
            .sm-poc-ghost-row td {
                border-bottom: 1px solid #d8e0e4;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .sm-poc-filter-grid {
                display: grid; gap: 0; width: 100%; align-items: center;
            }
            .sm-poc-filter-grid-cell {
                min-width: 0; display: flex; align-items: center; gap: 3px;
                padding: 0 3px; box-sizing: border-box;
            }
            .sm-poc-filter-grid-cell.sm-poc-col-active {
                background: #fff8e1; border-radius: 2px;
            }
            .sm-poc-col-filter-wrap {
                display: flex; align-items: center; gap: 3px; width: 100%; min-width: 0;
            }
            .sm-poc-col-filter-field {
                position: relative; flex: 1; min-width: 0; width: 100%;
            }
            .sm-poc-col-filter {
                flex: 1; min-width: 0; width: 100%; box-sizing: border-box;
                padding: 2px 20px 2px 5px; height: 20px;
                border: 1px solid #b0bec5; border-radius: 2px; font-size: 11px;
            }
            .sm-poc-clear-filter {
                display: none; align-items: center; justify-content: center;
                position: absolute; right: 3px; top: 50%; transform: translateY(-50%);
                width: 14px; height: 14px; padding: 0; line-height: 1;
                border: 0; background: transparent; color: #d32f2f;
                font-size: 12px; font-weight: 700; cursor: pointer;
            }
            .sm-poc-clear-filter:hover { background: #ffebee; border-radius: 50%; }
            .sm-poc-col-filter-field.sm-poc-has-value .sm-poc-clear-filter { display: flex; }
            .sm-poc-col-active .sm-poc-col-filter {
                border-color: #ff9800; background: #fffde7;
            }
            .sm-poc-col-filter-meta { font-size: 10px; color: #546e7a; white-space: nowrap; }
            body.sm-poc-move-mode div.parameters tr[draggable="true"] { cursor: grab; }
            body.sm-poc-move-mode div.parameters tr[draggable="true"]:active { cursor: grabbing; }
            body.sm-poc-move-mode div.parameters tbody tr { user-select: none; }
            .sm-poc-hint {
                position: fixed; bottom: 8px; left: 50%; transform: translateX(-50%);
                background: #323232; color: #fff; padding: 8px 14px; border-radius: 6px;
                font-size: 12px; z-index: 2147483640; pointer-events: none; opacity: 0.92;
                max-width: 90vw; text-align: center;
            }
        `;
        document.head.appendChild(style);
    }

    function ensurePocStyles() {
        if (!document.getElementById(POC_STYLE_ID)) injectStyles();
    }

    function showHint(text, options = {}) {
        if (options.defaultHint && Date.now() - lastActionHintAt < DEFAULT_HINT_SUPPRESS_MS) return;
        if (!options.defaultHint) lastActionHintAt = Date.now();
        if (!text) { // tom tekst = skjul hintet (idle)
            document.getElementById('sm-poc-hint')?.remove();
            return;
        }
        ensurePocStyles();
        let el = document.getElementById('sm-poc-hint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sm-poc-hint';
            el.className = 'sm-poc-hint';
            document.body.appendChild(el);
        }
        el.textContent = text;
    }

    function setRedrawTimeout(fn, delay) {
        const id = setTimeout(() => {
            redrawTimeouts = redrawTimeouts.filter((item) => item !== id);
            fn();
        }, delay);
        redrawTimeouts.push(id);
        return id;
    }

    function clearRedrawTimeouts() {
        redrawTimeouts.forEach((id) => clearTimeout(id));
        redrawTimeouts = [];
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            return response;
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error(`Tidsavbrudd etter ${Math.round(timeoutMs / 1000)} sekunder mot ${url}`);
            }
            throw error;
        } finally {
            clearTimeout(id);
        }
    }

    function findTables() {
        const root = document.querySelector('div.parameters');
        if (!root) return null;
        const measurements = root.querySelector('div.measurements table.iwmac_table_scroll_table tbody');
        const settings = root.querySelector('div.settings table.iwmac_table_scroll_table tbody');
        if (!measurements || !settings) return null;
        if (!measurements.isConnected || !settings.isConnected) return null;
        return { measurements, settings, root };
    }

    function computeContentSignature() {
        if (!isSettingsPage()) return 'off-page';
        const root = document.querySelector('div.parameters');
        if (!root) return 'no-root';
        const mt = root.querySelector('div.measurements table.iwmac_table_scroll_table tbody');
        const st = root.querySelector('div.settings table.iwmac_table_scroll_table tbody');
        if (!mt || !st) return 'no-tables';
        const mRow = mt.querySelector('tr');
        const sRow = st.querySelector('tr');
        return [
            location.hash,
            mRow?.cells?.length || 0,
            sRow?.cells?.length || 0,
            mt.rows.length,
            st.rows.length,
            (mRow?.textContent || '').slice(0, 40).trim(),
        ].join('|');
    }

    function getPane(key) {
        const cls = key === 'measurements' ? 'measurements' : 'settings';
        return document.querySelector(`div.parameters div.${cls}`);
    }

    function removePaneFilters() {
        document.querySelectorAll('.sm-poc-pane-filters, .sm-poc-filter-bar').forEach((el) => el.remove());
        removePendingVisuals();
        releaseFilterSpacing();
    }

    function getFilterPortal() {
        let portal = document.getElementById(FILTER_PORTAL_ID);
        if (!portal) {
            portal = document.createElement('div');
            portal.id = FILTER_PORTAL_ID;
            ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'focusin', 'keydown', 'keyup'].forEach((eventName) => {
                portal.addEventListener(eventName, (ev) => {
                    ev.stopPropagation();
                });
            });
            document.body.appendChild(portal);
        }
        return portal;
    }

    function getGhostPortal() {
        let portal = document.getElementById(GHOST_PORTAL_ID);
        if (!portal) {
            portal = document.createElement('div');
            portal.id = GHOST_PORTAL_ID;
            ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'focusin', 'keydown', 'keyup'].forEach((eventName) => {
                portal.addEventListener(eventName, (ev) => {
                    ev.stopPropagation();
                });
            });
            document.body.appendChild(portal);
        }
        return portal;
    }

    function getUnitPortal() {
        let portal = document.getElementById(UNIT_PORTAL_ID);
        if (!portal) {
            portal = document.createElement('div');
            portal.id = UNIT_PORTAL_ID;
            ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'focusin', 'keydown', 'keyup'].forEach((eventName) => {
                portal.addEventListener(eventName, (ev) => {
                    ev.stopPropagation();
                });
            });
            document.body.appendChild(portal);
        }
        return portal;
    }

    function getAllParamsPortal() {
        let portal = document.getElementById(ALL_PARAMS_PORTAL_ID);
        if (!portal) {
            portal = document.createElement('div');
            portal.id = ALL_PARAMS_PORTAL_ID;
            document.body.appendChild(portal);
        }
        return portal;
    }

    function clearGhostRows() {
        document.getElementById(GHOST_PORTAL_ID)?.remove();
        updateContainerTopPaddingForSide('measurements');
        updateContainerTopPaddingForSide('settings');
    }

    function getTableContainerForTbody(tbody) {
        return tbody?.closest('.iwmac_table_scroll_table_container')
            || tbody?.closest('.iwmac_table_scroll_container')
            || tbody?.closest('table.iwmac_table_scroll_table')?.parentElement
            || null;
    }

    function releaseFilterSpacing() {
        document.querySelectorAll('[data-sm-poc-filter-spacer="1"]').forEach((el) => {
            el.style.paddingTop = el.dataset.smPocOldPaddingTop || '';
            delete el.dataset.smPocOldPaddingTop;
            delete el.dataset.smPocFilterSpacer;
        });
    }

    function unhideFilteredRows() {
        [measurementsTable, settingsTable].forEach((tbody) => {
            tbody?.querySelectorAll('tr').forEach((tr) => { tr.style.display = ''; });
        });
    }

    function getColumnCount(tbody) {
        const key = tbody === measurementsTable ? 'measurements' : tbody === settingsTable ? 'settings' : null;
        const row = tbody?.querySelector('tr');
        return row?.cells?.length || (key ? getHeaderCellsForSide(key).length : 0) || 3;
    }

    function defaultColumnLabels(count) {
        const names = ['Måling', 'Status', 'Verdi', 'Enhet'];
        return Array.from({ length: count }, (_, i) => names[i] || `Kol ${i + 1}`);
    }

    function bindUnitPickerOpen(input) {
        if (!input || input.dataset.smPocPickerBound === '1') return;
        input.dataset.smPocPickerBound = '1';
        input.addEventListener('click', () => {
            if (typeof input.showPicker !== 'function') return;
            try {
                input.showPicker();
            } catch (error) {
                // showPicker krever user gesture; ArrowDown/dobbeltklikk virker fortsatt.
            }
        });
    }

    function getColumnLabelsForSide(key, count) {
        const defaults = defaultColumnLabels(count);
        const labels = getHeaderCellsForSide(key).map((th, col) => (
            th.dataset.smPocLabel
            || th.dataset.originalLabel
            || th.querySelector('div')?.textContent
            || th.textContent
            || defaults[col]
            || `Kol ${col + 1}`
        ).replace(/\s+/g, ' ').trim());

        return Array.from({ length: count }, (_, i) => labels[i] || defaults[i] || `Kol ${i + 1}`);
    }

    function persistFiltersFromDom() {
        ['measurements', 'settings'].forEach((key) => {
            const tbody = getTbodyForKey(key);
            if (!tbody?.isConnected) return;
            readFiltersFromDom(key);
        });
    }

    function resetPocState(clearFilters) {
        if (!clearFilters) persistFiltersFromDom();
        clearSelection();
        clearDropIndicator();
        unhideFilteredRows();
        removePaneFilters();
        measurementsTable = null;
        settingsTable = null;
        if (clearFilters) {
            activeFilters = { measurements: {}, settings: {} };
            moveModeEnabled = false;
            document.body.classList.remove('sm-poc-move-mode');
        }
    }

    function sleepPoc() {
        if (pocAsleep) return; // ellers fjernes hint/modal vi nettopp åpnet fra grafikk-visningen
        pocAsleep = true;
        clearTimeout(reinitTimer);
        clearRedrawTimeouts();
        deactivateAllParamsView({ removeButton: true });
        resetPocState(true);
        document.getElementById('sm-poc-toolbar')?.remove();
        document.getElementById('sm-poc-hint')?.remove();
        document.getElementById(POC_STYLE_ID)?.remove();
        document.getElementById(FILTER_PORTAL_ID)?.remove();
        document.getElementById(GHOST_PORTAL_ID)?.remove();
        document.getElementById(UNIT_PORTAL_ID)?.remove();
        document.getElementById(ALL_PARAMS_PORTAL_ID)?.remove();
        removeUnitDropdownSearch();
        document.querySelectorAll('.sm-poc-pane-filters, .sm-poc-filter-bar').forEach((el) => el.remove());
        releaseFilterSpacing();
        lastContentSignature = '';
    }

    function getRowCells(row) {
        return Array.from(row.cells);
    }

    function rowKey(row) {
        if (row?.dataset?.smPocAllParam === '1' && row.dataset.smPocAliasText) {
            return row.dataset.smPocAliasText;
        }
        return (getRowCells(row)[0]?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function getPlantId() {
        const host = location.hostname || '';
        const href = location.href || '';
        const match = host.match(/^(\d{4,5})\./)
            || href.match(/\/\/(\d{4,5})\./)
            || href.match(/#\/(\d{4,5})\/settings\b/)
            || location.pathname.match(/\/(\d{4,5})\/settings\b/);
        return match ? match[1] : plantIdFromRoute();
    }

    // Reserve for ruter uten /settings, f.eks. /supermarket/4923/overview/graphics/6
    function plantIdFromRoute() {
        const parts = `${location.pathname}/${(location.hash || '').replace('#', '')}`.split('/');
        return parts.map((part) => part.trim())
            .find((part) => part.length >= 4 && part.length <= 5 && /^[0-9]+$/.test(part)) || null;
    }

    function getUnitId() {
        return document.querySelector('select.iwmac_dropdown')?.value || null;
    }

    // Rutingen varierer per vert: plants.iwmac.local:8080 bruker hash (/supermarket/#/8848/...),
    // www.iwmac.local bruker sti (/supermarket/8848/...). Bygg grafikk-lenken etter det siden faktisk bruker.
    function graphicsLink(plantId, graphicId) {
        const route = `/${plantId}/overview/graphics/${graphicId}`;
        // Avgjør på PATHNAME, ikke på om det finnes en hash: etter ett klikk henger
        // "#/8848/overview/..." igjen i URL-en, og en hash-sjekk ville da låst seg til feil form.
        // Sti-ruting (www.iwmac.local): /supermarket/8848/settings/... — anlegget ligger i stien.
        // Hash-ruting (plants...:8080): stien er bare /supermarket/.
        const pathRouted = location.pathname.match(/^(.*\/supermarket)\/\d{4,5}(?:\/|$)/);
        if (pathRouted) return { href: pathRouted[1] + route + location.search, hash: null };
        return { href: `${location.pathname}${location.search}#${route}`, hash: route };
    }

    function getUnitSelect() {
        return document.querySelector('select.iwmac_dropdown');
    }

    function removeUnitDropdownSearch() {
        document.querySelectorAll(`.${UNIT_COMBO_CLASS}`).forEach((el) => el.remove());
        document.getElementById(UNIT_PORTAL_ID)?.remove();
        document.querySelectorAll('select.iwmac_dropdown.sm-poc-unit-native-hidden').forEach((select) => {
            select.classList.remove('sm-poc-unit-native-hidden');
        });
    }

    function getGroupsContainer() {
        return document.querySelector('div.groups');
    }

    function getNativeGroupButtons() {
        return Array.from(document.querySelectorAll('div.groups button, div.groups .group'))
            .filter((button) => button.id !== ALL_PARAMS_BUTTON_ID);
    }

    function originalGroupPaddingLeft(groups) {
        const stored = groups?.dataset.smPocAllOldPaddingLeftPx;
        const number = Number(stored);
        return isFinite(number) ? number : 0;
    }

    function getAllParamsStyleSource() {
        const buttons = getNativeGroupButtons();
        return buttons.find((button) => !button.classList.contains('group-selected')) || buttons[0] || null;
    }

    function nativeGroupGap() {
        const buttons = getNativeGroupButtons();
        if (buttons.length >= 2) {
            const first = buttons[0].getBoundingClientRect();
            const second = buttons[1].getBoundingClientRect();
            const gap = Math.round(second.left - first.right);
            if (Math.abs(second.top - first.top) < first.height && gap >= 0 && gap <= 24) return gap;
        }
        return 6;
    }

    function syncAllParamsButtonStyle(button, native) {
        if (!button || !native) return;

        // The button lives in a fixed portal outside div.groups, so the page's
        // scoped .groups button rules never reach it — copy the full computed
        // look (typography, padding, border, colors) from an unselected native
        // group button so the box renders pixel-identical.
        button.className = 'group';
        const computed = window.getComputedStyle(native);
        NATIVE_BUTTON_STYLE_PROPS.forEach((prop) => { button.style[prop] = computed[prop]; });

        const nativeRect = native.getBoundingClientRect();
        if (nativeRect.width) button.style.width = `${nativeRect.width}px`;
        if (nativeRect.height) button.style.height = `${nativeRect.height}px`;
    }

    function updateAllParamsButtonActiveState(button) {
        if (!button) return;
        button.classList.toggle('group-selected', allParamsActive);
        button.classList.toggle('sm-poc-all-active', allParamsActive);
    }

    function reserveAllParamsButtonSpace(button) {
        const groups = getGroupsContainer();
        if (!groups || !button?.isConnected) return;
        if (groups.dataset.smPocAllSpace !== '1') {
            groups.dataset.smPocAllSpace = '1';
            groups.dataset.smPocAllOldPaddingLeft = groups.style.paddingLeft || '';
            groups.dataset.smPocAllOldPaddingLeftPx = String(parseFloat(window.getComputedStyle(groups).paddingLeft || '0') || 0);
        }
        const width = Math.ceil(button.getBoundingClientRect().width || 135);
        groups.style.paddingLeft = `${originalGroupPaddingLeft(groups) + width + nativeGroupGap()}px`;
    }

    function releaseAllParamsButtonSpace() {
        document.querySelectorAll('div.groups[data-sm-poc-all-space="1"]').forEach((groups) => {
            groups.style.paddingLeft = groups.dataset.smPocAllOldPaddingLeft || '';
            delete groups.dataset.smPocAllOldPaddingLeft;
            delete groups.dataset.smPocAllOldPaddingLeftPx;
            delete groups.dataset.smPocAllSpace;
        });
    }

    function positionAllParamsButton() {
        const button = document.getElementById(ALL_PARAMS_BUTTON_ID);
        const groups = getGroupsContainer();
        if (!button || !groups?.isConnected || !isSettingsPage()) {
            button?.remove();
            releaseAllParamsButtonSpace();
            return;
        }

        const native = getNativeGroupButtons()[0];
        syncAllParamsButtonStyle(button, getAllParamsStyleSource());
        updateAllParamsButtonActiveState(button);
        const rect = groups.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const nativeRect = native?.getBoundingClientRect();
        const left = rect.left + originalGroupPaddingLeft(groups);
        const top = nativeRect?.height ? nativeRect.top : rect.top;
        button.style.left = `${Math.round(left)}px`;
        button.style.top = `${Math.round(top)}px`;
        reserveAllParamsButtonSpace(button);
    }

    function ensureAllParamsButton() {
        if (!isSettingsPage()) {
            document.getElementById(ALL_PARAMS_BUTTON_ID)?.remove();
            releaseAllParamsButtonSpace();
            return null;
        }

        const groups = getGroupsContainer();
        if (!groups) return null;

        let button = document.getElementById(ALL_PARAMS_BUTTON_ID);
        if (!button) {
            button = document.createElement('button');
            button.id = ALL_PARAMS_BUTTON_ID;
            button.type = 'button';
            button.textContent = 'Vis alle parameter';
            button.title = 'Vis parameter fra alle grupper i valgt enhet';
            button.className = 'group';
            button.dataset.smPocAllParamsButton = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                toggleAllParamsView();
            }, true);
            getAllParamsPortal().appendChild(button);
        }

        syncAllParamsButtonStyle(button, getAllParamsStyleSource());
        updateAllParamsButtonActiveState(button);
        positionAllParamsButton();
        return button;
    }

    function setNativeParameterPanesHidden(hidden) {
        ['measurements', 'settings'].forEach((key) => {
            const pane = getPane(key);
            if (!pane) return;
            if (hidden) {
                // NB: lagret verdi er ofte tom streng (falsy) — sjekk på undefined,
                // ellers re-lagres 'none' ved andre gangs skjuling og panelet
                // forblir usynlig etter lukking.
                if (pane.dataset.smPocOldDisplay === undefined) {
                    pane.dataset.smPocOldDisplay = pane.style.display === 'none' ? '' : (pane.style.display || '');
                }
                pane.style.display = 'none';
            } else if (pane.dataset.smPocOldDisplay !== undefined) {
                pane.style.display = pane.dataset.smPocOldDisplay === 'none' ? '' : pane.dataset.smPocOldDisplay;
                delete pane.dataset.smPocOldDisplay;
            } else if (pane.style.display === 'none') {
                // Selvhelbredelse for paneler som ble sittende fast skjult (eldre versjoner).
                pane.style.display = '';
            }
        });
    }

    function removeAllParamsView() {
        document.getElementById(ALL_PARAMS_VIEW_ID)?.remove();
        closeAllParamsContextMenu();
        setNativeParameterPanesHidden(false);
        ensureAllParamsButton();
    }

    function clearFilterGridWidthCache(host) {
        const grid = host?.querySelector('.sm-poc-filter-grid');
        if (!grid) return;
        delete grid.dataset.smPocLastTemplate;
        grid.style.gridTemplateColumns = '';
    }

    function clearAllFilterGridWidthCaches() {
        document.querySelectorAll('.sm-poc-pane-filters').forEach(clearFilterGridWidthCache);
    }

    function restorePaneFiltersAfterAllParamsExit() {
        clearAllFilterGridWidthCaches();
        const restore = () => {
            if (!isSettingsPage() || allParamsActive) return;
            const found = findTables();
            if (!found) return;

            measurementsTable = found.measurements;
            settingsTable = found.settings;
            clearAllFilterGridWidthCaches();
            ensureHeaderFilters('measurements');
            ensureHeaderFilters('settings');
            applyAllFilters();
            positionAllFilterHosts();
        };

        requestAnimationFrame(() => requestAnimationFrame(restore));
        [120, 350, 800].forEach((delay) => setRedrawTimeout(restore, delay));
    }

    function syncAllParamsHeaderScrollbarGap() {
        document.querySelectorAll(`#${ALL_PARAMS_VIEW_ID} .sm-poc-all-pane`).forEach((pane) => {
            const scroll = pane.querySelector('.sm-poc-all-scroll');
            const header = pane.querySelector('.sm-poc-all-header-table');
            if (!scroll || !header) return;
            // Body-tabellen mister rullefelt-bredden inne i .sm-poc-all-scroll;
            // krymp header-tabellen tilsvarende slik at %-kolonnene treffer likt.
            const gap = scroll.offsetWidth - scroll.clientWidth;
            const next = gap > 0 ? `calc(100% - ${gap}px)` : '';
            if (header.style.width !== next) header.style.width = next;
        });
    }

    function positionAllParamsView() {
        const view = document.getElementById(ALL_PARAMS_VIEW_ID);
        if (!view) return;
        const root = document.querySelector('div.parameters');
        if (!root?.isConnected || !isSettingsPage()) {
            view.remove();
            return;
        }
        const rect = root.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        view.style.left = `${Math.round(rect.left)}px`;
        view.style.top = `${Math.round(rect.top)}px`;
        view.style.width = `${Math.round(rect.width)}px`;
        view.style.height = `${Math.max(Math.round(window.innerHeight - rect.top - 8), 160)}px`;
        syncAllParamsHeaderScrollbarGap();
    }

    function deactivateAllParamsView(options = {}) {
        clearTimeout(allParamsUnitSwitchTimer);
        allParamsGeneration++;
        allParamsActive = false;
        allParamsBusy = false;
        allParamsData = null;
        removeAllParamsView();
        if (options.removeButton) {
            document.getElementById(ALL_PARAMS_BUTTON_ID)?.remove();
            releaseAllParamsButtonSpace();
        }
        if (!options.keepSelection) clearSelection();
        if (!options.removeButton) restorePaneFiltersAfterAllParamsExit();
    }

    function settingsRpc(method, params) {
        return fetchWithTimeout('/services/iwmac_plant/settings.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
            cache: 'no-cache'
        }, 25000).then(async (response) => {
            const data = await response.json();
            if (data?.error) {
                throw new Error(data.error.message || data.error || `${method} feilet`);
            }
            return data?.result;
        });
    }

    function parseParamCsvLine(line) {
        const fields = [];
        let value = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') {
                    value += '"';
                    i++;
                } else if (ch === '"') {
                    quoted = false;
                } else {
                    value += ch;
                }
            } else if (ch === '"') {
                quoted = true;
            } else if (ch === ',') {
                fields.push(value);
                value = '';
            } else {
                value += ch;
            }
        }
        fields.push(value);
        return fields;
    }

    // Gruppe-svaret (settings.php :: get_parameters) har driver_id som 4. CSV-felt for hver rad.
    // IWMACs native tabell viser ingen driver_id i DOM-en, så vi henter gruppens eget svar og slår
    // opp alias -> driver_id. Bare ÉN gruppe holdes i minnet om gangen: ny gruppe/enhet ERSTATTER
    // forrige (cachen vokser ikke).
    let unitGroupsCache = { key: '', groups: [] };
    let nativeDriverIdCache = { key: '', byAlias: new Map() };

    function normalizeLabel(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    async function getUnitGroups(plantId, unitId) {
        const key = `${plantId}|${unitId}`;
        if (unitGroupsCache.key === key) return unitGroupsCache.groups;
        const groups = await settingsRpc('get_groups', { plant: Number(plantId), unit_id: unitId, preffered_group: '' }) || [];
        unitGroupsCache = { key, groups };
        return groups;
    }

    async function getSelectedGroupId(plantId, unitId) {
        const label = normalizeLabel(getSelectedGroupButton()?.textContent);
        if (!label) return '';
        const groups = await getUnitGroups(plantId, unitId);
        return groups.find((group) => normalizeLabel(group.alias_text) === label)?.id || '';
    }

    async function ensureNativeDriverIds() {
        const plantId = getPlantId();
        const unitId = getUnitId();
        if (!plantId || !unitId) return nativeDriverIdCache.byAlias;
        const groupId = await getSelectedGroupId(plantId, unitId).catch(() => '');
        const key = `${plantId}|${unitId}|${groupId}`;
        if (!groupId || nativeDriverIdCache.key === key) return nativeDriverIdCache.byAlias;
        const result = await settingsRpc('get_parameters', {
            plant: Number(plantId), unit_id: unitId, group: groupId, preffered_group: ''
        }) || {};
        const group = { id: groupId, alias_text: '' };
        const byAlias = new Map();
        [...parseSettingsParameterCsv(result.read, group, 'measurements'),
            ...parseSettingsParameterCsv(result.write, group, 'settings')].forEach((row) => {
            const alias = gfxNormAlias(row.aliasText);
            if (alias && row.driverId) byAlias.set(alias, row.driverId);
        });
        nativeDriverIdCache = { key, byAlias };
        return byAlias;
    }

    function nativeDriverIdFor(aliasText) {
        return nativeDriverIdCache.byAlias.get(gfxNormAlias(aliasText)) || '';
    }

    function parseSettingsParameterCsv(text, group, side) {
        return String(text || '').split('\n').map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return null;
            const parts = parseParamCsvLine(trimmed);
            return {
                side,
                groupId: group.id || '',
                menu: group.id || '',
                groupName: group.alias_text || '',
                aliasText: parts[0] || '',
                valueHtml: parts[1] || '',
                unitHtml: parts[2] || '',
                driverId: parts[3] || ''
            };
        }).filter(Boolean);
    }

    async function fetchAllGroupParameters(onProgress, shouldContinue = () => true) {
        const plantId = getPlantId();
        const unitId = getUnitId();
        if (!plantId || !unitId) {
            throw new Error('Fant ikke plant_id eller unit_id.');
        }
        return fetchGroupParametersForUnit(plantId, unitId, onProgress, shouldContinue);
    }

    // Samme henting for en vilkårlig enhet, ikke bare den som er åpen: alle-enheter
    // eksporten går gjennom denne per enhet.
    async function fetchGroupParametersForUnit(plantId, unitId, onProgress, shouldContinue = () => true) {
        const groups = await settingsRpc('get_groups', {
            plant: Number(plantId),
            unit_id: unitId,
            preffered_group: ''
        }) || [];

        // Resultater samles per gruppe-indeks slik at delvise data alltid kan
        // settes sammen i gruppe-rekkefølge mens forespørslene pågår.
        const completed = new Array(groups.length).fill(null);
        let doneCount = 0;
        const assemble = () => {
            const measurements = [];
            const settings = [];
            const failed = [];
            completed.forEach((entry) => {
                if (!entry) return;
                if (!entry.ok) {
                    if (!entry.skipped) failed.push(entry);
                    return;
                }
                measurements.push(...entry.measurements);
                settings.push(...entry.settings);
            });
            return { plantId, unitId, groups, measurements, settings, failed };
        };

        await mapWithConcurrency(groups, ALL_GROUPS_FETCH_CONCURRENCY, async (group, index) => {
            let entry;
            if (!shouldContinue()) {
                entry = { ok: false, skipped: true, item: group };
            } else {
                try {
                    const result = await settingsRpc('get_parameters', {
                        plant: Number(plantId),
                        unit_id: unitId,
                        group: group.id,
                        preffered_group: ''
                    }) || {};
                    entry = {
                        ok: true,
                        group,
                        measurements: parseSettingsParameterCsv(result.read, group, 'measurements'),
                        settings: parseSettingsParameterCsv(result.write, group, 'settings')
                    };
                } catch (error) {
                    entry = { ok: false, item: group, error };
                }
            }
            completed[index] = entry;
            doneCount++;
            if (!entry.skipped) onProgress?.(assemble, doneCount, groups.length);
            return entry;
        });

        return assemble();
    }

    function stripHtmlToText(html) {
        const div = document.createElement('div');
        div.innerHTML = String(html || '');
        return (div.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isZeroDisplayText(text) {
        const normalized = String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, '')
            .replace(',', '.')
            .trim();
        return /^[-+]?0+(?:\.0+)?$/.test(normalized);
    }

    function rowValueText(row) {
        return (row?.cells?.[1]?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function rowHasHiddenZeroValue(row) {
        return hideZeroValuesEnabled && isZeroDisplayText(rowValueText(row));
    }

    function allParamHasHiddenZeroValue(row) {
        return hideZeroValuesEnabled && isZeroDisplayText(stripHtmlToText(row?.valueHtml || ''));
    }

    function allParamSortValue(row, key) {
        if (key === 'value') return stripHtmlToText(row.valueHtml);
        if (key === 'unit') return stripHtmlToText(row.unitHtml);
        if (key === 'side') return row.side;
        return String(row[key] || '');
    }

    function sortAllParamRows(rows) {
        const { key, direction } = allParamsSort;
        const dir = direction === 'desc' ? -1 : 1;
        return rows.slice().sort((a, b) => {
            const av = allParamSortValue(a, key);
            const bv = allParamSortValue(b, key);
            const an = Number(av);
            const bn = Number(bv);
            if (isFinite(an) && isFinite(bn)) return (an - bn) * dir;
            return av.localeCompare(bv, 'nb', { sensitivity: 'base', numeric: true }) * dir;
        });
    }

    function allParamFilterValue(row, key) {
        if (key === 'value') return stripHtmlToText(row.valueHtml);
        if (key === 'unit') return stripHtmlToText(row.unitHtml);
        return String(row[key] || '');
    }

    // Samme vurdering som radmarkeringen, men på rowData (filteret jobber på data, ikke DOM)
    function gfxRowDataIsUsed(rowData) {
        if (!gfxStateIsCurrent()) return false;
        if (gfxPanelsForRow(rowData).length) return true;
        const text = `${rowData.groupId || ''} ${rowData.groupName || ''} ${rowData.aliasText || ''}`;
        const match = text.match(/\[([A-Za-z0-9][A-Za-z0-9_-]*)\]/);
        return !!(match && gfxState.menus.has(match[1].trim()));
    }

    function allParamMatches(row) {
        if (allParamsOnlyGraphics && !gfxRowDataIsUsed(row)) return false;
        if (allParamHasHiddenZeroValue(row)) return false;
        const filters = allParamsFilters[row.side] || {};
        return Object.entries(filters).every(([key, query]) => {
            if (!query) return true;
            return filterTextMatches(allParamFilterValue(row, key), query);
        });
    }

    function updateAllParamsStatus(view) {
        const status = view.querySelector('.sm-poc-all-status');
        if (!status) return;
        const total = view.querySelectorAll('tbody tr').length;
        const visible = Array.from(view.querySelectorAll('tbody tr')).filter(isVisibleRow).length;
        const failed = allParamsData?.failed?.length || 0;
        const suffix = failed ? `, ${failed} gruppe(r) feilet` : '';
        status.textContent = `Viser ${visible}/${total} parameter${suffix}`;
    }

    function filterAllParamsView() {
        const view = document.getElementById(ALL_PARAMS_VIEW_ID);
        if (!view) return;
        view.querySelectorAll('tbody tr').forEach((row) => {
            const data = row.__smPocAllParam;
            row.style.display = data && allParamMatches(data) ? '' : 'none';
        });
        updateAllParamsStatus(view);
        syncAllParamsHeaderScrollbarGap();
    }

    function scrollAllParamsPaneFromWheel(event) {
        const pane = event.target.closest('.sm-poc-all-pane');
        if (!pane) return;

        const scroller = event.target.closest('.sm-poc-all-scroll') || pane.querySelector('.sm-poc-all-scroll');
        if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;

        event.preventDefault();
        event.stopPropagation();
        scroller.scrollTop += event.deltaY;
        scroller.scrollLeft += event.deltaX;
    }

    function createAllParamsCell(content, options = {}) {
        const td = document.createElement('td');
        if (options.className) td.className = options.className;
        if (options.html) td.innerHTML = content || '&nbsp;';
        else td.textContent = content || '';
        if (options.title !== false) td.title = td.textContent.replace(/\s+/g, ' ').trim();
        if (options.width) td.style.width = options.width;
        return td;
    }

    function clearDragState() {
        draggingRows.forEach((r) => r.classList.remove(DRAGGING_CLASS));
        draggingRows = [];
        draggingFromSide = null;
        clearDropIndicator();
        document.querySelectorAll(`.${DROP_TARGET_CLASS}`).forEach((el) => {
            el.classList.remove(DROP_TARGET_CLASS);
        });
    }

    function bindAllParamsRowDrag(row) {
        row.draggable = moveModeEnabled;

        row.addEventListener('dragstart', (event) => {
            if (!moveModeEnabled) {
                event.preventDefault();
                return;
            }
            draggingRows = getRowsToDrag(row);
            draggingFromSide = rowVisualSide(row);
            draggingRows.forEach((r) => r.classList.add(DRAGGING_CLASS));
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', draggingFromSide || 'sm-poc-all-move');
            event.stopPropagation();
        });

        row.addEventListener('dragend', () => {
            clearDragState();
        });
    }

    function createAllParamsRow(rowData, tbody) {
        const row = document.createElement('tr');
        row.__smPocAllParam = rowData;
        row.dataset.smPocAllParam = '1';
        row.dataset.smPocAllSide = rowData.side;
        row.dataset.smPocDriverId = rowData.driverId;
        row.dataset.smPocAliasText = rowData.aliasText;
        row.dataset.smPocGroupName = rowData.groupName;
        row.dataset.smPocMenu = rowData.menu || rowData.groupId || '';
        row.title = rowData.driverId;
        bindAllParamsRowDrag(row);
        applyGfxStateToRow(row); // highlight + panel-tag overlever re-render

        const groupCell = createAllParamsCell('', { width: '18%' });
        const badge = document.createElement('span');
        badge.className = 'sm-poc-all-group';
        badge.textContent = rowData.groupName || '-';
        badge.title = rowData.groupName || '';
        groupCell.appendChild(badge);
        row.appendChild(groupCell);
        row.appendChild(createAllParamsCell(rowData.aliasText, { width: '42%' }));
        row.appendChild(createAllParamsCell(rowData.valueHtml, { html: true, width: '22%', className: 'sm-poc-all-value-cell' }));
        row.appendChild(createAllParamsCell(rowData.unitHtml || '&nbsp;', { html: true, width: '18%', className: 'sm-poc-all-unit-cell' }));

        row.addEventListener('click', (event) => {
            if (!moveModeEnabled) return;
            if (event.target.closest('input, button, a')) return;
            event.preventDefault();
            event.stopPropagation();
            handleRowClick(row, tbody, event);
        }, true);

        row.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (moveModeEnabled && !selectedRows.has(row)) {
                toggleRowSelection(row, event.ctrlKey || event.metaKey);
            }
            showAllParamsContextMenu(event.clientX, event.clientY, row);
        }, true);

        return row;
    }

    function bindAllParamsDropZone(pane, targetKey) {
        const acceptFrom = targetKey === 'settings' ? 'measurements' : 'settings';
        const moveFn = targetKey === 'settings' ? moveRowsToSettings : moveRowsToMeasurements;

        pane.addEventListener('dragover', (event) => {
            if (!moveModeEnabled) return;
            const from = draggingFromSide || (draggingRows[0] ? rowVisualSide(draggingRows[0]) : null);
            if (from !== acceptFrom) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            pane.classList.add(DROP_TARGET_CLASS);
        });

        pane.addEventListener('dragleave', (event) => {
            if (!pane.contains(event.relatedTarget)) {
                pane.classList.remove(DROP_TARGET_CLASS);
            }
        });

        pane.addEventListener('drop', (event) => {
            if (!moveModeEnabled) return;
            const from = draggingFromSide || (draggingRows[0] ? rowVisualSide(draggingRows[0]) : null);
            if (from !== acceptFrom) return;
            event.preventDefault();
            event.stopPropagation();
            pane.classList.remove(DROP_TARGET_CLASS);

            const rows = draggingRows.length
                ? draggingRows
                : Array.from(selectedRows).filter((r) => rowVisualSide(r) === acceptFrom);
            if (!rows.length) {
                showHint(acceptFrom === 'measurements'
                    ? 'Velg rader i Måling eller dra fra Innstillinger'
                    : 'Velg rader i Innstillinger eller dra fra Måling');
                return;
            }

            moveFn(rows);
            clearSelection();
            applyMoveMode();
            filterAllParamsView();
            clearDragState();
        });
    }

    function createAllParamsPane(title, rows, side) {
        const pane = document.createElement('div');
        pane.className = 'sm-poc-all-pane';
        pane.dataset.side = side;
        const nameLabel = side === 'measurements' ? 'Måling' : 'Innstilling';
        const filters = allParamsFilters[side] || {};
        const colgroup = `
            <colgroup>
                <col style="width:18%;">
                <col style="width:42%;">
                <col style="width:22%;">
                <col style="width:18%;">
            </colgroup>
        `;
        pane.innerHTML = `
            <div class="sm-poc-all-title">${escapeHtml(title)} (${rows.length})</div>
            <table class="sm-poc-all-header-table">
                ${colgroup}
                <thead>
                    <tr>
                        <th data-sort="groupName">Gruppe</th>
                        <th data-sort="aliasText">${nameLabel}</th>
                        <th data-sort="value">Verdi</th>
                        <th data-sort="unit">Enhet</th>
                    </tr>
                    <tr class="sm-poc-all-filter-row">
                        <th><input type="text" data-side="${side}" data-filter-key="groupName" placeholder="Gruppe" value="${escapeHtml(filters.groupName || '')}"></th>
                        <th><input type="text" data-side="${side}" data-filter-key="aliasText" placeholder="${nameLabel}" value="${escapeHtml(filters.aliasText || '')}"></th>
                        <th><input type="text" data-side="${side}" data-filter-key="value" placeholder="Verdi" value="${escapeHtml(filters.value || '')}"></th>
                        <th><input type="text" data-side="${side}" data-filter-key="unit" placeholder="Enhet" value="${escapeHtml(filters.unit || '')}"></th>
                    </tr>
                </thead>
            </table>
            <div class="sm-poc-all-scroll">
                <table class="sm-poc-all-table">
                    ${colgroup}
                    <tbody></tbody>
                </table>
            </div>
        `;
        bindAllParamsDropZone(pane, side);
        const tbody = pane.querySelector('tbody');
        sortAllParamRows(rows).forEach((rowData) => tbody.appendChild(createAllParamsRow(rowData, tbody)));
        pane.querySelectorAll('.sm-poc-all-header-table th[data-sort]').forEach((th) => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                allParamsSort = {
                    key,
                    direction: allParamsSort.key === key && allParamsSort.direction === 'asc' ? 'desc' : 'asc'
                };
                renderAllParamsView();
            });
        });
        pane.querySelectorAll('.sm-poc-all-filter-row input').forEach((input) => {
            input.classList.toggle('sm-poc-col-active', !!input.value.trim());
            ['click', 'mousedown', 'pointerdown', 'keydown'].forEach((eventName) => {
                input.addEventListener(eventName, (event) => event.stopPropagation());
            });
            input.addEventListener('input', () => {
                const targetSide = input.dataset.side;
                const key = input.dataset.filterKey;
                if (!allParamsFilters[targetSide]) allParamsFilters[targetSide] = {};
                allParamsFilters[targetSide][key] = input.value.trim();
                input.classList.toggle('sm-poc-col-active', !!input.value.trim());
                filterAllParamsView();
            });
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
        return pane;
    }

    function updateOnlyGraphicsButton() {
        const button = document.querySelector(`#${ALL_PARAMS_VIEW_ID} [data-action="only-graphics"]`);
        if (!button) return;
        button.classList.toggle('sm-poc-active', allParamsOnlyGraphics);
        button.textContent = allParamsOnlyGraphics ? 'Viser kun i grafikk' : 'Kun i grafikk';
        button.title = 'Vis bare parametere som brukes i grafikk-bilder';
    }

    async function toggleOnlyGraphicsFilter() {
        // Slå på uten grafikk-data? Hent den først, ellers ville lista blitt tom.
        if (!allParamsOnlyGraphics && !(gfxStateIsCurrent() && gfxState.loaded)) {
            await highlightUsedInGraphicsFromAllParams();
            if (!gfxStateIsCurrent()) return; // oppslaget feilet - ikke slå på filteret
        }
        allParamsOnlyGraphics = !allParamsOnlyGraphics;
        updateOnlyGraphicsButton();
        filterAllParamsView();
    }

    function renderAllParamsView() {
        if (!allParamsActive || !allParamsData) return;
        const root = document.querySelector('div.parameters');
        if (!root) return;

        removePaneFilters();
        clearGhostRows();
        setNativeParameterPanesHidden(true);

        let view = document.getElementById(ALL_PARAMS_VIEW_ID);
        if (!view) {
            view = document.createElement('div');
            view.id = ALL_PARAMS_VIEW_ID;
            view.className = 'sm-poc-all-params-view';
            getAllParamsPortal().appendChild(view);
            ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'focusin', 'keydown', 'keyup', 'input'].forEach((eventName) => {
                view.addEventListener(eventName, (event) => {
                    event.stopPropagation();
                });
            });
            view.addEventListener('wheel', scrollAllParamsPaneFromWheel, { passive: false });
        }

        // Bevar rulleposisjon før innerHTML bygger alt på nytt, ellers hopper
        // sortering/filter/livsoppdatering brukeren tilbake til toppen.
        const savedScroll = {};
        view.querySelectorAll('.sm-poc-all-pane').forEach((pane) => {
            const scroll = pane.querySelector('.sm-poc-all-scroll');
            if (scroll) savedScroll[pane.dataset.side] = { top: scroll.scrollTop, left: scroll.scrollLeft };
        });

        const failedText = allParamsData.failed?.length
            ? `<span style="color:#c62828;">${allParamsData.failed.length} gruppe(r) feilet</span>`
            : '';
        view.innerHTML = `
            <div class="sm-poc-all-toolbar">
                <button type="button" data-action="close">Vis enkeltgruppe</button>
                <button type="button" data-action="only-graphics">Kun i grafikk</button>
                <button type="button" class="sm-poc-all-export-btn" data-action="export" title="Export this unit's parameters to an Excel file">Export unit (Excel)</button>
                <span class="sm-poc-all-status"></span>
                ${failedText}
            </div>
            <div class="sm-poc-all-columns"></div>
        `;
        const columns = view.querySelector('.sm-poc-all-columns');
        columns.appendChild(createAllParamsPane('Måling - alle grupper', allParamsData.measurements, 'measurements'));
        columns.appendChild(createAllParamsPane('Innstillinger - alle grupper', allParamsData.settings, 'settings'));

        view.querySelector('[data-action="close"]').addEventListener('click', () => deactivateAllParamsView());
        view.querySelector('[data-action="only-graphics"]').addEventListener('click', toggleOnlyGraphicsFilter);
        view.querySelector('[data-action="export"]').addEventListener('click', exportParametersToExcel);
        updateOnlyGraphicsButton();
        filterAllParamsView();
        positionAllParamsView();
        applyMoveMode();
        renderGfxBadge();

        Object.entries(savedScroll).forEach(([side, position]) => {
            const scroll = view.querySelector(`.sm-poc-all-pane[data-side="${side}"] .sm-poc-all-scroll`);
            if (scroll) {
                scroll.scrollTop = position.top;
                scroll.scrollLeft = position.left;
            }
        });
    }

    function allParamsViewHasFocusedInput() {
        const active = document.activeElement;
        return !!active && active.tagName === 'INPUT' && !!active.closest(`#${ALL_PARAMS_VIEW_ID}`);
    }

    function allParamsTotalsText(data) {
        const total = (data?.measurements?.length || 0) + (data?.settings?.length || 0);
        return `${total} parameter fra ${data?.groups?.length || 0} grupper`;
    }

    async function activateAllParamsView(forceReload = false) {
        const cacheKey = `${getPlantId()}|${getUnitId()}`;
        // Samme enhet hentes allerede — ikke start en duplikat.
        if (allParamsBusy && !forceReload && allParamsFetchKey === cacheKey) return;

        // Nyere aktivering vinner: generasjonsbumpen får en eventuell eldre
        // henting (annen enhet) til å slutte å sende forespørsler og forkaste
        // resultatet sitt i stedet for at den gamle enhetens data rendres.
        const generation = ++allParamsGeneration;
        allParamsActive = true;
        allParamsBusy = true;
        allParamsFetchKey = cacheKey;
        ensureAllParamsButton();
        removePaneFilters();
        clearSelection();

        try {
            const cached = forceReload ? null : allParamsCache.get(cacheKey);
            if (cached) {
                allParamsData = cached.data;
                renderAllParamsView();
                if (Date.now() - cached.at < ALL_PARAMS_CACHE_FRESH_MS) {
                    showHint(`Viser ${allParamsTotalsText(cached.data)}.`);
                    return;
                }
                showHint('Oppdaterer parameter...');
            } else {
                showHint('Laster parameter fra alle grupper...');
            }

            let lastProgressRender = 0;
            const data = await fetchAllGroupParameters((getPartial, done, total) => {
                if (generation !== allParamsGeneration) return;
                if (cached) return;
                showHint(`Laster parameter... ${done}/${total} grupper`);
                const now = Date.now();
                if (
                    done === total
                    || now - lastProgressRender < ALL_PARAMS_PROGRESS_RENDER_MS
                    || allParamsViewHasFocusedInput()
                ) return;
                const partial = getPartial();
                const rows = partial.measurements.length + partial.settings.length;
                if (rows > ALL_PARAMS_PROGRESSIVE_MAX_ROWS && document.getElementById(ALL_PARAMS_VIEW_ID)) return;
                lastProgressRender = now;
                allParamsData = partial;
                renderAllParamsView();
            }, () => generation === allParamsGeneration);

            if (generation !== allParamsGeneration) return;
            if (!data.failed?.length) {
                allParamsCache.set(cacheKey, { data, at: Date.now() });
            }
            allParamsData = data;
            renderAllParamsView();
            showHint(`Viser ${allParamsTotalsText(data)}.`);
        } catch (error) {
            if (generation !== allParamsGeneration) return;
            console.log('[Supermarket Parameters POC] All parameters error:', error);
            alert('Kunne ikke laste alle parameter: ' + error.message);
            deactivateAllParamsView();
        } finally {
            if (generation === allParamsGeneration) {
                allParamsBusy = false;
                allParamsFetchKey = '';
                ensureAllParamsButton();
            }
        }
    }

    function toggleAllParamsView() {
        if (allParamsActive) deactivateAllParamsView();
        else activateAllParamsView(false);
    }

    function closeAllParamsContextMenu() {
        document.querySelectorAll('.sm-poc-all-context').forEach((menu) => menu.remove());
    }

    function createAllParamsContextItem(label, action) {
        const item = document.createElement('div');
        item.className = 'sm-poc-all-context-item';
        item.dataset.action = action;
        item.innerHTML = `
            <div>${escapeHtml(label)}</div>
            <div></div>
        `;
        return item;
    }

    function appendAllParamsSeparator(menu) {
        const separator = document.createElement('hr');
        menu.appendChild(separator);
    }

    function getAllParamMenuFromRow(row) {
        const data = row?.__smPocAllParam || {};
        const text = `${data.groupId || ''} ${data.groupName || ''} ${data.aliasText || ''}`;
        const match = text.match(/\[([A-Za-z0-9][A-Za-z0-9_-]*)\]/);
        return match ? match[1].trim() : '';
    }

    // ---- Highlight used_in_graphics + grafikk-paneler ----
    function gfxKey() { return `${getPlantId()}|${getUnitId()}`; }
    function gfxStateIsCurrent() { return !!gfxState.key && gfxState.key === gfxKey(); }

    function gfxNormAlias(value) {
        let text = String(value || '');
        const groupSep = text.indexOf(',-'); // bildets alias er "<gruppe>,-<tag>"
        if (groupSep > -1) text = text.slice(groupSep + 2);
        return String(text).replace(/^\s*\[[^\]]*\]\s*/, '').split('[')[0].replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // driver_id er unik per parameter og brukes når raden har den (Vis alle parameter).
    // IWMACs native rader har ingen driver_id — der brukes EKSAKT alias mot bildets alias_text,
    // ikke lenger delstreng-søk i hele json-blobben (det var kilden til feiltreff).
    function gfxPanelsForRow(rowData) {
        const driverId = String(rowData?.driverId || '').trim();
        const alias = gfxNormAlias(rowData?.aliasText);
        if (driverId.length < 4 && !alias) return [];
        return gfxState.panels.filter((p) => (
            p.elements.some((el) => (driverId.length > 3 && el.driverId === driverId)
                || (!!alias && gfxNormAlias(el.alias) === alias))
            || (p.raw && driverId.length > 3 && p.raw.includes(driverId))
        )).map((p) => p.name);
    }

    // Gjelder både Vis-alle-rader (egen tabell) og IWMACs native rader ("[menu] alias [ beskrivelse ]")
    function gfxRowInfo(row) {
        if (row.dataset?.smPocAllParam === '1') {
            const d = row.__smPocAllParam || {};
            return { menu: getAllParamMenuFromRow(row), driverId: d.driverId, aliasText: d.aliasText, cell: row.children[1] };
        }
        const d = getDataFromRow(row);
        // native rad: driver_id finnes ikke i DOM-en — hent den fra gruppe-cachen
        return {
            menu: d.menu || '',
            driverId: d.driver_id || nativeDriverIdFor(d.alias_text),
            aliasText: d.alias_text,
            cell: row.querySelector('td')
        };
    }

    // Markering: raden er i bildet (driver_id/alias fra panel-json) ELLER menykoden står i menu_list.
    // Panel-treff er det presise; menu_list beholdes fordi anlegg med [meny]-koder og uten
    // driver_id i tabellen (5294) ellers ville mistet markeringen.
    function applyGfxStateToRow(row) {
        const info = gfxRowInfo(row);
        const active = gfxStateIsCurrent();
        const names = active ? gfxPanelsForRow(info) : [];
        const hit = names.length > 0 || (active && !!info.menu && gfxState.menus.has(info.menu));
        row.classList.toggle('sm-poc-used-in-graphics', hit);
        if (info.cell) {
            if (names.length) info.cell.dataset.smPanels = names.join(', ');
            else delete info.cell.dataset.smPanels;
        }
        return hit;
    }

    function gfxRows() {
        const view = document.getElementById(ALL_PARAMS_VIEW_ID);
        const inView = view ? Array.from(view.querySelectorAll('tbody tr')) : [];
        const native = Array.from(document.querySelectorAll('div.parameters tbody tr'))
            .filter((row) => !(view && view.contains(row)) && !row.classList.contains('sm-poc-ghost-row'));
        return inView.concat(native);
    }

    function applyGfxStateToAllRows() {
        let count = 0;
        gfxRows().forEach((row) => { if (applyGfxStateToRow(row)) count++; });
        renderGfxBadge();
        return count;
    }

    function clearGfxState() {
        gfxState = { key: '', loaded: false, menus: new Set(), panels: [] };
        allParamsOnlyGraphics = false;
        applyGfxStateToAllRows();
    }

    // Utenfor Vis-alle: badgen ligger i en fixed host i unit-portalen, ankret til høyre for enhetsvelgeren
    function getGfxBadgeHost() {
        const portal = getUnitPortal();
        let host = portal.querySelector('.sm-poc-gfx-badge-host');
        if (!host) {
            host = document.createElement('div');
            host.className = 'sm-poc-gfx-badge-host';
            portal.appendChild(host);
        }
        return host;
    }

    function positionGfxBadgeHost() {
        const portal = document.getElementById(UNIT_PORTAL_ID);
        const host = portal?.querySelector('.sm-poc-gfx-badge-host');
        if (!host) return;
        const combo = portal.querySelector(`.${UNIT_COMBO_CLASS}`);
        const rect = (combo?.isConnected ? combo : getUnitSelect())?.getBoundingClientRect();
        if (!rect || !rect.width || !isSettingsPage()) {
            host.style.display = 'none';
            return;
        }
        host.style.display = '';
        host.style.left = `${Math.round(rect.right + 10)}px`;
        host.style.top = `${Math.round(rect.top)}px`;
        host.style.maxWidth = `${Math.max(200, Math.round(window.innerWidth - rect.right - 30))}px`;
    }

    // Badge: toggle + lenker til bildene + ✕. I Vis-alle-verktøylinjen når den er aktiv, ellers ved enhetsvelgeren.
    function renderGfxBadge() {
        document.querySelectorAll('.sm-poc-gfx-badge').forEach((el) => el.remove());
        if (!gfxStateIsCurrent() || (!gfxState.loaded && !gfxState.menus.size)) return;
        const toolbar = allParamsActive
            ? document.querySelector(`#${ALL_PARAMS_VIEW_ID} .sm-poc-all-toolbar`)
            : getGfxBadgeHost();
        if (!toolbar) return;
        const badge = document.createElement('span');
        badge.className = 'sm-poc-gfx-badge';
        badge.appendChild(document.createTextNode(gfxState.panels.length ? 'I grafikk:' : 'Ikke funnet i grafikk'));
        const plantId = getPlantId();
        gfxState.panels.forEach((p) => {
            const a = document.createElement('a');
            a.textContent = p.name;
            if (p.id) {
                const link = graphicsLink(plantId, p.id);
                a.href = link.href;
                a.title = 'Åpne bildet — objektene for denne enheten blinker i 3 sekunder';
                a.addEventListener('click', (event) => {
                    rememberGraphicsFlash(p, plantId); // overlever full sidelasting (sti-ruting)
                    if (!link.hash) return;            // sti-ruting: la lenken navigere selv
                    event.preventDefault();            // hash-ruting: naviger uten reload
                    event.stopPropagation();
                    location.hash = link.hash;
                });
            }
            badge.appendChild(a);
        });
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '✕';
        close.title = 'Fjern highlight og paneler';
        close.addEventListener('click', clearGfxState);
        badge.appendChild(close);
        toolbar.appendChild(badge);
        if (!allParamsActive) positionGfxBadgeHost();
    }

    function findRowsWithKey(value, key) {
        if (Array.isArray(value)) {
            if (value.length && value[0] && typeof value[0] === 'object' && key in value[0]) return value;
            for (const item of value) { const r = findRowsWithKey(item, key); if (r.length) return r; }
            return [];
        }
        if (!value || typeof value !== 'object') return [];
        for (const k of ['data', 'rows', 'result', 'results']) { const r = findRowsWithKey(value[k], key); if (r.length) return r; }
        return [];
    }

    // Én SELECT: iw_sys_graphic_designer.json inneholder elementer med "unit_id":"<enhetsid>"
    async function fetchGraphicsPanelsForUnit(unitId, plantId) {
        const needle = sqlQuote(unitId).replace(/[%_]/g, '\\$&'); // LIKE-wildcards etter quote
        const fd = new FormData();
        fd.append('plant_id', plantId);
        // Eldre bilder har tom json og alt i xml-kolonnen (<unit_id>...</unit_id>)
        fd.append('sql_command', `SELECT * FROM iw_plant_server3.iw_sys_graphic_designer`
            + ` WHERE json LIKE '%"unit_id":"${needle}"%' OR xml LIKE '%<unit_id>${needle}</unit_id>%'`);
        fd.append('_cache_bust', Date.now());
        const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', { method: 'POST', body: fd, cache: 'no-cache' });
        const data = await response.json();
        if (!data?.success) throw new Error(data?.error || 'Panel-oppslag feilet');
        // ponytail: SELECT * fordi json trengs til per-rad-tagging og navne-/id-kolonne er gjettet
        const idOf = (x) => {
            const keys = Object.keys(x);
            const k = keys.find((key) => /^(id|graphic_id|graphics_id|picture_id|pic_id)$/i.test(key))
                || keys.find((key) => /id$/i.test(key) && !/^(unit|plant)_id$/i.test(key) && /^\d+$/.test(String(x[key])));
            return k ? String(x[k]) : '';
        };
        return findRowsWithKey(data, 'json').map((x) => {
            const elements = pictureElements(x, unitId);
            return {
                id: idOf(x),
                name: x.name || x.panel_name || x.title || x.graphic_name || `#${idOf(x) || '?'}`,
                elements,
                raw: elements.length ? '' : String(x.json || x.xml || '') // reserve om formatet ikke lot seg lese
            };
        });
    }

    // Eldre bilder lagrer objektene som <data>-blokker i xml-kolonnen:
    // <id> = driver_id, <alias_text>, <unit_id>, <left>/<top>/<width>/<height>.
    // Verifisert på anlegg 8556 ("+VA=360.007 Soner", json_len = 0).
    function panelElementsFromXml(xmlText, unitId) {
        const out = [];
        String(xmlText || '').split('<data>').slice(1).forEach((chunk) => {
            const body = chunk.split('</data>')[0];
            const tag = (name) => {
                const open = `<${name}>`;
                const start = body.indexOf(open);
                if (start === -1) return '';
                const from = start + open.length;
                const end = body.indexOf(`</${name}>`, from);
                return end === -1 ? '' : body.slice(from, end).trim();
            };
            const elementUnit = tag('unit_id');
            if (unitId !== null && elementUnit !== String(unitId || '').trim()) return;
            const driverId = tag('id');
            const alias = decodeXmlText(tag('alias_text'));
            if (!driverId && !alias) return;
            const numbers = ['left', 'top', 'width', 'height'].map((name) => Number(tag(name)));
            const pos = numbers.every(Number.isFinite) ? {
                left: numbers[0], top: numbers[1], width: numbers[2], height: numbers[3]
            } : null;
            out.push({ driverId, alias, unitId: elementUnit, pos });
        });
        return out;
    }

    function decodeXmlText(value) {
        if (!value || value.indexOf('&') === -1) return value;
        const holder = document.createElement('textarea');
        holder.innerHTML = value; // avkoder &amp; &#176; osv. (innhold i textarea kjøres ikke)
        return holder.value;
    }

    // Én bilde-rad -> elementer, uansett om anlegget bruker json eller xml
    function pictureElements(row, unitId) {
        const json = String(row?.json || '').trim();
        return json ? panelElements(json, unitId) : panelElementsFromXml(String(row?.xml || ''), unitId);
    }

    // Bildets json inneholder ett objekt per plassert element med bl.a.
    // { driver_id, alias_text, unit_id, linked } — verifisert på anlegg 2258.
    function panelElements(jsonText, unitId) {
        let data = null;
        try { data = JSON.parse(jsonText); } catch (error) { return []; }
        const out = [];
        (function walk(value) {
            if (Array.isArray(value)) return value.forEach(walk);
            if (!value || typeof value !== 'object') return;
            const driverId = String(value.driver_id || '').trim();
            const alias = String(value.alias_text || '').trim();
            // Må ha EKSPLISITT samme unit_id. Etiketter og sub-side-knapper ("Komp. 3") mangler
            // unit_id, men har driver_id (der ligger bilde-id-en) — de skal verken markeres eller blinke.
            const elementUnit = String(value.unit_id || '').trim();
            const sameUnit = unitId === null || elementUnit === String(unitId || '').trim();
            const hasPos = ['posLeft', 'posTop', 'posWidth', 'posHeight'].every((k) => value[k] !== undefined);
            const pos = hasPos ? {
                left: Number(value.posLeft), top: Number(value.posTop),
                width: Number(value.posWidth), height: Number(value.posHeight)
            } : null;
            if ((driverId || alias) && sameUnit) out.push({ driverId, alias, unitId: elementUnit, pos });
            Object.values(value).forEach(walk);
        })(data);
        return out;
    }

    // ---- Blink objektene i bildet i 3 sek når man følger en panel-lenke ----
    // Jobben legges i sessionStorage fordi sti-ruting (www.iwmac.local) gir full sidelasting.
    const GFX_FLASH_KEY = 'sm-poc-gfx-flash';
    const GFX_FLASH_MS = 3000;

    function rememberGraphicsFlash(panel, plantId) {
        try {
            const boxes = (panel.elements || []).map((el) => el.pos).filter(Boolean);
            if (!boxes.length) return;
            sessionStorage.setItem(GFX_FLASH_KEY, JSON.stringify({
                plantId: String(plantId), graphicId: String(panel.id), boxes, at: Date.now()
            }));
        } catch (error) { /* privat modus / full storage - blinking er en bonus */ }
    }

    function takeGraphicsFlashJob() {
        let job = null;
        try { job = JSON.parse(sessionStorage.getItem(GFX_FLASH_KEY) || 'null'); } catch (error) { return null; }
        if (!job?.boxes?.length) return null;
        const stale = Date.now() - Number(job.at || 0) > 30000;
        const onPicture = location.href.includes(`/${job.plantId}/overview/graphics/${job.graphicId}`);
        if (stale || onPicture) {
            try { sessionStorage.removeItem(GFX_FLASH_KEY); } catch (error) { /* ignorer */ }
        }
        return !stale && onPicture ? job : null;
    }

    function ensureFlashStyles() {
        if (document.getElementById('sm-poc-gfx-flash-style')) return;
        const style = document.createElement('style');
        style.id = 'sm-poc-gfx-flash-style'; // egen stil: overlever sleepPoc (som fjerner hovedstilen)
        style.textContent = `
            .sm-poc-gfx-flash {
                position: fixed; z-index: 2147483000; pointer-events: none;
                border: 3px solid #ff6f00; border-radius: 4px; box-sizing: border-box;
                box-shadow: 0 0 0 3px rgba(255,111,0,0.35), 0 0 12px rgba(255,111,0,0.6);
                animation: sm-poc-gfx-pulse 0.6s ease-in-out infinite;
            }
            @keyframes sm-poc-gfx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
        `;
        document.head.appendChild(style);
    }

    // Bildet er det store <img>-et i visningen; design-koordinatene er relative til det.
    function findGraphicsImage() {
        return Array.from(document.querySelectorAll('img'))
            .map((el) => ({ el, rect: el.getBoundingClientRect() }))
            .filter((x) => x.el.naturalWidth > 0 && x.rect.width > 200 && x.rect.height > 150)
            .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0] || null;
    }

    function drawGraphicsFlash(boxes) {
        const picture = findGraphicsImage();
        if (!picture) return false;
        ensureFlashStyles();
        const scale = picture.rect.width / picture.el.naturalWidth; // bildet kan være skalert
        boxes.forEach((box) => {
            const marker = document.createElement('div');
            marker.className = 'sm-poc-gfx-flash';
            marker.style.left = `${Math.round(picture.rect.left + box.left * scale) - 4}px`;
            marker.style.top = `${Math.round(picture.rect.top + box.top * scale) - 4}px`;
            marker.style.width = `${Math.max(Math.round(box.width * scale), 10) + 8}px`;
            marker.style.height = `${Math.max(Math.round(box.height * scale), 10) + 8}px`;
            document.body.appendChild(marker);
            setTimeout(() => marker.remove(), GFX_FLASH_MS);
        });
        return true;
    }

    // Bildet tegnes asynkront etter navigering - prøv til det finnes (maks ~6 sek).
    function flashGraphicsObjects(job, attempt = 0) {
        if (drawGraphicsFlash(job.boxes) || attempt > 20) return;
        setTimeout(() => flashGraphicsObjects(job, attempt + 1), 300);
    }

    function runGraphicsFlashIfRequested() {
        const job = takeGraphicsFlashJob();
        if (job) flashGraphicsObjects(job);
    }

    // Bildet lagrer driver_id for hvert linket objekt. Hentes én gang per bilde og gjenbrukes.
    let graphicElementsCache = { key: '', elements: [] };

    async function getGraphicElements(plantId, graphicId) {
        const key = `${plantId}|${graphicId}`;
        if (graphicElementsCache.key === key) return graphicElementsCache.elements;
        const fd = new FormData();
        fd.append('plant_id', plantId);
        fd.append('sql_command', `SELECT * FROM iw_plant_server3.iw_sys_graphic_designer WHERE pictureid = '${sqlQuote(graphicId)}' LIMIT 1`);
        fd.append('_cache_bust', Date.now());
        const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', { method: 'POST', body: fd, cache: 'no-cache' });
        const data = await response.json();
        if (!data?.success) throw new Error(data?.error || 'Bilde-oppslag feilet');
        const row = findRowsWithKey(data, 'json')[0];
        const elements = row ? pictureElements(row, null) : [];
        graphicElementsCache = { key, elements }; // ett bilde om gangen
        return elements;
    }

    function graphicIdFromRoute() {
        const parts = `${location.pathname}${location.hash}`.split('/');
        const at = parts.lastIndexOf('graphics');
        return at > -1 && parts[at + 1] ? parts[at + 1].split('?')[0].trim() : '';
    }

    // Gir objektet i bildet (driver_id + eksakt alias_text) for en floaty-tittel.
    // Tittelen har varierende form ("<anlegg>, <enhet> - <gruppe> - <alias>" men også
    // "... - <alias> - <nummer>"), så vi leter etter bildets egne alias-tekster INNE i
    // tittelen i stedet for å dele den opp. Lengste treff vinner (mest spesifikt).
    async function pictureMatchForTitle(plantId, graphicId, unitId, titleText) {
        if (!plantId || !graphicId || !unitId) return null;
        const elements = await getGraphicElements(plantId, graphicId).catch((error) => {
            console.log('[Supermarket Parameters POC] bilde-oppslag:', error);
            return [];
        });
        const title = String(titleText || '');
        const candidates = elements.filter((el) => el.driverId && el.alias
            && el.unitId === String(unitId).trim() && title.includes(el.alias));
        if (!candidates.length) return null;
        const best = candidates.reduce((winner, el) => (el.alias.length > winner.alias.length ? el : winner), candidates[0]);
        const ties = candidates.filter((el) => el.alias.length === best.alias.length && el.driverId !== best.driverId);
        return ties.length ? null : best; // like gode treff på ulike parametere -> ikke gjett
    }

    function highlightAllParamsUsedInGraphics(menuList) {
        gfxState.menus = new Set((menuList || []).map((item) => String(item || '').trim()).filter(Boolean));
        gfxState.key = gfxKey();
        return applyGfxStateToAllRows();
    }

    async function highlightUsedInGraphicsFromAllParams() {
        const unitId = getUnitId();
        const plantId = getPlantId();
        if (!unitId || !plantId) {
            showHint('Kan ikke finne unit_id eller plant_id.');
            return;
        }
        // Allerede hentet for denne enheten: bare tegn på nytt (markeringen står til ✕ trykkes)
        if (gfxStateIsCurrent() && (gfxState.menus.size || gfxState.loaded)) {
            const count = applyGfxStateToAllRows();
            showHint(`Highlight used_in_graphics: ${count} rad(er) markert. Trykk ✕ i merkelappen for å fjerne.`);
            return;
        }

        const url = `http://toolbox.iwmac.local/oets/supermarket/get_unit_menu.php?enhetsid=${encodeURIComponent(unitId)}&plant_id=${encodeURIComponent(plantId)}`;
        try {
            const response = await fetchWithTimeout(url, { cache: 'no-cache' });
            const data = await response.json();
            if (!data?.success || !Array.isArray(data.menu_list)) {
                throw new Error(data?.error || 'Ukjent API-feil');
            }
            gfxState.panels = [];
            const count = highlightAllParamsUsedInGraphics(data.menu_list);
            showHint(`Highlight used_in_graphics: ${count} rad(er) markert. Henter grafikk-paneler...`);
        } catch (error) {
            console.log('[Supermarket Parameters POC] used_in_graphics error:', error);
            showHint('Kunne ikke hente used_in_graphics: ' + error.message);
            return;
        }
        try {
            const panels = await fetchGraphicsPanelsForUnit(unitId, plantId);
            if (!gfxStateIsCurrent()) return; // enhet byttet underveis
            gfxState.panels = panels;
            gfxState.loaded = true; // -> badgen vises selv uten meny-koder
            // driver_id for native rader, slik at markering/🖼-tagg treffer eksakt der også
            await ensureNativeDriverIds().catch((error) => console.log('[Supermarket Parameters POC] driver-id-cache:', error));
            if (!gfxStateIsCurrent()) return;
            const marked = applyGfxStateToAllRows(); // nå med treff fra selve bildet
            showHint(panels.length
                ? `Enheten er brukt i ${panels.length} grafikk-bilde(r): ${panels.map((p) => p.name).join(', ')} — ${marked} rad(er) markert.`
                : 'Enheten ble ikke funnet i noen grafikk-bilder.');
        } catch (error) {
            console.log('[Supermarket Parameters POC] graphics panels error:', error);
            showHint('Kunne ikke hente grafikk-paneler: ' + error.message);
        }
    }

    function fetchAllParamsDriverDetailsResponse(row) {
        return fetchDriverDetailsResponse(getDataFromRow(row));
    }

    // unitIdArg/plantIdArg brukes fra grafikk-visningen, der enhetsvelgeren ikke finnes
    async function fetchDriverDetailsResponse(request, unitIdArg, plantIdArg) {
        const plantId = plantIdArg || getPlantId();
        const unitId = unitIdArg || getUnitId();
        if (!plantId || !unitId) {
            throw new Error('Kan ikke finne unit_id eller plant_id.');
        }
        // Native rader mangler driver_id i DOM-en — hent den fra gruppe-svaret først,
        // så identifiseres parameteren på driver_id og ikke på alias-tekst.
        if (!request.driver_id) {
            await ensureNativeDriverIds().catch((error) => console.log('[Supermarket Parameters POC] driver-id-cache:', error));
            request.driver_id = nativeDriverIdFor(request.alias_text);
        }

        const fd = new FormData();
        fd.append('plant_id', plantId);
        fd.append('action', 'get_driver_parameter_details');
        fd.append('unit_id', unitId);
        fd.append('alias_text', request.alias_text);
        if (request.driver_id) fd.append('driver_id', request.driver_id);
        if (request.menu) fd.append('menu', request.menu);
        fd.append('_cache_bust', Date.now());

        const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', {
            method: 'POST',
            body: fd,
            cache: 'no-cache'
        });
        const data = await response.json();
        const wrap = (param) => ({
            success: true,
            plant_id: plantId,
            unit_id: unitId,
            alias_text: param?.alias_text || request.alias_text,
            total_parameters_found: 1,
            has_multiple_parameters: false,
            data: param
        });
        // Kjenner vi driver_id-en (unik per parameter), skal SVARET være nettopp den —
        // aldri en annen parameter som tilfeldigvis har samme alias-tekst.
        const exactByDriverId = async () => {
            if (!request.driver_id) return null;
            return fetchDriverParameterDetailsByDriverId(request.driver_id, plantId).catch((error) => {
                console.log('[Supermarket Parameters POC] driver_id-oppslag feilet:', error);
                return null;
            });
        };

        if (!data?.success) {
            const exact = await exactByDriverId();
            if (exact?.driver_id) return wrap(exact);
            const fallback = await fetchDriverParameterDetailsByAliasSql(request, plantId, unitId).catch(() => null);
            if (fallback?.driver_id) return wrap(fallback);
            throw new Error(data?.error || `Fant ikke parameter: ${request.alias_text}`);
        }
        // API-et filtrerer ikke på driver_id — det returnerer alle alias-treff. Plukk vår.
        const rows = Array.isArray(data.data) ? data.data : [data.data].filter(Boolean);
        const single = (param) => ({ ...data, data: param, total_parameters_found: 1, has_multiple_parameters: false });
        if (request.driver_id) {
            const match = rows.find((p) => String(p?.driver_id || '') === request.driver_id);
            if (match) return single(match);
            const exact = await exactByDriverId(); // alias traff feil parameter/ingen — hent eksakt
            if (exact?.driver_id) return wrap(exact);
        }
        // IWMACs native rader har ingen driver_id i DOM-en. API-et søker "ligner på" —
        // "S6 probe" gir også "S6 probe error". Er ett av treffene et EKSAKT alias-treff,
        // er det parameteren brukeren klikket på; da skal ikke velg-dialogen vises.
        if (rows.length > 1) {
            const wanted = String(request.alias_text || '').trim();
            const compact = compactAliasForLookup(wanted);
            const exact = rows.filter((p) => String(p?.alias_text || '').trim() === wanted);
            const best = exact.length ? exact : rows.filter((p) => compactAliasForLookup(p?.alias_text) === compact);
            if (best.length === 1) return single(best[0]); // flere eksakte = ekte tvetydighet -> dialog
        }
        return data;
    }

    // ---- Parameterdetaljer fra grafikk-visningen (floatybox over et linket objekt) ----
    // Tittelen har formen "<anlegg>, <enhet> - <gruppe> - <alias>"
    function parseGraphicsTitle(titleText) {
        const text = String(titleText || '');
        const commaIdx = text.indexOf(',');
        if (commaIdx === -1) return { plantId: '', unitId: '', aliasText: '' };
        const plantId = (text.slice(0, commaIdx).match(/([0-9]{4,5})/) || [])[1] || '';
        const splitOnce = (value) => {
            let at = value.indexOf(' - ');
            let length = 3;
            if (at === -1) { at = value.indexOf('-'); length = 1; }
            return at === -1 ? [value.trim(), ''] : [value.slice(0, at).trim(), value.slice(at + length).trim()];
        };
        const [unitId, remainder] = splitOnce(text.slice(commaIdx + 1).trim());
        const [, afterGroup] = splitOnce(remainder);
        return { plantId, unitId, aliasText: (afterGroup || remainder).trim() };
    }

    function floatyTitleText(floatybox) {
        const span = floatybox.querySelector('span[title]');
        return span ? (span.getAttribute('title') || span.textContent || '') : (floatybox.textContent || '');
    }

    async function openGraphicsParameterDetails(floatybox) {
        const title = floatyTitleText(floatybox);
        const parsed = parseGraphicsTitle(title);
        if (!parsed.unitId || !parsed.aliasText) {
            showHint('Fant ikke enhet/parameter i tittelen.');
            return;
        }
        ensurePocStyles(); // modalen bruker skript-stilen, som kan være ryddet bort utenfor innstillinger
        showHint('Henter driver parameter details...');
        const plantId = parsed.plantId || getPlantId();
        // Objektet i bildet er linket til en driver_id — bruk den, og bildets eksakte alias_text
        const match = await pictureMatchForTitle(plantId, graphicIdFromRoute(), parsed.unitId, title);
        if (!match) console.log('[Supermarket Parameters POC] fant ikke objektet i bildet, bruker alias fra tittelen:', title);
        const aliasText = match?.alias || parsed.aliasText;
        const request = { menu: null, alias_text: aliasText, row_text: aliasText, driver_id: match?.driverId || '' };
        fetchDriverDetailsResponse(request, parsed.unitId, plantId)
            .then(handleAllParamsDriverParameterResponse)
            .catch((error) => {
                console.log('[Supermarket Parameters POC] graphics details error:', error);
                showHint('Kunne ikke hente driverdetaljer: ' + error.message);
            });
    }

    function addDetailsButtonToFloaty(floatybox) {
        if (!floatybox?.classList?.contains('graphics_visible')) return;
        const innerDivs = Array.from(floatybox.children).filter((el) => el.tagName === 'DIV');
        const buttonRow = innerDivs[1] || floatybox; // rad 2 = knappene (graf, tannhjul)
        if (buttonRow.querySelector('.sm-poc-graphics-details')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sm-poc-graphics-details';
        button.textContent = 'ℹ️';
        button.title = 'Parameterdetaljer';
        // inline stil: skript-stilarket kan være fjernet utenfor innstillinger
        button.style.cssText = 'margin-left:4px;padding:0 4px;border:0;background:transparent;cursor:pointer;line-height:1;font-size:15px;';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openGraphicsParameterDetails(floatybox);
        });
        buttonRow.appendChild(button);
    }

    function scanGraphicsFloatyboxes() {
        document.querySelectorAll('.graphics_floatybox.graphics_visible').forEach(addDetailsButtonToFloaty);
    }

    function getDriverDetailsRecord(data) {
        return Array.isArray(data?.data) ? data.data[0] : data?.data || {};
    }

    function hasOverrideValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function optionHtml(value, label, currentValue) {
        return `<option value="${escapeHtml(value)}" ${String(currentValue ?? '') === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }

    function formatOptionHtml(currentValue, emptyLabel = 'Velg...') {
        return [
            optionHtml('', emptyLabel, currentValue),
            ...['%.0f', '%.1f', '%.2f', '%.3f', '%.4f', '%e', '%X', '%s', '%d', '%i', '%u']
                .map((value) => optionHtml(value, value, currentValue))
        ].join('');
    }

    function formInputHtml(name, value, options = {}) {
        const readonly = options.readonly ? ' readonly' : '';
        const type = options.type || 'text';
        return `<input type="${type}" name="${escapeHtml(name)}" value="${escapeHtml(value ?? '')}"${readonly}>`;
    }

    function showAllParamsParameterSelectionModal(data) {
        document.getElementById('sm-poc-driver-selection-modal')?.remove();
        const parameters = Array.isArray(data.data) ? data.data : [data.data];
        const rows = parameters.map((param, index) => `
            <tr>
                <td title="${escapeHtml(param?.alias_text || '')}">${escapeHtml(param?.alias_text || 'N/A')}</td>
                <td title="${escapeHtml(param?.driver_id || '')}">${escapeHtml(param?.driver_id || 'N/A')}</td>
                <td>${escapeHtml(param?.att || '')}</td>
                <td>${escapeHtml(param?.eng_unit || '')}</td>
                <td><button type="button" class="sm-poc-primary-btn" data-param-index="${index}">Open</button></td>
            </tr>
        `).join('');
        const modal = document.createElement('div');
        modal.id = 'sm-poc-driver-selection-modal';
        modal.className = 'sm-poc-batch-modal sm-poc-driver-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box">
                <div class="sm-poc-batch-head">
                    <h2>Select Parameter</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Close</button>
                </div>
                <div class="sm-poc-batch-note">
                    Flere parametere matcher ${escapeHtml(data.alias_text || '')}. Velg riktig driver_id.
                </div>
                <table class="sm-poc-select-table">
                    <thead>
                        <tr><th>Alias Text</th><th>Driver ID</th><th>Att</th><th>Unit</th><th></th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') {
                modal.remove();
                return;
            }
            const button = event.target.closest('[data-param-index]');
            if (!button) return;
            const index = Number(button.dataset.paramIndex);
            const selected = parameters[index];
            modal.remove();
            showAllParamsDriverParameterModal({
                ...data,
                data: selected,
                has_multiple_parameters: false,
                total_parameters_found: 1
            });
        });
        document.body.appendChild(modal);
    }

    function markDriverOverrideFields(modal, param) {
        const fields = ['alias_text', 'plant_pri', 'eng_unit', 'format', 'format_extra', 'range_min', 'range_max', 'scale', 'raw_min', 'raw_max', 'eng_min', 'eng_max', 'att'];
        fields.forEach((field) => {
            if (!hasOverrideValue(param?.[`override_${field}`])) return;
            const el = modal.querySelector(`[name="${field}"]`);
            if (!el) return;
            el.classList.add('sm-poc-override-field');
            el.title = `${el.title ? `${el.title}\n` : ''}Has data in override table`;
        });
    }

    function copyTextToClipboard(text) {
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        };
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).catch(fallback);
        }
        fallback();
        return Promise.resolve();
    }

    function setupDraggablePocModal(modal, contentSelector, headerSelector) {
        const content = modal.querySelector(contentSelector);
        const header = modal.querySelector(headerSelector);
        if (!content || !header) return;
        requestAnimationFrame(() => {
            const rect = content.getBoundingClientRect();
            content.style.position = 'fixed';
            content.style.left = `${rect.left}px`;
            content.style.top = `${rect.top}px`;
            content.style.margin = '0';
        });
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        header.style.cursor = 'move';
        header.addEventListener('mousedown', (event) => {
            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            const rect = content.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            event.preventDefault();
        });
        document.addEventListener('mousemove', (event) => {
            if (!dragging || !content.isConnected) return;
            const width = content.offsetWidth;
            const height = content.offsetHeight;
            const left = Math.max(0, Math.min(window.innerWidth - Math.min(width, window.innerWidth), startLeft + event.clientX - startX));
            const top = Math.max(0, Math.min(window.innerHeight - Math.min(height, window.innerHeight), startTop + event.clientY - startY));
            content.style.left = `${left}px`;
            content.style.top = `${top}px`;
        });
        document.addEventListener('mouseup', () => {
            dragging = false;
        });
    }

    // ---- Skalering: hjelpere for "aktiv skalering" (portet fra Supermarket-Settings) ----
    function unscaleEngToRaw(eng, raw_min, raw_max, eng_min, eng_max) {
        const denom = eng_max - eng_min;
        if (!isFinite(denom) || denom === 0) return NaN;
        return raw_min + (eng - eng_min) * (raw_max - raw_min) / denom;
    }

    function isScalingActive(paramData) {
        if (!paramData) return false;
        const scale = String(paramData.scale || '');
        if (scale !== '1' && scale !== '3') return false;
        const nums = ['raw_min', 'raw_max', 'eng_min', 'eng_max'].map((k) => parseFloat(paramData[k]));
        return nums.every(isFinite) && nums[0] !== nums[1];
    }

    // Verdien IWMAC viser er skalert (EU); regn tilbake til råverdi når skalering er aktiv
    function calculateRealRaw(paramData) {
        const currentValue = parseFloat(paramData?.value);
        if (!isFinite(currentValue)) return { realRaw: null, isScaled: false };
        if (!isScalingActive(paramData)) return { realRaw: currentValue, isScaled: false, currentValue };
        const [raw_min, raw_max, eng_min, eng_max] = ['raw_min', 'raw_max', 'eng_min', 'eng_max'].map((k) => parseFloat(paramData[k]));
        return { realRaw: unscaleEngToRaw(currentValue, raw_min, raw_max, eng_min, eng_max), isScaled: true, currentValue, raw_min, raw_max, eng_min, eng_max };
    }

    function getCustomScaleDefaults(scalingInfo, paramData) {
        if (scalingInfo?.isScaled) {
            return { raw_min: scalingInfo.raw_min, raw_max: scalingInfo.raw_max, eng_min: scalingInfo.eng_min, eng_max: scalingInfo.eng_max, fromActiveScale: true };
        }
        if (isScalingActive(paramData)) {
            return { raw_min: parseFloat(paramData.raw_min), raw_max: parseFloat(paramData.raw_max), eng_min: parseFloat(paramData.eng_min), eng_max: parseFloat(paramData.eng_max), fromActiveScale: true };
        }
        return { raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 100, fromActiveScale: false };
    }

    // Skalerings-presets for parameterdetaljer (portet): forklaring av aktiv skalering (råverdi via
    // unscale-formel), kalkulator "rå X skal bli Y", custom-rad med live resultat, preset-tabell, formel-kolonne.
    function openAllParamsDriverScalePresets(form, param) {
        document.getElementById('sm-poc-driver-presets-modal')?.remove();
        const scalingInfo = calculateRealRaw(param);
        const rawValue = scalingInfo.realRaw !== null ? scalingInfo.realRaw : (Number(param?.value) || 0);
        const rawShown = isFinite(rawValue) ? rawValue : 0;
        const customDefaults = getCustomScaleDefaults(scalingInfo, param);
        const fmt = formatDisplayNumber;
        const applyPreset = (preset) => {
            form.raw_min.value = formatScaleNumber(preset.raw_min);
            form.raw_max.value = formatScaleNumber(preset.raw_max);
            form.eng_min.value = formatScaleNumber(preset.eng_min);
            form.eng_max.value = formatScaleNumber(preset.eng_max);
            form.scale.value = '1';
        };
        const calcStr = (row, raw) => `${fmt(row.eng_min)} + (${fmt(raw)} - ${fmt(row.raw_min)}) × (${fmt(row.eng_max)} - ${fmt(row.eng_min)}) / (${fmt(row.raw_max)} - ${fmt(row.raw_min)})`;

        let explanation = '';
        if (scalingInfo.isScaled) {
            explanation = `
                <div class="sm-poc-dp-explain">
                    <div class="sm-poc-dp-explain-title">⚠️ Skalering er aktiv på denne parameteren</div>
                    <div><strong>Verdi vist i IWMAC:</strong> ${fmt(scalingInfo.currentValue)} (skalert / engineering unit)</div>
                    <div><strong>Beregnet råverdi:</strong> <span style="color:#1976d2;font-weight:600;">${fmt(rawShown)}</span></div>
                    <div class="sm-poc-dp-formula">
                        <div><strong>Gjeldende skalering:</strong> raw_min=${fmt(scalingInfo.raw_min)}, raw_max=${fmt(scalingInfo.raw_max)}, eng_min=${fmt(scalingInfo.eng_min)}, eng_max=${fmt(scalingInfo.eng_max)}</div>
                        <div><strong>Unscale (EU → rå):</strong> raw = raw_min + (eu - eng_min) × (raw_max - raw_min) / (eng_max - eng_min)</div>
                        <div>raw = ${fmt(scalingInfo.raw_min)} + (${fmt(scalingInfo.currentValue)} - ${fmt(scalingInfo.eng_min)}) × (${fmt(scalingInfo.raw_max)} - ${fmt(scalingInfo.raw_min)}) / (${fmt(scalingInfo.eng_max)} - ${fmt(scalingInfo.eng_min)}) = <strong>${fmt(rawShown)}</strong></div>
                    </div>
                    <div style="margin-top:6px;font-style:italic;color:#666;">Tabellen under viser hva <strong>resultatet blir</strong> hvis du bruker presetet på råverdien ${fmt(rawShown)}.</div>
                </div>`;
        } else if (scalingInfo.realRaw !== null) {
            explanation = `<div class="sm-poc-dp-explain sm-poc-dp-explain-ok">✓ Ingen skalering aktiv – verdien som vises (${fmt(rawShown)}) er råverdien.</div>`;
        }

        const modal = document.createElement('div');
        modal.id = 'sm-poc-driver-presets-modal';
        modal.className = 'sm-poc-batch-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box sm-poc-dp-box">
                <div class="sm-poc-batch-head">
                    <h2>Skalerings-presets</h2>
                    <label class="sm-poc-dp-rawlabel">Råverdi (input)
                        <input id="sm-poc-dp-raw" type="number" step="any" value="${rawShown}">
                    </label>
                    <button type="button" id="sm-poc-dp-toggle-calc" class="sm-poc-gray-btn" title="Vis/skjul utregningskolonne">📐 Formel</button>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Lukk</button>
                </div>
                ${explanation}
                <div class="sm-poc-dp-calc">
                    <div class="sm-poc-dp-calc-title">🧮 Kalkulator: "Råverdi X skal bli Y"</div>
                    <div class="sm-poc-dp-calc-row">
                        <span>Når råverdi</span>
                        <input id="sm-poc-dp-calc-raw" type="number" step="any" value="${rawShown}">
                        <span>skal resultatet bli</span>
                        <input id="sm-poc-dp-calc-eng" type="number" step="any" placeholder="ønsket verdi">
                        <span class="sm-poc-dp-muted">(med raw_min=0, eng_min=0)</span>
                        <button type="button" id="sm-poc-dp-calc-apply" class="sm-poc-primary-btn">Beregn & bruk</button>
                    </div>
                    <div id="sm-poc-dp-calc-result" class="sm-poc-dp-muted"></div>
                </div>
                <div class="sm-poc-dp-table-wrap">
                    <table class="sm-poc-scale-table">
                        <thead>
                            <tr style="background:#f5f7f8;">
                                <th style="text-align:left;">Label</th><th>raw_min</th><th>raw_max</th><th>eng_min</th><th>eng_max</th>
                                <th>Resultat</th><th class="sm-poc-dp-calc-col">Utregning</th><th>Bruk</th>
                            </tr>
                        </thead>
                        <tbody id="sm-poc-dp-rows"></tbody>
                    </table>
                </div>
                <div class="sm-poc-dp-custom">
                    <div class="sm-poc-dp-custom-title">Custom</div>
                    <label>raw_min<input id="sm-poc-dp-c-rawmin" type="text" inputmode="decimal" value="${formatScaleNumber(customDefaults.raw_min)}" title="${customDefaults.fromActiveScale ? 'Gjeldende skalering' : ''}"></label>
                    <label>raw_max<input id="sm-poc-dp-c-rawmax" type="text" inputmode="decimal" value="${formatScaleNumber(customDefaults.raw_max)}"></label>
                    <label>eng_min<input id="sm-poc-dp-c-engmin" type="text" inputmode="decimal" value="${formatScaleNumber(customDefaults.eng_min)}"></label>
                    <label>eng_max<input id="sm-poc-dp-c-engmax" type="text" inputmode="decimal" value="${formatScaleNumber(customDefaults.eng_max)}"></label>
                    <div id="sm-poc-dp-c-result" class="sm-poc-dp-custom-result" title="">-</div>
                    <button type="button" id="sm-poc-dp-c-apply" class="sm-poc-orange-btn">Velg</button>
                    <span id="sm-poc-dp-c-calc" class="sm-poc-dp-calc-col"></span>
                </div>
            </div>
        `;
        const q = (sel) => modal.querySelector(sel);
        const box = q('.sm-poc-dp-box');
        const customValues = () => ({
            raw_min: Number(q('#sm-poc-dp-c-rawmin').value) || 0,
            raw_max: Number(q('#sm-poc-dp-c-rawmax').value) || 0,
            eng_min: Number(q('#sm-poc-dp-c-engmin').value) || 0,
            eng_max: Number(q('#sm-poc-dp-c-engmax').value) || 0
        });
        const updateCustomResult = () => {
            const raw = Number(q('#sm-poc-dp-raw').value) || 0;
            const c = customValues();
            const text = calcStr(c, raw);
            q('#sm-poc-dp-c-result').textContent = fmt(engFromRaw(c, raw));
            q('#sm-poc-dp-c-result').title = text;
            q('#sm-poc-dp-c-calc').textContent = text;
        };
        const renderRows = () => {
            const raw = Number(q('#sm-poc-dp-raw').value) || 0;
            q('#sm-poc-dp-rows').innerHTML = getScalePresets().map((preset, idx) => `
                <tr>
                    <td style="text-align:left;" title="${escapeHtml(preset.label)}">${escapeHtml(preset.label)}</td>
                    <td>${fmt(preset.raw_min)}</td><td>${fmt(preset.raw_max)}</td><td>${fmt(preset.eng_min)}</td><td>${fmt(preset.eng_max)}</td>
                    <td style="color:#1976d2;font-weight:600;" title="${escapeHtml(calcStr(preset, raw))}">${fmt(engFromRaw(preset, raw))}</td>
                    <td class="sm-poc-dp-calc-col">${escapeHtml(calcStr(preset, raw))}</td>
                    <td style="text-align:center;"><button type="button" class="sm-poc-green-btn" data-preset="${idx}">Velg</button></td>
                </tr>`).join('');
            updateCustomResult();
        };
        modal.addEventListener('input', (event) => {
            if (event.target.id === 'sm-poc-dp-raw') {
                q('#sm-poc-dp-calc-raw').value = event.target.value;
                renderRows();
            } else if (event.target.id?.startsWith('sm-poc-dp-c-')) {
                updateCustomResult();
            }
        });
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') { modal.remove(); return; }
            if (event.target.closest('#sm-poc-dp-toggle-calc')) { box.classList.toggle('sm-poc-dp-wide'); return; }
            const presetBtn = event.target.closest('[data-preset]');
            if (presetBtn) { applyPreset(getScalePresets()[Number(presetBtn.dataset.preset)]); modal.remove(); return; }
            if (event.target.closest('#sm-poc-dp-c-apply')) { applyPreset(customValues()); modal.remove(); return; }
            if (event.target.closest('#sm-poc-dp-calc-apply')) {
                const rawIn = Number(q('#sm-poc-dp-calc-raw').value);
                const engOut = Number(q('#sm-poc-dp-calc-eng').value);
                const result = q('#sm-poc-dp-calc-result');
                if (!isFinite(rawIn) || rawIn === 0) { result.innerHTML = '<span style="color:#c62828;">⚠️ Råverdi kan ikke være 0 eller tom</span>'; return; }
                if (!isFinite(engOut)) { result.innerHTML = '<span style="color:#c62828;">⚠️ Ønsket verdi må fylles inn</span>'; return; }
                q('#sm-poc-dp-c-rawmin').value = '0';
                q('#sm-poc-dp-c-rawmax').value = String(rawIn);
                q('#sm-poc-dp-c-engmin').value = '0';
                q('#sm-poc-dp-c-engmax').value = String(engOut);
                updateCustomResult();
                result.innerHTML = `<span style="color:#2e7d32;">✓ Skalering beregnet: faktor = ${fmt(engOut / rawIn)}</span><br>raw_min=0, raw_max=${rawIn}, eng_min=0, eng_max=${engOut}<br><em>Klikk «Velg» på Custom-raden for å bruke denne skaleringen.</em>`;
                q('.sm-poc-dp-custom').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        document.body.appendChild(modal);
        renderRows();
    }

    // Strukturert Format Extra-editor (portet): {rev, type, v: { "<nr>": { t: "<tekst>" } }} som
    // tabell med nr/tekst, + Add (auto-nummerert), − per rad. OK skriver JSON tilbake til feltet.
    function openAllParamsFormatExtraEditor(textarea) {
        document.getElementById('sm-poc-format-extra-modal')?.remove();
        let obj = null;
        try { obj = textarea.value ? JSON.parse(textarea.value) : null; } catch (error) { obj = null; }
        if (!obj || typeof obj !== 'object') obj = { rev: '1', type: 'num', v: {} };
        if (!obj.v || typeof obj.v !== 'object') obj.v = {};
        const entries = Object.keys(obj.v).map((k) => ({ key: String(k), text: obj.v[k]?.t != null ? String(obj.v[k].t) : '' }));
        const nextAutoKey = () => {
            const nums = entries.map((e) => parseInt(e.key, 10)).filter((n) => !isNaN(n));
            return String((nums.length ? Math.max(...nums) : -1) + 1); // første blir 0
        };

        const modal = document.createElement('div');
        modal.id = 'sm-poc-format-extra-modal';
        modal.className = 'sm-poc-batch-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box sm-poc-fe-box">
                <div class="sm-poc-batch-head">
                    <h2>Format Extra</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">X</button>
                </div>
                <div class="sm-poc-fe-scroll">
                    <table class="sm-poc-fe-table">
                        <thead><tr><th>No.</th><th>Text</th><th></th></tr></thead>
                        <tbody id="sm-poc-fe-rows"></tbody>
                    </table>
                </div>
                <div class="sm-poc-batch-actions" style="justify-content:space-between;">
                    <button type="button" class="sm-poc-gray-btn" data-fe-add="1">+ Add</button>
                    <span>
                        <button type="button" class="sm-poc-green-btn" data-fe-ok="1">OK</button>
                        <button type="button" class="sm-poc-gray-btn" data-close="1">Cancel</button>
                    </span>
                </div>
            </div>
        `;
        const tbody = modal.querySelector('#sm-poc-fe-rows');
        const render = () => {
            tbody.innerHTML = entries.map((e, idx) => `
                <tr>
                    <td><input data-idx="${idx}" data-field="key" type="text" value="${escapeHtml(e.key)}" style="width:64px;"></td>
                    <td><input data-idx="${idx}" data-field="text" type="text" value="${escapeHtml(e.text)}" style="width:100%;"></td>
                    <td style="text-align:right;"><button type="button" class="sm-poc-red-btn" data-fe-del="${idx}">-</button></td>
                </tr>`).join('');
        };
        modal.addEventListener('input', (event) => {
            const input = event.target.closest('input[data-field]');
            if (!input) return;
            const entry = entries[Number(input.dataset.idx)];
            if (!entry) return;
            if (input.dataset.field === 'key') entry.key = input.value;
            else entry.text = input.value;
        });
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') { modal.remove(); return; }
            const del = event.target.closest('[data-fe-del]');
            if (del) { entries.splice(Number(del.dataset.feDel), 1); render(); return; }
            if (event.target.closest('[data-fe-add]')) { entries.push({ key: nextAutoKey(), text: '' }); render(); return; }
            if (event.target.closest('[data-fe-ok]')) {
                const v = {};
                entries.forEach((e) => { const k = String(e.key).trim(); if (k) v[k] = { t: e.text }; });
                textarea.value = JSON.stringify({ ...obj, rev: obj.rev ?? '1', type: obj.type ?? 'num', v });
                modal.remove();
            }
        });
        document.body.appendChild(modal);
        render();
    }

    function computeDriverFormChanges(form, originalData) {
        const currentData = {};
        new FormData(form).forEach((value, key) => {
            currentData[key] = String(value).trim();
        });
        const fieldNames = ['alias_text', 'plant_pri', 'eng_unit', 'format', 'format_extra', 'range_min', 'range_max', 'scale', 'raw_min', 'raw_max', 'eng_min', 'eng_max', 'att'];
        const changes = {};
        fieldNames.forEach((field) => {
            const oldValue = String(originalData?.[field] ?? '').trim();
            const newValue = String(currentData?.[field] ?? '').trim();
            if (oldValue !== newValue) changes[field] = newValue;
        });
        return changes;
    }

    async function applyDriverFormChangesToOtherUnits(modal, originalData, data) {
        const form = modal.querySelector('#sm-poc-parameter-form');
        const changes = computeDriverFormChanges(form, originalData);
        if (!Object.keys(changes).length) {
            showHint('Ingen endringer å kopiere. Endre et felt først.');
            return;
        }
        const plantId = getPlantId() || data?.plant_id;
        if (!plantId) {
            alert('Kan ikke finne plant_id.');
            return;
        }
        const aliasText = data?.alias_text || originalData?.alias_text || '';
        const menu = data?.menu || originalData?.menu || null;
        if (!aliasText) {
            alert('Mangler alias for oppslag på andre enheter.');
            return;
        }
        const baseRequests = [{
            label: aliasText,
            data: { alias_text: aliasText, menu, row_text: aliasText }
        }];
        const units = await openUnitPickerModal({
            title: 'Bruk endringene på andre enheter',
            confirmLabel: 'Kjør på valgte enheter',
            currentUnitId: getUnitId(),
            changes,
            paramCount: baseRequests.length
        });
        if (!units) return;
        modal.remove();
        await applyChangesAcrossUnits({ title: `Endre ${aliasText} (andre enheter)`, baseRequests, changes, plantId, units });
    }

    async function saveAllParamsDriverParameterChanges(modal, originalData, plantId) {
        const form = modal.querySelector('#sm-poc-parameter-form');
        const changes = computeDriverFormChanges(form, originalData);
        if (!Object.keys(changes).length) {
            showHint('No changes found.');
            return;
        }
        if (!originalData?.driver_id) {
            showHint('Mangler driver_id.');
            return;
        }
        const ok = window.confirm(`Save ${Object.keys(changes).length} change(s) for ${originalData.driver_id}?`);
        if (!ok) return;

        const submit = form.querySelector('button[type="submit"]');
        const oldText = submit?.textContent || 'Save Changes';
        if (submit) {
            submit.disabled = true;
            submit.textContent = 'Saving...';
        }
        try {
            await executeBatchSqlCommands(plantId, buildDriverParameterSql(originalData.driver_id, changes));
            modal.remove();
            showHint('Driver parameter changes saved.');
            if (allParamsActive) {
                allParamsData = null;
                activateAllParamsView(true);
            } else {
                requestNativeParameterRedraw('Driver parameter changes saved. Updating IWMAC list...');
            }
        } catch (error) {
            console.log('[Supermarket Parameters POC] driver details save error:', error);
            alert('Could not save driver parameter changes: ' + error.message);
        } finally {
            if (submit) {
                submit.disabled = false;
                submit.textContent = oldText;
            }
        }
    }

    async function deleteAllParamsDriverOverride(modal, data) {
        const param = getDriverDetailsRecord(data);
        const driverId = param?.driver_id;
        if (!driverId) {
            showHint('Mangler driver_id.');
            return;
        }
        const ok = window.confirm('Delete the override row for this driver_id? This cannot be undone. Remember to stop and start Escape afterwards to regenerate the parameter with correct data from the tag list.');
        if (!ok) return;
        try {
            await executeBatchSqlCommands(data.plant_id, [
                buildDeleteOverrideSql(driverId)
            ]);
            modal.remove();
            showHint('Override deleted.');
            if (allParamsActive) {
                allParamsData = null;
                activateAllParamsView(true);
            }
        } catch (error) {
            console.log('[Supermarket Parameters POC] delete override error:', error);
            alert('Error deleting override: ' + error.message);
        }
    }

    function showAllParamsDriverParameterModal(data) {
        document.getElementById('sm-poc-driver-parameter-modal')?.remove();
        const param = getDriverDetailsRecord(data);
        const meterId = `${data.plant_id || ''};${data.unit_id || ''};${param?.element_id ?? ''}`;
        const modal = document.createElement('div');
        modal.id = 'sm-poc-driver-parameter-modal';
        modal.className = 'sm-poc-batch-modal sm-poc-driver-modal';
        modal.innerHTML = `
            <div id="sm-poc-driver-parameter-modal-content" class="sm-poc-batch-box">
                <div id="sm-poc-driver-parameter-modal-header" class="sm-poc-batch-head">
                    <h2>Parameter Details</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Close</button>
                </div>
                <div class="sm-poc-batch-note">
                    Fields with blue border have data in the override table. Values shown are from iw_gen_driver_parameters.
                </div>
                <div class="sm-poc-meter-line">
                    <strong>Plant ID:</strong> ${escapeHtml(data.plant_id || '')}<br>
                    <strong>Unit ID:</strong> ${escapeHtml(data.unit_id || '')}<br>
                    <strong>Alias Text:</strong> ${escapeHtml(data.alias_text || param?.alias_text || '')}<br>
                    <strong>Meter ID:</strong> <span id="sm-poc-meter-id">${escapeHtml(meterId)}</span>
                    <button type="button" id="sm-poc-copy-mid" class="sm-poc-copy-icon" title="Copy">Copy</button>
                </div>
                <hr style="margin:8px 0;">
                <form id="sm-poc-parameter-form">
                    <div class="sm-poc-driver-form-grid">
                        <label>Driver ID:</label>
                        ${formInputHtml('driver_id', param?.driver_id, { readonly: true })}
                        <label>Alias Text:</label>
                        ${formInputHtml('alias_text', param?.alias_text)}
                        <label>Plant Pri:</label>
                        <select name="plant_pri">
                            ${optionHtml('', 'Select...', param?.plant_pri)}
                            ${optionHtml('A', 'A', param?.plant_pri)}
                            ${optionHtml('B', 'B', param?.plant_pri)}
                            ${optionHtml('C', 'C', param?.plant_pri)}
                            ${optionHtml('N', 'N', param?.plant_pri)}
                        </select>
                        <label>Eng Unit:</label>
                        ${formInputHtml('eng_unit', param?.eng_unit)}
                        <label>Format:</label>
                        <select name="format">
                            ${formatOptionHtml(param?.format)}
                        </select>
                        <label>Range Min:</label>
                        ${formInputHtml('range_min', param?.range_min)}
                        <label>Range Max:</label>
                        ${formInputHtml('range_max', param?.range_max)}
                        <label>Scale:</label>
                        <select name="scale">
                            ${optionHtml('', 'Velg...', param?.scale)}
                            ${optionHtml('1', '1 - Scale only', param?.scale)}
                            ${optionHtml('2', '2 - Format only', param?.scale)}
                            ${optionHtml('3', '3 - Scale, format and clipping', param?.scale)}
                        </select>
                        <label>Raw Min:</label>
                        ${formInputHtml('raw_min', param?.raw_min)}
                        <label>Raw Max:</label>
                        ${formInputHtml('raw_max', param?.raw_max)}
                        <label>Eng Min:</label>
                        ${formInputHtml('eng_min', param?.eng_min)}
                        <label>Eng Max:</label>
                        ${formInputHtml('eng_max', param?.eng_max)}
                        <label>Att:</label>
                        <select name="att">
                            ${optionHtml('r', 'r', param?.att)}
                            ${optionHtml('rw', 'rw', param?.att)}
                            ${optionHtml('vr', 'vr - virtual read only', param?.att)}
                            ${optionHtml('vrw', 'vrw - virtual read/write', param?.att)}
                        </select>
                        <label>Format Extra:</label>
                        <textarea name="format_extra" rows="3">${escapeHtml(param?.format_extra ?? '')}</textarea>
                        <span></span>
                        <button type="button" class="sm-poc-primary-btn" data-format-extra-edit="1" style="justify-self:start;">Edit Format Extra</button>
                    </div>
                    <div class="sm-poc-batch-actions">
                        <button type="submit" class="sm-poc-green-btn">Save Changes</button>
                        <button type="button" class="sm-poc-primary-btn" data-other-units="1">Apply to other units...</button>
                        <button type="button" class="sm-poc-primary-btn" data-presets="1">Scaling Presets...</button>
                        <button type="button" class="sm-poc-red-btn" data-delete-override="1">Delete Override</button>
                        <button type="button" class="sm-poc-gray-btn" data-close="1">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') {
                modal.remove();
                return;
            }
            if (event.target.closest('#sm-poc-copy-mid')) {
                copyTextToClipboard(meterId).then(() => showHint('Meter ID copied.'));
                return;
            }
            if (event.target.closest('[data-presets]')) {
                openAllParamsDriverScalePresets(modal.querySelector('#sm-poc-parameter-form'), param);
                return;
            }
            if (event.target.closest('[data-format-extra-edit]')) {
                openAllParamsFormatExtraEditor(modal.querySelector('[name="format_extra"]'));
                return;
            }
            if (event.target.closest('[data-other-units]')) {
                applyDriverFormChangesToOtherUnits(modal, { ...param }, data);
                return;
            }
            if (event.target.closest('[data-delete-override]')) {
                deleteAllParamsDriverOverride(modal, data);
            }
        });
        modal.querySelector('#sm-poc-parameter-form').addEventListener('submit', (event) => {
            event.preventDefault();
            saveAllParamsDriverParameterChanges(modal, { ...param }, data.plant_id);
        });
        document.body.appendChild(modal);
        markDriverOverrideFields(modal, param);
        setupDraggablePocModal(modal, '#sm-poc-driver-parameter-modal-content', '#sm-poc-driver-parameter-modal-header');
    }

    function handleAllParamsDriverParameterResponse(data) {
        if (data?.has_multiple_parameters && data.total_parameters_found > 1) {
            showAllParamsParameterSelectionModal(data);
            return;
        }
        showAllParamsDriverParameterModal(data);
    }

    function openAllParamsDriverDetails(row) {
        showHint('Henter driver parameter details...');
        fetchAllParamsDriverDetailsResponse(row)
            .then(handleAllParamsDriverParameterResponse)
            .catch((error) => {
                console.log('[Supermarket Parameters POC] driver details error:', error);
                showHint('Kunne ikke hente driverdetaljer: ' + error.message);
            });
    }

    function showAllParamsContextMenu(x, y, row) {
        closeAllParamsContextMenu();
        const markedCount = getMarkedParameterRequests().length;
        const menu = document.createElement('div');
        menu.className = 'sm-poc-all-context';
        menu.appendChild(createAllParamsContextItem('Highlight used_in_graphics', 'highlight'));
        menu.appendChild(createAllParamsContextItem('Get Driver Parameter Details', 'details'));
        if (moveModeEnabled) {
            appendAllParamsSeparator(menu);
            menu.appendChild(createAllParamsContextItem('Change Plant pri for marked', 'plant'));
            menu.appendChild(createAllParamsContextItem('Scale all marked', 'scale'));
            menu.appendChild(createAllParamsContextItem(`Clear marking (${markedCount})`, 'clear'));
        }
        menu.addEventListener('click', (event) => {
            const item = event.target.closest('.sm-poc-all-context-item');
            const action = item?.dataset.action;
            if (!action) return;
            event.preventDefault();
            event.stopPropagation();
            closeAllParamsContextMenu();
            if (action === 'highlight') highlightUsedInGraphicsFromAllParams();
            if (action === 'details') openAllParamsDriverDetails(row);
            if (action === 'plant') openPlantPriBatchModal();
            if (action === 'scale') openScaleMarkedModal();
            if (action === 'clear') clearSelection();
        });
        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
    }

    function getUnitOptionData(select) {
        return Array.from(select?.options || []).map((option, index) => ({
            index,
            value: option.value,
            text: (option.textContent || '').replace(/\s+/g, ' ').trim()
        }));
    }

    function unitOptionsSignature(select) {
        return getUnitOptionData(select).map((option) => `${option.value}:${option.text}`).join('|');
    }

    function selectNativeUnit(value) {
        const select = getUnitSelect();
        if (!select) return false;

        const option = Array.from(select.options || []).find((item) => item.value === value);
        if (!option) return false;

        const oldValue = select.value;
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (valueSetter) {
            valueSetter.call(select, value);
        } else {
            select.value = value;
        }

        if (select.value !== value) {
            select.selectedIndex = option.index;
        }
        if (select.value !== value) return false;

        if (oldValue !== value) {
            select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            lastContentSignature = '';
            if (allParamsActive) {
                // Debounce ved rask blaing (piltaster); buffer gjør re-besøk umiddelbare.
                clearTimeout(allParamsUnitSwitchTimer);
                allParamsUnitSwitchTimer = setTimeout(() => {
                    // Brukeren kan ha lukket visningen før timeren fyrte —
                    // ikke gjenåpne den.
                    if (allParamsActive) activateAllParamsView(false);
                }, 250);
            }
            scheduleReinit();
        }
        return true;
    }

    function navigateNativeUnit(direction) {
        const select = getUnitSelect();
        if (!select) return;
        const options = getUnitOptionData(select);
        if (options.length < 2) return;
        const currentIndex = options.findIndex((o) => o.value === select.value);
        const startIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = Math.max(0, Math.min(options.length - 1, startIndex + direction));
        if (nextIndex === startIndex) return;
        if (selectNativeUnit(options[nextIndex].value)) {
            const combo = document.getElementById(UNIT_PORTAL_ID)?.querySelector(`.${UNIT_COMBO_CLASS}`);
            if (combo) updateUnitComboLabel(combo, select);
        }
    }

    function setUnitComboOpen(combo, open) {
        combo.classList.toggle('sm-poc-unit-opened', !!open);
        if (open) {
            const input = combo.querySelector('.sm-poc-unit-search');
            // Behold forrige søk/filter mellom åpninger. input.select() under markerer
            // teksten, så man kan skrive over for nytt søk eller la den stå.
            renderUnitOptions(combo);
            requestAnimationFrame(() => {
                input?.focus();
                input?.select();
            });
        }
    }

    function updateUnitComboLabel(combo, select) {
        const label = combo.querySelector('.sm-poc-unit-selected-text');
        if (!label) return;
        const selected = select?.selectedOptions?.[0];
        const text = selected ? (selected.textContent || '').replace(/\s+/g, ' ').trim() : 'Select unit';
        label.textContent = text;
        label.title = text;
    }

    function updateUnitSortButton(combo) {
        const sortBtn = combo.querySelector('.sm-poc-unit-sort');
        if (!sortBtn) return;
        const alpha = combo.dataset.sortMode === 'alpha';
        sortBtn.textContent = alpha ? 'Orig' : 'A-Z';
        sortBtn.title = alpha ? 'Show original order' : 'Sort A-Z';
    }

    function renderUnitOptions(combo) {
        const select = getUnitSelect();
        const list = combo.querySelector('.sm-poc-unit-list');
        const input = combo.querySelector('.sm-poc-unit-search');
        if (!select || !list || !input) return;

        const query = input.value;
        const sortMode = combo.dataset.sortMode || 'original';
        let options = getUnitOptionData(select).filter((option) => (
            filterTextMatches(`${option.value} ${option.text}`, query)
        ));

        if (sortMode === 'alpha') {
            options = options.slice().sort((a, b) => a.text.localeCompare(b.text, 'nb', { sensitivity: 'base' }));
        }

        list.textContent = '';
        if (!options.length) {
            const empty = document.createElement('div');
            empty.className = 'sm-poc-unit-empty';
            empty.textContent = 'Ingen treff';
            list.appendChild(empty);
            return;
        }

        const selectedValue = select.value;
        const selectedIndex = options.findIndex((o) => o.value === selectedValue);
        options.forEach((option, idx) => {
            const row = document.createElement('div');
            row.className = 'sm-poc-unit-option';
            row.dataset.value = option.value;
            row.textContent = option.text;
            row.title = option.text;
            row.classList.toggle('sm-poc-unit-selected', option.value === selectedValue);
            row.classList.toggle('sm-poc-unit-active', idx === (selectedIndex >= 0 ? selectedIndex : 0));
            row.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            });
            row.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                selectNativeUnit(option.value);
                updateUnitComboLabel(combo, getUnitSelect());
                setUnitComboOpen(combo, false);
            });
            list.appendChild(row);
        });
    }

    function moveUnitComboActive(combo, direction) {
        const options = Array.from(combo.querySelectorAll('.sm-poc-unit-option'));
        if (!options.length) return;
        const current = options.findIndex((row) => row.classList.contains('sm-poc-unit-active'));
        const next = Math.max(0, Math.min(options.length - 1, (current < 0 ? 0 : current) + direction));
        options.forEach((row, idx) => row.classList.toggle('sm-poc-unit-active', idx === next));
        options[next].scrollIntoView({ block: 'nearest' });
    }

    function positionUnitComboHost() {
        const select = getUnitSelect();
        const combo = document.getElementById(UNIT_PORTAL_ID)?.querySelector(`.${UNIT_COMBO_CLASS}`);
        if (!combo) return;
        if (!isSettingsPage() || !select?.isConnected) {
            combo.remove();
            return;
        }

        const rect = select.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const width = Math.max(Math.round(rect.width), 320);
        combo.style.left = `${Math.round(rect.left)}px`;
        combo.style.top = `${Math.round(rect.top)}px`;
        combo.style.width = `${width}px`;
        positionGfxBadgeHost();
    }

    function ensureSearchableUnitDropdown() {
        const select = getUnitSelect();
        if (!select?.isConnected) return;

        const signature = unitOptionsSignature(select);
        const portal = getUnitPortal();
        let combo = portal.querySelector(`.${UNIT_COMBO_CLASS}`);

        if (!combo) {
            combo = document.createElement('div');
            combo.className = UNIT_COMBO_CLASS;
            combo.dataset.sortMode = 'original';
            combo.innerHTML = `
                <button type="button" class="sm-poc-unit-combo-control" title="Open unit selector">
                    <span class="sm-poc-unit-selected-text"></span>
                    <span class="sm-poc-unit-open" aria-hidden="true">v</span>
                </button>
                <div class="sm-poc-unit-panel">
                    <div class="sm-poc-unit-search-row">
                        <input type="text" class="sm-poc-unit-search" autocomplete="off" spellcheck="false" placeholder="Search unit...">
                        <button type="button" class="sm-poc-unit-clear" title="Clear search">x</button>
                        <button type="button" class="sm-poc-unit-sort" title="Sort A-Z">A-Z</button>
                    </div>
                    <div class="sm-poc-unit-list"></div>
                </div>
            `;
            portal.appendChild(combo);

            const control = combo.querySelector('.sm-poc-unit-combo-control');
            const input = combo.querySelector('.sm-poc-unit-search');
            const clearBtn = combo.querySelector('.sm-poc-unit-clear');
            const sortBtn = combo.querySelector('.sm-poc-unit-sort');

            combo.addEventListener('mousedown', (ev) => ev.stopPropagation());
            combo.addEventListener('click', (ev) => ev.stopPropagation());
            combo.addEventListener('focusout', (ev) => {
                if (!combo.contains(ev.relatedTarget)) {
                    setUnitComboOpen(combo, false);
                }
            });
            combo.addEventListener('keydown', (ev) => {
                if (combo.classList.contains('sm-poc-unit-opened')) return;
                if (ev.shiftKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
                    ev.preventDefault();
                    navigateNativeUnit(ev.key === 'ArrowUp' ? -1 : 1);
                }
            });

            control.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setUnitComboOpen(combo, !combo.classList.contains('sm-poc-unit-opened'));
            });

            input.addEventListener('focus', () => {
                setUnitComboOpen(combo, true);
            });
            input.addEventListener('input', () => {
                combo.classList.add('sm-poc-unit-opened');
                renderUnitOptions(combo);
            });
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'ArrowDown') {
                    ev.preventDefault();
                    if (!combo.classList.contains('sm-poc-unit-opened')) {
                        setUnitComboOpen(combo, true);
                    }
                    moveUnitComboActive(combo, 1);
                    return;
                }
                if (ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    moveUnitComboActive(combo, -1);
                    return;
                }
                if (ev.key === 'Enter') {
                    const active = combo.querySelector('.sm-poc-unit-option.sm-poc-unit-active');
                    if (active?.dataset.value) {
                        ev.preventDefault();
                        selectNativeUnit(active.dataset.value);
                        updateUnitComboLabel(combo, getUnitSelect());
                        setUnitComboOpen(combo, false);
                    }
                    return;
                }
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    setUnitComboOpen(combo, false);
                }
            });

            clearBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                input.value = '';
                setUnitComboOpen(combo, true);
                renderUnitOptions(combo);
                input.focus();
            });

            sortBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                combo.dataset.sortMode = combo.dataset.sortMode === 'alpha' ? 'original' : 'alpha';
                updateUnitSortButton(combo);
                setUnitComboOpen(combo, true);
                renderUnitOptions(combo);
            });
        }

        select.classList.add('sm-poc-unit-native-hidden');
        combo.dataset.optionSignature = signature;
        updateUnitSortButton(combo);
        updateUnitComboLabel(combo, select);
        positionUnitComboHost();
        if (combo.classList.contains('sm-poc-unit-opened')) renderUnitOptions(combo);
    }

    function getSelectedGroupButton() {
        return document.querySelector('div.groups button.group-selected, div.groups .group-selected');
    }

    function markPendingRowsAwaitingNativeRedraw() {
        clearGhostRows();
        document.querySelectorAll('tr.sm-poc-row-pending').forEach((row) => {
            const savedSide = row.dataset.smPocTargetSide || rowTableKey(row);
            if (savedSide) {
                row.dataset.smPocOriginalSide = savedSide;
            }
            row.classList.remove('sm-poc-row-pending', 'sm-poc-row-pending-to-settings', 'sm-poc-row-pending-to-measurements', MOVED_CLASS);
            row.classList.add('sm-poc-row-saved-awaiting-redraw');
            delete row.dataset.smPocPendingKey;
            delete row.dataset.smPocTargetSide;
            delete row.dataset.smPocWouldMoveTo;
            row.title = 'Lagret. Venter på at IWMAC tegner listen på nytt.';
        });
        applyAllFilters();
    }

    function triggerSelectedGroupReload() {
        const group = getSelectedGroupButton();
        if (!group) return false;
        group.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
    }

    function triggerUnitDropdownReload() {
        const unit = document.querySelector('select.iwmac_dropdown');
        if (!unit) return false;
        unit.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        unit.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        return true;
    }

    function requestNativeParameterRedraw(reason) {
        const before = computeContentSignature();
        const triedGroup = triggerSelectedGroupReload();
        showHint(reason || 'Ber IWMAC oppdatere parameterlisten...');

        setRedrawTimeout(() => {
            if (computeContentSignature() !== before) {
                lastContentSignature = '';
                refreshPoc();
                applyAllFilters();
                showHint('IWMAC-listen er oppdatert uten side-refresh.');
                return;
            }

            const triedUnit = triggerUnitDropdownReload();
            if (!triedGroup && !triedUnit) {
                showHint('Lagret, men fant ikke IWMAC-kontroll for myk oppdatering.');
                return;
            }

            setRedrawTimeout(() => {
                lastContentSignature = '';
                refreshPoc();
                applyAllFilters();
                if (computeContentSignature() !== before) {
                    showHint('IWMAC-listen er oppdatert uten side-refresh.');
                } else {
                    showHint('Lagret. IWMAC tegnet ikke listen på nytt automatisk.');
                }
            }, 900);
        }, 700);
    }

    function removePendingVisuals() {
        clearGhostRows();
    }

    function suppressOwnMutationRefresh() {
        suppressObserverUntil = Date.now() + 800;
    }

    function markRowWouldMoveTo(row, targetTbody) {
        suppressOwnMutationRefresh();
        const targetSide = targetTbody === settingsTable ? 'settings' : 'measurements';
        if (targetSide === rowTableKey(row)) {
            delete row.dataset.smPocWouldMoveTo;
        } else {
            row.dataset.smPocWouldMoveTo = targetSide;
        }
    }

    function rowVisualSide(row) {
        return row?.dataset?.smPocTargetSide || rowTableKey(row);
    }

    function rowMatchesFilterMap(row, filterMap) {
        const cells = getRowCells(row);
        return Object.entries(filterMap || {}).every(([colIdx, q]) => {
            if (!q) return true;
            const text = cells[colIdx] && cells[colIdx].textContent || '';
            return filterTextMatches(text, q);
        });
    }

    function setContainerTopPadding(container, height) {
        if (!container) return;
        if (container.dataset.smPocFilterSpacer !== '1') {
            container.dataset.smPocOldPaddingTop = container.style.paddingTop || '';
            container.dataset.smPocFilterSpacer = '1';
        }
        container.style.paddingTop = `${Math.max(Math.ceil(height), 0)}px`;
    }

    function getOverlayHeight(el) {
        return el && el.isConnected && el.style.display !== 'none'
            ? Math.ceil(el.getBoundingClientRect().height)
            : 0;
    }

    function isStableTableRect(rect) {
        return !!rect && rect.width >= MIN_STABLE_TABLE_WIDTH && rect.height > 0;
    }

    function getStableHostRect(container, host) {
        if (!container || !host) return null;
        const rect = container.getBoundingClientRect();
        if (!isStableTableRect(rect)) {
            return null;
        }
        return rect;
    }

    function columnWidthSum(widths) {
        return widths.reduce((sum, width) => sum + width, 0);
    }

    function isUsableColumnWidths(widths, expectedWidth = 0) {
        if (!widths.length) return false;
        const totalWidth = columnWidthSum(widths);
        if (totalWidth < MIN_STABLE_TABLE_WIDTH) return false;
        return !expectedWidth || expectedWidth < 320 || totalWidth >= expectedWidth * 0.5;
    }

    function stableColumnTemplate(widths) {
        return widths.map((width) => `${Math.max(Math.round(width), 40)}px`).join(' ');
    }

    function updateContainerTopPaddingForSide(key) {
        const tbody = getTbodyForKey(key);
        const container = getTableContainerForTbody(tbody);
        if (!container) return;
        if (!isStableTableRect(container.getBoundingClientRect())) return;
        const filterHeight = getOverlayHeight(getFilterRootForKey(key));
        const ghostHeight = getOverlayHeight(getGhostRootForKey(key));
        setContainerTopPadding(container, filterHeight + ghostHeight);
    }

    function getGhostRootForKey(key) {
        return document
            .getElementById(GHOST_PORTAL_ID)
            ?.querySelector(`.sm-poc-ghost-host[data-side="${key}"]`) || null;
    }

    function getColumnWidths(tbody, key) {
        const sample = tbody?.querySelector('tr');
        let widths = sample
            ? Array.from(sample.cells).map((c) => Math.round(c.getBoundingClientRect().width))
            : [];

        if (!isUsableColumnWidths(widths)) {
            widths = getHeaderCellsForSide(key).map((th) => {
                const attrWidth = parseFloat(th.getAttribute('width') || '');
                return Math.round(attrWidth || th.getBoundingClientRect().width || 0);
            });
        }

        if (!isUsableColumnWidths(widths)) {
            const colCount = getColumnCount(tbody);
            widths = Array.from({ length: colCount }, () => 120);
        }

        return widths.map((width) => Math.max(width, 40));
    }

    function getRowsWithGhostSide(key) {
        return [measurementsTable, settingsTable]
            .filter(Boolean)
            .flatMap((tbody) => Array.from(tbody.querySelectorAll('tr')))
            .filter((row) => row.dataset.smPocTargetSide === key && rowTableKey(row) !== key)
            .filter((row) => rowMatchesFilterMap(row, activeFilters[key]));
    }

    function createGhostMovedRow(sourceRow, targetSide) {
        const row = document.createElement('tr');
        row.className = 'sm-poc-ghost-row';
        row.classList.toggle('sm-poc-row-pending', sourceRow.classList.contains('sm-poc-row-pending'));
        row.classList.toggle('sm-poc-row-pending-to-settings', targetSide === 'settings');
        row.classList.toggle('sm-poc-row-pending-to-measurements', targetSide === 'measurements');
        row.classList.toggle(SELECTED_CLASS, selectedRows.has(sourceRow));
        row.draggable = moveModeEnabled;
        row.title = 'Ikke lagret enna. Dra tilbake for a angre.';

        getRowCells(sourceRow).forEach((cell) => {
            const td = document.createElement('td');
            td.className = cell.className;
            td.textContent = (cell.textContent || '').replace(/\s+/g, ' ').trim();
            row.appendChild(td);
        });

        row.addEventListener('click', (e) => {
            if (!moveModeEnabled) return;
            e.preventDefault();
            e.stopPropagation();
            toggleRowSelection(sourceRow, e.ctrlKey || e.metaKey);
            renderPendingVisualRows();
        });

        row.addEventListener('dragstart', (e) => {
            if (!moveModeEnabled) {
                e.preventDefault();
                return;
            }
            draggingRows = selectedRows.has(sourceRow)
                ? Array.from(selectedRows).filter((r) => rowVisualSide(r) === targetSide)
                : [sourceRow];
            if (!draggingRows.length) draggingRows = [sourceRow];
            draggingFromSide = targetSide;
            row.classList.add(DRAGGING_CLASS);
            draggingRows.forEach((r) => r.classList.add(DRAGGING_CLASS));
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', targetSide);
        });

        row.addEventListener('dragend', () => {
            row.classList.remove(DRAGGING_CLASS);
            draggingRows.forEach((r) => r.classList.remove(DRAGGING_CLASS));
            draggingRows = [];
            draggingFromSide = null;
            clearDropIndicator();
            document.querySelectorAll(`.${DROP_TARGET_CLASS}`).forEach((el) => {
                el.classList.remove(DROP_TARGET_CLASS);
            });
        });

        return row;
    }

    function positionGhostHost(host, key) {
        if (!host) return;
        const tbody = getTbodyForKey(key);
        const container = getTableContainerForTbody(tbody);
        const rect = container ? getStableHostRect(container, host) : null;
        if (!rect) {
            host.style.display = 'none';
            return;
        }
        host.style.display = '';
        const filterHeight = getOverlayHeight(getFilterRootForKey(key));
        host.style.left = `${Math.round(rect.left)}px`;
        host.style.top = `${Math.round(rect.top + filterHeight)}px`;
        host.style.width = `${Math.round(rect.width)}px`;
        updateContainerTopPaddingForSide(key);
    }

    function renderPendingVisualRows() {
        if (!isSettingsPage()) {
            clearGhostRows();
            return;
        }
        const rowsBySide = {
            measurements: getRowsWithGhostSide('measurements'),
            settings: getRowsWithGhostSide('settings')
        };
        if (!rowsBySide.measurements.length && !rowsBySide.settings.length) {
            clearGhostRows();
            return;
        }
        const portal = getGhostPortal();
        ['measurements', 'settings'].forEach((key) => {
            const rows = rowsBySide[key];
            let host = getGhostRootForKey(key);
            if (!rows.length) {
                host?.remove();
                updateContainerTopPaddingForSide(key);
                return;
            }

            if (!host) {
                host = document.createElement('div');
                host.className = 'sm-poc-ghost-host';
                host.dataset.side = key;
                portal.appendChild(host);
            }

            host.textContent = '';
            const title = document.createElement('div');
            title.className = 'sm-poc-ghost-title';
            title.textContent = `${rows.length} visuelt flyttet hit, ikke lagret`;
            host.appendChild(title);

            const table = document.createElement('table');
            table.className = 'sm-poc-ghost-table';
            const colgroup = document.createElement('colgroup');
            getColumnWidths(getTbodyForKey(key), key).forEach((width) => {
                const col = document.createElement('col');
                col.style.width = `${width}px`;
                colgroup.appendChild(col);
            });
            table.appendChild(colgroup);

            const tbody = document.createElement('tbody');
            rows.forEach((sourceRow) => tbody.appendChild(createGhostMovedRow(sourceRow, key)));
            table.appendChild(tbody);
            host.appendChild(table);
            positionGhostHost(host, key);
        });
        updateContainerTopPaddingForSide('measurements');
        updateContainerTopPaddingForSide('settings');
    }

    // Radetiketter kan ha prefiks: "[2_1] alias" (menykode) eller "[4x0156] alias" (element_id),
    // men også en GRUPPE-ETIKETT med mellomrom: "[Probe 6] S6 probe". Prefikset må alltid av
    // aliaset — DB-ens alias_text har det ikke — men bare kode-lignende prefiks kan sendes som `menu`.
    function splitRowPrefix(text) {
        const match = String(text || '').match(/^\s*\[([^\]]+)\]\s*(.+)$/);
        if (!match) return { menu: null, alias: String(text || '').trim() };
        const token = match[1].trim();
        return { menu: /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(token) ? token : null, alias: match[2].trim() };
    }

    function getDataFromRow(row) {
        if (row?.dataset?.smPocAllParam === '1') {
            const rawAlias = row.dataset.smPocAliasText || rowKey(row);
            const prefix = splitRowPrefix(rawAlias);
            const menu = prefix.menu || row.dataset.smPocMenu || null;
            const alias_text = prefix.alias;
            return {
                menu,
                alias_text,
                row_text: rowKey(row),
                driver_id: row.dataset.smPocDriverId || '',
                group_name: row.dataset.smPocGroupName || ''
            };
        }

        if (row?.dataset?.smPocDriverId) {
            return {
                menu: row.dataset.smPocMenu || null,
                alias_text: row.dataset.smPocAliasText || rowKey(row),
                row_text: rowKey(row),
                driver_id: row.dataset.smPocDriverId,
                group_name: row.dataset.smPocGroupName || ''
            };
        }
        const text = rowKey(row);
        const prefix = splitRowPrefix(text);
        return { menu: prefix.menu, alias_text: prefix.alias, row_text: text };
    }

    function sideToAtt(side) {
        return side === 'settings' ? 'rw' : 'r';
    }

    function pendingKey(data) {
        if (data.driver_id) return `driver:${data.driver_id}`;
        return `${data.menu || ''}|${data.alias_text || data.row_text || ''}`;
    }

    function registerPendingAttChange(sourceRow, targetSide, targetRow) {
        const originalSide = sourceRow.dataset.smPocOriginalSide || rowTableKey(sourceRow);
        const data = getDataFromRow(sourceRow);
        const key = pendingKey(data);
        const targetAtt = sideToAtt(targetSide);
        const originalAtt = sideToAtt(originalSide);

        targetRow.dataset.smPocOriginalSide = originalSide || targetSide;
        targetRow.dataset.smPocPendingKey = key;
        targetRow.dataset.smPocAliasText = data.alias_text || '';
        targetRow.dataset.smPocMenu = data.menu || '';
        targetRow.dataset.smPocTargetSide = targetSide;

        if (targetAtt === originalAtt) {
            pendingAttChanges.delete(key);
            targetRow.classList.remove('sm-poc-row-pending', 'sm-poc-row-pending-to-settings', 'sm-poc-row-pending-to-measurements', 'sm-poc-row-saved-visual', MOVED_CLASS);
            delete targetRow.dataset.smPocPendingKey;
            delete targetRow.dataset.smPocTargetSide;
            delete targetRow.dataset.smPocWouldMoveTo;
            targetRow.title = '';
        } else {
            pendingAttChanges.set(key, { ...data, targetAtt, originalSide, targetSide });
            targetRow.classList.add('sm-poc-row-pending');
            targetRow.classList.remove('sm-poc-row-saved-visual');
            targetRow.classList.toggle('sm-poc-row-pending-to-settings', targetSide === 'settings');
            targetRow.classList.toggle('sm-poc-row-pending-to-measurements', targetSide === 'measurements');
        }
        updatePendingUi();
        renderPendingVisualRows();
    }

    function markSavedRowsAsBaseline() {
        document.querySelectorAll('tr.sm-poc-row-pending').forEach((row) => {
            const currentSide = rowTableKey(row);
            if (currentSide) {
                row.dataset.smPocOriginalSide = currentSide;
            }
            row.classList.remove('sm-poc-row-pending', 'sm-poc-row-pending-to-settings', 'sm-poc-row-pending-to-measurements', 'sm-poc-row-saved-visual', MOVED_CLASS);
            delete row.dataset.smPocPendingKey;
            delete row.dataset.smPocTargetSide;
            row.title = '';
        });
        renderPendingVisualRows();
    }

    function clearPendingStateOnRow(row) {
        row.classList.remove('sm-poc-row-pending', 'sm-poc-row-pending-to-settings', 'sm-poc-row-pending-to-measurements', 'sm-poc-row-saved-visual', MOVED_CLASS);
        delete row.dataset.smPocPendingKey;
        delete row.dataset.smPocTargetSide;
        delete row.dataset.smPocWouldMoveTo;
        row.title = '';
    }

    function discardPendingAttChanges() {
        const count = pendingAttChanges.size;
        if (!count) return 0;

        pendingAttChanges.clear();
        document
            .querySelectorAll('tr.sm-poc-row-pending, tr[data-sm-poc-pending-key], tr[data-sm-poc-target-side], tr[data-sm-poc-would-move-to]')
            .forEach(clearPendingStateOnRow);
        clearGhostRows();
        updatePendingUi();
        if (allParamsActive) filterAllParamsView();
        else applyAllFilters();
        return count;
    }

    function updateRowVisualMoveState(row, targetSide) {
        if (row.classList.contains('sm-poc-row-pending')) {
            row.classList.toggle(MOVED_CLASS, targetSide === 'settings');
            row.title = targetSide === 'settings'
                ? 'Merket for flytting til Innstillinger (lagre for å skrive rw)'
                : 'Merket for flytting til Måling (lagre for å skrive r)';
            return;
        }

        row.classList.remove(MOVED_CLASS);
        row.title = '';
    }

    function sqlQuote(value) {
        return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "''");
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function chunkArray(items, size) {
        const chunks = [];
        for (let i = 0; i < items.length; i += size) {
            chunks.push(items.slice(i, i + size));
        }
        return chunks;
    }

    function getMarkedRows() {
        return Array.from(selectedRows).filter((row) => row?.isConnected && rowTableKey(row));
    }

    function getMarkedParameterRequests() {
        const seen = new Set();
        return getMarkedRows().map((row) => {
            const data = getDataFromRow(row);
            const key = pendingKey(data);
            return {
                row,
                key,
                label: rowKey(row),
                data
            };
        }).filter((item) => {
            if (!item.key || seen.has(item.key)) return false;
            seen.add(item.key);
            return true;
        });
    }

    async function mapWithConcurrency(items, limit, worker) {
        const results = new Array(items.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (cursor < items.length) {
                const index = cursor++;
                try {
                    results[index] = await worker(items[index], index);
                } catch (error) {
                    results[index] = { ok: false, item: items[index], error };
                }
            }
        });
        await Promise.all(workers);
        return results;
    }

    async function resolveDriverParameterRequests(requests, plantId, unitId, hintLabel = 'parametere') {
        showHint(`Henter driver-ID-er for ${requests.length} ${hintLabel}...`);
        const results = new Array(requests.length);
        const lookupEntries = [];

        requests.forEach((request, index) => {
            if (request.data.driver_id) {
                results[index] = {
                    ok: true,
                    request,
                    param: {
                        driver_id: request.data.driver_id,
                        alias_text: request.data.alias_text,
                        menu: request.data.menu || ''
                    }
                };
                return;
            }
            lookupEntries.push({ request, index });
        });

        const chunks = chunkArray(lookupEntries, BATCH_LOOKUP_REQUEST_LIMIT);
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            showHint(`Henter driver-ID-er ${i + 1}/${chunks.length}...`);
            try {
                const rows = await fetchDriverParameterRowsByAliasSql(
                    chunk.map((entry) => entry.request.data),
                    plantId,
                    unitId
                );
                chunk.forEach((entry) => {
                    const param = findBestDriverParameterMatch(rows, entry.request.data, { fallbackFirst: false });
                    results[entry.index] = param?.driver_id
                        ? { ok: true, request: entry.request, param }
                        : { ok: false, item: entry.request, error: new Error('Mangler driver_id') };
                });
            } catch (error) {
                chunk.forEach((entry) => {
                    results[entry.index] = { ok: false, item: entry.request, error };
                });
            }
        }

        return results;
    }

    async function resolveMarkedDriverParameters() {
        const plantId = getPlantId();
        const unitId = getUnitId();
        if (!plantId || !unitId) {
            throw new Error('Kan ikke finne plant_id eller unit_id.');
        }

        const requests = getMarkedParameterRequests();
        if (!requests.length) {
            throw new Error('Ingen merkede parametere i Endrings-modus.');
        }

        const results = await resolveDriverParameterRequests(requests, plantId, unitId, 'merkede parametere');
        return {
            plantId,
            unitId,
            found: results.filter((result) => result?.ok),
            failed: results.filter((result) => !result?.ok)
        };
    }

    function buildDriverParameterSql(driverId, changes) {
        const safeDriverId = sqlQuote(driverId);
        const fields = Object.entries(changes).map(([field, value]) => {
            return `\`${field}\` = '${sqlQuote(value)}'`;
        });
        const updateMain = `UPDATE iw_plant_server3.iw_gen_driver_parameters SET ${fields.join(', ')} WHERE \`driver_id\` = '${safeDriverId}'`;

        const overrideFields = ['driver_id', 'row_date'];
        const overrideValues = [`'${safeDriverId}'`, 'NOW()'];
        Object.entries(changes).forEach(([field, value]) => {
            overrideFields.push(`\`${field}\``);
            overrideValues.push(`'${sqlQuote(value)}'`);
        });
        const duplicate = Object.keys(changes)
            .map((field) => `\`${field}\` = VALUES(\`${field}\`)`)
            .join(', ');
        const updateOverride = `INSERT INTO iw_plant_server3.iw_gen_driver_parameters_override (${overrideFields.join(', ')}) VALUES (${overrideValues.join(', ')}) ON DUPLICATE KEY UPDATE ${duplicate}`;
        return [updateMain, updateOverride];
    }

    function buildDeleteOverrideSql(driverId) {
        return `DELETE FROM iw_plant_server3.iw_gen_driver_parameters_override WHERE \`driver_id\` = '${sqlQuote(driverId)}'`;
    }

    function normalizeBatchSqlCommand(command) {
        return String(command || '').trim().replace(/;+$/g, '').trim();
    }

    function buildBatchConfirmText(title, resolved, changes) {
        const foundLines = resolved.found.slice(0, 12)
            .map((result) => `OK: ${result.request.label} -> ${result.param.driver_id}`);
        const failedLines = resolved.failed.slice(0, 12)
            .map((result) => `FAIL: ${result.item?.label || 'ukjent'} -> ${result.error?.message || 'ukjent feil'}`);
        const extraFound = resolved.found.length > foundLines.length ? `... ${resolved.found.length - foundLines.length} flere OK` : '';
        const extraFailed = resolved.failed.length > failedLines.length ? `... ${resolved.failed.length - failedLines.length} flere feil` : '';
        const fields = Object.entries(changes).map(([field, value]) => `${field}=${value}`).join(', ');
        const commandCount = resolved.found.length * 2;
        const batchCount = Math.ceil(commandCount / BATCH_SQL_COMMAND_LIMIT);
        const transactionNote = batchCount > 1
            ? `ADVARSEL: Dette krever ${batchCount} API-batcher. Tidligere batcher kan være lagret hvis en senere batch feiler.`
            : 'Dette sendes som én batch_sql-transaksjon.';

        return [
            title,
            '',
            `Felter som skrives: ${fields}`,
            `Funnet: ${resolved.found.length}`,
            `Ikke funnet/feilet: ${resolved.failed.length}`,
            `SQL-kommandoer: ${commandCount} (${batchCount} batch)`,
            transactionNote,
            '',
            ...foundLines,
            extraFound,
            ...failedLines,
            extraFailed,
            '',
            'Fortsette med skriving til database?'
        ].filter(Boolean).join('\n');
    }

    async function executeBatchSqlCommands(plantId, commands) {
        const chunks = chunkArray(commands.map(normalizeBatchSqlCommand), BATCH_SQL_COMMAND_LIMIT);
        const responses = [];
        for (let i = 0; i < chunks.length; i++) {
            showHint(`Skriver batch ${i + 1}/${chunks.length}...`);
            const fd = new FormData();
            fd.append('plant_id', plantId);
            fd.append('action', 'batch_sql');
            fd.append('sql_commands', JSON.stringify(chunks[i]));
            fd.append('_cache_bust', Date.now());

            const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', {
                method: 'POST',
                body: fd,
                cache: 'no-cache'
            });
            const data = await response.json();
            responses.push(data);
            if (!data?.success) {
                const partial = i > 0 ? ` ${i} tidligere batch(er) kan allerede være lagret.` : '';
                throw new Error((data?.error || `Batch ${i + 1} feilet`) + partial);
            }
            if (i < chunks.length - 1) await sleep(120);
        }
        // Skrivinger kan endre parametere i andre enheter også — tøm hele bufferet.
        allParamsCache.clear();
        return responses;
    }

    async function verifyBatchChanges(resolved, changes) {
        showHint('Verifiserer endringer...');
        const driverIds = resolved.found
            .map((entry) => entry.param?.driver_id || entry.request?.data?.driver_id)
            .filter(Boolean);
        let rows = [];
        try {
            rows = await fetchDriverParameterRowsByDriverIds(driverIds, resolved.plantId);
        } catch (error) {
            return {
                ok: [],
                failed: resolved.found.map((entry) => ({
                    ok: false,
                    entry,
                    fresh: null,
                    error,
                    mismatches: [['verify_lookup', error.message]]
                }))
            };
        }

        const freshByDriverId = new Map(rows.map((row) => [String(row.driver_id || ''), row]));
        const verified = resolved.found.map((entry) => {
            const driverId = entry.param?.driver_id || entry.request?.data?.driver_id || '';
            const fresh = freshByDriverId.get(String(driverId));
            if (!fresh) {
                return {
                    ok: false,
                    entry,
                    fresh: null,
                    mismatches: [['driver_id']]
                };
            }
            const mismatches = Object.entries(changes).filter(([field, expected]) => {
                return String(fresh?.[field] ?? '').trim() !== String(expected ?? '').trim();
            });
            return {
                ok: mismatches.length === 0,
                entry,
                fresh,
                mismatches
            };
        });
        return {
            ok: verified.filter((item) => item?.ok),
            failed: verified.filter((item) => !item?.ok)
        };
    }

    function showBatchResultModal(title, resolved, verifyResult, batchResponses) {
        document.getElementById('sm-poc-batch-result-modal')?.remove();
        const totalAffected = batchResponses.reduce((sum, result) => sum + Number(result?.total_affected_rows || 0), 0);
        const failedLookup = resolved.failed.map((result) => {
            return `Lookup failed: ${result.item?.label || 'ukjent'} -> ${result.error?.message || 'ukjent feil'}`;
        });
        const failedVerify = verifyResult.failed.map((result) => {
            const label = result.entry?.request?.label || 'ukjent';
            const fields = result.mismatches?.map(([field]) => field).join(', ') || 'ukjent';
            return `Verify failed: ${label} -> ${fields}`;
        });
        const lines = [
            `Written and verified: ${verifyResult.ok.length}`,
            `Lookup failures: ${resolved.failed.length}`,
            `Verify failures: ${verifyResult.failed.length}`,
            `Affected rows reported: ${totalAffected}`,
            '',
            ...failedLookup,
            ...failedVerify
        ];

        const modal = document.createElement('div');
        modal.id = 'sm-poc-batch-result-modal';
        modal.className = 'sm-poc-batch-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box">
                <div class="sm-poc-batch-head">
                    <h2>${escapeHtml(title)}</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Close</button>
                </div>
                <div class="sm-poc-batch-results">${escapeHtml(lines.join('\n'))}</div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') modal.remove();
        });
        document.body.appendChild(modal);
    }

    function showDeleteOverrideResultModal(title, resolved, batchResponses) {
        document.getElementById('sm-poc-batch-result-modal')?.remove();
        const totalAffected = batchResponses.reduce((sum, result) => sum + Number(result?.total_affected_rows || 0), 0);
        const failedLookup = resolved.failed.map((result) => {
            return `Lookup failed: ${result.item?.label || 'ukjent'} -> ${result.error?.message || 'ukjent feil'}`;
        });
        const lines = [
            `Override delete commands sent: ${resolved.found.length}`,
            `Lookup failures: ${resolved.failed.length}`,
            `Affected rows reported: ${totalAffected}`,
            '',
            ...failedLookup
        ];

        const modal = document.createElement('div');
        modal.id = 'sm-poc-batch-result-modal';
        modal.className = 'sm-poc-batch-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box">
                <div class="sm-poc-batch-head">
                    <h2>${escapeHtml(title)}</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Close</button>
                </div>
                <div class="sm-poc-batch-results">${escapeHtml(lines.join('\n'))}</div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') modal.remove();
        });
        document.body.appendChild(modal);
    }

    async function applyChangesToMarkedParameters(title, changes) {
        if (!Object.keys(changes).length) {
            showHint('Ingen endringer valgt.');
            return;
        }

        try {
            const resolved = await resolveMarkedDriverParameters();
            if (!resolved.found.length) {
                alert('Fant ingen driver_id for de merkede parameterne.');
                return;
            }

            const ok = window.confirm(buildBatchConfirmText(title, resolved, changes));
            if (!ok) return;

            const commands = resolved.found.flatMap((entry) => buildDriverParameterSql(entry.param.driver_id, changes));
            const batchResponses = await executeBatchSqlCommands(resolved.plantId, commands);
            const verifyResult = await verifyBatchChanges(resolved, changes);
            showBatchResultModal(title, resolved, verifyResult, batchResponses);
            showHint(`${verifyResult.ok.length}/${resolved.found.length} verifisert etter batch-endring.`);
            requestNativeParameterRedraw('Endringer lagret. Oppdaterer IWMAC-listen uten side-refresh...');
        } catch (error) {
            console.log('[Supermarket Parameters POC] Batch change error:', error);
            alert('Kunne ikke utføre batch-endring: ' + error.message);
        }
    }

    function getAllUnitOptions() {
        return getUnitOptionData(getUnitSelect()).filter((option) => option.value);
    }

    function openUnitPickerModal({ title = 'Velg enheter', confirmLabel = 'Kjør på valgte enheter', currentUnitId = null, changes = null, paramCount = 0 } = {}) {
        return new Promise((resolve) => {
            const units = getAllUnitOptions();
            closeBatchModal('sm-poc-unit-picker-modal');
            const fieldsText = changes ? Object.entries(changes).map(([field, value]) => `${field} = ${value === '' ? '(blank)' : value}`).join(', ') : '';
            const modal = document.createElement('div');
            modal.id = 'sm-poc-unit-picker-modal';
            modal.className = 'sm-poc-batch-modal';
            modal.innerHTML = `
                <div class="sm-poc-batch-box" style="width:min(640px,96vw);">
                    <div class="sm-poc-batch-head">
                        <h2>${escapeHtml(title)}</h2>
                        <button type="button" class="sm-poc-red-btn" data-cancel="1">Close</button>
                    </div>
                    <div class="sm-poc-batch-note">
                        Velg hvilke enheter endringene skal kjøres på. Parametere matches på alias + meny på hver enhet.
                    </div>
                    ${fieldsText ? `
                    <div class="sm-poc-unit-picker-summary">
                        <div><strong>Felter som skrives:</strong> ${escapeHtml(fieldsText)}</div>
                        <div><strong>Parametere per enhet:</strong> ${paramCount}</div>
                    </div>` : ''}
                    <div class="sm-poc-unit-picker-controls">
                        <input type="text" id="sm-poc-unit-picker-search" placeholder="Søk enhet..." autocomplete="off" spellcheck="false">
                        <label class="sm-poc-unit-picker-mode">Søk i:
                            <select id="sm-poc-unit-picker-mode">
                                <option value="both">Navn + Unit ID</option>
                                <option value="name">Navn</option>
                                <option value="id">Unit ID</option>
                            </select>
                        </label>
                        <button type="button" class="sm-poc-gray-btn" id="sm-poc-unit-picker-all">Velg alle (synlige)</button>
                        <button type="button" class="sm-poc-gray-btn" id="sm-poc-unit-picker-none">Fjern alle</button>
                        <span id="sm-poc-unit-picker-count" class="sm-poc-col-filter-meta"></span>
                    </div>
                    <div id="sm-poc-unit-picker-list" class="sm-poc-unit-picker-list"></div>
                    <div class="sm-poc-batch-actions">
                        <button type="button" class="sm-poc-gray-btn" data-cancel="1">Cancel</button>
                        <button type="button" class="sm-poc-green-btn" id="sm-poc-unit-picker-confirm">${escapeHtml(confirmLabel)}</button>
                    </div>
                </div>
            `;

            const selected = new Set();
            const listEl = modal.querySelector('#sm-poc-unit-picker-list');
            const searchEl = modal.querySelector('#sm-poc-unit-picker-search');
            const modeEl = modal.querySelector('#sm-poc-unit-picker-mode');
            const countEl = modal.querySelector('#sm-poc-unit-picker-count');

            const visibleUnits = () => {
                const query = searchEl.value;
                const mode = modeEl.value;
                return units.filter((unit) => {
                    if (!query) return true;
                    const haystack = mode === 'name' ? unit.text : mode === 'id' ? unit.value : `${unit.text} ${unit.value}`;
                    return filterTextMatches(haystack, query);
                });
            };
            const confirmBtn = modal.querySelector('#sm-poc-unit-picker-confirm');
            const updateCount = () => {
                countEl.textContent = `${selected.size} valgt`;
                confirmBtn.textContent = selected.size ? `${confirmLabel} (${selected.size})` : confirmLabel;
                confirmBtn.disabled = selected.size === 0;
            };
            const render = () => {
                listEl.textContent = '';
                const list = visibleUnits();
                if (!list.length) {
                    const empty = document.createElement('div');
                    empty.className = 'sm-poc-unit-empty';
                    empty.style.padding = '10px';
                    empty.textContent = 'Ingen treff';
                    listEl.appendChild(empty);
                    updateCount();
                    return;
                }
                list.forEach((unit) => {
                    const isCurrent = currentUnitId && unit.value === currentUnitId;
                    const row = document.createElement('label');
                    row.className = 'sm-poc-unit-picker-row';
                    row.innerHTML = `
                        <input type="checkbox" ${selected.has(unit.value) ? 'checked' : ''}>
                        <span class="sm-poc-unit-picker-name">${escapeHtml(unit.text)}${isCurrent ? ' (gjeldende)' : ''}</span>
                        <span class="sm-poc-unit-picker-id">${escapeHtml(unit.value)}</span>
                    `;
                    const cb = row.querySelector('input');
                    cb.addEventListener('change', () => {
                        if (cb.checked) selected.add(unit.value); else selected.delete(unit.value);
                        updateCount();
                    });
                    listEl.appendChild(row);
                });
                updateCount();
            };

            const close = (result) => { modal.remove(); resolve(result); };

            modal.addEventListener('click', (event) => {
                if (event.target === modal || event.target.dataset.cancel === '1') close(null);
            });
            searchEl.addEventListener('input', render);
            modeEl.addEventListener('change', render);
            modal.querySelector('#sm-poc-unit-picker-all').addEventListener('click', () => {
                visibleUnits().forEach((unit) => selected.add(unit.value));
                render();
            });
            modal.querySelector('#sm-poc-unit-picker-none').addEventListener('click', () => {
                selected.clear();
                render();
            });
            modal.querySelector('#sm-poc-unit-picker-confirm').addEventListener('click', () => {
                const chosen = units.filter((unit) => selected.has(unit.value));
                if (!chosen.length) {
                    showHint('Velg minst én enhet.');
                    return;
                }
                close(chosen);
            });

            document.body.appendChild(modal);
            render();
            requestAnimationFrame(() => searchEl.focus());
        });
    }

    function cloneRequestForOtherUnit(request) {
        const data = { ...request.data };
        // Tving alias/meny-oppslag på mål-enheten i stedet for gjeldende driver_id.
        delete data.driver_id;
        delete data.unit_id;
        return { ...request, row: null, data };
    }

    function showCrossUnitResultModal(title, perUnit, changes) {
        closeBatchModal('sm-poc-xunit-result-modal');
        const okUnits = perUnit.filter((entry) => entry.written > 0 && !entry.error);
        const totalWritten = perUnit.reduce((sum, entry) => sum + entry.written, 0);
        const fieldsText = Object.entries(changes).map(([field, value]) => `${field} = ${value === '' ? '(blank)' : value}`).join(', ');

        const rowsHtml = perUnit.map((entry) => {
            let cls = 'sm-poc-xunit-row-ok';
            let statusCls = 'sm-poc-xunit-status-ok';
            let status = 'OK';
            if (entry.error) {
                cls = 'sm-poc-xunit-row-fail'; statusCls = 'sm-poc-xunit-status-fail'; status = `Feil: ${entry.error}`;
            } else if (entry.failed) {
                cls = 'sm-poc-xunit-row-warn'; statusCls = 'sm-poc-xunit-status-warn'; status = `${entry.failed} ikke funnet`;
            }
            return `
                <tr class="${cls}">
                    <td>${escapeHtml(entry.unit.text)}</td>
                    <td class="sm-poc-unit-picker-id">${escapeHtml(entry.unit.value)}</td>
                    <td class="sm-poc-xunit-num">${entry.written}</td>
                    <td class="sm-poc-xunit-num">${entry.failed || 0}</td>
                    <td class="${statusCls}">${escapeHtml(status)}</td>
                </tr>`;
        }).join('');

        const modal = document.createElement('div');
        modal.id = 'sm-poc-xunit-result-modal';
        modal.className = 'sm-poc-batch-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box" style="width:min(720px,96vw);">
                <div class="sm-poc-batch-head">
                    <h2>${escapeHtml(title)} – resultat</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Close</button>
                </div>
                <div class="sm-poc-unit-picker-summary">
                    <div><strong>Felter skrevet:</strong> ${escapeHtml(fieldsText)}</div>
                    <div><strong>Enheter med endringer:</strong> ${okUnits.length}/${perUnit.length}</div>
                    <div><strong>Parametere skrevet totalt:</strong> ${totalWritten}</div>
                </div>
                <div style="max-height:420px;overflow:auto;border:1px solid #cfd8dc;border-radius:4px;margin-top:8px;">
                    <table class="sm-poc-xunit-result-table">
                        <thead>
                            <tr style="background:#f5f7f8;">
                                <th>Enhet</th><th>Unit ID</th><th>Skrevet</th><th>Ikke funnet</th><th>Status</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
                <div class="sm-poc-batch-actions">
                    <button type="button" class="sm-poc-green-btn" data-close="1">Lukk</button>
                </div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') modal.remove();
        });
        document.body.appendChild(modal);
    }

    async function applyChangesAcrossUnits({ title, baseRequests, changes, plantId, units }) {
        if (!Object.keys(changes).length) {
            showHint('Ingen endringer valgt.');
            return;
        }
        if (!baseRequests.length) {
            showHint('Ingen parametere å kopiere.');
            return;
        }

        const perUnit = [];
        for (let i = 0; i < units.length; i++) {
            const unit = units[i];
            showHint(`Behandler enhet ${i + 1}/${units.length}: ${unit.text}...`);
            try {
                const requests = baseRequests.map(cloneRequestForOtherUnit);
                const resolved = await resolveDriverParameterRequests(requests, plantId, unit.value, `parametere på ${unit.text}`);
                const found = resolved.filter((result) => result?.ok);
                const failed = resolved.filter((result) => !result?.ok);
                if (!found.length) {
                    perUnit.push({ unit, written: 0, failed: failed.length, error: 'Fant ingen parametere' });
                    continue;
                }
                const commands = found.flatMap((entry) => buildDriverParameterSql(entry.param.driver_id, changes));
                await executeBatchSqlCommands(plantId, commands);
                perUnit.push({ unit, written: found.length, failed: failed.length, error: null });
            } catch (error) {
                perUnit.push({ unit, written: 0, failed: 0, error: error.message });
            }
        }

        const okUnits = perUnit.filter((entry) => entry.written > 0 && !entry.error);
        const totalWritten = perUnit.reduce((sum, entry) => sum + entry.written, 0);
        showCrossUnitResultModal(title, perUnit, changes);
        showHint(`Kopiering ferdig: ${okUnits.length}/${units.length} enheter, ${totalWritten} parametere.`);
        requestNativeParameterRedraw('Endringer kopiert til andre enheter. Oppdaterer IWMAC-listen...');
    }

    async function applyMarkedChangesToOtherUnits(title, changes) {
        if (!Object.keys(changes).length) {
            showHint('Ingen endringer valgt.');
            return;
        }
        const plantId = getPlantId();
        if (!plantId) {
            alert('Kan ikke finne plant_id.');
            return;
        }
        const baseRequests = getMarkedParameterRequests();
        if (!baseRequests.length) {
            showHint('Marker parametere i Endrings-modus først.');
            return;
        }
        const units = await openUnitPickerModal({
            title: `${title} – velg enheter`,
            confirmLabel: 'Kjør på valgte enheter',
            currentUnitId: getUnitId(),
            changes,
            paramCount: baseRequests.length
        });
        if (!units) return;
        await applyChangesAcrossUnits({ title: `${title} (andre enheter)`, baseRequests, changes, plantId, units });
    }

    async function deleteOverridesForMarkedParameters() {
        try {
            const resolved = await resolveMarkedDriverParameters();
            if (!resolved.found.length) {
                alert('Fant ingen driver_id for de merkede parameterne.');
                return;
            }

            const ok = window.confirm([
                `Delete override row for ${resolved.found.length} marked parameter(s)?`,
                '',
                'This deletes the whole iw_gen_driver_parameters_override row for each driver_id, same as the Delete override button in driver details.',
                'This cannot be undone. Stop/start Escape afterwards if the parameters must regenerate from the tag list.',
                resolved.failed.length ? `Lookup failures: ${resolved.failed.length}` : '',
                '',
                'Continue?'
            ].filter(Boolean).join('\n'));
            if (!ok) return;

            const commands = resolved.found.map((entry) => buildDeleteOverrideSql(entry.param.driver_id));
            const batchResponses = await executeBatchSqlCommands(resolved.plantId, commands);
            showDeleteOverrideResultModal('Delete overrides for marked', resolved, batchResponses);
            showHint(`Slettet override for ${resolved.found.length} merket parameter(e).`);
            requestNativeParameterRedraw('Overrides slettet. Oppdaterer IWMAC-listen uten side-refresh...');
        } catch (error) {
            console.log('[Supermarket Parameters POC] delete marked overrides error:', error);
            alert('Kunne ikke slette overrides: ' + error.message);
        }
    }

    function closeBatchModal(id) {
        document.getElementById(id)?.remove();
    }

    function openPlantPriBatchModal() {
        if (!moveModeEnabled) return;
        const marked = getMarkedParameterRequests();
        if (!marked.length) {
            showHint('Marker parametere i Endrings-modus først.');
            return;
        }

        closeBatchModal('sm-poc-plant-pri-modal');
        const modal = document.createElement('div');
        modal.id = 'sm-poc-plant-pri-modal';
        modal.className = 'sm-poc-batch-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box">
                <div class="sm-poc-batch-head">
                    <h2>Change Plant Pri for marked</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Close</button>
                </div>
                <div class="sm-poc-batch-note">
                    This writes plant_pri to ${marked.length} marked parameter(s), using the same main and override tables as settings.
                </div>
                <form id="sm-poc-plant-pri-form">
                    <div class="sm-poc-batch-grid">
                        <label for="sm-poc-plant-pri-value">Plant Pri</label>
                        <select id="sm-poc-plant-pri-value">
                            <option value="">Blank - not alarm</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                            <option value="N">N</option>
                        </select>
                    </div>
                    <div class="sm-poc-batch-actions">
                        <button type="button" class="sm-poc-gray-btn" data-close="1">Cancel</button>
                        <button type="button" class="sm-poc-primary-btn" id="sm-poc-plant-pri-other-units">Apply to other units...</button>
                        <button type="submit" class="sm-poc-primary-btn">Apply to marked</button>
                    </div>
                </form>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') modal.remove();
        });
        modal.querySelector('#sm-poc-plant-pri-other-units').addEventListener('click', () => {
            const value = modal.querySelector('#sm-poc-plant-pri-value').value;
            modal.remove();
            applyMarkedChangesToOtherUnits('Change Plant Pri', { plant_pri: value });
        });
        modal.querySelector('#sm-poc-plant-pri-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const value = modal.querySelector('#sm-poc-plant-pri-value').value;
            modal.remove();
            applyChangesToMarkedParameters('Change Plant Pri for marked', { plant_pri: value });
        });
        document.body.appendChild(modal);
    }

    function engFromRaw(row, rawInput) {
        const denom = row.raw_max - row.raw_min;
        if (!isFinite(denom) || denom === 0) return NaN;
        return row.eng_min + (row.eng_max - row.eng_min) * ((rawInput - row.raw_min) / denom);
    }

    function formatScaleNumber(value) {
        const number = Number(value);
        if (!isFinite(number)) return '0';
        return String(number);
    }

    function formatDisplayNumber(value) {
        const number = Number(value);
        return isFinite(number) ? number.toLocaleString('no-NO', { maximumFractionDigits: 6 }) : '-';
    }

    function getScalePresets() {
        return [
            { label: 'Invert', raw_min: 0, raw_max: 1, eng_min: 1, eng_max: 0 },
            { label: 'MV-alarm', raw_min: 1, raw_max: 2, eng_min: 0, eng_max: 1 },
            { label: 'x000.1', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 1 },
            { label: 'x00.1', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 10 },
            { label: 'x0.1', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 100 },
            { label: 'x1', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 1000 },
            { label: 'x10', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 10000 },
            { label: 'x100', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 100000 },
            { label: 'x1000', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 1000000 },
            { label: 'Kelvin to Celsius', raw_min: 0, raw_max: 1000, eng_min: -273.15, eng_max: 726.85 },
            { label: 'Unit for energy flow rate', raw_min: 0, raw_max: 100, eng_min: 0, eng_max: 27778 },
            { label: 'L/h -> m3/h', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 1 },
            { label: 'L/h -> L/s', raw_min: 0, raw_max: 3600, eng_min: 0, eng_max: 1 },
            { label: 'L/s -> L/h', raw_min: 0, raw_max: 1, eng_min: 0, eng_max: 3600 },
            { label: 'L/s -> m3/h', raw_min: 0, raw_max: 1, eng_min: 0, eng_max: 3.6 },
            { label: '/5', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 200 },
            { label: 'CT-ratio: 1200/5A', raw_min: 0, raw_max: 5, eng_min: 0, eng_max: 1200 },
            { label: 'CT-ratio: 1600/5A', raw_min: 0, raw_max: 5, eng_min: 0, eng_max: 1600 },
            { label: 'CT-ratio: 2000/5A', raw_min: 0, raw_max: 5, eng_min: 0, eng_max: 2000 },
            { label: 'CT-ratio: 1200/1A', raw_min: 0, raw_max: 1, eng_min: 0, eng_max: 1200 },
            { label: 'CT-ratio: 1600/1A', raw_min: 0, raw_max: 1, eng_min: 0, eng_max: 1600 },
            { label: 'CT-ratio: 2000/1A', raw_min: 0, raw_max: 1, eng_min: 0, eng_max: 2000 },
            { label: 'Raw value * 400 / 1000', raw_min: 0, raw_max: 1000, eng_min: 0, eng_max: 400 }
        ];
    }

    function openScaleMarkedModal() {
        if (!moveModeEnabled) return;
        const marked = getMarkedParameterRequests();
        if (!marked.length) {
            showHint('Marker parametere i Endrings-modus først.');
            return;
        }

        closeBatchModal('sm-poc-scale-marked-modal');
        const modal = document.createElement('div');
        modal.id = 'sm-poc-scale-marked-modal';
        modal.className = 'sm-poc-batch-modal sm-poc-scale-modal';
        modal.innerHTML = `
            <div class="sm-poc-batch-box">
                <div class="sm-poc-batch-head">
                    <h2>Scale all marked</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Close</button>
                </div>
                <div class="sm-poc-batch-note">
                    Blank fields are left unchanged. Scale, raw_min, raw_max, eng_min and eng_max are written only when filled in. Format is written only when selected.
                </div>
                <form id="sm-poc-scale-marked-form">
                    <div class="sm-poc-batch-grid">
                        <label for="sm-poc-scale-mode">Scale</label>
                        <select id="sm-poc-scale-mode">
                            <option value="">Do not change</option>
                            <option value="1">1 - Scale only</option>
                            <option value="2">2 - Format only</option>
                            <option value="3">3 - Scale, format and clipping</option>
                        </select>
                        <label for="sm-poc-scale-format">Format</label>
                        <select id="sm-poc-scale-format">
                            ${formatOptionHtml('', 'Do not change')}
                        </select>
                        <label for="sm-poc-scale-raw-min">raw_min</label>
                        <input id="sm-poc-scale-raw-min" type="text" inputmode="decimal" placeholder="Do not change">
                        <label for="sm-poc-scale-raw-max">raw_max</label>
                        <input id="sm-poc-scale-raw-max" type="text" inputmode="decimal" placeholder="Do not change">
                        <label for="sm-poc-scale-eng-min">eng_min</label>
                        <input id="sm-poc-scale-eng-min" type="text" inputmode="decimal" placeholder="Do not change">
                        <label for="sm-poc-scale-eng-max">eng_max</label>
                        <input id="sm-poc-scale-eng-max" type="text" inputmode="decimal" placeholder="Do not change">
                    </div>
                    <div style="margin-top:12px;padding:10px;background:#e3f2fd;border-radius:4px;">
                        <div style="font-weight:600;margin-bottom:8px;">Calculator: raw value X should become Y</div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            <span>Raw</span>
                            <input id="sm-poc-calc-raw" type="number" step="any" value="1000" style="width:100px;">
                            <span>should become</span>
                            <input id="sm-poc-calc-eng" type="number" step="any" placeholder="value" style="width:120px;">
                            <button type="button" id="sm-poc-calc-apply" class="sm-poc-primary-btn">Calculate and use</button>
                            <span id="sm-poc-calc-result" style="color:#546e7a;"></span>
                        </div>
                    </div>
                    <div class="sm-poc-scale-custom">
                        <label>Custom raw_min<input id="sm-poc-custom-raw-min" type="text" value="0"></label>
                        <label>Custom raw_max<input id="sm-poc-custom-raw-max" type="text" value="1000"></label>
                        <label>Custom eng_min<input id="sm-poc-custom-eng-min" type="text" value="0"></label>
                        <label>Custom eng_max<input id="sm-poc-custom-eng-max" type="text" value="100"></label>
                        <button type="button" id="sm-poc-custom-apply" class="sm-poc-orange-btn">Use custom</button>
                    </div>
                    <div style="margin-top:12px;">
                        <label style="font-weight:600;">Raw input for preset result preview</label>
                        <input id="sm-poc-preset-raw" type="number" step="any" value="1000" style="width:120px;margin-left:8px;">
                    </div>
                    <div style="margin-top:8px;max-height:300px;overflow:auto;border:1px solid #cfd8dc;border-radius:4px;">
                        <table class="sm-poc-scale-table">
                            <thead>
                                <tr style="background:#f5f7f8;">
                                    <th style="text-align:left;">Preset</th>
                                    <th>raw_min</th>
                                    <th>raw_max</th>
                                    <th>eng_min</th>
                                    <th>eng_max</th>
                                    <th>Result</th>
                                    <th>Use</th>
                                </tr>
                            </thead>
                            <tbody id="sm-poc-scale-preset-rows"></tbody>
                        </table>
                    </div>
                    <div class="sm-poc-batch-actions">
                        <button type="button" id="sm-poc-delete-scale-overrides" class="sm-poc-red-btn">Delete overrides for marked</button>
                        <button type="button" class="sm-poc-gray-btn" data-close="1">Cancel</button>
                        <button type="button" id="sm-poc-scale-other-units" class="sm-poc-green-btn">Apply to other units...</button>
                        <button type="submit" class="sm-poc-green-btn">Apply scaling to marked</button>
                    </div>
                </form>
            </div>
        `;

        const valuesFromForm = () => ({
            scale: modal.querySelector('#sm-poc-scale-mode').value,
            format: modal.querySelector('#sm-poc-scale-format').value,
            raw_min: modal.querySelector('#sm-poc-scale-raw-min').value.trim(),
            raw_max: modal.querySelector('#sm-poc-scale-raw-max').value.trim(),
            eng_min: modal.querySelector('#sm-poc-scale-eng-min').value.trim(),
            eng_max: modal.querySelector('#sm-poc-scale-eng-max').value.trim()
        });
        const setScaleValues = (preset) => {
            modal.querySelector('#sm-poc-scale-mode').value = '1';
            modal.querySelector('#sm-poc-scale-raw-min').value = formatScaleNumber(preset.raw_min);
            modal.querySelector('#sm-poc-scale-raw-max').value = formatScaleNumber(preset.raw_max);
            modal.querySelector('#sm-poc-scale-eng-min').value = formatScaleNumber(preset.eng_min);
            modal.querySelector('#sm-poc-scale-eng-max').value = formatScaleNumber(preset.eng_max);
            modal.querySelector('#sm-poc-custom-raw-min').value = formatScaleNumber(preset.raw_min);
            modal.querySelector('#sm-poc-custom-raw-max').value = formatScaleNumber(preset.raw_max);
            modal.querySelector('#sm-poc-custom-eng-min').value = formatScaleNumber(preset.eng_min);
            modal.querySelector('#sm-poc-custom-eng-max').value = formatScaleNumber(preset.eng_max);
        };
        const customValues = () => ({
            raw_min: Number(modal.querySelector('#sm-poc-custom-raw-min').value) || 0,
            raw_max: Number(modal.querySelector('#sm-poc-custom-raw-max').value) || 0,
            eng_min: Number(modal.querySelector('#sm-poc-custom-eng-min').value) || 0,
            eng_max: Number(modal.querySelector('#sm-poc-custom-eng-max').value) || 0
        });
        const renderPresetRows = () => {
            const rawInput = Number(modal.querySelector('#sm-poc-preset-raw').value) || 0;
            const tbody = modal.querySelector('#sm-poc-scale-preset-rows');
            tbody.textContent = '';
            getScalePresets().forEach((preset, idx) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="text-align:left;" title="${escapeHtml(preset.label)}">${escapeHtml(preset.label)}</td>
                    <td style="text-align:right;">${formatDisplayNumber(preset.raw_min)}</td>
                    <td style="text-align:right;">${formatDisplayNumber(preset.raw_max)}</td>
                    <td style="text-align:right;">${formatDisplayNumber(preset.eng_min)}</td>
                    <td style="text-align:right;">${formatDisplayNumber(preset.eng_max)}</td>
                    <td style="text-align:right;color:#1976d2;font-weight:600;">${formatDisplayNumber(engFromRaw(preset, rawInput))}</td>
                    <td style="text-align:center;"><button type="button" class="sm-poc-green-btn" data-preset="${idx}">Use</button></td>
                `;
                tbody.appendChild(row);
            });
            tbody.querySelectorAll('[data-preset]').forEach((button) => {
                button.addEventListener('click', () => {
                    setScaleValues(getScalePresets()[Number(button.dataset.preset)]);
                });
            });
        };

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') modal.remove();
        });
        modal.querySelector('#sm-poc-preset-raw').addEventListener('input', renderPresetRows);
        modal.querySelector('#sm-poc-custom-apply').addEventListener('click', () => setScaleValues(customValues()));
        modal.querySelector('#sm-poc-delete-scale-overrides').addEventListener('click', () => {
            modal.remove();
            deleteOverridesForMarkedParameters();
        });
        modal.querySelector('#sm-poc-calc-apply').addEventListener('click', () => {
            const raw = Number(modal.querySelector('#sm-poc-calc-raw').value);
            const eng = Number(modal.querySelector('#sm-poc-calc-eng').value);
            const result = modal.querySelector('#sm-poc-calc-result');
            if (!isFinite(raw) || raw === 0 || !isFinite(eng)) {
                result.textContent = 'Fill raw and desired value. Raw cannot be 0.';
                result.style.color = '#c62828';
                return;
            }
            const preset = { raw_min: 0, raw_max: raw, eng_min: 0, eng_max: eng };
            setScaleValues(preset);
            result.textContent = `Using raw_min=0, raw_max=${raw}, eng_min=0, eng_max=${eng}`;
            result.style.color = '#2e7d32';
        });
        const validatedScaleValues = () => {
            const values = valuesFromForm();
            const numericFields = ['raw_min', 'raw_max', 'eng_min', 'eng_max'];
            const invalid = numericFields.find((field) => {
                const v = values[field];
                return v !== '' && !isFinite(Number(v));
            });
            if (invalid) {
                alert(`${invalid} må være et tall.`);
                return null;
            }
            numericFields.forEach((field) => {
                if (values[field] === '') delete values[field];
            });
            if (values.scale === '') delete values.scale;
            if (!values.format) delete values.format;
            const hasNumeric = numericFields.some((field) => field in values);
            if (hasNumeric && !('scale' in values)) {
                alert('Velg Scale-modus når raw/eng-verdier endres.');
                return null;
            }
            if (!Object.keys(values).length) {
                showHint('Ingen felter valgt.');
                return null;
            }
            return values;
        };
        modal.querySelector('#sm-poc-scale-other-units').addEventListener('click', () => {
            const values = validatedScaleValues();
            if (!values) return;
            modal.remove();
            applyMarkedChangesToOtherUnits('Scale', values);
        });
        modal.querySelector('#sm-poc-scale-marked-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const values = validatedScaleValues();
            if (!values) return;
            modal.remove();
            applyChangesToMarkedParameters('Scale all marked', values);
        });

        document.body.appendChild(modal);
        renderPresetRows();
    }

    function rowsInDomOrder(rows, tbody) {
        const all = Array.from(tbody.querySelectorAll('tr'));
        return rows.slice().sort((a, b) => {
            const ai = all.indexOf(a);
            const bi = all.indexOf(b);
            if (ai >= 0 && bi >= 0) return ai - bi;
            if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING) return 1;
            return 0;
        });
    }

    function isVisibleRow(row) {
        return row.style.display !== 'none';
    }

    function getVisibleRows(tbody) {
        return Array.from(tbody.querySelectorAll('tr')).filter(isVisibleRow);
    }

    function rowTableKey(row) {
        if (!row) return null;
        if (row.dataset?.smPocAllSide) return row.dataset.smPocAllSide;
        const parent = row.parentNode;
        if (parent === measurementsTable) return 'measurements';
        if (parent === settingsTable) return 'settings';
        return null;
    }

    function normalizeFilterText(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function filterTextMatches(text, query) {
        const haystack = normalizeFilterText(text);
        const needle = normalizeFilterText(query);
        if (!needle) return true;
        if (!needle.includes('++')) {
            return needle.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
        }

        const parts = needle.split('++').filter(Boolean);
        if (!parts.length) return true;

        let from = 0;
        return parts.every((part) => {
            const idx = haystack.indexOf(part, from);
            if (idx < 0) return false;
            from = idx + part.length;
            return true;
        });
    }

    function applyFilters(tbody, filterMap, key) {
        let visibleCount = 0;
        Array.from(tbody.querySelectorAll('tr')).forEach((row) => {
            const visible = rowVisualSide(row) === key
                && rowMatchesFilterMap(row, filterMap)
                && !rowHasHiddenZeroValue(row);
            row.style.display = visible ? '' : 'none';
            if (visible) visibleCount++;
        });
        return visibleCount;
    }

    function countActiveFilters(filterMap) {
        return Object.values(filterMap).filter((v) => v && String(v).trim()).length;
    }

    function getTbodyForKey(key) {
        return key === 'measurements' ? measurementsTable : settingsTable;
    }

    function getHeaderCellsForSide(key) {
        const tbody = getTbodyForKey(key);
        const bodyTable = tbody?.closest('table.iwmac_table_scroll_table');
        const splitHeader = tbody?.closest('.iwmac_table_scroll_container')
            ?.querySelector('table.iwmac_table_scroll_header');
        const headerRow = splitHeader?.querySelector('thead tr')
            || bodyTable?.querySelector('thead tr');
        return headerRow ? Array.from(headerRow.querySelectorAll('th')) : [];
    }

    function cleanupHiddenBodyHeaderFilters(key) {
        const tbody = getTbodyForKey(key);
        const splitHeader = tbody?.closest('.iwmac_table_scroll_container')
            ?.querySelector('table.iwmac_table_scroll_header');
        const bodyTable = tbody?.closest('table.iwmac_table_scroll_table');
        [splitHeader, bodyTable].filter(Boolean).forEach((table) => {
            table.querySelectorAll('thead th[data-sm-poc-header-filter="1"]').forEach((th) => {
                th.querySelectorAll('.sm-poc-col-filter, .sm-poc-filter-line, .sm-poc-clear-filter').forEach((el) => el.remove());
                delete th.dataset.smPocHeaderFilter;
                th.classList.remove('sm-poc-header-filter-cell', 'sm-poc-col-active');
            });
        });
    }

    function restoreSplitHeaderFilters(root) {
        root.querySelectorAll('table.iwmac_table_scroll_header th[data-sm-poc-header-filter="1"]')
            .forEach((th) => {
                th.querySelectorAll('.sm-poc-col-filter, .sm-poc-filter-line, .sm-poc-clear-filter').forEach((el) => el.remove());
                delete th.dataset.smPocHeaderFilter;
                th.classList.remove('sm-poc-header-filter-cell', 'sm-poc-col-active');
            });
    }

    function getFilterRootForKey(key) {
        return document
            .getElementById(FILTER_PORTAL_ID)
            ?.querySelector(`.sm-poc-pane-filters[data-side="${key}"]`) || null;
    }

    function readFiltersFromDom(key) {
        const root = getFilterRootForKey(key);
        if (!root) return;
        root.querySelectorAll('.sm-poc-col-filter').forEach((input) => {
            const col = parseInt(input.dataset.col, 10);
            const val = input.value.trim();
            const cell = input.closest('th, .sm-poc-filter-grid-cell');
            if (cell) cell.classList.toggle('sm-poc-col-active', !!val);
            if (val) activeFilters[key][col] = val;
            else delete activeFilters[key][col];
        });
    }

    function applyFiltersForSide(key) {
        readFiltersFromDom(key);
        const tbody = getTbodyForKey(key);
        if (!tbody?.isConnected) return 0;
        return applyFilters(tbody, activeFilters[key], key);
    }

    function updateColumnFilterMeta(key) {
        const meta = getFilterRootForKey(key)
            ?.querySelector(`span.sm-poc-col-filter-meta[data-meta-side="${key}"]`);
        if (!meta) return;
        const tbody = getTbodyForKey(key);
        if (!tbody?.isConnected || !countActiveFilters(activeFilters[key])) {
            meta.textContent = '';
            return;
        }
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const visible = rows.filter(isVisibleRow).length;
        meta.textContent = `${visible}/${rows.length}`;
    }

    function applyAllFilters() {
        applyFiltersForSide('measurements');
        applyFiltersForSide('settings');
        updateColumnFilterMeta('measurements');
        updateColumnFilterMeta('settings');
        renderPendingVisualRows();
    }

    function scheduleFilterApply(key) {
        clearTimeout(filterTimers[key]);
        filterTimers[key] = setTimeout(() => {
            applyFiltersForSide(key);
            updateColumnFilterMeta(key);
            renderPendingVisualRows();
        }, 30);
    }

    function setActiveFilterValue(key, col, value) {
        const val = String(value || '').trim();
        if (val) activeFilters[key][col] = val;
        else delete activeFilters[key][col];
    }

    function syncFilterGridWidths(host, tbody) {
        const grid = host?.querySelector('.sm-poc-filter-grid');
        if (!grid) return;

        const key = host?.dataset.side || (tbody === measurementsTable ? 'measurements' : 'settings');
        const container = getTableContainerForTbody(tbody);
        const containerRect = container?.getBoundingClientRect();
        if (!isStableTableRect(containerRect)) {
            clearFilterGridWidthCache(host);
            return;
        }

        const expectedWidth = Math.round(containerRect.width);
        const sample = tbody?.querySelector('tr');
        let widths = sample
            ? Array.from(sample.cells).map((c) => Math.round(c.getBoundingClientRect().width))
            : [];

        if (!isUsableColumnWidths(widths, expectedWidth)) {
            widths = getHeaderCellsForSide(key).map((th) => {
                const attrWidth = parseFloat(th.getAttribute('width') || '');
                return Math.round(attrWidth || th.getBoundingClientRect().width || 0);
            });
        }

        if (!isUsableColumnWidths(widths, expectedWidth)) {
            const colCount = getColumnCount(tbody);
            const fallbackWidth = Math.max(Math.floor(expectedWidth / colCount), 40);
            widths = Array.from({ length: colCount }, () => fallbackWidth);
        }

        if (!isUsableColumnWidths(widths, expectedWidth)) {
            clearFilterGridWidthCache(host);
            return;
        }

        const template = stableColumnTemplate(widths);
        grid.style.gridTemplateColumns = template;
        grid.dataset.smPocLastTemplate = template;
    }

    function positionFilterHost(host, tbody) {
        if (!host) return;
        const container = getTableContainerForTbody(tbody);
        const rect = container ? getStableHostRect(container, host) : null;
        if (!rect) {
            // Uten gyldig mål-rekt (tabell skjult/under omtegning) ville verten
            // blitt liggende synlig uposisjonert i øverste venstre hjørne.
            host.style.display = 'none';
            return;
        }
        host.style.display = '';
        const height = Math.max(Math.ceil(host.getBoundingClientRect().height), 26);

        host.style.left = `${Math.round(rect.left)}px`;
        host.style.top = `${Math.round(rect.top)}px`;
        host.style.width = `${Math.round(rect.width)}px`;
        setContainerTopPadding(container, height);
        updateContainerTopPaddingForSide(tbody === measurementsTable ? 'measurements' : 'settings');
    }

    function positionAllFilterHosts() {
        positionFilterHost(getFilterRootForKey('measurements'), measurementsTable);
        positionFilterHost(getFilterRootForKey('settings'), settingsTable);
        positionGhostHost(getGhostRootForKey('measurements'), 'measurements');
        positionGhostHost(getGhostRootForKey('settings'), 'settings');
        positionUnitComboHost();
        positionAllParamsButton();
        positionAllParamsView();
        positionToolbar();
    }

    function createFilterInput(col, key, label) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sm-poc-col-filter';
        input.dataset.col = String(col);
        input.dataset.side = key;
        input.placeholder = label;
        input.value = activeFilters[key][col] || '';
        input.title = `Filter: ${label}`;
        const syncClearButton = () => {
            input.parentElement?.classList.toggle('sm-poc-has-value', !!input.value.trim());
        };
        input.addEventListener('input', () => {
            setActiveFilterValue(key, col, input.value);
            syncClearButton();
            scheduleFilterApply(key);
        });
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                input.value = '';
                setActiveFilterValue(key, col, '');
                syncClearButton();
                scheduleFilterApply(key);
                ev.stopPropagation();
            }
        });
        input.addEventListener('click', (ev) => ev.stopPropagation());
        requestAnimationFrame(syncClearButton);
        return input;
    }

    function createFilterField(col, key, label) {
        const field = document.createElement('div');
        field.className = 'sm-poc-col-filter-field';

        const input = createFilterInput(col, key, label);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'sm-poc-clear-filter';
        clearBtn.textContent = 'x';
        clearBtn.title = `Tøm filter: ${label}`;
        clearBtn.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
        });
        clearBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            input.value = '';
            field.classList.remove('sm-poc-has-value');
            setActiveFilterValue(key, col, '');
            scheduleFilterApply(key);
            input.focus();
        });

        field.appendChild(input);
        field.appendChild(clearBtn);
        field.classList.toggle('sm-poc-has-value', !!input.value.trim());
        return field;
    }

    function ensureHeaderFilters(key) {
        const tbody = getTbodyForKey(key);
        if (!tbody?.isConnected) return;

        // Hold IWMAC-headeren ren slik sortering/klikk fra original UI fortsatt virker.
        getPane(key)?.querySelectorAll('.sm-poc-filter-bar').forEach((el) => el.remove());
        cleanupHiddenBodyHeaderFilters(key);
        ensurePaneFilters(key);
    }

    function createFilterMeta(key) {
        const meta = document.createElement('span');
        meta.className = 'sm-poc-col-filter-meta';
        meta.dataset.metaSide = key;
        return meta;
    }

    function buildFilterGrid(grid, colCount, labels, key) {
        grid.innerHTML = '';
        for (let col = 0; col < colCount; col++) {
            const cell = document.createElement('div');
            cell.className = 'sm-poc-filter-grid-cell';
            const label = labels[col] || `Kol ${col + 1}`;

            if (col === 0) {
                const wrap = document.createElement('div');
                wrap.className = 'sm-poc-col-filter-wrap';
                wrap.style.flex = '1';
                wrap.style.minWidth = '0';
                wrap.appendChild(createFilterField(col, key, label));
                wrap.appendChild(createFilterMeta(key));
                cell.appendChild(wrap);
            } else {
                cell.appendChild(createFilterField(col, key, label));
            }

            if (activeFilters[key][col]) cell.classList.add('sm-poc-col-active');
            grid.appendChild(cell);
        }
    }

    function updateUnitFilterDatalist(host, tbody, key, labels) {
        const unitCol = labels.lastIndexOf('Enhet');
        if (unitCol < 0 || !tbody?.isConnected || !host) return;
        const input = host.querySelector(`.sm-poc-col-filter[data-col="${unitCol}"]`);
        if (!input) return;
        const listId = `sm-poc-unit-options-${key}`;
        if (input.getAttribute('list') !== listId) input.setAttribute('list', listId);
        bindUnitPickerOpen(input);
        let datalist = host.querySelector(`#${listId}`);
        if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = listId;
            host.appendChild(datalist);
        }
        const values = new Set();
        Array.from(tbody.rows).forEach((row) => {
            const text = (row.cells[unitCol]?.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) values.add(text);
        });
        const html = [...values]
            .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
            .map((value) => `<option value="${escapeHtml(value)}"></option>`)
            .join('');
        if (datalist.innerHTML !== html) datalist.innerHTML = html;
    }

    function ensurePaneFilters(key) {
        const tbody = getTbodyForKey(key);
        if (!tbody?.isConnected) return;

        const colCount = getColumnCount(tbody);
        const labels = getColumnLabelsForSide(key, colCount);
        const portal = getFilterPortal();

        let host = portal.querySelector(`.sm-poc-pane-filters[data-side="${key}"]`);
        const needsRebuild = !host
            || host.dataset.cols !== String(colCount)
            || !host.querySelector('.sm-poc-col-filter');

        if (!host) {
            host = document.createElement('div');
            host.className = 'sm-poc-pane-filters';
            host.dataset.side = key;
            // Skjult til første gyldige posisjonering, ellers blinker den på 0,0.
            host.style.display = 'none';
            portal.appendChild(host);
        }

        host.dataset.cols = String(colCount);

        let grid = host.querySelector('.sm-poc-filter-grid');
        if (!grid) {
            grid = document.createElement('div');
            grid.className = 'sm-poc-filter-grid';
            host.appendChild(grid);
        }

        if (needsRebuild) {
            buildFilterGrid(grid, colCount, labels, key);
        } else {
            grid.querySelectorAll('.sm-poc-col-filter').forEach((input) => {
                const col = parseInt(input.dataset.col, 10);
                if (document.activeElement === input) return;
                input.value = activeFilters[key][col] || '';
                input.parentElement?.classList.toggle('sm-poc-has-value', !!input.value.trim());
            });
        }

        requestAnimationFrame(() => {
            syncFilterGridWidths(host, tbody);
            positionFilterHost(host, tbody);
            updateUnitFilterDatalist(host, tbody, key, labels);
            applyFiltersForSide(key);
            updateColumnFilterMeta(key);
            renderPendingVisualRows();
        });
    }

    function showHelpModal() {
        document.getElementById('sm-poc-help-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'sm-poc-help-modal';
        modal.className = 'sm-poc-batch-modal';
        modal.innerHTML = `
            <div id="sm-poc-help-box" class="sm-poc-batch-box" style="width:min(860px,96vw);max-height:90vh;display:flex;flex-direction:column;">
                <div id="sm-poc-help-head" class="sm-poc-batch-head">
                    <h2>Hjelp – Supermarket Parameters (v${escapeHtml(SCRIPT_VERSION)})</h2>
                    <button type="button" class="sm-poc-red-btn" data-close="1">Lukk</button>
                </div>
                <div class="sm-poc-help-toc">
                    <strong>Innhold:</strong>
                    <a data-goto="sm-help-overview">Oversikt</a>
                    <a data-goto="sm-help-toolbar">Verktøylinje</a>
                    <a data-goto="sm-help-filter">Filter</a>
                    <a data-goto="sm-help-unit">Enhetsvelger</a>
                    <a data-goto="sm-help-move">Endrings-modus</a>
                    <a data-goto="sm-help-all">Alle parameter</a>
                    <a data-goto="sm-help-export">Excel export</a>
                    <a data-goto="sm-help-details">Parameterdetaljer</a>
                    <a data-goto="sm-help-batch">Batch på merkede</a>
                    <a data-goto="sm-help-xunit">Bruk på andre enheter</a>
                    <a data-goto="sm-help-keys">Hurtigtaster</a>
                </div>
                <div class="sm-poc-help-body" style="overflow:auto;padding-right:6px;">
                    <h3 id="sm-help-overview">Oversikt</h3>
                    <p>Dette verktøyet legger seg oppå IWMAC Supermarket-siden og gir ekstra funksjoner for å
                    filtrere, redigere og masse-endre driver-parametere. Selve IWMAC-headeren røres ikke –
                    filter og kontroller ligger som et lag over tabellene.</p>
                    <p>De fleste funksjonene er tilgjengelige på <em>innstillinger</em>-siden for en enhet.
                    Begynn med å velge enhet i søkefeltet øverst, og bruk <span class="sm-poc-help-btnref">Hjelp</span>-knappen
                    når som helst for å åpne denne veiledningen igjen.</p>

                    <h3 id="sm-help-toolbar">Verktøylinje</h3>
                    <ul>
                        <li><span class="sm-poc-help-btnref">Aktiver Endrings-modus</span> – slår på redigerings-/markeringsmodus.
                        Når den er på endres teksten til «Endrings-modus: PÅ». Slår du den av, forkastes ulagrede endringer.</li>
                        <li><span class="sm-poc-help-btnref">Skjul 0.0</span> – skjuler rader der Verdi er 0 eller 0.0. Trykk igjen for å vise dem.</li>
                        <li><span class="sm-poc-help-btnref">Lagre</span> – lagrer flyttede rader (r ↔ rw) til databasen. Aktiv kun når du har ulagrede endringer.</li>
                        <li><code>0 endringer</code> – teller som viser hvor mange ulagrede flyttinger du har.</li>
                        <li><span class="sm-poc-help-btnref">Export all units</span> – eksporterer <strong>alle enheter på anlegget</strong>
                        til én Excel-fil. Spør først, og kan ta flere minutter – se
                        <a data-goto="sm-help-export">Excel export</a> for hva fila inneholder.</li>
                        <li><span class="sm-poc-help-btnref">Hjelp</span> – åpner denne veiledningen.</li>
                    </ul>

                    <h3 id="sm-help-filter">Kolonnefilter</h3>
                    <p>Under hver kolonneoverskrift ligger et søkefelt. Skriv for å filtrere radene
                    (treffer delvis tekst, uavhengig av store/små bokstaver). Aktive filterfelt får gul bakgrunn.</p>
                    <ul>
                        <li>Trykk <kbd>x</kbd> i feltet (eller <kbd>Esc</kbd> mens markøren står i feltet) for å tømme det filteret.</li>
                        <li>Filter for «Måling» og «Innstillinger» fungerer hver for seg.</li>
                    </ul>

                    <h3 id="sm-help-unit">Søkbar enhetsvelger</h3>
                    <p>Den vanlige enhets-nedtrekkslisten er erstattet med et søkbart felt øverst.</p>
                    <ul>
                        <li>Klikk feltet for å åpne, og skriv for å filtrere på enhetsnavn eller unit-id.</li>
                        <li><span class="sm-poc-help-btnref">A-Z</span>/<span class="sm-poc-help-btnref">Orig</span> bytter mellom alfabetisk og opprinnelig rekkefølge.</li>
                        <li><kbd>↑</kbd>/<kbd>↓</kbd> for å navigere <strong>fra gjeldende enhet</strong>, <kbd>Enter</kbd> for å velge, <kbd>Esc</kbd> for å lukke.</li>
                        <li><kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> bytter enhet direkte <strong>uten å åpne listen</strong> (forrige/neste i original rekkefølge).</li>
                        <li>Søket huskes nå mellom hver gang du åpner feltet – teksten markeres, så du kan skrive over for nytt søk eller la den stå.</li>
                    </ul>

                    <h3 id="sm-help-move">Endrings-modus (marker og flytt)</h3>
                    <p>Slå på <span class="sm-poc-help-btnref">Aktiver Endrings-modus</span> først. Da kan du markere rader og dra dem mellom Måling og Innstillinger.</p>
                    <ul>
                        <li><strong>Marker:</strong> klikk en rad. <kbd>Shift</kbd>+klikk markerer et område, <kbd>Ctrl</kbd>+klikk legger til/fjerner enkeltrader.</li>
                        <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> markerer alle synlige rader i aktiv tabell. <kbd>Esc</kbd> fjerner all markering.</li>
                        <li><strong>Flytt:</strong> dra markerte rader over til motsatt tabell. De vises som «spøkelsesrader» (ikke lagret ennå) – grønt = blir <code>rw</code> (innstilling), blått = blir <code>r</code> (måling).</li>
                        <li><strong>Angre:</strong> dra raden tilbake fra spøkelsestabellen.</li>
                        <li><strong>Lagre:</strong> trykk <span class="sm-poc-help-btnref">Lagre</span> i verktøylinjen for å skrive endringene til databasen.</li>
                    </ul>

                    <h3 id="sm-help-all">Vis alle parameter</h3>
                    <p><span class="sm-poc-help-btnref">Vis alle parameter</span> viser parametere fra alle grupper i valgt enhet, i to ruter
                    (Måling og Innstillinger) med kolonnene Gruppe, Navn, Verdi og Enhet. Klikk en kolonneoverskrift for å sortere.</p>
                    <p>Egen verktøylinje i visningen har <span class="sm-poc-help-btnref">Vis enkeltgruppe</span> (tilbake til normal visning)
                    og <span class="sm-poc-help-btnref">Export unit (Excel)</span> (eksporter kun denne enheten – se
                    <a data-goto="sm-help-export">Excel export</a>).</p>
                    <p><strong>Høyreklikk</strong> på en rad gir meny:</p>
                    <ul>
                        <li><strong>Highlight used_in_graphics</strong> – markerer rader som brukes i grafikk (grønt), viser hvilke grafikk-bilder enheten er brukt i (lenker ved enhetsvelgeren) og tagger rader med bildenavn (🖼).
                        Markeringen står til du trykker <strong>✕</strong> i merkelappen. Klikker du en bilde-lenke, blinker objektene for enheten i bildet i 3 sekunder.</li>
                        <li><span class="sm-poc-help-btnref">Kun i grafikk</span> (i Vis alle parameter) – filtrerer lista til bare de parameterne som brukes i grafikk-bilder.</li>
                        <li><strong>Get Driver Parameter Details</strong> – åpner detaljvinduet for parameteren.</li>
                        <li>I Endrings-modus i tillegg: <strong>Change Plant pri for marked</strong>, <strong>Scale all marked</strong> og <strong>Clear marking</strong>.</li>
                    </ul>

                    <h3 id="sm-help-export">Excel export</h3>
                    <p>Two export buttons with different scope:</p>
                    <ul>
                        <li><span class="sm-poc-help-btnref">Export all units</span> (main toolbar) – shows a warning first, then fetches
                        <strong>every unit on the plant</strong> and downloads one file. Can take several minutes on large plants —
                        progress is shown at the bottom, and units that fail are skipped and counted in the final message.
                        The <em>All units</em> sheet has a collapsible block per unit with the group blocks inside — use Excel's
                        <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> outline buttons (top-left corner) to collapse the whole plant to unit rows.
                        Columns: Unit ID, Unit name, Group, Alias text, Value, Eng unit, Access, Allowed values, Type, Application, Driver ID.</li>
                        <li><span class="sm-poc-help-btnref">Export unit (Excel)</span> (inside Vis alle parameter) – downloads the open
                        unit only, as one <em>Parameters</em> sheet (columns Group, Unit ID, Unit name, Alias text, Value, Eng unit, Access,
                        Allowed values, Type, Application, Driver ID), with the writable rows first within each group. Column filters are
                        respected — filter first to export just those rows.</li>
                    </ul>
                    <p>Both files are real <code>.xlsx</code> workbooks:</p>
                    <ul>
                        <li>Styled, frozen header row with sort/filter dropdowns (AutoFilter) on every column;
                        group/unit bands collapse with the +/- buttons in the left margin.</li>
                        <li><strong>Access</strong> – Read or Read/write (the parameter's real <code>att</code>, override-aware,
                        fetched per driver_id at export time).</li>
                        <li><strong>Allowed values</strong> – the possible values: enum options like <code>0 = Off / 1 = On</code> or the
                        min–max range. For writable rows that is what you can change the value to; for read-only rows it describes
                        the possible states.</li>
                        <li><strong>Unit ID, Unit name, Type, Application</strong> – the same columns the IWMAC Designer parameter export
                        shows, read straight from the driver-parameter table at export time, so the two files line up side by side.
                        (Designer's <em>Tag</em> and <em>SGR</em> are not available on the plant and are left out.)</li>
                        <li>Numeric values are real Excel numbers (sortable/summable), and the final message tells you how many of the
                        exported parameters are writable.</li>
                    </ul>

                    <h3 id="sm-help-details">Parameterdetaljer</h3>
                    <p>I <strong>grafikk-visningen</strong> får boksen som spretter opp over et linket objekt en
                    <strong>ℹ️</strong>-knapp som åpner det samme detaljvinduet for den parameteren.</p>
                    <p>Detaljvinduet viser og lar deg redigere feltene for én parameter: alias, Plant Pri (alarmprioritet),
                    Eng Unit, Format, Range, Scale, Raw/Eng min/maks, Att (<code>r</code>/<code>rw</code>/<code>vr</code>/<code>vrw</code>) og Format Extra.
                    Felt med blå ramme har data i override-tabellen.</p>
                    <ul>
                        <li><span class="sm-poc-help-btnref">Save Changes</span> – lagrer endringene til denne parameteren.</li>
                        <li><span class="sm-poc-help-btnref">Apply to other units...</span> – kjør de samme endringene på andre enheter (se neste seksjon).</li>
                        <li><span class="sm-poc-help-btnref">Scaling Presets...</span> – ferdige skaleringsoppsett med forhåndsvisning.</li>
                        <li><span class="sm-poc-help-btnref">Delete Override</span> – sletter override-raden (kan ikke angres; stopp/start Escape etterpå ved behov).</li>
                        <li><strong>Copy</strong> ved Meter ID kopierer <code>plant_id;unit_id;element_id</code>.</li>
                    </ul>

                    <h3 id="sm-help-batch">Batch på merkede parametere</h3>
                    <p>I Endrings-modus kan du endre mange parametere samtidig (høyreklikk i «Vis alle parameter»):</p>
                    <ul>
                        <li><strong>Change Plant pri for marked</strong> – setter alarmprioritet (A/B/C/N/blank) på alle merkede.</li>
                        <li><strong>Scale all marked</strong> – setter skalering på alle merkede. Inneholder kalkulator («raw X skal bli Y»),
                        egendefinerte verdier og en tabell med presets med forhåndsvisning.</li>
                        <li><strong>Delete overrides for marked</strong> – sletter override-rad for alle merkede.</li>
                    </ul>
                    <p>Knappen <span class="sm-poc-help-btnref">Apply to marked</span> / <span class="sm-poc-help-btnref">Apply scaling to marked</span>
                    skriver til <em>gjeldende</em> enhet.</p>

                    <h3 id="sm-help-xunit">Bruk på andre enheter (kopier endring til flere enheter)</h3>
                    <p>Når du har gjort en endring (r/rw, alarmpri eller skalering) kan du kjøre den samme endringen på andre enheter
                    via knappen <span class="sm-poc-help-btnref">Apply to other units...</span> – finnes i detaljvinduet og i batch-vinduene.</p>
                    <p><strong>Slik gjør du det:</strong></p>
                    <ul>
                        <li>Gjør endringen (eller marker parametere + velg endring i batch-vinduet).</li>
                        <li>Trykk <span class="sm-poc-help-btnref">Apply to other units...</span>. Det åpnes en enhetsvelger som viser
                        hvilke felter som skrives og antall parametere per enhet.</li>
                        <li>Søk/filtrer på <strong>navn</strong> eller <strong>unit-id</strong> (velg søkemodus), og kryss av enhetene du vil endre.
                        Bruk «Velg alle (synlige)» / «Fjern alle» ved behov.</li>
                        <li>Trykk <span class="sm-poc-help-btnref">Kjør på valgte enheter</span>.</li>
                        <li>Etterpå vises en resultattabell: per enhet ser du hvor mange parametere som ble skrevet, hvor mange som
                        ikke ble funnet, og eventuelle feil (grønn = OK, gul = noen ikke funnet, rød = feil).</li>
                    </ul>
                    <div class="sm-poc-help-note">
                        Parametere finnes igjen på hver enhet ut fra <code>alias</code> + <code>meny</code> (ikke den interne driver-id-en,
                        som er unik per enhet). Mangler en parameter på en enhet, rapporteres den som «ikke funnet» – ingenting skrives feil.
                        Hver enhet kjøres som egen batch, så feil på én enhet stopper ikke de andre.
                    </div>

                    <h3 id="sm-help-keys">Hurtigtaster</h3>
                    <ul>
                        <li><strong>Endrings-modus:</strong> klikk = marker · <kbd>Shift</kbd>+klikk = område · <kbd>Ctrl</kbd>+klikk = legg til/fjern ·
                        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> = marker alle synlige · <kbd>Esc</kbd> = fjern markering</li>
                        <li><strong>Enhetsvelger (åpen):</strong> <kbd>↑</kbd>/<kbd>↓</kbd> = naviger fra gjeldende · <kbd>Enter</kbd> = velg · <kbd>Esc</kbd> = lukk</li>
                        <li><strong>Enhetsvelger (lukket):</strong> <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> = forrige/neste enhet i original rekkefølge</li>
                        <li><strong>Filterfelt:</strong> <kbd>Esc</kbd> = tøm filteret</li>
                    </ul>
                </div>
                <div class="sm-poc-batch-actions">
                    <button type="button" class="sm-poc-gray-btn" data-close="1">Lukk</button>
                </div>
            </div>
        `;
        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.dataset.close === '1') {
                modal.remove();
                return;
            }
            const goto = event.target.closest('[data-goto]')?.dataset.goto;
            if (goto) {
                event.preventDefault();
                modal.querySelector(`#${goto}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
        document.body.appendChild(modal);
        if (typeof setupDraggablePocModal === 'function') {
            setupDraggablePocModal(modal, '#sm-poc-help-box', '#sm-poc-help-head');
        }
    }

    // ---- Excel (.xlsx) export ----------------------------------------------
    // The script runs with @grant none, so no GM_download / libraries. A real
    // .xlsx is just a ZIP of XML parts — built here from scratch (store-only ZIP
    // + CRC32 + minimal SpreadsheetML) so the file opens cleanly in Excel on any
    // locale, in proper columns, without the CSV separator/encoding pitfalls.
    const XLSX_CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function xlsxCrc32(bytes) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
            crc = (crc >>> 8) ^ XLSX_CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function xlsxZip(files) {
        const encoder = new TextEncoder();
        const localParts = [];
        const centralParts = [];
        let offset = 0;
        files.forEach((file) => {
            const nameBytes = encoder.encode(file.name);
            const data = file.data;
            const crc = xlsxCrc32(data);
            const local = new DataView(new ArrayBuffer(30));
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

            const central = new DataView(new ArrayBuffer(46));
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

        const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);

        return new Blob([...localParts, ...centralParts, new Uint8Array(end.buffer)], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
    }

    function xlsxColumnRef(index) {
        let ref = '';
        let n = index;
        do {
            ref = String.fromCharCode(65 + (n % 26)) + ref;
            n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        return ref;
    }

    // Cell style indexes into xlsxStylesXml()'s cellXfs.
    const XLSX_STYLE_DEFAULT = 0;
    const XLSX_STYLE_HEADER = 1;   // bold white on blue
    const XLSX_STYLE_GROUP = 2;    // bold white on blue band (same look as the header)
    const XLSX_STYLE_UNIT = 3;     // bold white on gray-blue (unit band, all-units export)

    function xlsxStylesXml() {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF0D47A1"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1976D2"/><bgColor rgb="FF1976D2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F2FD"/><bgColor rgb="FFE3F2FD"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF455A64"/><bgColor rgb="FF455A64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    }

    function xlsxCell(ref, value, style = XLSX_STYLE_DEFAULT) {
        const text = value == null ? '' : String(value);
        const styleAttr = style ? ` s="${style}"` : '';
        // Numeric-looking values become real numbers so Excel can sum/sort them;
        // everything else (OFF, On, alarm texts, ...) stays an inline string.
        if (text !== '' && /^-?\d+(?:\.\d+)?$/.test(text)) {
            return `<c r="${ref}"${styleAttr}><v>${text}</v></c>`;
        }
        return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeHtml(text)}</t></is></c>`;
    }

    // rows: [{ cells: [...], style?: cellXfs index, outline?: 1 }, ...].
    // Row 1 is frozen, the whole range gets an AutoFilter (sort/filter
    // dropdowns), and outline:1 rows collapse under the row above them
    // (outlinePr summaryBelow=0 puts the +/- button on the group row).
    function xlsxSheetXml(modelRows, colWidths = EXPORT_COL_WIDTHS) {
        const colCount = modelRows.reduce((max, row) => Math.max(max, row.cells.length), 1);
        const maxOutline = Math.max(modelRows.reduce((max, row) => Math.max(max, row.outline || 0), 0), 1);
        const lastCell = `${xlsxColumnRef(colCount - 1)}${Math.max(modelRows.length, 1)}`;
        const body = modelRows.map((row, rowIndex) => {
            const cellsXml = row.cells.map((value, colIndex) => (
                xlsxCell(`${xlsxColumnRef(colIndex)}${rowIndex + 1}`, value, row.style || XLSX_STYLE_DEFAULT)
            )).join('');
            const outline = row.outline ? ` outlineLevel="${row.outline}"` : '';
            return `<row r="${rowIndex + 1}"${outline}>${cellsXml}</row>`;
        }).join('');
        const colsXml = colWidths.slice(0, colCount)
            .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
            .join('');
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="0"/></sheetPr><dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15" outlineLevelRow="${maxOutline}"/><cols>${colsXml}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${lastCell}"/></worksheet>`;
    }

    function buildXlsxBlob(sheets) {
        const encoder = new TextEncoder();
        const safeSheets = sheets.map((sheet, index) => ({
            name: (sheet.name || `Sheet${index + 1}`).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || `Sheet${index + 1}`,
            rows: sheet.rows,
            colWidths: sheet.colWidths
        }));
        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safeSheets.map((unused, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
        const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
        const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeSheets.map((sheet, i) => `<sheet name="${escapeHtml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
        const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safeSheets.map((unused, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

        const files = [
            { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
            { name: '_rels/.rels', data: encoder.encode(rootRels) },
            { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
            { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
            { name: 'xl/styles.xml', data: encoder.encode(xlsxStylesXml()) }
        ];
        safeSheets.forEach((sheet, i) => {
            files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(xlsxSheetXml(sheet.rows, sheet.colWidths || EXPORT_COL_WIDTHS)) });
        });
        return xlsxZip(files);
    }

    function triggerXlsxDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function exportTimeStamp() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    }

    // Last-resort Unit name when the driver-parameter lookup fails: whatever the
    // unit dropdown calls this unit.
    function unitLabelFor(unitId) {
        if (!unitId) return '';
        const option = getAllUnitOptions().find((item) => item.value === unitId);
        return normalizeExportText(option?.text || '');
    }

    function exportFileBase() {
        const plant = getPlantId() || 'plant';
        const unit = (getUnitId() || 'unit').replace(/[\\/?*\[\]:]/g, '-');
        return `parameters_${plant}_${unit}_${exportTimeStamp()}`;
    }

    // Same column set (and naming) as the IWMAC Designer parameter export, plus
    // the two columns only this script can fill: the live Value and the
    // Allowed values. Tag and SGR are deliberately absent — they live in the
    // Designer's own paramgrid on legacy.iwmac.local, not in the plant's
    // iw_gen_driver_parameters, so there is nothing to read them from here.
    const EXPORT_HEADER = ['Group', 'Unit ID', 'Unit name', 'Alias text', 'Value', 'Eng unit', 'Access', 'Allowed values', 'Type', 'Application', 'Driver ID'];
    const EXPORT_COL_WIDTHS = [24, 18, 30, 46, 14, 10, 16, 34, 12, 16, 38];

    // ONE sheet for everything: one collapsible block per parameter group (a
    // styled band row with the +/- outline button, parameters at outlineLevel
    // 1). Within a group the writable (Read/write) rows come first, then the
    // read-only ones — the Access column tells them apart per row. The Group,
    // Unit ID and Unit name columns are repeated on every data row so AutoFilter
    // sorting and filtering keep working on the flat data.
    function buildCombinedExportRows(measurements, settings) {
        const rows = [{ cells: EXPORT_HEADER, style: XLSX_STYLE_HEADER }];
        const groups = new Map();
        const bucket = (dataRow, sideKey) => {
            const groupKey = normalizeExportText(dataRow[0]) || '-';
            if (!groups.has(groupKey)) groups.set(groupKey, { settings: [], measurements: [] });
            groups.get(groupKey)[sideKey].push(dataRow);
        };
        settings.forEach((row) => bucket(row, 'settings'));
        measurements.forEach((row) => bucket(row, 'measurements'));
        groups.forEach((members, groupName) => {
            const all = [...members.settings, ...members.measurements];
            const bandCells = [`${groupName} (${all.length})`, ...Array(EXPORT_HEADER.length - 1).fill('')];
            rows.push({ cells: bandCells, style: XLSX_STYLE_GROUP });
            all.forEach((member) => rows.push({ cells: member, outline: 1 }));
        });
        return rows;
    }

    const ALL_UNITS_EXPORT_HEADER = ['Unit ID', 'Unit name', 'Group', 'Alias text', 'Value', 'Eng unit', 'Access', 'Allowed values', 'Type', 'Application', 'Driver ID'];
    const ALL_UNITS_COL_WIDTHS = [18, 30, 22, 46, 14, 10, 16, 32, 12, 16, 34];

    // A single-unit row is [Group, Unit ID, Unit name, ...rest]; the all-units
    // sheet leads with the unit instead, so the first three swap around.
    const allUnitsRowOrder = (member) => [member[1], member[2], member[0], ...member.slice(3)];

    // All-units workbook: two-level outline — a gray-blue unit band per unit
    // (collapse a whole unit), header-blue group bands inside it (outline 1),
    // parameters at outline 2. The unit band carries the id in column A and the
    // name plus the parameter count in column B, the same ID / Name split the
    // unit dropdown shows. The Unit ID, Unit name and Group columns are
    // repeated on every data row so AutoFilter keeps working plant-wide.
    function buildAllUnitsExportRows(unitBlocks) {
        const pad = (cells) => [...cells, ...Array(Math.max(ALL_UNITS_EXPORT_HEADER.length - cells.length, 0)).fill('')];
        const rows = [{ cells: ALL_UNITS_EXPORT_HEADER, style: XLSX_STYLE_HEADER }];
        unitBlocks.forEach((block) => {
            const all = [...block.settings, ...block.measurements];
            const total = all.length;
            const first = all[0] || [];
            const unitId = normalizeExportText(first[1]) || block.unitId || '';
            const unitName = normalizeExportText(first[2]) || block.unitText || '';
            rows.push({ cells: pad([unitId, `${unitName} (${total})`]), style: XLSX_STYLE_UNIT });
            const groups = new Map();
            const bucket = (dataRow, sideKey) => {
                const groupKey = normalizeExportText(dataRow[0]) || '-';
                if (!groups.has(groupKey)) groups.set(groupKey, { settings: [], measurements: [] });
                groups.get(groupKey)[sideKey].push(dataRow);
            };
            block.settings.forEach((row) => bucket(row, 'settings'));
            block.measurements.forEach((row) => bucket(row, 'measurements'));
            groups.forEach((members, groupName) => {
                const groupRows = [...members.settings, ...members.measurements];
                rows.push({ cells: pad(['', '', `${groupName} (${groupRows.length})`]), style: XLSX_STYLE_GROUP, outline: 1 });
                groupRows.forEach((member) => rows.push({ cells: allUnitsRowOrder(member), outline: 2 }));
            });
        });
        return rows;
    }

    // The all-units export gets its rows straight from the RPC data (no DOM
    // involved) — same [group, name, value, unit, driverId] shape the DOM
    // collectors produce.
    function exportRowsFromFetchedParams(paramRows) {
        return paramRows.map((row) => [
            normalizeExportText(row.groupName),
            normalizeExportText(row.aliasText),
            normalizeExportText(stripHtmlToText(row.valueHtml)),
            normalizeExportText(stripHtmlToText(row.unitHtml)),
            normalizeExportText(row.driverId || '')
        ]);
    }

    function accessLabelFromAtt(att) {
        const value = String(att || '').trim().toLowerCase();
        if (value === 'rw') return 'Read/write';
        if (value === 'vrw') return 'Read/write (virtual)';
        if (value === 'vr') return 'Read (virtual)';
        if (value === 'r') return 'Read';
        return value;
    }

    // format_extra is JSON like {"type":"num","v":{"0":{"t":"Off"},"1":{"t":"On"}}}
    // — the v map lists the values the parameter accepts. Render "0 = Off / 1 = On";
    // labels that already embed the value ("1-Start") are kept as-is.
    function formatExtraOptionsText(formatExtra) {
        let parsed;
        try {
            parsed = JSON.parse(String(formatExtra || ''));
        } catch (error) {
            return '';
        }
        const valueMap = parsed?.v;
        if (!valueMap || typeof valueMap !== 'object' || Array.isArray(valueMap)) return '';
        const keys = Object.keys(valueMap).sort((a, b) => {
            const an = Number(a);
            const bn = Number(b);
            if (isFinite(an) && isFinite(bn)) return an - bn;
            return a.localeCompare(b, 'en', { numeric: true });
        });
        if (!keys.length) return '';
        const parts = keys.map((key) => {
            const label = String(valueMap[key]?.t ?? '').replace(/\s+/g, ' ').trim();
            if (!label || label === key) return key;
            if (label.startsWith(`${key}-`) || label.startsWith(`${key} `)) return label;
            return `${key} = ${label}`;
        });
        const shown = parts.slice(0, 10);
        const suffix = parts.length > shown.length ? ` / ... (${parts.length} values)` : '';
        return shown.join(' / ') + suffix;
    }

    // For writable rows this is "what you can change it to"; for read-only
    // rows the same enum/range describes the possible states — show it too.
    function allowedValuesText(dbRow) {
        const options = formatExtraOptionsText(dbRow?.format_extra_effective ?? dbRow?.format_extra);
        if (options) return options;
        const min = String(dbRow?.range_min_effective ?? dbRow?.range_min ?? '').trim();
        const max = String(dbRow?.range_max_effective ?? dbRow?.range_max ?? '').trim();
        if (min !== '' && max !== '') return `${min} to ${max}`;
        if (min !== '') return `min ${min}`;
        if (max !== '') return `max ${max}`;
        return '';
    }

    // Look up att/range/format_extra plus unit/type/application for every
    // exported driver_id, turning the collected [group, alias, value, engUnit,
    // driverId] rows into full EXPORT_HEADER rows. Failures degrade to
    // side-based Access, the caller's unit fallback and blank Allowed
    // values/Type/Application columns.
    async function enrichExportRowsWithAccess(sheets, fallback = {}) {
        const ids = [...new Set(sheets.flatMap(({ rows }) => rows.map((row) => row[4])).filter(Boolean))];
        const plantId = getPlantId();
        let byId = new Map();
        if (ids.length && plantId) {
            try {
                showHint(`Fetching access/range info for ${ids.length} parameters...`);
                const dbRows = await fetchDriverParameterRowsByDriverIds(ids, plantId);
                byId = new Map(dbRows.map((row) => [String(row.driver_id || ''), row]));
            } catch (error) {
                console.log('[Supermarket Parameters POC] export access lookup failed:', error);
            }
        }
        return sheets.map(({ rows, side }) => rows.map((row) => {
            const dbRow = byId.get(String(row[4] || ''));
            let att = dbRow?.att_effective || dbRow?.att || sideToAtt(side);
            // The page's own read/write split is authoritative for what IWMAC
            // lets you write — never downgrade a row served in the write list.
            if (side === 'settings' && !/w/.test(att)) att = 'rw';
            return [
                row[0],
                normalizeExportText(dbRow?.unit_id) || fallback.unitId || '',
                normalizeExportText(dbRow?.unit_name) || fallback.unitName || '',
                row[1],
                row[2],
                row[3],
                accessLabelFromAtt(att),
                allowedValuesText(dbRow),
                normalizeExportText(dbRow?.parameter_type),
                normalizeExportText(dbRow?.application),
                row[4]
            ];
        }));
    }

    function normalizeExportText(value) {
        return String(value || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    }

    function collectAllParamsExportRows(side) {
        const pane = document.querySelector(`#${ALL_PARAMS_VIEW_ID} .sm-poc-all-pane[data-side="${side}"]`);
        if (!pane) return [];
        return Array.from(pane.querySelectorAll('tbody tr'))
            .filter((row) => row.style.display !== 'none')
            .map((row) => [
                normalizeExportText(row.dataset.smPocGroupName || row.cells[0]?.textContent),
                normalizeExportText(row.dataset.smPocAliasText || row.cells[1]?.textContent),
                normalizeExportText(row.cells[2]?.textContent),
                normalizeExportText(row.cells[3]?.textContent),
                normalizeExportText(row.dataset.smPocDriverId || '')
            ]);
    }

    function collectNativeExportRows(tbody, groupName, driverIdByAlias) {
        if (!tbody) return [];
        return getVisibleRows(tbody).map((row) => {
            const name = normalizeExportText(row.cells[0]?.textContent);
            return [
                groupName,
                name,
                normalizeExportText(row.cells[1]?.textContent),
                normalizeExportText(row.cells[2]?.textContent),
                driverIdByAlias?.get(name) || ''
            ];
        });
    }

    // The native tables don't carry driver_ids in the DOM — re-fetch the
    // selected group through the same settings.php RPC the page used and map
    // alias text -> driver_id. Failures just leave the Driver ID column blank.
    async function fetchNativeGroupDriverIds() {
        const plantId = getPlantId();
        const unitId = getUnitId();
        const groupLabel = normalizeExportText(getSelectedGroupButton()?.textContent);
        if (!plantId || !unitId || !groupLabel) return new Map();
        const groups = await settingsRpc('get_groups', {
            plant: Number(plantId),
            unit_id: unitId,
            preffered_group: ''
        }) || [];
        const group = groups.find((item) => normalizeExportText(item.alias_text) === groupLabel);
        if (!group) return new Map();
        const result = await settingsRpc('get_parameters', {
            plant: Number(plantId),
            unit_id: unitId,
            group: group.id,
            preffered_group: ''
        }) || {};
        const map = new Map();
        [
            ...parseSettingsParameterCsv(result.read, group, 'measurements'),
            ...parseSettingsParameterCsv(result.write, group, 'settings')
        ].forEach((row) => {
            if (row.driverId) map.set(normalizeExportText(row.aliasText), row.driverId);
        });
        return map;
    }

    async function exportParametersToExcel() {
        let measurements;
        let settings;
        if (allParamsActive && document.getElementById(ALL_PARAMS_VIEW_ID)) {
            measurements = collectAllParamsExportRows('measurements');
            settings = collectAllParamsExportRows('settings');
        } else {
            const groupName = normalizeExportText(getSelectedGroupButton()?.textContent);
            showHint('Fetching driver IDs for the export...');
            const driverIdByAlias = await fetchNativeGroupDriverIds().catch(() => new Map());
            measurements = collectNativeExportRows(measurementsTable, groupName, driverIdByAlias);
            settings = collectNativeExportRows(settingsTable, groupName, driverIdByAlias);
        }
        if (!measurements.length && !settings.length) {
            showHint('No parameters to export.');
            return;
        }
        const unitId = getUnitId() || '';
        [measurements, settings] = await enrichExportRowsWithAccess([
            { rows: measurements, side: 'measurements' },
            { rows: settings, side: 'settings' }
        ], { unitId, unitName: unitLabelFor(unitId) });
        try {
            const blob = buildXlsxBlob([
                { name: 'Parameters', rows: buildCombinedExportRows(measurements, settings) }
            ]);
            triggerXlsxDownload(blob, `${exportFileBase()}.xlsx`);
            const writableCount = [...measurements, ...settings]
                .filter((row) => /write/i.test(String(row[6] || ''))).length;
            const writableNote = writableCount
                ? ` (${writableCount} writable)`
                : ' (no writable parameters on this unit)';
            showHint(`Exported ${measurements.length + settings.length} parameters to Excel${writableNote}.`);
        } catch (error) {
            console.log('[Supermarket Parameters POC] Excel export error:', error);
            alert('Could not export to Excel: ' + error.message);
        }
    }

    // Toolbar export: EVERY unit on the plant, sequentially (the plant server
    // degrades under parallel load — see ALL_GROUPS_FETCH_CONCURRENCY), with a
    // confirm dialog up front because this can run for minutes on big plants.
    async function exportAllUnitsToExcel() {
        const plantId = getPlantId();
        const units = getAllUnitOptions();
        if (!plantId || !units.length) {
            showHint('Cannot find plant_id or the unit list.');
            return;
        }
        const ok = window.confirm([
            `Export ALL ${units.length} units on plant ${plantId} to one Excel file?`,
            '',
            'This fetches every parameter from every unit and can take several',
            'minutes on large plants. The file gets one collapsible block per',
            'unit (group blocks inside), plus Access and Allowed values.',
            '',
            'Continue?'
        ].join('\n'));
        if (!ok) return;

        const blocks = [];
        const failedUnits = [];
        for (let i = 0; i < units.length; i++) {
            const unit = units[i];
            const label = `Unit ${i + 1}/${units.length} (${unit.text})`;
            showHint(`${label}: fetching groups...`);
            try {
                const data = await fetchGroupParametersForUnit(plantId, unit.value, (unused, done, total) => {
                    showHint(`${label}: ${done}/${total} groups...`);
                });
                if (data.failed?.length) throw new Error(`${data.failed.length} group(s) failed`);
                let measurements = exportRowsFromFetchedParams(data.measurements);
                let settings = exportRowsFromFetchedParams(data.settings);
                if (!measurements.length && !settings.length) continue;
                [measurements, settings] = await enrichExportRowsWithAccess([
                    { rows: measurements, side: 'measurements' },
                    { rows: settings, side: 'settings' }
                ], { unitId: unit.value, unitName: normalizeExportText(unit.text) });
                blocks.push({ unitText: unit.text, unitId: unit.value, measurements, settings });
            } catch (error) {
                console.log('[Supermarket Parameters POC] all-units export failed for unit:', unit.text, error);
                failedUnits.push(unit.text);
            }
        }

        if (!blocks.length) {
            alert('All-units export: could not fetch parameters for any unit.'
                + (failedUnits.length ? ` Failed units: ${failedUnits.slice(0, 5).join(', ')}` : ''));
            return;
        }
        try {
            const blob = buildXlsxBlob([{
                name: 'All units',
                rows: buildAllUnitsExportRows(blocks),
                colWidths: ALL_UNITS_COL_WIDTHS
            }]);
            triggerXlsxDownload(blob, `parameters_${plantId}_all-units_${exportTimeStamp()}.xlsx`);
            const total = blocks.reduce((sum, block) => sum + block.measurements.length + block.settings.length, 0);
            const writable = blocks.reduce((sum, block) => (
                sum + [...block.measurements, ...block.settings].filter((row) => /write/i.test(String(row[6] || ''))).length
            ), 0);
            const failNote = failedUnits.length ? `, ${failedUnits.length} unit(s) failed` : '';
            showHint(`Exported ${total} parameters from ${blocks.length} units (${writable} writable${failNote}).`);
        } catch (error) {
            console.log('[Supermarket Parameters POC] all-units export error:', error);
            alert('Could not export to Excel: ' + error.message);
        }
    }

    function buildToolbar() {
        let bar = document.getElementById('sm-poc-toolbar');
        const isPolluted = bar && (
            bar.querySelector('table, .measurements, .settings, .iwmac_table_scroll_container')
            || !bar.querySelector('.sm-poc-move-toggle')
            || !bar.querySelector('.sm-poc-zero-toggle')
            || !bar.querySelector('.sm-poc-save-btn')
            || !bar.querySelector('.sm-poc-help-btn')
            || !bar.querySelector('.sm-poc-export-btn')
        );
        if (isPolluted) {
            bar.remove();
            bar = null;
        }

        if (bar) {
            mountToolbar(bar);
            updateZeroValueUi();
            renderGfxBadge();
            return bar;
        }

        bar = document.createElement('div');
        bar.id = 'sm-poc-toolbar';

        const moveBtn = document.createElement('button');
        moveBtn.type = 'button';
        moveBtn.className = 'sm-poc-move-toggle';
        moveBtn.textContent = 'Aktiver Endrings-modus';
        moveBtn.title = 'Slå på for å velge rader og bruke batch-endringer. Slå av for vanlig høyreklikk.';
        moveBtn.addEventListener('click', () => {
            const wasMoveModeEnabled = moveModeEnabled;
            moveModeEnabled = !moveModeEnabled;
            const discarded = wasMoveModeEnabled && !moveModeEnabled ? discardPendingAttChanges() : 0;
            applyMoveMode(discarded);
        });
        bar.appendChild(moveBtn);

        const zeroBtn = document.createElement('button');
        zeroBtn.type = 'button';
        zeroBtn.className = 'sm-poc-zero-toggle';
        zeroBtn.textContent = 'Skjul 0.0';
        zeroBtn.title = 'Skjul rader der Verdi er 0 eller 0.0';
        zeroBtn.addEventListener('click', () => {
            hideZeroValuesEnabled = !hideZeroValuesEnabled;
            applyZeroValueFilterMode();
        });
        bar.appendChild(zeroBtn);

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'sm-poc-save-btn';
        saveBtn.textContent = 'Lagre';
        saveBtn.title = 'Lagre flyttede rader til database';
        saveBtn.disabled = true;
        saveBtn.addEventListener('click', savePendingAttChanges);
        bar.appendChild(saveBtn);

        const saveCount = document.createElement('span');
        saveCount.className = 'sm-poc-save-count';
        saveCount.textContent = '0 endringer';
        bar.appendChild(saveCount);

        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'sm-poc-export-btn';
        exportBtn.textContent = 'Export all units';
        exportBtn.title = 'Export EVERY unit on this plant to one Excel file (asks for confirmation first — can take several minutes). For just the open unit, use the Export unit button inside "Vis alle parameter".';
        exportBtn.addEventListener('click', exportAllUnitsToExcel);
        bar.appendChild(exportBtn);

        const helpBtn = document.createElement('button');
        helpBtn.type = 'button';
        helpBtn.className = 'sm-poc-help-btn';
        helpBtn.textContent = 'Hjelp';
        helpBtn.title = 'Vis hjelp / brukerveiledning';
        helpBtn.addEventListener('click', showHelpModal);
        bar.appendChild(helpBtn);

        mountToolbar(bar);
        updatePendingUi();
        updateZeroValueUi();
        renderGfxBadge();
        return bar;
    }

    // Fane-raden (Enheter / Alarmblokkering / Kalender ...) har ingen kjent klasse — finn via tekst, cache.
    function findLeafByText(text) {
        return Array.from(document.querySelectorAll('a, button, li, span, div'))
            .find((el) => el.children.length === 0 && (el.textContent || '').trim() === text) || null;
    }

    // Kun til KNAPPE-STIL (kosmetikk). Fane-etikettene er oversatt per språk, så finn én fane via
    // en liten liste, og den valgte fanen som søsken med annen bakgrunn — ikke via etikett-tekst.
    function getSettingsTabRefs() {
        if (settingsTabRefs?.plain?.isConnected && settingsTabRefs.selected?.isConnected) return settingsTabRefs;
        const leaf = ['Kalender', 'Calendar', 'Kalenteri'].map(findLeafByText).find(Boolean);
        const plain = leaf ? (leaf.closest('button, a, li') || leaf) : null;
        if (!plain) { settingsTabRefs = null; return null; }
        const plainBg = window.getComputedStyle(plain).backgroundColor;
        const selected = Array.from(plain.parentElement?.children || [])
            .find((el) => el !== plain && window.getComputedStyle(el).backgroundColor !== plainBg) || plain;
        settingsTabRefs = { plain, selected };
        return settingsTabRefs;
    }

    // Knappene i native fane-stil: computed style fra fane-raden (Kalender = uvalgt, Enheter = valgt/aktiv).
    // Inline-stil vinner over klasse-CSS, så kjøres på nytt etter hver aktiv-toggle.
    function styleToolbarLikeNativeTabs() {
        const bar = document.getElementById('sm-poc-toolbar');
        const refs = getSettingsTabRefs();
        if (!bar || !refs) return;
        const height = Math.round(refs.plain.getBoundingClientRect().height);
        bar.querySelectorAll('button').forEach((btn) => {
            const active = btn.classList.contains('sm-poc-active');
            const cs = window.getComputedStyle(active ? refs.selected : refs.plain);
            NATIVE_BUTTON_STYLE_PROPS.forEach((prop) => { btn.style[prop] = cs[prop]; });
            if (active && refs.selected === refs.plain) { btn.style.backgroundColor = '#333'; btn.style.color = '#fff'; }
            if (height) btn.style.height = `${height}px`;
        });
        bar.style.background = 'transparent';
        bar.style.border = '0';
        bar.style.boxShadow = 'none';
        bar.style.padding = '0';
    }

    // Verktøylinjen er body-barn (fixed), høyrestilt mot VINDUET og loddrett i fane-radens bånd.
    // Vannrett posisjon er bevisst uavhengig av fane-radens bredde: å høyrestille mot raden la
    // linjen oppå fanene når raden var smal / feil element ble funnet. Aldri inn i SPA-DOM.
    function positionToolbar() {
        const bar = document.getElementById('sm-poc-toolbar');
        if (!bar) return;
        styleToolbarLikeNativeTabs(); // stil først — påvirker bredden
        const tabRect = getSettingsTabRefs()?.plain.getBoundingClientRect();
        const rowRect = getSettingsTabRefs()?.plain.parentElement?.getBoundingClientRect();
        // høyre kant av selve fanene (ikke containeren, som er full bredde)
        const tabsRight = () => Array.from(getSettingsTabRefs()?.plain.parentElement?.children || [])
            .reduce((max, el) => Math.max(max, el.getBoundingClientRect().right), 0);
        const unitRect = getUnitSelect()?.getBoundingClientRect(); // språkuavhengig reserve-anker
        if (!tabRect?.height && !unitRect?.height) {
            bar.style.left = '';
            bar.style.top = '';
            bar.style.transform = '';
            bar.style.zIndex = '';
            return;
        }
        const barRect = bar.getBoundingClientRect();
        bar.style.transform = 'none';
        bar.style.zIndex = '1899'; // under IWMAC-modaler (1900), som enhetsportalen — ikke CSS-defaultens 2147483639
        const left = Math.max(8, Math.round(window.innerWidth - 16 - barRect.width));
        let top = tabRect?.height
            ? Math.round(tabRect.top + (tabRect.height - barRect.height) / 2)
            : Math.round(unitRect.top - barRect.height - 10); // rett over enhetsvelgeren = fane-raden
        // Smalt vindu: bare hvis SISTE FANE rekker bort til linjen, legg den under raden.
        // (Rad-containeren er full bredde — å måle den her dyttet linjen ned på alle skjermer.)
        if (tabsRight() > left - 8 && rowRect?.height) top = Math.round(rowRect.bottom + 4);
        bar.style.left = `${left}px`;
        bar.style.top = `${Math.max(4, top)}px`;
    }

    function mountToolbar(bar) {
        if (bar.parentElement !== document.body) {
            document.body.appendChild(bar);
        }
        positionToolbar();
    }

    function updatePendingUi() {
        const count = pendingAttChanges.size;
        const btn = document.querySelector('#sm-poc-toolbar .sm-poc-save-btn');
        const label = document.querySelector('#sm-poc-toolbar .sm-poc-save-count');
        if (btn) btn.disabled = count === 0;
        if (label) label.textContent = `${count} endring${count === 1 ? '' : 'er'}`;
    }

    function updateZeroValueUi() {
        const btn = document.querySelector('#sm-poc-toolbar .sm-poc-zero-toggle');
        if (!btn) return;
        btn.classList.toggle('sm-poc-active', hideZeroValuesEnabled);
        btn.setAttribute('aria-pressed', hideZeroValuesEnabled ? 'true' : 'false');
        btn.title = hideZeroValuesEnabled
            ? '0.0-rader er skjult. Klikk for å vise dem igjen.'
            : 'Skjul rader der Verdi er 0 eller 0.0';
        styleToolbarLikeNativeTabs();
    }

    function applyZeroValueFilterMode() {
        updateZeroValueUi();
        if (allParamsActive) filterAllParamsView();
        applyAllFilters();
        showHint(hideZeroValuesEnabled ? 'Skjuler rader med Verdi 0.0.' : 'Viser 0.0-rader igjen.');
    }

    function compactAliasForLookup(value) {
        return String(value || '').replace(/\s+/g, '');
    }

    function aliasBaseForElementLookup(value) {
        return String(value || '').replace(/\s*\[[\s\S]*$/, '').trim();
    }

    function collectDriverParameterRows(value, rows = []) {
        if (!value) return rows;
        if (Array.isArray(value)) {
            value.forEach((item) => collectDriverParameterRows(item, rows));
            return rows;
        }
        if (typeof value !== 'object') return rows;
        if (value.driver_id) {
            rows.push(value);
            return rows;
        }
        for (const key of ['data', 'rows', 'result', 'results']) {
            collectDriverParameterRows(value[key], rows);
        }
        return rows;
    }

    function extractDriverParameterRows(value) {
        return collectDriverParameterRows(value, []);
    }

    function findBestDriverParameterMatch(rows, change, options = {}) {
        const items = Array.isArray(rows) ? rows : [rows].filter(Boolean);
        const alias = String(change.alias_text || '').trim();
        const compactAlias = compactAliasForLookup(alias);
        const menu = String(change.menu || '').trim();

        return items.find((row) => String(row?.alias_text || '').trim() === alias && (!menu || String(row?.menu || '').trim() === menu))
            || items.find((row) => compactAliasForLookup(row?.alias_text) === compactAlias && (!menu || String(row?.menu || '').trim() === menu))
            || (options.fallbackFirst === false ? null : items[0]);
    }

    function buildDriverParameterLookupCondition(change) {
        const alias = String(change.alias_text || '').trim();
        const compactAlias = compactAliasForLookup(alias);
        const menu = String(change.menu || '').trim();
        if (!alias || !compactAlias) return null;

        const predicates = [];
        if (menu) predicates.push(`\`menu\` = '${sqlQuote(menu)}'`);

        const aliasPredicates = [
            `\`alias_text\` = '${sqlQuote(alias)}'`,
            `REPLACE(REPLACE(\`alias_text\`, ' ', ''), CHAR(160), '') = '${sqlQuote(compactAlias)}'`
        ];

        const aliasBase = aliasBaseForElementLookup(alias);
        if (aliasBase && menu) {
            aliasPredicates.push(`\`element_id\` = '${sqlQuote(`${aliasBase}_${menu}`)}'`);
        }

        predicates.push(`(${aliasPredicates.join(' OR ')})`);
        return `(${predicates.join(' AND ')})`;
    }

    async function fetchDriverParameterRowsByAliasSql(changes, plantId, unitId) {
        const conditions = changes
            .map(buildDriverParameterLookupCondition)
            .filter(Boolean);
        if (!conditions.length) return [];

        const fd = new FormData();
        fd.append('plant_id', plantId);
        fd.append('sql_command', [
            'SELECT driver_id, alias_text, menu, unit_id, element_id, plant_pri, scale, raw_min, raw_max, eng_min, eng_max, `format`, att',
            'FROM iw_plant_server3.iw_gen_driver_parameters',
            `WHERE \`unit_id\` = '${sqlQuote(unitId)}' AND (${conditions.join(' OR ')})`,
            `LIMIT ${Math.max(conditions.length * 3, 5)}`
        ].join(' '));
        fd.append('_cache_bust', Date.now());

        const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', {
            method: 'POST',
            body: fd,
            cache: 'no-cache'
        });
        const data = await response.json();
        if (!data?.success) {
            throw new Error(data?.error || 'Driver-lookup feilet');
        }
        return extractDriverParameterRows(data);
    }

    async function fetchDriverParameterDetailsByAliasSql(change, plantId, unitId) {
        const rows = await fetchDriverParameterRowsByAliasSql([change], plantId, unitId);
        return findBestDriverParameterMatch(rows, change);
    }

    async function fetchDriverParameterRowsByDriverIds(driverIds, plantId) {
        const uniqueIds = Array.from(new Set(driverIds.map((id) => String(id || '').trim()).filter(Boolean)));
        const rows = [];
        for (const chunk of chunkArray(uniqueIds, BATCH_LOOKUP_REQUEST_LIMIT)) {
            const quotedIds = chunk.map((id) => `'${sqlQuote(id)}'`).join(', ');
            const fd = new FormData();
            fd.append('plant_id', plantId);
            // p.* fields keep verifyBatchChanges semantics (compare the main
            // table); the *_effective aliases are override-aware (override
            // wins when set) for the Excel export's Access/Allowed values.
            fd.append('sql_command', [
                'SELECT p.driver_id, p.plant_pri, p.scale, p.raw_min, p.raw_max, p.eng_min, p.eng_max, p.`format`, p.att,',
                // Unit ID / Unit name / Type / Application for the Excel export
                // — the same four the Designer export shows, straight from the
                // main table (the override table carries none of them).
                'p.unit_id, p.unit_name, p.parameter_type, p.application,',
                "COALESCE(NULLIF(o.att, ''), p.att) AS att_effective,",
                "COALESCE(NULLIF(o.range_min, ''), p.range_min) AS range_min_effective,",
                "COALESCE(NULLIF(o.range_max, ''), p.range_max) AS range_max_effective,",
                "COALESCE(NULLIF(o.format_extra, ''), p.format_extra) AS format_extra_effective",
                'FROM iw_plant_server3.iw_gen_driver_parameters p',
                'LEFT JOIN iw_plant_server3.iw_gen_driver_parameters_override o ON o.driver_id = p.driver_id',
                `WHERE p.\`driver_id\` IN (${quotedIds})`,
                `LIMIT ${chunk.length}`
            ].join(' '));
            fd.append('_cache_bust', Date.now());

            const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', {
                method: 'POST',
                body: fd,
                cache: 'no-cache'
            });
            const data = await response.json();
            if (!data?.success) {
                throw new Error(data?.error || 'Driver-verifisering feilet');
            }
            rows.push(...extractDriverParameterRows(data));
        }
        return rows;
    }

    async function fetchDriverParameterDetails(change, plantId, unitId) {
        const fd = new FormData();
        fd.append('plant_id', plantId);
        fd.append('action', 'get_driver_parameter_details');
        fd.append('unit_id', unitId);
        fd.append('alias_text', change.alias_text);
        if (change.driver_id) fd.append('driver_id', change.driver_id);
        if (change.menu) fd.append('menu', change.menu);
        fd.append('_cache_bust', Date.now());

        const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', {
            method: 'POST',
            body: fd,
            cache: 'no-cache'
        });
        const data = await response.json();
        if (!data || !data.success) {
            const fallback = await fetchDriverParameterDetailsByAliasSql(change, plantId, unitId).catch(() => null);
            if (fallback?.driver_id) return fallback;
            throw new Error(data?.error || `Fant ikke parameter: ${change.alias_text}`);
        }

        const rows = extractDriverParameterRows(data);
        return findBestDriverParameterMatch(rows.length ? rows : data.data, change);
    }

    function findFirstObjectWithDriverId(value) {
        const rows = extractDriverParameterRows(value);
        if (rows.length) return rows[0];
        if (!value) return null;
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = findFirstObjectWithDriverId(item);
                if (found) return found;
            }
            return null;
        }
        if (typeof value !== 'object') return null;
        if (value.driver_id) return value;
        for (const key of ['data', 'rows', 'result', 'results']) {
            const found = findFirstObjectWithDriverId(value[key]);
            if (found) return found;
        }
        return null;
    }

    // Eksakt oppslag på driver_id (unik per parameter — ingen alias-gjetting).
    // Tar med override-raden som `override_*` slik at modalen får de blå rammene, som fra API-et.
    async function fetchDriverParameterDetailsByDriverId(driverId, plantId) {
        const overrideSelect = ['alias_text', 'plant_pri', 'eng_unit', 'format', 'format_extra', 'range_min',
            'range_max', 'scale', 'raw_min', 'raw_max', 'eng_min', 'eng_max', 'att']
            .map((field) => `o.\`${field}\` AS \`override_${field}\``).join(', ');
        const fd = new FormData();
        fd.append('plant_id', plantId);
        fd.append('sql_command', [
            `SELECT p.*, ${overrideSelect}`,
            'FROM iw_plant_server3.iw_gen_driver_parameters p',
            'LEFT JOIN iw_plant_server3.iw_gen_driver_parameters_override o ON o.`driver_id` = p.`driver_id`',
            `WHERE p.\`driver_id\` = '${sqlQuote(driverId)}'`,
            'LIMIT 1'
        ].join(' '));
        fd.append('_cache_bust', Date.now());

        const response = await fetchWithTimeout('http://toolbox.iwmac.local/oets/api/index2.php', {
            method: 'POST',
            body: fd,
            cache: 'no-cache'
        });
        const data = await response.json();
        if (!data?.success) {
            throw new Error(data?.error || `Fant ikke driver_id: ${driverId}`);
        }
        const row = findFirstObjectWithDriverId(data);
        if (!row) throw new Error(`Fant ikke driver_id: ${driverId}`);
        return row;
    }

    async function savePendingAttChanges() {
        const changes = Array.from(pendingAttChanges.values());
        if (!changes.length) {
            showHint('Ingen endringer å lagre');
            return;
        }

        const plantId = getPlantId();
        const unitId = getUnitId();
        if (!plantId || !unitId) {
            alert('Kan ikke finne plant_id eller unit_id.');
            return;
        }

        const ok = window.confirm(`Lagre ${changes.length} endring${changes.length === 1 ? '' : 'er'} til database?`);
        if (!ok) return;

        const btn = document.querySelector('#sm-poc-toolbar .sm-poc-save-btn');
        const oldText = btn?.textContent || 'Lagre';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Lagrer...';
        }

        try {
            const requests = changes.map((change, index) => ({
                data: change,
                label: change.row_text || change.alias_text || `endring ${index + 1}`
            }));
            const resolved = await resolveDriverParameterRequests(requests, plantId, unitId, 'ulagrede att-endringer');
            const failed = resolved.filter((result) => !result?.ok);
            if (failed.length) {
                const first = failed[0];
                throw new Error(`Fant ikke driver_id for ${failed.length} endring(er). Første: ${first.item?.label || first.error?.message || 'ukjent'}`);
            }

            const found = resolved.filter((result) => result?.ok);
            const sqlCommands = found.flatMap((result) => {
                return buildDriverParameterSql(result.param.driver_id, { att: result.request.data.targetAtt });
            });
            const batchResponses = await executeBatchSqlCommands(plantId, sqlCommands);
            const totalAffected = batchResponses.reduce((sum, result) => sum + Number(result?.total_affected_rows || 0), 0);

            markPendingRowsAwaitingNativeRedraw();
            pendingAttChanges.clear();
            updatePendingUi();
            requestNativeParameterRedraw(`Lagret ${changes.length} endring${changes.length === 1 ? '' : 'er'} (${totalAffected} rows affected). Oppdaterer IWMAC-listen uten side-refresh...`);
        } catch (error) {
            console.log('[Supermarket Parameters POC] Save error:', error);
            alert('Kunne ikke lagre: ' + error.message);
            updatePendingUi();
        } finally {
            if (btn) {
                btn.textContent = oldText;
                btn.disabled = pendingAttChanges.size === 0;
            }
        }
    }

    function applyMoveMode(discardedPendingCount = 0) {
        document.body.classList.toggle('sm-poc-move-mode', moveModeEnabled);
        const btn = document.querySelector('.sm-poc-move-toggle');
        if (btn) {
            btn.textContent = moveModeEnabled ? 'Endrings-modus: PÅ' : 'Aktiver Endrings-modus';
            btn.classList.toggle('sm-poc-active', moveModeEnabled);
            btn.title = moveModeEnabled
                ? 'Slå av for vanlig høyreklikk uten batch-endringer'
                : 'Slå på for å velge rader og bruke batch-endringer';
        }

        [measurementsTable, settingsTable].forEach((tbody) => {
            if (!tbody) return;
            tbody.querySelectorAll('tr').forEach((row) => {
                if (moveModeEnabled) {
                    row.setAttribute('draggable', 'true');
                } else {
                    row.removeAttribute('draggable');
                    row.classList.remove(SELECTED_CLASS, DRAGGING_CLASS);
                }
            });
        });

        document.querySelectorAll(`#${ALL_PARAMS_VIEW_ID} tbody tr`).forEach((row) => {
            if (moveModeEnabled) {
                row.setAttribute('draggable', 'true');
            } else {
                row.removeAttribute('draggable');
                row.classList.remove(SELECTED_CLASS, DRAGGING_CLASS);
            }
        });

        if (!moveModeEnabled) clearSelection();
        if (moveModeEnabled) {
            showHint('Endrings-modus: klikk, Shift+klikk område, Ctrl+Shift+A / Velg. Høyreklikk for batch-endringer.', { defaultHint: true });
        } else if (discardedPendingCount) {
            showHint(`Endrings-modus av: ${discardedPendingCount} ulagrede endring${discardedPendingCount === 1 ? '' : 'er'} forkastet.`);
        } else {
            showHint('', { defaultHint: true }); // idle: ingen fast tekst, skjul etter at handlingshint har stått sin tid
        }
        styleToolbarLikeNativeTabs();
        renderPendingVisualRows();
    }

    function clearSelection() {
        selectedRows.forEach((row) => row.classList.remove(SELECTED_CLASS));
        selectedRows.clear();
        document.querySelectorAll('.sm-poc-ghost-row').forEach((row) => row.classList.remove(SELECTED_CLASS));
    }

    function getOrderedVisibleRows(tbody) {
        return Array.from(tbody.querySelectorAll('tr')).filter(isVisibleRow);
    }

    function selectRangeInTable(tbody, fromRow, toRow, additive) {
        const visible = getOrderedVisibleRows(tbody);
        const i1 = visible.indexOf(fromRow);
        const i2 = visible.indexOf(toRow);
        if (i1 < 0 || i2 < 0) {
            toggleRowSelection(toRow, additive);
            return;
        }
        const start = Math.min(i1, i2);
        const end = Math.max(i1, i2);
        if (!additive) clearSelection();
        for (let i = start; i <= end; i++) {
            selectedRows.add(visible[i]);
            visible[i].classList.add(SELECTED_CLASS);
        }
        updateSelectionHint();
    }

    function updateSelectionHint() {
        if (!moveModeEnabled) return;
        if (!selectedRows.size) {
            showHint('Klikk / Shift+klikk område / Ctrl+klikk / Ctrl+Shift+A');
            return;
        }
        const nMeas = Array.from(selectedRows).filter((r) => rowVisualSide(r) === 'measurements').length;
        const nSet = selectedRows.size - nMeas;
        if (nMeas && nSet) {
            showHint(`${selectedRows.size} valgt — dra til motsatt side for å flytte`);
        } else if (nMeas) {
            showHint(`${nMeas} valgt — dra til Innstillinger (høyre)`);
        } else {
            showHint(`${nSet} valgt — dra til Måling (venstre)`);
        }
    }

    function toggleRowSelection(row, additive) {
        if (!additive) clearSelection();
        if (selectedRows.has(row)) {
            selectedRows.delete(row);
            row.classList.remove(SELECTED_CLASS);
        } else {
            selectedRows.add(row);
            row.classList.add(SELECTED_CLASS);
        }
        updateSelectionHint();
        renderPendingVisualRows();
    }

    function handleRowClick(row, tbody, e) {
        const key = rowTableKey(row);
        if (!key) return;
        lastActiveTableKey = key;

        if (e.shiftKey) {
            const anchor = selectionAnchor[key];
            if (anchor && anchor.isConnected && anchor.parentNode === tbody) {
                selectRangeInTable(tbody, anchor, row, e.ctrlKey || e.metaKey);
            } else {
                selectionAnchor[key] = row;
                toggleRowSelection(row, false);
            }
            return;
        }

        selectionAnchor[key] = row;
        if (e.ctrlKey || e.metaKey) {
            toggleRowSelection(row, true);
            return;
        }
        toggleRowSelection(row, false);
    }

    function selectVisibleInTable(tbody) {
        if (!tbody?.isConnected) return;
        const visible = getVisibleRows(tbody);
        if (!visible.length) {
            showHint('Ingen synlige rader å velge');
            return;
        }
        clearSelection();
        visible.forEach((row) => {
            selectedRows.add(row);
            row.classList.add(SELECTED_CLASS);
        });
        const side = tbody === measurementsTable ? 'Måling' : 'Innstillinger';
        const key = tbody === measurementsTable ? 'measurements' : 'settings';
        if (visible.length) selectionAnchor[key] = visible[0];
        showHint(`${visible.length} synlige valgt i ${side} — dra til motsatt tabell`);
        updateSelectionHint();
    }

    function bindSelectionOnTable(tbody) {
        if (!tbody || tbody.dataset.smPocSelectZone === '1') return;
        tbody.dataset.smPocSelectZone = '1';
        tbody.addEventListener('click', (e) => {
            if (!moveModeEnabled) return;
            if (e.target.closest('input, button, a')) return;
            const row = e.target.closest('tr');
            if (!row || row.parentNode !== tbody) return;
            if (!isVisibleRow(row)) return;
            e.preventDefault();
            handleRowClick(row, tbody, e);
            e.stopImmediatePropagation();
        }, true);
    }

    function bindKeyboardShortcuts() {
        if (window.__SM_POC_KEYS) return;
        window.__SM_POC_KEYS = true;

        document.addEventListener('keydown', (e) => {
            if (!isSettingsPage()) return;
            if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;

            if (document.querySelector('.sm-poc-batch-modal')) return;
            const combo = document.getElementById(UNIT_PORTAL_ID)?.querySelector(`.${UNIT_COMBO_CLASS}`);
            const comboOpen = combo?.classList.contains('sm-poc-unit-opened');

            if (!comboOpen && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                navigateNativeUnit(e.key === 'ArrowUp' ? -1 : 1);
                return;
            }

            if (!moveModeEnabled) return;

            if (e.key === 'Escape') {
                clearSelection();
                showHint('Markering tømt');
                e.preventDefault();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                const tbody = getTbodyForKey(lastActiveTableKey);
                if (tbody?.isConnected) {
                    selectVisibleInTable(tbody);
                }
            }
        });
    }

    function tableHasRow(tbody, name, exceptRow) {
        return Array.from(tbody.querySelectorAll('tr')).some((r) => r !== exceptRow && rowKey(r) === name);
    }

    function clearDropIndicator() {
        if (dropIndicatorRow) dropIndicatorRow.classList.remove(DROP_BEFORE_CLASS);
        dropIndicatorRow = null;
        dropInsertBefore = null;
    }

    function updateDropPosition(e, targetTbody) {
        clearDropIndicator();
        const tr = e.target.closest('tr');
        if (tr && tr.parentNode === targetTbody) {
            dropInsertBefore = tr;
            dropIndicatorRow = tr;
            tr.classList.add(DROP_BEFORE_CLASS);
        } else {
            dropInsertBefore = null;
        }
    }

    function moveRowsToSettings(rows) {
        const ordered = rowsInDomOrder(rows, measurementsTable);
        let moved = 0;
        let skipped = 0;

        ordered.forEach((sourceRow) => {
            if (rowVisualSide(sourceRow) !== 'measurements') return;
            const name = rowKey(sourceRow);
            if (!name || tableHasRow(settingsTable, name, sourceRow)) {
                skipped++;
                return;
            }

            registerPendingAttChange(sourceRow, 'settings', sourceRow);
            markRowWouldMoveTo(sourceRow, settingsTable);
            updateRowVisualMoveState(sourceRow, 'settings');
            moved++;
        });

        if (moved) {
            showHint(`${moved} rad(er) merket for Innstillinger (lagre for å skrive rw)`);
        } else if (skipped) {
            showHint('Ingen flyttet — finnes allerede i Innstillinger?');
        }
        return moved;
    }

    function moveRowsToMeasurements(rows) {
        const ordered = rowsInDomOrder(rows, settingsTable);
        let moved = 0;
        let skipped = 0;

        ordered.forEach((sourceRow) => {
            if (rowVisualSide(sourceRow) !== 'settings') return;
            const name = rowKey(sourceRow);
            if (!name || tableHasRow(measurementsTable, name, sourceRow)) {
                skipped++;
                return;
            }

            registerPendingAttChange(sourceRow, 'measurements', sourceRow);
            markRowWouldMoveTo(sourceRow, measurementsTable);
            updateRowVisualMoveState(sourceRow, 'measurements');
            moved++;
        });

        if (moved) {
            showHint(`${moved} rad(er) merket for Måling (lagre for å skrive r)`);
        } else if (skipped) {
            showHint('Ingen flyttet — finnes allerede i Måling?');
        }
        return moved;
    }

    function getRowsToDrag(primaryRow) {
        const tbody = primaryRow.parentNode;
        if (selectedRows.size > 0 && selectedRows.has(primaryRow)) {
            const sameTable = Array.from(selectedRows).filter((r) => r.parentNode === tbody);
            if (sameTable.length) return sameTable;
        }
        return [primaryRow];
    }

    function bindDragOnTable(tbody) {
        if (!tbody || tbody.dataset.smPocDragZone === '1') return;
        tbody.dataset.smPocDragZone = '1';

        tbody.addEventListener('dragstart', (e) => {
            if (!moveModeEnabled) {
                e.preventDefault();
                return;
            }
            const row = e.target.closest('tr');
            if (!row || row.parentNode !== tbody) return;
            draggingRows = getRowsToDrag(row);
            draggingFromSide = rowVisualSide(row);
            draggingRows.forEach((r) => r.classList.add(DRAGGING_CLASS));
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggingFromSide || 'sm-poc-move');
        });

        tbody.addEventListener('dragend', () => {
            draggingRows.forEach((r) => r.classList.remove(DRAGGING_CLASS));
            draggingRows = [];
            draggingFromSide = null;
            clearDropIndicator();
            document.querySelectorAll(`.${DROP_TARGET_CLASS}`).forEach((el) => {
                el.classList.remove(DROP_TARGET_CLASS);
            });
        });
    }

    function bindDropZone(targetKey, acceptFrom, moveFn) {
        const targetTbody = getTbodyForKey(targetKey);
        const dropContainer = targetTbody?.closest('.iwmac_table_scroll_table_container') || targetTbody;
        const bindKey = acceptFrom === 'measurements' ? 'smPocDropMeasurements' : 'smPocDropSettings';
        if (!dropContainer || dropContainer.dataset[bindKey] === '1') return;
        dropContainer.dataset[bindKey] = '1';

        const onDragOver = (e) => {
            if (!moveModeEnabled) return;
            const from = draggingFromSide || (draggingRows[0] ? rowVisualSide(draggingRows[0]) : null);
            if (from !== acceptFrom) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            dropContainer.classList.add(DROP_TARGET_CLASS);
            updateDropPosition(e, getTbodyForKey(targetKey));
        };

        dropContainer.addEventListener('dragover', onDragOver);

        dropContainer.addEventListener('dragleave', (e) => {
            if (!dropContainer.contains(e.relatedTarget)) {
                dropContainer.classList.remove(DROP_TARGET_CLASS);
                clearDropIndicator();
            }
        });

        const onDrop = (e) => {
            if (!moveModeEnabled) return;
            const from = draggingFromSide || (draggingRows[0] ? rowVisualSide(draggingRows[0]) : null);
            if (from !== acceptFrom) return;
            e.preventDefault();
            e.stopPropagation();
            dropContainer.classList.remove(DROP_TARGET_CLASS);
            clearDropIndicator();

            const rows = draggingRows.length
                ? draggingRows
                : Array.from(selectedRows).filter((r) => rowVisualSide(r) === acceptFrom);
            if (!rows.length) {
                showHint(acceptFrom === 'measurements'
                    ? 'Velg rader i Måling (Ctrl+klikk) eller dra fra Innstillinger'
                    : 'Velg rader i Innstillinger eller dra fra Måling');
                return;
            }

            moveFn(rows);
            clearSelection();
            applyMoveMode();
            applyAllFilters();
            draggingFromSide = null;
        };

        dropContainer.addEventListener('drop', onDrop);
    }

    // Gjenkjenn IWMACs høyreklikkmeny på STRUKTUR, ikke tekst: en tidligere tekst-test på norske
    // menypunkter ("Legg til parameter...") traff aldri på svensk UI ("Lägg till parameter..."),
    // og da ble ingen menypunkter lagt til i det hele tatt.
    function getPotentialContextMenus() {
        const candidates = Array.from(document.querySelectorAll('body div')).filter((el) => {
            const computed = window.getComputedStyle(el);
            if (computed.position !== 'fixed') return false;
            const zIndex = parseInt(computed.zIndex, 10);
            if (!Number.isFinite(zIndex) || zIndex < 2147483000) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 120 || rect.height < 40) return false;
            // Menypunktene er div-er med inline position:relative — samme kjennetegn som injiseringen bruker
            if (!el.querySelector('div[style*="position: relative"]')) return false;
            return !isPocNode(el);
        });
        // Ved nøstede treff: behold den innerste (unngå å legge punkter i en wrapper)
        return candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
    }

    function closeNativeContextMenu() {
        document.body.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: 0,
            clientY: 0
        }));
    }

    function createBatchContextMenuItem(templateItem, label, action) {
        const item = templateItem.cloneNode(true);
        item.dataset.smPocBatchMenu = '1';
        item.classList.add('sm-poc-context-batch-item');
        item.style.backgroundColor = 'transparent';
        item.style.cursor = 'pointer';
        const text = item.querySelector('div');
        if (text) text.textContent = label;
        item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeNativeContextMenu();
            action();
        });
        return item;
    }

    function addBatchContextMenuItems(contextMenu) {
        if (!moveModeEnabled || contextMenu.dataset.smPocBatchMenuBound === '1') return;
        const items = Array.from(contextMenu.querySelectorAll('div[style*="position: relative"]'));
        if (!items.length) return;

        const templateItem = items[items.length - 1];
        const separator = contextMenu.querySelector('hr')?.cloneNode(true) || document.createElement('hr');
        separator.dataset.smPocBatchHr = '1';
        if (!separator.getAttribute('style')) {
            separator.style.cssText = 'border-bottom: 1px solid rgb(204, 204, 204); border-top: none; margin: 6px 0px;';
        }

        const markedCount = getMarkedParameterRequests().length;
        const plantPriItem = createBatchContextMenuItem(templateItem, 'Change Plant pri for marked', () => {
            if (!markedCount) {
                showHint('Marker parametere i Endrings-modus først.');
                return;
            }
            openPlantPriBatchModal();
        });
        const scaleItem = createBatchContextMenuItem(templateItem, 'Scale all marked', () => {
            if (!markedCount) {
                showHint('Marker parametere i Endrings-modus først.');
                return;
            }
            openScaleMarkedModal();
        });

        const markerItem = items.find((item) => (item.textContent || '').includes('Get Driver Parameter Details'));
        if (markerItem?.parentNode === contextMenu) {
            markerItem.insertAdjacentElement('afterend', scaleItem);
            markerItem.insertAdjacentElement('afterend', plantPriItem);
            markerItem.insertAdjacentElement('afterend', separator);
        } else {
            contextMenu.appendChild(separator);
            contextMenu.appendChild(plantPriItem);
            contextMenu.appendChild(scaleItem);
        }

        contextMenu.dataset.smPocBatchMenuBound = '1';
        nudgeContextMenuIntoView(contextMenu);
    }

    function nudgeContextMenuIntoView(contextMenu) {
        setTimeout(() => {
            const rect = contextMenu.getBoundingClientRect();
            if (rect.bottom > window.innerHeight) {
                const currentTop = parseInt(contextMenu.style.top, 10) || rect.top;
                contextMenu.style.top = `${Math.max(10, currentTop - (rect.bottom - window.innerHeight) - 10)}px`;
            }
        }, 0);
    }

    // Settings-punkter i IWMACs native høyreklikkmeny (merget fra Supermarket-Settings):
    // Highlight used_in_graphics + Get Driver Parameter Details. Hopper over hvis et annet skript alt har lagt dem til.
    function addSettingsContextMenuItems(contextMenu) {
        if (contextMenu.dataset.smPocSettingsMenuBound === '1') return;
        const items = Array.from(contextMenu.querySelectorAll('div[style*="position: relative"]'));
        if (!items.length) return;
        contextMenu.dataset.smPocSettingsMenuBound = '1';
        if (/Highlight used_in_graphics|Get Driver Parameter Details/.test(contextMenu.textContent || '')) return;

        const templateItem = items[items.length - 1];
        const separator = contextMenu.querySelector('hr')?.cloneNode(true) || document.createElement('hr');
        separator.dataset.smPocSettingsHr = '1';
        if (!separator.getAttribute('style')) {
            separator.style.cssText = 'border-bottom: 1px solid rgb(204, 204, 204); border-top: none; margin: 6px 0px;';
        }
        const highlightItem = createBatchContextMenuItem(templateItem, 'Highlight used_in_graphics',
            () => highlightUsedInGraphicsFromAllParams());
        const detailsItem = createBatchContextMenuItem(templateItem, 'Get Driver Parameter Details', () => {
            if (!lastNativeContextRow?.isConnected) {
                showHint('Ingen rad valgt. Høyreklikk på en rad først.');
                return;
            }
            openAllParamsDriverDetails(lastNativeContextRow);
        });
        if (contextMenu.lastElementChild?.tagName !== 'HR') contextMenu.appendChild(separator);
        contextMenu.appendChild(highlightItem);
        contextMenu.appendChild(detailsItem);
        nudgeContextMenuIntoView(contextMenu);
    }

    function augmentNativeContextMenus() {
        if (!isSettingsPage()) return;
        getPotentialContextMenus().forEach((menu) => {
            addSettingsContextMenuItems(menu);
            if (moveModeEnabled) addBatchContextMenuItems(menu);
        });
    }

    function scheduleBatchContextMenuAugment() {
        if (!isSettingsPage()) return;
        [40, 120, 260, 500].forEach((delay) => {
            setTimeout(augmentNativeContextMenus, delay);
        });
    }

    function initPoc() {
        refreshPoc();
        if (!measurementsTable?.isConnected) return false;
        console.log('[Supermarket Parameters POC] v3.5 Init OK', computeContentSignature());
        return true;
    }

    function isPocNode(node) {
        if (!node || node.nodeType !== 1) return true;
        return !!(node.id === 'sm-poc-toolbar'
            || node.id === FILTER_PORTAL_ID
            || node.id === GHOST_PORTAL_ID
            || node.id === UNIT_PORTAL_ID
            || node.id === ALL_PARAMS_PORTAL_ID
            || node.id === ALL_PARAMS_BUTTON_ID
            || node.id === ALL_PARAMS_VIEW_ID
            || node.classList?.contains('sm-poc-pane-filters')
            || node.classList?.contains('sm-poc-ghost-host')
            || node.classList?.contains('sm-poc-ghost-row')
            || node.classList?.contains('sm-poc-all-params-view')
            || node.classList?.contains('sm-poc-all-context')
            || node.classList?.contains('sm-poc-filter-grid')
            || node.classList?.contains('sm-poc-col-filter')
            || node.classList?.contains(UNIT_COMBO_CLASS)
            || node.classList?.contains('sm-poc-unit-panel')
            || node.classList?.contains('sm-poc-unit-list')
            || node.classList?.contains('sm-poc-unit-option')
            || node.classList?.contains('sm-poc-context-batch-item')
            || node.classList?.contains('sm-poc-batch-modal')
            || node.classList?.contains('sm-poc-batch-box')
            || node.classList?.contains('sm-poc-scale-modal')
            || node.classList?.contains('sm-poc-header-filter-wrap')
            || node.classList?.contains('sm-poc-hint')
            || node.dataset?.smPocBatchMenu === '1'
            || node.dataset?.smPocBatchHr === '1'
            || node.dataset?.smPocAllParamsButton === '1'
            || node.dataset?.smPocAllParam === '1'
            || node.closest?.(`#sm-poc-toolbar, #${FILTER_PORTAL_ID}, #${GHOST_PORTAL_ID}, #${UNIT_PORTAL_ID}, #${ALL_PARAMS_PORTAL_ID}, #${ALL_PARAMS_VIEW_ID}, .${UNIT_COMBO_CLASS}, .sm-poc-pane-filters, .sm-poc-ghost-host, .sm-poc-header-filter-wrap, .sm-poc-batch-modal, .sm-poc-context-batch-item, .sm-poc-all-context`));
    }

    function refreshPoc() {
        if (!isSettingsPage()) {
            sleepPoc();
            return;
        }
        pocAsleep = false;
        installGlobalCompatibilityGuards();
        const found = findTables();
        if (!found) return;

        const sig = computeContentSignature();
        const tablesChanged = sig !== lastContentSignature
            || !measurementsTable?.isConnected
            || !settingsTable?.isConnected;

        if (tablesChanged && lastContentSignature) {
            persistFiltersFromDom();
        }

        if (tablesChanged) {
            delete found.root.dataset.smPocBound;
        }

        lastContentSignature = sig;
        measurementsTable = found.measurements;
        settingsTable = found.settings;

        injectStyles();
        restoreSplitHeaderFilters(found.root);
        buildToolbar();
        ensureSearchableUnitDropdown();
        ensureAllParamsButton();
        // SPA byttet ut native rader -> legg highlight/panel-tags på igjen
        if (tablesChanged && gfxStateIsCurrent()) applyGfxStateToAllRows();

        if (allParamsActive) {
            removePaneFilters();
            clearGhostRows();
            setNativeParameterPanesHidden(true);
            if (!allParamsBusy && allParamsData?.unitId && allParamsData.unitId !== getUnitId()) {
                activateAllParamsView(false);
            } else if (document.getElementById(ALL_PARAMS_VIEW_ID)) {
                // Livsoppdateringer trigget reinit flere ganger i sekundet —
                // re-render av hele tabellene nuller scroll og thrasher layout.
                // Reposisjonering er nok når viewet allerede finnes.
                positionAllParamsView();
            } else {
                renderAllParamsView();
            }
        } else {
            setNativeParameterPanesHidden(false);
            ensureHeaderFilters('measurements');
            ensureHeaderFilters('settings');
        }

        if (tablesChanged || !found.root.dataset.smPocBound) {
            found.root.dataset.smPocBound = '1';
            delete measurementsTable.dataset.smPocSelectZone;
            delete settingsTable.dataset.smPocSelectZone;
            delete measurementsTable.dataset.smPocDragZone;
            delete settingsTable.dataset.smPocDragZone;
            bindSelectionOnTable(measurementsTable);
            bindSelectionOnTable(settingsTable);
            bindDragOnTable(measurementsTable);
            bindDragOnTable(settingsTable);
            bindDropZone('settings', 'measurements', moveRowsToSettings);
            bindDropZone('measurements', 'settings', moveRowsToMeasurements);
        }

        applyMoveMode();
    }

    function scheduleReinit() {
        clearTimeout(reinitTimer);
        reinitTimer = setTimeout(refreshPoc, 250);
    }

    function startContentWatcher() {
        bindKeyboardShortcuts();
        if (window.__SM_POC_WATCHER_VERSION === SCRIPT_VERSION) return;
        window.__SM_POC_OBSERVER?.disconnect?.();
        window.__SM_POC_EVENT_ABORT?.abort?.();
        window.__SM_POC_WATCHER = true;
        window.__SM_POC_WATCHER_VERSION = SCRIPT_VERSION;
        const eventController = new AbortController();
        window.__SM_POC_EVENT_ABORT = eventController;
        const eventOptions = { signal: eventController.signal };

        let quickRestoreTick = false;
        const quickOverlayRestore = () => {
            if (quickRestoreTick) return;
            quickRestoreTick = true;
            requestAnimationFrame(() => {
                quickRestoreTick = false;
                if (!isSettingsPage()) {
                    // SPA-navigasjon via pushState kan la overlays henge før en
                    // mutasjon til slutt trigget reinit — rydd opp umiddelbart.
                    sleepPoc();
                    return;
                }
                if (allParamsActive) return;
                const found = findTables();
                if (!found) return;
                // Reposisjoner mot ferske tbodies uten å røre globalene —
                // reinit-løpet eier rebinding/signatur-sammenligning.
                positionFilterHost(getFilterRootForKey('measurements'), found.measurements);
                positionFilterHost(getFilterRootForKey('settings'), found.settings);
            });
        };

        let floatyTick = false;
        const scanFloatyboxesThrottled = () => {
            if (floatyTick) return;
            floatyTick = true;
            requestAnimationFrame(() => { floatyTick = false; scanGraphicsFloatyboxes(); });
        };

        const obs = new MutationObserver((mutations) => {
            scanFloatyboxesThrottled(); // også utenfor innstillinger (grafikk-visningen)
            if (Date.now() < suppressObserverUntil) return;
            const onlyPoc = mutations.every((m) => {
                const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
                return nodes.length === 0 || nodes.every((n) => isPocNode(n));
            });
            if (!onlyPoc) {
                scheduleReinit();
                // SPA-omtegning kan bytte ut tabell-containeren (padding-top under
                // filterfeltene forsvinner) — gjenopprett plassen alt neste frame,
                // ellers ligger de første radene "avkuttet" under filterfeltene
                // til reinit-debouncen (250 ms) har kjørt.
                quickOverlayRestore();
            }
        });
        window.__SM_POC_OBSERVER = obs;
        const watchRoot = () => {
            // attributes/class: grafikk-boksen (.graphics_floatybox) vises ved at klassen
            // graphics_visible settes - uten dette fyrer observeren aldri på grafikk-siden.
            // Attributt-mutasjoner har tomme addedNodes/removedNodes, så onlyPoc-testen under
            // gir true og de utløser ingen ekstra reinit.
            obs.observe(document.body, {
                childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
            });
        };
        watchRoot();

        // IWMAC navigerer med history.pushState/replaceState, som ikke utløser
        // hashchange/popstate. Wrap dem én gang slik at vi får en hendelse uansett.
        ['pushState', 'replaceState'].forEach((method) => {
            const original = history[method];
            if (typeof original === 'function' && !original.__smPocWrapped) {
                const wrapped = function (...args) {
                    const result = original.apply(this, args);
                    window.dispatchEvent(new Event('sm-poc-locationchange'));
                    return result;
                };
                wrapped.__smPocWrapped = true;
                history[method] = wrapped;
            }
        });

        const onRouteChange = () => {
            runGraphicsFlashIfRequested(); // også på grafikk-siden, der resten sover
            scanGraphicsFloatyboxes();
            if (!isSettingsPage()) {
                sleepPoc();
                return;
            }
            lastContentSignature = '';
            refreshPoc();
            scheduleReinit();
        };
        window.addEventListener('hashchange', onRouteChange, eventOptions);
        window.addEventListener('popstate', onRouteChange, eventOptions);
        window.addEventListener('sm-poc-locationchange', onRouteChange, eventOptions);

        let layoutTick = false;
        const throttledPositionAllFilterHosts = () => {
            if (layoutTick) return;
            layoutTick = true;
            requestAnimationFrame(() => {
                positionAllFilterHosts();
                layoutTick = false;
            });
        };
        window.addEventListener('resize', throttledPositionAllFilterHosts, eventOptions);
        document.addEventListener('scroll', throttledPositionAllFilterHosts, { capture: true, signal: eventController.signal });
        const deactivateAllParamsOnNativeGroupIntent = (event) => {
            if (!allParamsActive) return;
            const nativeGroup = event.target.closest('div.groups button, div.groups .group');
            if (!nativeGroup || nativeGroup.id === ALL_PARAMS_BUTTON_ID) return;
            deactivateAllParamsView();
        };
        document.addEventListener('pointerdown', deactivateAllParamsOnNativeGroupIntent, { capture: true, signal: eventController.signal });
        document.addEventListener('mousedown', deactivateAllParamsOnNativeGroupIntent, { capture: true, signal: eventController.signal });
        document.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('div.parameters tbody tr');
            lastNativeContextRow = row || null;
            if (row && rowTableKey(row)) lastActiveTableKey = rowTableKey(row);
            scheduleBatchContextMenuAugment();
        }, { capture: true, signal: eventController.signal });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.sm-poc-all-context')) closeAllParamsContextMenu();
            document.querySelectorAll(`.${UNIT_COMBO_CLASS}.sm-poc-unit-opened`).forEach((combo) => {
                if (!combo.contains(e.target)) setUnitComboOpen(combo, false);
            });
            if (e.target.closest(`#${ALL_PARAMS_VIEW_ID}`)) return;
            const nativeGroup = e.target.closest('div.groups button, div.groups .group');
            if (nativeGroup && nativeGroup.id !== ALL_PARAMS_BUTTON_ID && allParamsActive) {
                deactivateAllParamsView();
            }
            if (e.target.closest(`#sm-poc-toolbar, .sm-poc-pane-filters, .${UNIT_COMBO_CLASS}`)) return;
            if (e.target.closest('div.parameters button, div.parameters a, div.parameters .btn')) {
                scheduleReinit();
            }
        }, { capture: true, signal: eventController.signal });
    }

    startContentWatcher();
    runGraphicsFlashIfRequested(); // etter full sidelasting fra en panel-lenke
    scanGraphicsFloatyboxes();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleReinit);
    } else {
        scheduleReinit();
    }

    console.log('[Supermarket Superuser] v3.5 lastet');
})();