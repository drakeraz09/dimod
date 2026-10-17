import sb3 from 'scratch-vm/src/serialization/sb3';
import Blocks from 'scratch-vm/src/engine/blocks';
import adapter from 'scratch-vm/src/engine/adapter';
const patchEmitWorkspaceUpdateGuard = vm => {
    if (vm.__dimodWorkspaceUpdateGuarded) return;
    vm.__dimodWorkspaceUpdateGuarded = true;
    const original = vm.emitWorkspaceUpdate.bind(vm);
    vm.emitWorkspaceUpdate = (...args) => {
        if (!vm.editingTarget) {
            console.warn('Skipped emitWorkspaceUpdate: no editingTarget yet (see dimod-vm-patches.js)');
            return;
        }
        if (!vm.runtime.getTargetForStage()) {
            console.warn('Skipped emitWorkspaceUpdate: no Stage target in this project (see dimod-vm-patches.js)');
            return;
        }
        return original(...args);
    };
};
const patchParseProjectOptionsGuard = vm => {
    const runtime = vm.runtime;
    if (!runtime || runtime.__dimodParseProjectOptionsGuarded) return;
    runtime.__dimodParseProjectOptionsGuarded = true;
    const original = runtime.parseProjectOptions.bind(runtime);
    runtime.parseProjectOptions = optComment => {
        if (!optComment && !runtime.getTargetForStage()) {
            console.warn('Skipped parseProjectOptions: no stage target yet (see dimod-vm-patches.js)');
            return;
        }
        return original(optComment);
    };
};
const patchMonitorsBeforeTargets = vm => {
    const runtime = vm.runtime;
    if (!runtime || runtime.__dimodMonitorGuarded) return;
    runtime.__dimodMonitorGuarded = true;
    const original = runtime.addMonitorScript.bind(runtime);
    runtime.addMonitorScript = (topBlockId, optTarget) => {
        if (!optTarget && !runtime.getEditingTarget()) return;
        return original(topBlockId, optTarget);
    };
    runtime.on('PROJECT_LOADED', () => {
        if (runtime.monitorBlocks) runtime.monitorBlocks.resetCache();
    });
};
const patchSpriteLookup = vm => {
    const runtime = vm.runtime;
    if (!runtime || runtime.__dimodSpriteLookupPatched) return;
    runtime.__dimodSpriteLookupPatched = true;
    runtime.getSpriteTargetByName = spriteName => {
        const targets = runtime.targets;
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            if (!target.isStage && target.sprite && target.sprite.name === spriteName) return target;
        }
    };
};
const patchExtensionStorageRoundTrip = vm => {
    if (vm.__dimodExtensionStorageKept) return;
    vm.__dimodExtensionStorageKept = true;
    const runtime = vm.runtime;
    const fillMissing = (store, from) => {
        if (!store || !from) return store;
        Object.keys(from).forEach(key => {
            if (!(key in store)) store[key] = from[key];
        });
        return store;
    };
    if (!sb3.__dimodExtensionStorageWrapped) {
        sb3.__dimodExtensionStorageWrapped = true;
        const originalSerialize = sb3.serialize;
        sb3.serialize = (rt, targetId, ...rest) => {
            const json = originalSerialize(rt, targetId, ...rest);
            if (targetId || !rt || !json || typeof json !== 'object') return json;
            json.extensionData = fillMissing(json.extensionData || {}, rt.extensionStorage);
            const byId = new Map((rt.targets || []).map(target => [target.id, target]));
            (json.targets || []).forEach(serialized => {
                const target = byId.get(serialized.id);
                if (!target || !target.extensionStorage) return;
                serialized.extensionData = fillMissing(serialized.extensionData || {}, target.extensionStorage);
            });
            return json;
        };
    }
    let pending = null;
    const originalDeserialize = vm.deserializeProject.bind(vm);
    vm.deserializeProject = (projectJSON, zip) => {
        pending = null;
        if (projectJSON && typeof projectJSON === 'object') {
            pending = {
                runtime: projectJSON.extensionData || projectJSON.extensionStorage || null,
                targets: (projectJSON.targets || [])
                    .map(t => ({id: t.id, name: t.name, data: t.extensionData || t.extensionStorage || null}))
                    .filter(t => t.data)
            };
        }
        return originalDeserialize(projectJSON, zip);
    };
    runtime.on('PROJECT_LOADED', () => {
        if (!pending) return;
        const saved = pending;
        pending = null;
        if (saved.runtime) fillMissing(runtime.extensionStorage, saved.runtime);
        saved.targets.forEach(entry => {
            const target = runtime.getTargetById(entry.id) ||
                runtime.targets.find(t => t.isOriginal !== false && t.getName && t.getName() === entry.name);
            if (!target) return;
            if (!target.extensionStorage) target.extensionStorage = {};
            fillMissing(target.extensionStorage, entry.data);
        });
    });
};
const REPAIRED_STAGE_ID = 'dimodRepairedStage00';
const BLANK_STAGE = () => ({
    id: REPAIRED_STAGE_ID,
    isStage: true,
    name: 'Stage',
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [{
        assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
        name: 'backdrop1',
        md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
        dataFormat: 'svg',
        rotationCenterX: 240,
        rotationCenterY: 180
    }],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: 'on',
    textToSpeechLanguage: null
});
const patchSafeStop = vm => {
    const runtime = vm.runtime;
    if (runtime.__dimodSafeStop) return;
    runtime.__dimodSafeStop = true;
    const originalStop = runtime.stop;
    runtime.stop = function (...args) {
        const emit = this.emit;
        this.emit = function (event, ...rest) {
            const listeners = this.listeners(event);
            for (const listener of listeners) {
                try { listener.apply(this, rest); } catch (e) { console.warn(`A "${String(event)}" listener failed while the project was stopping`, e); }
            }
            return listeners.length > 0;
        };
        try { return originalStop.apply(this, args); } finally {
            if (Object.prototype.hasOwnProperty.call(this, 'emit')) {
                if (emit === Object.getPrototypeOf(this).emit) delete this.emit;
                else this.emit = emit;
            }
        }
    };
};
const patchMissingStage = vm => {
    if (vm.__dimodMissingStageGuarded) return;
    vm.__dimodMissingStageGuarded = true;
    const original = vm.deserializeProject.bind(vm);
    vm.deserializeProject = (projectJSON, zip) => {
        vm.__dimodRepairedOnLoad = null;
        if (projectJSON && typeof projectJSON === 'object' && Array.isArray(projectJSON.targets)) {
            const targets = projectJSON.targets.filter(t => t && typeof t === 'object' &&
                Object.prototype.hasOwnProperty.call(t, 'name'));
            if (targets.length === 0) {
                const error = new Error('This project file has no sprites or Stage in it, so it may be damaged. ' +
                    'Nothing was loaded, and nothing was saved over it.');
                error.dimodEmptyProject = true;
                return Promise.reject(error);
            }
            if (!targets.some(t => t.isStage)) {
                console.warn(`dimod: this project has no Stage; added a blank one (${targets.length} sprite(s) kept)`);
                const stage = BLANK_STAGE();
                const lowest = Math.min(0, ...targets.map(t => Number(t.layerOrder) || 0));
                stage.layerOrder = lowest - 1;
                projectJSON.targets.unshift(stage);
                vm.__dimodRepairedOnLoad = 'stage';
            }
        }
        return original(projectJSON, zip);
    };
    const originalLoad = vm.loadProject.bind(vm);
    vm.loadProject = input => {
        const before = vm.__dimodProjectFullyLoaded;
        vm.__dimodProjectFullyLoaded = false;
        return originalLoad(input).then(result => {
            vm.__dimodProjectFullyLoaded = true;
            if (vm.__dimodRepairedOnLoad) { setTimeout(() => vm.emit('PROJECT_CHANGED'), 500); }
            return result;
        }, error => {
            if (error && error.dimodEmptyProject) vm.__dimodProjectFullyLoaded = before;
            throw error;
        });
    };
};
const unsaveableProjectReason = vm => {
    const targets = ((vm && vm.runtime && vm.runtime.targets) || []).filter(t => t.isOriginal);
    if (!targets.length) return 'the project has nothing in it (it may still be loading)';
    if (!targets.some(t => t.isStage)) return 'the project has no Stage';
    return null;
};
const toTopOfGroup = (renderer, drawableId, group) => {
    const g = renderer._layerGroups[group];
    if (!g) return;
    const end = renderer._endIndexForKnownLayerGroup(g);
    renderer.setDrawableOrder(drawableId, end - 1, group);
};
const PROXY = 'https://lol.dimod.org/proxy?url=';
const canProxy = url => {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        return parsed.origin !== location.origin && !url.startsWith(PROXY);
    } catch (e) { return false; }
};
const patchExtensionProxy = vm => {
    const manager = vm.extensionManager;
    const security = manager && manager.securityManager;
    if (!security || security.__dimodExtensionProxy) return;
    security.__dimodExtensionProxy = true;
    const original = security.rewriteExtensionURL.bind(security);
    security.rewriteExtensionURL = async extensionURL => {
        const url = await original(extensionURL);
        if (!canProxy(url)) return url;
        try { await fetch(url); return url; } catch (directError) {
            const proxied = PROXY + encodeURIComponent(url);
            let problem;
            try {
                const res = await fetch(proxied);
                if (res.ok) {
                    console.warn(`Extension couldn't be fetched directly, loading it through the proxy: ${url}`);
                    return proxied;
                }
                problem = new Error(
                    `Couldn't load the extension from ${url}: that site doesn't let other sites read it, ` +
                    `and Dimod's proxy turned it down (${(await res.text()).slice(0, 120) || res.status}). ` +
                    'The URL has to end in .js and be served as JavaScript.'
                );
            } catch (proxyError) { problem = directError; }
            try { manager._failedLoadingExtensionScript(problem); } catch (e) {
            }
            throw problem;
        }
    };
};
const LOG_PREFIX = 'dimod block graph:';
const revisions = new WeakMap();
const blocksRevision = container => revisions.get(container) || 0;
const tracksBlocksRevision = () => !!Blocks.prototype.__dimodGraphIntegrity;
const xmlPaths = new WeakMap();
const inputEdges = input => {
    if (!input) return [];
    if (input.block && input.block === input.shadow) return [input.block];
    return [input.block, input.shadow].filter(Boolean);
};
const containsBlock = (blocks, ancestorId, blockId) => {
    const seen = new Set();
    const stack = [ancestorId];
    while (stack.length) {
        const id = stack.pop();
        if (id === blockId) return true;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const block = blocks[id];
        if (!block) continue;
        if (block.next) stack.push(block.next);
        for (const name in block.inputs) stack.push(...inputEdges(block.inputs[name]));
    }
    return false;
};
const inputHolding = (parent, childId) => {
    if (!parent || !parent.inputs) return;
    for (const name in parent.inputs) {
        if (parent.inputs[name] && parent.inputs[name].block === childId) return name;
    }
};
const lastInStack = (blocks, id) => {
    const seen = new Set();
    let current = blocks[id];
    while (current && current.next && blocks[current.next] && !seen.has(current.next)) {
        seen.add(current.id);
        current = blocks[current.next];
    }
    return current;
};
const repairBlockGraph = container => {
    const blocks = container && container._blocks;
    if (!blocks) return 0;
    let fixes = 0;
    const scripts = Array.isArray(container._scripts) ? container._scripts : [];
    const heldBy = new Map();
    for (const id in blocks) {
        const block = blocks[id];
        if (!block) continue;
        const children = [block.next];
        for (const name in block.inputs) children.push(...inputEdges(block.inputs[name]));
        for (const child of children) {
            if (child && blocks[child] && blocks[child].parent === id && !heldBy.has(child)) heldBy.set(child, id);
        }
    }
    const seenScripts = new Set();
    const keptScripts = [];
    for (const id of scripts) {
        if (!blocks[id] || seenScripts.has(id)) { fixes++; continue; }
        seenScripts.add(id);
        if (heldBy.has(id)) { blocks[id].topLevel = false; fixes++; continue; }
        keptScripts.push(id);
    }
    if (keptScripts.length !== scripts.length) container._scripts = keptScripts;
    const linksTo = (parent, childId) => parent && (parent.next === childId ||
        Object.keys(parent.inputs || {}).some(n => parent.inputs[n] &&
            (parent.inputs[n].block === childId || parent.inputs[n].shadow === childId)));
    const ownedElsewhere = (id, childId) => {
        const child = blocks[childId];
        return child && child.parent && child.parent !== id && linksTo(blocks[child.parent], childId);
    };
    for (const id in blocks) {
        const block = blocks[id];
        if (!block) continue;
        if (block.next && ownedElsewhere(id, block.next)) { block.next = null; fixes++; }
        for (const name in block.inputs) {
            const input = block.inputs[name];
            if (!input) continue;
            if (input.block && ownedElsewhere(id, input.block)) {
                input.block = input.shadow && input.shadow !== input.block ? input.shadow : null;
                if (input.shadow && !input.block) input.shadow = null;
                fixes++;
            }
            if (input.shadow && input.shadow !== input.block && ownedElsewhere(id, input.shadow)) {
                input.shadow = null;
                fixes++;
            }
        }
    }
    const visited = new Set();
    const claim = (parentId, childId, stack) => {
        if (!childId || !blocks[childId]) return true;
        if (visited.has(childId)) return false;
        visited.add(childId);
        if (blocks[childId].parent !== parentId) { blocks[childId].parent = parentId; fixes++; }
        if (blocks[childId].topLevel) { blocks[childId].topLevel = false; fixes++; }
        stack.push(childId);
        return true;
    };
    const walk = rootId => {
        const root = blocks[rootId];
        if (!root || visited.has(rootId)) return;
        visited.add(rootId);
        const stack = [rootId];
        while (stack.length) {
            const id = stack.pop();
            const block = blocks[id];
            if (block.next && !claim(id, block.next, stack)) { block.next = null; fixes++; }
            for (const name in block.inputs) {
                const input = block.inputs[name];
                if (!input) continue;
                if (input.block && input.block === input.shadow) {
                    if (!claim(id, input.block, stack)) { input.block = null; input.shadow = null; fixes++; }
                    continue;
                }
                if (input.block && !claim(id, input.block, stack)) {
                    input.block = input.shadow && !visited.has(input.shadow) ? input.shadow : null;
                    fixes++;
                }
                if (input.shadow && input.shadow !== input.block && !claim(id, input.shadow, stack)) {
                    input.shadow = null;
                    fixes++;
                }
            }
        }
    };
    const topLevel = [];
    for (const id of container._scripts) {
        if (visited.has(id)) { fixes++; continue; }
        const block = blocks[id];
        if (block && block.parent) { block.parent = null; fixes++; }
        topLevel.push(id);
        walk(id);
    }
    if (topLevel.length !== container._scripts.length) container._scripts = topLevel;
    for (const id in blocks) {
        const block = blocks[id];
        if (!block || visited.has(id)) continue;
        const parent = block.parent && blocks[block.parent];
        if (!linksTo(parent, id)) walk(id);
    }
    for (const id in blocks) {
        if (visited.has(id) || !blocks[id]) continue;
        blocks[id].parent = null;
        fixes++;
        walk(id);
    }
    if (fixes) {
        console.warn(`${LOG_PREFIX} repaired ${fixes} broken link(s) in a block container`);
        if (typeof container.resetCache === 'function') container.resetCache();
    }
    return fixes;
};
const installBlocksPatches = () => {
    const proto = Blocks.prototype;
    if (proto.__dimodGraphIntegrity) return;
    proto.__dimodGraphIntegrity = true;
    const originalResetCache = proto.resetCache;
    proto.resetCache = function (...args) {
        revisions.set(this, (revisions.get(this) || 0) + 1);
        return originalResetCache.apply(this, args);
    };
    const originalMoveBlock = proto.moveBlock;
    proto.moveBlock = function (e) {
        const blocks = this._blocks;
        const block = e && blocks[e.id];
        if (!block) return;
        if (typeof e.newParent !== 'undefined' && e.newParent !== null) {
            if (!blocks[e.newParent]) {
                console.warn(`${LOG_PREFIX} not moving ${e.id} under missing block ${e.newParent}`);
                return;
            }
            if (containsBlock(blocks, e.id, e.newParent)) {
                console.warn(`${LOG_PREFIX} not moving ${e.id} under its own descendant ${e.newParent}`);
                return;
            }
        }
        const fixed = {...e};
        const realParent = block.parent && blocks[block.parent];
        if (realParent) {
            fixed.oldParent = block.parent;
            fixed.oldInput = inputHolding(realParent, e.id);
            if (typeof fixed.oldInput === 'undefined' && realParent.next !== e.id) {
                delete fixed.oldParent;
                block.parent = null;
            }
        } else {
            delete fixed.oldParent;
            delete fixed.oldInput;
            if (block.parent) block.parent = null;
        }
        if (e.oldParent && e.oldParent !== fixed.oldParent && blocks[e.oldParent]) {
            const stale = blocks[e.oldParent];
            if (stale.next === e.id) stale.next = null;
            const staleInput = inputHolding(stale, e.id);
            if (typeof staleInput !== 'undefined') {
                stale.inputs[staleInput].block = stale.inputs[staleInput].shadow === e.id ?
                    null : stale.inputs[staleInput].shadow;
            }
        }
        let displaced = null;
        if (typeof fixed.newParent !== 'undefined' && fixed.newParent !== null) {
            const newParent = blocks[fixed.newParent];
            if (typeof fixed.newInput === 'undefined') {
                if (newParent.next && newParent.next !== e.id && blocks[newParent.next]) displaced = newParent.next;
            } else {
                const input = newParent.inputs[fixed.newInput];
                if (input && input.block && input.block !== e.id && input.block !== input.shadow &&
                    blocks[input.block]) displaced = input.block;
            }
        }
        originalMoveBlock.call(this, fixed);
        if (displaced && blocks[displaced] && blocks[displaced].parent === fixed.newParent) {
            const occupant = blocks[displaced];
            const tail = typeof fixed.newInput === 'undefined' ? lastInStack(blocks, e.id) : null;
            if (tail && !tail.next && tail.id !== displaced && !containsBlock(blocks, displaced, tail.id)) {
                tail.next = displaced;
                occupant.parent = tail.id;
            } else {
                occupant.parent = null;
                occupant.topLevel = true;
                occupant.x = (blocks[e.id].x || 0) + 40;
                occupant.y = (blocks[e.id].y || 0) + 40;
                this._addScript(displaced);
            }
            this.resetCache();
            this.emitProjectChanged();
        }
    };
    const originalBlocklyListen = proto.blocklyListen;
    proto.blocklyListen = function (e, ...rest) {
        if (!e || e.type !== 'create' || !e.xml) return originalBlocklyListen.call(this, e, ...rest);
        if (this.forceNoGlow || (this.runtime && this.runtime.flyoutBlocks === this)) {
            return originalBlocklyListen.call(this, e, ...rest);
        }
        let newBlocks = [];
        try { newBlocks = adapter(e); } catch (err) {
        }
        const clash = newBlocks.find(b => b && !b.shadow && this._blocks[b.id]);
        if (clash) {
            console.warn(`${LOG_PREFIX} ignoring a create for block ${clash.id}, which this sprite already has`);
            return;
        }
        return originalBlocklyListen.call(this, e, ...rest);
    };
    const originalBlockToXML = proto.blockToXML;
    proto.blockToXML = function (blockId, comments) {
        let path = xmlPaths.get(this);
        if (!path) { path = new Set(); xmlPaths.set(this, path); }
        if (path.has(blockId)) { console.warn(`${LOG_PREFIX} loop at block ${blockId} while writing XML - cut`); return ''; }
        path.add(blockId);
        try { return originalBlockToXML.call(this, blockId, comments); } finally { path.delete(blockId); }
    };
    const originalToXML = proto.toXML;
    proto.toXML = function (...args) { repairBlockGraph(this); return originalToXML.apply(this, args); };
};
const patchBlockGraphIntegrity = vm => {
    installBlocksPatches();
    if (!vm || vm.__dimodBlockGraphIntegrity) return;
    vm.__dimodBlockGraphIntegrity = true;
    const originalInstallTargets = vm.installTargets.bind(vm);
    vm.installTargets = (targets, ...rest) => {
        if (Array.isArray(targets)) {
            targets.forEach(target => {
                try {
                    if (target && target.blocks) repairBlockGraph(target.blocks);
                } catch (e) { console.warn(`${LOG_PREFIX} repair failed`, e); }
            });
        }
        return originalInstallTargets(targets, ...rest);
    };
};
export {patchBlockGraphIntegrity as blockGraphIntegrityDefault, blocksRevision, patchExtensionProxy as extensionProxyDefault, patchBlockGraphIntegrity, patchEmitWorkspaceUpdateGuard, patchExtensionProxy, patchExtensionStorageRoundTrip, patchMissingStage, patchMonitorsBeforeTargets, patchParseProjectOptionsGuard, patchSafeStop, patchSpriteLookup, repairBlockGraph, toTopOfGroup, tracksBlocksRevision, unsaveableProjectReason};
