import JSZip from 'jszip';
import {askRename} from './dimod-ui';
import {broadcastSoundRename, broadcastSoundOrder, setAssetOrder, broadcastCostumeRename, broadcastCostumeOrder} from './dimod-collab';
import {animationsOf} from './dimod-animation/runtime';
import {normalizeAnim, serializeAnim, uniqueName, makeAnimId} from './dimod-animation/core';
import {exportAnimFile} from './dimod-animation/editor';
import {costumeUpload, soundUpload} from './file-uploader';
import {libraryApi} from './block-space/editor';
const NO_BROADCAST = () => {};
const animationList = target => (target.sprite ? animationsOf(target.sprite) : []);
const animationHost = target => target.runtime.dimodAnimations;
const KINDS = {
    costume: {
        kind: 'costume',
        list: target => target.getCostumes(),
        del: (vm, i) => vm.deleteCostume(i),
        dup: (vm, i) => vm.duplicateCostume(i),
        reorder: (vm, id, from, to) => vm.reorderCostume(id, from, to),
        setOrder: (vm, target, objs) => setAssetOrder(vm, target, 'costume', objs),
        bOrder: broadcastCostumeOrder,
        bRename: broadcastCostumeRename,
        rename: (target, i, n) => target.renameCostume(i, n)
    },
    sound: {
        kind: 'sound',
        list: target => target.sprite.sounds,
        del: (vm, i) => vm.deleteSound(i),
        dup: (vm, i) => vm.duplicateSound(i),
        reorder: (vm, id, from, to) => vm.reorderSound(id, from, to),
        setOrder: (vm, target, objs) => setAssetOrder(vm, target, 'sound', objs),
        bOrder: broadcastSoundOrder,
        bRename: broadcastSoundRename,
        rename: (target, i, n) => target.renameSound(i, n)
    },
    animation: {
        kind: 'animation',
        list: animationList,
        del: (vm, i) => {
            const target = vm.editingTarget;
            const host = target && animationHost(target);
            const list = target ? animationList(target) : [];
            const doc = list[i];
            if (!host || !doc) return null;
            host.setAnimations(target.sprite, list.filter(d => d !== doc));
            vm.runtime.emitProjectChanged();
            return () => {
                const now = animationList(target).slice();
                now.splice(Math.min(i, now.length), 0, doc);
                host.setAnimations(target.sprite, now);
                vm.runtime.emitProjectChanged();
            };
        },
        dup: (vm, i) => {
            const target = vm.editingTarget;
            const host = target && animationHost(target);
            const list = target ? animationList(target) : [];
            const doc = list[i];
            if (!host || !doc) return;
            const copy = normalizeAnim(JSON.parse(serializeAnim(doc)));
            copy.id = makeAnimId();
            copy.name = uniqueName(doc.name, new Set(list.filter(d => d !== doc).map(d => d.name)));
            const next = list.slice();
            next.splice(i + 1, 0, copy);
            host.setAnimations(target.sprite, next);
            vm.runtime.emitProjectChanged();
        },
        reorder: NO_BROADCAST,
        setOrder: (vm, target, objs) => {
            animationHost(target).setAnimations(target.sprite, objs);
            vm.runtime.emitProjectChanged();
        },
        bOrder: NO_BROADCAST,
        bRename: NO_BROADCAST,
        rename: (target, i, n) => {
            const list = animationList(target);
            const doc = list[i];
            if (!doc) return;
            const taken = new Set(list.filter((d, j) => j !== i).map(d => d.name));
            doc.name = uniqueName(String(n || 'animation').trim() || 'animation', taken);
            animationHost(target).setAnimations(target.sprite, list.slice());
            target.runtime.emitProjectChanged();
        }
    }
};
const ascending = indexes => Array.from(new Set(indexes)).sort((a, b) => a - b);
const bulkDelete = (vm, kind, indexes) => {
    const k = KINDS[kind];
    const target = vm.editingTarget;
    if (!target) return null;
    const restores = [];
    ascending(indexes).reverse().forEach(i => {
        const restore = k.del(vm, i);
        if (!restore) return;
        restores.push(restore);
    });
    if (restores.length === 0) return null;
    return () => restores.slice().reverse().forEach(fn => fn());
};
const bulkDuplicate = async (vm, kind, indexes) => {
    const k = KINDS[kind];
    const target = vm.editingTarget;
    if (!target) return [];
    const originals = ascending(indexes).map(i => k.list(target)[i]).filter(Boolean);
    if (originals.length === 0) return [];
    const last = originals[originals.length - 1];
    const before = new Set(k.list(target));
    for (let n = 0; n < originals.length; n++) {
        const from = k.list(target).indexOf(originals[n]);
        if (from === -1) continue;
        await k.dup(vm, from);
        const arr = k.list(target).slice();
        const [copy] = arr.splice(from + 1, 1);
        const dest = arr.indexOf(last) + 1 + n;
        if (dest !== from + 1) { arr.splice(dest, 0, copy); k.setOrder(vm, target, arr); }
    }
    k.bOrder(vm, target.id);
    const now = k.list(target);
    return now.map((item, i) => (before.has(item) ? -1 : i)).filter(i => i !== -1);
};
const patternNames = (count, pattern) => {
    const base = (pattern || '').trim();
    if (!base) return [];
    return Array.from({length: count}, (_, n) => {
        if (base.includes('{n}')) return base.split('{n}').join(String(n + 1));
        return count > 1 ? `${base}${n + 1}` : base;
    });
};
const bulkRename = (vm, kind, indexes, pattern) => {
    const k = KINDS[kind];
    const target = vm.editingTarget;
    const base = (pattern || '').trim();
    if (!target || !base) return;
    const list = ascending(indexes);
    list.forEach((i, n) => {
        const item = k.list(target)[i];
        if (!item) return;
        const oldName = item.name;
        const name = patternNames(list.length, base)[n];
        k.rename(target, i, name);
        const newName = k.list(target)[i].name;
        k.bRename(vm, target.id, i, oldName, newName, k.list(target)[i]);
    });
    vm.emitTargetsUpdate();
};
const groupOrder = (count, picked, dragged, newIndex) => {
    const all = Array.from({length: count}, (_, i) => i);
    const set = new Set(picked);
    const rest = all.filter(i => !set.has(i));
    const target = Math.max(0, Math.min(count - 1, newIndex));
    const insertAt = rest.filter(i => (target > dragged ? i <= target : i < target)).length;
    return rest.slice(0, insertAt).concat(ascending(picked), rest.slice(insertAt));
};
const applyOrder = (vm, k, target, finalObjs, movedObjs, track) => {
    const cur = k.list(target);
    if (finalObjs.length === cur.length && finalObjs.some((o, i) => o !== cur[i])) {
        k.setOrder(vm, target, finalObjs);
        k.bOrder(vm, target.id);
    }
    const list = k.list(target);
    return {selected: movedObjs.map(o => list.indexOf(o)).filter(i => i !== -1), tracked: track ? list.indexOf(track) : -1};
};
const bulkMove = (vm, kind, indexes, where, track) => {
    const k = KINDS[kind];
    const target = vm.editingTarget;
    if (!target) return {selected: indexes, tracked: -1};
    const list = k.list(target).slice();
    const picked = ascending(indexes).map(i => list[i]).filter(Boolean);
    const pickedSet = new Set(picked);
    const rest = list.filter(o => !pickedSet.has(o));
    return applyOrder(vm, k, target, where === 'start' ? picked.concat(rest) : rest.concat(picked), picked, track);
};
const bulkReorderGroup = (vm, kind, indexes, dragged, newIndex, track) => {
    const k = KINDS[kind];
    const target = vm.editingTarget;
    if (!target) return {selected: indexes, tracked: -1};
    const list = k.list(target).slice();
    const order = groupOrder(list.length, ascending(indexes), dragged, newIndex);
    const picked = ascending(indexes).map(i => list[i]).filter(Boolean);
    return applyOrder(vm, k, target, order.map(i => list[i]), picked, track);
};
const DIVIDER = '//';
const folderOf = name => { const i = name.indexOf(DIVIDER); return i === -1 || i === 0 ? null : name.substring(0, i); };
const withFolder = (name, folder) => {
    const i = name.indexOf(DIVIDER);
    const bare = i === -1 || i === 0 ? name : name.substring(i + DIVIDER.length);
    return folder === null ? bare : `${folder}${DIVIDER}${bare}`;
};
const assetView = (vm, kind) => {
    const view = vm.dimodAssetView;
    const target = vm.editingTarget;
    if (!Array.isArray(view) || !target) return null;
    const list = KINDS[kind].list(target);
    const ok = view.every(row => {
        const d = row && row.name;
        if (!d || typeof d !== 'object') return false;
        if (typeof d.folder === 'string') return true;
        return list[d.realIndex] && list[d.realIndex].name === d.realName;
    });
    return ok ? view : null;
};
const realIndexAt = (view, pos) => {
    if (!view) return pos;
    const d = view[pos] && view[pos].name;
    return d && typeof d.realIndex === 'number' ? d.realIndex : null;
};
const viewPosOf = (view, real) => (view ? view.findIndex(r => r.name.realIndex === real) : real);
const folderGroupDrop = (vm, k, view, indexes, draggedPos, newPos, track) => {
    const target = vm.editingTarget;
    const list = k.list(target).slice();
    const picked = ascending(indexes).map(i => list[i]).filter(Boolean);
    const pickedSet = new Set(picked);
    const rest = list.filter(o => !pickedSet.has(o));
    const last = view.length - 1;
    newPos = Math.max(0, Math.min(last, newPos));
    const noop = {selected: indexes, tracked: track ? list.indexOf(track) : -1};
    if (newPos === draggedPos) return noop;
    const down = newPos > draggedPos;
    const row = view[newPos].name;
    let at;
    let folder = null;
    if (newPos === 0) { at = 0; } else if (newPos === last) { at = rest.length; } else if (typeof row.realIndex === 'number') {
        const anchor = list[row.realIndex];
        if (pickedSet.has(anchor)) return noop;
        folder = folderOf(anchor.name);
        at = rest.indexOf(anchor) + (down ? 1 : 0);
    } else {
        const kids = view[newPos].items.map(r => list[r.name.realIndex]).filter(o => o && !pickedSet.has(o));
        if (!kids.length) return noop;
        if (!down) { at = rest.indexOf(kids[0]); } else if (row.folderOpen) { at = rest.indexOf(kids[0]); folder = row.folder; } else { at = rest.indexOf(kids[kids.length - 1]) + 1; }
    }
    const result = applyOrder(vm, k, target, rest.slice(0, at).concat(picked, rest.slice(at)), picked, track);
    let renamed = false;
    picked.forEach(o => {
        if (folderOf(o.name) === folder) return;
        const i = k.list(target).indexOf(o);
        const oldName = o.name;
        k.rename(target, i, withFolder(oldName, folder));
        k.bRename(vm, target.id, i, oldName, k.list(target)[i].name, k.list(target)[i]);
        renamed = true;
    });
    if (renamed) vm.emitTargetsUpdate();
    return result;
};
const bulkDropGroup = (vm, kind, indexes, draggedPos, newPos, track) => {
    const view = assetView(vm, kind);
    if (view) return folderGroupDrop(vm, KINDS[kind], view, indexes, draggedPos, newPos, track);
    return bulkReorderGroup(vm, kind, indexes, draggedPos, newPos, track);
};
const safeName = (name, used) => {
    const clean = String(name).replace(/[\\/:*?"<>|]+/g, '_') || 'asset';
    let out = clean;
    let n = 2;
    while (used.has(out)) out = `${clean} (${n++})`;
    used.add(out);
    return out;
};
const bulkExportZip = async (vm, kind, indexes) => {
    const k = KINDS[kind];
    const target = vm.editingTarget;
    if (kind === 'animation') {
        ascending(indexes).forEach(i => {
            const doc = k.list(target)[i];
            if (doc) exportAnimFile(doc, target);
        });
        return null;
    }
    const zip = new JSZip();
    const used = new Set();
    ascending(indexes).forEach(i => {
        const item = k.list(target)[i];
        if (!item) return;
        const data = kind === 'costume' ? vm.getExportedCostume(item, true) : item.asset.data;
        zip.file(`${safeName(item.name, used)}.${item.asset.dataFormat}`, data);
    });
    return zip.generateAsync({type: 'blob'});
};
const nextSelection = (selected, anchor, index, event) => {
    if (event.shiftKey && anchor !== null && anchor !== undefined) {
        const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
        const range = [];
        for (let i = lo; i <= hi; i++) range.push(i);
        return {selected: ascending(selected.concat(range)), anchor};
    }
    const has = selected.includes(index);
    return {selected: has ? selected.filter(i => i !== index) : ascending(selected.concat(index)), anchor: index};
};
const NOUNS = {costume: 'costume', sound: 'sound', animation: 'animation'};
const DELETED_LABELS = {costume: 'Costumes', sound: 'Sounds', animation: 'Animations'};
const bulkActionsFor = ({vm, kind, selected, count, setSelected, clear, dispatchUpdateRestore, downloadBlob, onMoved, getTracked}) => {
    const noun = NOUNS[kind] || kind;
    const plural = n => `${n} ${noun}${n === 1 ? '' : 's'}`;
    const actions = [
        {label: 'All', title: `Select every ${noun}`, onClick: () => setSelected(Array.from({length: count}, (_, i) => i))},
        {
            label: 'Duplicate',
            title: `Duplicate ${plural(selected.length)}... copies go below the selection`,
            onClick: () => {
                bulkDuplicate(vm, kind, selected.slice()).then(copies => {
                    if (copies.length) setSelected(copies);
                });
            }
        },
        {
            label: 'Rename',
            title: `Rename ${plural(selected.length)} (use {n} for the number)`,
            onClick: () => {
                askRename({
                    title: `Rename ${plural(selected.length)}`,
                    initial: noun,
                    hint: 'Use {n} for the number, e.g. walk{n}. Without it, numbers are added to the end.',
                    preview: text => patternNames(selected.length, text)
                }).then(pattern => {
                    if (pattern) bulkRename(vm, kind, selected, pattern);
                });
            }
        },
        ...(kind === 'costume' || kind === 'sound' ? [{
            label: 'Send',
            title: `Copy ${plural(selected.length)} into another sprite`,
            onClick: e => openSendMenu(vm, kind, selected, {x: e.clientX, y: e.clientY})
        }] : []),
        {label: 'Top', title: 'Move the selection to the start', onClick: () => onMoved(bulkMove(vm, kind, selected, 'start', getTracked()))},
        {label: 'Bottom', title: 'Move the selection to the end', onClick: () => onMoved(bulkMove(vm, kind, selected, 'end', getTracked()))},
        {
            label: 'Download',
            title: kind === 'animation' ?
                `Download ${plural(selected.length)}` :
                `Download ${plural(selected.length)} as a .zip`,
            onClick: () => bulkExportZip(vm, kind, selected).then(blob => {
                if (blob) downloadBlob(`${noun}s.zip`, blob);
            })
        },
        {
            label: 'Delete',
            danger: true,
            wide: true,
            title: `Delete ${plural(selected.length)}`,
            onClick: () => {
                const restoreFun = bulkDelete(vm, kind, selected);
                clear();
                if (restoreFun) { dispatchUpdateRestore({restoreFun, deletedItem: DELETED_LABELS[kind] || kind}); }
            }
        }
    ];
    return actions;
};
const API_BASE = process.env.DIMOD_API_BASE;
const SITE = process.env.DIMOD_SITE_ORIGIN || '';
const get = path => fetch(`${API_BASE}${path}`).then(res => res.json().then(data => {
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}));
const qs = params => {
    const s = new URLSearchParams();
    Object.keys(params).forEach(k => {
        if (params[k] !== '' && params[k] !== 0 && params[k] !== null && typeof params[k] !== 'undefined') s.set(k, params[k]);
    });
    const text = s.toString();
    return text ? `?${text}` : '';
};
const toEntry = row => {
    const base = {id: row.id, dimodLibraryId: row.id, name: row.name, tags: row.tags || [], _key: `dimod-${row.id}`};
    if (row.kind === 'sprite') return {...base, fromDimodLibrary: true, spriteFileUrl: row.file_url, rawURL: row.thumb_url};
    const entry = {...base, dataFormat: row.data_format, fromPenguinModLibrary: true, libraryFilePage: row.file_url};
    if (row.kind === 'sound') return {...entry, rawURL: row.thumb_url || null,
        soundLength: typeof row.sound_ms === 'number' ? row.sound_ms : null};
    return {
        ...entry,
        rawURL: row.thumb_url,
        bitmapResolution: row.bitmap_resolution,
        rotationCenterX: row.rotation_center_x,
        rotationCenterY: row.rotation_center_y
    };
};
const assetBrowser = (kind, map = items => items) => ({
    fetch: ({q, tag, page}) => get(`/library-assets/browse${qs({kind, q, tag, page})}`)
        .then(data => ({items: map(data.items.map(toEntry)), more: data.more})),
    tagCounts: () => get(`/library-assets/tags${qs({kind})}`).then(rows => {
        const out = {};
        rows.forEach(r => { out[r.name] = r.count; });
        return out;
    }, () => ({})),
    pageUrl: `${SITE}/library?kind=${kind}`
});
const codeBrowser = map => ({
    fetch: ({q, tag, page}) => libraryApi.list({q, tag, page}).then(data => ({items: data.items.map(map), more: data.more})),
    tagCounts: null,
    pageUrl: `${SITE}/library?kind=code`
});
const MIME = {
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg'
};
const used = id => fetch(`${API_BASE}/library-assets/${id}/use`, {method: 'POST'}).catch(() => null);
const fetchBytes = url => fetch(url, {cache: 'reload'}).then(res => {
    if (!res.ok) throw new Error(`Couldn't download it (${res.status})`);
    return res.arrayBuffer();
});
const asCostumes = (vm, entry) => fetchBytes(entry.libraryFilePage).then(buffer => new Promise((resolve, reject) => {
    costumeUpload(buffer, MIME[entry.dataFormat] || 'image/png', vm, costumes => {
        costumes.forEach((c, i) => { c.name = `${entry.name}${i ? i + 1 : ''}`; });
        resolve(costumes);
    }, reject);
}));
const addDimodLibraryEntry = (vm, kind, entry) => {
    let done;
    if (kind === 'sprite') {
        done = fetchBytes(entry.spriteFileUrl)
            .then(buffer => vm.addSprite(buffer));
    } else if (kind === 'backdrop') {
        done = asCostumes(vm, entry).then(costumes => costumes.reduce(
            (p, c) => p.then(() => vm.addBackdrop(c.md5, c)),
            Promise.resolve()));
    } else if (kind === 'costume') {
        const targetId = vm.editingTarget && vm.editingTarget.id;
        done = asCostumes(vm, entry).then(costumes => costumes.reduce(
            (p, c) => p.then(() => vm.addCostume(c.md5, c, targetId)),
            Promise.resolve()));
    } else if (kind === 'sound') {
        const targetId = vm.editingTarget && vm.editingTarget.id;
        done = fetchBytes(entry.libraryFilePage).then(buffer => new Promise((resolve, reject) => {
            soundUpload(buffer, MIME[entry.dataFormat] || 'audio/mpeg', vm.runtime.storage, sound => {
                sound.name = entry.name;
                resolve(vm.addSound(sound, targetId));
            }, reject);
        }));
    } else { return Promise.reject(new Error(`Can't add a ${kind} here`)); }
    return done.then(() => { used(entry.dimodLibraryId); });
};
const addDimodLibraryItem = (vm, id) => get(`/library-assets/${encodeURIComponent(id)}`)
    .then(row => addDimodLibraryEntry(vm, row.kind, toEntry(row)).then(() => row));
const bulkSources = {};
const registerBulkSource = (kind, fn) => {
    bulkSources[kind] = fn;
    return () => {
        if (bulkSources[kind] === fn) delete bulkSources[kind];
    };
};
const sendAssets = (vm, kind, indexes, targetId) => {
    const share = index => (kind === 'costume' ? vm.shareCostumeToTarget(index, targetId) : vm.shareSoundToTarget(index, targetId));
    return indexes.slice().sort((a, b) => a - b).reduce((chain, index) => chain.then(() => share(index)), Promise.resolve());
};
const shareAssetsToTarget = (vm, kind, dragIndex, targetId) => {
    const real = realIndexAt(assetView(vm, kind), dragIndex);
    const bulk = bulkSources[kind] ? bulkSources[kind]() : [];
    return sendAssets(vm, kind, bulk.length > 1 && bulk.includes(real) ? bulk : [real], targetId);
};
const openSendMenu = (vm, kind, indexes, at) => {
    const old = document.getElementById('dimod-send-menu');
    if (old) old.remove();
    const phone = window.innerWidth < 600;
    const menu = document.createElement('div');
    menu.id = 'dimod-send-menu';
    menu.style.cssText = 'position:fixed;z-index:100000;background:Canvas;color:CanvasText;border:1px solid rgba(128,128,128,.45);' +
        'box-shadow:0 6px 24px rgba(0,0,0,.35);overflow:auto;font:13px sans-serif;' + (phone ?
            'left:0;right:0;bottom:0;max-height:60vh;border-radius:14px 14px 0 0;padding:6px 6px calc(10px + env(safe-area-inset-bottom))' :
            `left:${Math.max(4, Math.min(at.x, window.innerWidth - 220))}px;top:${Math.max(4, Math.min(at.y, window.innerHeight - 320))}px;` +
            'width:210px;max-height:312px;border-radius:10px;padding:4px');
    const close = () => {
        menu.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', onKey, true);
    };
    const outside = e => {
        if (!menu.contains(e.target)) close();
    };
    const onKey = e => {
        if (e.key === 'Escape') close();
    };
    const head = document.createElement('div');
    head.textContent = `Send ${indexes.length} ${kind}${indexes.length === 1 ? '' : 's'} to...`;
    head.style.cssText = 'padding:6px 10px;font-weight:700;opacity:.75';
    menu.appendChild(head);
    vm.runtime.targets.filter(target => target.isOriginal).forEach(target => {
        const row = document.createElement('button');
        row.textContent = target.isStage ? 'Backdrop (stage)' : target.sprite.name;
        row.style.cssText = 'display:block;width:100%;text-align:left;border:none;background:transparent;color:inherit;' +
            'padding:10px;border-radius:7px;cursor:pointer;font:inherit;touch-action:manipulation';
        row.onpointerenter = () => { row.style.background = 'rgba(128,128,128,.22)'; };
        row.onpointerleave = () => { row.style.background = 'transparent'; };
        row.onclick = () => { close(); sendAssets(vm, kind, indexes, target.id); };
        menu.appendChild(row);
    });
    document.body.appendChild(menu);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
};
export {registerBulkSource, shareAssetsToTarget, openSendMenu, addDimodLibraryEntry, addDimodLibraryItem, assetBrowser, assetView, bulkActionsFor, bulkDelete, bulkDropGroup, bulkDuplicate, bulkExportZip, bulkMove, bulkRename, bulkReorderGroup, codeBrowser, groupOrder, nextSelection, patternNames, realIndexAt, toEntry, viewPosOf};
