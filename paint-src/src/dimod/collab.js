import paper from '@turbowarp/paper';
import {ensureDid, getDoc, getItemByDid, getPaintingLayer, rebuildIndex, setDoc} from './store';
import {applyItemData} from './items';
import {addRemoteBrush, createDoc, customBrushFor, deserializeDoc, serializeDoc, getDid} from './core';
import {getRaster} from '../helper/layer';
const PREVIEW_INTERVAL_MS = 55;
const PREVIEW_LINGER_MS = 1200;
const PREVIEW_KEEPALIVE_MS = 1000;
const TRAIL_TOOLS = new Set(['BRUSH', 'ERASER', 'BIT_BRUSH', 'BIT_ERASER']);
const CURSOR_INTERVAL_MS = 60;
const SELECTION_POLL_MS = 200;
const PEER_TIMEOUT_MS = 20000;
const SELECTION_MAX_ITEMS = 200;
const PREVIEW_TIMEOUT_MS = 4000;
const PREVIEW_MAX_ITEMS = 24;
const PREVIEW_MAX_BYTES = 192 * 1024;
const REMOTE_LOG_MAX = 500;
const BITMAP_DIRTY_PAD = 48;
const PROTOCOL = 1;
let _transport = null;
let _host = null;
let _docHost = null;
let _costume = null;
let _baseline = null;
let _baselineOrder = [];
let _baselineDoc = null;
let _applyingRemote = false;
let _docDirty = false;
let _remoteLog = [];
let _remoteSeq = 0;
let _gesture = null;
let _liveSource = null;
let _touched = new Map();
let _taken = new Map();
let _clock = 0;
let _stamps = new Map();
let _held = [];
let _askedAt = 0;
const askResync = function () { _askedAt = Date.now(); send({op: 'resync-request'}); };
const laterStamp = (a, b) => !b || a.v > b.v || (a.v === b.v && a.w > b.w);
const setLivePreviewSource = function (fn) { _liveSource = fn || null; };
let _previewTimer = null;
const _peers = new Map();
const _peerListeners = new Set();
const _remoteListeners = new Set();
let _lastCursorSentAt = 0;
let _lastSelectionKey = null;
let _localTool = null;
let _selectionTimer = null;
const notifyPeers = function () {
    for (const listener of _peerListeners) {
        try { listener(); } catch (e) {
        }
    }
};
const peerRecord = function (peerId, packet) {
    let peer = _peers.get(peerId);
    if (!peer) {
        peer = {peerId, username: '', color: '#4c97ff', preview: null, cursor: null, tool: null, selection: []};
        _peers.set(peerId, peer);
    }
    if (packet.username) peer.username = packet.username;
    if (packet.color) peer.color = packet.color;
    peer.seenAt = Date.now();
    return peer;
};
const clearPeerPreview = function (peerId) {
    const peer = _peers.get(peerId);
    if (peer && peer.preview) { peer.doneG = peer.preview.g; peer.preview = null; }
    notifyPeers();
};
const isTrackingGesture = () => !!_gesture && !_gesture.isVector && (!_gesture.sticky || _gesture.sentAny);
const stopGesture = function () {
    if (_previewTimer) { clearInterval(_previewTimer); _previewTimer = null; }
    _gesture = null;
};
const isCollabActive = () => !!_transport;
const isBusy = () => !!_transport && !!_transport.busy && _transport.busy();
const send = function (packet) {
    if (!_transport || !_costume) return;
    _transport.send(Object.assign({v: PROTOCOL, targetId: _costume.targetId, costumeIndex: _costume.costumeIndex}, packet));
};
const localSelectionDids = function () {
    const layer = getPaintingLayer();
    if (!layer) return [];
    const dids = new Set();
    for (const selected of paper.project.selectedItems) {
        let top = selected;
        while (top.parent && top.parent !== layer) top = top.parent;
        if (top.parent !== layer || top.guide || top.isClipMask()) continue;
        const did = getDid(top);
        if (did) dids.add(did);
        if (dids.size >= SELECTION_MAX_ITEMS) break;
    }
    return [...dids];
};
const pollSelection = function () {
    if (!isCollabActive() || !_costume) return;
    const dids = localSelectionDids();
    const key = dids.join(',');
    if (key === _lastSelectionKey) return;
    _lastSelectionKey = key;
    send({op: 'selection', dids});
};
const startSelectionWatch = function () {
    if (_selectionTimer) return;
    _selectionTimer = setInterval(pollSelection, SELECTION_POLL_MS);
};
const stopSelectionWatch = function () {
    if (!_selectionTimer) return;
    clearInterval(_selectionTimer);
    _selectionTimer = null;
    _lastSelectionKey = null;
};
const isApplyingRemote = () => _applyingRemote;
const setCollabTransport = function (transport) {
    _transport = transport || null;
    if (_transport) startSelectionWatch();
};
const clearCollabTransport = function () {
    _transport = null;
    stopGesture();
    stopSelectionWatch();
    _peers.clear();
    notifyPeers();
};
const setCollabHost = function (host) { _host = host || null; };
const setCollabDocHost = function (host) { _docHost = host || null; };
const setCollabCostume = function (costume) { _costume = costume || null; };
const resetCollab = function () {
    _baseline = null;
    _baselineOrder = [];
    _baselineDoc = null;
    _remoteLog = [];
    _remoteSeq = 0;
    _touched = new Map();
    _stamps = new Map();
    _held = [];
    _lastSelectionKey = null;
    _bitmapBase = null;
    _patchState = {pid: null, clean: true};
    stopGesture();
    _peers.clear();
    notifyPeers();
};
const contentItems = function () {
    const layer = getPaintingLayer();
    if (!layer) return [];
    return layer.children.filter(item => !item.guide && !item.isClipMask());
};
const PORTABLE_SOURCE = /^data:/i;
const _dataUrls = new Map();
const portableSources = function (item) {
    const map = new Map();
    const visit = node => {
        if (!node) return;
        if (node instanceof paper.Raster) {
            const src = node.image && node.image.src;
            if (src && !PORTABLE_SOURCE.test(src) && !map.has(src)) {
                if (_dataUrls.has(src)) { map.set(src, _dataUrls.get(src)); } else {
                    try {
                        if (_dataUrls.size > 64) _dataUrls.clear();
                        _dataUrls.set(src, node.toDataURL());
                        map.set(src, _dataUrls.get(src));
                    } catch (e) {
                    }
                }
            }
        }
        if (node.children) node.children.forEach(visit);
    };
    visit(item);
    return map;
};
const rewriteSources = function (json, map) {
    if (Array.isArray(json)) { json.forEach(entry => rewriteSources(entry, map)); return; }
    if (!json || typeof json !== 'object') return;
    if (typeof json.source === 'string' && map.has(json.source)) json.source = map.get(json.source);
    Object.keys(json).forEach(key => rewriteSources(json[key], map));
};
const unselect = function (json) {
    if (Array.isArray(json)) { json.forEach(unselect); return; }
    if (!json || typeof json !== 'object') return;
    if ('selected' in json) delete json.selected;
    Object.keys(json).forEach(key => unselect(json[key]));
};
const serializeItem = function (item) {
    const json = item.exportJSON({asString: false, precision: 16});
    const map = portableSources(item);
    if (map.size) rewriteSources(json, map);
    unselect(json);
    return json;
};
const identifiedItems = function () { return contentItems().map(item => ({did: ensureDid(item), item})); };
const captureBaseline = function () {
    rebuildIndex();
    _baseline = new Map();
    _baselineOrder = [];
    for (const {did, item} of identifiedItems()) {
        _baseline.set(did, JSON.stringify(serializeItem(item)));
        _baselineOrder.push(did);
    }
    _baselineDoc = serializeDoc(getDoc());
};
const buildReset = function () {
    const items = identifiedItems().map(({did, item}) => ({did, json: serializeItem(item)}));
    return {op: 'reset', items, doc: serializeDoc(getDoc()), clock: _clock};
};
const diffAgainstBaseline = function () {
    const ops = [];
    const seen = new Set();
    const order = [];
    const items = identifiedItems();
    for (let index = 0; index < items.length; index++) {
        const {did, item} = items[index];
        const json = serializeItem(item);
        const str = JSON.stringify(json);
        order.push(did);
        seen.add(did);
        if (!_baseline.has(did)) { ops.push({op: 'add', did, index, json}); } else if (_baseline.get(did) !== str) { ops.push({op: 'modify', did, json}); }
    }
    for (const did of _baseline.keys()) {
        if (!seen.has(did)) ops.push({op: 'remove', did});
    }
    const orderChanged = order.length !== _baselineOrder.length ||
        order.some((did, i) => _baselineOrder[i] !== did);
    if (orderChanged && !ops.some(o => o.op === 'add' || o.op === 'remove')) { ops.push({op: 'order', dids: order}); }
    const doc = serializeDoc(getDoc());
    if (doc !== _baselineDoc) ops.push({op: 'doc', doc});
    return ops;
};
const usedBrushes = function () {
    const out = new Map();
    const visit = node => {
        const ls = node.data && node.data.dimodLine;
        if (ls && ls.type === 'BRUSH' && typeof ls.brush === 'string' && ls.brush.indexOf('T:') !== 0 && !out.has(ls.brush)) {
            const b = customBrushFor(ls.brush);
            if (b && !b.builtin) out.set(ls.brush, {id: b.id, name: b.name, mask: b.mask, svg: b.svg || null, spacing: b.spacing, scatter: b.scatter});
        }
        if (node.children) node.children.forEach(visit);
    };
    contentItems().forEach(visit);
    return out.size ? [...out.values()] : undefined;
};
const noteTouched = function (ops) {
    for (const o of ops) {
        const did = o.did || (o.op === 'doc' ? '#doc' : null);
        if (!did || _touched.has(did)) continue;
        if (_taken.has(did)) {
            const now = did === '#doc' ? o.doc : o.op === 'remove' ? null : JSON.stringify(o.json);
            if (now === _taken.get(did)) continue;
        }
        if (did === '#doc') { _touched.set(did, {json: _baselineDoc}); continue; }
        _touched.set(did, {json: _baseline.has(did) ? _baseline.get(did) : null, index: _baselineOrder.indexOf(did)});
    }
};
const takeTouched = function () {
    if (_baseline === null) { captureBaseline(); _touched = new Map(); return null; }
    if (!isCollabActive()) return null;
    noteTouched(diffAgainstBaseline());
    const before = {};
    const after = {};
    const content = contentItems();
    for (const [did, was] of _touched) {
        before[did] = was;
        if (did === '#doc') { after[did] = {json: serializeDoc(getDoc())}; continue; }
        const item = getItemByDid(did);
        after[did] = item ? {json: JSON.stringify(serializeItem(item)), index: content.indexOf(item)} : {json: null};
    }
    _touched = new Map();
    _taken = new Map(Object.keys(after).map(did => [did, after[did].json]));
    return {before, after};
};
const restoreMine = function (entry, fromEntry) {
    const layer = getPaintingLayer();
    if (!isCollabActive() || !layer || !entry.collab || !fromEntry || !fromEntry.collab) return false;
    const forward = entry.time > fromEntry.time;
    const states = forward ? entry.collab.after : fromEntry.collab.before;
    const left = forward ? entry.collab.before : fromEntry.collab.after;
    for (const did of Object.keys(states)) {
        const w = states[did];
        if (did === '#doc') { if (w.json) applyDoc(w.json); continue; }
        const live = getItemByDid(did);
        const now = live ? JSON.stringify(serializeItem(live)) : null;
        if (left[did] && now !== left[did].json) continue;
        if (!w.json) { if (live) live.remove(); continue; }
        const item = importItem(JSON.parse(w.json));
        if (!item) continue;
        if (live) { live.replaceWith(item); continue; }
        const content = contentItems();
        if (w.index >= 0 && w.index < content.length) { item.insertBelow(content[w.index]); } else { layer.addChild(item); }
    }
    rebuildIndex();
    if (_docDirty) {
        _docDirty = false;
        if (_docHost && _docHost.syncStores) _docHost.syncStores();
    }
    return true;
};
const commitLocalChanges = function (isVector) {
    if (!isCollabActive() || _applyingRemote || !isVector) return;
    if (_baseline === null) { captureBaseline(); return; }
    const ops = diffAgainstBaseline();
    noteTouched(ops);
    _taken = new Map();
    for (const o of ops) {
        const key = o.did || (o.op === 'doc' ? '#doc' : null);
        if (!key) continue;
        o.st = {v: ++_clock, w: _patchTag};
        _stamps.set(key, o.st);
    }
    captureBaseline();
    if (ops.length) { send({op: 'ops', ops, brushes: usedBrushes()}); renewGesture(); }
};
let _liveTimer = null;
const liveCommit = function (isVector) {
    if (_liveTimer || !isCollabActive() || !isVector) return;
    _liveTimer = setTimeout(() => {
        _liveTimer = null;
        if (isBusy()) { liveCommit(isVector); return; }
        commitLocalChanges(true);
    }, 70);
};
const importItem = function (json) {
    const item = paper.Base.importJSON(json);
    if (!(item instanceof paper.Item)) return null;
    applyItemData(item);
    return item;
};
const applyDoc = function (doc) { const parsed = deserializeDoc(doc); setDoc(parsed || createDoc()); _docDirty = true; };
const applyOp = function (op, imported = []) {
    const layer = getPaintingLayer();
    if (!layer) return true;
    if (op.op === 'add') {
        if (getItemByDid(op.did)) return applyOp({op: 'modify', did: op.did, json: op.json}, imported);
        const item = importItem(op.json);
        if (!item) return true;
        imported.push(item);
        const content = contentItems();
        const index = Math.max(0, op.index | 0);
        if (index < content.length) { item.insertBelow(content[index]); } else { layer.addChild(item); }
        return true;
    }
    if (op.op === 'modify') {
        const existing = getItemByDid(op.did);
        if (!existing) return applyOp({op: 'add', did: op.did, index: 1e9, json: op.json}, imported);
        const item = importItem(op.json);
        if (!item) return true;
        imported.push(item);
        existing.replaceWith(item);
        return true;
    }
    if (op.op === 'remove') {
        const existing = getItemByDid(op.did);
        if (!existing) return true;
        existing.remove();
        return true;
    }
    if (op.op === 'order') {
        const wanted = op.dids.map(did => getItemByDid(did)).filter(Boolean);
        for (const item of wanted) layer.addChild(item);
        return wanted.length === op.dids.length;
    }
    if (op.op === 'reset') {
        for (const item of contentItems()) item.remove();
        for (const entry of op.items) {
            const item = importItem(entry.json);
            if (!item) continue;
            imported.push(item);
            layer.addChild(item);
        }
        if (op.doc) applyDoc(op.doc);
        return true;
    }
    if (op.op === 'doc') { applyDoc(op.doc); return true; }
    if (op.op === 'bpatch') return applyPatch(op);
    return true;
};
const logRemote = function (op) {
    _remoteLog.push({seq: ++_remoteSeq, op});
    if (_remoteLog.length > REMOTE_LOG_MAX) _remoteLog.splice(0, _remoteLog.length - REMOTE_LOG_MAX);
};
const settleApplied = function () {
    const wasApplying = _applyingRemote;
    _applyingRemote = true;
    try {
        captureBaseline();
        for (const listener of _remoteListeners) {
            try { listener(); } catch (e) {
            }
        }
        if (_host && _host.updateImage) _host.updateImage();
    } finally { _applyingRemote = wasApplying; }
};
const RASTER_LOAD_TIMEOUT_MS = 5000;
const pendingRasters = function (item) {
    const found = [];
    const visit = node => {
        if (!node) return;
        if (node instanceof paper.Raster && !node.loaded) found.push(node);
        if (node.children) node.children.forEach(visit);
    };
    visit(item);
    return found;
};
const whenRastersLoaded = function (rasters) {
    return Promise.all(rasters.map(raster => new Promise(resolve => {
        if (raster.loaded) { resolve(); return; }
        let done = false;
        let timer = null;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            raster.off('load', finish);
            raster.off('error', finish);
            resolve();
        };
        timer = setTimeout(finish, RASTER_LOAD_TIMEOUT_MS);
        raster.on('load', finish);
        raster.on('error', finish);
    })));
};
const applyOps = function (ops, {log = false, settle = true} = {}) {
    let complete = true;
    _applyingRemote = true;
    const imported = [];
    try {
        for (const op of ops) {
            if (!applyOp(op, imported)) complete = false;
            if (log) logRemote(op);
        }
        rebuildIndex();
        if (_docDirty) {
            _docDirty = false;
            if (_docHost && _docHost.syncStores) _docHost.syncStores();
        }
        if (settle) {
            const pending = [];
            for (const item of imported) pending.push(...pendingRasters(item));
            if (pending.length) { whenRastersLoaded(pending).then(() => settleApplied()); } else { settleApplied(); }
        }
    } finally { _applyingRemote = false; }
    return complete;
};
const receivePreview = function (packet, fromId) {
    if (!fromId) return;
    const peer = peerRecord(fromId, packet);
    let pv = peer.preview;
    const g = packet.g || 0;
    if (g && peer.doneG === g) return;
    if (!pv || pv.g !== g || pv.endedAt) { pv = {g, items: new Map(), tiles: [], set: null, trail: null, rev: 0, bytes: 0}; peer.preview = pv; }
    pv.at = Date.now();
    pv.tool = packet.tool || null;
    let rev = false;
    if (packet.svg && !packet.items) packet = Object.assign({}, packet, {items: [{k: 0, svg: packet.svg}], ks: [0]});
    if (packet.dataUrl && packet.rect && !packet.tiles) packet = Object.assign({}, packet, {set: {d: packet.dataUrl, x: packet.rect.x, y: packet.rect.y, w: packet.rect.width, h: packet.rect.height}});
    if (Array.isArray(packet.ks)) {
        for (const k of [...pv.items.keys()]) if (packet.ks.indexOf(k) < 0) { pv.items.delete(k); rev = true; }
    }
    for (const it of packet.items || []) {
        let cur = pv.items.get(it.k);
        if (it.svg) { cur = {svg: it.svg, m: [1, 0, 0, 1, 0, 0], v: (cur ? cur.v : 0) + 1, gk: typeof it.gk === 'string' ? it.gk : null, p: null}; pv.items.set(it.k, cur); rev = true; }
        if (cur && it.m) cur.m = it.m;
        if (cur && cur.gk && Array.isArray(it.p)) cur.p = it.p;
    }
    for (const t of packet.tiles || []) {
        if (pv.tiles.length > 600 || pv.bytes > 6e6) break;
        pv.tiles.push(t);
        pv.bytes += t.d.length;
        rev = true;
    }
    if (packet.set) { pv.set = packet.set; rev = true; }
    if (packet.trail) {
        const tr = packet.trail;
        if (!pv.trail || tr.from === 0) pv.trail = {p: [], w: tr.w};
        if (tr.from === pv.trail.p.length / 2 && pv.trail.p.length < 8000) { pv.trail.p.push(...tr.p); pv.trail.w = tr.w; rev = true; }
    }
    if (rev) pv.rev++;
    notifyPeers();
};
const endPeerPreview = function (fromId) {
    const peer = _peers.get(fromId);
    if (peer && peer.preview) { peer.preview.endedAt = Date.now(); notifyPeers(); }
};
const keepPeers = function (ids) {
    const keep = new Set((ids || []).map(String));
    let gone = false;
    for (const id of [..._peers.keys()]) if (!keep.has(String(id))) { _peers.delete(id); gone = true; }
    if (gone) notifyPeers();
};
const receiveCursor = function (packet, fromId) {
    if (!fromId) return;
    const peer = peerRecord(fromId, packet);
    peer.cursor = {x: packet.x, y: packet.y};
    peer.tool = packet.tool || null;
    notifyPeers();
};
const receiveSelection = function (packet, fromId) {
    if (!fromId) return;
    peerRecord(fromId, packet).selection = packet.dids || [];
    notifyPeers();
};
const receivePacket = function (packet, fromId) {
    if (!packet || packet.v !== PROTOCOL) return;
    if (!_costume) return;
    if (packet.targetId !== _costume.targetId || packet.costumeIndex !== _costume.costumeIndex) return;
    if (packet.op === 'preview') { receivePreview(packet, fromId); return; }
    if (packet.op === 'cursor') { receiveCursor(packet, fromId); return; }
    if (packet.op === 'selection') { receiveSelection(packet, fromId); return; }
    if (packet.op === 'preview-end') { endPeerPreview(fromId); return; }
    if (packet.op === 'bpatch') { receivePatch(packet, fromId); return; }
    if (packet.op === 'resync-request') {
        if (_baseline !== null) send(Object.assign(buildReset(), {brushes: usedBrushes()}));
        return;
    }
    if (Array.isArray(packet.brushes)) packet.brushes.slice(0, 20).forEach(addRemoteBrush);
    if (packet.op === 'reset') {
        if (!_askedAt || Date.now() - _askedAt > 5000) return;
        _askedAt = 0;
        const seen = Number(packet.clock) || 0;
        const keep = [];
        identifiedItems().forEach(({did, item}, index) => {
            const st = _stamps.get(did);
            if (st && st.v > seen) keep.push({did, index, json: serializeItem(item)});
        });
        const gone = new Set(packet.items.map(e => getDid(e.json && e.json[1] ? {data: e.json[1].data} : null)).filter(Boolean));
        applyOps([{op: 'reset', items: packet.items, doc: packet.doc}], {log: true});
        for (const k of keep) applyOps([{op: gone.has(k.did) ? 'modify' : 'add', did: k.did, index: k.index, json: k.json}], {log: true});
        if (seen > _clock) _clock = seen;
        clearPeerPreview(fromId);
        return;
    }
    if (packet.op === 'ops') {
        for (const o of packet.ops) if (o && o.st && o.st.v > _clock) _clock = o.st.v;
        if (_gesture && _gesture.isVector) { _held.push({packet, fromId}); return; }
        applyRemoteOps(packet, fromId);
    }
};
const applyRemoteOps = function (packet, fromId) {
    const ops = packet.ops.filter(o => {
        const key = o && (o.did || (o.op === 'doc' ? '#doc' : null));
        if (!key || !o.st || typeof o.st.v !== 'number') return true;
        if (!laterStamp(o.st, _stamps.get(key))) return false;
        _stamps.set(key, o.st);
        return true;
    });
    if (ops.length) {
        const complete = applyOps(ops, {log: true});
        if (!complete) askResync();
    }
    clearPeerPreview(fromId);
};
const flushHeld = function () {
    if (_gesture || !_held.length) return;
    if (isCollabActive() && _host && !(_host.isBitmap && _host.isBitmap())) commitLocalChanges(true);
    const held = _held;
    _held = [];
    for (const {packet, fromId} of held) applyRemoteOps(packet, fromId);
};
const remoteSeq = () => _remoteSeq;
const replayRemoteOpsSince = function (since) {
    if (!isCollabActive()) return;
    if (typeof since !== 'number') return;
    if (since >= _remoteSeq) return;
    const pending = _remoteLog.filter(entry => entry.seq > since);
    if (pending.length && pending[0].seq === since + 1) {
        applyOps(pending.map(entry => entry.op), {log: false, settle: false});
        return;
    }
    captureBaseline();
    askResync();
};
const subscribePeers = function (listener) { _peerListeners.add(listener); return () => _peerListeners.delete(listener); };
const subscribeRemoteApplied = function (listener) {
    _remoteListeners.add(listener);
    return () => _remoteListeners.delete(listener);
};
const getPeers = function () {
    const now = Date.now();
    for (const [peerId, peer] of _peers) {
        if (now - peer.seenAt > PEER_TIMEOUT_MS) { _peers.delete(peerId); continue; }
        if (peer.preview && (now - peer.preview.at > PREVIEW_TIMEOUT_MS || (peer.preview.endedAt && now - peer.preview.endedAt > PREVIEW_LINGER_MS))) peer.preview = null;
    }
    return [..._peers.values()];
};
const setLocalTool = function (tool) {
    if ((tool || null) !== _localTool && _gesture) endGesture();
    _localTool = tool || null;
};
const shouldSampleCursor = function () {
    if (!isCollabActive() || !_costume) return false;
    return Date.now() - _lastCursorSentAt >= CURSOR_INTERVAL_MS;
};
const sendLocalCursor = function (point) {
    if (!point || !isCollabActive()) return;
    _lastCursorSentAt = Date.now();
    send({op: 'cursor', x: point.x, y: point.y, tool: _localTool});
};
const hotItems = function () {
    const layer = getPaintingLayer();
    if (!layer || !_gesture) return [];
    const hot = [];
    const taken = new Set();
    const main = _gesture.isVector ? null : getRaster();
    const consider = (item, guide) => {
        if (!item || item === main || taken.has(item.id) || (item.guide && !guide) || item.isClipMask()) return;
        taken.add(item.id);
        hot.push(item);
    };
    for (const item of layer.children) {
        if (!_gesture.startIds.has(item.id) || item.id === _gesture.focusId) consider(item);
    }
    for (const selected of paper.project.selectedItems) {
        let top = selected;
        while (top.parent && top.parent !== layer) top = top.parent;
        if (top.parent === layer) consider(top);
    }
    for (const item of guideSources()) if (!item.data.collabTiles) consider(item, true);
    return hot.slice(0, PREVIEW_MAX_ITEMS);
};
const guideSources = function () {
    const out = [];
    for (const layer of paper.project.layers) {
        if (!layer.data || !layer.data.isGuideLayer) continue;
        for (const item of layer.children) if (item.data && (item.data.collabTiles || item.data.collabPreview) && item.visible) out.push(item);
    }
    return out;
};
const toLayer = function (node, point, layer) {
    let q = point;
    let n = node;
    while (n && n !== layer && n.matrix) { q = n.matrix.transform(q); n = n.parent; }
    return q;
};
const refPoints = function (item) {
    const layer = item.parent;
    const pts = [];
    let sig = '';
    const colorKey = c => {
        if (!c) return '-';
        if (c.gradient) return `g${c.gradient.stops.map(st => st.color.toCSS(true) + st.offset).join()}${c.origin}${c.destination}`;
        return c.toCSS ? c.toCSS(true) : String(c);
    };
    const visit = node => {
        if (pts.length >= 24) return;
        sig += `${colorKey(node.fillColor)}${colorKey(node.strokeColor)}${node.strokeWidth}${node.opacity}${node.visible ? '' : 'h'}${typeof node.content === 'string' ? node.content.length + node.content.slice(0, 40) : ''}|`;
        if (node.segments) {
            const n = node.segments.length;
            sig += n + ',';
            const picks = n <= 4 ? node.segments : [node.segments[0], node.segments[n >> 2], node.segments[n >> 1], node.segments[(n * 3) >> 2]];
            for (const seg of picks) { const q = toLayer(node, seg.point, layer); pts.push(q.x, q.y); }
            return;
        }
        if (node.children && node.children.length) { sig += 'g' + node.children.length + ','; node.children.forEach(visit); return; }
        const w = (node.size && node.size.width) || node.width || 10;
        const h = (node.size && node.size.height) || node.height || 10;
        sig += 'l' + Math.round(w) + 'x' + Math.round(h) + ',';
        for (const [x, y] of [[0, 0], [w / 2, 0], [0, h / 2], [w / 2, h / 2]]) { const q = toLayer(node, new paper.Point(x, y), layer); pts.push(q.x, q.y); }
    };
    visit(item);
    return {pts, sig};
};
const solveAffine = function (from, to) {
    const n = from.length / 2;
    if (n < 4 || to.length !== from.length) return null;
    let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0;
    const bx = [0, 0, 0], by = [0, 0, 0];
    for (let i = 0; i < n; i++) {
        const x = from[i * 2], y = from[(i * 2) + 1], u = to[i * 2], v = to[(i * 2) + 1];
        sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
        bx[0] += x * u; bx[1] += y * u; bx[2] += u;
        by[0] += x * v; by[1] += y * v; by[2] += v;
    }
    const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    const det3 = A => (A[0][0] * ((A[1][1] * A[2][2]) - (A[1][2] * A[2][1]))) - (A[0][1] * ((A[1][0] * A[2][2]) - (A[1][2] * A[2][0]))) + (A[0][2] * ((A[1][0] * A[2][1]) - (A[1][1] * A[2][0])));
    const D = det3(M);
    let a, c, e, b, d, f;
    if (Math.abs(D) < 1e-6) {
        a = 1; c = 0; b = 0; d = 1;
        e = (bx[2] - sx) / n; f = (by[2] - sy) / n;
    } else {
        const solve = B => [0, 1, 2].map(col => det3(M.map((row, r) => row.map((val, j) => (j === col ? B[r] : val)))) / D);
        [a, c, e] = solve(bx);
        [b, d, f] = solve(by);
    }
    let span = 1;
    for (let i = 0; i < n; i++) span = Math.max(span, Math.abs(from[i * 2] - from[0]), Math.abs(from[(i * 2) + 1] - from[1]));
    const tol = 0.02 + (span * 0.002);
    for (let i = 0; i < n; i++) {
        const x = from[i * 2], y = from[(i * 2) + 1];
        if (Math.abs((a * x) + (c * y) + e - to[i * 2]) > tol || Math.abs((b * x) + (d * y) + f - to[(i * 2) + 1]) > tol) return null;
    }
    return [a, b, c, d, e, f].map(z => Math.round(z * 10000) / 10000);
};
const geoOf = function (item) {
    if (!(item instanceof paper.Path || item instanceof paper.CompoundPath) || !item.matrix.isIdentity()) return null;
    const subs = item instanceof paper.CompoundPath ? item.children : [item];
    let key = '';
    const p = [];
    for (const s of subs) {
        if (!(s instanceof paper.Path) || !s.matrix.isIdentity()) return null;
        key += `${s.closed ? 'c' : 'o'}${s.segments.length},`;
        for (const seg of s.segments) p.push(seg.point.x, seg.point.y, seg.handleIn.x, seg.handleIn.y, seg.handleOut.x, seg.handleOut.y);
        if (p.length > 1200) return null;
    }
    return {key, p: p.map(z => Math.round(z * 100) / 100)};
};
const samePts = (a, b) => a.sig === b.sig && a.pts.length === b.pts.length && a.pts.every((z, i) => Math.abs(z - b.pts[i]) < 0.01);
const exportOne = function (item) {
    try {
        if (item instanceof paper.Raster && item.canvas) {
            let src = item.canvas;
            const w = src.width, h = src.height;
            if (!w || !h) return null;
            const k = Math.min(1, Math.sqrt(160000 / (w * h)));
            if (k < 1) {
                const cv = document.createElement('canvas');
                cv.width = Math.max(1, Math.round(w * k));
                cv.height = Math.max(1, Math.round(h * k));
                cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
                src = cv;
            }
            const m = item.matrix;
            return `<image x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" preserveAspectRatio="none" transform="matrix(${[m.a, m.b, m.c, m.d, m.tx, m.ty].join(' ')})" href="${src.toDataURL()}"/>`;
        }
        const node = (item instanceof paper.Shape ? item.toPath(false) : item).exportSVG({asString: true});
        return typeof node === 'string' ? node : null;
    } catch (e) { return null; }
};
const rasterMap = function () {
    const raster = getRaster();
    if (!raster || !raster.width) return null;
    const b = raster.bounds;
    return {raster, b, sx: raster.width / b.width, sy: raster.height / b.height};
};
const cropTile = function (canvas, rect, map) {
    const px = Math.max(0, Math.floor((rect.x - map.b.x) * map.sx));
    const py = Math.max(0, Math.floor((rect.y - map.b.y) * map.sy));
    const pw = Math.min(canvas.width, Math.ceil((rect.x + rect.width - map.b.x) * map.sx)) - px;
    const ph = Math.min(canvas.height, Math.ceil((rect.y + rect.height - map.b.y) * map.sy)) - py;
    if (pw < 1 || ph < 1) return null;
    const cv = document.createElement('canvas');
    cv.width = pw;
    cv.height = ph;
    cv.getContext('2d').drawImage(canvas, px, py, pw, ph, 0, 0, pw, ph);
    return {d: cv.toDataURL(), x: map.b.x + (px / map.sx), y: map.b.y + (py / map.sy), w: pw / map.sx, h: ph / map.sy};
};
const sampleTiles = function (out) {
    const g = _gesture;
    const sources = guideSources().filter(item => item.data.collabTiles && item.canvas);
    if (!sources.length) return;
    const map = rasterMap();
    if (!map) return;
    const pad = ((g.getSize ? g.getSize() : 10) / 2) + 4;
    const replace = g.tool === 'BIT_LINE';
    const area = replace ? g.dirty : g.fresh;
    if (!area) return;
    g.fresh = null;
    const tile = cropTile(sources[0].canvas, area.expand(pad * 2), map);
    if (!tile) return;
    if (replace) out.set = tile; else out.tiles = [tile];
};
const sendPreview = function () {
    if (!isCollabActive() || !_gesture || isBusy()) return;
    const g = _gesture;
    const out = {g: g.id, tool: g.tool};
    let changed = false;
    const items = [];
    const ks = [];
    let bytes = 0;
    for (const item of hotItems()) {
        const k = item.id;
        const now = refPoints(item);
        const sent = g.sent.get(k);
        const fresh = !g.startIds.has(k) || item.guide;
        const geo = item.guide ? null : geoOf(item);
        if (sent && sent.gk && geo && geo.key === sent.gk) {
            ks.push(k);
            const pj = geo.p.join();
            if (pj !== sent.pj) { sent.pj = pj; items.push({k, p: geo.p}); changed = true; }
            continue;
        }
        if (sent && !fresh && !sent.gk && sent.ref.sig === now.sig) {
            const m = solveAffine(sent.ref.pts, now.pts);
            if (m) {
                ks.push(k);
                if (m.join() !== sent.m) { sent.m = m.join(); items.push({k, m}); changed = true; }
                continue;
            }
        }
        if (!sent && !fresh) {
            const start = g.refs.get(k);
            if (start && samePts(start, now)) continue;
        }
        if (sent && fresh && sent.ref.sig === now.sig && samePts(sent.ref, now) && !item.guide) { ks.push(k); continue; }
        const svg = exportOne(item);
        if (!svg) continue;
        bytes += svg.length;
        if (bytes > PREVIEW_MAX_BYTES) break;
        ks.push(k);
        if (sent && sent.svg === svg) continue;
        g.sent.set(k, {ref: now, svg, m: '1,0,0,1,0,0', gk: geo ? geo.key : null, pj: geo ? geo.p.join() : null});
        items.push(geo ? {k, svg, gk: geo.key, p: geo.p} : {k, svg});
        changed = true;
    }
    const live = _liveSource && g.isVector ? _liveSource() : null;
    if (live && bytes + live.length < PREVIEW_MAX_BYTES) {
        ks.push(-1);
        const sent = g.sent.get(-1);
        if (!sent || sent.svg !== live) { g.sent.set(-1, {svg: live}); items.push({k: -1, svg: live}); changed = true; }
    }
    if (ks.join() !== g.lastKs) { g.lastKs = ks.join(); changed = true; }
    out.ks = ks;
    if (items.length) out.items = items;
    if (!g.isVector) sampleTiles(out);
    if (out.tiles || out.set) changed = true;
    if (TRAIL_TOOLS.has(g.tool) && !live && g.trail.length > g.trailSent && !out.tiles && !out.set && !items.length) {
        const map = g.isVector ? null : rasterMap();
        const size = g.getSize ? g.getSize() : 10;
        out.trail = {from: g.trailSent / 2, p: g.trail.slice(g.trailSent), w: map ? size / map.sx : size};
        g.trailSent = g.trail.length;
        changed = true;
    }
    const nowMs = Date.now();
    if (!changed && (!g.sentAny || nowMs - g.lastSent < PREVIEW_KEEPALIVE_MS)) return;
    g.sentAny = true;
    g.lastSent = nowMs;
    send(Object.assign({op: 'preview'}, out));
};
let _gestureSeq = 0;
const STICKY_TOOLS = new Set(['POLYGON', 'BIT_POLYGON']);
const isStickyTool = () => STICKY_TOOLS.has(_localTool);
const selectedRefs = function (layer) {
    const refs = new Map();
    if (!layer) return refs;
    for (const selected of paper.project.selectedItems) {
        let top = selected;
        while (top.parent && top.parent !== layer) top = top.parent;
        if (top.parent === layer && !refs.has(top.id)) refs.set(top.id, refPoints(top));
        if (refs.size >= PREVIEW_MAX_ITEMS) break;
    }
    return refs;
};
const renewGesture = function () {
    if (!_gesture) return;
    const layer = getPaintingLayer();
    _gesture.id = (++_gestureSeq % 1e6) + 1;
    _gesture.sent = new Map();
    _gesture.refs = selectedRefs(layer);
    _gesture.startIds = new Set(layer ? layer.children.map(item => item.id) : []);
    _gesture.lastKs = '';
    _gesture.sentAny = false;
    _gesture.trail = [];
    _gesture.trailSent = 0;
};
const beginGesture = function ({isVector, getRaster: rasterOf, getSize, focusId}) {
    if (!isCollabActive()) return;
    stopGesture();
    const layer = getPaintingLayer();
    const refs = selectedRefs(layer);
    if (!isVector && !_bitmapBase && !paper.project.selectedItems.length) captureBitmapBase();
    _gesture = {isVector, getRaster: rasterOf, getSize, tool: _localTool, id: (++_gestureSeq % 1e6) + 1,
        startIds: new Set(layer ? layer.children.map(item => item.id) : []), refs, sent: new Map(),
        focusId: focusId || null, sticky: STICKY_TOOLS.has(_localTool), dirty: null, fresh: null, trail: [], trailSent: 0, lastSent: 0, sentAny: false, lastKs: ''};
    _previewTimer = setInterval(sendPreview, PREVIEW_INTERVAL_MS);
};
const trackGesturePoint = function (point) {
    if (!_gesture || !point) return;
    const g = _gesture;
    if (TRAIL_TOOLS.has(g.tool) && g.trail.length < 8000) g.trail.push(Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10);
    if (g.isVector) return;
    const at = new paper.Rectangle(point.x, point.y, 1, 1);
    g.dirty = g.dirty ? g.dirty.unite(at) : at;
    if (!g.fresh && g.last) g.fresh = new paper.Rectangle(g.last.x, g.last.y, 1, 1);
    g.fresh = g.fresh ? g.fresh.unite(at) : at;
    g.last = point;
};
const hasGesture = () => !!_gesture;
const endGesture = function () {
    const g = _gesture;
    stopGesture();
    if (g && g.sentAny && isCollabActive()) send({op: 'preview-end'});
    if (_held.length) setTimeout(flushHeld, 0);
};
let _bitmapBase = null;
let _patchSeq = 0;
const _patchTag = Math.random().toString(36).slice(2, 8);
let _patchState = {pid: null, clean: true};
const _patches = new Map();
const captureBitmapBase = function () {
    const raster = getRaster();
    if (!raster || !raster.loaded || !raster.canvas) return;
    try { _bitmapBase = raster.getContext(false).getImageData(0, 0, raster.canvas.width, raster.canvas.height); } catch (e) { _bitmapBase = null; }
};
const noteBitmapCommit = function (plastered) {
    if (!isCollabActive() || !plastered || !plastered.canvas) { _bitmapBase = null; return; }
    let data;
    try { data = plastered.getContext(false).getImageData(0, 0, plastered.canvas.width, plastered.canvas.height); } catch (e) { _bitmapBase = null; _patchState.clean = false; return; }
    const base = _bitmapBase;
    _bitmapBase = data;
    if (_applyingRemote) return;
    if (!base || base.width !== data.width || base.height !== data.height) { _patchState.clean = false; return; }
    const W = data.width;
    const A = new Uint32Array(base.data.buffer);
    const B = new Uint32Array(data.data.buffer);
    let x0 = W, y0 = data.height, x1 = -1, y1 = -1;
    for (let y = 0; y < data.height; y++) {
        const row = y * W;
        let first = -1, last = -1;
        for (let x = 0; x < W; x++) if (A[row + x] !== B[row + x]) { if (first < 0) first = x; last = x; }
        if (first < 0) continue;
        if (first < x0) x0 = first;
        if (last > x1) x1 = last;
        if (y < y0) y0 = y;
        y1 = y;
    }
    if (x1 < 0) return;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const img = new ImageData(w, h);
    const mask = new ImageData(w, h);
    const I = new Uint32Array(img.data.buffer);
    const K = new Uint32Array(mask.data.buffer);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = ((y + y0) * W) + x + x0;
            if (A[i] === B[i]) continue;
            I[(y * w) + x] = B[i];
            K[(y * w) + x] = 0xff000000;
        }
    }
    const url = d => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(d, 0, 0); return cv.toDataURL(); };
    const pid = `${_patchTag}${++_patchSeq}`;
    _patchState.pid = pid;
    send({op: 'bpatch', pid, x: x0, y: y0, w, h, d: url(img), k: url(mask)});
    renewGesture();
};
const takePatchState = function () {
    const st = _patchState;
    _patchState = {pid: null, clean: true};
    return st.clean ? st.pid : null;
};
const loadImage = src => new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
});
const receivePatch = function (packet, fromId) {
    const costume = _costume;
    const job = Promise.all([loadImage(packet.d), loadImage(packet.k)]).then(([img, mask]) => {
        if (!img || !mask || _costume !== costume || !_host || !_host.isBitmap || !_host.isBitmap()) return false;
        const op = {op: 'bpatch', x: packet.x, y: packet.y, img, mask};
        const raster = getRaster();
        if (!raster || !raster.loaded || op.x + img.width > raster.canvas.width || op.y + img.height > raster.canvas.height) return false;
        applyOps([op], {log: true});
        clearPeerPreview(fromId);
        return true;
    });
    _patches.set(packet.pid, job);
    if (_patches.size > 64) _patches.delete(_patches.keys().next().value);
};
const applyPatch = function (op) {
    const raster = getRaster();
    if (!raster || !raster.loaded || !raster.canvas) return false;
    if (op.x + op.img.width > raster.canvas.width || op.y + op.img.height > raster.canvas.height) return false;
    const ctx = raster.getContext(true);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(op.mask, op.x, op.y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(op.img, op.x, op.y);
    ctx.restore();
    return true;
};
const whenPatch = pid => _patches.get(pid) || null;
export {
    PREVIEW_INTERVAL_MS,
    PREVIEW_TIMEOUT_MS,
    isCollabActive,
    isApplyingRemote,
    setCollabTransport,
    clearCollabTransport,
    setCollabHost,
    setCollabCostume,
    resetCollab,
    commitLocalChanges,
    takeTouched,
    restoreMine,
    liveCommit,
    setLivePreviewSource,
    receivePacket,
    remoteSeq,
    replayRemoteOpsSince,
    pendingRasters,
    whenRastersLoaded,
    subscribePeers,
    subscribeRemoteApplied,
    getPeers,
    setCollabDocHost,
    setLocalTool,
    shouldSampleCursor,
    sendLocalCursor,
    beginGesture,
    isTrackingGesture,
    trackGesturePoint,
    endGesture,
    hasGesture,
    isStickyTool,
    keepPeers,
    noteBitmapCommit,
    takePatchState,
    whenPatch
};
