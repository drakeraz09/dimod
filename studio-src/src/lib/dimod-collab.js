import DOMPurify from 'dompurify';
import {getDimodUserId} from './dimod-project';
import Comment from 'scratch-vm/src/engine/comment';
import log from './log.js';
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
const COSTUME_BROADCAST_DEBOUNCE_MS = 400;
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
const applyCostumeUpdate = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const costumes = target.getCostumes();
    const index = payload.costumeName ? costumes.findIndex(c => c.name === payload.costumeName) :
        payload.costumeIndex;
    if (index < 0 || index >= costumes.length) return;
    const costume = costumes[index];
    const mineAt = lastLocalCostumeEdit.get(editKey(payload.targetId, index));
    if (mineAt && Date.now() - mineAt < CONCURRENT_EDIT_WINDOW_MS && iWinConcurrentEdit(payload.from)) return;
    if (payload.isVector) {
        if (isLivePaintCostume(payload.targetId, index)) return;
        vm._updateSvg(costume, payload.image, payload.rotationCenterX, payload.rotationCenterY);
        notifyCostumeUpdated(payload.targetId, index);
        return;
    }
    return bitmapDataUrlToImageData(payload.image).then(imageData => {
        const apply = () => {
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
        wav: uint8ToBase64(wavBytes)
    });
};
const applySoundUpdate = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const sounds = target.sprite.sounds;
    const index = payload.soundName ? sounds.findIndex(s => s.name === payload.soundName) : payload.soundIndex;
    if (index < 0 || index >= sounds.length) return;
    const wavBytes = base64ToUint8(payload.wav);
    const audioContext = vm.runtime.audioEngine.audioContext;
    return audioContext.decodeAudioData(wavBytes.buffer.slice(0)).then(audioBuffer => {
        const sound = sounds[index];
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
const broadcastCostumeAdd = (vm, targetId, atIndex) => {
    if (!window.dimodCollab) return;
    const target = vm.runtime.getTargetById(targetId);
    if (!target) return;
    const costumes = target.getCostumes();
    const index = typeof atIndex === 'number' ? atIndex : costumes.length - 1;
    const costume = costumes[index];
    if (!costume || !costume.asset) return;
    window.dimodCollab.sendAssetUpdate({
        kind: 'costume-add',
        targetId,
        insertIndex: index,
        name: costume.name,
        dataFormat: costume.dataFormat,
        rotationCenterX: costume.rotationCenterX,
        rotationCenterY: costume.rotationCenterY,
        bitmapResolution: costume.bitmapResolution,
        data: uint8ToBase64(costume.asset.data)
    });
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
    return vm.addCostume(`${asset.assetId}.${asset.dataFormat}`, costumeObject, payload.targetId).then(() => {
        const endIndex = target.getCostumes().length - 1;
        if (typeof payload.insertIndex === 'number' && payload.insertIndex !== endIndex) {
            vm.reorderCostume(payload.targetId, endIndex, payload.insertIndex);
        }
        const back = previous ? target.getCostumes().indexOf(previous) : -1;
        if (back !== -1 && back !== target.currentCostume) target.setCostume(back);
        vm.emitTargetsUpdate();
    });
};
const broadcastSoundAdd = (vm, targetId, atIndex) => {
    if (!window.dimodCollab) return;
    const target = vm.runtime.getTargetById(targetId);
    if (!target) return;
    const sounds = target.sprite.sounds;
    const index = typeof atIndex === 'number' ? atIndex : sounds.length - 1;
    const sound = sounds[index];
    if (!sound || !sound.asset) return;
    window.dimodCollab.sendAssetUpdate({
        kind: 'sound-add',
        targetId,
        insertIndex: index,
        name: sound.name,
        dataFormat: sound.dataFormat,
        rate: sound.rate,
        sampleCount: sound.sampleCount,
        data: uint8ToBase64(sound.asset.data)
    });
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
    return vm.addSound(soundObject, payload.targetId).then(() => {
        const endIndex = target.sprite.sounds.length - 1;
        if (typeof payload.insertIndex === 'number' && payload.insertIndex !== endIndex) {
            vm.reorderSound(payload.targetId, endIndex, payload.insertIndex);
            vm.emitTargetsUpdate();
        }
    });
};
const broadcastCostumeDelete = (vm, targetId, index, name) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'costume-delete', targetId, index, name});
};
const applyCostumeDelete = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const costumes = target.getCostumes();
    const index = costumes.findIndex(c => c.name === payload.name);
    if (index === -1) return;
    target.deleteCostume(index);
    vm.emitTargetsUpdate();
};
const broadcastSoundDelete = (vm, targetId, index, name) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'sound-delete', targetId, index, name});
};
const applySoundDelete = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const sounds = target.sprite.sounds;
    const index = sounds.findIndex(s => s.name === payload.name);
    if (index === -1) return;
    target.deleteSound(index);
    vm.emitTargetsUpdate();
};
const broadcastCostumeReorder = (vm, targetId, index, newIndex) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'costume-reorder', targetId, index, newIndex});
};
const applyCostumeReorder = (vm, payload) => {
    vm.reorderCostume(payload.targetId, payload.index, payload.newIndex);
    vm.emitTargetsUpdate();
};
const broadcastCostumeOrder = (vm, targetId) => {
    const target = window.dimodCollab && vm.runtime.getTargetById(targetId);
    if (!target) return;
    window.dimodCollab.sendAssetUpdate({kind: 'costume-order', targetId, names: target.getCostumes().map(c => c.name)});
};
const broadcastSoundOrder = (vm, targetId) => {
    const target = window.dimodCollab && vm.runtime.getTargetById(targetId);
    if (!target) return;
    window.dimodCollab.sendAssetUpdate({kind: 'sound-order', targetId, names: target.sprite.sounds.map(s => s.name)});
};
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
    const list = kind === 'costume' ? target.getCostumes() : target.sprite.sounds;
    const wanted = payload.names.filter(n => typeof n === 'string');
    const byName = new Map(list.map(o => [o.name, o]));
    const final = wanted.map(n => byName.get(n)).filter(Boolean);
    list.forEach(o => {
        if (!final.includes(o)) final.push(o);
    });
    setAssetOrder(vm, target, kind, final);
};
const broadcastSoundReorder = (vm, targetId, index, newIndex) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'sound-reorder', targetId, index, newIndex});
};
const applySoundReorder = (vm, payload) => {
    vm.reorderSound(payload.targetId, payload.index, payload.newIndex);
    vm.emitTargetsUpdate();
};
const broadcastCostumeRename = (vm, targetId, index, oldName, newName) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'costume-rename', targetId, index, oldName, newName});
};
const applyCostumeRename = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const costumes = target.getCostumes();
    const index = costumes.findIndex(c => c.name === payload.oldName);
    if (index === -1) return;
    target.renameCostume(index, payload.newName);
    vm.emitTargetsUpdate();
};
const broadcastSoundRename = (vm, targetId, index, oldName, newName) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendAssetUpdate({kind: 'sound-rename', targetId, index, oldName, newName});
};
const applySoundRename = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target) return;
    const sounds = target.sprite.sounds;
    const index = sounds.findIndex(s => s.name === payload.oldName);
    if (index === -1) return;
    target.renameSound(index, payload.newName);
    vm.emitTargetsUpdate();
};
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
const applyRemoteAssetUpdate = (vm, payload) => {
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
const broadcastTargetCreate = vm => {
    if (!window.dimodCollab) return;
    const target = vm.editingTarget;
    if (!target) return;
    vm.exportSprite(target.id, 'base64').then(base64 => {
        if (!window.dimodCollab) return;
        window.dimodCollab.sendTargetCreate({targetId: target.id, sprite: base64});
    });
};
const base64ToArrayBuffer = base64 => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
};
const applyRemoteTargetCreate = (vm, payload) => {
    if (vm.runtime.getTargetById(payload.targetId)) return;
    const previousTargetId = vm.editingTarget ? vm.editingTarget.id : null;
    vm.dimodRemoteTargetCreates = (vm.dimodRemoteTargetCreates || 0) + 1;
    const done = () => { vm.dimodRemoteTargetCreates -= 1; };
    return vm.addSprite(base64ToArrayBuffer(payload.sprite)).then(() => {
        if (previousTargetId && vm.editingTarget && vm.editingTarget.id !== previousTargetId &&
            vm.runtime.getTargetById(previousTargetId)) { vm.setEditingTarget(previousTargetId); }
        done();
    }, err => { done(); throw err; });
};
const broadcastTargetRename = (vm, targetId, newName) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendTargetRename({targetId, name: newName});
};
const applyRemoteTargetRename = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target || target.getName() === payload.name) return;
    vm.renameSprite(payload.targetId, payload.name);
};
const broadcastTargetDelete = targetId => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendTargetDelete({targetId});
};
const applyRemoteTargetDelete = (vm, payload) => {
    const target = vm.runtime.getTargetById(payload.targetId);
    if (!target || !target.isSprite()) return;
    vm.deleteSprite(payload.targetId);
};
const broadcastTargetReorder = (index, newIndex, targetId) => {
    if (!window.dimodCollab) return;
    window.dimodCollab.sendTargetReorder({index, newIndex, targetId});
};
const applyRemoteTargetReorder = (vm, payload) => {
    let index = payload.index;
    if (payload.targetId) {
        index = vm.runtime.targets.findIndex(t => t.id === payload.targetId);
        if (index === -1) return;
    }
    vm.reorderTarget(index, payload.newIndex);
};
const shareBlocksToTargetWithSync = (vm, blocks, targetId, optFromTargetId) => {
    const target = vm.runtime.getTargetById(targetId);
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
export {UNSTABLE_ID_OPCODES, abandonGesture, allTargetHashes, applyRemoteAssetUpdate, applyRemoteBlocksShared, applyRemoteTargetCreate, applyRemoteTargetDelete, applyRemoteTargetRename, applyRemoteTargetReorder, applyTargetBlocks, attachShadowRef, broadcastCostumeAdd, broadcastCostumeDelete, broadcastCostumeOrder, broadcastCostumeRename, broadcastCostumeReorder, broadcastCostumeUpdate, broadcastSoundAdd, broadcastSoundDelete, broadcastSoundOrder, broadcastSoundRename, broadcastSoundReorder, broadcastSoundUpdate, broadcastTargetCreate, broadcastTargetDelete, broadcastTargetRename, broadcastTargetReorder, clearRemoteEdited, computeBlocksHash as collabWorkspaceHealthDefault, colorForUserId, computeBlocksFingerprint, computeBlocksHash, contrastTextColor, dimodDragState, ensureEventVariables, findShadowRef, flushCostumeBroadcast, getRemoteEditedNames, handleRemotePaintPacket, hasActiveGesture, hasUnstableId, installBlockStateResponder, installConnectSafetyRails, installDragPreviewHook, installFieldCarets, installGestureRecovery, installPaintCollab, isApplyingRemotePaint, isLivePaintCostume, isPaintGestureActive, registerFieldCaretScope, repairAskewBlocks, resolveIncomingEvent, resolveShadowRef, resumePaintCollab, sanitizePreviewSvg, setAssetOrder, shareBlocksToTargetWithSync, suspendPaintCollab, targetBlocksHash, uninstallPaintCollab};
