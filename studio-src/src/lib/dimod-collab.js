import DOMPurify from 'dompurify';
import {getDimodUserId} from './dimod-project';
import Comment from 'scratch-vm/src/engine/comment';
import log from './log.js';
import {kindOfExt} from './dimod-scenes';
import {CHANGED_EVENT as TILEMAPS_CHANGED, normalizeDoc as normalizeTileDoc} from './dimod-tilemaps.js';
import {blocksRevision, tracksBlocksRevision, repairBlockGraph} from './dimod-vm.js';
import styles from '../components/dimod-field-carets/dimod-field-carets.css';
const CURSOR_COLORS = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'
];
const hashString = str => {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return h;
};
const colorForUserId = id => CURSOR_COLORS[Math.abs(hashString(id || '')) % CURSOR_COLORS.length];
const contrastTextColor = hex => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const linear = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const luminance = (0.2126 * linear(r)) + (0.7152 * linear(g)) + (0.0722 * linear(b));
    return luminance > 0.5 ? '#000000' : '#ffffff';
};
const MAX_OP_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 256 * 1024;
const BITMAP_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const DID = /^[a-z0-9]{1,32}$/;
const MAX_SELECTION = 500;
const MAX_TOOL_LEN = 40;
const MAX_DOC_BYTES = 512 * 1024;
const getPaintCollab = () => {
    try { return require('scratch-paint').PaintCollab || null; } catch (e) { return null; }
};
let installedFor = null;
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const URI_BEARING_ATTRS = ['href', 'xlink:href', 'src'];
const DATA_IMAGE_URI = /^data:image\//i;
const stripRemoteUris = root => {
    root.querySelectorAll('*').forEach(el => {
        URI_BEARING_ATTRS.forEach(name => {
            const value = el.getAttribute(name);
            if (value !== null && !DATA_IMAGE_URI.test(value.replace(/\s/g, ''))) { el.removeAttribute(name); }
        });
        const nsValue = el.getAttributeNS(XLINK_NS, 'href');
        if (nsValue !== null && !DATA_IMAGE_URI.test(nsValue.replace(/\s/g, ''))) { el.removeAttributeNS(XLINK_NS, 'href'); }
    });
};
const sanitizePreviewSvg = markup => {
    if (typeof markup !== 'string' || !markup || markup.length > MAX_PREVIEW_BYTES) return null;
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
    try {
        const frag = DOMPurify.sanitize(wrapped, {
            USE_PROFILES: {svg: true},
            FORBID_TAGS: ['script', 'foreignObject', 'style'],
            RETURN_DOM_FRAGMENT: true
        });
        if (!frag) return null;
        stripRemoteUris(frag);
        const root = frag.firstElementChild;
        if (!root) return null;
        const serializer = new XMLSerializer();
        let inner = '';
        for (const child of root.childNodes) inner += serializer.serializeToString(child);
        return inner.trim() ? inner : null;
    } catch (e) { return null; }
};
const isDocOk = doc => typeof doc === 'string' && doc.length <= MAX_DOC_BYTES;
const vetPacket = (packet, fromUserId) => {
    if (!packet || typeof packet !== 'object') return null;
    if (packet.op === 'preview') {
        const svg = packet.svg ? sanitizePreviewSvg(packet.svg) : null;
        const dataUrl = typeof packet.dataUrl === 'string' &&
            packet.dataUrl.length <= MAX_PREVIEW_BYTES &&
            BITMAP_DATA_URL.test(packet.dataUrl) ? packet.dataUrl : null;
        if (!svg && !dataUrl) return null;
        const rect = packet.rect;
        const rectOk = rect && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]));
        return Object.assign({}, packet, {
            svg,
            dataUrl,
            rect: rectOk ? rect : null,
            username: packet.fromUsername || '',
            color: colorForUserId(fromUserId)
        });
    }
    if (packet.op === 'cursor') {
        if (!Number.isFinite(packet.x) || !Number.isFinite(packet.y)) return null;
        return Object.assign({}, packet, {
            tool: typeof packet.tool === 'string' && packet.tool.length <= MAX_TOOL_LEN ?
                packet.tool : null,
            username: packet.fromUsername || '',
            color: colorForUserId(fromUserId)
        });
    }
    if (packet.op === 'selection') {
        if (!Array.isArray(packet.dids)) return null;
        const dids = packet.dids.filter(did => typeof did === 'string' && DID.test(did));
        return Object.assign({}, packet, {
            dids: dids.slice(0, MAX_SELECTION),
            username: packet.fromUsername || '',
            color: colorForUserId(fromUserId)
        });
    }
    if (packet.op === 'doc') {
        if (!isDocOk(packet.doc)) return null;
        return packet;
    }
    if (packet.op === 'ops' || packet.op === 'reset') {
        const list = packet.op === 'ops' ? packet.ops : packet.items;
        if (!Array.isArray(list)) return null;
        if (packet.op === 'reset' && packet.doc && !isDocOk(packet.doc)) return null;
        try {
            if (JSON.stringify(list).length > MAX_OP_BYTES) return null;
        } catch (e) { return null; }
        return packet;
    }
    if (packet.op === 'preview-end' || packet.op === 'resync-request') return packet;
    return null;
};
const installPaintCollab = ({targetId, costumeIndex}) => {
    const PaintCollab = getPaintCollab();
    if (!PaintCollab || !window.dimodCollab) return;
    if (installedFor && installedFor.targetId === targetId && installedFor.costumeIndex === costumeIndex) return;
    PaintCollab.setCollabTransport({
        send: packet => {
            const collab = window.dimodCollab;
            if (!collab) return;
            if (packet.op === 'preview' || packet.op === 'preview-end') {
                collab.sendPaintPreview(packet);
            } else if (packet.op === 'cursor' || packet.op === 'selection') { collab.sendPaintCursor(packet); } else { collab.sendPaintOp(packet); }
        }
    });
    PaintCollab.setCollabCostume({targetId, costumeIndex});
    installedFor = {targetId, costumeIndex};
};
const uninstallPaintCollab = () => {
    const PaintCollab = getPaintCollab();
    if (PaintCollab) { PaintCollab.setCollabCostume(null); PaintCollab.clearCollabTransport(); }
    installedFor = null;
};
const handleRemotePaintPacket = (packet, fromUserId) => {
    if (!installedFor) return;
    const PaintCollab = getPaintCollab();
    if (!PaintCollab) return;
    const vetted = vetPacket(packet, fromUserId);
    if (!vetted) return;
    PaintCollab.receivePacket(vetted, fromUserId);
};
const isLivePaintCostume = (targetId, costumeIndex) =>
    !!installedFor && installedFor.targetId === targetId && installedFor.costumeIndex === costumeIndex;
const isApplyingRemotePaint = () => {
    const PaintCollab = getPaintCollab();
    return !!PaintCollab && PaintCollab.isApplyingRemote();
};
const isPaintGestureActive = () => {
    const PaintCollab = getPaintCollab();
    try { return !!PaintCollab && PaintCollab.isTrackingGesture(); } catch (e) { return false; }
};
let suspendedFor = null;
const suspendPaintCollab = () => {
    if (!installedFor) return;
    const was = installedFor;
    uninstallPaintCollab();
    suspendedFor = was;
};
const resumePaintCollab = () => {
    const was = suspendedFor;
    suspendedFor = null;
    if (was && !installedFor) installPaintCollab(was);
};
const ALLOWED_COSTUME_FORMATS = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
const ALLOWED_SOUND_FORMATS = new Set(['wav', 'mp3', 'ogg']);
const MAX_ASSET_NAME_LENGTH = 256;
const MAX_ASSET_BASE64_CHARS = 40 * 1024 * 1024;
const isValidAssetName = name => typeof name === 'string' && name.length > 0 && name.length <= MAX_ASSET_NAME_LENGTH;
const isValidAssetData = data => typeof data === 'string' && data.length > 0 && data.length <= MAX_ASSET_BASE64_CHARS &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(data);
const isOptionalFiniteNumber = n => n === undefined || n === null || Number.isFinite(n);
const CONCURRENT_EDIT_WINDOW_MS = 3000;
const lastLocalCostumeEdit = new Map();
const editKey = (targetId, index) => `${targetId}:${index}`;
const iWinConcurrentEdit = fromUserId =>
    String(getDimodUserId() || '') < String(fromUserId || '');
const assetVers = new Map();
const assetVerKey = (kind, targetId, name) => `${kind}:${targetId}:${name}`;
const bumpAssetVer = key => {
    const v = Math.max((assetVers.get(key) || 0) + 1, Date.now());
    assetVers.set(key, v);
    return v;
};
const remoteAssetIsOlder = (key, payload) => {
    if (!Number.isFinite(payload.ver)) return false;
    const mine = assetVers.get(key) || 0;
    return payload.ver < mine || (payload.ver === mine &&
        `${getDimodUserId() || ''}|${(window.dimodCollab && window.dimodCollab.tabId) || ''}` < `${payload.from || ''}|${payload.fromTab || ''}`);
};
const takeAssetVer = (key, payload) => {
    if (Number.isFinite(payload.ver)) assetVers.set(key, Math.max(assetVers.get(key) || 0, payload.ver));
};
const uint8ToBase64 = bytes => {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
};
const base64ToUint8 = base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};
const bitmapDataUrlToImageData = dataUrl => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = reject;
    img.src = dataUrl;
});
const COSTUME_BROADCAST_DEBOUNCE_MS = 150;
let pendingCostumeBroadcast = null;
const sendCostumeUpdate = ({base, isVector, image}) => {
    if (!window.dimodCollab) return;
    if (isVector) { window.dimodCollab.sendAssetUpdate({...base, image}); return; }
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').putImageData(image, 0, 0);
    window.dimodCollab.sendAssetUpdate({...base, image: canvas.toDataURL('image/png')});
};
const flushCostumeBroadcast = () => {
    if (!pendingCostumeBroadcast) return;
    const queued = pendingCostumeBroadcast;
    pendingCostumeBroadcast = null;
    clearTimeout(queued.timer);
    sendCostumeUpdate(queued);
};
const broadcastCostumeUpdate = (vm, costumeIndex, isVector, image, rotationCenterX, rotationCenterY) => {
    if (!window.dimodCollab) return;
    const target = vm.editingTarget;
    if (!target) return;
    lastLocalCostumeEdit.set(editKey(target.id, costumeIndex), Date.now());
    const costume = target.getCostumes()[costumeIndex];
    const base = {
        kind: 'costume',
        isVector,
        targetId: target.id,
        costumeIndex,
        costumeName: costume ? costume.name : null,
        ver: bumpAssetVer(assetVerKey('c', target.id, costume ? costume.name : costumeIndex)),
        rotationCenterX,
        rotationCenterY
    };
    if (pendingCostumeBroadcast &&
        (pendingCostumeBroadcast.base.targetId !== base.targetId ||
            pendingCostumeBroadcast.base.costumeIndex !== base.costumeIndex)) { flushCostumeBroadcast(); }
    if (pendingCostumeBroadcast) clearTimeout(pendingCostumeBroadcast.timer);
    pendingCostumeBroadcast = {base, isVector, image, timer: setTimeout(flushCostumeBroadcast, COSTUME_BROADCAST_DEBOUNCE_MS)};
};
const notifyCostumeUpdated = (targetId, index) => {
    window.dispatchEvent(new CustomEvent('dimod:costume-updated', {detail: {targetId, index}}));
};
const DEFERRED_BITMAP_POLL_MS = 120;
let deferredBitmapUpdate = null;
let deferredBitmapTimer = null;
const runDeferredBitmapUpdate = () => {
    if (!deferredBitmapUpdate) return;
    if (isPaintGestureActive()) { deferredBitmapTimer = setTimeout(runDeferredBitmapUpdate, DEFERRED_BITMAP_POLL_MS); return; }
    const {apply} = deferredBitmapUpdate;
    deferredBitmapUpdate = null;
    deferredBitmapTimer = null;
    apply();
};
const deferBitmapUpdate = apply => {
    deferredBitmapUpdate = {apply};
    if (deferredBitmapTimer) return;
    deferredBitmapTimer = setTimeout(runDeferredBitmapUpdate, DEFERRED_BITMAP_POLL_MS);
};
let liveSvgTimer = null;
const deferLiveSvg = apply => {
    clearTimeout(liveSvgTimer);
    const run = () => {
        if (isPaintGestureActive()) { liveSvgTimer = setTimeout(run, DEFERRED_BITMAP_POLL_MS); return; }
        liveSvgTimer = null;
        apply();
    };
    liveSvgTimer = setTimeout(run, 150);
};
const applyCostumeUpdate = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const costumes = target.getCostumes();
    const index = payload.costumeName ? costumes.findIndex(c => c.name === payload.costumeName) :
        payload.costumeIndex;
    if (index < 0 || index >= costumes.length) return;
    const costume = costumes[index];
    const vkey = assetVerKey('c', payload.targetId, costume.name);
    const stale = () => remoteAssetIsOlder(vkey, payload);
    if (Number.isFinite(payload.ver)) {
        if (stale()) return;
    } else {
        const mineAt = lastLocalCostumeEdit.get(editKey(payload.targetId, index));
        if (mineAt && Date.now() - mineAt < CONCURRENT_EDIT_WINDOW_MS && iWinConcurrentEdit(payload.from)) return;
    }
    if (payload.isVector) {
        if (isLivePaintCostume(payload.targetId, index)) {
            deferLiveSvg(() => {
                if (stale() || target.getCostumes()[index] !== costume) return;
                takeAssetVer(vkey, payload);
                if (Math.abs(costume.rotationCenterX - payload.rotationCenterX) < 0.01 &&
                    Math.abs(costume.rotationCenterY - payload.rotationCenterY) < 0.01) return;
                remotely(() => vm._updateSvg(costume, payload.image, payload.rotationCenterX, payload.rotationCenterY));
                notifyCostumeUpdated(payload.targetId, index);
            });
            return;
        }
        takeAssetVer(vkey, payload);
        vm._updateSvg(costume, payload.image, payload.rotationCenterX, payload.rotationCenterY);
        notifyCostumeUpdated(payload.targetId, index);
        return;
    }
    return bitmapDataUrlToImageData(payload.image).then(imageData => {
        const apply = () => {
            if (stale() || target.getCostumes()[index] !== costume) return;
            takeAssetVer(vkey, payload);
            vm._updateBitmap(costume, imageData, payload.rotationCenterX, payload.rotationCenterY, 2);
            notifyCostumeUpdated(payload.targetId, index);
        };
        if (isLivePaintCostume(payload.targetId, index) && isPaintGestureActive()) { deferBitmapUpdate(apply); return; }
        apply();
    });
};
const broadcastSoundUpdate = (vm, soundIndex, wavBytes) => {
    if (!window.dimodCollab) return;
    const target = vm.editingTarget;
    if (!target) return;
    const sound = target.sprite.sounds[soundIndex];
    window.dimodCollab.sendAssetUpdate({
        kind: 'sound',
        targetId: target.id,
        soundIndex,
        soundName: sound ? sound.name : null,
        ver: bumpAssetVer(assetVerKey('s', target.id, sound ? sound.name : soundIndex)),
        wav: uint8ToBase64(wavBytes)
    });
};
const applySoundUpdate = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const sounds = target.sprite.sounds;
    const index = payload.soundName ? sounds.findIndex(s => s.name === payload.soundName) : payload.soundIndex;
    if (index < 0 || index >= sounds.length) return;
    const vkey = assetVerKey('s', payload.targetId, sounds[index].name);
    if (remoteAssetIsOlder(vkey, payload)) return;
    const wavBytes = base64ToUint8(payload.wav);
    const audioContext = vm.runtime.audioEngine.audioContext;
    return audioContext.decodeAudioData(wavBytes.buffer.slice(0)).then(audioBuffer => {
        const sound = sounds[index];
        if (!sound || remoteAssetIsOlder(vkey, payload)) return;
        takeAssetVer(vkey, payload);
        if (sound && sound.broken) delete sound.broken;
        const soundId = sound ? sound.soundId : null;
        if (soundId && vm.runtime.audioEngine) { target.sprite.soundBank.getSoundPlayer(soundId).buffer = audioBuffer; }
        sound.format = '';
        const storage = vm.runtime.storage;
        sound.asset = storage.createAsset(storage.AssetType.Sound, storage.DataFormat.WAV, wavBytes, null, true);
        sound.assetId = sound.asset.assetId;
        sound.dataFormat = storage.DataFormat.WAV;
        sound.md5 = `${sound.assetId}.${sound.dataFormat}`;
        sound.sampleCount = audioBuffer.length;
        sound.rate = audioBuffer.sampleRate;
        vm.emitTargetsUpdate();
    });
};
let clock = 0;
const tick = () => { clock = Math.max(clock + 1, Date.now()); return clock; };
const newStamp = () => ({v: tick(), who: `${getDimodUserId() || ''}|${(window.dimodCollab && window.dimodCollab.tabId) || ''}`});
const seeStamp = s => {
    if (!s || !Number.isFinite(s.v) || typeof s.who !== 'string' || s.who.length > 200) return null;
    if (s.v > clock) clock = s.v;
    return {v: s.v, who: s.who};
};
const later = (a, b) => !!a && (!b || a.v > b.v || (a.v === b.v && a.who > b.who));
const addStamps = new WeakMap();
const nameStamps = new WeakMap();
const sentNames = new WeakMap();
const orderStamps = new Map();
const goneAssets = new WeakSet();
const listOf = (target, kind) => (kind === 'costume' ? target.getCostumes() : target.sprite.sounds);
const uids = new WeakMap();
const freshUid = () => `${tick().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const uidOf = o => (o ? uids.get(o) || null : null);
const tagAssets = target => {
    [target.getCostumes(), target.sprite.sounds].forEach(list => list.forEach(o => {
        if (!uids.has(o)) uids.set(o, `${target.id}:${o.name}`);
    }));
};
const findItem = (list, name, uid) => {
    const i = typeof uid === 'string' ? list.findIndex(o => uids.get(o) === uid) : -1;
    return i !== -1 ? i : list.findIndex(o => o.name === name);
};
const broadcastAssetAdd = (vm, targetId, atIndex, kind) => {
    const target = window.dimodCollab && vm.runtime.getTargetById(targetId);
    if (!target) return;
    const list = listOf(target, kind);
    const index = typeof atIndex === 'number' ? atIndex : list.length - 1;
    const o = list[index];
    if (!o || !o.asset) return;
    const stamp = newStamp();
    addStamps.set(o, stamp);
    uids.set(o, freshUid());
    const base = {kind: `${kind}-add`, targetId, insertIndex: index, after: index > 0 ? list[index - 1].name : null, stamp, uid: uidOf(o),
        name: o.name, dataFormat: o.dataFormat, data: uint8ToBase64(o.asset.data)};
    window.dimodCollab.sendAssetUpdate(kind === 'costume' ?
        {...base, rotationCenterX: o.rotationCenterX, rotationCenterY: o.rotationCenterY, bitmapResolution: o.bitmapResolution} :
        {...base, rate: o.rate, sampleCount: o.sampleCount});
};
const broadcastCostumeAdd = (vm, targetId, atIndex) => broadcastAssetAdd(vm, targetId, atIndex, 'costume');
const broadcastSoundAdd = (vm, targetId, atIndex) => broadcastAssetAdd(vm, targetId, atIndex, 'sound');
const placeNew = (vm, target, kind, payload) => {
    const list = listOf(target, kind);
    const o = list[list.length - 1];
    const s = seeStamp(payload.stamp);
    if (s) addStamps.set(o, s);
    if (typeof payload.uid === 'string' && payload.uid.length < 200) uids.set(o, payload.uid);
    const rest = list.slice(0, -1);
    const clash = o.name !== payload.name && rest.find(x => x.name === payload.name);
    if (clash && later(s, addStamps.get(clash))) {
        clash.name = o.name;
        o.name = payload.name;
        sentNames.set(clash, clash.name);
        sentNames.set(o, o.name);
    }
    const fallback = Number.isInteger(payload.insertIndex) ? Math.max(0, Math.min(payload.insertIndex, rest.length)) : rest.length;
    let pos = fallback;
    if (payload.after === null || typeof payload.after === 'string') {
        const anchor = payload.after === null ? -1 : rest.findIndex(x => x.name === payload.after);
        pos = payload.after !== null && anchor === -1 ? fallback : anchor + 1;
        if (s) while (pos < rest.length && later(addStamps.get(rest[pos]), s)) pos++;
    }
    if (pos === rest.length) return;
    rest.splice(pos, 0, o);
    setAssetOrder(vm, target, kind, rest);
};
const applyCostumeAdd = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    if (!ALLOWED_COSTUME_FORMATS.has(payload.dataFormat) || !isValidAssetName(payload.name) ||
        !isValidAssetData(payload.data) || !isOptionalFiniteNumber(payload.rotationCenterX) ||
        !isOptionalFiniteNumber(payload.rotationCenterY) || !isOptionalFiniteNumber(payload.bitmapResolution)) return;
    const storage = vm.runtime.storage;
    const isVector = payload.dataFormat === 'svg';
    const asset = new storage.Asset(
        isVector ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap,
        null,
        storage.DataFormat[payload.dataFormat.toUpperCase()],
        base64ToUint8(payload.data),
        true
    );
    const costumeObject = {
        name: payload.name,
        asset,
        rotationCenterX: payload.rotationCenterX,
        rotationCenterY: payload.rotationCenterY,
        bitmapResolution: payload.bitmapResolution
    };
    const previous = target.getCostumes()[target.currentCostume];
    return vm.addCostume(`${asset.assetId}.${asset.dataFormat}`, costumeObject, payload.targetId).then(() => remotely(() => {
        placeNew(vm, target, 'costume', payload);
        const back = previous ? target.getCostumes().indexOf(previous) : -1;
        if (back !== -1 && back !== target.currentCostume) target.setCostume(back);
        vm.emitTargetsUpdate();
    }));
};
const applySoundAdd = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    if (!ALLOWED_SOUND_FORMATS.has(payload.dataFormat) || !isValidAssetName(payload.name) ||
        !isValidAssetData(payload.data) || !isOptionalFiniteNumber(payload.rate) ||
        !isOptionalFiniteNumber(payload.sampleCount)) return;
    const storage = vm.runtime.storage;
    const asset = new storage.Asset(
        storage.AssetType.Sound,
        null,
        storage.DataFormat[payload.dataFormat.toUpperCase()],
        base64ToUint8(payload.data),
        true
    );
    const soundObject = {
        md5: `${asset.assetId}.${asset.dataFormat}`,
        asset,
        name: payload.name,
        rate: payload.rate,
        sampleCount: payload.sampleCount
    };
    return vm.addSound(soundObject, payload.targetId).then(() => remotely(() => placeNew(vm, target, 'sound', payload)));
};
const broadcastCostumeDelete = (vm, targetId, index, name, o) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'costume-delete', targetId, index, name, uid: uidOf(o)});
};
const broadcastSoundDelete = (vm, targetId, index, name, o) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'sound-delete', targetId, index, name, uid: uidOf(o)});
};
const applyAssetDelete = (vm, payload, kind) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const list = listOf(target, kind);
    const index = findItem(list, payload.name, payload.uid);
    if (index === -1) return;
    goneAssets.add(list[index]);
    if (kind === 'costume') target.deleteCostume(index);
    else target.deleteSound(index);
    vm.emitTargetsUpdate();
};
const applyCostumeDelete = (vm, payload) => applyAssetDelete(vm, payload, 'costume');
const applySoundDelete = (vm, payload) => applyAssetDelete(vm, payload, 'sound');
const moveItem = (list, from, to) => {
    const arr = list.slice();
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= arr.length) return arr;
    const [o] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(to, arr.length)), 0, o);
    return arr;
};
const applyIndexReorder = (vm, payload, kind) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    setAssetOrder(vm, target, kind, moveItem(listOf(target, kind), payload.index, payload.newIndex));
};
const applyCostumeReorder = (vm, payload) => applyIndexReorder(vm, payload, 'costume');
const applySoundReorder = (vm, payload) => applyIndexReorder(vm, payload, 'sound');
const broadcastOrder = (vm, targetId, kind) => {
    const target = window.dimodCollab && vm.runtime.getTargetById(targetId);
    if (!target) return;
    const stamp = newStamp();
    orderStamps.set(`${kind}:${targetId}`, stamp);
    const list = listOf(target, kind);
    window.dimodCollab.sendAssetUpdate({kind: `${kind}-order`, targetId, names: list.map(o => o.name), uids: list.map(uidOf), stamp});
};
const broadcastCostumeOrder = (vm, targetId) => broadcastOrder(vm, targetId, 'costume');
const broadcastSoundOrder = (vm, targetId) => broadcastOrder(vm, targetId, 'sound');
const setAssetOrder = (vm, target, kind, objs) => {
    if (kind === 'costume') {
        const current = target.getCurrentCostume();
        target.sprite.costumes = objs.slice();
        if (current) target.currentCostume = Math.max(0, target.getCostumeIndexByName(current.name));
    } else { target.sprite.sounds = objs.slice(); }
    vm.runtime.emitProjectChanged();
    vm.emitTargetsUpdate();
};
const applyNameOrder = (vm, payload, kind) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target || !Array.isArray(payload.names) || payload.names.length > 5000) return;
    const key = `${kind}:${payload.targetId}`;
    const s = seeStamp(payload.stamp);
    if (s && orderStamps.has(key) && !later(s, orderStamps.get(key))) return;
    if (s) orderStamps.set(key, s);
    const list = listOf(target, kind);
    const byName = new Map(list.map(o => [o.name, o]));
    const byUid = new Map(list.map(o => [uidOf(o), o]));
    const final = [];
    payload.names.forEach((n, i) => {
        const u = Array.isArray(payload.uids) ? payload.uids[i] : null;
        const o = (typeof u === 'string' && byUid.get(u)) || (typeof n === 'string' && byName.get(n));
        if (o && !final.includes(o)) final.push(o);
    });
    list.forEach(o => {
        if (!final.includes(o)) final.push(o);
    });
    setAssetOrder(vm, target, kind, final);
};
const broadcastAssetRename = (vm, targetId, index, oldName, newName, o, kind) => {
    if (!window.dimodCollab) return;
    const stamp = newStamp();
    if (o) {
        nameStamps.set(o, stamp);
        sentNames.set(o, newName);
    }
    window.dimodCollab.sendAssetUpdate({kind: `${kind}-rename`, targetId, index, oldName, newName, stamp, uid: uidOf(o)});
};
const broadcastCostumeRename = (vm, targetId, index, oldName, newName, o) => broadcastAssetRename(vm, targetId, index, oldName, newName, o, 'costume');
const broadcastSoundRename = (vm, targetId, index, oldName, newName, o) => broadcastAssetRename(vm, targetId, index, oldName, newName, o, 'sound');
const applyAssetRename = (vm, payload, kind) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target || !isValidAssetName(payload.newName)) return;
    const list = listOf(target, kind);
    const index = findItem(list, payload.oldName, payload.uid);
    if (index === -1) return;
    const o = list[index];
    const s = seeStamp(payload.stamp);
    if (o.name !== payload.oldName && !later(s, nameStamps.get(o))) return;
    if (s) nameStamps.set(o, s);
    if (kind === 'costume') target.renameCostume(index, payload.newName);
    else target.renameSound(index, payload.newName);
    sentNames.set(o, o.name);
    vm.emitTargetsUpdate();
};
const applyCostumeRename = (vm, payload) => applyAssetRename(vm, payload, 'costume');
const applySoundRename = (vm, payload) => applyAssetRename(vm, payload, 'sound');
const remoteEdited = new Map();
const remoteKey = (targetId, kind) => `${targetId}|${kind}`;
const getRemoteEditedNames = (targetId, kind) => remoteEdited.get(remoteKey(targetId, kind)) || null;
const clearRemoteEdited = (targetId, kind, name) => {
    const set = remoteEdited.get(remoteKey(targetId, kind));
    if (set && set.delete(name)) window.dispatchEvent(new CustomEvent('dimod:remote-asset-edit'));
};
const noteRemoteEdit = payload => {
    const kind = String(payload.kind || '').split('-')[0];
    if (kind !== 'costume' && kind !== 'sound') return;
    if (payload.kind.endsWith('-delete') || payload.kind.endsWith('-reorder')) return;
    const name = payload.newName || payload.costumeName || payload.soundName || payload.name;
    if (!name) return;
    const key = remoteKey(payload.targetId, kind);
    if (!remoteEdited.has(key)) remoteEdited.set(key, new Set());
    const set = remoteEdited.get(key);
    if (payload.oldName) set.delete(payload.oldName);
    set.add(name);
    window.dispatchEvent(new CustomEvent('dimod:remote-asset-edit'));
};
const FONT_FORMATS = new Set(['ttf', 'otf', 'woff', 'woff2']);
const applyFontAdd = (vm, payload) => {
    const fm = vm.runtime.fontManager;
    if (!fm || typeof payload.family !== 'string' || !fm.isValidFamily(payload.family) || fm.hasFont(payload.family) ||
        typeof payload.fallback !== 'string' || payload.fallback.length > 200) return;
    if (payload.system) return fm.addSystemFont(payload.family, payload.fallback);
    if (!FONT_FORMATS.has(payload.dataFormat) || !isValidAssetData(payload.data)) return;
    const storage = vm.runtime.storage;
    const asset = storage.createAsset(storage.AssetType.Font, payload.dataFormat, base64ToUint8(payload.data), null, true);
    fm.addCustomFont(payload.family, payload.fallback, asset);
};
const applyFontDelete = (vm, payload) => {
    const fm = vm.runtime.fontManager;
    const index = fm ? fm.fonts.findIndex(f => f.family === payload.family) : -1;
    if (index !== -1) fm.deleteFont(index);
};
const applyTileMaps = (vm, payload) => {
    if (typeof payload.doc !== 'string' || payload.doc.length > MAX_ASSET_BASE64_CHARS || remoteAssetIsOlder('tilemaps', payload)) return;
    let raw;
    try { raw = JSON.parse(payload.doc); } catch (e) { return; }
    takeAssetVer('tilemaps', payload);
    vm.runtime.dimodTileMaps = normalizeTileDoc(raw);
    vm.runtime.emit(TILEMAPS_CHANGED, {});
    vm.runtime.emitProjectChanged();
};
let tileTimer = 0;
const broadcastTileMaps = vm => {
    if (!window.dimodCollab || isQuiet(vm)) return;
    const ver = bumpAssetVer('tilemaps');
    clearTimeout(tileTimer);
    tileTimer = setTimeout(() => {
        const doc = vm.runtime.dimodTileMaps;
        if (window.dimodCollab && doc) window.dimodCollab.sendAssetUpdate({kind: 'tilemaps', ver, doc: JSON.stringify(doc)});
    }, 120);
};
let syncRemote = 0;
const remotely = fn => {
    syncRemote++;
    try { return fn(); } finally { syncRemote--; }
};
let remoteChain = Promise.resolve();
const queued = fn => {
    const run = () => remotely(fn);
    remoteChain = remoteChain.then(run, run);
    return remoteChain;
};
const applyRemoteAssetUpdate = (vm, payload) => queued(() => applyAssetNow(vm, payload));
const applyAssetNow = (vm, payload) => {
    noteRemoteEdit(payload);
    switch (payload.kind) {
    case 'costume': return applyCostumeUpdate(vm, payload);
    case 'sound': return applySoundUpdate(vm, payload);
    case 'costume-add': return applyCostumeAdd(vm, payload);
    case 'sound-add': return applySoundAdd(vm, payload);
    case 'costume-rename': return applyCostumeRename(vm, payload);
    case 'sound-rename': return applySoundRename(vm, payload);
    case 'costume-delete': return applyCostumeDelete(vm, payload);
    case 'sound-delete': return applySoundDelete(vm, payload);
    case 'costume-reorder': return applyCostumeReorder(vm, payload);
    case 'costume-order': return applyNameOrder(vm, payload, 'costume');
    case 'sound-order': return applyNameOrder(vm, payload, 'sound');
    case 'sound-reorder': return applySoundReorder(vm, payload);
    case 'font-add': return applyFontAdd(vm, payload);
    case 'font-delete': return applyFontDelete(vm, payload);
    case 'tilemaps': return applyTileMaps(vm, payload);
    default: return null;
    }
};
const UNSTABLE_ID_OPCODES = ['data_variable', 'data_listcontents'];
const hasUnstableId = block => !!block && (block.shadow || UNSTABLE_ID_OPCODES.includes(block.opcode));
const findShadowRef = (blocksContainer, blockId) => {
    const block = blocksContainer.getBlock(blockId);
    if (!hasUnstableId(block) || !block.parent) return null;
    const parent = blocksContainer.getBlock(block.parent);
    if (!parent || !parent.inputs) return null;
    const inputNames = Object.keys(parent.inputs);
    for (let i = 0; i < inputNames.length; i++) {
        const inputName = inputNames[i];
        const input = parent.inputs[inputName];
        if (input.shadow === blockId || input.block === blockId) { return {parentId: block.parent, inputName}; }
    }
    return null;
};
const resolveShadowRef = (blocksContainer, shadowRef) => {
    if (!shadowRef || !shadowRef.parentId || !shadowRef.inputName) return null;
    const parent = blocksContainer.getBlock(shadowRef.parentId);
    if (!parent || !parent.inputs) return null;
    const input = parent.inputs[shadowRef.inputName];
    if (!input) return null;
    return input.block || input.shadow || null;
};
const attachShadowRef = (blocksContainer, eventJson) => {
    if (!eventJson || typeof eventJson.blockId !== 'string') return eventJson;
    const shadowRef = findShadowRef(blocksContainer, eventJson.blockId);
    if (!shadowRef) return eventJson;
    return {...eventJson, shadowRef};
};
const resolveIncomingEvent = (blocksContainer, eventJson) => {
    if (!eventJson || !eventJson.shadowRef) return eventJson;
    const localId = resolveShadowRef(blocksContainer, eventJson.shadowRef);
    if (!localId) return null;
    return {...eventJson, blockId: localId};
};
const computeBlocksFingerprint = target => {
    const blocks = target && target.blocks && target.blocks._blocks;
    if (!blocks) return '';
    const describeSlot = input => {
        const refId = input.block || input.shadow;
        const refBlock = refId && blocks[refId];
        if (!refBlock) return 'none';
        if (hasUnstableId(refBlock)) {
            const fieldNames = Object.keys(refBlock.fields || {}).sort();
            const fields = fieldNames.map(f => refBlock.fields[f] && refBlock.fields[f].value).join('');
            return `lit:${refBlock.opcode}:${fields}`;
        }
        return `ref:${refId}`;
    };
    const stableIds = Object.keys(blocks)
        .filter(id => !hasUnstableId(blocks[id]))
        .sort();
    const parts = stableIds.map(id => {
        const b = blocks[id];
        const fieldNames = Object.keys(b.fields || {}).sort();
        const fields = fieldNames.map(f => `${f}=${b.fields[f] && b.fields[f].value}`).join(',');
        const inputNames = Object.keys(b.inputs || {}).sort();
        const inputs = inputNames.map(name => `${name}:${describeSlot(b.inputs[name])}`).join(',');
        return `${id}|${b.opcode}|${b.parent || ''}|${b.next || ''}|F(${fields})|I(${inputs})`;
    });
    return parts.join(';');
};
const computeBlocksHash = target => hashString(computeBlocksFingerprint(target));
const hashCache = new WeakMap();
const targetBlocksHash = target => {
    const container = target.blocks;
    const revision = blocksRevision(container);
    const cached = hashCache.get(container);
    if (cached && cached.revision === revision && cached.blocksRef === container._blocks &&
        tracksBlocksRevision()) return cached.hash;
    const hash = computeBlocksHash(target);
    hashCache.set(container, {revision, blocksRef: container._blocks, hash});
    return hash;
};
const allTargetHashes = vm => {
    const hashes = {};
    for (const target of vm.runtime.targets) {
        if (!target.isOriginal || !target.blocks) continue;
        hashes[target.id] = targetBlocksHash(target);
    }
    return hashes;
};
const variablesOf = target => {
    const out = {};
    for (const id in target.variables) {
        const v = target.variables[id];
        out[id] = {name: v.name, type: v.type, isCloud: !!v.isCloud};
    }
    return out;
};
const serializeTargetBlocks = (vm, target) => {
    const comments = {};
    for (const id in target.comments) {
        const c = target.comments[id];
        comments[id] = {
            text: c.text,
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            minimized: !!c.minimized,
            blockId: c.blockId
        };
    }
    const stage = vm.runtime.getTargetForStage();
    return {
        targetId: target.id,
        blocks: target.blocks._blocks,
        scripts: target.blocks._scripts,
        comments,
        variables: variablesOf(target),
        globals: stage && stage !== target ? variablesOf(stage) : {}
    };
};
const addMissingVariables = (target, variables) => {
    if (!target || !variables || typeof variables !== 'object') return;
    for (const id in variables) {
        if (target.variables[id]) continue;
        const v = variables[id];
        if (!v || typeof v.name !== 'string') continue;
        try { target.createVariable(id, v.name, typeof v.type === 'string' ? v.type : '', !!v.isCloud); } catch (e) { log.warn('Could not add a variable from a collaborator\'s blocks', e); }
    }
};
const applyTargetBlocks = (vm, state) => {
    const target = state && vm.runtime.getTargetById(state.targetId);
    if (!target || !target.blocks || !state.blocks || typeof state.blocks !== 'object' ||
        !Array.isArray(state.scripts)) return false;
    const blocks = {};
    for (const id in state.blocks) {
        const block = state.blocks[id];
        if (block && typeof block === 'object' && block.id === id && typeof block.opcode === 'string') { blocks[id] = block; }
    }
    addMissingVariables(vm.runtime.getTargetForStage(), state.globals);
    addMissingVariables(target, state.variables);
    const container = target.blocks;
    container._blocks = blocks;
    container._scripts = state.scripts.filter(id => typeof id === 'string' && blocks[id]);
    repairBlockGraph(container);
    container.resetCache();
    const comments = {};
    if (state.comments && typeof state.comments === 'object') {
        for (const id in state.comments) {
            const c = state.comments[id];
            if (!c) continue;
            const comment = new Comment(id, String(c.text || ''), c.x, c.y, c.width, c.height, !!c.minimized);
            comment.blockId = c.blockId && blocks[c.blockId] ? c.blockId : null;
            comments[id] = comment;
        }
    }
    target.comments = comments;
    if (typeof container.emitProjectChanged === 'function') container.emitProjectChanged();
    return true;
};
const installBlockStateResponder = (vm, provider) => provider.addMessageListener(msg => {
    if (msg.type !== 'blocks-state-request' || msg.toTab !== provider.tabId) return;
    const target = vm.runtime.getTargetById(msg.targetId);
    if (!target || !target.blocks) return;
    provider.send('blocks-state', {...serializeTargetBlocks(vm, target), toTab: msg.fromTab, hash: targetBlocksHash(target)});
});
const dimodDragState = {current: null};
let dragSeq = 0;
const MAX_SVG_MARKUP_LENGTH = 200000;
const summarizeBlockText = block => {
    let text = block.type;
    try {
        const parts = [];
        block.inputList.forEach(input => {
            input.fieldRow.forEach(field => {
                const t = field.getText && field.getText();
                if (t) parts.push(t);
            });
        });
        if (parts.length) text = parts.join(' ');
    } catch (e) {
    }
    return text.slice(0, 60);
};
const BBOX_PADDING = 4;
const captureBlockSvg = block => {
    try {
        const svgRoot = block.getSvgRoot();
        if (!svgRoot || typeof svgRoot.getBBox !== 'function') return null;
        const bbox = svgRoot.getBBox();
        if (!(bbox.width > 0) || !(bbox.height > 0)) return null;
        const markup = svgRoot.outerHTML;
        if (!markup || markup.length > MAX_SVG_MARKUP_LENGTH) return null;
        return {
            svg: markup,
            viewBox: {
                x: bbox.x - BBOX_PADDING,
                y: bbox.y - BBOX_PADDING,
                width: bbox.width + (BBOX_PADDING * 2),
                height: bbox.height + (BBOX_PADDING * 2)
            }
        };
    } catch (e) { return null; }
};
const summarizeBlock = (block, position) => {
    const captured = captureBlockSvg(block);
    return {
        dragId: ++dragSeq,
        blockId: block.id,
        colour: block.getColour(),
        text: summarizeBlockText(block),
        svg: captured ? captured.svg : null,
        viewBox: captured ? captured.viewBox : null,
        x: position ? position.x : 0,
        y: position ? position.y : 0
    };
};
const installDragPreviewHook = ScratchBlocks => {
    const proto = ScratchBlocks && ScratchBlocks.BlockDragger && ScratchBlocks.BlockDragger.prototype;
    if (!proto || proto.__dimodDragPreviewPatched) return;
    proto.__dimodDragPreviewPatched = true;
    const originalStart = proto.startBlockDrag;
    proto.startBlockDrag = function (...args) {
        const result = originalStart.apply(this, args);
        try {
            let position = this.startXY_;
            try {
                const delta = this.pixelsToWorkspaceUnits_(args[0]);
                position = {x: this.startXY_.x + delta.x, y: this.startXY_.y + delta.y};
            } catch (e) {
            }
            dimodDragState.current = summarizeBlock(this.draggingBlock_, position);
        } catch (e) { dimodDragState.current = null; }
        window.dispatchEvent(new CustomEvent('dimod:drag-state-changed'));
        return result;
    };
    const originalDrag = proto.dragBlock;
    proto.dragBlock = function (...args) {
        const result = originalDrag.apply(this, args);
        try {
            const delta = this.pixelsToWorkspaceUnits_(args[1]);
            const mouseEvent = args[0];
            const detail = {x: this.startXY_.x + delta.x, y: this.startXY_.y + delta.y};
            if (dimodDragState.current) { dimodDragState.current.x = detail.x; dimodDragState.current.y = detail.y; }
            if (mouseEvent) { detail.clientX = mouseEvent.clientX; detail.clientY = mouseEvent.clientY; }
            if (window.dimodCollab) window.dispatchEvent(new CustomEvent('dimod:drag-position-changed', {detail}));
        } catch (e) {
        }
        return result;
    };
    const originalEnd = proto.endBlockDrag;
    proto.endBlockDrag = function (...args) {
        try { return originalEnd.apply(this, args); } finally { dimodDragState.current = null; window.dispatchEvent(new CustomEvent('dimod:drag-state-changed')); }
    };
};
const SEND_THROTTLE_MS = 80;
const HEARTBEAT_MS = 10000;
const TYPING_MS = 1500;
const STALE_MS = 30000;
const MAX_TEXT = 300;
const sessionId = Date.now().toString(36) + Math.random().toString(36)
    .slice(2, 10);
const scopes = new Map();
const remotes = new Map();
let ScratchBlocks = null;
let local = null;
let sendTimer = null;
let heartbeat = null;
let lastSentAt = 0;
let lastTypedAt = 0;
let shared = false;
let frameId = null;
let attachedCollab = null;
const registerFieldCaretScope = (name, getWorkspace, getTargetId = () => null) => {
    const scope = {getWorkspace, getTargetId};
    scopes.set(name, scope);
    return () => {
        if (scopes.get(name) === scope) scopes.delete(name);
    };
};
const scopeNameFor = workspace => {
    for (const [name, scope] of scopes) {
        if (workspace && scope.getWorkspace() === workspace) return name;
    }
    return null;
};
const blockRef = (block, depth = 0) => {
    const parent = block.getParent();
    if (!block.isShadow() || !parent || depth > 8) return {id: block.id};
    const input = parent.getInputWithBlock(block);
    if (!input) return {id: block.id};
    return {parent: blockRef(parent, depth + 1), input: input.name};
};
const resolveRef = (workspace, ref, depth = 0) => {
    if (!ref || typeof ref !== 'object' || depth > 8) return null;
    if (typeof ref.id === 'string') return workspace.getBlockById(ref.id);
    const parent = resolveRef(workspace, ref.parent, depth + 1);
    const input = parent && typeof ref.input === 'string' && parent.getInput(ref.input);
    return input && input.connection ? input.connection.targetBlock() : null;
};
const sendNow = () => {
    clearTimeout(sendTimer);
    sendTimer = null;
    const collab = window.dimodCollab;
    if (!collab || !local) return;
    const {field, input, scope} = local;
    const block = field.sourceBlock_;
    const registered = scopes.get(scope);
    if (!block || !block.workspace || !registered) return;
    lastSentAt = Date.now();
    const text = String(input.value).slice(0, MAX_TEXT);
    collab.send('field-caret', {
        session: sessionId,
        open: true,
        scope,
        targetId: registered.getTargetId(),
        block: blockRef(block),
        field: field.name,
        text,
        start: Math.min(input.selectionStart || 0, text.length),
        end: Math.min(input.selectionEnd || 0, text.length),
        typing: lastSentAt - lastTypedAt < TYPING_MS
    });
    shared = true;
};
const sendSoon = () => {
    if (sendTimer) return;
    sendTimer = setTimeout(sendNow, Math.max(0, SEND_THROTTLE_MS - (Date.now() - lastSentAt)));
};
const stopLocal = () => {
    if (!local) return;
    const {input, onInput} = local;
    ['input', 'keyup', 'mouseup', 'select'].forEach(type => input.removeEventListener(type, onInput));
    local = null;
    clearTimeout(sendTimer);
    sendTimer = null;
    clearInterval(heartbeat);
    heartbeat = null;
    if (shared && window.dimodCollab) window.dimodCollab.send('field-caret', {session: sessionId, open: false});
    shared = false;
};
const startLocal = field => {
    const block = field.sourceBlock_;
    const scope = block && scopeNameFor(block.workspace);
    const input = ScratchBlocks.FieldTextInput.htmlInput_;
    if (!scope || !input || input.readOnly || typeof field.name !== 'string') return;
    stopLocal();
    const onInput = e => {
        if (e.type === 'input') lastTypedAt = Date.now();
        sendSoon();
    };
    ['input', 'keyup', 'mouseup', 'select'].forEach(type => input.addEventListener(type, onInput));
    local = {field, input, scope, onInput};
    lastTypedAt = 0;
    heartbeat = setInterval(sendNow, HEARTBEAT_MS);
    sendSoon();
};
const removeRemote = key => {
    const entry = remotes.get(key);
    if (!entry) return;
    entry.clip.remove();
    remotes.delete(key);
};
const createRemote = msg => {
    const color = colorForUserId(msg.from);
    const clip = document.createElement('div');
    clip.className = styles.clip;
    const editor = document.createElement('div');
    editor.className = styles.editor;
    editor.style.setProperty('--caret-color', color);
    editor.style.setProperty('--caret-text-color', contrastTextColor(color));
    const flag = document.createElement('div');
    flag.className = styles.flag;
    const name = document.createElement('span');
    name.textContent = typeof msg.fromUsername === 'string' ? msg.fromUsername : 'someone';
    const dots = document.createElement('span');
    dots.className = styles.dots;
    dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    flag.append(name, dots);
    const box = document.createElement('div');
    box.className = styles.box;
    editor.append(flag, box);
    clip.appendChild(editor);
    document.body.appendChild(clip);
    return {clip, editor, box, typingAt: 0, renderedText: null};
};
const renderText = entry => {
    const {text, start, end} = entry;
    const key = `${start}:${end}:${text}`;
    if (entry.renderedText === key) return;
    entry.renderedText = key;
    const [from, to] = start <= end ? [start, end] : [end, start];
    const before = document.createElement('span');
    before.textContent = text.slice(0, from);
    const selected = document.createElement('span');
    selected.className = styles.selection;
    selected.textContent = text.slice(from, to);
    const caret = document.createElement('span');
    caret.className = styles.caret;
    const after = document.createElement('span');
    after.textContent = text.slice(to);
    entry.box.replaceChildren(before, selected, caret, after);
};
const locate = entry => {
    const scope = scopes.get(entry.scope);
    const workspace = scope && scope.getWorkspace();
    if (!workspace || (entry.targetId || null) !== (scope.getTargetId() || null)) return null;
    const svg = workspace.getParentSvg && workspace.getParentSvg();
    const area = svg && svg.getBoundingClientRect();
    if (!area || !area.width || !area.height) return null;
    const block = resolveRef(workspace, entry.block);
    const field = block && block.getField(entry.field);
    const root = field && (block.isShadow() ? block.getSvgRoot() : field.getSvgRoot());
    const rect = root && root.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return {area, rect, scale: workspace.scale || 1, round: block.isShadow()};
};
const frame = () => {
    frameId = null;
    const now = Date.now();
    remotes.forEach((entry, key) => {
        if (now - entry.seenAt > STALE_MS) { removeRemote(key); return; }
        const where = locate(entry);
        if (!where) { entry.clip.style.display = 'none'; return; }
        const {area, rect, scale, round} = where;
        const clip = entry.clip.style;
        clip.display = '';
        clip.left = `${area.left}px`;
        clip.top = `${area.top}px`;
        clip.width = `${area.width}px`;
        clip.height = `${area.height}px`;
        entry.editor.style.transform = `translate(${rect.left - area.left}px, ${rect.top - area.top}px)`;
        const box = entry.box.style;
        box.minWidth = `${rect.width}px`;
        box.height = `${rect.height}px`;
        box.borderRadius = round ? `${rect.height / 2}px` : `${4 * scale}px`;
        box.fontSize = `${(ScratchBlocks.BlockSvg.FIELD_TEXTINPUT_FONTSIZE_FINAL || 12) * scale}pt`;
        renderText(entry);
        entry.editor.classList.toggle(styles.typing, now - entry.typingAt < TYPING_MS);
    });
    if (remotes.size) frameId = requestAnimationFrame(frame);
};
const handleMessage = msg => {
    if (msg.type === 'joined' || msg.type === 'presence') {
        if (local) sendSoon();
        if (msg.type === 'presence' && Array.isArray(msg.users)) {
            const here = new Set(msg.users.map(u => u && u.userId));
            [...remotes.keys()].forEach(key => {
                if (!here.has(key.slice(0, key.lastIndexOf(':')))) removeRemote(key);
            });
        }
        return;
    }
    if (msg.type !== 'field-caret' || !msg.from || typeof msg.session !== 'string') return;
    const key = `${msg.from}:${msg.session}`;
    if (!msg.open) { removeRemote(key); return; }
    if (typeof msg.scope !== 'string' || typeof msg.field !== 'string' || typeof msg.text !== 'string' ||
        !msg.block || typeof msg.block !== 'object') return;
    let entry = remotes.get(key);
    if (!entry) { entry = createRemote(msg); remotes.set(key, entry); }
    const text = msg.text.slice(0, MAX_TEXT);
    const clampIndex = n => (Number.isInteger(n) ? Math.max(0, Math.min(text.length, n)) : text.length);
    Object.assign(entry, {
        scope: msg.scope,
        targetId: typeof msg.targetId === 'string' ? msg.targetId : null,
        block: msg.block,
        field: msg.field,
        text,
        start: clampIndex(msg.start),
        end: clampIndex(msg.end),
        seenAt: Date.now()
    });
    if (msg.typing) entry.typingAt = entry.seenAt;
    if (!frameId) frameId = requestAnimationFrame(frame);
};
const attachCollab = () => {
    const collab = window.dimodCollab;
    if (!collab || collab === attachedCollab) return;
    attachedCollab = collab;
    collab.addMessageListener(handleMessage);
};
const installFieldCarets = Blocks => {
    if (!Blocks || !Blocks.FieldTextInput || Blocks.__dimodFieldCarets) return;
    Blocks.__dimodFieldCarets = true;
    ScratchBlocks = Blocks;
    const proto = Blocks.FieldTextInput.prototype;
    const originalShow = proto.showEditor_;
    proto.showEditor_ = function (...args) {
        const result = originalShow.apply(this, args);
        try { startLocal(this); } catch (e) {
        }
        return result;
    };
    const originalDispose = proto.widgetDispose_;
    proto.widgetDispose_ = function (...args) {
        const dispose = originalDispose.apply(this, args);
        const field = this;
        return function (...closeArgs) {
            if (local && local.field === field) stopLocal();
            return dispose.apply(this, closeArgs);
        };
    };
    attachCollab();
    window.addEventListener('dimod:collab-ready', attachCollab);
};
const gestureWorkspaces = workspace => {
    const list = [workspace];
    const flyout = workspace.getFlyout && workspace.getFlyout();
    const flyoutWorkspace = flyout && flyout.getWorkspace && flyout.getWorkspace();
    if (flyoutWorkspace) list.push(flyoutWorkspace);
    return list;
};
const hasActiveGesture = workspace => {
    if (!workspace) return false;
    return gestureWorkspaces(workspace).some(ws => !!ws.currentGesture_);
};
const abandonGesture = (ScratchBlocks, workspace) => {
    if (!hasActiveGesture(workspace)) return;
    ScratchBlocks.Events.disable();
    try {
        for (const ws of gestureWorkspaces(workspace)) {
            const gesture = ws.currentGesture_;
            if (!gesture) continue;
            try { gesture.cancel(); } catch (e) {
                try { gesture.dispose(); } catch (err) { ws.currentGesture_ = null; }
            }
        }
    } finally { ScratchBlocks.Events.enable(); }
};
const unbindEvent = wrapper => {
    for (const [node, name, fn] of wrapper) node.removeEventListener(name, fn);
};
const forceDispose = gesture => {
    try { gesture.dispose(); } catch (e) {
        for (const key of ['onMoveWrapper_', 'onUpWrapper_']) {
            try {
                if (gesture[key]) unbindEvent(gesture[key]);
            } catch (err) {}
            gesture[key] = null;
        }
    }
    const ws = gesture.creatorWorkspace_;
    if (ws && ws.currentGesture_ === gesture) ws.currentGesture_ = null;
};
const installGestureRecovery = ScratchBlocks => {
    const Gesture = ScratchBlocks && ScratchBlocks.Gesture;
    const WorkspaceSvg = ScratchBlocks && ScratchBlocks.WorkspaceSvg;
    if (!Gesture || !WorkspaceSvg || Gesture.prototype.__dimodRecovery) return;
    Gesture.prototype.__dimodRecovery = true;
    for (const name of ['handleUp', 'cancel']) {
        const original = Gesture.prototype[name];
        Gesture.prototype[name] = function (...args) {
            try { return original.apply(this, args); } catch (e) {
                log.warn(`dimod: gesture ${name} threw, cleaning up so dragging keeps working`, e);
                forceDispose(this);
            }
        };
    }
    const originalGetGesture = WorkspaceSvg.prototype.getGesture;
    WorkspaceSvg.prototype.getGesture = function (e) {
        const current = this.currentGesture_;
        if (current && current.isEnding_) forceDispose(current);
        return originalGetGesture.call(this, e);
    };
};
const targetStamps = new Map();
const broadcastTargetCreate = (vm, targetId = vm.editingTarget && vm.editingTarget.id) => {
    const target = window.dimodCollab && targetId && vm.runtime.getTargetById(targetId);
    if (!target) return;
    const stamp = newStamp();
    targetStamps.set(targetId, stamp);
    const name = target.getName();
    const list = originals(vm);
    const prev = list[list.indexOf(target) - 1];
    const after = prev ? prev.id : null;
    vm.exportSprite(targetId, 'base64').then(base64 => {
        if (!window.dimodCollab) return;
        window.dimodCollab.sendTargetCreate({targetId, sprite: base64, name, stamp, after});
    });
};
const base64ToArrayBuffer = base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
};
const patchFor = (obj, key, make) => {
    const own = Object.prototype.hasOwnProperty.call(obj, key);
    const orig = obj[key];
    obj[key] = make(orig);
    return () => {
        if (own) obj[key] = orig;
        else delete obj[key];
    };
};
const applyRemoteTargetCreate = (vm, payload) => queued(() => {
    if (vm.runtime.getTargetById(payload.targetId)) return;
    const previous = vm.editingTarget;
    const runtime = vm.runtime;
    let hold = false;
    let held = false;
    vm.dimodRemoteTargetCreates = (vm.dimodRemoteTargetCreates || 0) + 1;
    const unAdd = patchFor(runtime, 'addTarget', orig => function (...a) {
        if (!hold) {
            hold = true;
            Promise.resolve().then(() => { hold = false; });
        }
        return orig.apply(this, a);
    });
    const unEmit = patchFor(vm, 'emitWorkspaceUpdate', orig => function (...a) {
        if (hold && previous && vm.editingTarget && vm.editingTarget.id === payload.targetId) {
            held = true;
            return;
        }
        return orig.apply(this, a);
    });
    const done = () => {
        vm.dimodRemoteTargetCreates -= 1;
        unAdd();
        unEmit();
    };
    return vm.addSprite(base64ToArrayBuffer(payload.sprite)).then(() => {
        done();
        const mine = runtime.getTargetById(payload.targetId);
        const s = seeStamp(payload.stamp);
        if (s) targetStamps.set(payload.targetId, s);
        const clash = mine && typeof payload.name === 'string' && mine.getName() !== payload.name &&
            originals(vm).find(t => t !== mine && t.getName() === payload.name);
        if (mine && typeof payload.after === 'string') {
            const arr = runtime.targets.filter(t => t !== mine);
            let pos = arr.findIndex(t => t.id === payload.after);
            if (pos !== -1) {
                pos++;
                while (pos < arr.length && later(targetStamps.get(arr[pos].id), s)) pos++;
                if (pos < arr.length) {
                    arr.splice(pos, 0, mine);
                    runtime.targets = arr;
                    vm.emitTargetsUpdate(false);
                }
            }
        }
        if (clash && later(s, targetStamps.get(clash.id))) {
            remotely(() => {
                const theirs = mine.getName();
                vm.renameSprite(clash.id, `${theirs}-swap`);
                vm.renameSprite(mine.id, payload.name);
                vm.renameSprite(clash.id, theirs);
            });
        }
        const onNew = vm.editingTarget && vm.editingTarget.id === payload.targetId;
        if (onNew && previous && runtime.getTargetById(previous.id)) {
            if (held) {
                vm.editingTarget = previous;
                runtime.setEditingTarget(previous);
                vm.emitTargetsUpdate(false);
            } else { vm.setEditingTarget(previous.id); }
        } else if (held) { vm.emitWorkspaceUpdate(); }
    }, err => { done(); throw err; });
});
const broadcastTargetRename = (vm, targetId, newName) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendTargetRename({targetId, name: newName});
};
const applyRemoteTargetRename = (vm, payload) => queued(() => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target || target.getName() === payload.name) return;
    vm.renameSprite(payload.targetId, payload.name);
});
const broadcastTargetDelete = targetId => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendTargetDelete({targetId});
};
const applyRemoteTargetDelete = (vm, payload) => queued(() => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target || !target.isSprite()) return;
    vm.deleteSprite(payload.targetId);
});
const broadcastTargetReorder = (index, newIndex, targetId, order) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendTargetReorder({index, newIndex, targetId, order});
};
const applyRemoteTargetReorder = (vm, payload) => queued(() => {
    if (Array.isArray(payload.order) && payload.order.length < 5000) {
        const rank = new Map(payload.order.map((id, i) => [id, i]));
        const ranked = vm.runtime.targets.filter(t => rank.has(t.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
        let k = 0;
        vm.runtime.targets = vm.runtime.targets.map(t => (rank.has(t.id) ? ranked[k++] : t));
        vm.emitTargetsUpdate();
        return;
    }
    let index = payload.index;
    if (payload.targetId) {
        index = vm.runtime.targets.findIndex(t => t.id === payload.targetId);
        if (index === -1) return;
    }
    if (!Number.isInteger(payload.newIndex)) return;
    const stageFirst = vm.runtime.targets[0] && vm.runtime.targets[0].isStage ? 1 : 0;
    vm.runtime.targets = moveItem(vm.runtime.targets, index, Math.max(stageFirst, payload.newIndex));
    vm.emitTargetsUpdate();
});
const shareBlocksToTargetWithSync = (vm, blocks, targetId, optFromTargetId) => {
    const target = vm.runtime.getTargetById(targetId);
    blocks.forEach(b => {
        if (!b.topLevel) return;
        if (Number.isFinite(b.x)) b.x = Math.round(b.x);
        if (Number.isFinite(b.y)) b.y = Math.round(b.y);
    });
    const beforeIds = target ? new Set(Object.keys(target.blocks._blocks)) : null;
    return vm.shareBlocksToTarget(blocks, targetId, optFromTargetId).then(() => {
        if (!target || !beforeIds || !window.dimodCollab) return;
        const addedBlocks = Object.keys(target.blocks._blocks)
            .filter(id => !beforeIds.has(id))
            .map(id => target.blocks.getBlock(id));
        if (!addedBlocks.length) return;
        window.dimodCollab.sendBlocksShared({targetId, blocks: addedBlocks});
    });
};
const applyRemoteBlocksShared = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target || !Array.isArray(payload.blocks)) return;
    let added = false;
    payload.blocks.forEach(block => {
        if (target.blocks.getBlock(block.id)) return;
        try { target.blocks.createBlock(block); added = true; } catch (e) { log.warn('Failed to apply remote shared block', e); }
    });
    if (!added) return;
    target.blocks.updateTargetSpecificBlocks(target.isStage);
    if (vm.editingTarget && vm.editingTarget.id === target.id) {
        vm.refreshWorkspace();
        payload.blocks.filter(b => b.topLevel).forEach(b => {
            vm.runtime.glowBlock(b.id, true);
            setTimeout(() => {
                if (target.blocks.getBlock(b.id)) vm.runtime.glowBlock(b.id, false);
            }, 1500);
        });
    }
};
const sentAssets = new WeakSet();
const sentTargets = new Set();
const seenTargets = new Set();
let opDepth = 0;
const isQuiet = vm => syncRemote > 0 || !!(vm.runtime.sequencer && vm.runtime.sequencer.activeThread);
const originals = vm => vm.runtime.targets.filter(t => t.isOriginal);
const snapAll = vm => new Map(originals(vm).map(t => [t.id, {name: t.getName(), seen: seenTargets.has(t.id), c: t.getCostumes().slice(),
    s: t.sprite.sounds.slice(), cn: t.getCostumes().map(x => x.name), sn: t.sprite.sounds.map(x => x.name)}]));
const ASSET_SENDERS = {
    costume: [broadcastCostumeAdd, broadcastCostumeDelete, broadcastCostumeRename, broadcastCostumeOrder],
    sound: [broadcastSoundAdd, broadcastSoundDelete, broadcastSoundRename, broadcastSoundOrder]
};
const diffList = (vm, id, kind, was, names, now, quiet) => {
    const [add, del, ren, order] = ASSET_SENDERS[kind];
    now.forEach((o, i) => {
        if (was.includes(o) || sentAssets.has(o)) return;
        sentAssets.add(o);
        goneAssets.delete(o);
        sentNames.set(o, o.name);
        if (!quiet) add(vm, id, i);
    });
    was.forEach((o, i) => {
        if (!now.includes(o)) {
            sentAssets.delete(o);
            if (!quiet && !goneAssets.has(o)) del(vm, id, i, names[i], o);
            goneAssets.add(o);
        } else if (o.name !== names[i] && sentNames.get(o) !== o.name) {
            if (quiet) sentNames.set(o, o.name);
            else ren(vm, id, i, names[i], o.name, o);
        }
    });
    if (quiet) return;
    const a = was.filter(o => now.includes(o));
    const b = now.filter(o => was.includes(o));
    if (a.some((o, i) => o !== b[i])) order(vm, id);
};
const afterOp = (vm, before, quiet) => {
    originals(vm).forEach(t => {
        const w = before.get(t.id);
        if (!w) {
            if (sentTargets.has(t.id)) return;
            sentTargets.add(t.id);
            t.getCostumes().forEach(o => sentAssets.add(o));
            t.sprite.sounds.forEach(o => sentAssets.add(o));
            if (!quiet) broadcastTargetCreate(vm, t.id);
            return;
        }
        if (!quiet && w.seen && t.getName() !== w.name) broadcastTargetRename(vm, t.id, t.getName());
        diffList(vm, t.id, 'costume', w.c, w.cn, t.getCostumes(), quiet);
        diffList(vm, t.id, 'sound', w.s, w.sn, t.sprite.sounds, quiet);
    });
    before.forEach((w, id) => {
        if (vm.runtime.getTargetById(id)) return;
        sentTargets.delete(id);
        seenTargets.delete(id);
        if (!quiet) broadcastTargetDelete(id);
    });
    originals(vm).forEach(t => seenTargets.add(t.id));
};
const track = (vm, fn) => {
    if (opDepth || vm.__dimodProjectFullyLoaded === false) return fn();
    const quiet = isQuiet(vm);
    const before = snapAll(vm);
    opDepth++;
    let r;
    try { r = fn(); } finally { opDepth--; }
    const done = () => afterOp(vm, before, quiet);
    if (r && typeof r.then === 'function') {
        r.then(done, done);
        return r;
    }
    done();
    if (typeof r === 'function') return (...a) => track(vm, () => r(...a));
    return r;
};
const TRACKED_OPS = ['addSprite', 'duplicateSprite', 'deleteSprite', 'renameSprite', 'addCostume', 'addBackdrop',
    'duplicateCostume', 'deleteCostume', 'renameCostume', 'reorderCostume', 'shareCostumeToTarget', 'addSound',
    'duplicateSound', 'deleteSound', 'renameSound', 'reorderSound', 'shareSoundToTarget'];
const installCollabHooks = vm => {
    if (vm.dimodCollabHooks) return;
    vm.dimodCollabHooks = true;
    vm.dimodNoSync = remotely;
    const seed = () => originals(vm).forEach(t => {
        seenTargets.add(t.id);
        tagAssets(t);
    });
    seed();
    vm.runtime.on('PROJECT_LOADED', seed);
    vm.on('targetsUpdate', seed);
    const late = name => {
        const own = Object.prototype.hasOwnProperty.call(vm, name) ? vm[name] : null;
        return (...args) => (own || Object.getPrototypeOf(vm)[name]).apply(vm, args);
    };
    TRACKED_OPS.forEach(name => {
        const orig = late(name);
        vm[name] = (...args) => track(vm, () => orig(...args));
    });
    const reorderTarget = late('reorderTarget');
    vm.reorderTarget = (index, newIndex) => {
        const moved = vm.runtime.targets[index];
        const r = reorderTarget(index, newIndex);
        if (r && moved && !isQuiet(vm)) broadcastTargetReorder(index, newIndex, moved.id, vm.runtime.targets.map(t => t.id));
        return r;
    };
    const updateSvg = late('updateSvg');
    vm.updateSvg = (i, svg, x, y) => {
        const r = updateSvg(i, svg, x, y);
        if (!isQuiet(vm)) broadcastCostumeUpdate(vm, i, true, svg, x, y);
        return r;
    };
    const updateBitmap = late('updateBitmap');
    vm.updateBitmap = (i, bmp, x, y, res) => {
        const r = updateBitmap(i, bmp, x, y, res);
        if (!isQuiet(vm)) broadcastCostumeUpdate(vm, i, false, bmp, x, y);
        return r;
    };
    const fm = vm.runtime.fontManager;
    if (fm) {
        let loading = 0;
        const deserialize = fm.deserialize.bind(fm);
        fm.deserialize = (...a) => {
            loading++;
            return Promise.resolve(deserialize(...a)).finally(() => { loading--; });
        };
        const fontQuiet = () => loading > 0 || isQuiet(vm) || !window.dimodCollab;
        const addSystemFont = fm.addSystemFont.bind(fm);
        fm.addSystemFont = (family, fallback) => {
            const r = addSystemFont(family, fallback);
            if (!fontQuiet()) window.dimodCollab.sendAssetUpdate({kind: 'font-add', system: true, family, fallback});
            return r;
        };
        const addCustomFont = fm.addCustomFont.bind(fm);
        fm.addCustomFont = (family, fallback, asset) => {
            const r = addCustomFont(family, fallback, asset);
            if (!fontQuiet()) {
                window.dimodCollab.sendAssetUpdate({kind: 'font-add', system: false, family, fallback,
                    dataFormat: asset.dataFormat, data: uint8ToBase64(asset.data)});
            }
            return r;
        };
        const deleteFont = fm.deleteFont.bind(fm);
        fm.deleteFont = index => {
            const font = fm.fonts[index];
            const r = deleteFont(index);
            if (font && !fontQuiet()) window.dimodCollab.sendAssetUpdate({kind: 'font-delete', family: font.family});
            return r;
        };
    }
    const updateSoundBuffer = late('updateSoundBuffer');
    vm.updateSoundBuffer = (i, buf, enc) => {
        const r = updateSoundBuffer(i, buf, enc);
        if (enc && !isQuiet(vm)) broadcastSoundUpdate(vm, i, enc);
        return r;
    };
};
const FIELD_RE = /<field[^>]*\bname="(?:VARIABLE|LIST|BROADCAST_INPUT|BROADCAST_OPTION)"[^>]*>/gi;
const attr = (tagText, name) => { const m = tagText.match(new RegExp(`\\b${name}="([^"]*)"`, 'i')); return m ? m[1] : null; };
const ensureOnWorkspace = (workspace, varId, name, type, isCloud) => {
    if (!varId || workspace.getVariableById(varId)) return true;
    if (!name) return false;
    try { workspace.createVariable(name, type || '', varId, false, Boolean(isCloud)); return true; } catch (e) { log.warn('Could not recreate a remote collaborator\'s variable on this workspace', e); return false; }
};
const variableFromVM = (vm, target, varId) => {
    const stage = vm && vm.runtime && vm.runtime.getTargetForStage();
    if (target && target.variables && target.variables[varId]) return target.variables[varId];
    if (stage && stage.variables && stage.variables[varId]) return stage.variables[varId];
    return null;
};
const ensureEventVariables = (eventJson, workspace, vm, target) => {
    if (!eventJson || !workspace) return true;
    if (eventJson.type === 'create' && typeof eventJson.xml === 'string') {
        const tags = eventJson.xml.match(FIELD_RE) || [];
        for (const tag of tags) {
            const id = attr(tag, 'id');
            if (!id || workspace.getVariableById(id)) continue;
            const vmVar = variableFromVM(vm, target, id);
            const after = eventJson.xml.slice(eventJson.xml.indexOf(tag) + tag.length);
            const nameFromXml = after.slice(0, after.indexOf('<'));
            ensureOnWorkspace(
                workspace, id,
                nameFromXml || (vmVar && vmVar.name),
                attr(tag, 'variabletype') || (vmVar && vmVar.type) || '',
                vmVar && vmVar.isCloud
            );
        }
        return true;
    }
    if (eventJson.type === 'change' && eventJson.element === 'field') {
        const value = eventJson.newValue;
        if (typeof value !== 'string' || !value) return true;
        const block = workspace.getBlockById(eventJson.blockId);
        const field = block && eventJson.name && block.getField(eventJson.name);
        if (!field || typeof field.getVariable !== 'function') return true;
        if (workspace.getVariableById(value)) return true;
        const vmVar = variableFromVM(vm, target, value);
        if (vmVar && ensureOnWorkspace(workspace, value, vmVar.name, vmVar.type, vmVar.isCloud)) return true;
        log.warn(
            `Dropping a remote change to an unknown variable (${value}) rather than blanking the field ` +
            '- see lib/dimod-collab-variable-repair.js'
        );
        return false;
    }
    return true;
};
const POSITION_TOLERANCE = 0.5;
const ownConnectionOf = block => (block && (block.outputConnection || block.previousConnection)) || null;
const targetConnectionOf = (ScratchBlocks, block, parent, inputName) => {
    const own = ownConnectionOf(block);
    if (!own || !parent) return null;
    if (inputName) { const input = parent.getInput(inputName); return (input && input.connection) || null; }
    if (own.type === ScratchBlocks.PREVIOUS_STATEMENT) return parent.nextConnection || null;
    return null;
};
const whyNotConnectable = (ScratchBlocks, own, target) => {
    if (!own) return 'the block has no connection of its own';
    if (!target) return 'that input does not exist here';
    if (typeof own.canConnectWithReason_ !== 'function') return null;
    let reason;
    try { reason = own.canConnectWithReason_(target); } catch (e) { return `the connection check itself threw (${(e && e.message) || e})`; }
    if (reason === ScratchBlocks.Connection.CAN_CONNECT) return null;
    return `connection refused (reason ${reason})`;
};
const isAskew = connection => {
    const target = connection && connection.targetConnection;
    if (!target || typeof connection.x_ !== 'number' || typeof target.x_ !== 'number') return false;
    return Math.abs(connection.x_ - target.x_) > POSITION_TOLERANCE ||
        Math.abs(connection.y_ - target.y_) > POSITION_TOLERANCE;
};
const seat = block => {
    const own = ownConnectionOf(block);
    if (!isAskew(own) || typeof own.targetConnection.tighten_ !== 'function') return false;
    try { own.targetConnection.tighten_(); return true; } catch (e) { log.warn('dimod: could not seat a block on its connection', e); return false; }
};
const snapshot = block => {
    const own = ownConnectionOf(block);
    const previousTarget = (own && own.targetConnection) || null;
    const xy = block.getRelativeToSurfaceXY();
    return () => {
        try {
            if (block.getParent()) block.unplug(false);
            const connection = ownConnectionOf(block);
            const slotStillFree = previousTarget && !previousTarget.targetConnection &&
                previousTarget.sourceBlock_ && previousTarget.sourceBlock_.workspace;
            if (connection && slotStillFree) { connection.connect(previousTarget); return; }
            const now = block.getRelativeToSurfaceXY();
            if (!block.getParent()) block.moveBy(xy.x - now.x, xy.y - now.y);
        } catch (e) { log.warn('dimod: could not put a block back after a failed move', e); }
    };
};
const repairAskewBlocks = workspace => {
    if (!workspace || typeof workspace.getAllBlocks !== 'function') return 0;
    if (hasActiveGesture(workspace)) return 0;
    let blocks;
    try { blocks = workspace.getAllBlocks(); } catch (e) { return 0; }
    const roots = new Set();
    for (const block of blocks) {
        if (block.rendered && isAskew(ownConnectionOf(block))) roots.add(block.getRootBlock());
    }
    if (!roots.size) return 0;
    for (const root of roots) {
        try {
            if (root.rendered && root.render) root.render(false);
        } catch (e) { log.warn('dimod: could not re-render a block stack', e); }
    }
    let repaired = 0;
    for (const block of blocks) {
        if (block.rendered && seat(block)) repaired += 1;
    }
    if (repaired) log.warn(`dimod: put ${repaired} askew block(s) back on their connections`);
    return repaired;
};
const installConnectSafetyRails = ScratchBlocks => {
    const Move = ScratchBlocks && ScratchBlocks.Events && ScratchBlocks.Events.Move;
    if (!Move || !Move.prototype || Move.prototype.__dimodSafeRun) return;
    const originalRun = Move.prototype.run;
    if (typeof originalRun !== 'function') return;
    Move.prototype.run = function (forward) {
        const workspace = typeof this.getEventWorkspace_ === 'function' ? this.getEventWorkspace_() : null;
        const block = workspace && this.blockId ? workspace.getBlockById(this.blockId) : null;
        const coordinate = forward ? this.newCoordinate : this.oldCoordinate;
        const parentId = forward ? this.newParentId : this.oldParentId;
        const inputName = forward ? this.newInputName : this.oldInputName;
        if (!block || coordinate) return originalRun.call(this, forward);
        if (!parentId) {
            log.warn(`dimod: dropping a block move with neither a parent nor a position (${this.blockId})`);
            return;
        }
        const parent = workspace.getBlockById(parentId);
        if (!parent) return originalRun.call(this, forward);
        const slot = inputName || 'the slot under it';
        for (let b = parent; b; b = b.getParent()) {
            if (b === block) { log.warn(`dimod: not moving ${block.type} into its own descendant ${parent.type}`); return; }
        }
        const own = ownConnectionOf(block);
        const target = targetConnectionOf(ScratchBlocks, block, parent, inputName);
        const refusal = whyNotConnectable(ScratchBlocks, own, target);
        if (refusal) { log.warn(`dimod: not moving ${block.type} into ${parent.type}'s ${slot} - ${refusal}`); return; }
        const restore = snapshot(block);
        try { originalRun.call(this, forward); } catch (e) {
            log.warn(`dimod: moving ${block.type} into ${parent.type}'s ${slot} threw, putting it back`, e);
            restore();
            return;
        }
        if (block.getParent() !== parent) {
            log.warn(`dimod: ${block.type} did not end up in ${parent.type}'s ${slot}, putting it back`);
            restore();
            return;
        }
        seat(block);
    };
    Move.prototype.__dimodSafeRun = true;
};
const bytesHash = b => {
    let h = 2166136261;
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
    return `${(h >>> 0).toString(36)}.${b.length}`;
};
const SA_ID = /^[\w-]{1,64}$/;
const okScene = s => s && typeof s.id === 'string' && SA_ID.test(s.id) && typeof s.name === 'string' && s.name.length > 0 && s.name.length < 200;
const okMeta = x => x && typeof x.id === 'string' && SA_ID.test(x.id) && typeof x.name === 'string' && x.name.length > 0 &&
    x.name.length < 256 && typeof x.ext === 'string' && /^[a-z0-9]{1,10}$/.test(x.ext);
const cleanMember = m => (m === '*' ? '*' : Array.isArray(m) ? m.filter(x => typeof x === 'string' && SA_ID.test(x)).slice(0, 500) : null);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const moved = (now, was) => {
    const keep = list => { const ids = new Set(list.map(x => x.id)); return o => ids.has(o.id); };
    return now.filter(keep(was)).map(x => x.id).join() !== was.filter(keep(now)).map(x => x.id).join();
};
const nonEmpty = p => Object.keys(p).some(k => k !== 'req');
let scenesCollab = null;
class ScenesAssetsCollab {
    constructor (vm) {
        this.vm = vm;
        this.scenes = vm.dimodScenes;
        this.assets = vm.dimodAssets;
        this.quiet = 0;
        this.edited = false;
        this.atimer = 0;
        this.attached = null;
        this.off = null;
        this.req = null;
        this.answered = new Set();
        this.waiting = new Map();
        this.sbase = this.ssnap();
        this.abase = this.asnap();
        const hush = (obj, name) => {
            const fn = obj[name].bind(obj);
            obj[name] = (...args) => {
                this.quiet++;
                const done = () => { this.quiet--; this.rebase(); this.edited = false; };
                let r;
                try { r = fn(...args); } catch (e) { done(); throw e; }
                if (r && r.then) return r.finally(done);
                done();
                return r;
            };
        };
        hush(this.scenes, 'load');
        hush(this.assets, 'loadFrom');
        vm.runtime.on('DIMOD_SCENES', () => this.onScenes());
        vm.runtime.on('DIMOD_ASSETS', () => this.onAssets());
        let key = '';
        vm.on('targetsUpdate', () => {
            const k = vm.runtime.targets.filter(t => t.isOriginal).map(t => `${t.id}:${t.getName()}`).join('|');
            if (k === key) return;
            key = k;
            if (this.waiting.size) this.applyScenes({members: {}});
            this.onScenes();
        });
        this.here = new Map();
        this.sentScene = null;
        this.sentAt = 0;
        vm.runtime.on('DIMOD_SCENES', () => this.sendScene());
        this.attach();
        setInterval(() => { this.attach(); this.sendScene(); this.pruneHere(); }, 2000);
    }
    sendScene (force) {
        const c = window.dimodCollab;
        const cur = this.scenes.current;
        if (!c || !c.joined || !cur) return;
        if (!force && cur === this.sentScene && Date.now() - this.sentAt < 6000) return;
        this.sentScene = cur;
        this.sentAt = Date.now();
        c.send('viewing', {sceneOnly: true, scene: cur});
    }
    pruneHere () {
        const now = Date.now();
        let gone = false;
        for (const [k, v] of this.here) if (now - v.at > 15000) { this.here.delete(k); gone = true; }
        if (gone) this.vm.runtime.emit('DIMOD_SCENE_PRESENCE');
    }
    onHere (msg) {
        if (!msg.from || typeof msg.scene !== 'string') return;
        const old = this.here.get(msg.from);
        this.here.set(msg.from, {scene: msg.scene, name: msg.fromUsername || '?', at: Date.now()});
        if (!old || old.scene !== msg.scene) this.vm.runtime.emit('DIMOD_SCENE_PRESENCE');
    }
    usersIn (scene) {
        return [...this.here].filter(([, v]) => v.scene === scene).map(([id, v]) => ({id, name: v.name, color: colorForUserId(id)}));
    }
    send (type, data) { const c = window.dimodCollab; if (c) c.send(type, data); }
    attach () {
        const c = window.dimodCollab;
        if (!c || c === this.attached) return;
        if (this.off) this.off();
        this.attached = c;
        this.off = c.addMessageListener(msg => this.onMessage(msg));
        if (c.joined) this.ask();
    }
    ask () {
        this.req = Math.random().toString(36).slice(2);
        const have = {};
        for (const a of this.assets.list) have[a.id] = bytesHash(this.assets.bytes(a));
        this.send('scene-state-request', {req: this.req, have});
    }
    rebase () { this.sbase = this.ssnap(); this.abase = this.asnap(); }
    busy () { return this.quiet > 0 || !!this.vm.runtime.sequencer.activeThread || this.vm.dimodRemoteTargetCreates > 0; }
    ssnap () {
        const members = {};
        for (const t of this.vm.runtime.targets) if (t.isOriginal && !t.isStage) members[t.getName()] = t.extensionStorage.dimodScenes;
        return {list: this.scenes.list.map(s => ({id: s.id, name: s.name, backdrop: s.backdrop || ''})), main: this.scenes.main,
            members: JSON.parse(JSON.stringify(members))};
    }
    asnap () {
        const a = this.assets;
        return {list: a.list.map(x => ({id: x.id, name: x.name, ext: x.ext, kind: x.kind})), data: new Map(a.list.map(x => [x.id, a.data.get(x.id)]))};
    }
    onScenes () {
        if (this.busy()) { if (!this.quiet) this.sbase = this.ssnap(); return; }
        const now = this.ssnap();
        const was = this.sbase;
        const p = {};
        const old = new Map(was.list.map(s => [s.id, s]));
        const ids = new Set(now.list.map(s => s.id));
        const add = now.list.filter(s => !old.has(s.id));
        const del = was.list.filter(s => !ids.has(s.id)).map(s => s.id);
        const set = {};
        for (const s of now.list) {
            const o = old.get(s.id);
            if (o && (o.name !== s.name || o.backdrop !== s.backdrop)) set[s.id] = {name: s.name, backdrop: s.backdrop};
        }
        if (add.length) p.add = add;
        if (del.length) p.del = del;
        if (Object.keys(set).length) p.set = set;
        if (moved(now.list, was.list)) p.order = now.list.map(s => s.id);
        if (now.main !== was.main) p.main = now.main;
        const members = {};
        for (const n of Object.keys(now.members)) if (!same(now.members[n], was.members[n])) members[n] = now.members[n];
        if (Object.keys(members).length) p.members = members;
        this.sbase = now;
        if (nonEmpty(p)) { this.edited = true; this.send('scene-patch', p); }
    }
    onAssets () {
        if (this.quiet) return;
        if (this.vm.runtime.sequencer.activeThread && !this.atimer) { this.abase = this.asnap(); return; }
        this.edited = true;
        clearTimeout(this.atimer);
        this.atimer = setTimeout(() => this.flushAssets(), 120);
    }
    flushAssets () {
        clearTimeout(this.atimer);
        this.atimer = 0;
        const a = this.assets;
        const now = this.asnap();
        const was = this.abase;
        const p = {};
        const old = new Map(was.list.map(x => [x.id, x]));
        const ids = new Set(now.list.map(x => x.id));
        const add = now.list.filter(x => !old.has(x.id)).map(x => ({...x, data: uint8ToBase64(a.data.get(x.id) || new Uint8Array(0))}));
        const del = was.list.filter(x => !ids.has(x.id)).map(x => x.id);
        const set = {};
        const data = {};
        for (const x of now.list) {
            const o = old.get(x.id);
            if (!o) continue;
            if (o.name !== x.name || o.ext !== x.ext || o.kind !== x.kind) set[x.id] = {name: x.name, ext: x.ext, kind: x.kind};
            if (now.data.get(x.id) !== was.data.get(x.id)) data[x.id] = uint8ToBase64(now.data.get(x.id) || new Uint8Array(0));
        }
        if (add.length) p.add = add;
        if (del.length) p.del = del;
        if (Object.keys(set).length) p.set = set;
        if (Object.keys(data).length) p.data = data;
        if (moved(now.list, was.list)) p.order = now.list.map(x => x.id);
        this.abase = now;
        if (nonEmpty(p)) this.send('dasset-patch', p);
    }
    applyScenes (p) {
        const h = this.scenes;
        const rt = this.vm.runtime;
        const find = id => h.list.find(s => s.id === id);
        this.quiet++;
        try {
            for (const s of (Array.isArray(p.add) ? p.add : []).filter(okScene)) {
                if (find(s.id)) continue;
                h.list.push({id: s.id, name: s.name, backdrop: typeof s.backdrop === 'string' ? s.backdrop : ''});
                const clash = h.list.find(x => x.id !== s.id && x.name.toLowerCase() === s.name.toLowerCase());
                if (clash) h.rename(clash.id > s.id ? clash.id : s.id, s.name);
            }
            for (const id of Array.isArray(p.del) ? p.del : []) if (find(id)) h.remove(id);
            const set = p.set && typeof p.set === 'object' ? p.set : {};
            for (const id of Object.keys(set)) {
                const s = find(id);
                const v = set[id];
                if (!s || !v) continue;
                if (typeof v.name === 'string' && v.name && v.name !== s.name) h.rename(id, v.name);
                if (typeof v.backdrop === 'string' && v.backdrop !== s.backdrop) {
                    s.backdrop = v.backdrop;
                    if (id === h.current) h.applyBackdrop();
                }
            }
            if (Array.isArray(p.order)) {
                const at = id => { const i = p.order.indexOf(id); return i < 0 ? 1e9 : i; };
                h.list.sort((x, y) => at(x.id) - at(y.id));
            }
            if (typeof p.main === 'string' && find(p.main)) h.main = p.main;
            const members = p.members && typeof p.members === 'object' ? p.members : {};
            for (const n of Object.keys(members)) this.waiting.set(n, members[n]);
            for (const [n, m] of this.waiting) {
                const t = rt.getSpriteTargetByName(n);
                if (!t) continue;
                this.waiting.delete(n);
                const v = cleanMember(m);
                if (v !== null) t.extensionStorage.dimodScenes = v;
            }
            if (this.waiting.size > 200) this.waiting.clear();
            if (!find(h.current)) h.goTo(h.list[0].id, {run: false});
            h.assignMissing();
            h.applyAll();
            h.applyBackdrop();
            h.changed();
        } finally {
            this.quiet--;
            this.sbase = this.ssnap();
        }
    }
    applyAssets (p) {
        const a = this.assets;
        const find = id => a.list.find(x => x.id === id);
        const meta = (asset, x) => {
            if (typeof x.name === 'string' && x.name && x.name !== asset.name) a.rename(asset, x.name);
            if (typeof x.ext === 'string' && /^[a-z0-9]{1,10}$/.test(x.ext)) asset.ext = x.ext;
            asset.kind = typeof x.kind === 'string' && x.kind.length < 20 ? x.kind : kindOfExt(asset.ext);
        };
        clearTimeout(this.atimer);
        if (this.atimer) this.flushAssets();
        this.quiet++;
        try {
            for (const x of (Array.isArray(p.add) ? p.add : []).filter(okMeta)) {
                if (find(x.id) || typeof x.data !== 'string') continue;
                const bytes = base64ToUint8(x.data);
                const asset = {id: x.id, name: x.name, ext: x.ext, kind: kindOfExt(x.ext), size: bytes.length};
                if (typeof x.kind === 'string' && x.kind.length < 20) asset.kind = x.kind;
                a.list.push(asset);
                a.data.set(asset.id, bytes);
            }
            for (const id of Array.isArray(p.del) ? p.del : []) { const x = find(id); if (x) a.remove(x); }
            const set = p.set && typeof p.set === 'object' ? p.set : {};
            for (const id of Object.keys(set)) { const x = find(id); if (x && set[id]) meta(x, set[id]); }
            const data = p.data && typeof p.data === 'object' ? p.data : {};
            for (const id of Object.keys(data)) {
                const x = find(id);
                if (x && typeof data[id] === 'string' && !isLivePaintCostume(`asset:${id}`, 0)) a.replace(x, base64ToUint8(data[id]));
            }
            if (Array.isArray(p.order)) {
                const at = id => { const i = p.order.indexOf(id); return i < 0 ? 1e9 : i; };
                a.list.sort((x, y) => at(x.id) - at(y.id));
            }
            a.changed();
        } finally {
            this.quiet--;
            this.abase = this.asnap();
        }
    }
    answer (msg) {
        if (typeof msg.req !== 'string' || this.answered.has(msg.req)) return;
        if (this.atimer) this.flushAssets();
        const have = msg.have && typeof msg.have === 'object' ? msg.have : {};
        const a = this.assets;
        const list = a.list.map(x => ({id: x.id, name: x.name, ext: x.ext, kind: x.kind}));
        const data = {};
        for (const x of a.list) if (have[x.id] !== bytesHash(a.bytes(x))) data[x.id] = uint8ToBase64(a.bytes(x));
        this.answered.add(msg.req);
        this.send('scene-state', {req: msg.req, scenes: this.ssnap(), assets: {list, data}});
    }
    onState (msg) {
        this.answered.add(msg.req);
        if (msg.req !== this.req) return;
        this.req = null;
        if (this.edited) return;
        const s = msg.scenes && typeof msg.scenes === 'object' ? msg.scenes : null;
        const list = s && Array.isArray(s.list) ? s.list.filter(okScene) : [];
        if (list.length) {
            const ids = new Set(list.map(x => x.id));
            const set = {};
            for (const x of list) set[x.id] = x;
            this.applyScenes({add: list, del: this.scenes.list.filter(x => !ids.has(x.id)).map(x => x.id), set,
                order: list.map(x => x.id), main: s.main, members: s.members});
        }
        const as = msg.assets && typeof msg.assets === 'object' ? msg.assets : null;
        if (!as || !Array.isArray(as.list)) return;
        const metas = as.list.filter(okMeta);
        const ids = new Set(metas.map(x => x.id));
        const data = as.data && typeof as.data === 'object' ? as.data : {};
        const set = {};
        const have = {};
        for (const x of metas) { set[x.id] = x; if (typeof data[x.id] === 'string') have[x.id] = data[x.id]; }
        this.applyAssets({add: metas.map(x => ({...x, data: data[x.id]})), del: this.assets.list.filter(x => !ids.has(x.id)).map(x => x.id),
            set, data: have, order: metas.map(x => x.id)});
    }
    onMessage (msg) {
        switch (msg.type) {
        case 'joined': this.sendScene(true); return this.ask();
        case 'viewing': return msg.sceneOnly ? this.onHere(msg) : null;
        case 'presence': {
            if (!Array.isArray(msg.users)) return;
            const ids = new Set(msg.users.map(u => u && u.userId));
            for (const k of [...this.here.keys()]) if (!ids.has(k)) this.here.delete(k);
            this.sendScene(true);
            return this.vm.runtime.emit('DIMOD_SCENE_PRESENCE');
        }
        case 'scene-state-request': return setTimeout(() => this.answer(msg), Math.random() * 400);
        case 'scene-state': return this.onState(msg);
        case 'scene-patch': return this.applyScenes(msg);
        case 'dasset-patch': return this.applyAssets(msg);
        default:
        }
    }
}
const quietAssets = fn => {
    const c = scenesCollab;
    if (!c) return fn();
    if (c.atimer) c.flushAssets();
    c.quiet++;
    try { return fn(); } finally { c.quiet--; c.abase = c.asnap(); }
};
const installScenesCollab = vm => {
    installCollabHooks(vm);
    if (!scenesCollab && vm.dimodScenes && vm.dimodAssets && typeof window !== 'undefined') { scenesCollab = new ScenesAssetsCollab(vm); window.dimodScenesCollab = scenesCollab; }
    return scenesCollab;
};
export {ScenesAssetsCollab, installScenesCollab, installCollabHooks, remotely, broadcastTileMaps, quietAssets, UNSTABLE_ID_OPCODES, abandonGesture, allTargetHashes, applyRemoteAssetUpdate, applyRemoteBlocksShared, applyRemoteTargetCreate, applyRemoteTargetDelete, applyRemoteTargetRename, applyRemoteTargetReorder, applyTargetBlocks, attachShadowRef, broadcastCostumeAdd, broadcastCostumeDelete, broadcastCostumeOrder, broadcastCostumeRename, broadcastCostumeUpdate, broadcastSoundAdd, broadcastSoundDelete, broadcastSoundOrder, broadcastSoundRename, broadcastSoundUpdate, broadcastTargetCreate, broadcastTargetDelete, broadcastTargetRename, broadcastTargetReorder, clearRemoteEdited, computeBlocksHash as collabWorkspaceHealthDefault, colorForUserId, computeBlocksFingerprint, computeBlocksHash, contrastTextColor, dimodDragState, ensureEventVariables, findShadowRef, flushCostumeBroadcast, getRemoteEditedNames, handleRemotePaintPacket, hasActiveGesture, hasUnstableId, installBlockStateResponder, installConnectSafetyRails, installDragPreviewHook, installFieldCarets, installGestureRecovery, installPaintCollab, isApplyingRemotePaint, isLivePaintCostume, isPaintGestureActive, registerFieldCaretScope, repairAskewBlocks, resolveIncomingEvent, resolveShadowRef, resumePaintCollab, sanitizePreviewSvg, setAssetOrder, shareBlocksToTargetWithSync, suspendPaintCollab, targetBlocksHash, uninstallPaintCollab};
