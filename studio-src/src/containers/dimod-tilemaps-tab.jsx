import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import VM from 'scratch-vm';
import {
    normalizeDoc,
    newMap,
    uniqueName,
    resizeMap,
    normalizeLayer,
    normalizeTileset,
    gidOf,
    tilesetIdOf,
    tileIndexOf,
    normalizeObject,
    onTileImageLoad,
    tileLookup,
    drawTile,
    tilesOf,
    CHANGED_EVENT
} from '../lib/dimod-tilemaps.js';
import JSZip from 'jszip';
import {isDarkTheme, askConfirm} from '../lib/dimod-ui';
import {broadcastTileMaps} from '../lib/dimod-collab';
import styles from '../components/dimod-tilemaps/tilemaps-tab.css';
import shared from '../components/block-space/block-space-panel.css';
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
const spike = rotate => svg(`<g transform="rotate(${rotate} 12 12)"><path d="M1 24 L6 1 L11 24 Z M13 24 L18 1 L23 24 Z" ` +
    'fill="#d9dde3" stroke="#5b616b" stroke-width="1.2" stroke-linejoin="round"/></g>');
const STARTER_TILES = [
    {name: 'grass', svg: svg('<rect width="24" height="24" fill="#8a5a33"/><rect width="24" height="7" fill="#4fae4a"/>' +
        '<rect y="7" width="24" height="2" fill="#3d8a3a"/><rect x="5" y="14" width="3" height="2" fill="#6e4628"/>' +
        '<rect x="15" y="18" width="3" height="2" fill="#6e4628"/>')},
    {name: 'dirt', svg: svg('<rect width="24" height="24" fill="#8a5a33"/><rect x="4" y="5" width="3" height="2" fill="#6e4628"/>' +
        '<rect x="15" y="10" width="3" height="2" fill="#6e4628"/><rect x="7" y="17" width="3" height="2" fill="#6e4628"/>')},
    {name: 'brick', svg: svg('<rect width="24" height="24" fill="#b4523a"/><path d="M0 7.5h24M0 15.5h24M0 23.5h24M11.5 0v7.5M4.5 7.5v8' +
        'M18.5 7.5v8M11.5 15.5v8" stroke="#7c3324" stroke-width="1.4"/>')},
    {name: 'stone', svg: svg('<rect width="24" height="24" fill="#7e8590"/><rect x="1" y="1" width="22" height="22" fill="none" ' +
        'stroke="#a3a9b3" stroke-width="2"/><path d="M1 23h22V1" fill="none" stroke="#5b616b" stroke-width="2"/>')},
    {name: 'spike up', svg: spike(0), tags: ['spike']},
    {name: 'spike down', svg: spike(180), tags: ['spike']},
    {name: 'spike left', svg: spike(270), tags: ['spike']},
    {name: 'spike right', svg: spike(90), tags: ['spike']},
    {name: 'platform', svg: svg('<rect y="2" width="24" height="7" fill="#b9844a"/><rect y="2" width="24" height="2" fill="#d9a466"/>' +
        '<rect y="9" width="24" height="1.5" fill="#7a5329"/>')},
    {name: 'water', svg: svg('<rect width="24" height="24" fill="#3d8bdb" fill-opacity="0.55"/>' +
        '<path d="M0 4c4-2 8 2 12 0s8 2 12 0" fill="none" stroke="#bfe0ff" stroke-width="1.5"/>'), tags: ['water']}
];
const addStarterTiles = async (vm, tiles = STARTER_TILES, spriteName = 'Tiles') => {
    const storage = vm.runtime.storage;
    const zip = new JSZip();
    const enc = new TextEncoder();
    const costumes = tiles.map(t => {
        const data = enc.encode(t.svg);
        const asset = storage.createAsset(storage.AssetType.ImageVector, storage.DataFormat.SVG, data, null, true);
        zip.file(`${asset.assetId}.svg`, data);
        return {name: t.name, bitmapResolution: 1, dataFormat: 'svg', assetId: asset.assetId,
            md5ext: `${asset.assetId}.svg`, rotationCenterX: 12, rotationCenterY: 12};
    });
    zip.file('sprite.json', JSON.stringify({
        isStage: false, name: spriteName, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0, costumes, sounds: [], volume: 100, visible: false, x: 0, y: 0, size: 100,
        direction: 90, draggable: false, rotationStyle: 'all around'
    }));
    const before = new Set(vm.runtime.targets.map(t => t.id));
    const editing = vm.editingTarget;
    await vm.addSprite(await zip.generateAsync({type: 'arraybuffer'}));
    const made = vm.runtime.targets.find(t => t.isOriginal && !before.has(t.id));
    if (!made) return null;
    if (editing && vm.runtime.getTargetById(editing.id)) vm.setEditingTarget(editing.id);
    const tags = {};
    tiles.forEach((t, i) => {
        if (t.tags) tags[String(i)] = {tags: t.tags};
    });
    return {name: made.sprite.name, tiles: tags};
};
const UNDO_LIMIT = 100;
const PALETTE_CELL = 36;
const OBJECT_TYPES = ['start', 'checkpoint', 'exit', 'solid', 'enemy', 'trigger', 'item'];
const TOOLS = [
    {id: 'brush', key: 'b', label: 'Brush', layer: 'tiles',
        icon: 'M4 20c3 0 5-2 5-4.5S7 12 5.5 13.5 4 17 4 20zM9.5 12.5l9-9 2 2-9 9'},
    {id: 'erase', key: 'e', label: 'Eraser', layer: 'tiles', icon: 'M9 20h11M4.5 15.5l9.5-9.5 5 5-9.5 9.5H8z'},
    {id: 'fill', key: 'f', label: 'Fill', layer: 'tiles',
        icon: 'M5 11l7-7 7 7-7 7zM19 15c0 0 2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z'},
    {id: 'rect', key: 'r', label: 'Rectangle of tiles', layer: 'tiles', icon: 'M4 4h16v16H4z'},
    {id: 'pick', key: 'i', label: 'Pick a tile from the map', layer: 'tiles', icon: 'M14 4l6 6-2 2-6-6zM12 8L4 16v4h4l8-8'},
    {id: 'select', key: 'v', label: 'Select and move objects', layer: 'objects', icon: 'M5 3l13 8-6 1.5L9 19z'},
    {id: 'objRect', key: 'o', label: 'New rectangle object', layer: 'objects', icon: 'M4 6h16v12H4zM9 3v3M15 3v3'},
    {id: 'objPoint', key: 'p', label: 'New marker', layer: 'objects',
        icon: 'M12 21s-6-6.5-6-11a6 6 0 0 1 12 0c0 4.5-6 11-6 11zM12 8v4'}
];
const Glyph = ({d}) => (
    <svg
        className={styles.glyph}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
    ><path d={d} /></svg>
);
Glyph.propTypes = {d: PropTypes.string};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
class DimodTileMapsTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleChanged', 'handleImages', 'handleKey', 'handleResize',
            'setCanvasRef', 'setPaletteRef', 'setHostRef',
            'handleMouseDown', 'handleMouseMove', 'handleMouseUp', 'handleWheel', 'handleContextMenu',
            'handlePaletteClick', 'draw', 'drawPalette'
        ]);
        this.undoStack = [];
        this.redoStack = [];
        this.drag = null;
        this.hover = null;
        this.view = null;
        this.namesSig = '';
        const doc = this.doc;
        const map = doc.maps[0] || null;
        this.state = {
            v: 0,
            mapId: map ? map.id : null,
            layerId: map && map.layers[0] ? map.layers[0].id : null,
            tool: 'brush',
            brush: 0,
            tilesetId: doc.tilesets[0] ? doc.tilesets[0].id : null,
            objectId: null,
            grid: true,
            snap: true,
            preview: false,
            adding: null
        };
    }
    componentDidMount () {
        this.props.vm.runtime.on(CHANGED_EVENT, this.handleChanged);
        this.offImages = onTileImageLoad(this.handleImages);
        window.addEventListener('keydown', this.handleKey);
        window.addEventListener('mouseup', this.handleMouseUp);
        this.resizeObserver = new ResizeObserver(this.handleResize);
        if (this.hostEl) this.resizeObserver.observe(this.hostEl);
        this.handleResize();
    }
    componentDidUpdate (prevProps, prevState) {
        if (prevState.mapId !== this.state.mapId) { this.view = null; this.viewMoved = false; }
        if (this.props.isVisible && !prevProps.isVisible) this.handleResize();
        this.draw();
        this.drawPalette();
    }
    componentWillUnmount () {
        this.props.vm.runtime.removeListener(CHANGED_EVENT, this.handleChanged);
        if (this.offImages) this.offImages();
        window.removeEventListener('keydown', this.handleKey);
        window.removeEventListener('mouseup', this.handleMouseUp);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        cancelAnimationFrame(this.raf);
    }
    get runtime () { return this.props.vm.runtime; }
    get doc () {
        if (!this.runtime.dimodTileMaps) this.runtime.dimodTileMaps = normalizeDoc(null);
        return this.runtime.dimodTileMaps;
    }
    get ext () { return this.runtime.ext_tileMaps || null; }
    get map () { return this.doc.maps.find(m => m.id === this.state.mapId) || this.doc.maps[0] || null; }
    get layer () {
        const map = this.map;
        if (!map) return null;
        return map.layers.find(l => l.id === this.state.layerId) || map.layers[0] || null;
    }
    get object () {
        const map = this.map;
        if (!map || this.state.objectId === null) return null;
        for (const l of map.layers) {
            if (l.kind !== 'objects') continue;
            const o = l.objects.find(x => x.id === this.state.objectId);
            if (o) return o;
        }
        return null;
    }
    handleChanged (info) {
        if (this.editing) return;
        if (info && info.loaded) {
            this.undoStack = [];
            this.redoStack = [];
            const map = this.doc.maps[0] || null;
            this.setState({mapId: map ? map.id : null, layerId: map && map.layers[0] ? map.layers[0].id : null,
                objectId: null, tilesetId: this.doc.tilesets[0] ? this.doc.tilesets[0].id : null});
        }
        this.bump();
    }
    handleImages () { this.scheduleDraw(); }
    bump () { this.setState(s => ({v: s.v + 1})); }
    snapshot () {
        this.undoStack.push(JSON.stringify(this.doc));
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
        this.redoStack = [];
    }
    edit (fn, {undo = true} = {}) {
        if (undo) this.snapshot();
        fn(this.doc);
        this.changed();
    }
    changed () {
        this.editing = true;
        try { this.runtime.emit(CHANGED_EVENT, {}); } finally { this.editing = false; }
        this.runtime.emitProjectChanged();
        broadcastTileMaps(this.props.vm);
        const sig = JSON.stringify(this.doc.maps.map(m => [m.name, m.layers.map(l => l.name)]));
        if (sig !== this.namesSig) {
            this.namesSig = sig;
            clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => {
                const manager = this.props.vm.extensionManager;
                if (manager.refreshBlocks) manager.refreshBlocks();
            }, 500);
        }
        this.bump();
    }
    restore (from, to) {
        if (!from.length) return;
        to.push(JSON.stringify(this.doc));
        this.runtime.dimodTileMaps = normalizeDoc(JSON.parse(from.pop()));
        this.changed();
    }
    undo () { this.restore(this.undoStack, this.redoStack); }
    redo () { this.restore(this.redoStack, this.undoStack); }
    addMap () {
        const doc = this.doc;
        let made = null;
        this.edit(d => {
            const last = this.map;
            made = newMap(d, uniqueName(d.maps.map(m => m.name), 'Level 1'), last ?
                {cols: last.cols, rows: last.rows, tileW: last.tileW, tileH: last.tileH} : {});
        });
        this.setState({mapId: made.id, layerId: made.layers[0].id, objectId: null, tool: 'brush'});
        if (!doc.tilesets.length) this.setState({tilesetId: null});
    }
    duplicateMap () {
        const map = this.map;
        if (!map) return;
        let made = null;
        this.edit(d => {
            const copy = JSON.parse(JSON.stringify(map));
            copy.id = d.nextId++;
            copy.name = uniqueName(d.maps.map(m => m.name), map.name);
            for (const l of copy.layers) {
                l.id = d.nextId++;
                for (const o of l.objects || []) o.id = d.nextId++;
            }
            d.maps.splice(d.maps.indexOf(map) + 1, 0, copy);
            made = copy;
        });
        this.setState({mapId: made.id, layerId: made.layers[0] ? made.layers[0].id : null, objectId: null});
    }
    async deleteMap () {
        const map = this.map;
        if (!map) return;
        const ok = await askConfirm(`Delete the map "${map.name}"?`, {ok: 'Delete', danger: true});
        if (!ok) return;
        this.edit(d => { d.maps.splice(d.maps.indexOf(map), 1); });
        const next = this.doc.maps[0] || null;
        this.setState({mapId: next ? next.id : null, layerId: next && next.layers[0] ? next.layers[0].id : null, objectId: null});
    }
    setMapField (field, value) {
        const map = this.map;
        if (!map) return;
        this.edit(() => {
            if (field === 'name') {
                const name = String(value).trim();
                if (name) map.name = uniqueName(this.doc.maps.filter(m => m !== map).map(m => m.name), name);
            } else if (field === 'size') {
                resizeMap(map, value.cols, value.rows);
            } else if (field === 'tileW' || field === 'tileH') {
                map[field] = clamp(Math.round(Number(value)) || map[field], 4, 256);
            } else if (field === 'background') { map.background = value; }
        });
    }
    togglePreview () {
        const ext = this.ext;
        const preview = !this.state.preview;
        if (ext) {
            if (preview && this.map) ext.show(this.map.id);
            else ext.hide();
        }
        this.setState({preview});
    }
    addLayer (kind) {
        const map = this.map;
        if (!map) return;
        let made = null;
        this.edit(d => {
            made = normalizeLayer({kind, name: uniqueName(map.layers.map(l => l.name), kind === 'objects' ? 'Objects' : 'Tiles')}, map, d);
            const at = map.layers.indexOf(this.layer);
            map.layers.splice(at < 0 ? map.layers.length : at + 1, 0, made);
        });
        this.selectLayer(made);
    }
    selectLayer (layer) {
        if (!layer) return;
        const tool = TOOLS.find(t => t.id === this.state.tool);
        const next = {layerId: layer.id};
        if (tool && tool.layer !== layer.kind) next.tool = layer.kind === 'objects' ? 'select' : 'brush';
        if (layer.kind !== 'objects') next.objectId = null;
        this.setState(next);
    }
    moveLayer (dir) {
        const map = this.map, layer = this.layer;
        if (!map || !layer) return;
        const i = map.layers.indexOf(layer), j = i + dir;
        if (j < 0 || j >= map.layers.length) return;
        this.edit(() => { map.layers.splice(i, 1); map.layers.splice(j, 0, layer); });
    }
    async deleteLayer () {
        const map = this.map, layer = this.layer;
        if (!map || !layer) return;
        const ok = await askConfirm(`Delete the layer "${layer.name}"?`, {ok: 'Delete', danger: true});
        if (!ok) return;
        const i = map.layers.indexOf(layer);
        this.edit(() => { map.layers.splice(i, 1); });
        const next = map.layers[Math.max(0, i - 1)];
        this.setState({layerId: next ? next.id : null, objectId: null});
    }
    setLayerField (layer, field, value) {
        this.edit(() => {
            if (field === 'name') {
                const name = String(value).trim();
                if (name) layer.name = uniqueName(this.map.layers.filter(l => l !== layer).map(l => l.name), name);
            } else { layer[field] = value; }
        });
    }
    get tileset () { return this.doc.tilesets.find(t => t.id === this.state.tilesetId) || this.doc.tilesets[0] || null; }
    sprites () { return this.runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => t.sprite.name); }
    startAddTileset () {
        const sprites = this.sprites();
        const sprite = sprites[0] || '';
        this.setState({adding: {sprite, kind: 'costumes', costume: '', tileW: 24, tileH: 24}});
    }
    finishAddTileset () {
        const a = this.state.adding;
        if (!a || !a.sprite) return;
        let made = null;
        this.edit(d => {
            made = normalizeTileset({name: uniqueName(d.tilesets.map(t => t.name), a.sprite), sprite: a.sprite, kind: a.kind,
                costume: a.costume, tileW: a.tileW, tileH: a.tileH}, d);
            d.tilesets.push(made);
        });
        this.setState({adding: null, tilesetId: made.id, brush: gidOf(made.id, 0)});
    }
    async starterTiles () {
        const made = await addStarterTiles(this.props.vm);
        if (!made) return;
        let ts = null;
        this.edit(d => {
            ts = normalizeTileset({name: uniqueName(d.tilesets.map(t => t.name), made.name), sprite: made.name,
                kind: 'costumes', tiles: made.tiles}, d);
            d.tilesets.push(ts);
        });
        this.setState({tilesetId: ts.id, brush: gidOf(ts.id, 0)});
    }
    async deleteTileset () {
        const ts = this.tileset;
        if (!ts) return;
        const ok = await askConfirm(`Remove the tileset "${ts.name}"? Its tiles disappear from every map (the sprite stays).`,
            {ok: 'Remove', danger: true});
        if (!ok) return;
        this.edit(d => {
            d.tilesets.splice(d.tilesets.indexOf(ts), 1);
            for (const m of d.maps) {
                for (const l of m.layers) {
                    if (l.kind !== 'tiles') continue;
                    for (let i = 0; i < l.data.length; i++) if (l.data[i] && tilesetIdOf(l.data[i]) === ts.id) l.data[i] = 0;
                }
            }
        });
        const next = this.doc.tilesets[0] || null;
        this.setState({tilesetId: next ? next.id : null, brush: 0});
    }
    setTileTags (text) {
        const ts = this.tileset, gid = this.state.brush;
        if (!ts || !gid || tilesetIdOf(gid) !== ts.id) return;
        const tags = String(text).split(',').map(t => t.trim()).filter(Boolean);
        this.edit(() => {
            const key = String(tileIndexOf(gid));
            if (tags.length) ts.tiles[key] = {tags};
            else delete ts.tiles[key];
        });
    }
    setObjectField (field, value) {
        const o = this.object;
        if (!o) return;
        this.edit(() => {
            if (['x', 'y', 'w', 'h'].includes(field)) {
                const n = Number(value);
                if (Number.isFinite(n)) o[field] = field === 'w' || field === 'h' ? Math.max(1, n) : n;
            } else { o[field] = String(value); }
        });
    }
    setObjectProp (oldKey, key, value) {
        const o = this.object;
        if (!o) return;
        this.edit(() => {
            const props = {};
            for (const [k, v] of Object.entries(o.props)) {
                if (k === oldKey) {
                    if (key) props[key] = value;
                } else { props[k] = v; }
            }
            if (oldKey === null && key) props[key] = value;
            o.props = props;
        });
    }
    deleteObject () {
        const o = this.object, map = this.map;
        if (!o || !map) return;
        this.edit(() => {
            for (const l of map.layers) if (l.objects) l.objects = l.objects.filter(x => x !== o);
        });
        this.setState({objectId: null});
    }
    handleResize () {
        const host = this.hostEl, canvas = this.canvasEl;
        if (!host || !canvas) return;
        const w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        this.size = {w, h, dpr};
        if (!this.viewMoved) this.view = null;
        this.draw();
        this.drawPalette();
    }
    fit () {
        const map = this.map;
        if (!map || !this.size) return;
        const mw = map.cols * map.tileW, mh = map.rows * map.tileH;
        const zoom = clamp(Math.min((this.size.w - 40) / mw, (this.size.h - 40) / mh), 0.1, 8);
        this.view = {zoom, panX: (this.size.w - (mw * zoom)) / 2, panY: (this.size.h - (mh * zoom)) / 2};
    }
    zoomBy (factor, cx, cy) {
        if (!this.view) this.fit();
        if (!this.view || !this.size) return;
        const v = this.view;
        const x = typeof cx === 'number' ? cx : this.size.w / 2, y = typeof cy === 'number' ? cy : this.size.h / 2;
        const zoom = clamp(v.zoom * factor, 0.1, 16);
        v.panX = x - ((x - v.panX) * (zoom / v.zoom));
        v.panY = y - ((y - v.panY) * (zoom / v.zoom));
        v.zoom = zoom;
        this.viewMoved = true;
        this.bump();
    }
    toMap (e) {
        const rect = this.canvasEl.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const v = this.view;
        return {sx, sy, x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom};
    }
    cellOf (p) { const map = this.map; return {col: Math.floor(p.x / map.tileW), row: Math.floor(p.y / map.tileH)}; }
    inMap (c) { const map = this.map; return c.col >= 0 && c.row >= 0 && c.col < map.cols && c.row < map.rows; }
    snapped (v, size) { return this.state.snap ? Math.round(v / size) * size : Math.round(v); }
    paintCell (c, gid) {
        const layer = this.layer, map = this.map;
        if (!layer || layer.kind !== 'tiles' || !this.inMap(c)) return false;
        const i = (c.row * map.cols) + c.col;
        if (layer.data[i] === gid) return false;
        layer.data[i] = gid;
        return true;
    }
    paintLine (a, b, gid) {
        let changed = false;
        const n = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
        for (let i = 0; i <= n; i++) {
            const t = n ? i / n : 0;
            changed = this.paintCell({col: Math.round(a.col + ((b.col - a.col) * t)), row: Math.round(a.row + ((b.row - a.row) * t))}, gid) || changed;
        }
        return changed;
    }
    floodFill (c, gid) {
        const layer = this.layer, map = this.map;
        if (!layer || layer.kind !== 'tiles' || !this.inMap(c)) return;
        const from = layer.data[(c.row * map.cols) + c.col];
        if (from === gid) return;
        this.edit(() => {
            const stack = [[c.col, c.row]];
            while (stack.length) {
                const [x, y] = stack.pop();
                if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) continue;
                const i = (y * map.cols) + x;
                if (layer.data[i] !== from) continue;
                layer.data[i] = gid;
                stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
            }
        });
    }
    pickAt (c) {
        const map = this.map;
        if (!this.inMap(c)) return;
        for (let i = map.layers.length - 1; i >= 0; i--) {
            const l = map.layers[i];
            if (l.kind !== 'tiles' || !l.visible) continue;
            const gid = l.data[(c.row * map.cols) + c.col];
            if (gid) { this.setState({brush: gid, tilesetId: tilesetIdOf(gid), tool: 'brush', layerId: l.id}); return; }
        }
    }
    objectAt (p) {
        const map = this.map;
        const pad = 6 / this.view.zoom;
        for (let i = map.layers.length - 1; i >= 0; i--) {
            const l = map.layers[i];
            if (l.kind !== 'objects' || !l.visible) continue;
            for (let j = l.objects.length - 1; j >= 0; j--) {
                const o = l.objects[j];
                if (o.shape === 'point' ? Math.hypot(p.x - o.x, p.y - o.y) <= pad + 3 :
                    p.x >= o.x - pad && p.x <= o.x + o.w + pad && p.y >= o.y - pad && p.y <= o.y + o.h + pad) {
                    return {o, layer: l};
                }
            }
        }
        return null;
    }
    addObject (shape, x, y, w, h) {
        let layer = this.layer;
        const map = this.map;
        if (!layer || layer.kind !== 'objects') layer = map.layers.find(l => l.kind === 'objects');
        if (!layer) return;
        let made = null;
        this.edit(d => {
            const taken = map.layers.flatMap(l => (l.objects || []).map(o => o.name));
            made = normalizeObject({shape, x, y, w, h, type: shape === 'point' ? 'start' : 'trigger',
                name: uniqueName(taken, shape === 'point' ? 'marker' : 'area')}, d);
            layer.objects.push(made);
        });
        this.setState({objectId: made.id, layerId: layer.id, tool: 'select'});
    }
    handleMouseDown (e) {
        const map = this.map;
        if (!map || !this.view) return;
        e.preventDefault();
        this.canvasEl.focus({preventScroll: true});
        const p = this.toMap(e);
        if (e.button === 1 || this.spaceDown) {
            this.drag = {kind: 'pan', sx: p.sx, sy: p.sy, panX: this.view.panX, panY: this.view.panY};
            return;
        }
        const tool = this.state.tool;
        const c = this.cellOf(p);
        const erase = e.button === 2;
        if (tool === 'brush' || tool === 'erase') {
            const gid = tool === 'erase' || erase ? 0 : this.state.brush;
            this.snapshot();
            if (this.paintCell(c, gid)) this.changed();
            this.drag = {kind: 'paint', gid, last: c};
        } else if (tool === 'fill') { this.floodFill(c, erase ? 0 : this.state.brush); } else if (tool === 'rect') {
            this.drag = {kind: 'rect', from: c, to: c, gid: erase ? 0 : this.state.brush};
        } else if (tool === 'pick') { this.pickAt(c); } else if (tool === 'select') {
            const hit = this.objectAt(p);
            if (!hit) {
                this.setState({objectId: null});
                this.drag = {kind: 'pan', sx: p.sx, sy: p.sy, panX: this.view.panX, panY: this.view.panY};
                return;
            }
            const {o} = hit;
            const corner = o.shape === 'rect' && Math.abs(p.x - (o.x + o.w)) < 8 / this.view.zoom &&
                Math.abs(p.y - (o.y + o.h)) < 8 / this.view.zoom;
            this.setState({objectId: o.id, layerId: hit.layer.id});
            this.snapshot();
            this.drag = {kind: corner ? 'resize' : 'move', o, px: p.x, py: p.y, ox: o.x, oy: o.y, ow: o.w, oh: o.h};
        } else if (tool === 'objRect') {
            const x = this.snapped(p.x, map.tileW), y = this.snapped(p.y, map.tileH);
            this.drag = {kind: 'newRect', x, y, x2: x, y2: y};
        } else if (tool === 'objPoint') {
            this.addObject('point', this.snapped(p.x, map.tileW / 2), this.snapped(p.y, map.tileH / 2), 0, 0);
        }
    }
    handleMouseMove (e) {
        const map = this.map;
        if (!map || !this.view) return;
        const p = this.toMap(e);
        this.hover = this.cellOf(p);
        this.hoverPoint = p;
        const d = this.drag;
        if (d) {
            if (d.kind === 'pan') {
                this.viewMoved = true;
                this.view.panX = d.panX + (p.sx - d.sx);
                this.view.panY = d.panY + (p.sy - d.sy);
            } else if (d.kind === 'paint') {
                if (this.paintLine(d.last, this.hover, d.gid)) this.changed();
                d.last = this.hover;
            } else if (d.kind === 'rect') { d.to = this.hover; } else if (d.kind === 'move') {
                d.o.x = this.snapped(d.ox + (p.x - d.px), d.o.shape === 'point' ? map.tileW / 2 : map.tileW);
                d.o.y = this.snapped(d.oy + (p.y - d.py), d.o.shape === 'point' ? map.tileH / 2 : map.tileH);
                d.moved = true;
            } else if (d.kind === 'resize') {
                d.o.w = Math.max(this.state.snap ? map.tileW : 1, this.snapped(d.ow + (p.x - d.px), map.tileW));
                d.o.h = Math.max(this.state.snap ? map.tileH : 1, this.snapped(d.oh + (p.y - d.py), map.tileH));
                d.moved = true;
            } else if (d.kind === 'newRect') { d.x2 = this.snapped(p.x, map.tileW); d.y2 = this.snapped(p.y, map.tileH); }
        }
        this.scheduleDraw();
    }
    handleMouseUp () {
        const d = this.drag;
        this.drag = null;
        if (!d) return;
        if (d.kind === 'rect') {
            const c0 = Math.min(d.from.col, d.to.col), c1 = Math.max(d.from.col, d.to.col);
            const r0 = Math.min(d.from.row, d.to.row), r1 = Math.max(d.from.row, d.to.row);
            this.edit(() => {
                for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.paintCell({col: c, row: r}, d.gid);
            });
        } else if (d.kind === 'move' || d.kind === 'resize') {
            if (d.moved) this.changed();
            else this.undoStack.pop();
        } else if (d.kind === 'newRect') {
            const map = this.map;
            let x = Math.min(d.x, d.x2), y = Math.min(d.y, d.y2);
            let w = Math.abs(d.x2 - d.x), h = Math.abs(d.y2 - d.y);
            if (w < 2 || h < 2) {
                w = map.tileW;
                h = map.tileH;
                x = Math.floor(d.x / map.tileW) * map.tileW;
                y = Math.floor(d.y / map.tileH) * map.tileH;
            }
            this.addObject('rect', x, y, w, h);
        }
        this.scheduleDraw();
    }
    handleWheel (e) {
        if (!this.view) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey || !e.shiftKey) {
            const rect = this.canvasEl.getBoundingClientRect();
            this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
        } else { this.view.panX -= e.deltaX || e.deltaY; this.scheduleDraw(); }
    }
    handleContextMenu (e) { e.preventDefault(); }
    handleKey (e) {
        if (!this.props.isVisible) return;
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
        if (e.type === 'keydown' && e.key === ' ') {
            this.spaceDown = true;
            window.addEventListener('keyup', function up (ev) {
                if (ev.key === ' ') { this.spaceDown = false; window.removeEventListener('keyup', up); }
            }.bind(this));
            return;
        }
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) this.redo();
            else this.undo();
            return;
        }
        if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
        if (mod) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.object) { e.preventDefault(); this.deleteObject(); return; }
        if (e.key === 'g') { this.setState(s => ({grid: !s.grid})); return; }
        const tool = TOOLS.find(t => t.key === e.key);
        if (tool) this.setTool(tool.id);
    }
    setTool (id) {
        const tool = TOOLS.find(t => t.id === id);
        const map = this.map;
        const next = {tool: id};
        if (map && this.layer && tool.layer !== this.layer.kind) {
            const layer = map.layers.find(l => l.kind === tool.layer);
            if (layer) next.layerId = layer.id;
        }
        if (tool.layer !== 'objects') next.objectId = null;
        this.setState(next);
    }
    scheduleDraw () {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); this.drawPalette(); });
    }
    draw () {
        const canvas = this.canvasEl, map = this.map;
        if (!canvas || !this.size) return;
        const ctx = canvas.getContext('2d');
        const {w, h, dpr} = this.size;
        const dark = isDarkTheme();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = dark ? '#1b1d22' : '#e4e9ef';
        ctx.fillRect(0, 0, w, h);
        if (!map) return;
        if (!this.view) this.fit();
        const v = this.view;
        const mw = map.cols * map.tileW, mh = map.rows * map.tileH;
        ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.panX, dpr * v.panY);
        ctx.imageSmoothingEnabled = false;
        if (map.background) { ctx.fillStyle = map.background; ctx.fillRect(0, 0, mw, mh); } else {
            ctx.fillStyle = dark ? '#2a2d34' : '#ffffff';
            ctx.fillRect(0, 0, mw, mh);
            ctx.fillStyle = dark ? '#30333b' : '#f1f3f6';
            const s = Math.max(map.tileW, map.tileH) / 2;
            for (let y = 0; y < mh; y += s) {
                for (let x = ((y / s) % 2) * s; x < mw; x += s * 2) ctx.fillRect(x, y, Math.min(s, mw - x), Math.min(s, mh - y));
            }
        }
        const lookup = tileLookup(this.runtime, this.doc);
        const active = this.layer;
        const c0 = clamp(Math.floor(-v.panX / v.zoom / map.tileW), 0, map.cols - 1);
        const c1 = clamp(Math.floor((w - v.panX) / v.zoom / map.tileW), 0, map.cols - 1);
        const r0 = clamp(Math.floor(-v.panY / v.zoom / map.tileH), 0, map.rows - 1);
        const r1 = clamp(Math.floor((h - v.panY) / v.zoom / map.tileH), 0, map.rows - 1);
        for (const layer of map.layers) {
            if (layer.kind !== 'tiles' || !layer.visible) continue;
            ctx.globalAlpha = layer.opacity * (active && active.kind === 'tiles' && active !== layer ? 0.75 : 1);
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    const gid = layer.data[(r * map.cols) + c];
                    const tile = gid && lookup(gid);
                    if (tile) drawTile(ctx, tile, c * map.tileW, r * map.tileH, map.tileW, map.tileH);
                }
            }
        }
        ctx.globalAlpha = 1;
        const px = 1 / v.zoom;
        if (this.state.grid && v.zoom * Math.min(map.tileW, map.tileH) >= 6) {
            ctx.strokeStyle = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)';
            ctx.lineWidth = px;
            ctx.beginPath();
            for (let c = 0; c <= map.cols; c++) { ctx.moveTo(c * map.tileW, 0); ctx.lineTo(c * map.tileW, mh); }
            for (let r = 0; r <= map.rows; r++) { ctx.moveTo(0, r * map.tileH); ctx.lineTo(mw, r * map.tileH); }
            ctx.stroke();
        }
        const sw = this.runtime.stageWidth || 480, sh = this.runtime.stageHeight || 360;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1.5 * px;
        ctx.strokeRect(0, 0, sw, sh);
        ctx.setLineDash([]);
        this.drawObjects(ctx, map, px);
        this.drawCursor(ctx, map, lookup, px);
    }
    drawObjects (ctx, map, px) {
        const accent = '#4c97ff';
        ctx.font = `${11 * px}px sans-serif`;
        ctx.textBaseline = 'bottom';
        for (const layer of map.layers) {
            if (layer.kind !== 'objects' || !layer.visible) continue;
            for (const o of layer.objects) {
                const solid = o.type === 'solid' || layer.collides;
                const color = solid ? '#e5484d' : (o.shape === 'point' ? '#f5a524' : '#12a594');
                const selected = o.id === this.state.objectId;
                ctx.lineWidth = (selected ? 2.5 : 1.5) * px;
                if (o.shape === 'point') {
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(o.x, o.y, 5 * px, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = selected ? accent : '#fff';
                    ctx.stroke();
                } else {
                    ctx.fillStyle = `${color}33`;
                    ctx.fillRect(o.x, o.y, o.w, o.h);
                    ctx.strokeStyle = selected ? accent : color;
                    ctx.strokeRect(o.x, o.y, o.w, o.h);
                    if (selected) {
                        ctx.fillStyle = accent;
                        ctx.fillRect(o.x + o.w - (4 * px), o.y + o.h - (4 * px), 8 * px, 8 * px);
                    }
                }
                const label = o.name || o.type;
                if (label) {
                    const tx = o.shape === 'point' ? o.x + (7 * px) : o.x + (2 * px);
                    const ty = o.shape === 'point' ? o.y - (4 * px) : o.y - (2 * px);
                    ctx.lineWidth = 3 * px;
                    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                    ctx.strokeText(label, tx, ty);
                    ctx.fillStyle = '#fff';
                    ctx.fillText(label, tx, ty);
                }
            }
        }
    }
    drawCursor (ctx, map, lookup, px) {
        const tool = this.state.tool, d = this.drag;
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = '#4c97ff';
        if (d && d.kind === 'rect') {
            const c0 = Math.min(d.from.col, d.to.col), c1 = Math.max(d.from.col, d.to.col);
            const r0 = Math.min(d.from.row, d.to.row), r1 = Math.max(d.from.row, d.to.row);
            ctx.fillStyle = d.gid ? 'rgba(76,151,255,0.25)' : 'rgba(229,72,77,0.25)';
            ctx.fillRect(c0 * map.tileW, r0 * map.tileH, (c1 - c0 + 1) * map.tileW, (r1 - r0 + 1) * map.tileH);
            ctx.strokeRect(c0 * map.tileW, r0 * map.tileH, (c1 - c0 + 1) * map.tileW, (r1 - r0 + 1) * map.tileH);
            return;
        }
        if (d && d.kind === 'newRect') {
            ctx.strokeRect(Math.min(d.x, d.x2), Math.min(d.y, d.y2), Math.abs(d.x2 - d.x), Math.abs(d.y2 - d.y));
            return;
        }
        const c = this.hover;
        if (!c || !this.inMap(c) || !['brush', 'erase', 'fill', 'rect', 'pick'].includes(tool)) return;
        const x = c.col * map.tileW, y = c.row * map.tileH;
        if (tool === 'brush' && this.state.brush) {
            const tile = lookup(this.state.brush);
            ctx.globalAlpha = 0.6;
            if (tile) drawTile(ctx, tile, x, y, map.tileW, map.tileH);
            ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = tool === 'erase' ? '#e5484d' : '#4c97ff';
        ctx.strokeRect(x, y, map.tileW, map.tileH);
    }
    drawPalette () {
        const canvas = this.paletteEl, ts = this.tileset;
        if (!canvas) return;
        const tiles = ts ? tilesOf(this.runtime, ts) : [];
        const width = canvas.parentElement ? canvas.parentElement.clientWidth : 220;
        const cols = Math.max(1, Math.floor(width / PALETTE_CELL));
        const rows = Math.max(1, Math.ceil(tiles.length / cols));
        const dpr = window.devicePixelRatio || 1;
        const cw = cols * PALETTE_CELL, ch = rows * PALETTE_CELL;
        if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
            canvas.width = cw * dpr;
            canvas.height = ch * dpr;
            canvas.style.width = `${cw}px`;
            canvas.style.height = `${ch}px`;
        }
        this.paletteCols = cols;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        ctx.imageSmoothingEnabled = false;
        tiles.forEach((tile, i) => {
            const x = (i % cols) * PALETTE_CELL, y = Math.floor(i / cols) * PALETTE_CELL;
            drawTile(ctx, tile, x + 3, y + 3, PALETTE_CELL - 6, PALETTE_CELL - 6);
            if (this.state.brush === gidOf(ts.id, i)) {
                ctx.strokeStyle = '#4c97ff';
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, PALETTE_CELL - 2, PALETTE_CELL - 2);
            }
        });
    }
    handlePaletteClick (e) {
        const ts = this.tileset;
        if (!ts) return;
        const rect = this.paletteEl.getBoundingClientRect();
        const i = (Math.floor((e.clientY - rect.top) / PALETTE_CELL) * this.paletteCols) +
            Math.floor((e.clientX - rect.left) / PALETTE_CELL);
        if (i < 0 || i >= tilesOf(this.runtime, ts).length) return;
        const next = {brush: gidOf(ts.id, i)};
        if (!['brush', 'fill', 'rect'].includes(this.state.tool)) next.tool = 'brush';
        if (this.layer && this.layer.kind !== 'tiles') {
            const layer = this.map.layers.find(l => l.kind === 'tiles');
            if (layer) next.layerId = layer.id;
        }
        this.setState(next);
    }
    setCanvasRef (el) {
        if (this.canvasEl) this.canvasEl.removeEventListener('wheel', this.handleWheel);
        this.canvasEl = el;
        if (el) el.addEventListener('wheel', this.handleWheel, {passive: false});
    }
    setPaletteRef (el) { this.paletteEl = el; }
    setHostRef (el) {
        this.hostEl = el;
        if (el && this.resizeObserver) this.resizeObserver.observe(el);
    }
    renderToolbar () {
        const map = this.map;
        const doc = this.doc;
        const zoom = this.view ? Math.round(this.view.zoom * 100) : 100;
        const layer = this.layer;
        return (
            <div className={shared.toolbar}>
                <select
                    className={styles.select}
                    title="Map"
                    value={map ? map.id : ''}
                    onChange={e => this.setState({mapId: Number(e.target.value), objectId: null,
                        layerId: (doc.maps.find(m => m.id === Number(e.target.value)) || {layers: [{}]}).layers[0].id})}
                >
                    {doc.maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button className={shared.iconLabelButton} onClick={() => this.addMap()}>{'New map'}</button>
                <button className={shared.iconLabelButton} disabled={!map} onClick={() => this.duplicateMap()}>{'Duplicate'}</button>
                <button className={shared.iconLabelButton} disabled={!map} onClick={() => this.deleteMap()}>{'Delete'}</button>
                <span className={shared.toolbarDivider} />
                {TOOLS.map(t => (
                    <button
                        key={t.id}
                        className={this.state.tool === t.id ? shared.iconButtonOn : shared.iconButton}
                        disabled={!map}
                        title={`${t.label} (${t.key.toUpperCase()})${layer && layer.kind !== t.layer ? ` - on ${t.layer === 'tiles' ? 'a tile' : 'an object'} layer` : ''}`}
                        onClick={() => this.setTool(t.id)}
                    >
                        <Glyph d={t.icon} />
                    </button>
                ))}
                <span className={shared.toolbarDivider} />
                <button className={shared.iconButton} disabled={!this.undoStack.length} title="Undo (Ctrl+Z)" onClick={() => this.undo()}>
                    <Glyph d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
                </button>
                <button className={shared.iconButton} disabled={!this.redoStack.length} title="Redo (Ctrl+Y)" onClick={() => this.redo()}>
                    <Glyph d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
                </button>
                <span className={shared.toolbarDivider} />
                <button className={shared.iconButton} disabled={!map} title="Zoom out" onClick={() => this.zoomBy(1 / 1.25)}>
                    <Glyph d="M5 12h14" />
                </button>
                <button
                    className={styles.zoomLabel}
                    disabled={!map}
                    title="Fit the map"
                    onClick={() => { this.fit(); this.viewMoved = false; this.bump(); }}
                >{`${zoom}%`}</button>
                <button className={shared.iconButton} disabled={!map} title="Zoom in" onClick={() => this.zoomBy(1.25)}>
                    <Glyph d="M5 12h14M12 5v14" />
                </button>
                <button
                    className={this.state.grid ? shared.iconButtonOn : shared.iconButton}
                    title="Grid (G)"
                    onClick={() => this.setState(s => ({grid: !s.grid}))}
                >
                    <Glyph d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16" />
                </button>
                <button
                    className={this.state.snap ? shared.iconButtonOn : shared.iconButton}
                    title="Snap objects to the grid"
                    onClick={() => this.setState(s => ({snap: !s.snap}))}
                >
                    <Glyph d="M6 4v9a6 6 0 0 0 12 0V4M6 8h4M14 8h4" />
                </button>
                <span className={shared.toolbarSpacer} />
                <button
                    className={this.state.preview ? classNames(shared.iconLabelButton, styles.on) : shared.iconLabelButton}
                    disabled={!map || !this.ext}
                    title="Show this map on the stage while you edit it"
                    onClick={() => this.togglePreview()}
                >{this.state.preview ? 'On the stage' : 'Show on stage'}</button>
            </div>
        );
    }
    renderLayers () {
        const map = this.map;
        if (!map) return null;
        const active = this.layer;
        return (
            <section className={styles.section}>
                <div className={styles.sectionHead}>
                    <span className={styles.sectionTitle}>{'Layers'}</span>
                    <button className={styles.smallButton} title="New tile layer" onClick={() => this.addLayer('tiles')}>{'+ Tiles'}</button>
                    <button className={styles.smallButton} title="New object layer" onClick={() => this.addLayer('objects')}>{'+ Objects'}</button>
                </div>
                <div className={styles.layerList}>
                    {map.layers.slice().reverse()
                        .map(l => (
                            <div
                                key={l.id}
                                className={classNames(styles.layerRow, {[styles.layerActive]: active === l})}
                                onClick={() => this.selectLayer(l)}
                            >
                                <button
                                    className={styles.eye}
                                    title={l.visible ? 'Hide in the editor and on the stage' : 'Show'}
                                    onClick={e => { e.stopPropagation(); this.setLayerField(l, 'visible', !l.visible); }}
                                >
                                    <Glyph d={l.visible ? 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' :
                                        'M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1'} />
                                </button>
                                <span className={styles.layerKind}>{l.kind === 'objects' ? 'obj' : 'tiles'}</span>
                                <input
                                    className={styles.layerName}
                                    defaultValue={l.name}
                                    key={`${l.id}-${l.name}`}
                                    onBlur={e => e.target.value !== l.name && this.setLayerField(l, 'name', e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                                />
                                {l.collides ? <span className={styles.badge} title="Solid">{'solid'}</span> : null}
                                {l.front ? <span className={styles.badge} title="In front of sprites">{'front'}</span> : null}
                            </div>
                        ))}
                </div>
                {active ? (
                    <div className={styles.layerOptions}>
                        <div className={styles.buttonRow}>
                            <button className={styles.smallButton} title="Move up" onClick={() => this.moveLayer(1)}>{'Up'}</button>
                            <button className={styles.smallButton} title="Move down" onClick={() => this.moveLayer(-1)}>{'Down'}</button>
                            <button className={styles.smallButton} onClick={() => this.deleteLayer()}>{'Delete'}</button>
                        </div>
                        <label className={styles.check} title={active.kind === 'tiles' ? 'Every tile on this layer is solid' : 'Every rectangle on this layer is solid'}>
                            <input
                                checked={active.collides}
                                type="checkbox"
                                onChange={e => this.setLayerField(active, 'collides', e.target.checked)}
                            />{'Solid'}
                        </label>
                        {active.kind === 'tiles' ? (
                            <React.Fragment>
                                <label className={styles.check} title="Drawn above every sprite instead of behind them">
                                    <input
                                        checked={active.front}
                                        type="checkbox"
                                        onChange={e => this.setLayerField(active, 'front', e.target.checked)}
                                    />{'In front of sprites'}
                                </label>
                                <label className={styles.field}>
                                    <span>{'Opacity'}</span>
                                    <input
                                        max="1"
                                        min="0"
                                        step="0.05"
                                        type="range"
                                        value={active.opacity}
                                        onChange={e => this.setLayerField(active, 'opacity', Number(e.target.value))}
                                    />
                                </label>
                                <label className={styles.field} title="How much it scrolls with the camera: 1 with it, 0.5 half as much (far away), 0 not at all">
                                    <span>{'Parallax'}</span>
                                    <input
                                        className={styles.number}
                                        max="4"
                                        min="0"
                                        step="0.1"
                                        type="number"
                                        value={active.parallax}
                                        onChange={e => this.setLayerField(active, 'parallax', clamp(Number(e.target.value) || 0, 0, 4))}
                                    />
                                </label>
                            </React.Fragment>
                        ) : null}
                    </div>
                ) : null}
            </section>
        );
    }
    renderTilesets () {
        const doc = this.doc;
        const ts = this.tileset;
        const adding = this.state.adding;
        const brush = this.state.brush;
        const brushTiles = ts ? tilesOf(this.runtime, ts) : [];
        const selected = ts && brush && tilesetIdOf(brush) === ts.id ? brushTiles[tileIndexOf(brush)] : null;
        const tags = selected && ts.tiles[String(tileIndexOf(brush))] ? ts.tiles[String(tileIndexOf(brush))].tags.join(', ') : '';
        const sprites = this.sprites();
        const addingSprite = adding && this.runtime.getSpriteTargetByName(adding.sprite);
        return (
            <section className={styles.section}>
                <div className={styles.sectionHead}>
                    <span className={styles.sectionTitle}>{'Tiles'}</span>
                    {doc.tilesets.length ? (
                        <select
                            className={styles.select}
                            value={ts ? ts.id : ''}
                            onChange={e => this.setState({tilesetId: Number(e.target.value)})}
                        >
                            {doc.tilesets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    ) : null}
                    <button className={styles.smallButton} title="Tiles from a sprite's costumes" onClick={() => this.startAddTileset()}>{'+'}</button>
                    {ts ? <button className={styles.smallButton} title="Remove this tileset" onClick={() => this.deleteTileset()}>{'×'}</button> : null}
                </div>
                {adding ? (
                    <div className={styles.form}>
                        <label className={styles.field}>
                            <span>{'Sprite'}</span>
                            <select
                                className={styles.select}
                                value={adding.sprite}
                                onChange={e => this.setState({adding: {...adding, sprite: e.target.value, costume: ''}})}
                            >
                                {sprites.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </label>
                        <label className={styles.field}>
                            <span>{'Tiles are'}</span>
                            <select
                                className={styles.select}
                                value={adding.kind}
                                onChange={e => this.setState({adding: {...adding, kind: e.target.value}})}
                            >
                                <option value="costumes">{'its costumes'}</option>
                                <option value="sheet">{'one costume, cut up'}</option>
                            </select>
                        </label>
                        {adding.kind === 'sheet' ? (
                            <React.Fragment>
                                <label className={styles.field}>
                                    <span>{'Costume'}</span>
                                    <select
                                        className={styles.select}
                                        value={adding.costume}
                                        onChange={e => this.setState({adding: {...adding, costume: e.target.value}})}
                                    >
                                        {(addingSprite ? addingSprite.getCostumes() : []).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                    </select>
                                </label>
                                <label className={styles.field}>
                                    <span>{'Tile size'}</span>
                                    <input
                                        className={styles.number}
                                        min="1"
                                        type="number"
                                        value={adding.tileW}
                                        onChange={e => this.setState({adding: {...adding, tileW: Number(e.target.value)}})}
                                    />
                                    <input
                                        className={styles.number}
                                        min="1"
                                        type="number"
                                        value={adding.tileH}
                                        onChange={e => this.setState({adding: {...adding, tileH: Number(e.target.value)}})}
                                    />
                                </label>
                            </React.Fragment>
                        ) : null}
                        <div className={styles.buttonRow}>
                            <button className={styles.smallButton} onClick={() => this.setState({adding: null})}>{'Cancel'}</button>
                            <button className={classNames(styles.smallButton, styles.primary)} disabled={!adding.sprite} onClick={() => this.finishAddTileset()}>{'Add'}</button>
                        </div>
                    </div>
                ) : null}
                {!doc.tilesets.length && !adding ? (
                    <div className={styles.empty}>
                        <p>{'Tiles come from a sprite: each costume is one tile, or one costume is cut into a grid.'}</p>
                        <button className={classNames(styles.smallButton, styles.primary)} onClick={() => this.starterTiles()}>{'Make a starter tiles sprite'}</button>
                    </div>
                ) : null}
                {ts ? (
                    <div className={styles.palette}>
                        <canvas ref={this.setPaletteRef} onClick={this.handlePaletteClick} />
                        {ts && !brushTiles.length ? <div className={styles.note}>{`No costumes found in "${ts.sprite}"`}</div> : null}
                    </div>
                ) : null}
                {selected ? (
                    <div className={styles.form}>
                        <div className={styles.tileName}>{selected.name}</div>
                        <label className={styles.field} title='Comma-separated. "solid" blocks movement; anything else ("spike", "water") is for touching blocks'>
                            <span>{'Tags'}</span>
                            <input
                                className={styles.text}
                                defaultValue={tags}
                                key={`${brush}-${tags}`}
                                placeholder="solid, spike..."
                                onBlur={e => e.target.value !== tags && this.setTileTags(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                            />
                        </label>
                    </div>
                ) : null}
            </section>
        );
    }
    renderInspector () {
        const map = this.map;
        if (!map) return null;
        const o = this.object;
        if (o) {
            const num = (field, label) => (
                <label className={styles.field}>
                    <span>{label}</span>
                    <input
                        className={styles.number}
                        key={`${o.id}-${field}-${o[field]}`}
                        defaultValue={o[field]}
                        type="number"
                        onBlur={e => Number(e.target.value) !== o[field] && this.setObjectField(field, e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                </label>
            );
            const text = (field, label, list) => (
                <label className={styles.field}>
                    <span>{label}</span>
                    <input
                        className={styles.text}
                        defaultValue={o[field]}
                        key={`${o.id}-${field}-${o[field]}`}
                        list={list}
                        onBlur={e => e.target.value !== o[field] && this.setObjectField(field, e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                </label>
            );
            return (
                <section className={styles.section}>
                    <div className={styles.sectionHead}>
                        <span className={styles.sectionTitle}>{o.shape === 'point' ? 'Marker' : 'Rectangle'}</span>
                        <button className={classNames(styles.smallButton, styles.danger)} onClick={() => this.deleteObject()}>{'Delete'}</button>
                    </div>
                    {text('name', 'Name')}
                    {text('type', 'Type', 'dimod-tilemap-types')}
                    <datalist id="dimod-tilemap-types">{OBJECT_TYPES.map(t => <option key={t} value={t} />)}</datalist>
                    {num('x', 'X')}
                    {num('y', 'Y')}
                    {o.shape === 'rect' ? num('w', 'Width') : null}
                    {o.shape === 'rect' ? num('h', 'Height') : null}
                    <div className={styles.note}>{'Map pixels from the top-left. Blocks and code get stage x, y of the centre.'}</div>
                    <div className={styles.subTitle}>{'Properties'}</div>
                    {Object.entries(o.props).map(([k, v]) => (
                        <div className={styles.propRow} key={`${o.id}-${k}`}>
                            <input
                                className={styles.text}
                                defaultValue={k}
                                onBlur={e => e.target.value !== k && this.setObjectProp(k, e.target.value.trim(), v)}
                            />
                            <input
                                className={styles.text}
                                defaultValue={v}
                                onBlur={e => e.target.value !== v && this.setObjectProp(k, k, e.target.value)}
                            />
                            <button className={styles.smallButton} title="Remove" onClick={() => this.setObjectProp(k, '', '')}>{'×'}</button>
                        </div>
                    ))}
                    <button
                        className={styles.smallButton}
                        onClick={() => this.setObjectProp(null, uniqueName(Object.keys(o.props), 'key'), '')}
                    >{'Add property'}</button>
                </section>
            );
        }
        return (
            <section className={styles.section}>
                <div className={styles.sectionHead}><span className={styles.sectionTitle}>{'Map'}</span></div>
                <label className={styles.field}>
                    <span>{'Name'}</span>
                    <input
                        className={styles.text}
                        defaultValue={map.name}
                        key={`${map.id}-${map.name}`}
                        onBlur={e => e.target.value !== map.name && this.setMapField('name', e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                </label>
                <label className={styles.field} title="Columns and rows">
                    <span>{'Size'}</span>
                    <input
                        className={styles.number}
                        defaultValue={map.cols}
                        key={`${map.id}-c${map.cols}`}
                        min="1"
                        type="number"
                        onBlur={e => Number(e.target.value) !== map.cols && this.setMapField('size', {cols: e.target.value, rows: map.rows})}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                    <input
                        className={styles.number}
                        defaultValue={map.rows}
                        key={`${map.id}-r${map.rows}`}
                        min="1"
                        type="number"
                        onBlur={e => Number(e.target.value) !== map.rows && this.setMapField('size', {cols: map.cols, rows: e.target.value})}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                </label>
                <label className={styles.field} title="Pixels per tile">
                    <span>{'Tile'}</span>
                    <input
                        className={styles.number}
                        defaultValue={map.tileW}
                        key={`${map.id}-w${map.tileW}`}
                        min="4"
                        type="number"
                        onBlur={e => Number(e.target.value) !== map.tileW && this.setMapField('tileW', e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                    <input
                        className={styles.number}
                        defaultValue={map.tileH}
                        key={`${map.id}-h${map.tileH}`}
                        min="4"
                        type="number"
                        onBlur={e => Number(e.target.value) !== map.tileH && this.setMapField('tileH', e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                </label>
                <label className={styles.field}>
                    <span>{'Background'}</span>
                    <input
                        type="color"
                        value={map.background || '#ffffff'}
                        onChange={e => this.setMapField('background', e.target.value)}
                    />
                    {map.background ? (
                        <button className={styles.smallButton} title="None: the backdrop shows through" onClick={() => this.setMapField('background', '')}>{'None'}</button>
                    ) : <span className={styles.note}>{'none'}</span>}
                </label>
                <div className={styles.note}>
                    {`${map.cols * map.tileW} × ${map.rows * map.tileH} px. The dashed box is the stage with the camera at 0, 0.`}
                </div>
                <div className={styles.help}>
                    <div>{'Right-drag erases. Middle-drag or Space-drag pans, wheel zooms.'}</div>
                    <div>{'Blocks: show map, move stopping at solid tiles, touching tiles tagged...'}</div>
                    <div>{'Code: me.extensions.tileMaps'}</div>
                </div>
            </section>
        );
    }
    render () {
        const map = this.map;
        return (
            <div className={classNames(shared.panel, styles.tab)}>
                {this.renderToolbar()}
                <div className={styles.body}>
                    <div className={styles.sidebar}>
                        {this.renderLayers()}
                        {this.renderTilesets()}
                        {this.renderInspector()}
                    </div>
                    <div className={styles.viewport} ref={this.setHostRef}>
                        <canvas
                            className={styles.canvas}
                            ref={this.setCanvasRef}
                            tabIndex={-1}
                            onContextMenu={this.handleContextMenu}
                            onMouseDown={this.handleMouseDown}
                            onMouseLeave={() => { this.hover = null; this.scheduleDraw(); }}
                            onMouseMove={this.handleMouseMove}
                        />
                        {map ? null : (
                            <div className={styles.emptyMap}>
                                <p>{'No maps yet.'}</p>
                                <button className={classNames(styles.smallButton, styles.primary)} onClick={() => this.addMap()}>{'New map'}</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}
DimodTileMapsTab.propTypes = {isVisible: PropTypes.bool, vm: PropTypes.instanceOf(VM).isRequired};
export {DimodTileMapsTab, STARTER_TILES, addStarterTiles};
