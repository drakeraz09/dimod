import EventEmitter from 'events';
import {askConfirm, askAlert} from './dimod-ui';
import pako from 'pako';
const decodeDimodToken = () => {
    try {
        const token = localStorage.getItem('token');
        const payload = token.split('.')[1];
        const json = decodeURIComponent(escape(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))));
        const data = JSON.parse(json);
        if (data.exp && data.exp * 1000 < Date.now()) return {};
        return data;
    } catch (e) { return {}; }
};
const getDimodToken = () => {
    try { return decodeDimodToken().userId ? localStorage.getItem('token') : null; } catch (e) { return null; }
};
const getDimodUsername = () => decodeDimodToken().username || null;
const getDimodUserId = () => decodeDimodToken().userId || null;
const API_BASE = process.env.DIMOD_API_BASE;
const emitter = new EventEmitter();
let state = {loaded: false, isCloud: false, cost: 400, balance: null};
const projectId = () => {
    try { return new URLSearchParams(location.search).get('p'); } catch (e) { return null; }
};
const authHeaders = () => { const token = getDimodToken(); return token ? {Authorization: `Bearer ${token}`} : {}; };
const setState = patch => {
    const was = state.isCloud;
    state = Object.assign({}, state, patch, {loaded: true});
    emitter.emit('change', state, was !== state.isCloud);
};
const getCloudState = () => state;
const isCloudProject = () => state.isCloud;
const onCloudStateChange = fn => { emitter.on('change', fn); return () => emitter.removeListener('change', fn); };
const whenCloudStateLoaded = (ms = 5000) => {
    if (state.loaded) return Promise.resolve(state);
    return new Promise(resolve => {
        let timer = null;
        const off = onCloudStateChange(s => { off(); clearTimeout(timer); resolve(s); });
        timer = setTimeout(() => { off(); resolve(state); }, ms);
    });
};
const loadCloudState = async () => {
    const id = projectId();
    if (!id) return state;
    try {
        const res = await fetch(`${API_BASE}/projects/${id}/cloud`, {headers: authHeaders()});
        if (!res.ok) return state;
        const data = await res.json();
        setState({isCloud: !!data.is_cloud, cost: data.cost || 400, balance: data.balance});
    } catch (e) {
    }
    return state;
};
const enableCloudProject = async () => {
    const id = projectId();
    if (!id) return 'Save the project to Dimod first';
    try {
        const res = await fetch(`${API_BASE}/projects/${id}/cloud`, {method: 'POST', headers: authHeaders()});
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.error || 'Could not make this a cloud project';
        setState({isCloud: true, balance: data.balance ?? state.balance});
        if (window.dimodCollab) window.dimodCollab.send('cloud-enabled', {});
        return null;
    } catch (e) { return 'Could not reach Dimod'; }
};
const DIT_ICON = 'https://lol.dimod.org/stuff/dit.png';
let purchasePrompt = null;
const setCloudPurchasePrompt = fn => {
    purchasePrompt = fn;
    return () => {
        if (purchasePrompt === fn) purchasePrompt = null;
    };
};
const confirmAndEnableCloud = async () => {
    if (state.isCloud) return true;
    if (purchasePrompt) { loadCloudState(); return new Promise(resolve => purchasePrompt(resolve)); }
    if (!state.loaded) await loadCloudState();
    const balanceText = typeof state.balance === 'number' ? ` You have ${state.balance} Dits.` : '';
    const agreed = await askConfirm(
        'This is a one-time cost for this project.\n\nIt unlocks the Client blocks, the Server tab ' +
        `(in the STAGE!!!) and cloud variables that can hold text.${balanceText}`,
        {title: `Make this a cloud project for ${state.cost} Dits?`, ok: 'Make it a cloud project'}
    );
    if (!agreed) return false;
    const error = await enableCloudProject();
    if (error) { await askAlert(error, {title: "Couldn't make it a cloud project"}); return false; }
    return true;
};
const listenForCollaborators = () => {
    const attach = () => {
        if (!window.dimodCollab || window.dimodCollab.__dimodCloudListener) return;
        window.dimodCollab.__dimodCloudListener = true;
        window.dimodCollab.addMessageListener(msg => {
            if (msg.type === 'cloud-enabled') loadCloudState();
        });
    };
    attach();
    window.addEventListener('dimod:collab-ready', attach);
    window.addEventListener('focus', () => {
        if (!window.dimodCollab && state.loaded && !state.isCloud) loadCloudState();
    });
};
if (typeof window !== 'undefined') listenForCollaborators();
const getDimodProjectId = () => {
    try { return new URLSearchParams(location.search).get('p'); } catch (e) { return null; }
};
const projectId$1 = getDimodProjectId;
const requestProjectName = async () => {
    const id = projectId$1();
    if (!id || !API_BASE) return null;
    try {
        const res = await fetch(`${API_BASE}/projects/${id}`, {headers: authHeaders()});
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.name === 'string' ? data.name : null;
    } catch (e) { return null; }
};
let pending$2 = null;
const fetchProjectName = () => {
    if (!pending$2) pending$2 = requestProjectName();
    return pending$2;
};
const rememberProjectName = name => { pending$2 = Promise.resolve(name); };
fetchProjectName();
const saveProjectName = async name => {
    const id = projectId$1();
    if (!id) return null;
    if (!API_BASE) return null;
    const trimmed = String(name || '').trim();
    if (!trimmed) return 'A project needs a name';
    if (trimmed.length > 128) return 'Name must be 128 characters or fewer';
    try {
        const res = await fetch(`${API_BASE}/projects/${id}`, {
            method: 'PATCH',
            headers: {...authHeaders(), 'Content-Type': 'application/json'},
            body: JSON.stringify({name: trimmed})
        });
        if (res.ok) { rememberProjectName(trimmed); return null; }
        const data = await res.json().catch(() => ({}));
        return data.error || 'Could not rename this project';
    } catch (e) { return 'Could not reach Dimod'; }
};
const KEY$1 = 'dimodRecentProjects';
const MAX = 6;
const read = () => {
    try { const list = JSON.parse(localStorage.getItem(KEY$1) || '[]'); return Array.isArray(list) ? list : []; } catch (e) { return []; }
};
const touchRecentProject = (id, patch) => {
    if (!id) return;
    try {
        const list = read();
        const i = list.findIndex(p => String(p.id) === String(id));
        const cur = i === -1 ? {id, openedAt: Date.now(), savedAt: null, unsaved: false} : list.splice(i, 1)[0];
        const next = {...cur, ...patch};
        if (patch.opened) next.openedAt = Date.now();
        delete next.opened;
        list.unshift(next);
        localStorage.setItem(KEY$1, JSON.stringify(list.slice(0, MAX)));
    } catch (e) {}
};
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();
const crc32 = data => {
    let crc = -1;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
};
const crcCache = new WeakMap();
const crcOf = data => {
    let crc = crcCache.get(data);
    if (crc === undefined) { crc = crc32(data); crcCache.set(data, crc); }
    return crc;
};
const toBytes = data => {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(0);
};
const extraAssetCache = new WeakMap();
const captureProjectFiles = async vm => {
    const raw = vm.saveProjectSb3DontZip();
    const files = {};
    for (const name of Object.keys(raw)) files[name] = toBytes(raw[name]);
    const zip = vm._projectZip;
    if (zip && zip.files) {
        await Promise.all(Object.keys(zip.files).filter(n => n.startsWith('extraAssets/') && !zip.files[n].dir).map(async n => {
            const entry = zip.files[n];
            let data = extraAssetCache.get(entry);
            if (!data) { data = await entry.async('uint8array'); extraAssetCache.set(entry, data); }
            files[n] = data;
        }));
    }
    return files;
};
const manifestFor = files => {
    const manifest = {};
    for (const name of Object.keys(files)) manifest[name] = `${crcOf(files[name])}:${files[name].length}`;
    return manifest;
};
const collectAssetNames = (node, into) => {
    if (!node || typeof node !== 'object') return into;
    if (Array.isArray(node)) {
        for (const item of node) collectAssetNames(item, into);
        return into;
    }
    if (typeof node.md5ext === 'string') into.add(node.md5ext);
    if (typeof node.assetId === 'string' && typeof node.dataFormat === 'string') {
        into.add(`${node.assetId}.${node.dataFormat}`);
    }
    for (const key of Object.keys(node)) collectAssetNames(node[key], into);
    return into;
};
const referencedAssetNames = files => {
    const json = files && files['project.json'];
    if (!json) return new Set();
    try { return collectAssetNames(JSON.parse(new TextDecoder().decode(json)), new Set()); } catch (e) { return null; }
};
const missingReferencedAssets = files => {
    const referenced = referencedAssetNames(files);
    if (!referenced) return [];
    return Array.from(referenced).filter(name => !(name in files));
};
const manifestsEqual = (a, b) => {
    const aKeys = Object.keys(a);
    return aKeys.length === Object.keys(b).length && aKeys.every(k => a[k] === b[k]);
};
const totalSize = files => Object.values(files).reduce((sum, f) => sum + f.length, 0);
const readZipManifest = buffer => {
    try {
        const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
        const len = view.byteLength;
        let eocd = -1;
        for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) return null;
        const count = view.getUint16(eocd + 10, true);
        let p = view.getUint32(eocd + 16, true);
        if (count === 0xFFFF || p === 0xFFFFFFFF) return null;
        const decoder = new TextDecoder();
        const manifest = {};
        for (let i = 0; i < count; i++) {
            if (view.getUint32(p, true) !== 0x02014b50) return null;
            const crc = view.getUint32(p + 16, true);
            const size = view.getUint32(p + 24, true);
            const nameLen = view.getUint16(p + 28, true);
            const extraLen = view.getUint16(p + 30, true);
            const commentLen = view.getUint16(p + 32, true);
            const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLen));
            if (!name.endsWith('/')) manifest[name] = `${crc}:${size}`;
            p += 46 + nameLen + extraLen + commentLen;
        }
        return manifest;
    } catch (e) { return null; }
};
const COMPRESSIBLE = ['.json', '.svg', '.ttf', '.otf'];
const DOS_TIME = (13 << 11) | (39 << 5) | 11;
const DOS_DATE = ((2020 - 1980) << 9) | (6 << 5) | 8;
const zipFiles = (files, {compress = true} = {}) => {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const name of Object.keys(files)) {
        const data = files[name];
        const nameBytes = encoder.encode(name);
        const crc = crcOf(data);
        let body = data;
        let method = 0;
        if (compress && COMPRESSIBLE.some(ext => name.endsWith(ext)) && data.length > 64) {
            const deflated = pako.deflateRaw(data);
            if (deflated.length < data.length) { body = deflated; method = 8; }
        }
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, method, true);
        local.setUint16(10, DOS_TIME, true);
        local.setUint16(12, DOS_DATE, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, body.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true);
        parts.push(local.buffer, nameBytes, body);
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(10, method, true);
        entry.setUint16(12, DOS_TIME, true);
        entry.setUint16(14, DOS_DATE, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, body.length, true);
        entry.setUint32(24, data.length, true);
        entry.setUint16(28, nameBytes.length, true);
        entry.setUint32(42, offset, true);
        central.push(entry.buffer, nameBytes);
        offset += 30 + nameBytes.length + body.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const count = Object.keys(files).length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], {type: 'application/x.scratch.sb3'});
};
const DB_NAME = 'dimod-project-cache';
const MAX_PROJECTS = 3;
const MAX_CACHE_BYTES = 300 * 1024 * 1024;
const HASH_NAME = /^[0-9a-f]{32}\.[a-z0-9]+$/i;
let dbPromise = null;
const openDb = () => {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore('projects', {keyPath: 'projectId'});
                req.result.createObjectStore('files');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }).catch(e => { dbPromise = null; throw e; });
    }
    return dbPromise;
};
const promisify = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});
const done = tx => new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
});
const fileKey = (projectId, name) => (HASH_NAME.test(name) ? `a:${name}` : `p:${projectId}:${name}`);
const keysOf = meta => (meta.zip ? [`z:${meta.projectId}`] : meta.names.map(n => fileKey(meta.projectId, n)));
const prune = async db => {
    const tx = db.transaction(['projects', 'files'], 'readwrite');
    const projects = tx.objectStore('projects');
    const filesStore = tx.objectStore('files');
    const metas = (await promisify(projects.getAll())).sort((a, b) => b.usedAt - a.usedAt);
    const keep = metas.slice(0, MAX_PROJECTS);
    for (const meta of metas.slice(MAX_PROJECTS)) projects.delete(meta.projectId);
    const live = new Set(keep.flatMap(keysOf));
    for (const key of await promisify(filesStore.getAllKeys())) {
        if (!live.has(key)) filesStore.delete(key);
    }
    await done(tx);
};
const safe = fn => async (...args) => {
    if (typeof indexedDB === 'undefined') return null;
    try { return await fn(...args); } catch (e) { return null; }
};
const projectCache = {
    load: safe(async (projectId, revision) => {
        const db = await openDb();
        const tx = db.transaction(['projects', 'files'], 'readonly');
        const meta = await promisify(tx.objectStore('projects').get(String(projectId)));
        if (!meta || meta.revision !== revision) return null;
        const filesStore = tx.objectStore('files');
        if (meta.zip) {
            const buffer = await promisify(filesStore.get(`z:${meta.projectId}`));
            return buffer ? {buffer, manifest: meta.manifest} : null;
        }
        const files = {};
        const values = await Promise.all(meta.names.map(n => promisify(filesStore.get(fileKey(meta.projectId, n)))));
        for (let i = 0; i < meta.names.length; i++) {
            if (!values[i]) return null;
            files[meta.names[i]] = values[i];
        }
        const buffer = await zipFiles(files, {compress: false}).arrayBuffer();
        return {buffer, manifest: meta.manifest};
    }),
    storeZip: safe(async (projectId, revision, buffer, manifest) => {
        if (buffer.byteLength > MAX_CACHE_BYTES) return;
        const db = await openDb();
        const tx = db.transaction(['projects', 'files'], 'readwrite');
        tx.objectStore('files').put(buffer, `z:${projectId}`);
        tx.objectStore('projects').put({projectId: String(projectId), revision, manifest, names: [], zip: true, usedAt: Date.now()});
        await done(tx);
        await prune(db);
    }),
    storeFiles: safe(async (projectId, revision, files, manifest) => {
        if (totalSize(files) > MAX_CACHE_BYTES) return;
        const db = await openDb();
        const names = Object.keys(files);
        const existing = new Set(await promisify(db.transaction('files').objectStore('files').getAllKeys()));
        const tx = db.transaction(['projects', 'files'], 'readwrite');
        const filesStore = tx.objectStore('files');
        for (const name of names) {
            const key = fileKey(projectId, name);
            if (key.startsWith('a:') && existing.has(key)) continue;
            const data = files[name];
            filesStore.put(data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice(), key);
        }
        tx.objectStore('projects').put({projectId: String(projectId), revision, manifest, names, zip: false, usedAt: Date.now()});
        await done(tx);
        await prune(db);
    })
};
const getSeeInsideId = () => {
    try {
        const params = new URLSearchParams(location.search);
        return params.get('p') || params.get('dimod_id') ? null : params.get('view');
    } catch (e) { return null; }
};
let pending$1 = null;
const loadSeeInside = () => {
    const id = getSeeInsideId();
    if (!id) return Promise.resolve(null);
    if (!pending$1) {
        const token = getDimodToken();
        pending$1 = fetch(`${API_BASE}/projects/${encodeURIComponent(id)}/inside`, {
            headers: token ? {Authorization: `Bearer ${token}`} : {}
        })
            .then(res => res.json().then(body => (res.ok ? body : {error: body.error || `error ${res.status}`})))
            .catch(() => { pending$1 = null; return {error: 'the server couldn\'t be reached'}; });
    }
    return pending$1;
};
const remixSeenProject = async () => {
    const id = getSeeInsideId();
    const token = getDimodToken();
    if (!token) throw new Error('Log in to Dimod to remix');
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}/remix`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`}
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `error ${res.status}`);
    return body.id;
};
const KEY = process.env.DIMOD_ASSET_KEY;
function xor(buffer) {
    const keyBytes = new TextEncoder().encode(KEY);
    const bytes = new Uint8Array(buffer);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) { out[i] = bytes[i] ^ keyBytes[i % keyBytes.length]; }
    return out.buffer;
}
const dimodDecryptProject = xor;
const EMPTY = {costume: [], backdrop: [], sound: [], sprite: []};
let pending = null;
const fetchAll = () => {
    if (!API_BASE) return Promise.resolve(EMPTY);
    if (!pending) {
        pending = fetch(`${API_BASE}/library-assets`)
            .then(res => (res.ok ? res.json() : EMPTY))
            .catch(() => EMPTY);
    }
    return pending;
};
const getDimodCustomLibrary = kind => fetchAll().then(all => ((all && all[kind]) || [])
    .map(entry => ({...entry, dimodLibraryId: entry.id, _key: `dimod-${entry.id}`})));
let lastLocalEditAt = 0;
let editSeq = 0;
let savedSeq = 0;
let remoteDepth = 0;
const markLocalEdit = () => { lastLocalEditAt = Date.now(); editSeq++; };
const getLastLocalEditAt = () => lastLocalEditAt;
const getLocalEditSeq = () => editSeq;
const markSavedThrough = seq => {
    if (seq > savedSeq) savedSeq = seq;
};
const hasUnsavedLocalEdits = () => editSeq > savedSeq;
const getUnsavedEditCount = () => Math.max(0, editSeq - savedSeq);
let saveHealth = 'ok';
const getSaveHealth = () => saveHealth;
const setSaveHealth = h => {
    if (h === saveHealth) return;
    saveHealth = h;
    try { window.dispatchEvent(new CustomEvent('dimod:save-health', {detail: h})); } catch (e) {}
};
const isApplyingRemote = () => remoteDepth > 0;
const runAsRemote = fn => {
    remoteDepth++;
    let result;
    try { result = fn(); } catch (e) { remoteDepth--; throw e; }
    if (result && typeof result.then === 'function') {
        return result.then(value => { remoteDepth--; return value; }, err => { remoteDepth--; throw err; });
    }
    remoteDepth--;
    return result;
};
const attachEditClock = vm => {
    if (!vm || vm.__dimodEditClockAttached) return;
    vm.__dimodEditClockAttached = true;
    vm.on('PROJECT_CHANGED', () => {
        if (!vm.__dimodProjectFullyLoaded || remoteDepth > 0) return;
        markLocalEdit();
    });
};
let threadPromise = null;
const getProjectThreadId = () => {
    if (threadPromise) return threadPromise;
    const id = projectId();
    if (!id || !getDimodToken()) return Promise.resolve(null);
    threadPromise = fetch(`${API_BASE}/dm/projects/${encodeURIComponent(id)}`, {headers: authHeaders()})
        .then(res => (res.ok ? res.json() : null))
        .then(thread => {
            const found = (thread && thread.id) || null;
            if (!found) threadPromise = null;
            return found;
        })
        .catch(() => { threadPromise = null; return null; });
    return threadPromise;
};
const sendProjectChatMessage = text => getProjectThreadId().then(threadId => {
    if (!threadId) return null;
    return fetch(`${API_BASE}/dm/threads/${threadId}/messages`, {
        method: 'POST',
        headers: Object.assign({'Content-Type': 'application/json'}, authHeaders()),
        body: JSON.stringify({body: text})
    })
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null);
})
    .catch(() => null);
const listenToProjectChat = onMessage => {
    const token = getDimodToken();
    if (!token || !projectId()) return () => {};
    let ws = null;
    let reconnectTimer = null;
    let closed = false;
    let threadId = null;
    const ensureThread = () => getProjectThreadId().then(id => { threadId = id; });
    ensureThread();
    const RECONNECT_MS = 2500;
    let reconnect = null;
    const open = () => {
        if (closed || ws) return;
        const base = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
        try { ws = new WebSocket(`${base}/ws/dm?token=${encodeURIComponent(token)}`); } catch (e) { reconnect(); return; }
        ws.onmessage = e => {
            let data;
            try { data = JSON.parse(e.data); } catch (err) { return; }
            if (data.type !== 'dm' || !data.message) return;
            if (!threadId) { ensureThread(); return; }
            if (data.message.thread_id !== threadId) return;
            onMessage(data.message);
        };
        ws.onclose = () => { ws = null; reconnect(); };
        ws.onerror = () => ws && ws.close();
    };
    reconnect = () => {
        if (closed) return;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(open, RECONNECT_MS);
    };
    open();
    return () => {
        closed = true;
        clearTimeout(reconnectTimer);
        if (ws) ws.close();
        ws = null;
    };
};
export {DIT_ICON, attachEditClock, captureProjectFiles, confirmAndEnableCloud, decodeDimodToken, dimodDecryptProject, enableCloudProject, fetchProjectName, getCloudState, getDimodCustomLibrary, getDimodProjectId, getDimodToken, getDimodUserId, getDimodUsername, getLastLocalEditAt, getLocalEditSeq, getProjectThreadId, getSaveHealth, getSeeInsideId, getUnsavedEditCount, hasUnsavedLocalEdits, isApplyingRemote, isCloudProject, listenToProjectChat, loadCloudState, loadSeeInside, manifestFor, manifestsEqual, markLocalEdit, markSavedThrough, missingReferencedAssets, onCloudStateChange, projectCache, readZipManifest, referencedAssetNames, remixSeenProject, runAsRemote, saveProjectName, sendProjectChatMessage, setCloudPurchasePrompt, setSaveHealth, totalSize, touchRecentProject, whenCloudStateLoaded, zipFiles};
