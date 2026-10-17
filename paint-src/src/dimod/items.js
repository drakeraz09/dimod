import paper from '@turbowarp/paper';
import {CENTER, ART_BOARD_BOUNDS, clampViewBounds, getMinZoom, ART_BOARD_WIDTH, ART_BOARD_HEIGHT} from '../helper/view.js';
import {scaleWithStrokes, sortItemsByZIndex} from '../helper/math.js';
import GradientTypes from '../lib/gradient-types.js';
import {applyGradientTypeToSelection, applyColorToSelection, applyStrokeWidthToSelection} from '../helper/style-path.js';
import keyMirror from 'keymirror';
import Modes from '../lib/modes.js';
import {getRaster} from '../helper/layer.js';
import {getSelectedLeafItems, getAllSelectableRootItems, setItemSelection} from '../helper/selection.js';
import {mirrorItem, getMirrorMatrices, isMirrorActive, getDid, didToAttribute, attributeToDid, setDid, readDoc, writeDoc, profileOnExport, profileOnImport, readLineStyle, setLineStyle, getLineProfile, setLineProfile} from './core.js';
import {getPaintingLayer, getDoc, walkItems, setDoc, reconcile, markDirty, registerKind, runPass} from './store.js';
import log from '../log/log.js';
import {SYMBOLS_ENABLED} from '../lib/dimod-flags.js';
import {setPivot, getPivot} from './pivot.js';
import './render.js';
let source = null;
const setSymbolSource = value => { source = value; };
const getSymbolSource = () => source;
const rasterOf = info => new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(info.width * 2));
        canvas.height = Math.max(1, Math.round(info.height * 2));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const raster = new paper.Raster(canvas);
        raster.remove();
        resolve(raster);
    };
    image.onerror = () => resolve(null);
    image.src = info.url;
});
const frameOf = art => { const b = art.bounds; return [b.x, b.y, b.width, b.height]; };
const artOf = info => {
    if (!info.svg) return rasterOf(info);
    const group = paper.project.importSVG(info.svg, {insert: false, expandShapes: true});
    if (!group) return Promise.resolve(null);
    const mask = group.clipped ? group.children.find(child => child.isClipMask()) : null;
    if (mask) { group.clipped = false; mask.remove(); }
    scaleWithStrokes(group, 2, new paper.Point());
    const box = /viewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(info.svg);
    const rc = info.rotationCenter || [info.width / 2, info.height / 2];
    group.dimodRc = [(rc[0] - (box ? parseFloat(box[1]) : 0)) * 2, (rc[1] - (box ? parseFloat(box[2]) : 0)) * 2];
    const frame = new paper.Path.Rectangle({rectangle: group.bounds, insert: false});
    frame.fillColor = null;
    frame.strokeColor = null;
    group.insertChild(0, frame);
    group.dimodFrame = frameOf(group);
    return Promise.resolve(group);
};
const tag = (item, ref, info, art) => {
    item.data = Object.assign({}, item.data, {dimodSymbol: {sprite: ref.sprite, costume: ref.costume, asset: info.assetId,
        frame: (art || item).dimodFrame || frameOf(art || item), rc: (art || item).dimodRc || null, rcRaw: info.rotationCenter || null}});
};
const placeSymbol = ref => {
    const info = source && source.get(ref.sprite, ref.costume);
    return info ? artOf(info).then(art => {
        if (!art) return null;
        tag(art, ref, info);
        art.data.layerName = ref.costume;
        const rc = art.dimodRc || [0, 0];
        art.translate(new paper.Point(CENTER.x - rc[0], CENTER.y - rc[1]));
        paper.project.getActiveLayer().addChild(art);
        return art;
    }) : Promise.resolve(null);
};
const symbolStale = item => {
    const ref = item.data && item.data.dimodSymbol;
    const info = ref && source && source.get(ref.sprite, ref.costume);
    return Boolean(info && (info.assetId !== ref.asset || (ref.rcRaw && info.rotationCenter && (ref.rcRaw[0] !== info.rotationCenter[0] || ref.rcRaw[1] !== info.rotationCenter[1]))));
};
const placement = (item, frame) => {
    const rect = item.children && item.children[0];
    if (!rect || !rect.segments || rect.segments.length !== 4) return null;
    const [x, y, w, h] = frame;
    const a = [[x, y + h], [x, y], [x + w, y]];
    const b = rect.segments.slice(0, 3).map(seg => seg.point);
    const u = {x: a[2][0] - a[1][0], y: a[2][1] - a[1][1]};
    const v = {x: a[0][0] - a[1][0], y: a[0][1] - a[1][1]};
    const u2 = {x: b[2].x - b[1].x, y: b[2].y - b[1].y};
    const v2 = {x: b[0].x - b[1].x, y: b[0].y - b[1].y};
    const det = (u.x * v.y) - (u.y * v.x);
    if (!det) return null;
    const m = [
        ((u2.x * v.y) - (v2.x * u.y)) / det, ((u2.y * v.y) - (v2.y * u.y)) / det,
        ((v2.x * u.x) - (u2.x * v.x)) / det, ((v2.y * u.x) - (u2.y * v.x)) / det
    ];
    return new paper.Matrix(m[0], m[1], m[2], m[3],
        b[1].x - ((m[0] * a[1][0]) + (m[2] * a[1][1])), b[1].y - ((m[1] * a[1][0]) + (m[3] * a[1][1])));
};
const refreshSymbol = (item, costume) => {
    const ref = Object.assign({}, item.data.dimodSymbol, costume ? {costume} : {});
    const info = source && source.get(ref.sprite, ref.costume);
    if (!info) return Promise.resolve(null);
    return artOf(info).then(art => {
        if (!art || !item.parent) return null;
        const old = item.data.dimodSymbol;
        let matrix = item instanceof paper.Raster ? item.matrix.clone() : placement(item, old.frame);
        if (!matrix) return null;
        if (!(item instanceof paper.Raster) && old.rc && art.dimodRc) {
            const was = matrix.transform(new paper.Point(old.rc[0], old.rc[1]));
            const now = new paper.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0)
                .transform(new paper.Point(art.dimodRc[0], art.dimodRc[1]));
            matrix = new paper.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, was.x - now.x, was.y - now.y);
        }
        if (item instanceof paper.Raster) art.matrix = matrix;
        else art.transform(matrix);
        art.opacity = item.opacity;
        art.blendMode = item.blendMode;
        art.visible = item.visible;
        art.locked = item.locked;
        art.data = Object.assign({}, item.data);
        tag(art, ref, info, art);
        if (costume) art.data.layerName = costume;
        item.parent.insertChild(item.index, art);
        art.selected = item.selected;
        item.remove();
        return art;
    });
};
const detachSymbol = item => {
    const data = Object.assign({}, item.data);
    delete data.dimodSymbol;
    item.data = data;
    const rect = item.children && item.children[0];
    if (rect && rect.segments && rect.segments.length === 4 && !rect.fillColor && !rect.strokeColor) rect.remove();
};
let syncTimer = null;
let pressed = false;
const startSymbolSync = changed => {
    stopSymbolSync();
    const down = () => { pressed = true; };
    const up = () => { pressed = false; };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('mouseup', up, true);
    let busy = false;
    const timer = setInterval(() => {
        if (busy || pressed || !source || !paper.project) return;
        const stale = paper.project.getItems({match: item => item.data && item.data.dimodSymbol && symbolStale(item)});
        if (!stale.length) return;
        busy = true;
        Promise.all(stale.map(item => refreshSymbol(item))).then(done => {
            busy = false;
            if (done.some(Boolean)) changed();
        });
    }, 800);
    syncTimer = () => {
        clearInterval(timer);
        window.removeEventListener('mousedown', down, true);
        window.removeEventListener('mouseup', up, true);
    };
};
const stopSymbolSync = () => {
    if (syncTimer) syncTimer();
    syncTimer = null;
};
export {setSymbolSource, getSymbolSource, placeSymbol, refreshSymbol, symbolStale, detachSymbol, startSymbolSync, stopSymbolSync};
export {default as EyeDropperStyles} from '../lib/eye-dropper-styles';
const HIT_TOLERANCE = 4;
const _toHex = function (color) {
    if (!color) return null;
    return color.toCSS(true ).toLowerCase();
};
const _gradientTypeOf = function (color) {
    if (!color || !color.gradient) return GradientTypes.SOLID;
    if (color.gradient.radial) return GradientTypes.RADIAL;
    const origin = color.origin;
    const destination = color.destination;
    if (!origin || !destination) return GradientTypes.HORIZONTAL;
    return Math.abs(destination.x - origin.x) >= Math.abs(destination.y - origin.y) ?
        GradientTypes.HORIZONTAL :
        GradientTypes.VERTICAL;
};
const readStyle = function (item) {
    const fill = item.fillColor;
    const stroke = item.strokeColor;
    const gradientType = _gradientTypeOf(fill);
    let fillColor = null;
    let fillColor2 = null;
    if (fill && fill.gradient) {
        const stops = fill.gradient.stops;
        fillColor = stops.length ? _toHex(stops[0].color) : null;
        fillColor2 = stops.length > 1 ? _toHex(stops[stops.length - 1].color) : fillColor;
    } else { fillColor = _toHex(fill); }
    return {
        fillColor,
        fillColor2,
        gradientType,
        strokeColor: stroke && stroke.gradient ? _toHex(stroke.gradient.stops[0].color) : _toHex(stroke),
        strokeWidth: stroke ? (item.strokeWidth || 0) : 0,
        dashArray: Array.isArray(item.dashArray) && item.dashArray.length ? item.dashArray.slice() : null,
        line: readLineStyle(item),
        profile: getLineProfile(item)
    };
};
const itemAt = function (point) {
    if (!paper.project) return null;
    const options = {
        fill: true,
        stroke: true,
        segments: false,
        curves: false,
        guides: false,
        tolerance: HIT_TOLERANCE / paper.view.zoom,
        match: hit => {
            const item = hit.item;
            if (!item || item.guide) return false;
            if (item.isClipMask && item.isClipMask()) return false;
            if (item.data && (item.data.isBackgroundGuideLayer || item.data.isHelperItem)) return false;
            for (let parent = item.parent; parent; parent = parent.parent) {
                if (parent.data && parent.data.isGuideLayer) return false;
            }
            return true;
        }
    };
    const hit = paper.project.hitTest(point, options);
    return hit ? hit.item : null;
};
const sampleStyleAt = function (point) {
    const item = itemAt(point);
    if (!item) return null;
    return Object.assign({item}, readStyle(item));
};
const applyStyleToSelection = function (style, textEditTargetId) {
    const isSolid = style.gradientType === GradientTypes.SOLID;
    let changed = false;
    changed = applyGradientTypeToSelection(style.gradientType, false, textEditTargetId) || changed;
    changed = applyColorToSelection(style.fillColor, 0, isSolid, false, textEditTargetId) || changed;
    if (!isSolid) { changed = applyColorToSelection(style.fillColor2, 1, false, false, textEditTargetId) || changed; }
    changed = applyGradientTypeToSelection(GradientTypes.SOLID, true, textEditTargetId) || changed;
    changed = applyColorToSelection(style.strokeColor, 0, true, true, textEditTargetId) || changed;
    changed = applyStrokeWidthToSelection(style.strokeWidth, textEditTargetId) || changed;
    if ('line' in style) {
        for (let item of getSelectedLeafItems()) {
            if (item.parent instanceof paper.CompoundPath) item = item.parent;
            if (!item.strokeColor || !(item instanceof paper.Path || item instanceof paper.CompoundPath)) continue;
            const before = item.data && item.data.dimodLine;
            setLineStyle(item, style.line);
            if (before || style.line) changed = true;
            if ('profile' in style && getLineProfile(item) !== (style.profile || null)) {
                setLineProfile(item, style.profile);
                changed = true;
            }
        }
    }
    return changed;
};
const AlignEdges = keyMirror({LEFT: null, HORIZONTAL_CENTER: null, RIGHT: null, TOP: null, VERTICAL_CENTER: null, BOTTOM: null});
const AlignReferences = keyMirror({SELECTION: null, ART_BOARD: null, ROTATION_CENTER: null});
const DistributeAxes = keyMirror({HORIZONTAL: null, VERTICAL: null});
const getReferenceRect = function (items, reference) {
    if (reference === AlignReferences.ART_BOARD) return ART_BOARD_BOUNDS;
    if (reference === AlignReferences.ROTATION_CENTER) return new paper.Rectangle(CENTER, new paper.Size(0, 0));
    let rect = null;
    for (const item of items) { rect = rect ? rect.unite(item.bounds) : item.bounds; }
    return rect;
};
const _getAlignDelta = function (bounds, reference, edge) {
    switch (edge) {
    case AlignEdges.LEFT:
        return new paper.Point(reference.left - bounds.left, 0);
    case AlignEdges.HORIZONTAL_CENTER:
        return new paper.Point(reference.center.x - bounds.center.x, 0);
    case AlignEdges.RIGHT:
        return new paper.Point(reference.right - bounds.right, 0);
    case AlignEdges.TOP:
        return new paper.Point(0, reference.top - bounds.top);
    case AlignEdges.VERTICAL_CENTER:
        return new paper.Point(0, reference.center.y - bounds.center.y);
    case AlignEdges.BOTTOM:
        return new paper.Point(0, reference.bottom - bounds.bottom);
    default:
        return new paper.Point(0, 0);
    }
};
const alignItems = function (items, edge, reference) {
    if (!items.length) return false;
    const rect = getReferenceRect(items, reference);
    if (!rect) return false;
    let moved = false;
    for (const item of items) {
        const delta = _getAlignDelta(item.bounds, rect, edge);
        if (delta.isZero()) continue;
        item.translate(delta);
        moved = true;
    }
    return moved;
};
const _spanStart = function (item, horizontal) { return horizontal ? item.bounds.left : item.bounds.top; };
const distributeItems = function (items, axis) {
    if (items.length < 3) return false;
    const horizontal = axis === DistributeAxes.HORIZONTAL;
    const sorted = items.slice().sort((a, b) => _spanStart(a, horizontal) - _spanStart(b, horizontal));
    const first = sorted[0].bounds;
    const last = sorted[sorted.length - 1].bounds;
    const span = horizontal ?
        last.right - first.left :
        last.bottom - first.top;
    let occupied = 0;
    for (const item of sorted) { occupied += horizontal ? item.bounds.width : item.bounds.height; }
    const gap = (span - occupied) / (sorted.length - 1);
    let moved = false;
    let cursor = horizontal ? first.left : first.top;
    for (const item of sorted) {
        const bounds = item.bounds;
        const offset = cursor - _spanStart(item, horizontal);
        if (offset !== 0) { item.translate(horizontal ? new paper.Point(offset, 0) : new paper.Point(0, offset)); moved = true; }
        cursor += (horizontal ? bounds.width : bounds.height) + gap;
    }
    return moved;
};
const PRECISION$1 = 4;
const _round$1 = function (n) { const factor = Math.pow(10, PRECISION$1); return Math.round(n * factor) / factor; };
const toPersisted = function (point) { return new paper.Point(point.x - CENTER.x, point.y - CENTER.y); };
const fromPersisted = function (point) { return new paper.Point(point.x + CENTER.x, point.y + CENTER.y); };
const toPersistedArray = function (point) {
    const persisted = toPersisted(point);
    return [_round$1(persisted.x), _round$1(persisted.y)];
};
const fromPersistedArray = function (array) {
    if (!Array.isArray(array) || array.length < 2) return null;
    const x = Number(array[0]);
    const y = Number(array[1]);
    if (isNaN(x) || isNaN(y)) return null;
    return fromPersisted(new paper.Point(x, y));
};
const SNAP_MODES = [
    Modes.LINE, Modes.RECT, Modes.OVAL, Modes.ROUNDED_RECT, Modes.TRIANGLE, Modes.ARROW,
    Modes.SUSSY, Modes.PEN, Modes.POLYGON, Modes.TEXT, Modes.GRADIENT, Modes.MIRROR,
    Modes.BIT_LINE, Modes.BIT_RECT, Modes.BIT_OVAL, Modes.BIT_TEXT, Modes.BIT_POLYGON,
    Modes.BIT_GRADIENT, Modes.BIT_MIRROR
];
const state = {grid: false, snap: true, gridSize: 16, gridAddon: false};
let getMode$1 = () => null;
const setGridSnapOption = function (key, value) {
    if (key in state) state[key] = value;
};
const isGridSnapOn = () => state.gridAddon && state.grid && state.snap;
const snapToGrid = function (point) {
    const step = state.gridSize * 2;
    return new paper.Point(
        CENTER.x + (Math.round((point.x - CENTER.x) / step) * step),
        CENTER.y + (Math.round((point.y - CENTER.y) / step) * step));
};
const wants = event => isGridSnapOn() && SNAP_MODES.indexOf(getMode$1()) !== -1 &&
    !(event && event.modifiers && event.modifiers.alt);
const installGridSnap = function (modeGetter) {
    getMode$1 = modeGetter;
    const proto = paper.ToolEvent.prototype;
    if (proto.__dimodGridSnap) return;
    proto.__dimodGridSnap = true;
    for (const name of ['point', 'downPoint']) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (!descriptor || !descriptor.get) continue;
        Object.defineProperty(proto, name, {
            ...descriptor,
            get () { const value = descriptor.get.call(this); return value && wants(this) ? snapToGrid(value) : value; }
        });
    }
};
const SNAP_ANGLES = 45;
const SNAP_WITHIN = 7;
const SHIFT_STEP = 15;
const TOUCH_HOLD = 90;
const TWIST_THRESHOLD = 12;
const TAP_TIME = 260;
const TAP_TRAVEL = 14;
let host = null;
const getRotation = () => { const m = paper.view.matrix; return Math.atan2(m.b, m.a) * 180 / Math.PI; };
const canvasPoint = (event) => {
    const rect = paper.view.element.getBoundingClientRect();
    return new paper.Point(event.clientX - rect.left, event.clientY - rect.top);
};
const setViewMatrix = function (matrix) {
    paper.view.matrix.set(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty);
    clampViewBounds();
    if (host) host.onViewChanged();
};
const setViewRotation = function (degrees) {
    const size = paper.view.viewSize;
    const center = new paper.Point(size.width / 2, size.height / 2);
    const turn = new paper.Matrix().rotate(degrees - getRotation(), center);
    setViewMatrix(turn.append(paper.view.matrix.clone()));
};
const snapAngle = (degrees, shift) => {
    if (shift) return Math.round(degrees / SHIFT_STEP) * SHIFT_STEP;
    const nearest = Math.round(degrees / SNAP_ANGLES) * SNAP_ANGLES;
    return Math.abs(degrees - nearest) <= SNAP_WITHIN ? nearest : degrees;
};
let tilt = null;
const onRightDown = function (event) {
    if (event.button !== 2 || event.pointerType === 'touch' || event.target !== paper.view.element) return;
    const size = paper.view.viewSize;
    const center = new paper.Point(size.width / 2, size.height / 2);
    tilt = {
        center,
        startAngle: canvasPoint(event).subtract(center).angle,
        startRotation: getRotation(),
        start: canvasPoint(event),
        turning: false
    };
};
const onRightMove = function (event) {
    if (!tilt || !(event.buttons & 2)) return;
    const point = canvasPoint(event);
    if (!tilt.turning) {
        if (point.getDistance(tilt.start) < 5) return;
        tilt.turning = true;
    }
    event.stopPropagation();
    const angle = point.subtract(tilt.center).angle;
    let target = tilt.startRotation + (angle - tilt.startAngle);
    target = ((target % 360) + 540) % 360 - 180;
    setViewRotation(snapAngle(target, event.shiftKey));
    if (host) host.setRotationBadge(Math.round(getRotation()));
};
const onRightUp = function (event) {
    if (event.button !== 2 || !tilt) return;
    tilt.finished = tilt.turning;
    if (host) host.setRotationBadge(null);
};
const onContextMenu = function (event) {
    if (tilt && tilt.finished) { event.preventDefault(); event.stopPropagation(); }
    tilt = null;
};
const touches = new Map();
let held = null;
let gesture = null;
const replaying = new WeakSet();
const initOf = event => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: event.button,
    buttons: event.buttons,
    pressure: event.pressure,
    width: event.width,
    height: event.height
});
const dispatch = (type, init, target) => {
    const event = new PointerEvent(type, init);
    replaying.add(event);
    (target || paper.view.element).dispatchEvent(event);
};
const release = function () {
    if (!held) return;
    const {down, queue} = held;
    clearTimeout(held.timer);
    held = null;
    dispatch('pointerdown', down);
    for (const move of queue) dispatch('pointermove', move);
};
const startGesture = function () {
    if (held) { clearTimeout(held.timer); held = null; }
    const points = Array.from(touches.values()).map(t => t.point);
    const [a, b] = points;
    gesture = {
        mid: a.add(b).divide(2),
        distance: Math.max(1, a.getDistance(b)),
        angle: b.subtract(a).angle,
        matrix: paper.view.matrix.clone(),
        startRotation: getRotation(),
        twisting: false,
        maxTouches: touches.size,
        time: Date.now(),
        travel: 0
    };
};
const moveGesture = function () {
    const points = Array.from(touches.values()).map(t => t.point);
    if (points.length < 2) return;
    const [a, b] = points;
    const mid = a.add(b).divide(2);
    const scale = Math.max(0.1, Math.min(10, a.getDistance(b) / gesture.distance));
    let turn = b.subtract(a).angle - gesture.angle;
    turn = ((turn % 360) + 540) % 360 - 180;
    if (!gesture.twisting && Math.abs(turn) > TWIST_THRESHOLD) gesture.twisting = true;
    if (!gesture.twisting) { turn = 0; } else { turn = snapAngle(gesture.startRotation + turn, false) - gesture.startRotation; }
    gesture.travel = Math.max(gesture.travel, mid.getDistance(gesture.mid), Math.abs(a.getDistance(b) - gesture.distance));
    const screen = new paper.Matrix()
        .translate(mid)
        .rotate(turn)
        .scale(scale)
        .translate(gesture.mid.negate());
    const next = screen.append(gesture.matrix.clone());
    const zoom = Math.hypot(next.a, next.b);
    if (zoom < Math.min(0.2, getMinZoom()) || zoom > 40) return;
    setViewMatrix(next);
};
const endGesture = function () {
    const quick = Date.now() - gesture.time < TAP_TIME && gesture.travel < TAP_TRAVEL;
    if (quick && host) {
        if (gesture.maxTouches === 2) host.undo();
        else if (gesture.maxTouches >= 3) host.redo();
    }
    gesture = null;
};
const onTouchDown = function (event) {
    if (event.pointerType !== 'touch' || replaying.has(event)) return;
    if (event.target !== paper.view.element && !gesture && !held) return;
    touches.set(event.pointerId, {point: canvasPoint(event)});
    if (gesture) { gesture.maxTouches = Math.max(gesture.maxTouches, touches.size); event.stopPropagation(); return; }
    if (touches.size === 1) {
        event.stopPropagation();
        event.preventDefault();
        held = {down: initOf(event), queue: [], start: canvasPoint(event)};
        held.timer = setTimeout(release, TOUCH_HOLD);
    } else if (held) { event.stopPropagation(); startGesture(); }
};
const onTouchMove = function (event) {
    if (event.pointerType !== 'touch' || replaying.has(event) || !touches.has(event.pointerId)) return;
    touches.get(event.pointerId).point = canvasPoint(event);
    if (gesture) { event.stopPropagation(); moveGesture(); } else if (held) {
        event.stopPropagation();
        held.queue.push(initOf(event));
        if (canvasPoint(event).getDistance(held.start) > 12) release();
    }
};
const onTouchUp = function (event) {
    if (event.pointerType !== 'touch' || replaying.has(event)) return;
    if (!touches.has(event.pointerId)) return;
    touches.delete(event.pointerId);
    if (gesture) {
        event.stopPropagation();
        if (touches.size === 0) endGesture();
        else if (touches.size === 1) {
        }
    } else if (held) {
        const up = initOf(event);
        release();
        event.stopPropagation();
        dispatch('pointerup', up, document);
    }
};
const installViewGestures = function (callbacks) {
    host = callbacks;
    const listen = [
        ['pointerdown', onRightDown],
        ['pointermove', onRightMove],
        ['pointerup', onRightUp],
        ['contextmenu', onContextMenu],
        ['pointerdown', onTouchDown],
        ['pointermove', onTouchMove],
        ['pointerup', onTouchUp],
        ['pointercancel', onTouchUp]
    ];
    listen.forEach(([type, fn]) => window.addEventListener(type, fn, true));
    if (paper.view && paper.view.element) paper.view.element.style.touchAction = 'none';
    return () => { listen.forEach(([type, fn]) => window.removeEventListener(type, fn, true)); host = null; };
};
const maskToCanvas = function (selection, css) {
    const {rect, mask} = selection;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, rect.width | 0);
    canvas.height = Math.max(1, rect.height | 0);
    const context = canvas.getContext('2d');
    const data = context.createImageData(canvas.width, canvas.height);
    const color = new paper.Color(css);
    const rgba = [color.red * 255, color.green * 255, color.blue * 255, (color.alpha === null ? 1 : color.alpha) * 255];
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        data.data.set(rgba, i * 4);
    }
    context.putImageData(data, 0, 0);
    return canvas;
};
const fillMask = function (selection, css) {
    const context = getRaster().getContext(true);
    const {rect} = selection;
    const shape = maskToCanvas(selection, 'black');
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(shape, rect.x, rect.y);
    context.globalCompositeOperation = 'source-over';
    if (css) context.drawImage(maskToCanvas(selection, css), rect.x, rect.y);
};
const solid = data => {
    const out = new Uint8Array(data.width * data.height);
    for (let i = 0; i < out.length; i++) out[i] = data.data[(i * 4) + 3] >= 128 ? 1 : 0;
    return out;
};
const renderEffect = function (source, kind, size, css) {
    const w = source.width;
    const h = source.height;
    if (!w || !h) return null;
    const padLeft = kind === 'outline' ? size : 0;
    const padTop = kind === 'outline' ? size : 0;
    const width = w + (size * (kind === 'outline' ? 2 : 1));
    const height = h + (size * (kind === 'outline' ? 2 : 1));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const sourceData = source.getContext('2d').getImageData(0, 0, w, h);
    const inside = solid(sourceData);
    const layer = context.createImageData(width, height);
    const color = new paper.Color(css);
    const rgba = [color.red * 255, color.green * 255, color.blue * 255, (color.alpha === null ? 1 : color.alpha) * 255];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let on = false;
            if (kind === 'shadow') {
                const sx = x - size;
                const sy = y - size;
                on = sx >= 0 && sy >= 0 && sx < w && sy < h && inside[(sy * w) + sx];
            } else {
                const cx = x - padLeft;
                const cy = y - padTop;
                for (let dy = -size; dy <= size && !on; dy++) {
                    const sy = cy + dy;
                    if (sy < 0 || sy >= h) continue;
                    for (let dx = -size; dx <= size; dx++) {
                        const sx = cx + dx;
                        if (sx >= 0 && sx < w && inside[(sy * w) + sx]) { on = true; break; }
                    }
                }
            }
            if (on) layer.data.set(rgba, ((y * width) + x) * 4);
        }
    }
    context.putImageData(layer, 0, 0);
    context.drawImage(source, padLeft, padTop);
    return {canvas, padLeft, padTop};
};
const applyBitmapEffect = function (kind, size, css) {
    if (!css) return false;
    size = Math.max(1, Math.round(size) || 1);
    const selected = getSelectedLeafItems();
    if (selected.length === 1 && selected[0] instanceof paper.Raster && selected[0] !== getRaster()) {
        const raster = selected[0];
        const oldW = raster.canvas.width;
        const oldH = raster.canvas.height;
        const effect = renderEffect(raster.canvas, kind, size, css);
        if (!effect) return false;
        const {canvas, padLeft, padTop} = effect;
        const shift = new paper.Point((canvas.width / 2) - padLeft - (oldW / 2), (canvas.height / 2) - padTop - (oldH / 2));
        const before = raster.localToGlobal(new paper.Point(0, 0));
        const after = raster.localToGlobal(shift);
        raster.canvas = canvas;
        raster.translate(after.subtract(before));
        if (raster.data) delete raster.data.expanded;
        return true;
    }
    const layer = getRaster();
    const effect = renderEffect(layer.canvas, kind, size, css);
    if (!effect) return false;
    const {canvas, padLeft, padTop} = effect;
    const context = layer.getContext(true);
    context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    context.drawImage(canvas, -padLeft, -padTop);
    return true;
};
const commonBitmapColors = function (limit) {
    const layer = getRaster();
    const {width, height} = layer.canvas;
    if (!width || !height) return [];
    const data = layer.getContext().getImageData(0, 0, width, height).data;
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue;
        const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
        const entry = counts.get(key);
        if (entry) entry.n++;
        else counts.set(key, {n: 1, r: data[i], g: data[i + 1], b: data[i + 2]});
    }
    return Array.from(counts.values())
        .filter(entry => entry.n >= 12)
        .sort((a, b) => b.n - a.n)
        .slice(0, limit)
        .map(entry => `#${[entry.r, entry.g, entry.b].map(v => v.toString(16).padStart(2, '0')).join('')}`);
};
const VECTOR_MODES = [
    Modes.LINE, Modes.RECT, Modes.OVAL, Modes.ROUNDED_RECT, Modes.TRIANGLE, Modes.ARROW,
    Modes.SUSSY, Modes.POLYGON, Modes.LASSO_SHAPE
];
const LIVE_MODES = [Modes.PEN, Modes.TEXT];
const pairs = new Map();
const BITMAP_MODES = [
    Modes.BIT_LINE, Modes.BIT_RECT, Modes.BIT_OVAL, Modes.BIT_POLYGON, Modes.BIT_LASSO_SHAPE, Modes.BIT_FILL, Modes.BIT_GRADIENT
];
let getMode = () => null;
let baseline = null;
const captureBitmap = () => {
    const raster = getRaster();
    const {width, height} = raster.canvas;
    if (!width || !height) return null;
    return {width, height, data: raster.getContext().getImageData(0, 0, width, height).data.slice()};
};
const onPointerDown = function (event) {
    if (event.button !== 0 || !paper.view || event.target !== paper.view.element) return;
    const mode = getMode();
    made.clear();
    if (LIVE_MODES.indexOf(mode) === -1) pairs.clear();
    if (VECTOR_MODES.indexOf(mode) !== -1 || LIVE_MODES.indexOf(mode) !== -1) {
        const layer = getPaintingLayer();
        baseline = layer ? {kind: 'vector', ids: new Set(layer.children.map(child => child.id))} : null;
    } else if (BITMAP_MODES.indexOf(mode) !== -1) {
        const captured = captureBitmap();
        baseline = captured ? {kind: 'bitmap', ...captured} : null;
    } else { baseline = null; }
};
const families = [];
const made = new Set();
const STYLE_PROPS = ['fillColor', 'strokeColor', 'strokeWidth', 'dashArray', 'dashOffset', 'opacity', 'blendMode', 'strokeCap', 'strokeJoin'];
const colorKey = color => (!color ? '' : color.type === 'gradient' ?
    `g${color.gradient.stops.map(stop => stop.color.toCSS(true)).join()}` : color.toCSS(true));
const styleSig = item => STYLE_PROPS.map(prop => {
    const value = item[prop];
    return prop.endsWith('Color') ? colorKey(value) : JSON.stringify(value);
}).concat(JSON.stringify(item.data && item.data.dimodLine), JSON.stringify(item.data && item.data.dimodProfile)).join('|');
const copyStyle = (from, to) => {
    STYLE_PROPS.forEach(prop => {
        const value = from[prop];
        if (value && value.type === 'gradient') return;
        to[prop] = value && value.clone ? value.clone() : value;
    });
    const line = from.data && from.data.dimodLine;
    if (line || (to.data && to.data.dimodLine)) setLineStyle(to, line ? Object.assign({}, line) : {type: 'SOLID'});
    if (from.data && from.data.dimodProfile !== (to.data && to.data.dimodProfile)) {
        to.data = Object.assign({}, to.data, {dimodProfile: from.data.dimodProfile});
        if (to.data.dimodProfile === undefined) delete to.data.dimodProfile;
    }
};
const segmentCount = item => (item.children ? item.children.reduce((sum, child) => sum + segmentCount(child), 0) :
    (item.segments ? item.segments.length : 0));
const geoSig = item => `${['x', 'y', 'width', 'height'].map(key => item.bounds[key].toFixed(1)).join()},${segmentCount(item)}`;
const linkFamily = (original, copies, matrices) => {
    const at = families.findIndex(family => family.members[0].item === original);
    if (at !== -1) families.splice(at, 1);
    families.push({members: [{item: original, m: new paper.Matrix()}].concat(copies.map((item, i) => ({item, m: matrices[i]})))
        .map(member => Object.assign(member, {style: styleSig(member.item), geo: geoSig(member.item)}))});
};
const syncFamilies = function () {
    const erasing = getMode() === Modes.ERASER;
    for (let f = families.length - 1; f >= 0; f--) {
        const {members} = families[f];
        if (pairs.has(members[0].item)) continue;
        const dead = members.filter(member => !member.item.parent);
        if (dead.length) {
            if (dead.length === 1 && erasing) members.filter(member => member.item.parent).forEach(member => member.item.remove());
            families.splice(f, 1);
            continue;
        }
        const changed = members.filter(member => member.style !== styleSig(member.item) || member.geo !== geoSig(member.item));
        if (changed.length !== 1) {
            changed.forEach(member => { member.style = styleSig(member.item); member.geo = geoSig(member.item); });
            continue;
        }
        const source = changed[0];
        const geoChanged = source.geo !== geoSig(source.item);
        members.forEach(member => {
            if (member === source) return;
            if (geoChanged) {
                const copy = source.item.clone({insert: false});
                copy.transform(member.m.clone().append(source.m.inverted()));
                copy.insertAbove(member.item);
                member.item.remove();
                member.item = copy;
                made.add(copy.id);
                copy.selected = false;
            } else { copyStyle(source.item, member.item); }
        });
        members.forEach(member => { member.style = styleSig(member.item); member.geo = geoSig(member.item); });
    }
};
let styleSnap = null;
const symmetrySync = function () {
    const layer = getPaintingLayer();
    if (!layer) return;
    const items = layer.children.filter(child => !child.guide && !child.isClipMask() && !(child.data && child.data.isHelperItem) &&
        !(child instanceof paper.Group) && !(child instanceof paper.Raster));
    const now = new Map(items.map(item => [item.id, styleSig(item)]));
    if (styleSnap) {
        const changed = items.filter(item => styleSnap.has(item.id) && styleSnap.get(item.id) !== now.get(item.id) &&
            !families.some(family => family.members.some(member => member.item === item)));
        const done = new Set(changed.map(item => item.id));
        const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
        for (const item of changed) {
            const box = item.bounds;
            const tolerance = 1 + (Math.max(box.width, box.height) * 0.01);
            for (const matrix of getMirrorMatrices()) {
                const corners = [box.topLeft, box.topRight, box.bottomLeft, box.bottomRight].map(point => matrix.transform(point));
                const xs = corners.map(point => point.x);
                const ys = corners.map(point => point.y);
                const left = Math.min(...xs);
                const top = Math.min(...ys);
                const twin = items.find(other => !done.has(other.id) && other !== item && other.className === item.className &&
                    near(other.bounds.x, left, tolerance) && near(other.bounds.y, top, tolerance) &&
                    near(other.bounds.width, Math.max(...xs) - left, tolerance) &&
                    near(other.bounds.height, Math.max(...ys) - top, tolerance) &&
                    segmentCount(other) === segmentCount(item));
                if (!twin) continue;
                copyStyle(item, twin);
                done.add(twin.id);
                now.set(twin.id, styleSig(twin));
            }
        }
    }
    styleSnap = now;
};
const mirrorAndLink = function (item) {
    const matrices = getMirrorMatrices();
    const copies = mirrorItem(item).map(copy => { copy.selected = false; return copy; });
    linkFamily(item, copies, matrices);
    return copies;
};
const applyVector = function () {
    const layer = getPaintingLayer();
    if (!layer) return;
    const fresh = layer.children.filter(child => !baseline.ids.has(child.id) && !made.has(child.id) && !child.guide &&
        !child.isClipMask() && !(child.data && child.data.isHelperItem));
    const live = LIVE_MODES.indexOf(getMode()) !== -1;
    pairs.forEach((copies, original) => {
        copies.forEach(copy => copy.remove());
        if (!original.parent) { pairs.delete(original); return; }
        pairs.set(original, mirrorAndLink(original));
    });
    for (const item of fresh) {
        const copies = mirrorAndLink(item);
        if (live) pairs.set(item, copies);
    }
    baseline.ids = new Set(layer.children.map(child => child.id));
    made.clear();
};
const applyBitmap = function () {
    const raster = getRaster();
    const now = captureBitmap();
    if (!now) return;
    if (now.width !== baseline.width || now.height !== baseline.height) { baseline = {kind: 'bitmap', ...now}; return; }
    const {width, height} = now;
    const before = baseline.data;
    const after = now.data;
    const changed = new Uint8Array(width * height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0, p = 0; p < changed.length; p++, i += 4) {
        if (after[i] !== before[i] || after[i + 1] !== before[i + 1] ||
            after[i + 2] !== before[i + 2] || after[i + 3] !== before[i + 3]) {
            changed[p] = 1;
            const x = p % width;
            const y = (p - x) / width;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < 0) return;
    const out = after.slice();
    const source = new paper.Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    for (const matrix of getMirrorMatrices()) {
        const inverse = matrix.inverted();
        if (!inverse) continue;
        const corners = [source.topLeft, source.topRight, source.bottomLeft, source.bottomRight]
            .map(point => matrix.transform(point));
        const x0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.x))));
        const x1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map(c => c.x))));
        const y0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.y))));
        const y1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map(c => c.y))));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const sx = Math.floor((inverse.a * (x + 0.5)) + (inverse.c * (y + 0.5)) + inverse.tx);
                const sy = Math.floor((inverse.b * (x + 0.5)) + (inverse.d * (y + 0.5)) + inverse.ty);
                if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
                const s = (sy * width) + sx;
                if (!changed[s]) continue;
                const d = ((y * width) + x) * 4;
                out[d] = after[s * 4];
                out[d + 1] = after[(s * 4) + 1];
                out[d + 2] = after[(s * 4) + 2];
                out[d + 3] = after[(s * 4) + 3];
            }
        }
    }
    raster.getContext(true).putImageData(new ImageData(out, width, height), 0, 0);
    baseline = {kind: 'bitmap', width, height, data: out.slice()};
};
const applyMirrorToNewArt = function () {
    if (!isMirrorActive()) { families.length = 0; styleSnap = null; return; }
    if (getPaintingLayer()) { syncFamilies(); symmetrySync(); }
    if (!baseline) return;
    if (baseline.kind === 'vector') applyVector();
    else applyBitmap();
};
const installMirrorApply = function (modeGetter) {
    getMode = modeGetter;
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => { window.removeEventListener('pointerdown', onPointerDown, true); baseline = null; };
};
const SelectStyles = {BOX: 'BOX', LASSO: 'LASSO', POLYGON: 'POLYGON', WAND: 'WAND'};
const WandMatches = {FILL: 'FILL', OUTLINE: 'OUTLINE', BOTH: 'BOTH', NEAR: 'NEAR'};
let currentStyle = SelectStyles.BOX;
let wandTolerance = 32;
let wandMatch = WandMatches.FILL;
const getSelectStyle = () => currentStyle;
const setCurrentSelectStyle = style => { currentStyle = SelectStyles[style] ? style : SelectStyles.BOX; };
const getWandTolerance = () => wandTolerance;
const getWandMatch = () => wandMatch;
const setCurrentWandMatch = value => { wandMatch = WandMatches[value] ? value : WandMatches.FILL; };
const setCurrentWandTolerance = value => { wandTolerance = Math.max(0, Math.min(255, Number(value) || 0)); };
const colorKeyOf = function (item) {
    const pick = color => {
        if (!color) return null;
        if (color.gradient) return `g:${color.gradient.stops.map(stop => stop.color.toCSS(true)).join(',')}`;
        if (color.alpha === 0) return null;
        return color.toCSS(true);
    };
    const outline = () => {
        const color = item.strokeWidth > 0 ? pick(item.strokeColor) : null;
        return color ? `${color}@${Math.round(item.strokeWidth * 100) / 100}` : null;
    };
    if (wandMatch === WandMatches.OUTLINE) return outline();
    if (wandMatch === WandMatches.BOTH) {
        const fill = pick(item.fillColor);
        const line = outline();
        return fill || line ? `${fill}|${line}` : null;
    }
    return pick(item.fillColor) || pick(item.strokeColor);
};
const artworkAt = function (point, hitOptions) {
    let best = null;
    for (const result of paper.project.hitTestAll(point, hitOptions)) {
        const item = result.item;
        if (!item || (item.data && item.data.isHelperItem)) continue;
        if (!item.layer || !item.layer.data || !item.layer.data.isPaintingLayer) continue;
        if (!best || sortItemsByZIndex(best, item) < 0) best = item;
    }
    return best;
};
const hitsHandle = function (point, hitOptions) {
    return paper.project.hitTestAll(point, hitOptions).some(result => {
        const data = result.item && result.item.data;
        return Boolean(data && (data.isScaleHandle || data.isRotHandle || data.isPivotHandle));
    });
};
const wandSelectNear = function (point, hit) {
    const radius = wandTolerance;
    let any = false;
    for (const root of getAllSelectableRootItems()) {
        const leaves = root.children ?
            root.getItems({recursive: true, match: item => !(item instanceof paper.Group)}) :
            [root];
        const near = leaves.some(leaf => {
            if (leaf === hit || leaf.contains(point)) return true;
            if (typeof leaf.getNearestPoint !== 'function') return false;
            if (!leaf.bounds.expand(radius * 2).contains(point)) return false;
            return leaf.getNearestPoint(point).getDistance(point) <= radius;
        });
        if (near) { setItemSelection(root, true, true); any = true; }
    }
    return any;
};
const wandSelectVector = function (hit, point) {
    if (wandMatch === WandMatches.NEAR) return wandSelectNear(point, hit);
    const key = colorKeyOf(hit);
    if (!key) return false;
    let any = false;
    for (const root of getAllSelectableRootItems()) {
        const leaves = root.children ?
            root.getItems({recursive: true, match: item => !(item instanceof paper.Group)}) :
            [root];
        if (leaves.some(leaf => colorKeyOf(leaf) === key)) { setItemSelection(root, true, true ); any = true; }
    }
    return any;
};
const startLasso = function (start, styleLike) {
    const path = new paper.Path({segments: [start], closed: true});
    styleLike(path);
    path.data.isLassoSelect = true;
    return path;
};
const extendLasso = function (path, point) {
    const last = path.lastSegment.point;
    if (last.getDistance(point) * paper.view.zoom < 2) return;
    path.add(point);
};
const pixelRect = function (bounds) {
    const left = Math.max(0, Math.floor(bounds.left));
    const top = Math.max(0, Math.floor(bounds.top));
    const right = Math.min(ART_BOARD_WIDTH, Math.ceil(bounds.right));
    const bottom = Math.min(ART_BOARD_HEIGHT, Math.ceil(bounds.bottom));
    return new paper.Rectangle(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
};
const maskFromLasso = function (path) {
    const rect = pixelRect(path.bounds);
    if (!rect.width || !rect.height || path.segments.length < 3) return null;
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext('2d');
    context.beginPath();
    path.segments.forEach((segment, i) => {
        const x = segment.point.x - rect.x;
        const y = segment.point.y - rect.y;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
    const alpha = context.getImageData(0, 0, rect.width, rect.height).data;
    const mask = new Uint8Array(rect.width * rect.height);
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[(i * 4) + 3] >= 128 ? 1 : 0;
    return {rect, mask};
};
const maskFromWand = function (x, y, tolerance) {
    x = Math.floor(x);
    y = Math.floor(y);
    const width = ART_BOARD_WIDTH;
    const height = ART_BOARD_HEIGHT;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const data = getRaster().getContext()
        .getImageData(0, 0, width, height).data;
    const start = ((y * width) + x) * 4;
    const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
    const matches = offset => {
        const a = data[offset + 3];
        if (target[3] === 0 || a === 0) return Math.abs(a - target[3]) <= tolerance;
        return Math.abs(data[offset] - target[0]) <= tolerance &&
            Math.abs(data[offset + 1] - target[1]) <= tolerance &&
            Math.abs(data[offset + 2] - target[2]) <= tolerance &&
            Math.abs(a - target[3]) <= tolerance;
    };
    const mask = new Uint8Array(width * height);
    const stack = [(y * width) + x];
    mask[stack[0]] = 1;
    while (stack.length) {
        const index = stack.pop();
        const px = index % width;
        const py = (index - px) / width;
        const visit = next => {
            if (!mask[next] && matches(next * 4)) { mask[next] = 1; stack.push(next); }
        };
        if (px > 0) visit(index - 1);
        if (px < width - 1) visit(index + 1);
        if (py > 0) visit(index - width);
        if (py < height - 1) visit(index + width);
    }
    return {rect: new paper.Rectangle(0, 0, width, height), mask};
};
const liftBitmapSelection = function (selection) {
    if (!selection) return null;
    const {rect, mask} = selection;
    if (!rect.width || !rect.height) return null;
    const layer = getRaster();
    const layerContext = layer.getContext(true );
    const source = layerContext.getImageData(rect.x, rect.y, rect.width, rect.height);
    const lifted = new ImageData(rect.width, rect.height);
    let left = rect.width;
    let top = rect.height;
    let right = -1;
    let bottom = -1;
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const o = i * 4;
        if (source.data[o + 3] === 0) continue;
        lifted.data[o] = source.data[o];
        lifted.data[o + 1] = source.data[o + 1];
        lifted.data[o + 2] = source.data[o + 2];
        lifted.data[o + 3] = source.data[o + 3];
        source.data[o + 3] = 0;
        const px = i % rect.width;
        const py = (i - px) / rect.width;
        if (px < left) left = px;
        if (px > right) right = px;
        if (py < top) top = py;
        if (py > bottom) bottom = py;
    }
    if (right < 0) return null;
    const hit = new paper.Rectangle(rect.x + left, rect.y + top, right - left + 1, bottom - top + 1);
    const liftedCanvas = document.createElement('canvas');
    liftedCanvas.width = rect.width;
    liftedCanvas.height = rect.height;
    liftedCanvas.getContext('2d').putImageData(lifted, 0, 0);
    const raster = layer.getSubRaster(hit);
    const context = raster.getContext(true );
    context.clearRect(0, 0, hit.width, hit.height);
    context.drawImage(liftedCanvas, left, top, hit.width, hit.height, 0, 0, hit.width, hit.height);
    raster.parent = paper.project.activeLayer;
    raster.canvas.getContext('2d').imageSmoothingEnabled = false;
    raster.selected = true;
    const expanded = layer.getSubRaster(hit.expand(8));
    expanded.remove();
    const expandedContext = expanded.getContext(true );
    expandedContext.clearRect(0, 0, expanded.width, expanded.height);
    expandedContext.drawImage(raster.canvas, 4, 4);
    raster.data = {expanded};
    layerContext.putImageData(source, rect.x, rect.y);
    return raster;
};
const SYMBOL_KIND = 'symbol';
const SymbolScopes = {COSTUME: 'costume', SPRITE: 'sprite', GLOBAL: 'global'};
const THUMBNAIL_SIZE = 40;
const SYMBOL_ID_LENGTH = 6;
const PRECISION = 5;
const _thumbnails = new Map();
const STORAGE_KEY = 'dimod-paint/symbols/1';
const MAX_SYMBOLS = 200;
let _library = null;
let _spriteId = null;
const setSpriteScope = function (spriteId) {
    const next = spriteId || null;
    if (next === _spriteId) return false;
    _spriteId = next;
    return true;
};
const getSpriteScope = function () { return _spriteId; };
const isSymbolInScope = function (symbol) {
    if (!symbol) return false;
    if (symbol.scope === SymbolScopes.SPRITE) { return Boolean(_spriteId) && symbol.spriteId === _spriteId; }
    return true;
};
const _normalizeSymbol = function (symbol) {
    if (typeof symbol.rev !== 'number' || !isFinite(symbol.rev)) symbol.rev = 1;
    const scopes = [SymbolScopes.COSTUME, SymbolScopes.SPRITE, SymbolScopes.GLOBAL];
    if (scopes.indexOf(symbol.scope) === -1) symbol.scope = SymbolScopes.GLOBAL;
    if (symbol.scope !== SymbolScopes.SPRITE) delete symbol.spriteId;
    return symbol;
};
const _round = function (n) { const factor = Math.pow(10, PRECISION); return Math.round(n * factor) / factor; };
const _docTable = function () {
    const doc = getDoc();
    if (!doc.symbols || typeof doc.symbols !== 'object' || Array.isArray(doc.symbols)) { doc.symbols = {}; }
    return doc.symbols;
};
const _table = function () {
    if (_library) return _library;
    _library = {};
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
            for (const id of Object.keys(stored)) {
                const symbol = stored[id];
                if (symbol && typeof symbol.json === 'string') {
                    _library[id] = _normalizeSymbol({
                        id,
                        name: String(symbol.name || 'Symbol'),
                        json: symbol.json,
                        rev: symbol.rev,
                        scope: symbol.scope,
                        spriteId: symbol.spriteId
                    });
                }
            }
        }
    } catch (error) { log.warn('dimod: could not read the symbol library.', error); }
    return _library;
};
const saveLibrary = function () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_table())); } catch (error) { log.warn('dimod: could not save the symbol library.', error); }
};
const resetSymbolLibrary = function () { _library = null; _thumbnails.clear(); };
const _tableFor = function (symbol) { return symbol.scope === SymbolScopes.COSTUME ? _docTable() : _table(); };
const freshSymbolId = function () {
    const table = _table();
    for (;;) {
        let id = '';
        for (let i = 0; i < SYMBOL_ID_LENGTH; i++) { id += Math.floor(Math.random() * 36).toString(36); }
        if (!table[id]) return id;
    }
};
const getSymbols = function () {
    const table = Object.assign({}, _docTable(), _table());
    return Object.keys(table)
        .map(id => _normalizeSymbol(table[id]))
        .filter(isSymbolInScope)
        .sort((a, b) => {
            if (a.name !== b.name) return a.name < b.name ? -1 : 1;
            return a.id < b.id ? -1 : 1;
        });
};
const getSymbol = function (id) {
    if (!id) return null;
    const symbol = _table()[id] || _docTable()[id] || null;
    return symbol ? _normalizeSymbol(symbol) : null;
};
const getInstanceSymbolId = function (item) { return (item && item.data && item.data.symbolId) || null; };
const isInstance = function (item) { const id = getInstanceSymbolId(item); return Boolean(id && getSymbol(id)); };
const getInstances = function (symbolId) {
    const found = [];
    walkItems(item => {
        const id = getInstanceSymbolId(item);
        if (id && (!symbolId || id === symbolId)) found.push(item);
    });
    return found;
};
const countInstances = function (symbolId) { return getInstances(symbolId).length; };
const adoptDocSymbols = function () {
    if (!SYMBOLS_ENABLED) return 0;
    const library = _table();
    const docSymbols = _docTable();
    let changed = 0;
    for (const id of Object.keys(docSymbols)) {
        const incoming = docSymbols[id];
        if (!incoming || typeof incoming.json !== 'string') continue;
        _normalizeSymbol(incoming);
        if (incoming.scope === SymbolScopes.COSTUME) continue;
        const existing = library[id];
        if (!existing) {
            if (Object.keys(library).length >= MAX_SYMBOLS) {
                log.warn(`dimod: the symbol library is full (${MAX_SYMBOLS}); not adopting more.`);
                break;
            }
            library[id] = Object.assign({}, incoming);
            changed++;
            continue;
        }
        if (existing.json === incoming.json) continue;
        if (incoming.rev > existing.rev) { Object.assign(existing, incoming); changed++; continue; }
        if (incoming.rev < existing.rev) { continue; }
        const renamed = freshSymbolId();
        library[renamed] = Object.assign({}, incoming, {id: renamed});
        for (const instance of getInstances(id)) { instance.data.symbolId = renamed; }
        changed++;
    }
    if (changed) saveLibrary();
    return changed;
};
const writeUsedSymbolsToDoc = function () {
    if (!SYMBOLS_ENABLED) return 0;
    const doc = getDoc();
    const used = {};
    for (const instance of getInstances()) {
        const id = getInstanceSymbolId(instance);
        const symbol = getSymbol(id);
        if (symbol) {
            used[id] = {id: symbol.id, name: symbol.name, json: symbol.json, rev: symbol.rev, scope: symbol.scope};
            if (symbol.spriteId) used[id].spriteId = symbol.spriteId;
        }
    }
    doc.symbols = used;
    return Object.keys(used).length;
};
const _stripIdentity = function (item) {
    if (item.data) {
        delete item.data.did;
        delete item.data.dimod;
        delete item.data.symbolId;
        delete item.data.symbolPlacement;
    }
    if (item.children) {
        for (const child of item.children) _stripIdentity(child);
    }
};
const _bodyFromItems = function (items) {
    const usable = items.filter(item => item && !item.guide && !(item.isClipMask && item.isClipMask()));
    if (!usable.length) return null;
    const group = new paper.Group(usable.map(item => item.clone({insert: false, deep: true})));
    group.applyMatrix = true;
    _stripIdentity(group);
    const offset = group.bounds.center.clone();
    group.translate(offset.multiply(-1));
    const json = group.exportJSON({asString: true, precision: PRECISION});
    group.remove();
    return {json, offset};
};
const _bake = function (definition) {
    let item;
    try { item = paper.project.importJSON(definition.json); } catch (error) { log.warn(`dimod: could not bake symbol ${definition.id}.`, error); return null; }
    if (!item) return null;
    if (!(item instanceof paper.Group)) { const group = new paper.Group([item]); item = group; }
    item.applyMatrix = true;
    item.matrix.reset();
    item.applyMatrix = false;
    item.data = Object.assign({}, item.data, {symbolId: definition.id});
    return item;
};
const _place = function (body, placement) { body.applyMatrix = false; body.matrix.reset(); body.transform(placement); };
const detachInstance = function (item) {
    if (!item || !item.data || !item.data.symbolId) return false;
    delete item.data.symbolId;
    delete item.data.symbolPlacement;
    if (item.applyMatrix === false) item.applyMatrix = true;
    return true;
};
const detachInstanceContaining = function (item) {
    for (let candidate = item; candidate; candidate = candidate.parent) {
        if (getInstanceSymbolId(candidate)) { return detachInstance(candidate) ? candidate : null; }
    }
    return null;
};
const getSymbolThumbnail = function (symbolId) {
    const symbol = getSymbol(symbolId);
    if (!symbol || !paper.project) return null;
    const cached = _thumbnails.get(symbolId);
    if (cached && cached.json === symbol.json) return cached.url;
    let url = null;
    let item = null;
    try {
        item = paper.project.importJSON(symbol.json);
        if (item) {
            const bounds = item.strokeBounds;
            if (bounds.width > 0 && bounds.height > 0) {
                const node = item.exportSVG({asString: false});
                const body = typeof XMLSerializer === 'undefined' ?
                    node.outerHTML :
                    new XMLSerializer().serializeToString(node);
                const viewBox = `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`;
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_SIZE}" ` +
                    `height="${THUMBNAIL_SIZE}" viewBox="${viewBox}" ` +
                    `preserveAspectRatio="xMidYMid meet">${body}</svg>`;
                url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
            }
        }
    } catch (error) { log.warn(`dimod: could not draw a thumbnail for symbol ${symbolId}.`, error); } finally {
        if (item) item.remove();
    }
    _thumbnails.set(symbolId, {json: symbol.json, url});
    return url;
};
const describeSymbols = function () {
    if (!SYMBOLS_ENABLED) return [];
    const symbols = getSymbols();
    const counts = new Map();
    for (const instance of getInstances()) {
        const id = getInstanceSymbolId(instance);
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    const live = new Set(symbols.map(symbol => symbol.id));
    for (const id of [..._thumbnails.keys()]) {
        if (!live.has(id)) _thumbnails.delete(id);
    }
    return symbols.map(symbol => ({
        id: symbol.id,
        name: symbol.name,
        scope: symbol.scope,
        instances: counts.get(symbol.id) || 0,
        thumbnail: getSymbolThumbnail(symbol.id)
    }));
};
const createSymbol = function (name, items, scope) {
    for (const item of items) {
        if (getInstanceSymbolId(item)) detachInstance(item);
    }
    const body = _bodyFromItems(items);
    if (!body) return null;
    const anchor = items.reduce((best, item) => {
        if (best === null || item.index > best.index) return item;
        return best;
    }, null);
    const parent = anchor.parent;
    const index = anchor.index;
    const symbol = _normalizeSymbol({
        id: freshSymbolId(),
        name: name || 'Symbol',
        json: body.json,
        rev: 1,
        scope: scope || SymbolScopes.GLOBAL,
        spriteId: _spriteId
    });
    _tableFor(symbol)[symbol.id] = symbol;
    const instance = _bake(symbol);
    if (!instance) { delete _tableFor(symbol)[symbol.id]; return null; }
    saveLibrary();
    _place(instance, new paper.Matrix().translate(body.offset));
    parent.insertChild(index, instance);
    for (const item of items) item.remove();
    return {symbol, instance};
};
const placeInstance = function (symbolId, position, parent) {
    const symbol = getSymbol(symbolId);
    if (!symbol) return null;
    const instance = _bake(symbol);
    if (!instance) return null;
    _place(instance, new paper.Matrix().translate(position || new paper.Point()));
    if (parent) parent.addChild(instance);
    return instance;
};
const redefineSymbol = function (symbolId, items) {
    const symbol = getSymbol(symbolId);
    if (!symbol) return null;
    for (const item of items) {
        if (getInstanceSymbolId(item)) detachInstance(item);
    }
    const body = _bodyFromItems(items);
    if (!body) return null;
    const anchor = items.reduce((best, item) => {
        if (best === null || item.index > best.index) return item;
        return best;
    }, null);
    const parent = anchor.parent;
    const index = anchor.index;
    symbol.json = body.json;
    symbol.rev = (symbol.rev || 1) + 1;
    saveLibrary();
    const instance = _bake(symbol);
    if (!instance) return null;
    _place(instance, new paper.Matrix().translate(body.offset));
    parent.insertChild(index, instance);
    for (const item of items) item.remove();
    markDirty(SYMBOL_KIND, symbolId);
    return instance;
};
const renameSymbol = function (symbolId, name) {
    const symbol = getSymbol(symbolId);
    if (!symbol) return false;
    symbol.name = name || symbol.name;
    saveLibrary();
    return true;
};
const setSymbolScope = function (symbolId, scope) {
    const symbol = getSymbol(symbolId);
    if (!symbol) return false;
    const scopes = [SymbolScopes.COSTUME, SymbolScopes.SPRITE, SymbolScopes.GLOBAL];
    if (scopes.indexOf(scope) === -1) return false;
    delete _table()[symbolId];
    delete _docTable()[symbolId];
    symbol.scope = scope;
    if (scope === SymbolScopes.SPRITE) { symbol.spriteId = _spriteId; } else { delete symbol.spriteId; }
    _normalizeSymbol(symbol);
    _tableFor(symbol)[symbolId] = symbol;
    saveLibrary();
    return true;
};
const deleteSymbol = function (symbolId) {
    if (!getSymbol(symbolId)) return 0;
    const instances = getInstances(symbolId);
    for (const instance of instances) detachInstance(instance);
    delete _table()[symbolId];
    delete _docTable()[symbolId];
    saveLibrary();
    return instances.length;
};
const rebakeInstances = function (symbolId) {
    const symbol = getSymbol(symbolId);
    if (!symbol) return 0;
    const instances = getInstances(symbolId);
    let rebuilt = 0;
    for (const instance of instances) {
        const placement = instance.data.symbolPlacement ?
            instance.data.symbolPlacement.clone() :
            instance.matrix.clone();
        const parent = instance.parent;
        if (!parent) continue;
        const index = instance.index;
        const fresh = _bake(symbol);
        if (!fresh) continue;
        _place(fresh, placement);
        fresh.selected = instance.selected;
        parent.insertChild(index, fresh);
        instance.remove();
        rebuilt++;
    }
    return rebuilt;
};
const markSymbolDirty = function (symbolId) { markDirty(SYMBOL_KIND, symbolId); };
const readSymbolPlacement = function (item) {
    if (!SYMBOLS_ENABLED) {
        const stored = item && item.data && item.data.dimod && item.data.dimod.symbol;
        return stored || null;
    }
    const symbolId = getInstanceSymbolId(item);
    if (!symbolId) return null;
    const matrix = item.matrix;
    const translation = toPersistedArray(new paper.Point(matrix.tx, matrix.ty));
    return [symbolId, _round(matrix.a), _round(matrix.b), _round(matrix.c), _round(matrix.d), translation[0], translation[1]];
};
const writeSymbolPlacement = function (item, value) {
    if (!SYMBOLS_ENABLED) return;
    if (!Array.isArray(value) || value.length < 7) return;
    const [symbolId, a, b, c, d, tx, ty] = value;
    if (!getSymbol(symbolId)) return;
    const translation = fromPersisted(new paper.Point(Number(tx), Number(ty)));
    if (!item.data) item.data = {};
    item.data.symbolId = symbolId;
    item.data.symbolPlacement = new paper.Matrix(Number(a), Number(b), Number(c), Number(d), translation.x, translation.y);
};
const serializeSymbolPlacement = function (value) { return value.join(','); };
const parseSymbolPlacement = function (string) {
    const parts = String(string).split(',');
    if (parts.length < 7) return null;
    const numbers = parts.slice(1).map(Number);
    if (numbers.some(isNaN)) return null;
    return [parts[0], ...numbers];
};
const rebakeImported = function () {
    if (!SYMBOLS_ENABLED) return 0;
    const pending = new Set();
    walkItems(item => {
        const symbolId = getInstanceSymbolId(item);
        if (symbolId && getSymbol(symbolId)) pending.add(symbolId);
    });
    let rebuilt = 0;
    for (const symbolId of pending) rebuilt += rebakeInstances(symbolId);
    return rebuilt;
};
const pruneSymbols = function (keepUnused = true) {
    if (keepUnused) return [];
    const dropped = [];
    for (const symbol of getSymbols()) {
        if (countInstances(symbol.id) === 0) { delete _table()[symbol.id]; dropped.push(symbol.id); }
    }
    return dropped;
};
registerKind(SYMBOL_KIND, {
    propagate: keys => {
        for (const symbolId of keys) rebakeInstances(symbolId);
    },
    onBreak: symbolId => {
        for (const instance of getInstances(symbolId)) detachInstance(instance);
    }
});
const ATTRIBUTE_PREFIX = 'data-dimod-';
const FIELDS = [{
    name: 'pivot',
    read: item => { const pivot = getPivot(item); return pivot ? toPersistedArray(pivot) : null; },
    write: (item, value) => {
        const point = fromPersistedArray(value);
        if (point) setPivot(item, point);
    },
    serialize: value => value.join(','),
    parse: string => {
        const parts = string.split(',');
        if (parts.length !== 2) return null;
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        return isNaN(x) || isNaN(y) ? null : [x, y];
    }
}, {
    name: 'symbol',
    read: readSymbolPlacement,
    write: writeSymbolPlacement,
    serialize: serializeSymbolPlacement,
    parse: parseSymbolPlacement
}, {
    name: 'name',
    read: item => (item.data && typeof item.data.layerName === 'string' && item.data.layerName) || null,
    write: (item, value) => { item.data.layerName = value; },
    serialize: value => value,
    parse: string => string.slice(0, 200) || null
}, {
    name: 'locked',
    read: item => {
        if (item.locked) return 1;
        return null;
    },
    write: (item, value) => {
        if (value) item.locked = true;
    },
    serialize: () => '1',
    parse: string => {
        if (string === '1') return 1;
        return null;
    }
}, {
    name: 'angle',
    read: item => {
        const a = item.data && item.data.dimodAngle;
        return a && Math.abs(a) > 0.01 ? Math.round(a * 100) / 100 : null;
    },
    write: (item, value) => { item.data.dimodAngle = value; },
    serialize: value => String(value),
    parse: string => (isFinite(Number(string)) ? Number(string) : null)
}];
const getItemData = function (item) { return (item && item.data && item.data.dimod) || null; };
const syncItemData = function (item) {
    const data = {};
    let any = false;
    for (const field of FIELDS) {
        const value = field.read(item);
        if (value === null) continue;
        data[field.name] = value;
        any = true;
    }
    if (!item.data) item.data = {};
    if (any) { item.data.dimod = data; } else { delete item.data.dimod; }
    return any ? data : null;
};
const applyItemData = function (item) {
    const data = getItemData(item);
    if (!data) return;
    for (const field of FIELDS) {
        if (field.name in data) field.write(item, data[field.name]);
    }
};
const writeItemDataAttributes = function (item, node) {
    const data = getItemData(item);
    for (const field of FIELDS) {
        const attribute = ATTRIBUTE_PREFIX + field.name;
        if (data && field.name in data) {
            node.setAttribute(attribute, field.serialize(data[field.name]));
        } else if (node.removeAttribute) { node.removeAttribute(attribute); }
    }
};
const readItemDataAttributes = function (item, node) {
    const data = {};
    let any = false;
    for (const field of FIELDS) {
        const raw = node.getAttribute(ATTRIBUTE_PREFIX + field.name);
        if (typeof raw !== 'string') continue;
        const value = field.parse(raw);
        if (value === null) continue;
        data[field.name] = value;
        any = true;
    }
    if (!any) return;
    if (!item.data) item.data = {};
    item.data.dimod = data;
};
const stampOnExport = function (item, node) {
    if (!node.setAttribute) return node;
    const did = getDid(item);
    if (did) node.setAttribute('id', didToAttribute(did));
    writeItemDataAttributes(item, node);
    return profileOnExport(item, node);
};
const readOnImport = function (node, item) {
    if (!item || !node.getAttribute) return item;
    const did = attributeToDid(node.getAttribute('id'));
    if (did) setDid(item, did);
    readItemDataAttributes(item, node);
    return profileOnImport(node, item);
};
const exportOptions = function () { return {onExport: stampOnExport}; };
const importOptions = function () { return {onImport: readOnImport}; };
const adoptDocFromSvg = function (svgDom) { setDoc(readDoc(svgDom)); };
const syncDocFromItems = function () {
    runPass();
    reconcile();
    walkItems(syncItemData);
    writeUsedSymbolsToDoc();
};
const restoreItemsFromDoc = function () {
    reconcile();
    walkItems(applyItemData);
    rebakeImported();
    adoptDocSymbols();
};
const injectDocIntoSvg = function (svgRoot) { writeDoc(svgRoot, getDoc()); return svgRoot; };
export {ATTRIBUTE_PREFIX, AlignEdges, AlignReferences, DistributeAxes, FIELDS, HIT_TOLERANCE, MAX_SYMBOLS, STORAGE_KEY, SYMBOL_KIND, SelectStyles, SymbolScopes, THUMBNAIL_SIZE, WandMatches, adoptDocFromSvg, adoptDocSymbols, alignItems, applyBitmapEffect, applyItemData, applyMirrorToNewArt, applyStyleToSelection, artworkAt, colorKeyOf, commonBitmapColors, countInstances, createSymbol, deleteSymbol, describeSymbols, detachInstance, detachInstanceContaining, distributeItems, exportOptions, extendLasso, fillMask, freshSymbolId, fromPersisted, fromPersistedArray, getInstanceSymbolId, getInstances, getItemData, getReferenceRect, getRotation, getSelectStyle, getSpriteScope, getSymbol, getSymbolThumbnail, getSymbols, getWandMatch, getWandTolerance, hitsHandle, importOptions, injectDocIntoSvg, installGridSnap, installMirrorApply, installViewGestures, isGridSnapOn, isInstance, isSymbolInScope, itemAt, liftBitmapSelection, markSymbolDirty, maskFromLasso, maskFromWand, maskToCanvas, parseSymbolPlacement, placeInstance, pruneSymbols, readItemDataAttributes, readOnImport, readStyle, readSymbolPlacement, rebakeImported, rebakeInstances, redefineSymbol, renameSymbol, resetSymbolLibrary, restoreItemsFromDoc, sampleStyleAt, saveLibrary, serializeSymbolPlacement, setCurrentSelectStyle, setCurrentWandMatch, setCurrentWandTolerance, setGridSnapOption, setSpriteScope, setSymbolScope, setViewRotation, snapToGrid, stampOnExport, startLasso, syncDocFromItems, syncItemData, toPersisted, toPersistedArray, wandSelectVector, writeItemDataAttributes, writeSymbolPlacement, writeUsedSymbolsToDoc};
