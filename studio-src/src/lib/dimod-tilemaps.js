import BlockType from 'scratch-vm/src/extension-support/block-type';
import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import Cast from 'scratch-vm/src/util/cast';
import sb3 from 'scratch-vm/src/serialization/sb3';
import {toTopOfGroup} from './dimod-vm.js';
const GID_SHIFT = 65536;
const gidOf = (tilesetId, index) => (tilesetId * GID_SHIFT) + index + 1;
const tilesetIdOf = gid => Math.floor((gid - 1) / GID_SHIFT);
const tileIndexOf = gid => (gid - 1) % GID_SHIFT;
const MAX_CELLS = 512 * 512;
const clampInt = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const emptyDoc = () => ({version: 1, nextId: 1, tilesets: [], maps: []});
const takeId = doc => doc.nextId++;
const normalizeObject = (o, doc) => ({
    id: Number.isInteger(o && o.id) ? o.id : takeId(doc),
    name: str(o && o.name),
    type: str(o && o.type),
    shape: o && o.shape === 'point' ? 'point' : 'rect',
    x: num(o && o.x),
    y: num(o && o.y),
    w: o && o.shape === 'point' ? 0 : Math.max(0, num(o && o.w, 24)),
    h: o && o.shape === 'point' ? 0 : Math.max(0, num(o && o.h, 24)),
    props: o && o.props && typeof o.props === 'object' && !Array.isArray(o.props) ?
        Object.fromEntries(Object.entries(o.props).map(([k, v]) => [String(k), String(v)])) : {}
});
const normalizeLayer = (l, map, doc) => {
    const kind = l && l.kind === 'objects' ? 'objects' : 'tiles';
    const layer = {
        id: Number.isInteger(l && l.id) ? l.id : takeId(doc),
        name: str(l && l.name, kind === 'objects' ? 'Objects' : 'Tiles'),
        kind,
        visible: !(l && l.visible === false),
        opacity: Math.min(1, Math.max(0, num(l && l.opacity, 1))),
        front: !!(l && l.front),
        collides: !!(l && l.collides),
        parallax: Math.min(4, Math.max(0, num(l && l.parallax, 1)))
    };
    if (kind === 'tiles') {
        const n = map.cols * map.rows;
        const src = l && Array.isArray(l.data) ? l.data : [];
        layer.data = new Array(n);
        for (let i = 0; i < n; i++) layer.data[i] = Number.isInteger(src[i]) && src[i] > 0 ? src[i] : 0;
    } else { layer.objects = (l && Array.isArray(l.objects) ? l.objects : []).map(o => normalizeObject(o, doc)); }
    return layer;
};
const normalizeMap = (m, doc) => {
    const map = {
        id: Number.isInteger(m && m.id) ? m.id : takeId(doc),
        name: str(m && m.name, 'Map'),
        tileW: clampInt(m && m.tileW, 4, 256, 24),
        tileH: clampInt(m && m.tileH, 4, 256, 24),
        cols: clampInt(m && m.cols, 1, 512, 20),
        rows: clampInt(m && m.rows, 1, 512, 15),
        background: m && typeof m.background === 'string' && /^#[0-9a-f]{6}$/i.test(m.background) ? m.background : ''
    };
    if (map.cols * map.rows > MAX_CELLS) map.rows = Math.floor(MAX_CELLS / map.cols);
    map.layers = (m && Array.isArray(m.layers) ? m.layers : []).map(l => normalizeLayer(l, map, doc));
    return map;
};
const normalizeTileset = (t, doc) => ({
    id: Number.isInteger(t && t.id) && t.id > 0 ? t.id : takeId(doc),
    name: str(t && t.name, 'Tiles'),
    sprite: str(t && t.sprite),
    kind: t && t.kind === 'sheet' ? 'sheet' : 'costumes',
    costume: str(t && t.costume),
    tileW: clampInt(t && t.tileW, 1, 1024, 24),
    tileH: clampInt(t && t.tileH, 1, 1024, 24),
    tiles: t && t.tiles && typeof t.tiles === 'object' ? Object.fromEntries(Object.entries(t.tiles)
        .map(([k, v]) => [String(k), {tags: (v && Array.isArray(v.tags) ? v.tags : []).map(String).filter(Boolean)}])
        .filter(([, v]) => v.tags.length)) : {}
});
const normalizeDoc = raw => {
    const doc = emptyDoc();
    if (!raw || typeof raw !== 'object') return doc;
    doc.nextId = clampInt(raw.nextId, 1, 1e9, 1);
    doc.tilesets = (Array.isArray(raw.tilesets) ? raw.tilesets : []).map(t => normalizeTileset(t, doc));
    doc.maps = (Array.isArray(raw.maps) ? raw.maps : []).map(m => normalizeMap(m, doc));
    const ids = [...doc.tilesets.map(t => t.id), ...doc.maps.flatMap(m => [m.id, ...m.layers.flatMap(l =>
        [l.id, ...(l.objects || []).map(o => o.id)])])];
    doc.nextId = Math.max(doc.nextId, ...ids.map(i => i + 1), 1);
    return doc;
};
const newMap = (doc, name, opts = {}) => {
    const map = normalizeMap({name, ...opts, layers: []}, doc);
    map.layers.push(normalizeLayer({name: 'Ground', kind: 'tiles', collides: true}, map, doc));
    map.layers.push(normalizeLayer({name: 'Objects', kind: 'objects'}, map, doc));
    doc.maps.push(map);
    return map;
};
const uniqueName = (taken, base) => {
    const set = new Set(taken);
    if (!set.has(base)) return base;
    const stem = base.replace(/\s+\d+$/, '');
    for (let i = 2; ; i++) if (!set.has(`${stem} ${i}`)) return `${stem} ${i}`;
};
const resizeMap = (map, cols, rows) => {
    cols = clampInt(cols, 1, 512, map.cols);
    rows = clampInt(rows, 1, 512, map.rows);
    if (cols * rows > MAX_CELLS) rows = Math.floor(MAX_CELLS / cols);
    for (const layer of map.layers) {
        if (layer.kind !== 'tiles') continue;
        const data = new Array(cols * rows).fill(0);
        for (let r = 0; r < Math.min(rows, map.rows); r++) {
            for (let c = 0; c < Math.min(cols, map.cols); c++) data[(r * cols) + c] = layer.data[(r * map.cols) + c];
        }
        layer.data = data;
    }
    map.cols = cols;
    map.rows = rows;
};
const findMap = (doc, ref) => {
    if (!doc) return null;
    if (typeof ref === 'number') return doc.maps.find(m => m.id === ref) || null;
    const name = String(ref);
    return doc.maps.find(m => m.name === name) ||
        doc.maps.find(m => m.name.toLowerCase() === name.toLowerCase()) || null;
};
const findLayer = (map, ref) => {
    if (!map) return null;
    const name = String(ref);
    return map.layers.find(l => l.name === name) ||
        map.layers.find(l => l.name.toLowerCase() === name.toLowerCase()) || null;
};
const tagsOf = (doc, gid) => {
    if (!gid) return [];
    const ts = doc.tilesets.find(t => t.id === tilesetIdOf(gid));
    const entry = ts && ts.tiles[String(tileIndexOf(gid))];
    return entry ? entry.tags : [];
};
const images = new Map();
const listeners = new Set();
const onTileImageLoad = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const imageOf = costume => {
    if (!costume || !costume.asset) return null;
    const key = costume.asset.assetId;
    let entry = images.get(key);
    if (entry) return entry;
    entry = {image: null, res: costume.bitmapResolution || 1, ready: false};
    images.set(key, entry);
    if (typeof Image === 'undefined') return entry;
    const img = new Image();
    img.onload = () => {
        entry.image = img;
        entry.ready = true;
        for (const fn of [...listeners]) fn();
    };
    img.src = costume.asset.encodeDataURI();
    return entry;
};
const spriteOf = (runtime, tileset) => runtime.getSpriteTargetByName(tileset.sprite) || null;
const tilesOf = (runtime, tileset) => {
    const sprite = spriteOf(runtime, tileset);
    if (!sprite) return [];
    const costumes = sprite.getCostumes();
    if (tileset.kind === 'costumes') { return costumes.map(c => ({name: c.name, costume: c})); }
    const costume = costumes.find(c => c.name === tileset.costume) || costumes[0];
    const entry = imageOf(costume);
    if (!entry || !entry.ready) return [];
    const res = entry.res;
    const tw = tileset.tileW * res, th = tileset.tileH * res;
    const cols = Math.floor(entry.image.naturalWidth / tw), rows = Math.floor(entry.image.naturalHeight / th);
    const out = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            out.push({name: `${tileset.name} ${out.length + 1}`, costume, sx: c * tw, sy: r * th, sw: tw, sh: th});
        }
    }
    return out;
};
const drawTile = (ctx, tile, x, y, w, h) => {
    const entry = imageOf(tile.costume);
    if (!entry || !entry.ready) return false;
    const img = entry.image;
    if (typeof tile.sx === 'number') ctx.drawImage(img, tile.sx, tile.sy, tile.sw, tile.sh, x, y, w, h);
    else ctx.drawImage(img, x, y, w, h);
    return true;
};
const tileLookup = (runtime, doc) => {
    const byTileset = new Map();
    return gid => {
        const id = tilesetIdOf(gid);
        let tiles = byTileset.get(id);
        if (!tiles) {
            const ts = doc.tilesets.find(t => t.id === id);
            tiles = ts ? tilesOf(runtime, ts) : [];
            byTileset.set(id, tiles);
        }
        return tiles[tileIndexOf(gid)] || null;
    };
};
const tileName = (runtime, doc, gid) => {
    if (!gid) return '';
    const ts = doc.tilesets.find(t => t.id === tilesetIdOf(gid));
    if (!ts) return '';
    const index = tileIndexOf(gid);
    if (ts.kind === 'sheet') return `${ts.name} ${index + 1}`;
    const tile = tilesOf(runtime, ts)[index];
    return tile ? tile.name : '';
};
const resolveTile = (runtime, doc, ref) => {
    if (ref === null || typeof ref === 'undefined') return 0;
    const text = String(ref).trim();
    if (!text || text === '0') return 0;
    const slash = text.indexOf('/');
    if (slash > 0) {
        const ts = doc.tilesets.find(t => t.name === text.slice(0, slash));
        if (ts) {
            const rest = text.slice(slash + 1);
            const i = tilesOf(runtime, ts).findIndex(t => t.name === rest);
            if (i >= 0) return gidOf(ts.id, i);
            const n = Math.round(Number(rest));
            if (n >= 1) return gidOf(ts.id, n - 1);
        }
    }
    for (const ts of doc.tilesets) {
        if (ts.kind !== 'costumes') continue;
        const i = tilesOf(runtime, ts).findIndex(t => t.name === text);
        if (i >= 0) return gidOf(ts.id, i);
    }
    const m = /^(.*\S)\s+(\d+)$/.exec(text);
    if (m) {
        const ts = doc.tilesets.find(t => t.name === m[1]);
        if (ts) return gidOf(ts.id, Number(m[2]) - 1);
    }
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n >= 1 && doc.tilesets[0]) return gidOf(doc.tilesets[0].id, n - 1);
    return 0;
};
const DECLARATIONS = `
/** An object from a TileMaps object layer, in stage coordinates (x and y are its centre). */
interface TileMapObject {
    name: string;
    type: string;
    shape: "rect" | "point";
    x: number;
    y: number;
    width: number;
    height: number;
    /** The custom properties set in the TileMaps tab. */
    props: Record<string, string>;
    layer: string;
}
/** What tileMaps.move() ran into. */
interface TileMapHit {
    floor: boolean;
    ceiling: boolean;
    left: boolean;
    right: boolean;
}
`;
const TYPES = `
/** Show a map from the TileMaps tab on the stage (one at a time). */
show(name: string): void;
/** Take the map off the stage. */
hide(): void;
/** The map on the stage, or null. */
readonly map: string | null;
/** Every map's name. */
readonly maps: string[];
/** Where the camera looks: 0, 0 puts the map's top-left corner at the stage's. It's the same camera the Camera extension moves, so sprites scroll with the map. */
camera: {x: number; y: number};
setCamera(x: number, y: number): void;
/** The shown map's size in tiles and in pixels. */
readonly size: {cols: number; rows: number; tileWidth: number; tileHeight: number; width: number; height: number} | null;
/** The tile at a stage point: its costume's name ("" for none). Without a layer, the topmost one. */
tileAt(x: number, y: number, layer?: string): string;
/** Put a tile (a costume name, "Sheet 3", or "" to clear) at a stage point. Lasts until the green flag. */
setTile(x: number, y: number, tile: string, layer?: string): void;
/** Column and row count from 0. */
tileAtCell(col: number, row: number, layer?: string): string;
setTileAtCell(col: number, row: number, tile: string, layer?: string): void;
cellAt(x: number, y: number): {col: number; row: number};
cellCenter(col: number, row: number): {x: number; y: number};
/** Every tag of the tiles at a point ("solid" for a layer that collides). */
tagsAt(x: number, y: number): string[];
solidAt(x: number, y: number): boolean;
/** Move a sprite (this one by default), sliding along solid tiles instead of going into them. */
move(dx: number, dy: number, sprite?: TargetApi): TileMapHit;
/** Solid right under the sprite? */
onGround(sprite?: TargetApi): boolean;
touchingSolid(sprite?: TargetApi): boolean;
/** Touching a tile with this tag ("spike", "water"...)? */
touching(tag: string, sprite?: TargetApi): boolean;
/** The shown map's objects, all of them or one type's. */
objects(type?: string): TileMapObject[];
/** The object with this name, or null. */
object(name: string): TileMapObject | null;
/** The objects the sprite overlaps, all of them or one type's. */
touchingObjects(type?: string, sprite?: TargetApi): TileMapObject[];
showLayer(name: string): void;
hideLayer(name: string): void;
/** Draw object outlines on the stage, for finding your way around. */
outlines: boolean;
`;
const EXTENSION_ID = 'tileMaps';
const CHANGED_EVENT = 'DIMOD_TILEMAPS_CHANGED';
const COLOUR = '#C0883A';
const ANY_LAYER = 'any layer';
const SCALE = 2;
const EPS = 0.01;
const ICON = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x=".5" y=".5" width="19" height="19" rx="4" ' +
    'fill="#C0883A" stroke="#9C6B27"/><rect x="4" y="4" width="5.5" height="5.5" fill="#fff"/>' +
    '<rect x="10.5" y="4" width="5.5" height="5.5" fill="#fff" opacity=".55"/><rect x="4" y="10.5" width="5.5" ' +
    'height="5.5" fill="#fff" opacity=".55"/><rect x="10.5" y="10.5" width="5.5" height="5.5" fill="#fff"/></svg>')}`;
const SIDES = ['anything', 'floor', 'ceiling', 'left wall', 'right wall'];
class TileMaps {
    constructor (runtime) {
        this.runtime = runtime;
        runtime.ext_tileMaps = this;
        this.shownId = null;
        this.live = new Map();
        this.hidden = new Map();
        this.hits = new Map();
        this.showOutlines = false;
        this.dirty = true;
        this.canvases = null;
        onTileImageLoad(() => { this.dirty = true; });
        runtime.on(CHANGED_EVENT, () => this.edited());
        runtime.on('PROJECT_START', () => this.resetRun());
        runtime.on('CAMERA_CHANGED', () => { this.dirty = true; });
        this.patchRenderer();
    }
    get doc () {
        if (!this.runtime.dimodTileMaps) this.runtime.dimodTileMaps = normalizeDoc(null);
        return this.runtime.dimodTileMaps;
    }
    edited () {
        this.live.clear();
        if (this.shownId !== null && !findMap(this.doc, this.shownId)) this.shownId = null;
        this.dirty = true;
    }
    resetRun () {
        this.live.clear();
        this.hidden.clear();
        this.hits.clear();
        this.dirty = true;
    }
    get map () { return this.shownId === null ? null : findMap(this.doc, this.shownId); }
    get stageW () { return this.runtime.stageWidth || 480; }
    get stageH () { return this.runtime.stageHeight || 360; }
    get cam () { return this.runtime.getCamera('default'); }
    get camX () { return this.cam.pos[0]; }
    get camY () { return this.cam.pos[1]; }
    toMap (x, y) { return [x + (this.stageW / 2), (this.stageH / 2) - y]; }
    toStage (px, py) { return [px - (this.stageW / 2), (this.stageH / 2) - py]; }
    screenToWorld (x, y) {
        const {pos, scale, dir} = this.cam;
        const a = -dir * Math.PI / 180, sin = Math.sin(a), cos = Math.cos(a), inv = 1 / (scale || 1);
        return [pos[0] + (inv * ((x * cos) - (y * sin))), pos[1] + (inv * ((x * sin) + (y * cos)))];
    }
    cellAt (map, x, y) { const [px, py] = this.toMap(x, y); return [Math.floor(px / map.tileW), Math.floor(py / map.tileH)]; }
    cells (layer) { return this.live.get(layer.id) || layer.data; }
    layersFor (map, ref) {
        const tiles = map.layers.filter(l => l.kind === 'tiles');
        if (ref === null || typeof ref === 'undefined' || String(ref) === ANY_LAYER || String(ref) === '') return tiles;
        const layer = findLayer(map, ref);
        return layer && layer.kind === 'tiles' ? [layer] : [];
    }
    gidAt (map, col, row, layerRef) {
        if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return 0;
        const layers = this.layersFor(map, layerRef);
        for (let i = layers.length - 1; i >= 0; i--) {
            const gid = this.cells(layers[i])[(row * map.cols) + col];
            if (gid) return gid;
        }
        return 0;
    }
    setGid (map, col, row, layerRef, gid) {
        if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return;
        let layer = layerRef && String(layerRef) !== ANY_LAYER ? findLayer(map, layerRef) : null;
        if (!layer) layer = map.layers.find(l => l.kind === 'tiles');
        if (!layer || layer.kind !== 'tiles') return;
        let data = this.live.get(layer.id);
        if (!data) { data = layer.data.slice(); this.live.set(layer.id, data); }
        const i = (row * map.cols) + col;
        if (data[i] !== gid) { data[i] = gid; this.dirty = true; }
    }
    cellTags (map, col, row) {
        const tags = new Set();
        if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return tags;
        for (const layer of map.layers) {
            if (layer.kind !== 'tiles') continue;
            const gid = this.cells(layer)[(row * map.cols) + col];
            if (!gid) continue;
            if (layer.collides) tags.add('solid');
            for (const t of tagsOf(this.doc, gid)) tags.add(t);
        }
        return tags;
    }
    solidObjects (map) {
        const out = [];
        for (const layer of map.layers) {
            if (layer.kind !== 'objects') continue;
            for (const o of layer.objects) {
                if (o.shape === 'rect' && o.w > 0 && o.h > 0 && (layer.collides || o.type === 'solid')) out.push(o);
            }
        }
        return out;
    }
    tagBoxes (map, box, tag) {
        const out = [];
        const [pl, pt] = this.toMap(box.left, box.top);
        const [pr, pb] = this.toMap(box.right, box.bottom);
        const c0 = Math.max(0, Math.floor(pl / map.tileW)), c1 = Math.min(map.cols - 1, Math.floor(pr / map.tileW));
        const r0 = Math.max(0, Math.floor(pt / map.tileH)), r1 = Math.min(map.rows - 1, Math.floor(pb / map.tileH));
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (!this.cellTags(map, c, r).has(tag)) continue;
                const [left, top] = this.toStage(c * map.tileW, r * map.tileH);
                out.push({left, right: left + map.tileW, top, bottom: top - map.tileH});
            }
        }
        if (tag === 'solid') {
            for (const o of this.solidObjects(map)) {
                const [left, top] = this.toStage(o.x, o.y);
                out.push({left, right: left + o.w, top, bottom: top - o.h});
            }
        }
        return out.filter(b => overlaps(box, b));
    }
    boundsOf (target) {
        const r = this.runtime.renderer;
        if (!target || target.isStage || !r || target.drawableID === null) return null;
        const b = r.getBounds(target.drawableID);
        if (!b) return null;
        const pts = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]
            .map(([x, y]) => this.screenToWorld(x, y));
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        return {left: Math.min(...xs), right: Math.max(...xs), top: Math.max(...ys), bottom: Math.min(...ys)};
    }
    touchingTag (target, tag) {
        const map = this.map;
        const box = this.boundsOf(target);
        return !!(map && box && this.tagBoxes(map, box, tag).length);
    }
    move (target, dx, dy) {
        const hit = {floor: false, ceiling: false, left: false, right: false};
        const map = this.map;
        const box = this.boundsOf(target);
        if (!map || !box) { target.setXY(target.x + dx, target.y + dy); this.hits.set(target.id, hit); return hit; }
        const shift = (b, x, y) => ({left: b.left + x, right: b.right + x, bottom: b.bottom + y, top: b.top + y});
        let b = box;
        const sweep = (amount, horizontal) => {
            const max = (horizontal ? map.tileW : map.tileH) / 2;
            const steps = Math.max(1, Math.ceil(Math.abs(amount) / max));
            const step = amount / steps;
            for (let i = 0; i < steps; i++) {
                const next = horizontal ? shift(b, step, 0) : shift(b, 0, step);
                const walls = this.tagBoxes(map, next, 'solid');
                if (!walls.length) { b = next; continue; }
                if (horizontal) {
                    if (step > 0) { b = shift(b, Math.min(...walls.map(w => w.left)) - b.right, 0); hit.right = true; } else { b = shift(b, Math.max(...walls.map(w => w.right)) - b.left, 0); hit.left = true; }
                } else if (step > 0) {
                    b = shift(b, 0, Math.min(...walls.map(w => w.bottom)) - b.top);
                    hit.ceiling = true;
                } else { b = shift(b, 0, Math.max(...walls.map(w => w.top)) - b.bottom); hit.floor = true; }
                return;
            }
        };
        if (dx) sweep(dx, true);
        if (dy) sweep(dy, false);
        target.setXY(target.x + (b.left - box.left), target.y + (b.bottom - box.bottom));
        this.hits.set(target.id, hit);
        return hit;
    }
    onGround (target) {
        const map = this.map;
        const box = this.boundsOf(target);
        if (!map || !box) return false;
        return this.tagBoxes(map, {left: box.left, right: box.right, top: box.bottom, bottom: box.bottom - 1}, 'solid').length > 0;
    }
    objectsOf (map, type) {
        const out = [];
        if (!map) return out;
        for (const layer of map.layers) {
            if (layer.kind !== 'objects') continue;
            for (const o of layer.objects) {
                if (type && o.type !== type) continue;
                const [x, y] = this.toStage(o.x + (o.w / 2), o.y + (o.h / 2));
                out.push({name: o.name, type: o.type, shape: o.shape, x: round2(x), y: round2(y),
                    width: o.w, height: o.h, props: {...o.props}, layer: layer.name});
            }
        }
        return out;
    }
    findObject (name) {
        const all = this.objectsOf(this.map);
        const n = String(name);
        return all.find(o => o.name === n) || null;
    }
    touchingObjects (target, type) {
        const box = this.boundsOf(target);
        if (!box) return [];
        return this.objectsOf(this.map, type).filter(o => {
            if (o.shape === 'point') { return o.x >= box.left && o.x <= box.right && o.y >= box.bottom && o.y <= box.top; }
            return overlaps(box, {left: o.x - (o.width / 2), right: o.x + (o.width / 2),
                bottom: o.y - (o.height / 2), top: o.y + (o.height / 2)});
        });
    }
    show (ref) {
        const map = findMap(this.doc, typeof ref === 'number' ? ref : Cast.toString(ref));
        if (!map) return false;
        if (this.shownId !== map.id) { this.shownId = map.id; this.dirty = true; }
        return true;
    }
    hide () {
        if (this.shownId !== null) { this.shownId = null; this.dirty = true; }
    }
    setLayerVisible (name, visible) {
        const layer = findLayer(this.map, name);
        if (!layer) return;
        this.hidden.set(layer.id, visible);
        this.dirty = true;
    }
    layerVisible (layer) { return this.hidden.has(layer.id) ? this.hidden.get(layer.id) : layer.visible; }
    patchRenderer () {
        const r = this.runtime.renderer;
        if (r) this.wrapRenderer(r);
        else {
            const attach = this.runtime.attachRenderer.bind(this.runtime);
            this.runtime.attachRenderer = renderer => { attach(renderer); this.wrapRenderer(renderer); };
        }
    }
    wrapRenderer (r) {
        if (r.__dimodTileMaps) return;
        r.__dimodTileMaps = true;
        const draw = r.draw.bind(r);
        r.draw = (...args) => {
            try { this.beforeDraw(); } catch (e) {
            }
            return draw(...args);
        };
        const pick = r.pick.bind(r);
        const mine = () => (this.canvases ? [this.canvases.back.drawableId, this.canvases.front.drawableId] : []);
        r.pick = (x, y, w, h, candidates) => pick(x, y, w, h, (candidates || r._drawList).filter(id => !mine().includes(id)));
    }
    ensureCanvases () {
        const r = this.runtime.renderer;
        if (!r || typeof document === 'undefined') return null;
        const w = this.stageW, h = this.stageH;
        if (this.canvases && this.canvases.w === w && this.canvases.h === h) return this.canvases;
        const make = (group, old) => {
            const canvas = old ? old.canvas : document.createElement('canvas');
            canvas.width = w * SCALE;
            canvas.height = h * SCALE;
            const skinId = old ? old.skinId : r.createBitmapSkin(canvas, SCALE);
            const drawableId = old ? old.drawableId : r.createDrawable(group);
            if (!old) r.updateDrawableSkinId(drawableId, skinId);
            r.updateDrawableVisible(drawableId, false);
            return {canvas, ctx: canvas.getContext('2d'), skinId, drawableId, shown: false, group};
        };
        const old = this.canvases;
        this.canvases = {w, h, back: make('pen', old && old.back), front: make('sprite', old && old.front)};
        this.dirty = true;
        return this.canvases;
    }
    beforeDraw () {
        const map = this.map;
        if (!map && !(this.canvases && (this.canvases.back.shown || this.canvases.front.shown))) return;
        const canvases = this.ensureCanvases();
        if (!canvases) return;
        const r = this.runtime.renderer;
        if (this.dirty) { this.dirty = false; this.paint(map, canvases); }
        if (canvases.front.shown) {
            toTopOfGroup(r, canvases.front.drawableId, 'sprite');
            const p = this.runtime.ext_basicParticles;
            if (p && p.layers && p.layers.front.shown) toTopOfGroup(r, p.layers.front.drawableId, 'sprite');
        }
        if (canvases.back.shown) toTopOfGroup(r, canvases.back.drawableId, 'pen');
    }
    paint (map, canvases) {
        const r = this.runtime.renderer;
        const lookup = map ? tileLookup(this.runtime, this.doc) : null;
        for (const front of [false, true]) {
            const c = front ? canvases.front : canvases.back;
            const ctx = c.ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
            let any = false;
            if (map) {
                const {scale, dir} = this.cam;
                ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
                ctx.translate(canvases.w / 2, canvases.h / 2);
                ctx.rotate(-dir * Math.PI / 180);
                ctx.scale(scale, scale);
                ctx.translate(-canvases.w / 2, -canvases.h / 2);
                ctx.imageSmoothingEnabled = false;
                if (!front && map.background) {
                    ctx.fillStyle = map.background;
                    ctx.fillRect(-this.camX, this.camY, map.cols * map.tileW, map.rows * map.tileH);
                    any = true;
                }
                for (const layer of map.layers) {
                    if (layer.kind !== 'tiles' || !!layer.front !== front || !this.layerVisible(layer)) continue;
                    if (this.paintLayer(ctx, map, layer, lookup, canvases)) any = true;
                }
                if (front && this.showOutlines) any = this.paintOutlines(ctx, map) || any;
            }
            r.updateBitmapSkin(c.skinId, c.canvas, SCALE);
            if (any !== c.shown) r.updateDrawableVisible(c.drawableId, any);
            c.shown = any;
        }
    }
    paintLayer (ctx, map, layer, lookup, canvases) {
        const ox = -this.camX * layer.parallax, oy = this.camY * layer.parallax;
        const {scale, dir} = this.cam;
        const zoom = Math.max(Math.abs(scale), 0.01), far = Math.hypot(canvases.w, canvases.h) / 2;
        const hw = (dir ? far : canvases.w / 2) / zoom, hh = (dir ? far : canvases.h / 2) / zoom;
        const x0 = (canvases.w / 2) - hw - ox, x1 = (canvases.w / 2) + hw - ox;
        const y0 = (canvases.h / 2) - hh - oy, y1 = (canvases.h / 2) + hh - oy;
        const c0 = Math.max(0, Math.floor(x0 / map.tileW)), c1 = Math.min(map.cols - 1, Math.floor(x1 / map.tileW));
        const r0 = Math.max(0, Math.floor(y0 / map.tileH)), r1 = Math.min(map.rows - 1, Math.floor(y1 / map.tileH));
        const cells = this.cells(layer);
        ctx.globalAlpha = layer.opacity;
        let any = false;
        for (let row = r0; row <= r1; row++) {
            for (let col = c0; col <= c1; col++) {
                const gid = cells[(row * map.cols) + col];
                if (!gid) continue;
                const tile = lookup(gid);
                if (!tile) continue;
                if (drawTile(ctx, tile, ox + (col * map.tileW), oy + (row * map.tileH), map.tileW, map.tileH)) any = true;
            }
        }
        ctx.globalAlpha = 1;
        return any;
    }
    paintOutlines (ctx, map) {
        let any = false;
        ctx.lineWidth = 1;
        ctx.font = '8px sans-serif';
        for (const layer of map.layers) {
            if (layer.kind !== 'objects') continue;
            for (const o of layer.objects) {
                const x = o.x - this.camX, y = o.y + this.camY;
                ctx.strokeStyle = ctx.fillStyle = o.type === 'solid' || layer.collides ? '#ff4d4d' : '#33d1ff';
                if (o.shape === 'point') { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); } else { ctx.strokeRect(x + 0.5, y + 0.5, o.w - 1, o.h - 1); }
                if (o.name || o.type) ctx.fillText(o.name || o.type, x + 2, y - 2);
                any = true;
            }
        }
        return any;
    }
    getInfo () {
        const xy = {X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}};
        const layer = {type: ArgumentType.STRING, menu: 'layers', defaultValue: ANY_LAYER};
        const type = {type: ArgumentType.STRING, defaultValue: 'checkpoint'};
        return {
            id: EXTENSION_ID,
            name: 'TileMaps',
            color1: COLOUR,
            color2: '#AD7731',
            color3: '#9C6B27',
            menuIconURI: ICON,
            blocks: [
                {blockType: BlockType.LABEL, text: 'Make maps in the TileMaps tab'},
                {opcode: 'showMap', blockType: BlockType.COMMAND, text: 'show map [MAP]',
                    arguments: {MAP: {type: ArgumentType.STRING, menu: 'maps'}}},
                {opcode: 'hideMap', blockType: BlockType.COMMAND, text: 'hide map'},
                {opcode: 'currentMap', blockType: BlockType.REPORTER, text: 'current map'},
                {opcode: 'setLayer', blockType: BlockType.COMMAND, text: '[SHOW] layer [LAYER]',
                    arguments: {SHOW: {type: ArgumentType.STRING, menu: 'showHide', defaultValue: 'hide'},
                        LAYER: {type: ArgumentType.STRING, menu: 'layerNames'}}},
                '---',
                {opcode: 'setCamera', blockType: BlockType.COMMAND, text: 'set camera to x: [X] y: [Y]', arguments: xy},
                {opcode: 'changeCamera', blockType: BlockType.COMMAND, text: 'change camera by x: [X] y: [Y]',
                    arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 10}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}}},
                {opcode: 'camera', blockType: BlockType.REPORTER, text: 'camera [AXIS]',
                    arguments: {AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'x'}}},
                '---',
                {opcode: 'tileAt', blockType: BlockType.REPORTER, text: 'tile at x: [X] y: [Y] in [LAYER]',
                    arguments: {...xy, LAYER: layer}},
                {opcode: 'setTileAt', blockType: BlockType.COMMAND, text: 'set tile at x: [X] y: [Y] in [LAYER] to [TILE]',
                    arguments: {...xy, LAYER: layer, TILE: {type: ArgumentType.STRING, defaultValue: ''}}},
                {opcode: 'tileAtCell', blockType: BlockType.REPORTER, text: 'tile at column [COL] row [ROW] in [LAYER]',
                    arguments: {COL: {type: ArgumentType.NUMBER, defaultValue: 1}, ROW: {type: ArgumentType.NUMBER, defaultValue: 1},
                        LAYER: layer}},
                {opcode: 'setTileAtCell', blockType: BlockType.COMMAND,
                    text: 'set tile at column [COL] row [ROW] in [LAYER] to [TILE]',
                    arguments: {COL: {type: ArgumentType.NUMBER, defaultValue: 1}, ROW: {type: ArgumentType.NUMBER, defaultValue: 1},
                        LAYER: layer, TILE: {type: ArgumentType.STRING, defaultValue: ''}}},
                {opcode: 'cellOf', blockType: BlockType.REPORTER, text: '[WHICH] of cell at x: [X] y: [Y]',
                    arguments: {...xy, WHICH: {type: ArgumentType.STRING, menu: 'colRow', defaultValue: 'column'}}},
                {opcode: 'cellCenter', blockType: BlockType.REPORTER, text: '[AXIS] of center of column [COL] row [ROW]',
                    arguments: {AXIS: {type: ArgumentType.STRING, menu: 'axis', defaultValue: 'x'},
                        COL: {type: ArgumentType.NUMBER, defaultValue: 1}, ROW: {type: ArgumentType.NUMBER, defaultValue: 1}}},
                {opcode: 'taggedAt', blockType: BlockType.BOOLEAN, text: 'tile at x: [X] y: [Y] tagged [TAG]?',
                    arguments: {...xy, TAG: {type: ArgumentType.STRING, defaultValue: 'solid'}}},
                '---',
                {opcode: 'moveCollide', blockType: BlockType.COMMAND, text: 'move x: [X] y: [Y] stopping at solid tiles',
                    arguments: {X: {type: ArgumentType.NUMBER, defaultValue: 5}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}}},
                {opcode: 'lastHit', blockType: BlockType.BOOLEAN, text: 'hit [SIDE] on last move?',
                    arguments: {SIDE: {type: ArgumentType.STRING, menu: 'sides', defaultValue: 'floor'}}},
                {opcode: 'standing', blockType: BlockType.BOOLEAN, text: 'standing on solid tiles?'},
                {opcode: 'touchingSolid', blockType: BlockType.BOOLEAN, text: 'touching solid tiles?'},
                {opcode: 'touchingTagged', blockType: BlockType.BOOLEAN, text: 'touching tiles tagged [TAG]?',
                    arguments: {TAG: {type: ArgumentType.STRING, defaultValue: 'spike'}}},
                '---',
                {opcode: 'touchingObject', blockType: BlockType.BOOLEAN, text: 'touching object of type [TYPE]?',
                    arguments: {TYPE: type}},
                {opcode: 'touchedObject', blockType: BlockType.REPORTER, text: 'name of touched object of type [TYPE]',
                    arguments: {TYPE: type}},
                {opcode: 'objectCount', blockType: BlockType.REPORTER, text: 'number of objects of type [TYPE]',
                    arguments: {TYPE: type}},
                {opcode: 'objectName', blockType: BlockType.REPORTER, text: 'name of object [INDEX] of type [TYPE]',
                    arguments: {INDEX: {type: ArgumentType.NUMBER, defaultValue: 1}, TYPE: type}},
                {opcode: 'objectProp', blockType: BlockType.REPORTER, text: '[PROP] of object [NAME]',
                    arguments: {PROP: {type: ArgumentType.STRING, menu: 'objectProps', defaultValue: 'x'},
                        NAME: {type: ArgumentType.STRING, defaultValue: 'start'}}},
                {opcode: 'objectCustom', blockType: BlockType.REPORTER, text: 'property [KEY] of object [NAME]',
                    arguments: {KEY: {type: ArgumentType.STRING, defaultValue: 'next'},
                        NAME: {type: ArgumentType.STRING, defaultValue: 'exit'}}},
                {opcode: 'goToObject', blockType: BlockType.COMMAND, text: 'go to object [NAME]',
                    arguments: {NAME: {type: ArgumentType.STRING, defaultValue: 'start'}}},
                {opcode: 'setOutlines', blockType: BlockType.COMMAND, text: '[SHOW] object outlines',
                    arguments: {SHOW: {type: ArgumentType.STRING, menu: 'showHide', defaultValue: 'show'}}}
            ],
            menus: {
                maps: {acceptReporters: true, items: 'mapsMenu'},
                layers: {acceptReporters: true, items: 'layersMenu'},
                layerNames: {acceptReporters: true, items: 'layerNamesMenu'},
                showHide: {acceptReporters: false, items: ['show', 'hide']},
                axis: {acceptReporters: false, items: ['x', 'y']},
                colRow: {acceptReporters: false, items: ['column', 'row']},
                sides: {acceptReporters: false, items: SIDES},
                objectProps: {acceptReporters: false, items: ['x', 'y', 'width', 'height', 'type']}
            },
            blockspace: {api: ({target}) => this.codeApi(target), types: TYPES, declarations: DECLARATIONS}
        };
    }
    mapsMenu () {
        const names = this.doc.maps.map(m => m.name);
        return names.length ? names : ['(make one in the TileMaps tab)'];
    }
    menuMap () { return this.map || this.doc.maps[0] || null; }
    layersMenu () {
        const map = this.menuMap();
        return [ANY_LAYER, ...(map ? map.layers.filter(l => l.kind === 'tiles').map(l => l.name) : [])];
    }
    layerNamesMenu () {
        const map = this.menuMap();
        const names = map ? map.layers.map(l => l.name) : [];
        return names.length ? names : ['Ground'];
    }
    showMap (args) { this.show(Cast.toString(args.MAP)); }
    hideMap () { this.hide(); }
    currentMap () { const map = this.map; return map ? map.name : ''; }
    setLayer (args) { this.setLayerVisible(Cast.toString(args.LAYER), Cast.toString(args.SHOW) !== 'hide'); }
    setCamera (args) { this.setCameraTo(Cast.toNumber(args.X), Cast.toNumber(args.Y)); }
    setCameraTo (x, y) {
        if (x !== this.camX || y !== this.camY) this.runtime.updateCamera('default', {pos: [x, y]});
    }
    changeCamera (args) { this.setCameraTo(this.camX + Cast.toNumber(args.X), this.camY + Cast.toNumber(args.Y)); }
    camera (args) { return Cast.toString(args.AXIS) === 'y' ? this.camY : this.camX; }
    tileAt (args) {
        const map = this.map;
        if (!map) return '';
        const [c, r] = this.cellAt(map, Cast.toNumber(args.X), Cast.toNumber(args.Y));
        return tileName(this.runtime, this.doc, this.gidAt(map, c, r, args.LAYER));
    }
    setTileAt (args) {
        const map = this.map;
        if (!map) return;
        const [c, r] = this.cellAt(map, Cast.toNumber(args.X), Cast.toNumber(args.Y));
        this.setGid(map, c, r, args.LAYER, resolveTile(this.runtime, this.doc, args.TILE));
    }
    tileAtCell (args) {
        const map = this.map;
        if (!map) return '';
        const gid = this.gidAt(map, Math.round(Cast.toNumber(args.COL)) - 1, Math.round(Cast.toNumber(args.ROW)) - 1, args.LAYER);
        return tileName(this.runtime, this.doc, gid);
    }
    setTileAtCell (args) {
        const map = this.map;
        if (!map) return;
        this.setGid(map, Math.round(Cast.toNumber(args.COL)) - 1, Math.round(Cast.toNumber(args.ROW)) - 1, args.LAYER,
            resolveTile(this.runtime, this.doc, args.TILE));
    }
    cellOf (args) {
        const map = this.map;
        if (!map) return 0;
        const [c, r] = this.cellAt(map, Cast.toNumber(args.X), Cast.toNumber(args.Y));
        return (Cast.toString(args.WHICH) === 'row' ? r : c) + 1;
    }
    cellCenter (args) {
        const map = this.menuMap();
        if (!map) return 0;
        const col = Math.round(Cast.toNumber(args.COL)) - 1, row = Math.round(Cast.toNumber(args.ROW)) - 1;
        const [x, y] = this.toStage((col + 0.5) * map.tileW, (row + 0.5) * map.tileH);
        return Cast.toString(args.AXIS) === 'y' ? y : x;
    }
    taggedAt (args) {
        const map = this.map;
        if (!map) return false;
        const [c, r] = this.cellAt(map, Cast.toNumber(args.X), Cast.toNumber(args.Y));
        return this.cellTags(map, c, r).has(Cast.toString(args.TAG));
    }
    moveCollide (args, util) { this.move(util.target, Cast.toNumber(args.X), Cast.toNumber(args.Y)); }
    lastHit (args, util) {
        const hit = this.hits.get(util.target.id);
        if (!hit) return false;
        switch (Cast.toString(args.SIDE)) {
        case 'floor': return hit.floor;
        case 'ceiling': return hit.ceiling;
        case 'left wall': return hit.left;
        case 'right wall': return hit.right;
        default: return hit.floor || hit.ceiling || hit.left || hit.right;
        }
    }
    standing (args, util) { return this.onGround(util.target); }
    touchingSolid (args, util) { return this.touchingTag(util.target, 'solid'); }
    touchingTagged (args, util) { return this.touchingTag(util.target, Cast.toString(args.TAG)); }
    touchingObject (args, util) { return this.touchingObjects(util.target, Cast.toString(args.TYPE)).length > 0; }
    touchedObject (args, util) {
        const o = this.touchingObjects(util.target, Cast.toString(args.TYPE))[0];
        return o ? o.name : '';
    }
    objectCount (args) { return this.objectsOf(this.map, Cast.toString(args.TYPE)).length; }
    objectName (args) {
        const o = this.objectsOf(this.map, Cast.toString(args.TYPE))[Math.round(Cast.toNumber(args.INDEX)) - 1];
        return o ? o.name : '';
    }
    objectProp (args) {
        const o = this.findObject(args.NAME);
        if (!o) return '';
        const prop = Cast.toString(args.PROP);
        return prop in o ? o[prop] : '';
    }
    objectCustom (args) {
        const o = this.findObject(args.NAME);
        const key = Cast.toString(args.KEY);
        return o && key in o.props ? o.props[key] : '';
    }
    goToObject (args, util) {
        const o = this.findObject(args.NAME);
        if (o && !util.target.isStage) util.target.setXY(o.x, o.y);
    }
    setOutlines (args) { this.outlinesOn(Cast.toString(args.SHOW) === 'show'); }
    outlinesOn (on) {
        if (this.showOutlines !== on) { this.showOutlines = on; this.dirty = true; }
    }
    codeApi (target) {
        const ext = this;
        const rawOf = sprite => (sprite && sprite._target) || sprite || target;
        const mapOrThrow = () => {
            const map = ext.map;
            if (!map) throw new Error('No map is showing... call tileMaps.show("map name") first');
            return map;
        };
        return {
            show: name => {
                if (!ext.show(String(name))) {
                    throw new Error(`There's no map called "${name}" (maps: ${ext.doc.maps.map(m => m.name).join(', ') || 'none yet'})`);
                }
            },
            hide: () => ext.hide(),
            get map () { return ext.map ? ext.map.name : null; },
            get maps () { return ext.doc.maps.map(m => m.name); },
            get camera () { return {x: ext.camX, y: ext.camY}; },
            set camera (v) { ext.setCameraTo(Number(v && v.x) || 0, Number(v && v.y) || 0); },
            setCamera: (x, y) => ext.setCameraTo(Number(x) || 0, Number(y) || 0),
            get size () {
                const map = ext.map;
                return map ? {cols: map.cols, rows: map.rows, tileWidth: map.tileW, tileHeight: map.tileH,
                    width: map.cols * map.tileW, height: map.rows * map.tileH} : null;
            },
            tileAt: (x, y, layer) => {
                const map = mapOrThrow();
                const [c, r] = ext.cellAt(map, Number(x), Number(y));
                return tileName(ext.runtime, ext.doc, ext.gidAt(map, c, r, layer));
            },
            setTile: (x, y, tile, layer) => {
                const map = mapOrThrow();
                const [c, r] = ext.cellAt(map, Number(x), Number(y));
                ext.setGid(map, c, r, layer, resolveTile(ext.runtime, ext.doc, tile));
            },
            tileAtCell: (col, row, layer) => tileName(ext.runtime, ext.doc, ext.gidAt(mapOrThrow(), col, row, layer)),
            setTileAtCell: (col, row, tile, layer) => ext.setGid(mapOrThrow(), col, row, layer,
                resolveTile(ext.runtime, ext.doc, tile)),
            cellAt: (x, y) => { const [col, row] = ext.cellAt(mapOrThrow(), Number(x), Number(y)); return {col, row}; },
            cellCenter: (col, row) => {
                const map = mapOrThrow();
                const [x, y] = ext.toStage((col + 0.5) * map.tileW, (row + 0.5) * map.tileH);
                return {x, y};
            },
            tagsAt: (x, y) => {
                const map = mapOrThrow();
                const [c, r] = ext.cellAt(map, Number(x), Number(y));
                return [...ext.cellTags(map, c, r)];
            },
            solidAt: (x, y) => {
                const map = ext.map;
                if (!map) return false;
                const [c, r] = ext.cellAt(map, Number(x), Number(y));
                return ext.cellTags(map, c, r).has('solid');
            },
            move: (dx, dy, sprite) => ({...ext.move(rawOf(sprite), Number(dx) || 0, Number(dy) || 0)}),
            onGround: sprite => ext.onGround(rawOf(sprite)),
            touchingSolid: sprite => ext.touchingTag(rawOf(sprite), 'solid'),
            touching: (tag, sprite) => ext.touchingTag(rawOf(sprite), String(tag)),
            objects: type => ext.objectsOf(ext.map, type ? String(type) : null),
            object: name => ext.findObject(name),
            touchingObjects: (type, sprite) => ext.touchingObjects(rawOf(sprite), type ? String(type) : null),
            showLayer: name => ext.setLayerVisible(String(name), true),
            hideLayer: name => ext.setLayerVisible(String(name), false),
            set outlines (on) { ext.outlinesOn(!!on); },
            get outlines () { return ext.showOutlines; }
        };
    }
}
const overlaps = (a, b) => a.right > b.left + EPS && a.left < b.right - EPS &&
    a.top > b.bottom + EPS && a.bottom < b.top - EPS;
const round2 = v => Math.round(v * 100) / 100;
const hasContent = doc => doc && (doc.maps.length || doc.tilesets.length);
const installTileMapsStorage = vm => {
    if (!sb3.__dimodTileMapsWrapped) {
        sb3.__dimodTileMapsWrapped = true;
        const serialize = sb3.serialize;
        sb3.serialize = (runtime, targetId, ...rest) => {
            const json = serialize(runtime, targetId, ...rest);
            if (!targetId && hasContent(runtime.dimodTileMaps)) json.dimodTileMaps = runtime.dimodTileMaps;
            return json;
        };
    }
    const deserialize = vm.deserializeProject.bind(vm);
    vm.deserializeProject = (projectJSON, zip) => {
        const raw = projectJSON && typeof projectJSON === 'object' ? projectJSON.dimodTileMaps : null;
        vm.runtime.dimodTileMaps = raw ? normalizeDoc(raw) : null;
        const ext = vm.runtime.ext_tileMaps;
        if (ext) { ext.shownId = null; ext.setCameraTo(0, 0); ext.resetRun(); }
        return Promise.resolve(deserialize(projectJSON, zip)).then(result => {
            if (raw && !vm.extensionManager.isExtensionLoaded(EXTENSION_ID)) {
                vm.extensionManager.loadExtensionURL(EXTENSION_ID).catch(() => {});
            }
            vm.runtime.emit(CHANGED_EVENT, {loaded: true});
            return result;
        });
    };
    const rename = vm.renameSprite.bind(vm);
    vm.renameSprite = (targetId, newName) => {
        const target = vm.runtime.getTargetById(targetId);
        const before = target && target.sprite ? target.sprite.name : null;
        const result = rename(targetId, newName);
        const after = target && target.sprite ? target.sprite.name : null;
        const doc = vm.runtime.dimodTileMaps;
        if (doc && before && after && before !== after) {
            let changed = false;
            for (const ts of doc.tilesets) {
                if (ts.sprite === before) { ts.sprite = after; changed = true; }
            }
            if (changed) vm.runtime.emit(CHANGED_EVENT, {});
        }
        return result;
    };
};
const installTileMapsVM = vm => {
    if (vm.__dimodTileMapsInstalled) return;
    vm.__dimodTileMapsInstalled = true;
    vm.runtime.dimodTileMaps = null;
    installTileMapsStorage(vm);
    vm.extensionManager.addBuiltinExtension(EXTENSION_ID, TileMaps);
};
export {CHANGED_EVENT, DECLARATIONS, EXTENSION_ID, GID_SHIFT, TYPES, TileMaps, drawTile, emptyDoc, findLayer, findMap, gidOf, installTileMapsVM, newMap, normalizeDoc, normalizeLayer, normalizeMap, normalizeObject, normalizeTileset, onTileImageLoad, resizeMap, resolveTile, tagsOf, tileIndexOf, tileLookup, tileName, tilesOf, tilesetIdOf, uniqueName};
