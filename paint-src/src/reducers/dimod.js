import {setCurrentBrushOption, setCurrentMirrorLines, setCurrentMirrorEnabled, setCurrentMirrorRadial} from '../dimod/core';
import {
    WandMatches,
    SelectStyles,
    setCurrentSelectStyle,
    setCurrentWandTolerance,
    setCurrentWandMatch,
    describeSymbols,
    setGridSnapOption
} from '../dimod/items';
import {
    getCurrentPaletteName,
    getCurrentPaletteId,
    listPalettes,
    persistCurrentPalette,
    getSwatches,
    isPaletteLocked,
    addSwatch,
    removeSwatch,
    moveSwatch,
    clearSwatches,
    setSwatches,
    setPaletteLocked
} from '../dimod/store';
import {setBoundless} from '../helper/view';
const SET_BRUSH_OPTION = 'scratch-paint/dimod-brush/SET_BRUSH_OPTION';
const BrushPresets = {
    ROUND: 'ROUND',
    SQUARE: 'SQUARE',
    CALLIGRAPHY: 'CALLIGRAPHY',
    MARKER: 'MARKER',
    SPRAY: 'SPRAY',
    PIXEL: 'PIXEL'
};
const initialState$6 = {
    preset: BrushPresets.ROUND,
    bitPreset: BrushPresets.ROUND,
    pressure: false,
    taper: 0,
    gradientDither: false,
    fillTolerance: 0,
    effectSize: 2,
    sprayDensity: 30,
    lineProfile: 'UNIFORM',
    lineStyle: null,
    lassoSmoothing: 2
};
const reducer$6 = function (state, action) {
    if (typeof state === 'undefined') state = initialState$6;
    switch (action.type) {
    case SET_BRUSH_OPTION:
        if (!(action.key in initialState$6)) return state;
        return {...state, [action.key]: action.value};
    default:
        return state;
    }
};
const setBrushOption = function (key, value) { setCurrentBrushOption(key, value); return {type: SET_BRUSH_OPTION, key, value}; };
const SET_MIRROR_LINES = 'scratch-paint/dimod-mirror/SET_MIRROR_LINES';
const SET_MIRROR_ENABLED = 'scratch-paint/dimod-mirror/SET_MIRROR_ENABLED';
const SELECT_MIRROR_LINE = 'scratch-paint/dimod-mirror/SELECT_MIRROR_LINE';
const SET_MIRROR_RADIAL = 'scratch-paint/dimod-mirror/SET_MIRROR_RADIAL';
const initialState$5 = {enabled: true, lines: [], selected: -1, radial: {n: 1, x: 0, y: 0}};
const reducer$5 = function (state, action) {
    if (typeof state === 'undefined') state = initialState$5;
    switch (action.type) {
    case SET_MIRROR_LINES:
        return {...state, lines: action.lines, selected: state.selected < action.lines.length ? state.selected : -1};
    case SET_MIRROR_ENABLED:
        return {...state, enabled: action.enabled};
    case SELECT_MIRROR_LINE:
        return {...state, selected: action.index};
    case SET_MIRROR_RADIAL:
        return {...state, radial: action.radial};
    default:
        return state;
    }
};
const setMirrorLines = function (lines) {
    const clean = (Array.isArray(lines) ? lines : []).map(line => ({
        x: Number(line.x),
        y: Number(line.y),
        angle: ((Number(line.angle) % 180) + 180) % 180
    }));
    setCurrentMirrorLines(clean);
    return {type: SET_MIRROR_LINES, lines: clean};
};
const setMirrorEnabled = function (enabled) {
    setCurrentMirrorEnabled(enabled);
    return {type: SET_MIRROR_ENABLED, enabled: Boolean(enabled)};
};
const selectMirrorLine = function (index) { return {type: SELECT_MIRROR_LINE, index}; };
const setMirrorRadial = function (radial) {
    setCurrentMirrorRadial(radial);
    const clean = {
        n: Math.max(1, Math.min(36, Math.round(Number(radial && radial.n) || 1))),
        x: Number(radial && radial.x) || 0,
        y: Number(radial && radial.y) || 0
    };
    return {type: SET_MIRROR_RADIAL, radial: clean};
};
const SET_PANEL = 'scratch-paint/dimod-panels/SET_PANEL';
const Panels = {LAYERS: 'LAYERS', HISTORY: 'HISTORY', COMPOSITION: 'COMPOSITION'};
const initialState$4 = {open: null};
const reducer$4 = function (state, action) {
    if (typeof state === 'undefined') state = initialState$4;
    switch (action.type) {
    case SET_PANEL:
        return {open: Panels[action.panel] ? action.panel : null};
    default:
        return state;
    }
};
const setPanel = function (panel) { return {type: SET_PANEL, panel}; };
const SET_SELECT_STYLE = 'scratch-paint/dimod-select-style/SET_SELECT_STYLE';
const SET_WAND_TOLERANCE = 'scratch-paint/dimod-select-style/SET_WAND_TOLERANCE';
const SET_WAND_MATCH = 'scratch-paint/dimod-select-style/SET_WAND_MATCH';
const initialState$3 = {style: SelectStyles.BOX, tolerance: 32, match: WandMatches.FILL};
const reducer$3 = function (state, action) {
    if (typeof state === 'undefined') state = initialState$3;
    switch (action.type) {
    case SET_SELECT_STYLE:
        return {...state, style: action.style};
    case SET_WAND_TOLERANCE:
        return {...state, tolerance: action.tolerance};
    case SET_WAND_MATCH:
        return {...state, match: action.match};
    default:
        return state;
    }
};
const setSelectStyle = function (style) {
    setCurrentSelectStyle(style);
    return {type: SET_SELECT_STYLE, style: SelectStyles[style] ? style : SelectStyles.BOX};
};
const setWandTolerance = function (tolerance) {
    const clamped = Math.max(0, Math.min(255, Math.round(Number(tolerance) || 0)));
    setCurrentWandTolerance(clamped);
    return {type: SET_WAND_TOLERANCE, tolerance: clamped};
};
const setWandMatch = function (match) {
    setCurrentWandMatch(match);
    return {type: SET_WAND_MATCH, match: WandMatches[match] ? match : WandMatches.FILL};
};
const SET_SWATCHES = 'scratch-paint/dimod-swatches/SET_SWATCHES';
const SET_LOCK = 'scratch-paint/dimod-swatches/SET_LOCK';
const SET_PALETTES = 'scratch-paint/dimod-swatches/SET_PALETTES';
const SET_DIALOG = 'scratch-paint/dimod-swatches/SET_DIALOG';
const initialState$2 = {entries: [], lock: false, palettes: [], paletteId: null, paletteName: null, dialog: null};
const _paletteFields = function (action) {
    if (!action.palettes) return {};
    return {palettes: action.palettes, paletteId: action.paletteId, paletteName: action.paletteName};
};
const reducer$2 = function (state, action) {
    if (typeof state === 'undefined') state = initialState$2;
    switch (action.type) {
    case SET_SWATCHES:
        return Object.assign({}, state, {entries: action.entries}, _paletteFields(action));
    case SET_LOCK:
        return Object.assign({}, state, {lock: action.lock}, _paletteFields(action));
    case SET_PALETTES:
        return Object.assign({}, state, _paletteFields(action));
    case SET_DIALOG:
        return Object.assign({}, state, {dialog: action.dialog});
    default:
        return state;
    }
};
const _palettePayload = function () {
    return {
        palettes: listPalettes().map(palette => ({
            id: palette.id,
            name: palette.name,
            entries: palette.entries,
            updated: palette.updated
        })),
        paletteId: getCurrentPaletteId(),
        paletteName: getCurrentPaletteName()
    };
};
const syncSwatches = function () { return Object.assign({type: SET_SWATCHES, entries: getSwatches()}, _palettePayload()); };
const syncPalettes = function () { return Object.assign({type: SET_PALETTES}, _palettePayload()); };
const setPaletteDialog = function (dialog) { return {type: SET_DIALOG, dialog: dialog || null}; };
const syncSwatchLock = function () { return Object.assign({type: SET_LOCK, lock: isPaletteLocked()}, _palettePayload()); };
const _afterSwatchChange = function () { persistCurrentPalette(); return syncSwatches(); };
const addSwatchColor = function (style) { addSwatch(style); return _afterSwatchChange(); };
const removeSwatchColor = function (style) { removeSwatch(style); return _afterSwatchChange(); };
const moveSwatchColor = function (from, to) { moveSwatch(from, to); return _afterSwatchChange(); };
const clearSwatchColors = function () { clearSwatches(); return _afterSwatchChange(); };
const replaceSwatchColors = function (values) { setSwatches(values); return _afterSwatchChange(); };
const setSwatchLock = function (lock) { setPaletteLocked(lock); persistCurrentPalette(); return syncSwatchLock(); };
const SET_SYMBOLS = 'scratch-paint/dimod-symbols/SET_SYMBOLS';
const SELECT_SYMBOL = 'scratch-paint/dimod-symbols/SELECT_SYMBOL';
const SET_PICKER_OPEN = 'scratch-paint/dimod-symbols/SET_PICKER_OPEN';
const initialState$1 = {symbols: [], selected: null, pickerOpen: false, version: 0};
const reducer$1 = function (state, action) {
    if (typeof state === 'undefined') state = initialState$1;
    switch (action.type) {
    case SET_SYMBOLS: {
        const selected = action.symbols.some(symbol => symbol.id === state.selected) ?
            state.selected :
            (action.symbols.length ? action.symbols[0].id : null);
        return Object.assign({}, state, {symbols: action.symbols, selected, version: state.version + 1});
    }
    case SELECT_SYMBOL:
        return Object.assign({}, state, {selected: action.symbolId});
    case SET_PICKER_OPEN:
        return Object.assign({}, state, {pickerOpen: action.open});
    default:
        return state;
    }
};
const syncSymbols = function () { return {type: SET_SYMBOLS, symbols: describeSymbols()}; };
const selectSymbol = function (symbolId) { return {type: SELECT_SYMBOL, symbolId}; };
const setSymbolPickerOpen = function (open) { return {type: SET_PICKER_OPEN, open: Boolean(open)}; };
const SET_VIEW_OPTION = 'scratch-paint/dimod-view/SET_VIEW_OPTION';
const GRID_SIZES = [4, 8, 16, 32, 64];
const initialState = {grid: false, gridSize: 16, snap: true, rulers: false, boundless: false, gridAddon: false};
const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_VIEW_OPTION:
        if (!(action.key in initialState)) return state;
        return {...state, [action.key]: action.value};
    default:
        return state;
    }
};
const setViewOption = function (key, value) {
    setGridSnapOption(key, value);
    if (key === 'boundless') setBoundless(value);
    return {type: SET_VIEW_OPTION, key, value};
};
export {BrushPresets, GRID_SIZES, Panels, SELECT_SYMBOL, SET_DIALOG, SET_LOCK, SET_PALETTES, SET_PICKER_OPEN, SET_SWATCHES, SET_SYMBOLS, addSwatchColor, clearSwatchColors, reducer$5 as mirrorDefault, moveSwatchColor, reducer$4 as panelsDefault, reducer$6 as reducer, removeSwatchColor, replaceSwatchColors, selectMirrorLine, reducer$3 as selectStyleDefault, selectSymbol, setBrushOption, setMirrorEnabled, setMirrorLines, setMirrorRadial, setPaletteDialog, setPanel, setSelectStyle, setSwatchLock, setSymbolPickerOpen, setViewOption, setWandMatch, setWandTolerance, reducer$2 as swatchesDefault, reducer$1 as symbolsDefault, syncPalettes, syncSwatchLock, syncSwatches, syncSymbols, reducer as viewDefault};
