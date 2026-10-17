import {installTileMapsVM} from './dimod-tilemaps.js';
import {installBasicParticlesVM} from './dimod-particles.js';
import log from './log';
import {installClientBlocksVM} from './dimod-server-blocks';
import {installExtraBlocksVM, installMediaEffectsVM} from './dimod-block-defs';
import {installAnimationVM} from './dimod-animation/runtime';
import {setAnimationMenuVM} from './dimod-animation/blocks';
import {installAnimationCollab} from './dimod-animation/index';
import {installBlockSpaceBlocksVM, installBlockspaceRuntime} from './block-space/runtime';
import {installScenesVM} from './dimod-scenes';
import {setScenesMenuVM} from './dimod-scenes-blocks';
import {installBlockspaceCollab, installConsoleStore, setMenuVM} from './block-space/editor';
import sb3 from 'scratch-vm/src/serialization/sb3';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import {
    patchMissingStage,
    patchSafeStop,
    patchExtensionStorageRoundTrip,
    patchEmitWorkspaceUpdateGuard,
    patchParseProjectOptionsGuard,
    patchMonitorsBeforeTargets,
    patchSpriteLookup,
    patchExtensionProxy,
    patchBlockGraphIntegrity
} from './dimod-vm';
export {patchEmitWorkspaceUpdateGuard, patchExtensionStorageRoundTrip, patchMissingStage, patchMonitorsBeforeTargets, patchParseProjectOptionsGuard, patchSpriteLookup} from './dimod-vm';
import {libraryAssetUrl} from './pm-library-url';
import JSZip from 'jszip';
import {useState, useEffect} from 'react';
const patchServerCodeStorage = vm => {
    if (vm.__dimodServerStorage) return;
    vm.__dimodServerStorage = true;
    vm.runtime.dimodServer = null;
    if (!sb3.__dimodServerWrapped) {
        sb3.__dimodServerWrapped = true;
        const originalSerialize = sb3.serialize;
        sb3.serialize = (runtime, targetId, ...rest) => {
            const json = originalSerialize(runtime, targetId, ...rest);
            if (!targetId && runtime.dimodServer) json.dimodServer = runtime.dimodServer;
            return json;
        };
    }
    const originalDeserialize = vm.deserializeProject.bind(vm);
    vm.deserializeProject = (projectJSON, zip) => {
        const server = projectJSON && typeof projectJSON === 'object' ? projectJSON.dimodServer : null;
        vm.runtime.dimodServer = server && typeof server === 'object' ? server : null;
        return Promise.resolve(originalDeserialize(projectJSON, zip)).then(result => {
            vm.emit('DIMOD_SERVER_CODE_LOADED', vm.runtime.dimodServer);
            return result;
        });
    };
};
const LIBRARY_IMPORT_METHODS = [['addCostume', args => args[1]], ['addBackdrop', args => args[1]], ['addSound', args => args[0]]];
const patchLibraryAssetCorsRetry = vm => {
    if (vm.__dimodLibraryCorsRetry) return;
    vm.__dimodLibraryCorsRetry = true;
    LIBRARY_IMPORT_METHODS.forEach(([method, pickObject]) => {
        if (typeof vm[method] !== 'function') return;
        const original = vm[method].bind(vm);
        vm[method] = (...args) => Promise.resolve()
            .then(() => original(...args))
            .catch(async err => {
                const object = pickObject(args);
                const libraryId = object && object.fromPenguinModLibrary === true && object.libraryId;
                if (!libraryId) throw err;
                log.warn(`Library asset import failed, retrying past the browser cache: ${libraryId}`, err);
                try { await fetch(libraryAssetUrl(libraryId), {cache: 'reload'}); } catch (e) { throw err; }
                return original(...args);
            });
    });
};
const patchClearEffectsTint = () => {
    if (RenderedTarget.prototype.__dimodTintClear) return;
    RenderedTarget.prototype.__dimodTintClear = true;
    const original = RenderedTarget.prototype.clearEffects;
    RenderedTarget.prototype.clearEffects = function (...args) {
        const result = original.apply(this, args);
        if (this.effects && Object.prototype.hasOwnProperty.call(this.effects, 'tintColor')) {
            this.effects.tintColor = 0xffffff + 1;
        }
        return result;
    };
};
const patchVM = vm => {
    patchServerCodeStorage(vm);
    patchMissingStage(vm);
    patchSafeStop(vm);
    patchExtensionStorageRoundTrip(vm);
    patchEmitWorkspaceUpdateGuard(vm);
    patchParseProjectOptionsGuard(vm);
    patchMonitorsBeforeTargets(vm);
    patchSpriteLookup(vm);
    patchClearEffectsTint();
    patchBlockGraphIntegrity(vm);
    patchLibraryAssetCorsRetry(vm);
    patchExtensionProxy(vm);
    installClientBlocksVM(vm);
    installExtraBlocksVM(vm);
    installMediaEffectsVM(vm);
    installAnimationVM(vm);
    setAnimationMenuVM(vm);
    installBasicParticlesVM(vm);
    installTileMapsVM(vm);
    installBlockSpaceBlocksVM(vm);
    installBlockspaceRuntime(vm);
    installScenesVM(vm);
    setScenesMenuVM(vm);
    setMenuVM(vm);
    installBlockspaceCollab(vm);
    installAnimationCollab(vm);
    installConsoleStore(vm);
};
const DEFAULT_TIMEOUT_MS = 25000;
const loadExtensionURLWithTimeout = (vm, url, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    let settled = false;
    const realLoad = vm.extensionManager.loadExtensionURL(url).then(result => { settled = true; return result; }, err => { settled = true; throw err; });
    const timeout = new Promise((resolve, reject) => {
        setTimeout(() => {
            if (settled) return;
            log.warn(`Custom extension load timed out after ${timeoutMs}ms, releasing it: ${url}`);
            try { vm.extensionManager._failedLoadingExtensionScript(new Error('Timed out waiting to register')); } catch (e) {
            }
            reject(new Error(
                'This extension took too long to load and may not be responding. If it needs to run ' +
                'without a sandbox, make sure "Run extension without sandbox" is checked and try again.'
            ));
        }, timeoutMs);
    });
    return Promise.race([realLoad, timeout]);
};
let pendingResolve = null;
const waitForUserChoice = () => new Promise(resolve => { pendingResolve = resolve; });
const resolveComplexSpriteGate = proceed => {
    if (!pendingResolve) return;
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(proceed);
};
const targetsHaveComplexSprite = targets => Array.isArray(targets) && targets.some(t => {
    const stored = t && t.extensionData && t.extensionData.dimodBlockspace;
    return Boolean(stored && stored.complex);
});
const jsonTextHasComplexSprite = text => {
    try { return targetsHaveComplexSprite(JSON.parse(text).targets); } catch (e) { return false; }
};
const projectDataHasComplexSprite = async projectData => {
    if (!projectData) return false;
    if (typeof projectData === 'string') return jsonTextHasComplexSprite(projectData);
    const isBinary = projectData instanceof ArrayBuffer || ArrayBuffer.isView(projectData) ||
        (typeof Blob !== 'undefined' && projectData instanceof Blob);
    if (!isBinary) return targetsHaveComplexSprite(projectData.targets);
    try {
        const zip = await JSZip.loadAsync(projectData);
        const entry = zip.file('project.json');
        if (!entry) return false;
        return jsonTextHasComplexSprite(await entry.async('string'));
    } catch (e) { return false; }
};
const KEY = 'dimod-stage-scale';
const EVENT = 'dimod:stage-scale';
const MIN = 0.4;
const MAX = 1.75;
const clamp = value => Math.min(MAX, Math.max(MIN, value));
const read = () => {
    try {
        const stored = parseFloat(localStorage.getItem(KEY));
        return isFinite(stored) && stored > 0 ? clamp(stored) : 1;
    } catch (e) { return 1; }
};
let scale = read();
const getStageScale = () => scale;
const setStageScale = next => {
    const value = clamp(next);
    if (value === scale) return scale;
    scale = value;
    try { localStorage.setItem(KEY, String(value)); } catch (e) {
    }
    window.dispatchEvent(new Event(EVENT));
    return value;
};
const useStageScale = () => {
    const [value, setValue] = useState(scale);
    useEffect(() => {
        const onChange = () => setValue(getStageScale());
        window.addEventListener(EVENT, onChange);
        onChange();
        return () => window.removeEventListener(EVENT, onChange);
    }, []);
    return value;
};
export {MAX as STAGE_SCALE_MAX, MIN as STAGE_SCALE_MIN, loadExtensionURLWithTimeout as extensionLoadTimeoutDefault, getStageScale, loadExtensionURLWithTimeout, patchClearEffectsTint, patchLibraryAssetCorsRetry, patchServerCodeStorage, patchVM, projectDataHasComplexSprite, resolveComplexSpriteGate, setStageScale, useStageScale, patchVM as vmPatchesDefault, waitForUserChoice};
