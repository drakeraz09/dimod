import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import Cast from 'scratch-vm/src/util/cast';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import {costumeUpload, soundUpload} from './file-uploader';
const KEY = 'dimodScenes';
const ASSETS_KEY = 'dimodAssets';
const ASSETS_DIR = 'dimodassets/';
const ANY = '(any scene)';
const SCENE_OPCODES = {
    goTo: 'scenes_goto',
    goToRel: 'scenes_gotorel',
    whenEntered: 'scenes_whenentered',
    current: 'scenes_current',
    index: 'scenes_index',
    count: 'scenes_count',
    nameOf: 'scenes_nameof',
    add: 'scenes_add',
    remove: 'scenes_remove',
    isIn: 'scenes_isin',
    names: 'scenes_names',
    sprites: 'scenes_sprites',
    ofSprite: 'scenes_ofsprite',
    menu: 'scenes_menu',
    relMenu: 'scenes_relmenu'
};
const ASSET_OPCODES = {
    text: 'assets_text',
    info: 'assets_info',
    exists: 'assets_exists',
    count: 'assets_count',
    nameOf: 'assets_nameof',
    url: 'assets_url',
    names: 'assets_names',
    array: 'assets_array',
    write: 'assets_write',
    costume: 'assets_costume',
    backdrop: 'assets_backdrop',
    sound: 'assets_sound',
    menu: 'assets_menu',
    kindMenu: 'assets_kindmenu',
    ref: 'assets_ref',
    setSkin: 'assets_setskin',
    clearSkin: 'assets_clearskin',
    skinName: 'assets_skinname'
};
const MEDIA_OPCODES = {costumeOf: 'looks_dimod_costumeof', soundOf: 'sound_dimod_soundof'};
const MYSELF = '_myself_';
const STAGE = '_stage_';
const REL = ['next', 'previous', 'first', 'last', 'start'];
const KINDS = ['image', 'sound', 'animation', 'video', 'font', 'text', 'data'];
const EXT_KIND = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', webp: 'image', svg: 'image',
    wav: 'sound', mp3: 'sound', ogg: 'sound', flac: 'sound', m4a: 'sound', aac: 'sound',
    ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
    txt: 'text', json: 'text', csv: 'text', md: 'text', xml: 'text', html: 'text', js: 'text', css: 'text', tsv: 'text',
    mjs: 'text', cjs: 'text', ts: 'text', yaml: 'text', yml: 'text', glsl: 'text', frag: 'text', vert: 'text', lua: 'text',
    py: 'text', ini: 'text', toml: 'text', sql: 'text', sh: 'text',
    mp4: 'video', webm: 'video', mov: 'video', ogv: 'video', mkv: 'video', ks5anim: 'animation'
};
const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
    svg: 'image/svg+xml', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac',
    m4a: 'audio/mp4', aac: 'audio/aac', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
    txt: 'text/plain', json: 'application/json', csv: 'text/csv', md: 'text/markdown', xml: 'application/xml',
    html: 'text/html', js: 'text/javascript', css: 'text/css', tsv: 'text/tab-separated-values', mp4: 'video/mp4',
    webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska', pdf: 'application/pdf',
    ks5anim: 'application/json'
};
const kindOfExt = ext => EXT_KIND[String(ext).toLowerCase()] || 'data';
const mimeOfExt = ext => MIME[String(ext).toLowerCase()] || 'application/octet-stream';
const arrayOf = (vm, list) => (vm.jwArray ? new vm.jwArray.Type(list, true) : JSON.stringify(list));
const spriteListKey = runtime => runtime.targets.filter(t => t.isOriginal).map(t => `${t.id}:${t.getName()}`).join('|');
const newId = prefix => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const unusedName = (name, taken) => {
    const used = new Set(taken.map(n => String(n).toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;
    const base = name.replace(/\d+$/, '');
    for (let i = 2; ; i++) if (!used.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
};
const renameFields = (vm, rules, from, to, test) => {
    if (from === to) return;
    let hit = false;
    for (const target of vm.runtime.targets) {
        if (!target.isOriginal) continue;
        for (const block of Object.values(target.blocks._blocks)) {
            for (const [opcode, field] of rules) {
                const f = block.opcode === opcode && block.fields[field];
                if (f && f.value === from && (!test || test(block))) { f.value = to; hit = true; }
            }
        }
        if (hit && target.blocks.resetCache) target.blocks.resetCache();
    }
    if (hit && vm.editingTarget && vm.emitWorkspaceUpdate) vm.emitWorkspaceUpdate();
};
const ownerOf = target => (target.isStage || target.isOriginal ? target : (target.sprite && target.sprite.clones[0]) || target);
class SceneHost {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.list = [{id: 'scene1', name: 'Scene 1', backdrop: ''}];
        this.main = 'scene1';
        this.current = 'scene1';
        this.flagToMain = false;
        this.loading = false;
        this.version = 0;
    }
    changed (persist = true) {
        this.version++;
        if (persist) this.save();
        this.runtime.emit('DIMOD_SCENES');
        this.runtime.emitProjectChanged();
    }
    save () { this.runtime.extensionStorage[KEY] = {list: this.list.map(s => ({...s})), main: this.main}; }
    load () {
        const saved = this.runtime.extensionStorage[KEY];
        const list = saved && Array.isArray(saved.list) ? saved.list.filter(s => s && s.id && s.name) : [];
        this.list = list.length ? list.map(s => ({id: String(s.id), name: String(s.name), backdrop: s.backdrop || ''})) :
            [{id: 'scene1', name: 'Scene 1', backdrop: ''}];
        this.main = this.list.some(s => s.id === (saved && saved.main)) ? saved.main : this.list[0].id;
        this.current = this.main;
        this.assignMissing();
        this.save();
        this.applyAll();
        this.applyBackdrop();
        this.changed(false);
    }
    scene (ref) {
        if (ref && typeof ref === 'object') ref = ref.id || ref.name;
        const s = String(ref);
        const byId = this.list.find(x => x.id === s);
        if (byId) return byId;
        const lower = s.toLowerCase();
        const byName = this.list.find(x => x.name.toLowerCase() === lower);
        if (byName) return byName;
        const n = Number(ref);
        return Number.isInteger(n) && n >= 1 && n <= this.list.length ? this.list[n - 1] : null;
    }
    get currentScene () { return this.scene(this.current) || this.list[0]; }
    get names () { return this.list.map(s => s.name); }
    membership (target) { return ownerOf(target).extensionStorage[KEY]; }
    inScene (target, id = this.current) {
        if (!target || target.isStage) return true;
        const m = this.membership(target);
        return !m || m === '*' || (Array.isArray(m) && m.includes(id));
    }
    scenesOf (target) {
        const m = this.membership(target);
        if (m === '*') return this.list.map(s => s.id);
        return Array.isArray(m) ? m.filter(id => this.list.some(s => s.id === id)) : [this.current];
    }
    setMembership (target, value) {
        const owner = ownerOf(target);
        if (owner.isStage) return;
        owner.extensionStorage[KEY] = value;
        this.applySprite(owner.sprite);
        this.changed();
    }
    addTo (target, id) {
        const owner = ownerOf(target);
        if (owner.isStage) return;
        const m = this.membership(owner);
        if (m === '*') return;
        const ids = Array.isArray(m) ? m : [];
        if (!ids.includes(id)) this.setMembership(owner, [...ids, id]);
    }
    removeFrom (target, id) {
        const owner = ownerOf(target);
        if (owner.isStage) return;
        this.setMembership(owner, this.scenesOf(owner).filter(x => x !== id));
    }
    assignMissing () {
        const ids = new Set(this.list.map(s => s.id));
        for (const t of this.runtime.targets) {
            if (t.isStage || !t.isOriginal) continue;
            const m = t.extensionStorage[KEY];
            if (m === '*') continue;
            if (!Array.isArray(m)) t.extensionStorage[KEY] = [this.current];
            else if (m.some(id => !ids.has(id))) t.extensionStorage[KEY] = m.filter(id => ids.has(id));
        }
    }
    enforce (target) {
        if (target.isStage || !target.renderer || target.drawableID === null || typeof target.drawableID === 'undefined') return;
        const hide = !this.inScene(target);
        if (hide) target.renderer.updateDrawableVisible(target.drawableID, false);
        else if (target.dimodSceneHidden) target.renderer.updateDrawableVisible(target.drawableID, target.visible);
        target.dimodSceneHidden = hide;
    }
    applySprite (sprite) {
        if (!sprite) return;
        for (const c of sprite.clones.slice()) {
            this.enforce(c);
            if (!this.inScene(c)) this.evict(c);
        }
        this.runtime.requestRedraw();
    }
    applyAll () {
        for (const t of this.runtime.targets.slice()) {
            this.enforce(t);
            if (!this.inScene(t)) this.evict(t);
        }
        this.runtime.requestRedraw();
    }
    evict (target) {
        this.runtime.stopForTarget(target);
        if (!target.isOriginal && !target.isStage) this.runtime.disposeTarget(target);
    }
    applyBackdrop () {
        const stage = this.runtime.getTargetForStage();
        const name = this.currentScene.backdrop;
        if (!stage || !name) return;
        const index = stage.getCostumeIndexByName(name);
        if (index >= 0 && stage.currentCostume !== index) stage.setCostume(index);
    }
    goTo (ref, {run = true} = {}) {
        const scene = this.scene(ref);
        if (!scene || scene.id === this.current) return !!scene;
        this.current = scene.id;
        this.applyAll();
        this.applyBackdrop();
        this.changed(false);
        this.runtime.emit('DIMOD_SCENE_CHANGED', scene);
        if (run) this.fire(scene);
        return true;
    }
    fire (scene) {
        this.runtime.emit('DIMOD_SCENE_ENTERED', scene);
        this.runtime.startHats(SCENE_OPCODES.whenEntered, {SCENE: scene.name});
        this.runtime.startHats(SCENE_OPCODES.whenEntered, {SCENE: ANY});
    }
    goRel (which, opts) {
        const i = this.list.findIndex(s => s.id === this.current);
        const n = this.list.length;
        const dest = {
            next: this.list[(i + 1) % n], previous: this.list[(i - 1 + n) % n],
            first: this.list[0], last: this.list[n - 1], start: this.scene(this.main)
        }[which];
        return dest ? this.goTo(dest.id, opts) : false;
    }
    create (name = 'Scene') {
        const scene = {id: newId('scene'), name: unusedName(String(name), this.names), backdrop: ''};
        this.list.push(scene);
        this.changed();
        return scene;
    }
    rename (id, name) {
        const scene = this.scene(id);
        const clean = String(name).trim();
        if (!scene || !clean) return;
        const old = scene.name;
        scene.name = unusedName(clean, this.list.filter(s => s !== scene).map(s => s.name));
        renameFields(this.vm, [[SCENE_OPCODES.menu, 'SCENE'], [SCENE_OPCODES.whenEntered, 'SCENE']], old, scene.name);
        this.changed();
    }
    remove (id) {
        if (this.list.length < 2) return false;
        const i = this.list.findIndex(s => s.id === id);
        if (i < 0) return false;
        const [gone] = this.list.splice(i, 1);
        if (this.main === gone.id) this.main = this.list[0].id;
        for (const t of this.runtime.targets) {
            if (t.isStage || !t.isOriginal) continue;
            const m = t.extensionStorage[KEY];
            if (!Array.isArray(m)) continue;
            const kept = m.filter(x => x !== gone.id);
            t.extensionStorage[KEY] = kept.length ? kept : [this.list[Math.max(0, i - 1)].id];
        }
        if (this.current === gone.id) this.goTo(this.list[Math.max(0, i - 1)].id, {run: false});
        else this.applyAll();
        this.changed();
        return true;
    }
    move (id, to) {
        const i = this.list.findIndex(s => s.id === id);
        if (i < 0) return;
        const [scene] = this.list.splice(i, 1);
        this.list.splice(Math.max(0, Math.min(this.list.length, to)), 0, scene);
        this.changed();
    }
    duplicate (id) {
        const scene = this.scene(id);
        if (!scene) return null;
        const copy = this.create(`${scene.name} copy`);
        copy.backdrop = scene.backdrop;
        for (const t of this.runtime.targets) {
            if (!t.isOriginal || t.isStage) continue;
            if (this.inScene(t, scene.id)) this.addTo(t, copy.id);
        }
        this.changed();
        return copy;
    }
    setMain (id) {
        if (!this.list.some(s => s.id === id)) return;
        this.main = id;
        this.changed();
    }
    setBackdrop (id, name) {
        const scene = this.scene(id);
        if (!scene) return;
        scene.backdrop = name || '';
        if (scene.id === this.current) this.applyBackdrop();
        this.changed();
    }
    spritesIn (id) { return this.runtime.targets.filter(t => t.isOriginal && !t.isStage && this.inScene(t, id)); }
}
class AssetRef {
    constructor (host, id) { Object.defineProperty(this, 'host', {value: host}); this.id = id; }
    get asset () { return this.host.list.find(a => a.id === this.id) || null; }
    get name () { const a = this.asset; return a ? a.name : ''; }
    get kind () { const a = this.asset; return a ? a.kind : ''; }
    get dimodAssetRef () { return true; }
    get dimodRefKind () { return 'asset'; }
    toString () { return this.name; }
    toJSON () { return this.name; }
    toReporterContent () {
        const a = this.asset;
        const box = document.createElement('span');
        box.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
        if (a && a.kind === 'image') {
            const img = document.createElement('img');
            img.src = this.host.url(a);
            img.style.cssText = 'max-width:72px;max-height:54px;border-radius:3px';
            box.appendChild(img);
        }
        const name = document.createElement('span');
        name.textContent = a ? a.name : '(missing asset)';
        box.appendChild(name);
        return box;
    }
}
class MediaRef {
    constructor (owner, item) {
        Object.defineProperty(this, 'owner', {value: owner});
        Object.defineProperty(this, 'item', {value: item});
    }
    get name () { return this.item.name; }
    toString () { return this.name; }
    toJSON () { return this.name; }
    toReporterContent () {
        const box = document.createElement('span');
        box.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
        const url = this.dimodRefKind === 'costume' && this.item.asset && this.item.asset.encodeDataURI ?
            this.item.asset.encodeDataURI() : null;
        if (url) {
            const img = document.createElement('img');
            img.src = url;
            img.style.cssText = 'max-width:72px;max-height:54px;border-radius:3px';
            box.appendChild(img);
        }
        const name = document.createElement('span');
        name.textContent = this.name;
        box.appendChild(name);
        return box;
    }
}
class CostumeRef extends MediaRef {
    get dimodRefKind () { return 'costume'; }
}
class SoundRef extends MediaRef {
    get dimodRefKind () { return 'sound'; }
}
const loadImage = url => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
});
class AssetHost {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.list = [];
        this.data = new Map();
        this.urls = new Map();
        this.refs = new Map();
        this.skins = new Map();
        this.players = new Map();
        this.borrowed = new WeakMap();
    }
    changed (persist = true) {
        if (persist) this.save();
        this.runtime.emit('DIMOD_ASSETS');
        this.runtime.emitProjectChanged();
    }
    save () { this.runtime.extensionStorage[ASSETS_KEY] = this.list.map(a => ({...a})); }
    clear () {
        for (const a of this.list) this.forget(a.id, true);
        this.revokeUrls();
        this.list = [];
        this.data.clear();
        this.refs.clear();
    }
    revokeUrls () { this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls.clear(); }
    async loadFrom (meta, zip) {
        this.clear();
        const list = Array.isArray(meta) ? meta.filter(a => a && a.id && a.name && a.ext) : [];
        await Promise.all(list.map(async a => {
            const entry = zip && zip.file ? zip.file(`${ASSETS_DIR}${a.id}.${a.ext}`) : null;
            if (!entry) return;
            this.data.set(a.id, await entry.async('uint8array'));
            this.list.push({id: String(a.id), name: String(a.name), ext: String(a.ext), kind: a.kind || kindOfExt(a.ext),
                size: this.data.get(a.id).length});
        }));
        this.list.sort((x, y) => list.findIndex(a => a.id === x.id) - list.findIndex(a => a.id === y.id));
        this.changed(true);
    }
    files () {
        return this.list.filter(a => this.data.has(a.id)).map(a => ({
            fileName: `${ASSETS_DIR}${a.id}.${a.ext}`, fileContent: this.data.get(a.id)
        }));
    }
    ref (asset) {
        if (!this.refs.has(asset.id)) this.refs.set(asset.id, new AssetRef(this, asset.id));
        return this.refs.get(asset.id);
    }
    byRef (ref) {
        if (ref instanceof AssetRef) return ref.asset;
        if (ref && typeof ref === 'object') ref = ref.id || ref.name;
        const s = String(ref);
        const lower = s.toLowerCase();
        return this.list.find(a => a.id === s) || this.list.find(a => a.name.toLowerCase() === lower) ||
            this.list.find(a => `${a.name}.${a.ext}`.toLowerCase() === lower) || null;
    }
    ofKind (kind) { return !kind || kind === 'any' ? this.list : this.list.filter(a => a.kind === kind); }
    add (name, bytes, ext) {
        const e = String(ext || 'bin').toLowerCase().replace(/^\./, '');
        const asset = {id: newId('a'), name: unusedName(String(name || 'asset'), this.list.map(a => a.name)), ext: e,
            kind: kindOfExt(e), size: bytes.length};
        this.list.push(asset);
        this.data.set(asset.id, bytes);
        this.changed();
        return asset;
    }
    addText (name, text, ext = 'txt') { return this.add(name, new TextEncoder().encode(String(text)), ext); }
    replace (asset, bytes) {
        this.data.set(asset.id, bytes);
        asset.size = bytes.length;
        const old = this.urls.get(asset.id);
        if (old) URL.revokeObjectURL(old);
        this.urls.delete(asset.id);
        this.forget(asset.id, false);
        this.changed();
    }
    rename (asset, name) {
        const clean = String(name).trim();
        if (!clean) return;
        const old = asset.name;
        asset.name = unusedName(clean, this.list.filter(a => a !== asset).map(a => a.name));
        renameFields(this.vm, [[ASSET_OPCODES.ref, 'ASSET'], [ASSET_OPCODES.menu, 'ASSET']], old, asset.name);
        this.changed();
    }
    remove (asset) {
        this.forget(asset.id, true);
        this.list = this.list.filter(a => a !== asset);
        this.data.delete(asset.id);
        const url = this.urls.get(asset.id);
        if (url) URL.revokeObjectURL(url);
        this.urls.delete(asset.id);
        this.changed();
    }
    move (asset, to) {
        const i = this.list.indexOf(asset);
        if (i < 0) return;
        this.list.splice(i, 1);
        this.list.splice(Math.max(0, Math.min(this.list.length, to)), 0, asset);
        this.changed();
    }
    bytes (asset) { return this.data.get(asset.id) || new Uint8Array(0); }
    text (asset) { return new TextDecoder().decode(this.bytes(asset)); }
    url (asset) {
        let url = this.urls.get(asset.id);
        if (!url) {
            url = URL.createObjectURL(new Blob([this.bytes(asset)], {type: mimeOfExt(asset.ext)}));
            this.urls.set(asset.id, url);
        }
        return url;
    }
    forget (id, gone) {
        const skin = this.skins.get(id);
        this.skins.delete(id);
        const users = this.runtime.targets.filter(t => t.dimodSkin === id);
        if (gone) { users.forEach(t => this.clearSkin(t)); } else if (users.length) {
            const asset = this.list.find(a => a.id === id);
            if (asset) this.skinFor(asset).then(() => users.forEach(t => this.applySkin(t)));
        }
        if (skin) skin.ready.then(skinId => skinId !== null && this.runtime.renderer.destroySkin(skinId));
        const players = this.players.get(id);
        this.players.delete(id);
        if (players) {
            players.forEach(entry => entry.ready.then(playerId => {
                const player = playerId && entry.bank.soundPlayers[playerId];
                if (!player) return;
                player.stop();
                player.dispose();
                delete entry.bank.soundPlayers[playerId];
            }));
        }
    }
    skinFor (asset) {
        const renderer = this.runtime.renderer;
        if (!renderer || asset.kind !== 'image') return Promise.resolve(null);
        let entry = this.skins.get(asset.id);
        if (entry) return entry.ready;
        entry = {skinId: null};
        entry.ready = (asset.ext === 'svg' ?
            Promise.resolve(renderer.createSVGSkin(this.text(asset))) :
            loadImage(this.url(asset)).then(img => renderer.createBitmapSkin(img, 1)))
            .then(skinId => { entry.skinId = skinId; return skinId; }, () => null);
        this.skins.set(asset.id, entry);
        return entry.ready;
    }
    warmSkins () { this.list.forEach(a => a.kind === 'image' && this.skinFor(a)); }
    skinIdOf (target) {
        const skin = target.dimodSkin;
        if (!skin) return null;
        if (typeof skin === 'object') return skin.costume.skinId;
        const entry = this.skins.get(skin);
        return entry ? entry.skinId : null;
    }
    applySkin (target) {
        const skinId = this.skinIdOf(target);
        if (skinId === null || skinId === undefined || !target.renderer || target.isDisposed) return;
        if (target.renderer._allSkins && !target.renderer._allSkins[skinId]) return this.clearSkin(target);
        target.renderer.updateDrawableSkinId(target.drawableID, skinId);
        if (target.visible) target.emitVisualChange();
        this.runtime.requestRedraw();
    }
    showSkin (target, ref) {
        const asset = this.byRef(ref);
        if (!asset || asset.kind !== 'image') return;
        target.dimodSkin = asset.id;
        const entry = this.skins.get(asset.id);
        if (entry && entry.skinId !== null) this.applySkin(target);
        else this.skinFor(asset).then(() => target.dimodSkin === asset.id && this.applySkin(target));
    }
    showCostume (target, costume) { target.dimodSkin = {costume}; this.applySkin(target); }
    clearSkin (target) {
        if (!target.dimodSkin) return;
        target.dimodSkin = null;
        const costume = target.sprite.costumes[target.currentCostume];
        if (!target.renderer || target.isDisposed || !costume) return;
        target.renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
        if (target.visible) target.emitVisualChange();
        this.runtime.requestRedraw();
    }
    skinName (target) {
        const skin = target.dimodSkin;
        if (skin && typeof skin === 'object') return skin.costume.name;
        const asset = skin && this.list.find(a => a.id === skin);
        return asset ? asset.name : '';
    }
    resolveSound (target, ref) {
        const bank = target.sprite && target.sprite.soundBank;
        if (!bank) return null;
        if (ref instanceof AssetRef) {
            const asset = ref.asset;
            if (!asset || asset.kind !== 'sound') return null;
            const entry = this.soundFor(target, asset);
            return entry.id ? {bank, id: entry.id} : entry.ready.then(id => (id ? {bank, id} : null));
        }
        const sound = ref.item;
        if (ref.owner.sprite === target.sprite) return {bank, id: sound.soundId};
        const source = ref.owner.sprite.soundBank && ref.owner.sprite.soundBank.soundPlayers[sound.soundId];
        if (!source || !source.buffer) return null;
        if (!this.borrowed.has(bank)) this.borrowed.set(bank, new Map());
        const cache = this.borrowed.get(bank);
        const known = cache.get(sound.soundId);
        if (known && known.buffer === source.buffer && bank.soundPlayers[known.id]) return {bank, id: known.id};
        if (known && bank.soundPlayers[known.id]) {
            bank.soundPlayers[known.id].stop();
            bank.soundPlayers[known.id].dispose();
            delete bank.soundPlayers[known.id];
        }
        const player = new source.constructor(this.runtime.audioEngine, {id: newId('dimodborrow'), buffer: source.buffer});
        bank.addSoundPlayer(player);
        cache.set(sound.soundId, {id: player.id, buffer: source.buffer});
        return {bank, id: player.id};
    }
    soundFor (target, asset) {
        const bank = target.sprite && target.sprite.soundBank;
        const engine = this.runtime.audioEngine;
        if (!bank || !engine || asset.kind !== 'sound') return {ready: Promise.resolve(null), id: null};
        if (!this.players.has(asset.id)) this.players.set(asset.id, new Map());
        const perSprite = this.players.get(asset.id);
        let entry = perSprite.get(target.sprite);
        if (entry) return entry;
        entry = {bank, id: null};
        entry.ready = engine.decodeSoundPlayer({data: this.bytes(asset).slice()}).then(player => {
            bank.addSoundPlayer(player);
            entry.id = player.id;
            return player.id;
        }, () => null);
        perSprite.set(target.sprite, entry);
        return entry;
    }
    toCostume (asset, name) {
        return new Promise((resolve, reject) => {
            const bytes = this.bytes(asset);
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            costumeUpload(buffer, mimeOfExt(asset.ext), this.vm, costumes => {
                const costume = costumes[0];
                costume.name = name;
                resolve(costume);
            }, reject);
        });
    }
    toSound (asset, name) {
        return new Promise((resolve, reject) => {
            const bytes = this.bytes(asset);
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            soundUpload(buffer, mimeOfExt(asset.ext), this.runtime.storage, sound => {
                sound.name = name;
                resolve(sound);
            }, reject);
        });
    }
}
const installScenePrimitives = (runtime, host) => {
    const p = runtime._primitives;
    const O = SCENE_OPCODES;
    const leave = (util, before) => {
        if (before && !host.inScene(util.target)) util.stopThisScript();
    };
    runtime._hats[O.whenEntered] = {restartExistingThreads: true};
    p[O.menu] = args => args.SCENE;
    p[O.relMenu] = args => args.WHICH;
    p[O.goTo] = (args, util) => { host.goTo(Cast.toString(args.SCENE)); leave(util, true); };
    p[O.goToRel] = (args, util) => { host.goRel(Cast.toString(args.WHICH)); leave(util, true); };
    p[O.current] = () => host.currentScene.name;
    p[O.index] = () => host.list.indexOf(host.currentScene) + 1;
    p[O.count] = () => host.list.length;
    p[O.nameOf] = args => { const s = host.list[Cast.toNumber(args.INDEX) - 1]; return s ? s.name : ''; };
    p[O.add] = (args, util) => {
        const s = host.scene(Cast.toString(args.SCENE));
        if (s) host.addTo(util.target, s.id);
    };
    p[O.remove] = (args, util) => {
        const s = host.scene(Cast.toString(args.SCENE));
        if (s) host.removeFrom(util.target, s.id);
        leave(util, true);
    };
    p[O.isIn] = (args, util) => {
        const s = host.scene(Cast.toString(args.SCENE));
        return !!s && host.inScene(util.target, s.id);
    };
    p[O.names] = () => arrayOf(host.vm, host.names);
    p[O.sprites] = args => {
        const s = host.scene(Cast.toString(args.SCENE));
        return arrayOf(host.vm, s ? host.spritesIn(s.id).map(t => t.getName()) : []);
    };
    p[O.ofSprite] = (args, util) => arrayOf(host.vm, host.scenesOf(util.target).map(id => host.scene(id).name));
    compatBlocks.statementBlocks.push(O.goTo, O.goToRel, O.add, O.remove);
    compatBlocks.outputBlocks.push(O.menu, O.relMenu, O.current, O.index, O.count, O.nameOf, O.isIn,
        O.names, O.sprites, O.ofSprite);
};
const installAssetPrimitives = (runtime, host) => {
    const p = runtime._primitives;
    const O = ASSET_OPCODES;
    const find = args => host.byRef(args.ASSET instanceof AssetRef ? args.ASSET : Cast.toString(args.ASSET));
    p[O.menu] = args => args.ASSET;
    p[O.ref] = args => { const a = host.byRef(Cast.toString(args.ASSET)); return a ? host.ref(a) : Cast.toString(args.ASSET); };
    p[O.setSkin] = (args, util) => host.showSkin(util.target, find(args));
    p[O.clearSkin] = (args, util) => host.clearSkin(util.target);
    p[O.skinName] = (args, util) => host.skinName(util.target);
    p[O.kindMenu] = args => args.KIND;
    p[O.text] = args => { const a = find(args); return a ? host.text(a) : ''; };
    p[O.info] = args => {
        const a = find(args);
        if (!a) return '';
        switch (String(args.PROP)) {
        case 'type': return a.kind;
        case 'format': return a.ext;
        case 'size': return a.size;
        case 'name': return a.name;
        default: return '';
        }
    };
    p[O.exists] = args => !!find(args);
    p[O.count] = args => host.ofKind(Cast.toString(args.KIND)).length;
    p[O.nameOf] = args => {
        const a = host.ofKind(Cast.toString(args.KIND))[Cast.toNumber(args.INDEX) - 1];
        return a ? a.name : '';
    };
    p[O.names] = args => arrayOf(host.vm, host.ofKind(Cast.toString(args.KIND)).map(a => a.name));
    p[O.array] = args => {
        const a = find(args);
        let parsed = [];
        try { parsed = a ? JSON.parse(host.text(a)) : []; } catch (e) { parsed = a ? host.text(a).split(/\r?\n/) : []; }
        return arrayOf(host.vm, Array.isArray(parsed) ? parsed : [parsed]);
    };
    p[O.url] = args => { const a = find(args); return a ? host.url(a) : ''; };
    p[O.write] = args => {
        const text = Cast.toString(args.TEXT);
        const a = find(args);
        if (a) {
            if (a.kind === 'text' || a.kind === 'data') host.replace(a, new TextEncoder().encode(text));
        } else { host.addText(Cast.toString(args.ASSET) || 'asset', text); }
    };
    p[O.costume] = (args, util) => {
        const a = find(args);
        const target = util.target;
        if (!a || a.kind !== 'image' || target.isStage) return undefined;
        const existing = target.getCostumeIndexByName(a.name);
        if (existing >= 0) { target.setCostume(existing); return undefined; }
        return host.toCostume(a, a.name).then(costume => host.vm.addCostume(costume.md5, costume, target.id));
    };
    p[O.backdrop] = args => {
        const a = find(args);
        const stage = runtime.getTargetForStage();
        if (!stage || !a || a.kind !== 'image') return undefined;
        const existing = stage.getCostumeIndexByName(a.name);
        if (existing >= 0) { stage.setCostume(existing); return undefined; }
        return host.toCostume(a, a.name).then(costume => host.vm.addCostume(costume.md5, costume, stage.id));
    };
    p[O.sound] = (args, util) => {
        const a = find(args);
        const target = util.target;
        if (!a || a.kind !== 'sound') return undefined;
        const play = () => p.sound_play({SOUND_MENU: a.name}, util);
        if (target.getSounds().some(s => s.name === a.name)) return play();
        return host.toSound(a, a.name).then(sound => host.vm.addSound(sound, target.id)).then(play);
    };
    compatBlocks.statementBlocks.push(O.write, O.costume, O.backdrop, O.sound, O.setSkin, O.clearSkin);
    compatBlocks.outputBlocks.push(O.menu, O.kindMenu, O.text, O.info, O.exists, O.count, O.nameOf, O.url, O.names, O.array,
        O.ref, O.skinName);
};
const ownerNamed = (runtime, name, self) => {
    const value = Cast.toString(name);
    if (value === MYSELF) return ownerOf(self);
    if (value === STAGE) return runtime.getTargetForStage();
    return runtime.getSpriteTargetByName(value) ||
        (runtime.getTargetForStage() && runtime.getTargetForStage().getName() === value ? runtime.getTargetForStage() : null);
};
const pick = (list, value) => {
    const name = Cast.toString(value);
    const byName = list.find(item => item.name === name);
    if (byName || !list.length || !/^\s*-?\d+(\.\d+)?\s*$/.test(name)) return byName || null;
    const n = Math.round(Number(name));
    return list[(((n - 1) % list.length) + list.length) % list.length];
};
const isTrue = value => value === true || value === 1 || ['true', '1'].includes(Cast.toString(value).toLowerCase());
const isSoundRef = value => value instanceof AssetRef || value instanceof SoundRef;
const SOUND_REF_BLOCKS = {
    sound_play: [(blocks, t, r) => { blocks._removeWaitingSound(t.id, r.id); r.bank.playSound(t, r.id); }, undefined, true],
    sound_playuntildone: [(blocks, t, r) => { blocks._addWaitingSound(t.id, r.id); return r.bank.playSound(t, r.id); }],
    sound_play_at_seconds: [(blocks, t, r, args) => {
        const seconds = Cast.toNumber(args.VALUE);
        if (seconds < 0) return;
        blocks._addWaitingSound(t.id, r.id);
        r.bank.playSound(t, r.id, seconds);
    }, undefined, true],
    sound_play_at_seconds_until_done: [(blocks, t, r, args) => {
        const seconds = Cast.toNumber(args.VALUE);
        if (seconds < 0) return undefined;
        blocks._addWaitingSound(t.id, r.id);
        return r.bank.playSound(t, r.id, seconds);
    }],
    sound_stop: [(blocks, t, r) => r.bank.stop(t, r.id)],
    sound_isSoundPlaying: [(blocks, t, r) => Boolean(r.bank.soundPlayers[r.id] && r.bank.soundPlayers[r.id].isPlaying), false],
    sound_getLength: [(blocks, t, r) => {
        const player = r.bank.soundPlayers[r.id];
        return player && player.buffer ? player.buffer.duration : 0;
    }, 0],
    sound_set_stop_fadeout_to: [(blocks, t, r, args) => {
        const player = r.bank.soundPlayers[r.id];
        if (player) player.stopFadeDecay = Math.max(0, Cast.toNumber(args.VALUE));
    }],
    sound_dimod_setoverlap: [(blocks, t, r, args) => {
        if (!t.sprite.dimodSoundOverlap) t.sprite.dimodSoundOverlap = new Set();
        if (isTrue(args.OVERLAP)) t.sprite.dimodSoundOverlap.add(r.id);
        else t.sprite.dimodSoundOverlap.delete(r.id);
    }]
};
const installMediaPrimitives = (runtime, host, vm) => {
    const p = runtime._primitives;
    p[MEDIA_OPCODES.costumeOf] = (args, util) => {
        const owner = ownerNamed(runtime, args.SPRITE, util.target);
        const costume = owner && pick(owner.getCostumes(), args.COSTUME);
        return costume ? new CostumeRef(owner, costume) : Cast.toString(args.COSTUME);
    };
    p[MEDIA_OPCODES.soundOf] = (args, util) => {
        const owner = ownerNamed(runtime, args.SPRITE, util.target);
        const sound = owner && pick(owner.sprite.sounds, args.SOUND);
        return sound ? new SoundRef(owner, sound) : Cast.toString(args.SOUND);
    };
    compatBlocks.outputBlocks.push(MEDIA_OPCODES.costumeOf, MEDIA_OPCODES.soundOf);
    const sound = runtime.ext_scratch3_sound;
    for (const [opcode, [run, fallback, detach]] of Object.entries(SOUND_REF_BLOCKS)) {
        const original = p[opcode];
        if (!original || original.dimodRefs) continue;
        p[opcode] = (args, util) => {
            if (!isSoundRef(args.SOUND_MENU)) return original(args, util);
            const target = util.target;
            const resolved = host.resolveSound(target, args.SOUND_MENU);
            if (!resolved) return fallback;
            if (!resolved.then) return run(sound, target, resolved, args);
            const later = resolved.then(r => (r && !target.isDisposed ? run(sound, target, r, args) : fallback));
            return detach ? undefined : later;
        };
        p[opcode].dimodRefs = true;
    }
    const looks = runtime.ext_scratch3_looks;
    if (looks && !looks.dimodAssets) {
        looks.dimodAssets = true;
        const {_setCostume: setCostume, _setBackdrop: setBackdrop} = looks;
        const show = (target, ref) => {
            if (ref instanceof AssetRef) {
                if (!ref.asset || ref.kind !== 'image') return false;
                host.showSkin(target, ref);
                return true;
            }
            const own = ref.owner.sprite === target.sprite && target.sprite.costumes.indexOf(ref.item);
            if (own >= 0 && own !== false) target.setCostume(own);
            else host.showCostume(target, ref.item);
            return true;
        };
        const isLook = value => value instanceof AssetRef || value instanceof CostumeRef;
        looks._setCostume = function (target, requested, zero) {
            if (!isLook(requested)) return setCostume.call(this, target, requested, zero);
            show(target, requested);
            return [];
        };
        looks._setBackdrop = function (stage, requested, zero) {
            if (!isLook(requested)) return setBackdrop.call(this, stage, requested, zero);
            if (!show(stage, requested)) return [];
            return runtime.startHats('event_whenbackdropswitchesto', {BACKDROP: requested.name});
        };
        runtime.dimodLook = (target, number) => {
            const skin = target.dimodSkin;
            if (!number) return host.skinName(target);
            if (!skin || typeof skin !== 'object') return target.currentCostume + 1;
            const owner = runtime.targets.find(t => t.isOriginal && t.sprite.costumes.includes(skin.costume));
            return owner ? owner.sprite.costumes.indexOf(skin.costume) + 1 : target.currentCostume + 1;
        };
        for (const opcode of ['looks_costumenumbername', 'looks_backdropnumbername']) {
            const original = runtime._primitives[opcode];
            if (!original) continue;
            runtime._primitives[opcode] = (args, util) => {
                const target = opcode === 'looks_costumenumbername' ? util.target : runtime.getTargetForStage();
                if (!target || !target.dimodSkin) return original(args, util);
                return runtime.dimodLook(target, Cast.toString(args.NUMBER_NAME) === 'number');
            };
        }
        const JSGen = vm.exports && vm.exports.JSGenerator;
        if (JSGen && !JSGen.prototype.dimodLooks) {
            JSGen.prototype.dimodLooks = true;
            const descend = JSGen.prototype.descendInput;
            const LOOKS = {'looks.costumeName': ['target', 0], 'looks.costumeNumber': ['target', 1],
                'looks.backdropName': ['stage', 0], 'looks.backdropNumber': ['stage', 1]};
            JSGen.prototype.descendInput = function (node, ...rest) {
                const input = descend.call(this, node, ...rest);
                const look = node && LOOKS[node.kind];
                if (!look || !input || !input.constructor) return input;
                const [who, number] = look;
                return new input.constructor(
                    `(${who}.dimodSkin ? runtime.dimodLook(${who}, ${number}) : ${input.source})`, input.type);
            };
        }
    }
};
const patchRenderer = (vm, host) => {
    const patch = renderer => {
        if (!renderer || renderer.dimodBorrowed) return;
        renderer.dimodBorrowed = true;
        const destroySkin = renderer.destroySkin;
        renderer.destroySkin = function (skinId) {
            vm.runtime.targets.filter(t => t.dimodSkin && typeof t.dimodSkin === 'object' && t.dimodSkin.costume.skinId === skinId)
                .forEach(t => host.clearSkin(t));
            return destroySkin.call(this, skinId);
        };
    };
    const attach = vm.attachRenderer;
    vm.attachRenderer = function (renderer) { patch(renderer); return attach.call(this, renderer); };
    patch(vm.renderer || vm.runtime.renderer);
};
const patchRenames = vm => {
    const M = MEDIA_OPCODES;
    const rules = [[M.costumeOf, 'SPRITE'], [M.soundOf, 'SPRITE']];
    const wrap = (name, fn) => {
        const original = vm[name];
        if (typeof original !== 'function') return;
        vm[name] = function (...args) {
            const undo = fn(...args);
            const result = original.apply(this, args);
            if (undo) undo();
            return result;
        };
    };
    wrap('renameSprite', (targetId, newName) => {
        const target = vm.runtime.getTargetById(targetId);
        if (!target || target.isStage) return null;
        const old = target.getName();
        return () => renameFields(vm, rules, old, target.getName());
    });
    const assetRename = (opcode, field, list) => (index, newName) => {
        const target = vm.editingTarget;
        const item = target && list(target)[index];
        if (!item) return null;
        const old = item.name;
        const named = block => {
            const sprite = block.fields.SPRITE && block.fields.SPRITE.value;
            return sprite === (target.isStage ? STAGE : target.getName());
        };
        return () => renameFields(vm, [[opcode, field]], old, item.name, named);
    };
    wrap('renameCostume', assetRename(M.costumeOf, 'COSTUME', t => t.getCostumes()));
    wrap('renameSound', assetRename(M.soundOf, 'SOUND', t => t.sprite.sounds));
};
const patchTargets = () => {
    const proto = RenderedTarget.prototype;
    if (proto.__dimodScenesPatched) return;
    proto.__dimodScenesPatched = true;
    for (const method of ['updateAllDrawableProperties', 'setVisible', 'cameraUpdateEvent']) {
        const original = proto[method];
        proto[method] = function (...args) {
            const result = original.apply(this, args);
            const host = this.runtime && this.runtime.dimodScenes;
            if (method === 'updateAllDrawableProperties' && this.dimodSkin && this.runtime.dimodAssets) {
                this.runtime.dimodAssets.applySkin(this);
            }
            if (host && !this.isStage && !host.inScene(this)) this.renderer.updateDrawableVisible(this.drawableID, false);
            return result;
        };
    }
    const setCostume = proto.setCostume;
    proto.setCostume = function (index) { this.dimodSkin = null; return setCostume.call(this, index); };
    const makeClone = proto.makeClone;
    proto.makeClone = function () {
        const clone = makeClone.call(this);
        if (clone && this.dimodSkin && this.runtime.dimodAssets) {
            clone.dimodSkin = this.dimodSkin;
            this.runtime.dimodAssets.applySkin(clone);
        }
        return clone;
    };
};
const patchHats = (runtime, host) => {
    const original = runtime.allScriptsByOpcodeDo.bind(runtime);
    runtime.allScriptsByOpcodeDo = (opcode, f, optTarget) => original(opcode, (script, target) => {
        if (host.inScene(target)) f(script, target);
    }, optTarget);
};
const patchSerialization = (vm, assets) => {
    const serializeAssets = vm.serializeAssets.bind(vm);
    vm.serializeAssets = (...args) => {
        const result = serializeAssets(...args);
        return args.length && args[0] ? result : result.concat(assets.files());
    };
    const deserialize = vm.deserializeProject.bind(vm);
    vm.deserializeProject = (projectJSON, zip) => {
        const scenes = vm.runtime.dimodScenes;
        scenes.loading = true;
        const meta = projectJSON && projectJSON.extensionData ? projectJSON.extensionData[ASSETS_KEY] : null;
        return Promise.resolve(deserialize(projectJSON, zip))
            .then(result => assets.loadFrom(meta, zip).then(() => { assets.warmSkins(); return result; }))
            .finally(() => { scenes.loading = false; });
    };
};
const installScenesVM = (vm, {flagToMain = false} = {}) => {
    if (vm.dimodScenes) return vm.dimodScenes;
    const runtime = vm.runtime;
    const host = new SceneHost(vm);
    const assets = new AssetHost(vm);
    host.flagToMain = flagToMain;
    vm.dimodScenes = runtime.dimodScenes = host;
    vm.dimodAssets = runtime.dimodAssets = assets;
    patchTargets();
    patchHats(runtime, host);
    patchSerialization(vm, assets);
    installScenePrimitives(runtime, host);
    installAssetPrimitives(runtime, assets);
    installMediaPrimitives(runtime, assets, vm);
    patchRenderer(vm, assets);
    patchRenames(vm);
    runtime.on('PROJECT_LOADED', () => host.load());
    let count = -1;
    vm.on('targetsUpdate', () => {
        if (host.loading || runtime.targets.length === count) return;
        count = runtime.targets.length;
        host.assignMissing();
        host.applyAll();
    });
    runtime.on('PROJECT_START', () => {
        assets.warmSkins();
        if (host.flagToMain) host.goTo(host.main, {run: false});
        host.fire(host.currentScene);
    });
    return host;
};
export {spriteListKey, MEDIA_OPCODES, MYSELF, STAGE, CostumeRef, SoundRef, ASSET_OPCODES, ANY, KINDS, REL, SCENE_OPCODES, AssetHost, AssetRef, SceneHost, installScenesVM, kindOfExt, mimeOfExt, ownerOf};
