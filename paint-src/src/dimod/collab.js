import paper from '@turbowarp/paper';
import {ensureDid, getDoc, getItemByDid, getPaintingLayer, rebuildIndex, setDoc} from './store';
import {applyItemData} from './items';
import {createDoc, deserializeDoc, serializeDoc, getDid} from './core';
const PREVIEW_INTERVAL_MS = 50;
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
    if (peer) peer.preview = null;
    notifyPeers();
};
const isTrackingGesture = () => !!_gesture && !_gesture.isVector;
const stopGesture = function () {
    if (_previewTimer) { clearInterval(_previewTimer); _previewTimer = null; }
    _gesture = null;
};
const isCollabActive = () => !!_transport;
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
    _lastSelectionKey = null;
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
const portableSources = function (item) {
    const map = new Map();
    const visit = node => {
        if (!node) return;
        if (node instanceof paper.Raster) {
            const src = node.image && node.image.src;
            if (src && !PORTABLE_SOURCE.test(src) && !map.has(src)) {
                try { map.set(src, node.toDataURL()); } catch (e) {
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
const serializeItem = function (item) {
    const json = item.exportJSON({asString: false});
    const map = portableSources(item);
    if (map.size) rewriteSources(json, map);
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
    return {op: 'reset', items, doc: serializeDoc(getDoc())};
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
const commitLocalChanges = function (isVector) {
    if (!isCollabActive() || _applyingRemote || !isVector) return;
    if (_baseline === null) { send(buildReset()); captureBaseline(); return; }
    const ops = diffAgainstBaseline();
    captureBaseline();
    if (ops.length) send({op: 'ops', ops});
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
        if (!existing) return false;
        const item = importItem(op.json);
        if (!item) return true;
        imported.push(item);
        existing.replaceWith(item);
        return true;
    }
    if (op.op === 'remove') {
        const existing = getItemByDid(op.did);
        if (!existing) return false;
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
    peerRecord(fromId, packet).preview = {
        svg: packet.svg || null,
        dataUrl: packet.dataUrl || null,
        rect: packet.rect || null,
        at: Date.now()
    };
    notifyPeers();
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
    if (packet.op === 'preview-end') {
        const peer = _peers.get(fromId);
        if (peer) peer.preview = null;
        notifyPeers();
        return;
    }
    if (packet.op === 'resync-request') {
        if (_baseline !== null) send(buildReset());
        return;
    }
    if (packet.op === 'reset') {
        applyOps([{op: 'reset', items: packet.items, doc: packet.doc}], {log: true});
        clearPeerPreview(fromId);
        return;
    }
    if (packet.op === 'ops') {
        const complete = applyOps(packet.ops, {log: true});
        clearPeerPreview(fromId);
        if (!complete) send({op: 'resync-request'});
    }
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
    send({op: 'resync-request'});
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
        if (peer.preview && now - peer.preview.at > PREVIEW_TIMEOUT_MS) peer.preview = null;
    }
    return [..._peers.values()];
};
const setLocalTool = function (tool) { _localTool = tool || null; };
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
    const consider = item => {
        if (!item || taken.has(item.id) || item.guide || item.isClipMask()) return;
        taken.add(item.id);
        hot.push(item);
    };
    for (const item of layer.children) {
        if (!_gesture.startIds.has(item.id)) consider(item);
    }
    for (const selected of paper.project.selectedItems) {
        let top = selected;
        while (top.parent && top.parent !== layer) top = top.parent;
        if (top.parent === layer) consider(top);
    }
    return hot.slice(0, PREVIEW_MAX_ITEMS);
};
const sampleVectorPreview = function () {
    const items = hotItems();
    if (!items.length) return null;
    let markup = '';
    for (const item of items) {
        let node;
        try { node = item.exportSVG({asString: true}); } catch (e) { continue; }
        if (typeof node !== 'string') continue;
        markup += node;
        if (markup.length > PREVIEW_MAX_BYTES) return null;
    }
    return markup || null;
};
const sampleBitmapPreview = function (getRaster) {
    if (!_gesture || !_gesture.dirty) return null;
    const raster = getRaster && getRaster();
    if (!raster || !raster.loaded) return null;
    const rect = _gesture.dirty.expand(BITMAP_DIRTY_PAD).intersect(raster.bounds);
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    try {
        const region = raster.getSubRaster(rect);
        region.remove();
        const dataUrl = region.toDataURL();
        return {dataUrl, rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}};
    } catch (e) { return null; }
};
const sendPreview = function () {
    if (!isCollabActive() || !_gesture) return;
    const payload = _gesture.isVector ?
        {svg: sampleVectorPreview()} :
        sampleBitmapPreview(_gesture.getRaster);
    if (!payload || (!payload.svg && !payload.dataUrl)) return;
    send(Object.assign({op: 'preview'}, payload));
};
const beginGesture = function ({isVector, getRaster}) {
    if (!isCollabActive()) return;
    stopGesture();
    const layer = getPaintingLayer();
    _gesture = {isVector, getRaster, startIds: new Set(layer ? layer.children.map(item => item.id) : []), dirty: null};
    _previewTimer = setInterval(sendPreview, PREVIEW_INTERVAL_MS);
};
const trackGesturePoint = function (point) {
    if (!_gesture || _gesture.isVector || !point) return;
    const at = new paper.Rectangle(point.x, point.y, 1, 1);
    _gesture.dirty = _gesture.dirty ? _gesture.dirty.unite(at) : at;
};
const endGesture = function () {
    const wasActive = !!_gesture;
    stopGesture();
    if (wasActive && isCollabActive()) send({op: 'preview-end'});
};
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
    endGesture
};
