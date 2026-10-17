import paper from '@turbowarp/paper';
import Modes from '../lib/modes';
import {getPaintingLayer} from './store';
const addSegments = (p2d, path) => {
    const segments = path._segments;
    const length = segments.length;
    if (!length) return;
    let prevX;
    let prevY;
    let outX;
    let outY;
    let first = true;
    const add = segment => {
        const point = segment._point;
        const curX = point._x;
        const curY = point._y;
        if (first) { p2d.moveTo(curX, curY); first = false; } else {
            const handleIn = segment._handleIn;
            const inX = curX + handleIn._x;
            const inY = curY + handleIn._y;
            if (inX === curX && inY === curY && outX === prevX && outY === prevY) { p2d.lineTo(curX, curY); } else { p2d.bezierCurveTo(outX, outY, inX, inY, curX, curY); }
        }
        prevX = curX;
        prevY = curY;
        const handleOut = segment._handleOut;
        outX = prevX + handleOut._x;
        outY = prevY + handleOut._y;
    };
    for (let i = 0; i < length; i++) add(segments[i]);
    if (path._closed) { add(segments[0]); p2d.closePath(); }
};
const pathFor = item => {
    let p2d = item.__dimodPath2D;
    if (p2d) return p2d;
    p2d = new Path2D();
    if (item instanceof paper.CompoundPath) {
        for (const child of item._children) {
            if (!child._matrix.isIdentity()) return null;
            addSegments(p2d, child);
        }
    } else { addSegments(p2d, item); }
    Object.defineProperty(item, '__dimodPath2D', {value: p2d, writable: true, configurable: true});
    return p2d;
};
const forget = item => {
    if (item.__dimodPath2D) item.__dimodPath2D = null;
};
const wrapChanged = Klass => {
    const original = Klass.prototype._changed;
    Klass.prototype._changed = function (flags, ...rest) {
        if (flags & 0xA) {
            forget(this);
            const parent = this._parent;
            if (parent instanceof paper.CompoundPath) forget(parent);
        }
        return original.call(this, flags, ...rest);
    };
};
wrapChanged(paper.Path);
wrapChanged(paper.CompoundPath);
const paint = (item, ctx, param, viewMatrix, strokeMatrix, p2d) => {
    const style = item.getStyle();
    const hasFill = style.hasFill();
    const hasStroke = style.hasStroke();
    if (!hasFill && !hasStroke) return;
    item._setStyles(ctx, param, viewMatrix, strokeMatrix);
    if (hasFill) { ctx.fill(p2d, style.getFillRule()); ctx.shadowColor = 'rgba(0,0,0,0)'; }
    if (hasStroke) ctx.stroke(p2d);
};
const usable = (item, param, strokeMatrix) => !param.clip && !param.dontStart && !param.dontFinish &&
    !strokeMatrix && !(item._data && (item._data.dimodProfile || (item._data.dimodLine && item._data.dimodLine.type === 'BRUSH'))) && !window.__dimodNoPath2D;
const wrapDraw = Klass => {
    const original = Klass.prototype._draw;
    Klass.prototype._draw = function (ctx, param, viewMatrix, strokeMatrix) {
        if (!usable(this, param, strokeMatrix)) return original.call(this, ctx, param, viewMatrix, strokeMatrix);
        if (this instanceof paper.CompoundPath ? !this._children.length : !this._segments.length) return;
        const p2d = pathFor(this);
        if (!p2d) return original.call(this, ctx, param, viewMatrix, strokeMatrix);
        paint(this, ctx, param, viewMatrix, strokeMatrix, p2d);
    };
};
wrapDraw(paper.Path);
wrapDraw(paper.CompoundPath);
const path2dDraw = null;
const MIN_STATIC = 24;
const GIVE_UP_AFTER = 2;
const VIEW_SETTLE_MS = 140;
const PARTIAL_LIMIT = 0.5;
const SLOW_LIVE_MS = 10;
let changeVersion = 0;
let mark = null;
let staticDirty = true;
let pressed = false;
let pressLength = null;
let liveFrom = null;
const rootIn = (item, layer) => {
    let node = item;
    while (node && node._parent !== layer) node = node._parent;
    return node;
};
const MARK_LIMIT = 4096;
const noteContentChange = (item, flags) => {
    if (item instanceof paper.Layer) {
        if (item === mark.layer && !(flags & 2)) mark.dirty = true;
        return;
    }
    let root = item;
    while (root._parent && !(root._parent instanceof paper.Layer)) root = root._parent;
    if (mark.roots.size >= MARK_LIMIT) mark.dirty = true;
    else mark.roots.add(root);
};
const originalChanged = paper.Project.prototype._changed;
paper.Project.prototype._changed = function (flags, item) {
    const layer = item ? (item instanceof paper.Layer ? item : item.getLayer()) : null;
    if (!item || !(item._guide || (layer && layer.data && layer.data.isGuideLayer))) changeVersion++;
    if (item && layer && layer.data && layer.data.isPaintingLayer) {
        if (item === layer) {
            if ((flags & 1) && !(flags & 2)) staticDirty = true;
        } else {
            const root = rootIn(item, layer);
            if (root) {
                root.__dimodBounds = null;
                if ((flags & 1) && cache$2.itemSet && cache$2.itemSet.has(root)) dirtyRoots.add(root);
            }
        }
    }
    if (mark && item && flags !== 256 && flags !== 257) noteContentChange(item, flags);
    return originalChanged.call(this, flags, item);
};
const onDown = event => {
    if (!paper.view || event.target !== paper.view.element) return;
    pressed = true;
    liveFrom = null;
    const layer = paintingLayer();
    pressLength = layer ? layer._children.length : 0;
};
const onUp = () => {
    pressed = false;
    live.slow = false;
    liveFrom = null;
    pressLength = null;
};
if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onUp);
}
const paintingLayer = () => {
    const project = paper.project;
    if (!project) return null;
    return project.layers.find(layer => layer.data && layer.data.isPaintingLayer) || null;
};
const firstLive = layer => {
    const children = layer._children;
    if (!pressed) return children.length;
    if (liveFrom === null) {
        let from = Math.min(pressLength === null ? children.length : pressLength, children.length);
        const selected = layer._project._selectionItems;
        for (const id in selected) {
            const root = rootIn(selected[id], layer);
            if (root && root._index < from) from = root._index;
        }
        liveFrom = from;
    }
    return liveFrom;
};
const cache$2 = {canvas: null, size: null, t: null, items: null, itemSet: null, bounds: null, misses: 0, settled: true};
const dirtyRoots = new Set();
let settleTimer = null;
const boundsOf = item => {
    let bounds = item.__dimodBounds;
    if (!bounds) {
        bounds = item.strokeBounds;
        Object.defineProperty(item, '__dimodBounds', {value: bounds, writable: true, configurable: true});
    }
    return bounds;
};
const sameTransform = (a, b) => a && b && a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d &&
    a.e === b.e && a.f === b.f;
const viewRect = () => { const view = paper.view; const pad = 4 / (view.zoom || 1); return view.bounds.expand(pad); };
const drawItems = (ctx, layer, inner, list, area) => {
    const clipItem = layer._getClipItem();
    if (clipItem) clipItem.draw(ctx, inner.extend({clip: true}));
    for (const item of list) {
        if (item === clipItem) continue;
        if (area && !boundsOf(item).intersects(area)) continue;
        item.draw(ctx, inner);
    }
};
const toDevice = (rect, t) => {
    const xs = [];
    const ys = [];
    for (const [x, y] of [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]]) {
        xs.push((t.a * x) + (t.c * y) + t.e);
        ys.push((t.b * x) + (t.d * y) + t.f);
    }
    const left = Math.floor(Math.min(...xs)) - 2;
    const top = Math.floor(Math.min(...ys)) - 2;
    return {x: left, y: top, w: Math.ceil(Math.max(...xs)) + 2 - left, h: Math.ceil(Math.max(...ys)) + 2 - top};
};
const remember = (list, from) => {
    cache$2.items = list;
    cache$2.itemSet = new Set(list);
    cache$2.bounds = new Map();
    for (const item of list) cache$2.bounds.set(item, boundsOf(item));
    dirtyRoots.clear();
};
const requestSettle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { cache$2.settled = true; requestRedraw(); }, VIEW_SETTLE_MS);
};
const live = {canvas: null, slow: false};
const drawLayer = function (ctx, param, viewMatrix, strokeMatrix) {
    if (param.clip || !(this.data && this.data.isPaintingLayer) || window.__dimodNoRenderCache ||
            typeof ctx.getTransform !== 'function') { return originalDraw.call(this, ctx, param, viewMatrix, strokeMatrix); }
    const layer = this;
    const children = this._children;
    const inner = param.extend({clipItem: this._getClipItem(), clip: false});
    const area = viewRect();
    const from = firstLive(this);
    if (from < MIN_STATIC) { drawItems(ctx, layer, inner, children, area); return; }
    const t = ctx.getTransform();
    const canvas = ctx.canvas;
    const size = `${canvas.width}x${canvas.height}`;
    if (!cache$2.canvas) cache$2.canvas = document.createElement('canvas');
    const off = cache$2.canvas;
    const octx = off.getContext('2d');
    const list = children.slice(0, from);
    const fresh = cache$2.items && cache$2.size === size && !staticDirty;
    let moving = false;
    const paintAll = () => {
        if (off.width !== canvas.width) off.width = canvas.width;
        if (off.height !== canvas.height) off.height = canvas.height;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, off.width, off.height);
        octx.save();
        octx.setTransform(t);
        drawItems(octx, layer, inner, list, area);
        octx.restore();
        cache$2.size = size;
        cache$2.t = t;
        cache$2.settled = false;
        remember(list, from);
    };
    if (fresh && !sameTransform(cache$2.t, t) && !cache$2.settled && !dirtyRoots.size &&
            cache$2.items.length === list.length && list.every((item, i) => item === cache$2.items[i])) {
        moving = true;
        requestSettle();
    } else if (fresh && sameTransform(cache$2.t, t)) {
        const cached = cache$2.items;
        const prefix = cached.length <= list.length && cached.every((item, i) => item === list[i]);
        if (prefix && !dirtyRoots.size) {
            if (list.length > cached.length) {
                octx.save();
                octx.setTransform(t);
                drawItems(octx, layer, inner, list.slice(cached.length), area);
                octx.restore();
                remember(list, from);
            }
        } else {
            const listSet = new Set(list);
            let rect = null;
            const add = r => {
                if (r) rect = rect ? rect.unite(r) : r;
            };
            for (const item of cached) {
                if (!listSet.has(item) || dirtyRoots.has(item)) add(cache$2.bounds.get(item));
            }
            for (const item of list) {
                if (!cache$2.itemSet.has(item) || dirtyRoots.has(item)) add(boundsOf(item));
            }
            const visibleArea = rect && rect.intersect(area);
            if (!visibleArea || visibleArea.width <= 0 || visibleArea.height <= 0) {
                remember(list, from);
            } else if (visibleArea.width * visibleArea.height > area.width * area.height * PARTIAL_LIMIT) { paintAll(); } else {
                const box = toDevice(visibleArea, t);
                octx.save();
                octx.setTransform(1, 0, 0, 1, 0, 0);
                octx.beginPath();
                octx.rect(box.x, box.y, box.w, box.h);
                octx.clip();
                octx.clearRect(box.x, box.y, box.w, box.h);
                octx.setTransform(t);
                drawItems(octx, layer, inner, list, visibleArea.expand(4 / (paper.view.zoom || 1)));
                octx.restore();
                remember(list, from);
            }
        }
        cache$2.misses = 0;
    } else {
        const quiet = sameTransform(cache$2.lastT, t) && !dirtyRoots.size && !staticDirty &&
            cache$2.lastLength === children.length;
        cache$2.misses = quiet ? 0 : cache$2.misses + 1;
        cache$2.lastT = t;
        cache$2.lastLength = children.length;
        if (cache$2.misses > GIVE_UP_AFTER && !cache$2.settled) {
            cache$2.items = null;
            dirtyRoots.clear();
            staticDirty = false;
            drawItems(ctx, layer, inner, children, area);
            return;
        }
        paintAll();
    }
    cache$2.lastT = t;
    cache$2.lastLength = children.length;
    staticDirty = false;
    if (!moving) {
        const version = this._project._updateVersion;
        const selected = this._project._selectionItems;
        for (const id in selected) {
            const item = selected[id];
            const root = rootIn(item, this);
            if (root && root._index < from) {
                for (let node = item; node && node !== this; node = node._parent) node._updateVersion = version;
            }
        }
    }
    ctx.save();
    if (moving) { const m = t.multiply(cache$2.t.inverse()); ctx.setTransform(m); } else { ctx.setTransform(1, 0, 0, 1, 0, 0); }
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    if (from < children.length) drawLive(ctx, layer, inner, children.slice(from), area, t);
};
const drawLive = (ctx, layer, inner, list, area, t) => {
    const ratio = window.devicePixelRatio || 1;
    if (!live.slow || ratio <= 1 || !pressed) {
        const start = performance.now();
        drawItems(ctx, layer, inner, list, area);
        live.slow = pressed && ratio > 1 && performance.now() - start > SLOW_LIVE_MS;
        return;
    }
    const canvas = ctx.canvas;
    if (!live.canvas) live.canvas = document.createElement('canvas');
    const lc = live.canvas;
    const w = Math.ceil(canvas.width / ratio);
    const h = Math.ceil(canvas.height / ratio);
    if (lc.width !== w) lc.width = w;
    if (lc.height !== h) lc.height = h;
    const lctx = lc.getContext('2d');
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, w, h);
    lctx.save();
    lctx.setTransform(t.a / ratio, t.b / ratio, t.c / ratio, t.d / ratio, t.e / ratio, t.f / ratio);
    drawItems(lctx, layer, inner, list, area);
    lctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lc, 0, 0, canvas.width, canvas.height);
    ctx.restore();
};
let overlay = null;
const overlayState = {canvas: null, key: null, drawn: 0};
const requestRedraw = () => {
    const view = paper.view;
    if (!view) return;
    view._needsUpdate = true;
    view.requestUpdate();
};
const setLiveOverlay = next => {
    overlay = next;
    overlayState.key = null;
    overlayState.drawn = 0;
    requestRedraw();
};
const liveOverlayChanged = requestRedraw;
const drawOverlay = (layer, ctx, param) => {
    if (!overlay || typeof ctx.getTransform !== 'function') return;
    const t = ctx.getTransform();
    const canvas = ctx.canvas;
    if (!overlayState.canvas) overlayState.canvas = document.createElement('canvas');
    const off = overlayState.canvas;
    const octx = off.getContext('2d');
    const key = `${t.a},${t.b},${t.c},${t.d},${t.e},${t.f},${canvas.width},${canvas.height}`;
    if (overlayState.key !== key) {
        if (off.width !== canvas.width) off.width = canvas.width;
        if (off.height !== canvas.height) off.height = canvas.height;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, off.width, off.height);
        overlayState.key = key;
        overlayState.drawn = 0;
    }
    const count = overlay.count();
    if (overlayState.drawn < count) {
        octx.setTransform(t);
        overlay.drawRange(octx, overlayState.drawn, count);
        overlayState.drawn = count;
    }
    ctx.save();
    const clipItem = layer._getClipItem();
    if (clipItem) clipItem.draw(ctx, param.extend({clipItem, clip: true}));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
};
const originalDraw = paper.Layer.prototype._draw;
paper.Layer.prototype._draw = function (ctx, param, viewMatrix, strokeMatrix) {
    drawLayer.call(this, ctx, param, viewMatrix, strokeMatrix);
    if (overlay && !param.clip && this.data && this.data.isPaintingLayer) drawOverlay(this, ctx, param);
};
let memo = null;
const optionsKey = options => {
    let key = '';
    for (const name of Object.keys(options).sort()) {
        if (name === 'match') continue;
        const value = options[name];
        key += `${name}=${typeof value === 'function' ? 'f' : value};`;
    }
    return key;
};
const originalHitTestAll = paper.Project.prototype.hitTestAll;
paper.Project.prototype.hitTestAll = function (point, options) {
    if (!options || !point || options.class || options.match === undefined) {
        return originalHitTestAll.call(this, point, options);
    }
    const key = `${point.x},${point.y}|${optionsKey(options)}`;
    let all;
    if (memo && memo.key === key && memo.version === changeVersion && memo.project === this) { all = memo.results; } else {
        const unfiltered = Object.assign({}, options);
        delete unfiltered.match;
        all = originalHitTestAll.call(this, point, unfiltered);
        memo = {key, version: changeVersion, project: this, results: all};
        Promise.resolve().then(() => { memo = null; });
    }
    return all.filter(options.match);
};
const getChangeVersion = () => changeVersion;
const markContent = () => {
    const layer = paintingLayer();
    mark = {layer, children: layer ? layer._children.slice() : [], roots: new Set(), dirty: false};
    return mark;
};
const contentUnchanged = since => {
    if (!since || since !== mark || since.dirty || !since.layer) return false;
    const layer = paintingLayer();
    if (layer !== since.layer) return false;
    const children = layer._children;
    if (children.length !== since.children.length) return false;
    for (let i = 0; i < children.length; i++) {
        if (children[i] !== since.children[i]) return false;
    }
    for (const root of since.roots) {
        if (root._parent === layer) return false;
    }
    return true;
};
const isPressingCanvas = () => pressed;
const CACHE_MODES = [
    Modes.BRUSH, Modes.ERASER, Modes.LINE, Modes.RECT, Modes.OVAL, Modes.ROUNDED_RECT,
    Modes.TRIANGLE, Modes.ARROW, Modes.SUSSY, Modes.PEN, Modes.SELECT, Modes.RESHAPE,
    Modes.POLYGON, Modes.LASSO_SHAPE
];
const MIN_SEGMENTS$1 = 3000;
let getMode = () => null;
let armed = false;
let cache$1 = null;
let before = null;
const patched = new WeakSet();
const segmentCount = function (item) {
    if (item.segments) return item.segments.length;
    if (!item.children) return 4;
    let n = 0;
    for (const child of item.children) n += segmentCount(child);
    return n;
};
const newParam = function (view) {
    return new paper.Base({
        offset: new paper.Point(0, 0),
        pixelRatio: view.pixelRatio,
        viewMatrix: view.matrix.isIdentity() ? null : view.matrix,
        matrices: [new paper.Matrix()],
        updateMatrix: true
    });
};
const snapshot = function (items) {
    const view = paper.view;
    const element = view.element;
    const canvas = document.createElement('canvas');
    canvas.width = element.width;
    canvas.height = element.height;
    const context = canvas.getContext('2d');
    context.scale(view.pixelRatio, view.pixelRatio);
    view.matrix.applyToContext(context);
    const param = newParam(view);
    for (const item of items) item.draw(context, param);
    return canvas;
};
const unionBounds = function (items) {
    let rect = null;
    for (const item of items) rect = rect ? rect.unite(item.bounds) : item.bounds;
    return rect;
};
const patch = function (layer) {
    if (patched.has(layer)) return;
    patched.add(layer);
    const original = layer._draw;
    layer._draw = function (context, param) {
        if (!cache$1 || cache$1.layer !== this || !cache$1.matrix.equals(paper.view.matrix)) {
            return original.call(this, context, param);
        }
        const clipItem = !param.clip && this._getClipItem();
        param = param.extend({clipItem, clip: false});
        if (clipItem) clipItem.draw(context, param.extend({clip: true}));
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(cache$1.staticCanvas, 0, 0);
        context.restore();
        let moved = false;
        if (cache$1.movingCanvas) {
            const bounds = unionBounds(cache$1.moving);
            const start = cache$1.movingBounds;
            if (bounds && Math.abs(bounds.width - start.width) < 1e-6 &&
                Math.abs(bounds.height - start.height) < 1e-6) {
                const m = paper.view.matrix;
                const dx = bounds.x - start.x;
                const dy = bounds.y - start.y;
                const pr = paper.view.pixelRatio;
                context.save();
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.drawImage(cache$1.movingCanvas, ((m.a * dx) + (m.c * dy)) * pr, ((m.b * dx) + (m.d * dy)) * pr);
                context.restore();
                moved = true;
            }
        }
        for (const child of this._children) {
            if (child === clipItem || cache$1.static.has(child)) continue;
            if (moved && cache$1.movingSet.has(child)) continue;
            child.draw(context, param);
        }
    };
};
const build = function () {
    const mode = getMode();
    if (CACHE_MODES.indexOf(mode) === -1) return;
    const layer = getPaintingLayer();
    if (!layer || !paper.view) return;
    const children = layer.children.filter(child => !child.isClipMask());
    if (segmentCount({children}) < MIN_SEGMENTS$1) return;
    const moving = children.filter(child => child.selected || child.fullySelected ||
        (child.children && child.getItems({selected: true}).length));
    const movingSet = new Set(moving);
    const statics = children.filter(child => !movingSet.has(child) &&
        before && before.get(child) === segmentCount(child));
    patch(layer);
    cache$1 = {
        layer,
        matrix: paper.view.matrix.clone(),
        static: new Set(statics),
        staticCanvas: snapshot(statics),
        moving,
        movingSet,
        movingCanvas: mode === Modes.SELECT && moving.length && segmentCount({children: moving}) >= MIN_SEGMENTS$1 ?
            snapshot(moving) : null,
        movingBounds: moving.length ? unionBounds(moving) : null
    };
};
const end = function () {
    armed = false;
    before = null;
    if (!cache$1) return;
    cache$1 = null;
    if (paper.view) paper.view.requestUpdate();
};
const onPointerDown = function (event) {
    if (event.button !== 0 || !paper.view || event.target !== paper.view.element) return;
    end();
    armed = true;
    const layer = CACHE_MODES.indexOf(getMode()) === -1 ? null : getPaintingLayer();
    if (layer) before = new Map(layer.children.map(child => [child, segmentCount(child)]));
};
const onPointerMove = function (event) {
    if (cache$1 && !(event.buttons & 1)) { end(); return; }
    if (!armed || cache$1 || !(event.buttons & 1)) return;
    armed = false;
    build();
};
const installRenderCache = function (modeGetter) {
    getMode = modeGetter;
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', end);
    return () => {
        end();
        window.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        window.removeEventListener('blur', end);
    };
};
const MIN_SEGMENTS = 250;
const TOLERANCE_PX = 0.6;
const DOT_PX = 3;
const cache = new WeakMap();
const simplifyPoints = function (points, tolerance, closed) {
    const n = points.length;
    if (n < 3) return points.slice();
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const tol2 = tolerance * tolerance;
    const stack = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const ax = points[a].x;
        const ay = points[a].y;
        const dx = points[b].x - ax;
        const dy = points[b].y - ay;
        const len2 = (dx * dx) + (dy * dy) || 1e-12;
        let worst = -1;
        let worstD = tol2;
        for (let i = a + 1; i < b; i++) {
            const px = points[i].x - ax;
            const py = points[i].y - ay;
            const cross = (px * dy) - (py * dx);
            const d2 = (cross * cross) / len2;
            if (d2 > worstD) { worstD = d2; worst = i; }
        }
        if (worst !== -1) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
    if (closed && out.length < 3) return [points[0], points[Math.floor(n / 3)], points[Math.floor(2 * n / 3)]];
    return out;
};
const install = function () {
    const Path = paper.Path;
    if (Path.prototype.__dimodLod) return;
    Path.prototype.__dimodLod = true;
    const changed = Path.prototype._changed;
    Path.prototype._changed = function (flags) {
        this.__dimodRev = (this.__dimodRev || 0) + 1;
        return changed.call(this, flags);
    };
    const draw = Path.prototype._draw;
    Path.prototype._draw = function (ctx, param, viewMatrix, strokeMatrix) {
        const segments = this._segments;
        if (!segments || segments.length < MIN_SEGMENTS || param.clip || !ctx.getTransform) {
            return draw.call(this, ctx, param, viewMatrix, strokeMatrix);
        }
        const t = ctx.getTransform();
        const scale = Math.sqrt(Math.abs((t.a * t.d) - (t.b * t.c))) / (param.pixelRatio || 1);
        const bounds = this.getInternalBounds ? this.getInternalBounds() : this.bounds;
        const screenSize = Math.max(bounds.width, bounds.height) * scale;
        if (screenSize < DOT_PX && !param.dontStart && !param.dontFinish) {
            const color = this.getFillColor() || this.getStrokeColor();
            if (!color) return null;
            ctx.fillStyle = color.toCanvasStyle(ctx);
            ctx.fillRect(bounds.x, bounds.y, Math.max(bounds.width, 1 / scale), Math.max(bounds.height, 1 / scale));
            return null;
        }
        if (segments.length < screenSize * 1.5) return draw.call(this, ctx, param, viewMatrix, strokeMatrix);
        let entry = cache.get(this);
        const bucket = Math.round(Math.log2(scale));
        if (!entry || entry.rev !== this.__dimodRev || entry.bucket !== bucket) {
            const tolerance = TOLERANCE_PX / Math.pow(2, bucket);
            const points = simplifyPoints(segments.map(s => s._point), tolerance, this._closed);
            const proxy = new paper.Path({segments: points, closed: this._closed, insert: false});
            entry = {rev: this.__dimodRev, bucket, proxy};
            cache.set(this, entry);
        }
        const proxy = entry.proxy;
        proxy._style = this._style;
        return draw.call(proxy, ctx, param, viewMatrix, strokeMatrix);
    };
};
const STYLE_KEYS = ['fillColor', 'fillRule', 'strokeColor', 'strokeWidth', 'strokeCap', 'strokeJoin',
    'strokeScaling', 'miterLimit', 'dashOffset', 'dashArray', 'shadowColor', 'shadowBlur', 'shadowOffset',
    'selectedColor', 'fontFamily', 'fontWeight', 'fontSize', 'leading', 'justification'];
const getters = STYLE_KEYS.map(key => `get${key[0].toUpperCase()}${key.slice(1)}`);
let depth = 0;
const unmerged = () => {
    if (depth++ > 0) return;
    for (const get of getters) { paper.Group.prototype[get] = function () { return this._style[get](true); }; }
};
const merged = () => {
    if (--depth > 0) return;
    for (const get of getters) delete paper.Group.prototype[get];
};
const wrap = proto => {
    const original = proto.exportSVG;
    proto.exportSVG = function (...args) {
        unmerged();
        try { return original.apply(this, args); } finally { merged(); }
    };
};
wrap(paper.Project.prototype);
wrap(paper.Item.prototype);
const enabled = () => !(typeof window !== 'undefined' && window.__dimodNoFastUndo);
const REFERENCE = /\["(#\d+)"\]/g;
const SELECTED_COLOR = /,?"selectedColor":\[[^\]]*\]/g;
const keyOf = (json, dictionary) => {
    let key = JSON.stringify(json).replace(SELECTED_COLOR, '');
    if (!dictionary) return key;
    for (let depth = 0; depth < 8 && key.indexOf('["#') !== -1; depth++) {
        const next = key.replace(REFERENCE, (match, id) => {
            if (!Object.prototype.hasOwnProperty.call(dictionary, id)) return match;
            return JSON.stringify(dictionary[id]).replace(SELECTED_COLOR, '');
        });
        if (next === key) break;
        key = next;
    }
    return key;
};
const unwrap = json => {
    if (Array.isArray(json) && json.length === 2 && Array.isArray(json[0]) && json[0][0] === 'dictionary') {
        return {dictionary: json[0][1], content: json[1]};
    }
    return {dictionary: null, content: json};
};
const describe = (content, dictionary) => {
    if (!Array.isArray(content) || content[0] !== 'Layer' || !content[1]) return null;
    const props = Object.assign({}, content[1]);
    const children = props.children || [];
    delete props.children;
    delete props.selected;
    return {dictionary, children, layerKey: keyOf(props, dictionary), keys: children.map(child => keyOf(child, dictionary))};
};
const _described = new WeakMap();
const describeEntry = entry => {
    if (_described.has(entry)) return _described.get(entry);
    let result = null;
    const {dictionary, content} = unwrap(entry.json);
    if (Array.isArray(content)) {
        const painting = content.filter(layer => Array.isArray(layer) && layer[0] === 'Layer' && layer[1] &&
            layer[1].data && layer[1].data.isPaintingLayer);
        if (painting.length === 1) result = describe(painting[0], dictionary);
    }
    _described.set(entry, result);
    return result;
};
const restoreInPlace = function (entry) {
    if (!enabled()) return false;
    const layer = getPaintingLayer();
    if (!layer) return false;
    const target = describeEntry(entry);
    if (!target) return false;
    const exported = unwrap(layer.exportJSON({asString: false}));
    const now = describe(exported.content, exported.dictionary);
    if (!now || now.layerKey !== target.layerKey) return false;
    const children = layer.children;
    if (children.length !== now.keys.length) return false;
    const available = new Map();
    for (let i = now.keys.length - 1; i >= 0; i--) {
        const list = available.get(now.keys[i]);
        if (list) list.push(children[i]);
        else available.set(now.keys[i], [children[i]]);
    }
    const final = new Array(target.keys.length);
    const missing = [];
    const missingAt = [];
    for (let i = 0; i < target.keys.length; i++) {
        const list = available.get(target.keys[i]);
        if (list && list.length) { final[i] = list.pop(); } else { missing.push(target.children[i]); missingAt.push(i); }
    }
    if (missing.length) {
        const made = paper.Base.importJSON(target.dictionary ? [['dictionary', target.dictionary], missing] : missing);
        if (!Array.isArray(made) || made.length !== missing.length) return false;
        for (let i = 0; i < made.length; i++) {
            if (!(made[i] instanceof paper.Item)) return false;
            final[missingAt[i]] = made[i];
        }
    }
    available.forEach(list => {
        for (const item of list) item.remove();
    });
    for (let i = 0; i < final.length; i++) {
        if (children[i] !== final[i]) layer.insertChild(i, final[i]);
    }
    return true;
};
const _exports = new WeakMap();
let _restored = null;
const noteRestored = function (entry) { _restored = entry && enabled() ? {entry, mark: markContent()} : null; };
const takeRestored = function () {
    const restored = _restored;
    _restored = null;
    return restored && contentUnchanged(restored.mark) ? restored.entry : null;
};
const rememberExport = function (entry, exported) {
    if (enabled()) _exports.set(entry, exported);
};
const recallExport = function (entry, docKey) {
    if (!enabled()) return null;
    const exported = _exports.get(entry);
    return exported && exported.docKey === docKey ? exported : null;
};
const reported = new Set();
const report = error => {
    const key = String(error && (error.stack || error.message || error));
    if (reported.has(key)) return;
    reported.add(key);
    console.error('paint editor: a redraw failed (the editor keeps drawing)', error);
};
const installRafGuard = function () {
    const DomEvent = paper.DomEvent;
    if (!DomEvent || !DomEvent.requestAnimationFrame || DomEvent.requestAnimationFrame.dimodGuarded) return;
    const native = typeof window !== 'undefined' && window.requestAnimationFrame ?
        window.requestAnimationFrame.bind(window) :
        fn => setTimeout(fn, 1000 / 60);
    let callbacks = [];
    let requested = false;
    const run = function () {
        requested = false;
        const functions = callbacks;
        callbacks = [];
        for (let i = 0; i < functions.length; i++) {
            try { functions[i](); } catch (e) { report(e); }
        }
        if (callbacks.length && !requested) { requested = true; native(run); }
    };
    const requestAnimationFrame = function (callback) {
        callbacks.push(callback);
        if (!requested) { requested = true; native(run); }
    };
    requestAnimationFrame.dimodGuarded = true;
    DomEvent.requestAnimationFrame = requestAnimationFrame;
};
export {contentUnchanged, getChangeVersion, install as installLevelOfDetail, installRafGuard, installRenderCache, isPressingCanvas, liveOverlayChanged, markContent, noteRestored, path2dDraw, recallExport, rememberExport, restoreInPlace, setLiveOverlay, simplifyPoints, takeRestored};
