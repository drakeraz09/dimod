import {onFontChanged, getFontName} from './dimod-fonts';
const MAX_ENTRIES$1 = 50000;
let widthEpoch = 0;
const getWidthEpoch = () => widthEpoch;
const FALLBACK_PX_PER_CHAR = 8;
const isFallbackEstimate = (width, textElement) =>
    width === FALLBACK_PX_PER_CHAR * textElement.textContent.length;
const STORE_KEY = 'dimod:fieldWidths:v1';
const MAX_STORED = 6000;
const storeTag = () => `${getFontName()}|${navigator.userAgent}`;
const readStored = () => {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); return s && s.tag === storeTag() ? s.w : null; } catch (e) { return null; }
};
let saveTimer = 0;
const saveStored = widths => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = 0;
        if (document.fonts && document.fonts.status !== 'loaded') return saveStored(widths);
        const w = {};
        let n = 0;
        for (const [k, v] of widths) {
            if (++n > MAX_STORED) break;
            w[k] = v;
        }
        try { localStorage.setItem(STORE_KEY, JSON.stringify({tag: storeTag(), w})); } catch (e) {}
    }, 4000);
};
const prefill = widths => {
    const w = readStored();
    if (w) for (const k in w) widths.set(k, w[k]);
};
function clearPersistentFieldWidths (ScratchBlocks, stale) {
    widthEpoch++;
    const Field = ScratchBlocks && ScratchBlocks.Field;
    if (!Field) return;
    if (stale) {
        try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    }
    if (Field.__dimodWidthCache) {
        Field.__dimodWidthCache.clear();
        if (!stale) prefill(Field.__dimodWidthCache);
    }
    Field.cacheWidths_ = null;
}
const stampWidth = (textElement, width) => { textElement.__dimodWidth = width; return width; };
const STALE_PX = 0.75;
const MAX_CHECKED = 600;
const findStaleField = workspaces => {
    let checked = 0;
    for (const ws of workspaces) {
        if (!ws || !ws.rendered) continue;
        for (const top of ws.getTopBlocks(false)) {
            for (const block of top.getDescendants(false)) {
                for (const input of block.inputList) {
                    for (const field of input.fieldRow) {
                        const el = field.textElement_;
                        if (!el || typeof el.__dimodWidth !== 'number' || !el.isConnected) continue;
                        if (++checked > MAX_CHECKED) return null;
                        let real;
                        try { real = el.getComputedTextLength(); } catch (e) { continue; }
                        if (real > 0 && Math.abs(real - el.__dimodWidth) > STALE_PX) return el.textContent;
                    }
                }
            }
        }
    }
    return null;
};
function watchFieldWidths ({getWorkspace, isActive, refresh}) {
    const BASE = 2000;
    let delay = BASE;
    let timer = 0;
    const tick = () => {
        let stale = null;
        try {
            const ws = getWorkspace();
            const busy = !ws || document.hidden || !isActive() || ws.isDragging();
            if (!busy) stale = findStaleField([ws.getFlyout() && ws.getFlyout().getWorkspace(), ws]);
        } catch (e) { stale = null; }
        if (stale === null) { delay = BASE; } else { refresh(); delay = Math.min(delay * 2, 60000); }
        timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 5000);
    return () => clearTimeout(timer);
}
function installPersistentFieldWidths (ScratchBlocks) {
    const Field = ScratchBlocks && ScratchBlocks.Field;
    if (!Field || Field.__dimodWidthCache) return;
    const widths = new Map();
    const measure = Field.getCachedWidth;
    Field.getCachedWidth = function (textElement) {
        const key = `${textElement.textContent}\n${textElement.className.baseVal}`;
        const known = widths.get(key);
        if (known !== undefined) return stampWidth(textElement, known);
        const width = measure.call(this, textElement);
        stampWidth(textElement, width);
        const trustworthy = width > 0 &&
            !isFallbackEstimate(width, textElement) &&
            textElement.isConnected !== false;
        if (trustworthy) {
            if (widths.size >= MAX_ENTRIES$1) widths.clear();
            widths.set(key, width);
            saveStored(widths);
        }
        return width;
    };
    Field.__dimodWidthCache = widths;
    prefill(widths);
    if (document.fonts && document.fonts.addEventListener) {
        document.fonts.addEventListener('loadingdone', () => clearPersistentFieldWidths(ScratchBlocks));
    }
    onFontChanged(() => clearPersistentFieldWidths(ScratchBlocks));
}
const MAX_ENTRIES = 12;
const MAX_PARKED_BLOCKS = 20000;
const hash = text => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
};
class WorkspaceCache {
    constructor (ScratchBlocks, vm) { this.SB = ScratchBlocks; this.vm = vm; this.entries = new Map(); }
    signature () {
        const SB = this.SB;
        try {
            return [
                SB.ScratchMsgs && SB.ScratchMsgs.currentLocale_,
                hash(JSON.stringify(SB.Colours)),
                getFontName(),
                getWidthEpoch(),
                this.extensionsFingerprint()
            ].join('|');
        } catch (e) { return String(Math.random()); }
    }
    extensionsFingerprint () {
        const info = this.vm && this.vm.runtime && this.vm.runtime._blockInfo;
        if (!info) return '';
        let text = '';
        for (const category of info) {
            text += `${category.id}:${category.blocks.length};`;
            for (const block of category.blocks) {
                if (block.json) text += JSON.stringify(block.json);
            }
        }
        return hash(text);
    }
    static cacheable (xml) { return typeof xml === 'string'; }
    static targetHash (target) {
        const blocks = target && target.blocks && target.blocks._blocks;
        if (!blocks) return null;
        let h = 0x811c9dc5;
        const fold = text => {
            const str = String(text);
            for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
            h ^= 0x7f;
            h = Math.imul(h, 0x01000193);
        };
        const ids = Object.keys(blocks).sort();
        for (const id of ids) {
            const b = blocks[id];
            fold(id);
            fold(b.opcode);
            fold(b.parent || '');
            fold(b.next || '');
            fold(b.shadow ? 's' : 'b');
            if (b.topLevel) fold(`${Math.round(b.x || 0)},${Math.round(b.y || 0)}`);
            const fields = b.fields || {};
            for (const name of Object.keys(fields).sort()) {
                const f = fields[name] || {};
                fold(name);
                fold(f.value);
                fold(f.id || '');
            }
            const inputs = b.inputs || {};
            for (const name of Object.keys(inputs).sort()) {
                const input = inputs[name] || {};
                fold(name);
                fold(input.block || '');
                fold(input.shadow || '');
            }
            if (b.mutation) fold(JSON.stringify(b.mutation));
        }
        const comments = target.comments || {};
        for (const id of Object.keys(comments).sort()) {
            const c = comments[id] || {};
            fold(id);
            fold(c.blockId || '');
            fold(c.text || '');
            fold(`${Math.round(c.x || 0)},${Math.round(c.y || 0)},${Math.round(c.width || 0)},` +
                `${Math.round(c.height || 0)},${c.minimized ? 1 : 0}`);
        }
        return `${(h >>> 0).toString(36)}:${ids.length}`;
    }
    has (targetId, contentHash) {
        const entry = this.entries.get(targetId);
        return !!entry && !!contentHash && entry.hash === contentHash && entry.signature === this.signature();
    }
    detach (workspace, targetId, contentHash) {
        const SB = this.SB;
        if (!contentHash) return;
        if (SB.selected) SB.selected.unselect();
        if (typeof SB.hideChaff === 'function') SB.hideChaff();
        const blocks = workspace.getTopBlocks(false);
        let blockCount = 0;
        for (const top of blocks) {
            top.setConnectionsHidden(true);
            for (const block of top.getDescendants(false)) { blockCount++; delete workspace.blockDB_[block.id]; }
            workspace.removeTopBlock(top);
            const root = top.getSvgRoot();
            if (root && root.parentNode) root.parentNode.removeChild(root);
        }
        const comments = workspace.getTopComments(false);
        for (const comment of comments) {
            try { workspace.removeTopComment(comment); } catch (e) {
            }
            if (workspace.commentDB_) delete workspace.commentDB_[comment.id];
        }
        const bubbleCanvas = workspace.getBubbleCanvas();
        const bubbles = bubbleCanvas ? Array.from(bubbleCanvas.childNodes) : [];
        for (const node of bubbles) bubbleCanvas.removeChild(node);
        this.evict(targetId);
        this.entries.set(targetId, {hash: contentHash, signature: this.signature(), blocks, comments, bubbles, blockCount});
        let parked = 0;
        for (const entry of this.entries.values()) parked += entry.blockCount || 0;
        while (this.entries.size > 1 && (this.entries.size > MAX_ENTRIES || parked > MAX_PARKED_BLOCKS)) {
            const oldest = this.entries.keys().next().value;
            parked -= (this.entries.get(oldest).blockCount || 0);
            this.evict(oldest);
        }
    }
    attach (workspace, targetId, dom) {
        const SB = this.SB;
        const entry = this.entries.get(targetId);
        this.entries.delete(targetId);
        const canvas = workspace.getCanvas();
        SB.Events.disable();
        try {
            for (const child of Array.from(dom.childNodes)) {
                if (child.nodeName && child.nodeName.toLowerCase() === 'variables') { SB.Xml.domToVariables(child, workspace); }
            }
            for (const top of entry.blocks) {
                canvas.appendChild(top.getSvgRoot());
                workspace.addTopBlock(top);
                for (const block of top.getDescendants(false)) workspace.blockDB_[block.id] = block;
                top.setConnectionsHidden(false);
            }
            for (const comment of entry.comments || []) {
                workspace.addTopComment(comment);
                if (workspace.commentDB_) workspace.commentDB_[comment.id] = comment;
            }
            const bubbleCanvas = workspace.getBubbleCanvas();
            if (bubbleCanvas) {
                for (const node of entry.bubbles || []) bubbleCanvas.appendChild(node);
            }
        } finally { SB.Events.enable(); }
        workspace.resizeContents();
    }
    static clearVariables (workspace) {
        workspace.variableMap_.clear();
        if (workspace.potentialVariableMap_) workspace.potentialVariableMap_.clear();
    }
    evict (targetId) { this.entries.delete(targetId); }
    clear () { this.entries.clear(); }
    prune (workspace, liveTargetIds) {
        for (const id of Array.from(this.entries.keys())) {
            if (!liveTargetIds.has(id)) this.evict(id);
        }
    }
}
export {WorkspaceCache, clearPersistentFieldWidths, findStaleField, getWidthEpoch, installPersistentFieldWidths, watchFieldWidths};
