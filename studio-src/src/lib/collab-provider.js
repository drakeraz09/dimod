import log from './log.js';
import {runAsRemote} from './dimod-project.js';

const WS_BASE = process.env.DIMOD_WS_BASE;

const STALE_WHEN_QUEUED = new Set([
    'cursor', 'viewing', 'workspace-health', 'server-tab-caret', 'field-caret',
    'paint-preview', 'paint-cursor', 'blockspace-caret'
]);

const CHUNK_THRESHOLD_CHARS = 1024 * 1024;
const CHUNK_SIZE_CHARS = 768 * 1024;
const MAX_CHUNKED_CHARS = 48 * 1024 * 1024;
const CHUNK_STALE_MS = 60 * 1000;
const CHUNKABLE_TYPES = new Set(['asset-update', 'blocks-state']);

class CollabProvider {
    constructor (projectId, token) {
        this.projectId = projectId;
        this.token = token;
        this.tabId = `${Date.now().toString(36)}-${Math.random().toString(36)
            .slice(2, 10)}`;
        this.connection = null;
        this.joined = false;
        this.connectionAttempts = 0;
        this.queuedData = [];
        this.status = 'connecting';

        this.onBlockEvent = null;
        this.onAssetUpdate = null;
        this.onTargetCreate = null;
        this.onTargetRename = null;
        this.onTargetDelete = null;
        this.onTargetReorder = null;
        this.onBlocksShared = null;
        this.onCursorUpdate = null;
        this.onCursorChat = null;
        this.onViewingUpdate = null;
        this.onPaintUpdate = null;
        this.onExtensionImport = null;
        this.onExtensionSync = null;
        this.onExtensionData = null;
        this.onExtensionRemove = null;
        this.onExtensionApprovalRequest = null;
        this.onExtensionApprovalVote = null;
        this.onExtensionApprovalResolved = null;
        this.onWorkspaceHealth = null;
        this.onPresenceUpdate = null;
        this.peerCount = 0;
        this.onSourceRestored = null;
        this.onStatusChange = null;

        this.openConnection();
    }

    setStatus (status) {
        this.status = status;
        if (this.onStatusChange) this.onStatusChange(status);
    }

    openConnection () {
        this.connectionAttempts += 1;
        this.setStatus(this.connectionAttempts > 1 ? 'reconnecting' : 'connecting');

        let base;
        if (WS_BASE) {
            const url = new URL(WS_BASE);
            base = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
        } else {
            base = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
        }
        const url = `${base}/ws/studio?project=${encodeURIComponent(this.projectId)}&token=${encodeURIComponent(this.token)}`;

        try {
            this.connection = new WebSocket(url);
        } catch (e) {
            log.warn('Websocket support is not available in this browser', e);
            this.connection = null;
            this.setStatus('error');
            return;
        }

        this.connection.onerror = this.onError.bind(this);
        this.connection.onmessage = this.onMessage.bind(this);
        this.connection.onopen = this.onOpen.bind(this);
        this.connection.onclose = this.onClose.bind(this);
    }

    onError (event) {
        log.error(`Studio collab websocket error: ${JSON.stringify(event)}`);
    }

    onOpen () {
        this.connectionAttempts = 1;
    }

    addMessageListener (fn) {
        if (!this.messageListeners) this.messageListeners = new Set();
        this.messageListeners.add(fn);
        return () => this.messageListeners.delete(fn);
    }

    onMessage (event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }
        if (!msg || typeof msg.type !== 'string') return;
        runAsRemote(() => this.handleMessage(msg));
    }

    handleMessage (msg) {
        if (this.messageListeners) {
            this.messageListeners.forEach(fn => {
                try { fn(msg); } catch (e) {}
            });
        }

        if (msg.type === 'joined') {
            this.joined = true;
            const gapMs = this._disconnectedAt ? Date.now() - this._disconnectedAt : 0;
            this._disconnectedAt = 0;
            if (gapMs > 8000) {
                window.dispatchEvent(new CustomEvent('dimod:collab-desync', {
                    detail: {reason: 'gap', text: 'You were offline from the live session... collaborators\' recent edits may be missing.'}
                }));
            }
            this.setStatus('connected');
            this.queuedData.forEach(str => this.connection.send(str));
            this.queuedData = [];
            return;
        }
        if (msg.type === 'asset-update-chunk') {
            this.handleChunk(msg);
            return;
        }
        if (msg.type === 'block-event') {
            if (this.onBlockEvent) this.onBlockEvent(msg.event, msg.from);
        } else if (msg.type === 'asset-update') {
            if (this.onAssetUpdate) this.onAssetUpdate(msg, msg.from);
        } else if (msg.type === 'target-create') {
            if (this.onTargetCreate) this.onTargetCreate(msg, msg.from);
        } else if (msg.type === 'target-rename') {
            if (this.onTargetRename) this.onTargetRename(msg, msg.from);
        } else if (msg.type === 'target-delete') {
            if (this.onTargetDelete) this.onTargetDelete(msg, msg.from);
        } else if (msg.type === 'target-reorder') {
            if (this.onTargetReorder) this.onTargetReorder(msg, msg.from);
        } else if (msg.type === 'blocks-shared') {
            if (this.onBlocksShared) this.onBlocksShared(msg, msg.from);
        } else if (msg.type === 'cursor') {
            if (this.onCursorUpdate) this.onCursorUpdate(msg, msg.from);
        } else if (msg.type === 'cursor-chat') {
            if (this.onCursorChat) this.onCursorChat(msg, msg.from);
        } else if (msg.type === 'viewing') {
            if (this.onViewingUpdate) this.onViewingUpdate(msg, msg.from);
        } else if (msg.type === 'paint-op' || msg.type === 'paint-preview' || msg.type === 'paint-cursor') {
            if (this.onPaintUpdate) this.onPaintUpdate(msg, msg.from);
        } else if (msg.type === 'extension-import') {
            if (this.onExtensionImport) this.onExtensionImport(msg, msg.from);
        } else if (msg.type === 'extension-sync') {
            if (this.onExtensionSync) this.onExtensionSync(msg.extensions || []);
        } else if (msg.type === 'extension-data') {
            if (this.onExtensionData) this.onExtensionData(msg, msg.from);
        } else if (msg.type === 'extension-remove') {
            if (this.onExtensionRemove) this.onExtensionRemove(msg, msg.from);
        } else if (msg.type === 'extension-approval-request') {
            if (this.onExtensionApprovalRequest) this.onExtensionApprovalRequest(msg, msg.from);
        } else if (msg.type === 'extension-approval-vote') {
            if (this.onExtensionApprovalVote) this.onExtensionApprovalVote(msg, msg.from);
        } else if (msg.type === 'extension-approval-resolved') {
            if (this.onExtensionApprovalResolved) this.onExtensionApprovalResolved(msg, msg.from);
        } else if (msg.type === 'workspace-health') {
            if (this.onWorkspaceHealth) this.onWorkspaceHealth(msg, msg.from);
        } else if (msg.type === 'presence') {
            const users = Array.isArray(msg.users) ? msg.users : [];
            this.peerCount = Math.max(0, users.length - 1);
            if (this.onPresenceUpdate) this.onPresenceUpdate(msg.users);
        } else if (msg.type === 'source-restored') {
            if (this.onSourceRestored) this.onSourceRestored(msg);
        }
    }

    onClose (e) {
        if (this.joined && !this._disconnectedAt) this._disconnectedAt = Date.now();
        this.joined = false;
        if (e && (e.code === 4001 || e.code === 4003)) {
            log.info(`Studio collab connection closed (${e.code}), not reconnecting.`);
            this.setStatus(e.code === 4003 ? 'forbidden' : 'error');
            return;
        }
        if (e && e.code === 4008) {
            this.setStatus('rate-limited');
            this.setTimeout(this.openConnection.bind(this), this.randomizeDuration(4000) + 2000);
            return;
        }
        if (e && e.code === 4013) {
            this.setStatus('room-full');
            this.setTimeout(this.openConnection.bind(this), this.randomizeDuration(4000) + 8000);
            return;
        }
        this.setStatus('reconnecting');
        const randomizedTimeout = this.randomizeDuration(this.exponentialTimeout());
        this.setTimeout(this.openConnection.bind(this), randomizedTimeout);
    }

    exponentialTimeout () {
        return (Math.pow(2, Math.min(this.connectionAttempts, 5)) - 1) * 1000;
    }

    randomizeDuration (t) {
        return Math.random() * t;
    }

    setTimeout (fn, time) {
        this._connectionTimeout = window.setTimeout(fn, time);
    }

    send (type, data) {
        const str = JSON.stringify({ type, fromTab: this.tabId, ...data });
        if (str.length > CHUNK_THRESHOLD_CHARS && CHUNKABLE_TYPES.has(type)) {
            this.sendChunked(type, str);
            return;
        }
        this.sendRaw(type, str);
    }

    sendRaw (type, str) {
        if (this.connection && this.connection.readyState === WebSocket.OPEN && this.joined) {
            this.connection.send(str);
        } else if (!STALE_WHEN_QUEUED.has(type)) {
            this.queuedData.push(str);
        }
    }

    sendChunked (type, str) {
        if (str.length > MAX_CHUNKED_CHARS) {
            log.warn(`Not sending a ${Math.round(str.length / 1048576)}MB ${type} to collaborators: too large`);
            window.dispatchEvent(new CustomEvent('dimod:collab-desync', {
                detail: {
                    reason: 'too-large',
                    text: `A ${type === 'asset-update' ? 'costume or sound' : 'sprite'} was too large to send live... ` +
                        'collaborators will get it on the next save.'
                }
            }));
            return;
        }
        this._chunkSeq = (this._chunkSeq || 0) + 1;
        const id = `${Date.now().toString(36)}-${this._chunkSeq}`;
        const count = Math.ceil(str.length / CHUNK_SIZE_CHARS);
        for (let i = 0; i < count; i++) {
            this.sendRaw('asset-update-chunk', JSON.stringify({
                type: 'asset-update-chunk',
                id,
                index: i,
                count,
                data: str.slice(i * CHUNK_SIZE_CHARS, (i + 1) * CHUNK_SIZE_CHARS)
            }));
        }
    }

    handleChunk (msg) {
        if (typeof msg.id !== 'string' || !Number.isInteger(msg.index) || !Number.isInteger(msg.count) ||
            typeof msg.data !== 'string' || msg.count < 1 || msg.count > MAX_CHUNKED_CHARS / CHUNK_SIZE_CHARS + 1) {
            return;
        }
        if (!this._chunkBuffers) this._chunkBuffers = new Map();
        const key = `${msg.from}:${msg.id}`;
        let entry = this._chunkBuffers.get(key);
        if (!entry) {
            if (this._chunkBuffers.size >= 16) return;
            entry = {parts: new Array(msg.count), got: 0, startedAt: Date.now(), from: msg.from};
            this._chunkBuffers.set(key, entry);
        }
        if (msg.index >= entry.parts.length || entry.parts[msg.index] !== undefined) return;
        entry.parts[msg.index] = msg.data;
        entry.got++;
        const now = Date.now();
        this._chunkBuffers.forEach((v, k) => {
            if (now - v.startedAt > CHUNK_STALE_MS) this._chunkBuffers.delete(k);
        });
        if (entry.got < entry.parts.length) return;
        this._chunkBuffers.delete(key);
        let whole;
        try {
            whole = JSON.parse(entry.parts.join(''));
        } catch (e) {
            return;
        }
        if (!whole || !CHUNKABLE_TYPES.has(whole.type)) return;
        whole.from = msg.from;
        whole.fromUsername = msg.fromUsername;
        this.handleMessage(whole);
    }

    sendBlockEvent (eventJson) {
        this.send('block-event', { event: eventJson });
    }

    sendAssetUpdate (payload) {
        this.send('asset-update', payload);
    }

    sendTargetCreate (payload) {
        this.send('target-create', payload);
    }

    sendTargetRename (payload) {
        this.send('target-rename', payload);
    }

    sendTargetDelete (payload) {
        this.send('target-delete', payload);
    }

    sendTargetReorder (payload) {
        this.send('target-reorder', payload);
    }

    sendBlocksShared (payload) {
        this.send('blocks-shared', payload);
    }

    sendCursorUpdate (payload) {
        this.send('cursor', payload);
    }

    sendCursorChat (payload) {
        this.send('cursor-chat', payload);
    }

    sendViewingUpdate (payload) {
        this.send('viewing', payload);
    }

    sendPaintOp (payload) {
        this.send('paint-op', payload);
    }

    sendPaintPreview (payload) {
        this.send('paint-preview', payload);
    }

    sendPaintCursor (payload) {
        this.send('paint-cursor', payload);
    }

    sendExtensionImport (payload) {
        this.send('extension-import', payload);
    }

    sendExtensionData (payload) {
        this.send('extension-data', payload);
    }

    sendExtensionRemove (payload) {
        this.send('extension-remove', payload);
    }

    sendExtensionApprovalRequest (payload) {
        this.send('extension-approval-request', payload);
    }

    sendExtensionApprovalVote (payload) {
        this.send('extension-approval-vote', payload);
    }

    sendExtensionApprovalResolved (payload) {
        this.send('extension-approval-resolved', payload);
    }

    sendWorkspaceHealth (payload) {
        this.send('workspace-health', payload);
    }

    requestCloseConnection () {
        if (this.connection &&
            this.connection.readyState !== WebSocket.CLOSING &&
            this.connection.readyState !== WebSocket.CLOSED) {
            this.connection.onclose = () => {};
            this.connection.onerror = () => {};
            this.connection.close();
        }
        this.clear();
    }

    clear () {
        this.connection = null;
        this.joined = false;
        this.onBlockEvent = null;
        this.onAssetUpdate = null;
        this.onTargetCreate = null;
        this.onTargetRename = null;
        this.onTargetDelete = null;
        this.onTargetReorder = null;
        this.onBlocksShared = null;
        this.onCursorUpdate = null;
        this.onCursorChat = null;
        this.onPaintUpdate = null;
        this.onViewingUpdate = null;
        this.onExtensionImport = null;
        this.onExtensionSync = null;
        this.onExtensionData = null;
        this.onExtensionRemove = null;
        this.onExtensionApprovalRequest = null;
        this.onExtensionApprovalVote = null;
        this.onExtensionApprovalResolved = null;
        this.onWorkspaceHealth = null;
        this.onPresenceUpdate = null;
        this.onSourceRestored = null;
        this.onStatusChange = null;
        if (this._connectionTimeout) {
            clearTimeout(this._connectionTimeout);
            this._connectionTimeout = null;
        }
        this.connectionAttempts = 0;
    }
}

export default CollabProvider;
