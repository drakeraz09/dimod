import log from '../log/log';
import paper from '@turbowarp/paper';
import {createDoc, pruneDoc, generateDid, getDid, setDid, getBrushOptions, lineStyleOf, LineProfiles} from './core';
import GradientTypes from '../lib/gradient-types';
let _doc = createDoc();
let _index = new Map();
const getPaintingLayer = function () {
    if (!paper.project) return null;
    for (const layer of paper.project.layers) {
        if (layer.data && layer.data.isPaintingLayer) return layer;
    }
    return null;
};
const walkItems = function (callback) {
    const layer = getPaintingLayer();
    if (!layer) return;
    const recurse = function (item) {
        if (item.guide || item.isClipMask()) return;
        callback(item);
        if (item.children) {
            for (const child of item.children) recurse(child);
        }
    };
    for (const child of layer.children) recurse(child);
};
const getDoc = function () { return _doc; };
const setDoc = function (doc) { _doc = doc || createDoc(); };
const resetDimod = function () { _doc = createDoc(); _index = new Map(); clearDirty(); };
const getIndex = function () { return _index; };
const getItemByDid = function (did) { return _index.get(did) || null; };
const freshDid = function () {
    let did = generateDid();
    while (_index.has(did)) did = generateDid();
    return did;
};
const rebuildIndex = function () {
    _index = new Map();
    walkItems(item => {
        const did = getDid(item);
        if (!did) return;
        if (_index.has(did)) { setDid(item, freshDid()); _index.set(getDid(item), item); return; }
        _index.set(did, item);
    });
    return new Set(_index.keys());
};
const ensureDid = function (item) {
    const existing = getDid(item);
    if (existing && _index.get(existing) === item) return existing;
    if (existing && !_index.has(existing)) { _index.set(existing, item); return existing; }
    const did = freshDid();
    setDid(item, did);
    _index.set(did, item);
    return did;
};
const reconcile = function () { const present = rebuildIndex(); pruneDoc(_doc, present); return present; };
const MAX_ITERATIONS = 8;
const _handlers = new Map();
let _dirty = new Map();
let _scheduled = null;
let _passing = false;
let _idleCallback = null;
const registerKind = function (kind, handler) { _handlers.set(kind, handler); };
const hasKind = function (kind) { return _handlers.has(kind); };
const markDirty = function (kind, key) {
    if (!key) return;
    if (!_dirty.has(kind)) _dirty.set(kind, new Set());
    _dirty.get(kind).add(key);
};
const hasDirty = function () {
    for (const keys of _dirty.values()) {
        if (keys.size) return true;
    }
    return false;
};
const clearDirty = function () {
    _dirty = new Map();
    if (_scheduled !== null && _idleCallback) { _idleCallback.cancel(_scheduled); _scheduled = null; }
};
const runPass = function () {
    if (_passing) return {changed: false, broken: []};
    _passing = true;
    const broken = [];
    const seen = new Map();
    let changed = false;
    try {
        for (let iteration = 0; iteration < MAX_ITERATIONS && hasDirty(); iteration++) {
            const work = _dirty;
            _dirty = new Map();
            for (const [kind, keys] of work) {
                const handler = _handlers.get(kind);
                if (!handler) continue;
                if (!seen.has(kind)) seen.set(kind, new Set());
                const processed = seen.get(kind);
                const fresh = new Set();
                for (const key of keys) {
                    if (processed.has(key)) {
                        broken.push({kind, key});
                        if (handler.onBreak) handler.onBreak(key);
                        continue;
                    }
                    processed.add(key);
                    fresh.add(key);
                }
                if (!fresh.size) continue;
                changed = true;
                const dirtied = handler.propagate(fresh) || [];
                for (const entry of dirtied) markDirty(entry.kind, entry.key);
            }
        }
        if (hasDirty()) {
            for (const [kind, keys] of _dirty) {
                const handler = _handlers.get(kind);
                for (const key of keys) {
                    broken.push({kind, key});
                    if (handler && handler.onBreak) handler.onBreak(key);
                }
            }
            _dirty = new Map();
        }
    } finally { _passing = false; }
    if (broken.length) { log.warn(`dimod: broke ${broken.length} link(s) to stop a propagation cycle.`); }
    return {changed, broken};
};
const setScheduler = function (scheduler) { _idleCallback = scheduler; };
const _defaultScheduler = function () {
    if (typeof requestAnimationFrame === 'function') {
        return {request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle)};
    }
    return {request: callback => setTimeout(callback, 16), cancel: handle => clearTimeout(handle)};
};
const schedulePass = function (callback) {
    if (!_idleCallback) _idleCallback = _defaultScheduler();
    if (_scheduled !== null) return;
    _scheduled = _idleCallback.request(() => {
        _scheduled = null;
        const result = runPass();
        if (callback) callback(result);
    });
};
const getLinks = function (kind) {
    const links = getDoc().links;
    return kind ? links.filter(link => link.kind === kind) : links.slice();
};
const getLink = function (id) { return getDoc().links.find(link => link.id === id) || null; };
const addLink = function (link) {
    if (!link.state) link.state = 'ok';
    getDoc().links.push(link);
    return link;
};
const removeLink = function (id) {
    const doc = getDoc();
    const before = doc.links.length;
    doc.links = doc.links.filter(link => link.id !== id);
    return doc.links.length !== before;
};
const breakLink = function (id, reason) {
    const link = getLink(id);
    if (!link) return null;
    link.state = 'broken';
    if (reason) link.reason = reason;
    return link;
};
const MAX_SWATCHES = 64;
const normalizeColor = function (color) {
    if (typeof color !== 'string') return null;
    const trimmed = color.trim().toLowerCase();
    const match = /^#?([0-9a-f]{3,8})$/.exec(trimmed);
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
        hex = hex
            .split('')
            .map(character => character + character)
            .join('');
    }
    if (hex.length === 6) return `#${hex}`;
    if (hex.length !== 8) return null;
    return hex.slice(6) === 'ff' ? `#${hex.slice(0, 6)}` : `#${hex}`;
};
const normalizeStyle = function (value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const fill = normalizeColor(value);
        return fill ? {fill, fill2: null, gradientType: GradientTypes.SOLID, stroke: null, strokeWidth: 0} : null;
    }
    if (typeof value !== 'object') return null;
    const fill = normalizeColor('fill' in value ? value.fill : value.fillColor);
    const fill2 = normalizeColor('fill2' in value ? value.fill2 : value.fillColor2);
    const stroke = normalizeColor('stroke' in value ? value.stroke : value.strokeColor);
    const rawWidth = Number('strokeWidth' in value ? value.strokeWidth : 0);
    const strokeWidth = stroke && isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 0;
    let gradientType = value.gradientType;
    if (!(gradientType in GradientTypes)) gradientType = GradientTypes.SOLID;
    if (!fill2) gradientType = GradientTypes.SOLID;
    if (!fill && !stroke) return null;
    const line = stroke && value.line && value.line.type && value.line.type !== 'SOLID' ? lineStyleOf(value.line) : null;
    const entry = {fill, fill2: gradientType === GradientTypes.SOLID ? null : fill2, gradientType, stroke, strokeWidth};
    if (line) entry.line = line;
    if (stroke && value.profile && value.profile in LineProfiles && value.profile !== LineProfiles.UNIFORM) entry.profile = value.profile;
    return entry;
};
const styleToSave = function (selectionStyle, colorState) {
    const fromSelection = normalizeStyle(selectionStyle);
    if (fromSelection) return fromSelection;
    if (!colorState) return null;
    return normalizeStyle({
        fill: colorState.fillColor && colorState.fillColor.primary,
        fill2: colorState.fillColor && colorState.fillColor.secondary,
        gradientType: colorState.fillColor && colorState.fillColor.gradientType,
        stroke: colorState.strokeColor && colorState.strokeColor.primary,
        strokeWidth: colorState.strokeWidth,
        line: getBrushOptions().lineStyle,
        profile: getBrushOptions().lineProfile
    });
};
const styleKey = function (entry) {
    const l = entry.line;
    return [entry.fill, entry.fill2, entry.gradientType, entry.stroke, entry.strokeWidth]
        .concat(l ? [l.type, l.dash, l.gap, l.cap, l.offset] : [], entry.profile ? [entry.profile] : []).join('|');
};
const styleToCss = function (entry) {
    const css = {};
    if (entry.gradientType === GradientTypes.SOLID || !entry.fill2) {
        if (entry.fill) css.background = entry.fill;
    } else if (entry.gradientType === GradientTypes.RADIAL) {
        css.background = `radial-gradient(circle at 50% 50%, ${entry.fill}, ${entry.fill2})`;
    } else {
        const direction = entry.gradientType === GradientTypes.VERTICAL ? 'to bottom' : 'to right';
        css.background = `linear-gradient(${direction}, ${entry.fill}, ${entry.fill2})`;
    }
    if (entry.stroke) {
        css.borderColor = entry.stroke;
        css.borderWidth = `${Math.max(1, Math.min(4, Math.round(entry.strokeWidth / 2)))}px`;
        css.borderStyle = !entry.line ? 'solid' : entry.line.type === 'DOTTED' ? 'dotted' : 'dashed';
    }
    return css;
};
const _migrateColors = function (palette) {
    const keys = new Set(palette.entries.map(styleKey));
    for (const color of palette.colors) {
        const entry = normalizeStyle(color);
        if (!entry || keys.has(styleKey(entry))) continue;
        keys.add(styleKey(entry));
        palette.entries.push(entry);
    }
    delete palette.colors;
};
const _palette = function () {
    const doc = getDoc();
    if (!doc.swatches || typeof doc.swatches !== 'object' || Array.isArray(doc.swatches)) { doc.swatches = {}; }
    const palette = doc.swatches;
    if (!Array.isArray(palette.entries)) palette.entries = [];
    if (Array.isArray(palette.colors)) _migrateColors(palette);
    if (typeof palette.lock !== 'boolean') palette.lock = false;
    return palette;
};
const getSwatches = function () { return _palette().entries.map(entry => Object.assign({}, entry)); };
const isPaletteLocked = function () { return _palette().lock; };
const setPaletteLocked = function (locked) { _palette().lock = Boolean(locked); };
const setSwatches = function (values) {
    const seen = new Set();
    const stored = [];
    for (const value of values || []) {
        const entry = normalizeStyle(value);
        if (!entry) continue;
        const key = styleKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        stored.push(entry);
        if (stored.length >= MAX_SWATCHES) break;
    }
    _palette().entries = stored;
    return getSwatches();
};
const hasSwatch = function (value) {
    const entry = normalizeStyle(value);
    if (!entry) return false;
    const key = styleKey(entry);
    return _palette().entries.some(existing => styleKey(existing) === key);
};
const addSwatch = function (value) {
    const entry = normalizeStyle(value);
    if (!entry) return null;
    const palette = _palette();
    if (hasSwatch(entry)) return null;
    if (palette.entries.length >= MAX_SWATCHES) return null;
    palette.entries.push(entry);
    return Object.assign({}, entry);
};
const removeSwatch = function (value) {
    const key = typeof value === 'string' && value.indexOf('|') !== -1 ?
        value :
        (normalizeStyle(value) && styleKey(normalizeStyle(value)));
    if (!key) return false;
    const palette = _palette();
    const index = palette.entries.findIndex(entry => styleKey(entry) === key);
    if (index === -1) return false;
    palette.entries.splice(index, 1);
    return true;
};
const moveSwatch = function (from, to) {
    const entries = _palette().entries;
    if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return false;
    entries.splice(to, 0, entries.splice(from, 1)[0]);
    return true;
};
const clearSwatches = function () {
    const palette = _palette();
    const count = palette.entries.length;
    palette.entries = [];
    return count;
};
const _channels = function (hex) {
    return [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
};
const nearestSwatch = function (color) {
    const normalized = normalizeColor(color);
    if (!normalized) return null;
    const candidates = _palette().entries
        .filter(entry => entry.gradientType === GradientTypes.SOLID && entry.fill)
        .map(entry => entry.fill);
    if (!candidates.length) return null;
    const [r1, g1, b1] = _channels(normalized);
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        const [r2, g2, b2] = _channels(candidate);
        const rMean = (r1 + r2) / 2;
        const dr = r1 - r2;
        const dg = g1 - g2;
        const db = b1 - b2;
        const distance =
            (((512 + rMean) * dr * dr) / 256) +
            (4 * dg * dg) +
            (((767 - rMean) * db * db) / 256);
        if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
    return best;
};
const snapToPalette = function (color) {
    if (!isPaletteLocked()) return color;
    const nearest = nearestSwatch(color);
    return nearest === null ? color : nearest;
};
const STORAGE_KEY = 'dimod-paint/palettes/1';
const MAX_PALETTES = 60;
let _saved = null;
const _freshId = function () {
    let id = '';
    for (let i = 0; i < 8; i++) id += Math.floor(Math.random() * 36).toString(36);
    return id;
};
const _table = function () {
    if (_saved) return _saved;
    _saved = {};
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
            for (const id of Object.keys(stored)) {
                const palette = stored[id];
                if (!palette || !Array.isArray(palette.entries)) continue;
                _saved[id] = {
                    id,
                    name: String(palette.name || 'Palette'),
                    entries: palette.entries,
                    lock: Boolean(palette.lock),
                    updated: Number(palette.updated) || 0
                };
            }
        }
    } catch (error) { log.warn('dimod: could not read saved palettes.', error); }
    return _saved;
};
const _stamp = function () {
    let highest = 0;
    const table = _table();
    for (const id of Object.keys(table)) highest = Math.max(highest, table[id].updated);
    return Math.max(Date.now(), highest + 1);
};
const _persist = function () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_table())); } catch (error) { log.warn('dimod: could not save palettes.', error); }
};
const resetPalettes = function () { _saved = null; };
const _binding = function () {
    const doc = getDoc();
    if (!doc.swatches || typeof doc.swatches !== 'object' || Array.isArray(doc.swatches)) { doc.swatches = {}; }
    return doc.swatches;
};
const getCurrentPaletteId = function () { return _binding().paletteId || null; };
const getCurrentPaletteName = function () {
    const palette = _table()[getCurrentPaletteId()];
    return palette ? palette.name : null;
};
const listPalettes = function () {
    const table = _table();
    return Object.keys(table)
        .map(id => table[id])
        .sort((a, b) => b.updated - a.updated);
};
const getPalette = function (id) { return (id && _table()[id]) || null; };
const persistCurrentPalette = function () {
    const palette = getPalette(getCurrentPaletteId());
    if (!palette) return null;
    palette.entries = getSwatches();
    palette.lock = isPaletteLocked();
    palette.updated = _stamp();
    _persist();
    return palette;
};
const savePaletteAs = function (name) {
    const table = _table();
    const wanted = String(name || '').trim() || 'Palette';
    const existing = listPalettes().find(palette => palette.name.toLowerCase() === wanted.toLowerCase());
    const id = existing ? existing.id : _freshId();
    if (!existing && Object.keys(table).length >= MAX_PALETTES) {
        log.warn(`dimod: there is no room for more than ${MAX_PALETTES} palettes.`);
        return null;
    }
    table[id] = {id, name: wanted, entries: getSwatches(), lock: isPaletteLocked(), updated: _stamp()};
    _binding().paletteId = id;
    _persist();
    return table[id];
};
const openPalette = function (id) {
    const palette = getPalette(id);
    if (!palette) return false;
    setSwatches(palette.entries);
    setPaletteLocked(palette.lock);
    _binding().paletteId = id;
    palette.updated = _stamp();
    _persist();
    return true;
};
const renamePalette = function (id, name) {
    const palette = getPalette(id);
    if (!palette) return false;
    palette.name = String(name || '').trim() || palette.name;
    palette.updated = _stamp();
    _persist();
    return true;
};
const deletePalette = function (id) {
    if (!getPalette(id)) return false;
    delete _table()[id];
    if (getCurrentPaletteId() === id) delete _binding().paletteId;
    _persist();
    return true;
};
const mostRecentPalette = function () { return listPalettes()[0] || null; };
const adoptPaletteForCostume = function () {
    if (getCurrentPaletteId() || getSwatches().length > 0) return null;
    const recent = mostRecentPalette();
    if (!recent) return null;
    return openPalette(recent.id) ? recent : null;
};
export {MAX_ITERATIONS, MAX_PALETTES, MAX_SWATCHES, STORAGE_KEY, addLink, addSwatch, adoptPaletteForCostume, breakLink, clearDirty, clearSwatches, deletePalette, ensureDid, freshDid, getCurrentPaletteId, getCurrentPaletteName, getDoc, getIndex, getItemByDid, getLink, getLinks, getPaintingLayer, getPalette, getSwatches, hasDirty, hasKind, hasSwatch, isPaletteLocked, listPalettes, markDirty, mostRecentPalette, moveSwatch, nearestSwatch, normalizeColor, normalizeStyle, openPalette, persistCurrentPalette, rebuildIndex, reconcile, registerKind, removeLink, removeSwatch, renamePalette, resetDimod, resetPalettes, runPass, savePaletteAs, schedulePass, setDoc, setPaletteLocked, setScheduler, setSwatches, snapToPalette, styleKey, styleToCss, styleToSave, walkItems};
