import {loadExtensionURLWithTimeout} from './dimod-vm-patches';
import log from './log';
import {useState, useEffect} from 'react';
import {activateTab, ANIMATIONS_TAB_INDEX, BLOCKS_TAB_INDEX, COSTUMES_TAB_INDEX, FILES_TAB_INDEX, SERVER_TAB_INDEX, SOUNDS_TAB_INDEX, VARIABLES_TAB_INDEX} from '../reducers/editor-tab';
import WorkspaceQuerier from '../addons/addons/middle-click-popup/WorkspaceQuerier.js';
import {BlockTypeInfo} from '../addons/addons/middle-click-popup/BlockTypeInfo.js';
import {findBlockspaces} from './block-space/runtime';
import {openBlockspace} from './block-space/editor';
import {setBlockspaceFocus} from '../reducers/blockspace';
import {openSpriteLibrary, openExtensionLibrary, openCostumeLibrary, openBackdropLibrary, openSoundLibrary, openSoundRecorder, openFontsModal, openSettingsModal, openRestorePointModal} from '../reducers/modals';
import {setStageSize} from '../reducers/stage-size';
import {setFullScreen} from '../reducers/mode';
import {emptySprite} from './empty-assets';
import downloadBlob from './download-blob';
import {broadcastTargetCreate} from './dimod-collab';
import {STAGE_SIZE_MODES} from './layout-constants';
import {askAlert, askConfirm, askPrompt, CODE_THEMES, setMonacoPref, STUDIO_COLOURS, STUDIO_STYLES} from './dimod-ui';
const LIVE = new URLSearchParams(location.search).has('livetests');
const RECENT_KEY = 'dimod:palette-recent';
const recentIds = () => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
};
const rememberItem = id => {
    if (/^(block|use):/.test(id)) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter(r => r !== id)].slice(0, 8))); } catch (e) {
    }
};
const DEFAULT_EXTENSIONS = [
    {id: 'SPcomments', url: 'https://sharkpools-extensions.vercel.app/extension-code/Better-Comments.js'}
];
const HIDDEN_CATEGORY_IDS = new Set([...DEFAULT_EXTENSIONS.map(ext => ext.id), 'jgDev']);
const hideFromPalette = categories => categories.filter(category => !HIDDEN_CATEGORY_IDS.has(category.id));
const isEditor = () => {
    const store = window.ReduxStore;
    if (!store) return false;
    const {scratchGui} = store.getState();
    return Boolean(scratchGui && scratchGui.mode && !scratchGui.mode.isPlayerOnly);
};
let loading = false;
const ensureLoaded = async vm => {
    if (loading || !isEditor()) return;
    loading = true;
    try {
        for (const ext of DEFAULT_EXTENSIONS) {
            if (vm.extensionManager.isExtensionLoaded(ext.id)) continue;
            try { await loadExtensionURLWithTimeout(vm, ext.url); } catch (err) { log.warn(`Couldn't load the default extension ${ext.id}`, err); }
        }
    } finally { loading = false; }
};
const installDefaultExtensions = vm => {
    const onLoaded = () => ensureLoaded(vm);
    vm.runtime.on('PROJECT_LOADED', onLoaded);
    if (vm.runtime.targets.length) onLoaded();
    return () => vm.runtime.removeListener('PROJECT_LOADED', onLoaded);
};
const EVENT$1 = 'dimod:focus-mode';
let focused = false;
const isFocusMode = () => focused;
const setFocusMode = value => {
    const next = Boolean(value);
    if (next === focused) return;
    focused = next;
    if (next) { document.documentElement.setAttribute('data-dimod-focus', '1'); } else { document.documentElement.removeAttribute('data-dimod-focus'); }
    window.dispatchEvent(new Event(EVENT$1));
};
const toggleFocusMode = () => setFocusMode(!focused);
const useFocusMode = () => {
    const [value, setValue] = useState(focused);
    useEffect(() => {
        const onChange = () => setValue(isFocusMode());
        window.addEventListener(EVENT$1, onChange);
        onChange();
        return () => window.removeEventListener(EVENT$1, onChange);
    }, []);
    return value;
};
const store = () => window.ReduxStore;
const getBlockly = () => window.ScratchBlocks || null;
const getWorkspace = () => {
    const Blockly = getBlockly();
    return (Blockly && Blockly.getMainWorkspace && Blockly.getMainWorkspace()) || null;
};
const showTab = index => {
    const s = store();
    if (s) s.dispatch(activateTab(index));
};
const showBlocks = () => showTab(BLOCKS_TAB_INDEX);
const switchToTarget = (vm, targetId) => {
    if (!targetId || (vm.editingTarget && vm.editingTarget.id === targetId)) return;
    vm.setEditingTarget(targetId);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (probe, timeoutMs = 3000) => {
    const start = Date.now();
    for (;;) {
        const value = probe();
        if (value) return value;
        if (Date.now() - start > timeoutMs) return null;
        await sleep(40);
    }
};
const waitForBlock = (blockId, targetId, vm) => waitFor(() => {
    if (vm.editingTarget && targetId && vm.editingTarget.id !== targetId) return null;
    const workspace = getWorkspace();
    return workspace && workspace.getBlockById(blockId);
});
const flash = block => {
    const root = block && block.getSvgRoot && block.getSvgRoot();
    if (!root) return;
    root.classList.remove('dimod-flash');
    void root.getBoundingClientRect();
    root.classList.add('dimod-flash');
    setTimeout(() => root.classList.remove('dimod-flash'), 1600);
};
const revealBlock = async (vm, targetId, blockId) => {
    switchToTarget(vm, targetId);
    showBlocks();
    const block = await waitForBlock(blockId, targetId, vm);
    if (!block) return false;
    await sleep(80);
    const workspace = getWorkspace();
    if (!workspace) return false;
    const root = block.getRootBlock ? block.getRootBlock() : block;
    workspace.centerOnBlock(root.id);
    if (block.select) block.select();
    flash(root);
    return true;
};
const deleteStack = async (vm, targetId, blockId) => {
    switchToTarget(vm, targetId);
    const block = await waitForBlock(blockId, targetId, vm);
    const Blockly = getBlockly();
    if (!block || !Blockly) return false;
    Blockly.Events.setGroup(true);
    try { block.dispose(false, true); } finally { Blockly.Events.setGroup(false); }
    return true;
};
const deleteVariable = async (vm, targetId, variableId) => {
    switchToTarget(vm, targetId);
    const workspace = await waitFor(() => {
        const ws = getWorkspace();
        return ws && ws.getVariableById(variableId) ? ws : null;
    });
    if (!workspace) return false;
    workspace.deleteVariableById(variableId);
    return true;
};
let pendingSelect = null;
const takePendingSelect = (kind, targetId) => {
    const pending = pendingSelect;
    if (!pending || pending.kind !== kind || pending.targetId !== targetId ||
        Date.now() - pending.at > 3000) { return null; }
    pendingSelect = null;
    return pending.index;
};
const showCostume = (vm, targetId, index) => {
    switchToTarget(vm, targetId);
    const target = vm.runtime.getTargetById(targetId);
    if (target && target.getCostumes()[index]) target.setCostume(index);
    showTab(COSTUMES_TAB_INDEX);
};
const showSound = (vm, targetId, index) => {
    switchToTarget(vm, targetId);
    pendingSelect = {kind: 'sound', targetId, index, at: Date.now()};
    showTab(SOUNDS_TAB_INDEX);
    setTimeout(() => { window.dispatchEvent(new CustomEvent('dimod:select-sound', {detail: {targetId, index}})); }, 60);
};
const showVariables = () => showTab(VARIABLES_TAB_INDEX);
const makeBlockLabeler = () => {
    const labels = new Map();
    try {
        const workspace = getWorkspace();
        const flyout = workspace && workspace.getFlyout();
        if (flyout) {
            for (const block of flyout.getWorkspace().getTopBlocks(false)) {
                if (block.getField('VARIABLE') || block.getField('LIST')) continue;
                if (!labels.has(block.type)) labels.set(block.type, block.toString(40, '()').replace(/\s+/g, ' ').trim());
            }
        }
    } catch (e) {
    }
    return opcode => labels.get(opcode) || null;
};
const CORE_CATEGORIES = new Set([
    'motion', 'looks', 'sound', 'event', 'control', 'sensing', 'operator', 'data', 'procedures',
    'argument', 'math', 'text', 'colour', 'note', 'matrix', 'pen', 'music', 'videoSensing',
    'text2speech', 'translate', 'makeymakey', 'microbit', 'wedo2', 'boost', 'ev3', 'gdxfor', 'faceSensing'
]);
const isHatOpcode = (runtime, opcode) => Boolean(
    (runtime._hats && runtime._hats[opcode]) ||
    opcode === 'procedures_definition' ||
    opcode === 'procedures_definition_return'
);
const fieldValue = (block, name) => { const field = block.fields && block.fields[name]; return field ? field.value : undefined; };
const fieldId = (block, name) => { const field = block.fields && block.fields[name]; return field ? field.id : undefined; };
const originalTargets = runtime => runtime.targets.filter(t => t.isOriginal);
const targetName = target => (target.isStage ? 'Stage' : target.getName());
const codeText = target => {
    let text = '';
    try {
        const dimod = target.sprite && target.sprite.dimod;
        if (dimod && dimod.source) text += dimod.source;
        if (target.extensionData) text += JSON.stringify(target.extensionData);
    } catch (e) {
    }
    return text;
};
const stackLength = (blocks, startId) => {
    let count = 0;
    let id = startId;
    const seen = new Set();
    while (id && blocks[id] && !seen.has(id)) { seen.add(id); count++; id = blocks[id].next; }
    return count;
};
const procCodeOfDefinition = (blocks, definition) => {
    const input = definition.inputs && definition.inputs.custom_block;
    const proto = input && blocks[input.block];
    return proto && proto.mutation ? proto.mutation.proccode : null;
};
const readableProccode = proccode => String(proccode)
    .replace(/%[sbn]/g, '()')
    .replace(/\s+/g, ' ')
    .trim();
const MBP_ID = 'SPmbpCST';
const globalProcedures = (vm, targets) => {
    const out = new Map();
    for (const target of targets) {
        const stored = target.extensionStorage && target.extensionStorage[MBP_ID];
        if (!stored || typeof stored !== 'object') continue;
        for (const proccode of Object.keys(stored)) {
            if (stored[proccode] && stored[proccode].global === true) out.set(proccode, target.id);
        }
    }
    const live = vm.globalBlocksCache;
    if (live && typeof live === 'object') {
        for (const proccode of Object.keys(live)) {
            if (live[proccode] && live[proccode].id) out.set(proccode, live[proccode].id);
        }
    }
    return out;
};
const buildIndex = vm => {
    const runtime = vm.runtime;
    const targets = originalTargets(runtime);
    const stage = runtime.getTargetForStage();
    const definitions = [];
    const calls = [];
    const variableUses = new Map();
    const variableNameUses = new Set();
    const broadcastSends = new Map();
    const broadcastReceives = new Map();
    const loose = [];
    const emptyScripts = [];
    const unknown = [];
    let dynamicBroadcast = false;
    const push = (map, key, entry) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(entry);
    };
    for (const target of targets) {
        const blocks = target.blocks._blocks;
        for (const blockId of Object.keys(blocks)) {
            const block = blocks[blockId];
            if (!block) continue;
            const where = {targetId: target.id, blockId};
            const opcode = block.opcode;
            const varId = fieldId(block, 'VARIABLE');
            if (varId) push(variableUses, varId, where);
            const listId = fieldId(block, 'LIST');
            if (listId) push(variableUses, listId, where);
            if (opcode === 'sensing_of') {
                const property = fieldValue(block, 'PROPERTY');
                if (property) variableNameUses.add(property);
            }
            if (opcode === 'procedures_definition' || opcode === 'procedures_definition_return') {
                const proccode = procCodeOfDefinition(blocks, block);
                if (proccode) definitions.push({...where, proccode});
            } else if (opcode === 'procedures_call') {
                const proccode = block.mutation && block.mutation.proccode;
                if (proccode) calls.push({...where, proccode});
            }
            if (opcode === 'event_whenbroadcastreceived') {
                const name = fieldValue(block, 'BROADCAST_OPTION');
                if (name) push(broadcastReceives, name, where);
            } else if (opcode === 'event_broadcast' || opcode === 'event_broadcastandwait') {
                const input = block.inputs && block.inputs.BROADCAST_INPUT;
                const menu = input && blocks[input.shadow];
                if (input && input.block !== input.shadow) { dynamicBroadcast = true; } else if (menu) {
                    const name = fieldValue(menu, 'BROADCAST_OPTION');
                    if (name) push(broadcastSends, name, where);
                }
            }
            if (block.shadow) continue;
            if (block.topLevel) {
                if (isHatOpcode(runtime, opcode)) {
                    if (!block.next) emptyScripts.push({...where, opcode});
                } else { loose.push({...where, opcode, length: stackLength(blocks, blockId)}); }
            }
            const prefix = opcode.indexOf('_') > 0 ? opcode.slice(0, opcode.indexOf('_')) : opcode;
            if (
                !CORE_CATEGORIES.has(prefix) &&
                !(runtime._primitives && runtime._primitives[opcode]) &&
                !(runtime._hats && runtime._hats[opcode])
            ) { unknown.push({...where, opcode}); }
        }
    }
    const monitorVisible = id => {
        try {
            const record = runtime._monitorState && runtime._monitorState.get(id);
            return Boolean(record && record.get('visible'));
        } catch (e) { return false; }
    };
    const variables = [];
    for (const target of targets) {
        for (const id of Object.keys(target.variables)) {
            const variable = target.variables[id];
            if (variable.type === 'broadcast_msg') continue;
            variables.push({
                id,
                name: variable.name,
                isList: variable.type === 'list',
                isCloud: Boolean(variable.isCloud),
                isGlobal: target.isStage,
                targetId: target.id,
                targetName: targetName(target),
                monitored: monitorVisible(id)
            });
        }
    }
    return {
        runtime,
        stage,
        targets,
        targetName,
        codeText,
        definitions,
        calls,
        globalProcedures: globalProcedures(vm, targets),
        variables,
        variableUses,
        variableNameUses,
        broadcastSends,
        broadcastReceives,
        dynamicBroadcast,
        loose,
        emptyScripts,
        unknown
    };
};
const findIssues = (vm, labelOf) => {
    const index = buildIndex(vm);
    const nameOfBlock = opcode => {
        if (opcode === 'data_variable') return 'variable';
        if (opcode === 'data_listcontents') return 'list';
        return (labelOf && labelOf(opcode)) || opcode;
    };
    const {runtime} = index;
    const issues = [];
    const nameOf = id => { const target = runtime.getTargetById(id); return target ? targetName(target) : ''; };
    const codeByTarget = new Map(index.targets.map(t => [t.id, codeText(t)]));
    const allCode = Array.from(codeByTarget.values()).join('\n');
    const mentionedInCode = name => Boolean(name) && allCode.indexOf(name) !== -1;
    for (const variable of index.variables) {
        if (variable.isCloud) continue;
        if (index.variableUses.has(variable.id)) continue;
        if (variable.monitored) continue;
        if (index.variableNameUses.has(variable.name)) continue;
        if (mentionedInCode(variable.name)) continue;
        const what = variable.isList ? 'List' : 'Variable';
        issues.push({
            id: `unused-var:${variable.id}`,
            kind: variable.isList ? 'unused-list' : 'unused-variable',
            severity: 'info',
            targetId: variable.targetId,
            targetName: variable.targetName,
            variableId: variable.id,
            title: `${what} "${variable.name}" is never used`,
            detail: variable.isGlobal ? 'For all sprites. No block, monitor or code refers to it.' :
                `Only in ${variable.targetName}. No block, monitor or code refers to it.`,
            fix: 'delete'
        });
    }
    const definedBy = new Map();
    for (const def of index.definitions) {
        if (!definedBy.has(def.targetId)) definedBy.set(def.targetId, new Set());
        definedBy.get(def.targetId).add(def.proccode);
    }
    const calledBy = new Map();
    for (const call of index.calls) {
        if (!calledBy.has(call.targetId)) calledBy.set(call.targetId, new Set());
        calledBy.get(call.targetId).add(call.proccode);
    }
    const calledAnywhere = new Set(index.calls.map(call => call.proccode));
    const definedAnywhere = new Set(index.definitions.map(def => def.proccode));
    for (const def of index.definitions) {
        const target = runtime.getTargetById(def.targetId);
        const isComplex = Boolean(target && target.sprite && target.sprite.dimod && target.sprite.dimod.complex);
        if (isComplex) continue;
        const called = calledBy.get(def.targetId);
        if (called && called.has(def.proccode)) continue;
        if (index.globalProcedures.has(def.proccode) && calledAnywhere.has(def.proccode)) continue;
        issues.push({
            id: `unused-proc:${def.blockId}`,
            kind: 'unused-custom-block',
            severity: 'info',
            targetId: def.targetId,
            targetName: nameOf(def.targetId),
            blockId: def.blockId,
            title: `Custom block "${readableProccode(def.proccode)}" is never called`,
            detail: `Defined in ${nameOf(def.targetId)}.`,
            fix: 'delete-block'
        });
    }
    for (const call of index.calls) {
        const defined = definedBy.get(call.targetId);
        if (defined && defined.has(call.proccode)) continue;
        if (index.globalProcedures.has(call.proccode) && definedAnywhere.has(call.proccode)) continue;
        issues.push({
            id: `missing-def:${call.blockId}`,
            kind: 'missing-definition',
            severity: 'warn',
            targetId: call.targetId,
            targetName: nameOf(call.targetId),
            blockId: call.blockId,
            title: `"${readableProccode(call.proccode)}" is called but not defined`,
            detail: `In ${nameOf(call.targetId)}. The call does nothing.`
        });
    }
    const unknownByTarget = new Map();
    for (const entry of index.unknown) {
        const key = `${entry.targetId}:${entry.opcode}`;
        if (!unknownByTarget.has(key)) unknownByTarget.set(key, entry);
    }
    for (const entry of unknownByTarget.values()) {
        issues.push({
            id: `unknown:${entry.blockId}`,
            kind: 'unknown-block',
            severity: 'warn',
            targetId: entry.targetId,
            targetName: nameOf(entry.targetId),
            blockId: entry.blockId,
            title: `Block "${entry.opcode}" needs an extension that isn't loaded`,
            detail: `In ${nameOf(entry.targetId)}. Add its extension from the extensions button.`
        });
    }
    for (const [name, sends] of index.broadcastSends) {
        if (index.broadcastReceives.has(name) || mentionedInCode(name)) continue;
        issues.push({
            id: `no-listener:${name}`,
            kind: 'broadcast-no-listener',
            severity: 'info',
            targetId: sends[0].targetId,
            targetName: nameOf(sends[0].targetId),
            blockId: sends[0].blockId,
            title: `Message "${name}" is sent but nothing receives it`,
            detail: `Sent ${sends.length} time${sends.length === 1 ? '' : 's'}.`
        });
    }
    if (!index.dynamicBroadcast) {
        for (const [name, receives] of index.broadcastReceives) {
            if (index.broadcastSends.has(name) || mentionedInCode(name)) continue;
            issues.push({
                id: `no-sender:${name}`,
                kind: 'broadcast-no-sender',
                severity: 'info',
                targetId: receives[0].targetId,
                targetName: nameOf(receives[0].targetId),
                blockId: receives[0].blockId,
                title: `Message "${name}" is received but never sent`,
                detail: 'That script never starts, unless a server or code sends it.'
            });
        }
    }
    for (const stack of index.loose) {
        issues.push({
            id: `loose:${stack.blockId}`,
            kind: 'loose-stack',
            severity: 'info',
            targetId: stack.targetId,
            targetName: nameOf(stack.targetId),
            blockId: stack.blockId,
            title: stack.length === 1 ? `"${nameOfBlock(stack.opcode)}" is loose and never runs` :
                `A loose stack starting with "${nameOfBlock(stack.opcode)}" never runs (${stack.length} blocks)`,
            detail: `In ${nameOf(stack.targetId)}. It isn't under a hat block.`,
            fix: 'delete-block'
        });
    }
    for (const script of index.emptyScripts) {
        if (script.opcode.startsWith('procedures_definition')) continue;
        issues.push({
            id: `empty:${script.blockId}`,
            kind: 'empty-script',
            severity: 'info',
            targetId: script.targetId,
            targetName: nameOf(script.targetId),
            blockId: script.blockId,
            title: `"${nameOfBlock(script.opcode)}" has nothing under it`,
            detail: `In ${nameOf(script.targetId)}.`,
            fix: 'delete-block'
        });
    }
    const order = {warn: 0, info: 1};
    return issues.sort((a, b) => order[a.severity] - order[b.severity]);
};
const findUses = (index, kind, subject) => {
    if (kind === 'variable') { return (index.variableUses.get(subject.id) || []).map(use => ({...use, role: 'uses'})); }
    if (kind === 'procedure') {
        const out = [];
        const everywhere = index.globalProcedures.has(subject.proccode);
        for (const def of index.definitions) {
            if ((everywhere || def.targetId === subject.targetId) && def.proccode === subject.proccode) {
                out.push({targetId: def.targetId, blockId: def.blockId, role: 'defines'});
            }
        }
        for (const call of index.calls) {
            if ((everywhere || call.targetId === subject.targetId) && call.proccode === subject.proccode) {
                out.push({targetId: call.targetId, blockId: call.blockId, role: 'calls'});
            }
        }
        return out;
    }
    if (kind === 'broadcast') {
        return [
            ...(index.broadcastSends.get(subject.name) || []).map(use => ({...use, role: 'sends'})),
            ...(index.broadcastReceives.get(subject.name) || []).map(use => ({...use, role: 'receives'}))
        ];
    }
    return [];
};
const PEEK_KEY = 'dimod:live-peek';
const ACCENT = '#6c5ce7';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const navModifier = e => (isMac ? e.metaKey : e.ctrlKey);
const isLivePeekEnabled = () => {
    try { return localStorage.getItem(PEEK_KEY) !== '0'; } catch (e) { return true; }
};
const setLivePeekEnabled = enabled => {
    try { localStorage.setItem(PEEK_KEY, enabled ? '1' : '0'); } catch (e) {
    }
    window.dispatchEvent(new Event('dimod:live-peek'));
};
const CSS = `
.dimod-marquee-selected {
    filter: drop-shadow(0 0 3px ${ACCENT}) drop-shadow(0 0 3px ${ACCENT}) drop-shadow(0 0 1px ${ACCENT});
}
.dimod-marquee-selected > .blocklyPath {
    stroke: ${ACCENT};
    stroke-width: 3px;
}
@keyframes dimod-flash {
    0% { filter: drop-shadow(0 0 0 ${ACCENT}); }
    20% { filter: drop-shadow(0 0 6px ${ACCENT}) drop-shadow(0 0 3px ${ACCENT}); }
    100% { filter: drop-shadow(0 0 0 ${ACCENT}); }
}
.dimod-flash {
    animation: dimod-flash 1.5s ease-out;
}
.dimod-marquee-box {
    position: fixed;
    z-index: 5000;
    pointer-events: none;
    border: 1.5px dashed ${ACCENT};
    background: rgba(108, 92, 231, 0.12);
    border-radius: 3px;
}
.dimod-selbar {
    position: fixed;
    z-index: 5001;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--ui-primary, white);
    color: var(--text-primary, #575e75);
    border: 1px solid var(--paint-ui-pane-border, #ddd);
    border-radius: 4px;
    box-shadow: 0 0 8px 1px rgba(0, 0, 0, 0.3);
    font: 600 12px/1 var(--dimod-font-ui, "Helvetica Neue", Helvetica, Arial, sans-serif);
    user-select: none;
    animation: dimod-popover-in 500ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes dimod-popover-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
}
.dimod-selbar-count {
    padding: 0 8px 0 6px;
    white-space: nowrap;
}
.dimod-selbar button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    color: inherit;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}
.dimod-selbar button:hover {
    background: var(--dimod-motion-light-transparent, rgba(108, 92, 231, 0.15));
}
.dimod-selbar button.dimod-selbar-danger:hover {
    background: rgba(255, 76, 76, 0.2);
}
.dimod-selbar svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}
`;
const injectStyle = () => {
    if (document.getElementById('dimod-editor-tools-style')) return;
    const style = document.createElement('style');
    style.id = 'dimod-editor-tools-style';
    style.textContent = CSS;
    document.head.appendChild(style);
};
const ICONS = {
    duplicate: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/>' +
        '<path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H3.8A1.3 1.3 0 0 0 2.5 3.3v5.4a1.3 1.3 0 0 0 1.3 1.3h.2"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.3 4.5l.6 8.5h6.2l.6-8.5M7 7v4M9 7v4"/></svg>',
    tidy: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="3" rx="1"/>' +
        '<rect x="2.5" y="6.5" width="7.5" height="3" rx="1"/><rect x="2.5" y="10.5" width="9.5" height="3" rx="1"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
};
const selected = new Set();
let selectionBar = null;
let marqueeBox = null;
const liveRoots = workspace => {
    const roots = [];
    for (const id of Array.from(selected)) {
        const block = workspace.getBlockById(id);
        if (!block || block.getParent()) { selected.delete(id); } else { roots.push(block); }
    }
    return roots;
};
const paintSelection = workspace => {
    for (const block of workspace.getTopBlocks(false)) {
        const root = block.getSvgRoot();
        if (!root) continue;
        if (selected.has(block.id)) { root.classList.add('dimod-marquee-selected'); } else { root.classList.remove('dimod-marquee-selected'); }
    }
};
const removeBar = () => {
    if (selectionBar) selectionBar.remove();
    selectionBar = null;
};
const button = (icon, title, onClick, extraClass) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.title = title;
    el.setAttribute('aria-label', title);
    if (extraClass) el.className = extraClass;
    el.innerHTML = icon;
    el.addEventListener('click', onClick);
    el.addEventListener('mousedown', e => e.stopPropagation());
    return el;
};
const refreshSelection = workspace => {
    const roots = liveRoots(workspace);
    paintSelection(workspace);
    removeBar();
    if (!roots.length) return;
    const svg = workspace.getParentSvg();
    const bounds = svg.getBoundingClientRect();
    const flyout = workspace.getFlyout && workspace.getFlyout();
    const paletteWidth = flyout && flyout.getWidth ? flyout.getWidth() : 0;
    selectionBar = document.createElement('div');
    selectionBar.className = 'dimod-selbar';
    const count = document.createElement('span');
    count.className = 'dimod-selbar-count';
    count.textContent = `${roots.length} ${roots.length === 1 ? 'script' : 'scripts'}`;
    selectionBar.appendChild(count);
    selectionBar.appendChild(button(ICONS.duplicate, 'Duplicate selected scripts', () => duplicateSelected(workspace)));
    selectionBar.appendChild(button(ICONS.tidy, 'Tidy selected scripts into a column', () => tidySelected(workspace)));
    selectionBar.appendChild(button(ICONS.trash, 'Delete selected scripts', () => deleteSelected(workspace),
        'dimod-selbar-danger'));
    selectionBar.appendChild(button(ICONS.close, 'Clear selection', () => clearSelection(workspace)));
    document.body.appendChild(selectionBar);
    const width = selectionBar.offsetWidth;
    const room = bounds.width - paletteWidth;
    selectionBar.style.left = `${bounds.left + paletteWidth + Math.max(8, (room - width) / 2)}px`;
    selectionBar.style.top = `${bounds.top + 10}px`;
};
const clearSelection = workspace => { selected.clear(); refreshSelection(workspace); };
const withGroup = (Blockly, fn) => {
    Blockly.Events.setGroup(true);
    try { fn(); } finally { Blockly.Events.setGroup(false); }
};
const deleteSelected = workspace => {
    const Blockly = getBlockly();
    const roots = liveRoots(workspace);
    if (!roots.length) return;
    withGroup(Blockly, () => {
        for (const block of roots) block.dispose(false, true);
    });
    selected.clear();
    refreshSelection(workspace);
};
const duplicateSelected = workspace => {
    const Blockly = getBlockly();
    const roots = liveRoots(workspace).filter(block => !block.type.startsWith('procedures_definition'));
    if (!roots.length) return;
    const copies = [];
    withGroup(Blockly, () => {
        for (const block of roots) {
            const xml = Blockly.Xml.blockToDom(block);
            const copy = Blockly.Xml.domToBlock(xml, workspace);
            const at = block.getRelativeToSurfaceXY();
            const start = copy.getRelativeToSurfaceXY();
            copy.moveBy((at.x - start.x) + 40, (at.y - start.y) + 40);
            copies.push(copy);
        }
    });
    selected.clear();
    for (const copy of copies) selected.add(copy.id);
    refreshSelection(workspace);
};
const tidySelected = workspace => {
    const Blockly = getBlockly();
    const roots = liveRoots(workspace);
    if (roots.length < 2) return;
    const placed = roots
        .map(block => ({block, at: block.getRelativeToSurfaceXY()}))
        .sort((a, b) => a.at.y - b.at.y);
    const left = Math.min(...placed.map(p => p.at.x));
    let y = placed[0].at.y;
    withGroup(Blockly, () => {
        for (const {block, at} of placed) { block.moveBy(left - at.x, y - at.y); y += block.getHeightWidth().height + 30; }
    });
    refreshSelection(workspace);
};
const startMarquee = (workspace, startEvent) => {
    const x0 = startEvent.clientX;
    const y0 = startEvent.clientY;
    const additive = startEvent.ctrlKey || startEvent.metaKey;
    marqueeBox = document.createElement('div');
    marqueeBox.className = 'dimod-marquee-box';
    document.body.appendChild(marqueeBox);
    const place = e => {
        const left = Math.min(x0, e.clientX);
        const top = Math.min(y0, e.clientY);
        marqueeBox.style.left = `${left}px`;
        marqueeBox.style.top = `${top}px`;
        marqueeBox.style.width = `${Math.abs(e.clientX - x0)}px`;
        marqueeBox.style.height = `${Math.abs(e.clientY - y0)}px`;
    };
    place(startEvent);
    const onMove = e => place(e);
    const finish = e => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', finish, true);
        const box = marqueeBox.getBoundingClientRect();
        marqueeBox.remove();
        marqueeBox = null;
        if (box.width < 4 && box.height < 4) {
            if (!additive) clearSelection(workspace);
            return;
        }
        if (!additive) selected.clear();
        for (const block of workspace.getTopBlocks(false)) {
            const root = block.getSvgRoot();
            if (!root) continue;
            const r = root.getBoundingClientRect();
            if (r.right >= box.left && r.left <= box.right && r.bottom >= box.top && r.top <= box.bottom) {
                selected.add(block.id);
            }
        }
        refreshSelection(workspace);
        e.preventDefault();
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', finish, true);
};
const patchBlockDragger = Blockly => {
    const proto = Blockly.BlockDragger && Blockly.BlockDragger.prototype;
    if (!proto || proto.__dimodGroupDrag) return;
    proto.__dimodGroupDrag = true;
    const start = proto.startBlockDrag;
    proto.startBlockDrag = function (...args) {
        const result = start.apply(this, args);
        this.dimodGroup = null;
        const dragged = this.draggingBlock_;
        if (selected.has(dragged.id) && !dragged.getParent() && selected.size > 1) {
            const others = liveRoots(this.workspace_).filter(block => block !== dragged);
            if (others.length) {
                this.dimodGroup = {
                    group: Blockly.Events.getGroup(),
                    others: others.map(block => ({block, at: block.getRelativeToSurfaceXY()})),
                    delta: {x: 0, y: 0}
                };
            }
        }
        return result;
    };
    const drag = proto.dragBlock;
    proto.dragBlock = function (e, currentDragDeltaXY) {
        const result = drag.call(this, e, currentDragDeltaXY);
        const group = this.dimodGroup;
        if (group) {
            const delta = this.pixelsToWorkspaceUnits_(currentDragDeltaXY);
            group.delta = {x: delta.x, y: delta.y};
            for (const {block, at} of group.others) block.translate(at.x + delta.x, at.y + delta.y);
        }
        return result;
    };
    const end = proto.endBlockDrag;
    proto.endBlockDrag = function (e, currentDragDeltaXY) {
        const dragged = this.draggingBlock_;
        const group = this.dimodGroup;
        const workspace = this.workspace_;
        this.dimodGroup = null;
        const result = end.call(this, e, currentDragDeltaXY);
        if (!group) return result;
        for (const {block, at} of group.others) block.translate(at.x, at.y);
        const deleted = !dragged.workspace;
        const attached = !deleted && Boolean(dragged.getParent());
        Blockly.Events.setGroup(group.group || true);
        try {
            for (const {block, at} of group.others) {
                if (block.workspace === null) continue;
                if (deleted) { block.dispose(false, true); } else if (!attached) { block.moveBy(group.delta.x, group.delta.y); } else { block.translate(at.x, at.y); }
            }
        } finally { Blockly.Events.setGroup(false); }
        setTimeout(() => refreshSelection(workspace), 0);
        return result;
    };
};
const blockIdOf = element => {
    const group = element && element.closest && element.closest('[data-id]');
    return group ? group.getAttribute('data-id') : null;
};
const installMarquee = workspace => {
    const svg = workspace.getParentSvg();
    svg.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const target = e.target;
        const onBackground = target === svg || (target.classList && target.classList.contains('blocklyMainBackground'));
        if (onBackground) {
            if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); startMarquee(workspace, e); } else if (selected.size) { clearSelection(workspace); }
            return;
        }
        if (selected.size && !e.shiftKey) {
            const block = workspace.getBlockById(blockIdOf(target));
            if (block && !selected.has(block.getRootBlock().id)) clearSelection(workspace);
        }
    }, true);
    document.addEventListener('keydown', e => {
        if (!selected.size) return;
        const editing = e.target && (
            e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable
        );
        if (editing) return;
        if (e.key === 'Escape') {
            clearSelection(workspace);
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && liveRoots(workspace).length) {
            e.preventDefault();
            e.stopImmediatePropagation();
            deleteSelected(workspace);
        }
    }, true);
    let refreshTimer = null;
    workspace.addChangeListener(() => {
        if (!selected.size) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => refreshSelection(workspace), 60);
    });
    window.addEventListener('resize', () => {
        if (selected.size) refreshSelection(workspace);
    });
};
const formatValue = value => {
    if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
    if (typeof value === 'boolean') return String(value);
    const text = value === null || typeof value === 'undefined' ? '' : String(value);
    if (!text) return '(empty)';
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
};
const reportText = value => {
    const text = value === null || typeof value === 'undefined' ? '' : String(value);
    return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
};
const PROPERTIES = {
    motion_xposition: (vm, target) => ['x position', target.x],
    motion_yposition: (vm, target) => ['y position', target.y],
    motion_direction: (vm, target) => ['direction', target.direction],
    looks_size: (vm, target) => ['size', target.size],
    sound_volume: (vm, target) => ['volume', target.volume],
    sensing_mousex: vm => ['mouse x', vm.runtime.ioDevices.mouse.getScratchX()],
    sensing_mousey: vm => ['mouse y', vm.runtime.ioDevices.mouse.getScratchY()],
    sensing_timer: vm => ['timer', vm.runtime.ioDevices.clock.projectTimer()]
};
const describeBlock = (vm, block) => {
    const target = vm.editingTarget;
    if (!target || block.isShadow()) return null;
    const field = block.getField('VARIABLE') || block.getField('LIST');
    if (field) {
        const variable = target.lookupVariableById(field.getValue());
        if (!variable) return null;
        if (variable.type === 'list') {
            const items = Array.isArray(variable.value) ? variable.value : [];
            const shown = items.slice(0, 8).map(item => formatValue(item)).join('\n');
            const joiner = items.every(item => String(item).length === 1) ? '' : ' ';
            return {
                name: `${variable.name} (list, ${items.length} ${items.length === 1 ? 'item' : 'items'})`,
                value: items.length ? shown + (items.length > 8 ? `\n... and ${items.length - 8} more` : '') : null,
                report: reportText(items.join(joiner))
            };
        }
        return {name: variable.name, value: formatValue(variable.value), report: reportText(variable.value)};
    }
    const property = PROPERTIES[block.type];
    if (property) {
        try {
            const [name, value] = property(vm, target);
            return {name, value: formatValue(value), report: reportText(value)};
        } catch (e) { return null; }
    }
    return null;
};
const PEEK_DELAY_MS = 500;
const installPeek = (workspace, vm) => {
    const svg = workspace.getParentSvg().parentNode || workspace.getParentSvg();
    let shown = null;
    let hoverId = null;
    let hoverBlock = null;
    let dwell = null;
    let refresh = null;
    const hide = () => {
        clearTimeout(dwell);
        clearInterval(refresh);
        dwell = null;
        refresh = null;
        hoverId = null;
        hoverBlock = null;
        if (shown !== null) {
            shown = null;
            const ScratchBlocks = getBlockly();
            if (ScratchBlocks) ScratchBlocks.DropDownDiv.hideWithoutAnimation();
        }
    };
    const render = () => {
        if (!hoverBlock) return;
        const info = hoverBlock.workspace ? describeBlock(vm, hoverBlock) : null;
        if (!info) { hide(); return; }
        const text = info.report;
        if (text === shown) return;
        const ScratchBlocks = getBlockly();
        const box = shown !== null && ScratchBlocks &&
            ScratchBlocks.DropDownDiv.getContentDiv().querySelector('.valueReportBox');
        if (box && box.firstChild && box.firstChild.nodeType === Node.TEXT_NODE) {
            box.firstChild.nodeValue = text;
            shown = text;
            return;
        }
        try { hoverBlock.workspace.reportValue(hoverBlock.id, text, false); shown = text; } catch (e) { hide(); }
    };
    const flyoutWorkspace = () => {
        const flyout = workspace.getFlyout && workspace.getFlyout();
        return flyout && flyout.getWorkspace();
    };
    svg.addEventListener('mousemove', e => {
        if (!isLivePeekEnabled() || workspace.isDragging() || marqueeBox) {
            if (shown !== null || dwell) hide();
            return;
        }
        const id = blockIdOf(e.target);
        if (id === hoverId) return;
        hide();
        if (!id) return;
        const flyout = flyoutWorkspace();
        const block = workspace.getBlockById(id) || (flyout && flyout.getBlockById(id));
        if (!block || !describeBlock(vm, block)) return;
        hoverId = id;
        hoverBlock = block;
        dwell = setTimeout(() => { render(); refresh = setInterval(render, 150); }, PEEK_DELAY_MS);
    });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('mousedown', hide, true);
    svg.addEventListener('wheel', hide, {passive: true});
    window.addEventListener('dimod:live-peek', hide);
};
const procCodeOf = block => {
    if (block.type === 'procedures_call') return block.getProcCode();
    if (block.type.startsWith('procedures_definition')) {
        const input = block.getInput('custom_block');
        const proto = input && input.connection && input.connection.targetBlock();
        return proto ? proto.getProcCode() : null;
    }
    return null;
};
const subjectOf = (vm, block) => {
    const procCode = procCodeOf(block);
    if (procCode) { return {kind: 'procedure', subject: {targetId: vm.editingTarget.id, proccode: procCode}, label: procCode}; }
    const field = block.getField('VARIABLE') || block.getField('LIST');
    if (field && field.getValue()) { return {kind: 'variable', subject: {id: field.getValue()}, label: field.getText()}; }
    if (block.type === 'event_whenbroadcastreceived' || block.type.startsWith('event_broadcast')) {
        const menu = block.getInputTargetBlock('BROADCAST_INPUT');
        const source = menu || block;
        const option = source.getField('BROADCAST_OPTION');
        if (option) return {kind: 'broadcast', subject: {name: option.getText()}, label: option.getText()};
    }
    return null;
};
const findDefinition = (workspace, procCode) => workspace.getTopBlocks(false).find(top => (
    top.type.startsWith('procedures_definition') && procCodeOf(top) === procCode
));
const openUses = (vm, block) => {
    const subject = subjectOf(vm, block);
    if (!subject) return false;
    window.dispatchEvent(new CustomEvent('dimod:palette', {detail: {mode: 'uses', ...subject}}));
    return true;
};
const goToDefinition = (vm, block, forceUses) => {
    if (forceUses) return openUses(vm, block);
    for (let b = block; b; b = b.getSurroundParent()) {
        if (b.type === 'procedures_call') {
            const definition = findDefinition(getWorkspace(), b.getProcCode());
            if (definition) { revealBlock(vm, vm.editingTarget.id, definition.id); return true; }
            return false;
        }
    }
    return openUses(vm, block);
};
const patchGesture = (Blockly, vm) => {
    const proto = Blockly.Gesture && Blockly.Gesture.prototype;
    if (!proto || proto.__dimodGoTo) return;
    proto.__dimodGoTo = true;
    const original = proto.doBlockClick_;
    proto.doBlockClick_ = function (...args) {
        const e = this.mostRecentEvent_;
        if (e && navModifier(e) && this.startBlock_ && !this.startBlock_.isInFlyout) {
            try {
                if (goToDefinition(vm, this.startBlock_, false)) return undefined;
            } catch (err) {
            }
        }
        return original.apply(this, args);
    };
};
const installKeys = vm => {
    document.addEventListener('keydown', e => {
        if (e.key !== 'F12') return;
        const Blockly = getBlockly();
        const block = Blockly && Blockly.selected;
        if (!block || !block.workspace || block.isInFlyout) return;
        try {
            if (goToDefinition(vm, block, e.shiftKey)) { e.preventDefault(); e.stopPropagation(); }
        } catch (err) {
        }
    }, true);
};
let started = false;
const installWorkspaceTools = vm => {
    if (started) return;
    started = true;
    injectStyle();
    installKeys(vm);
    let attempts = 0;
    const timer = setInterval(() => {
        attempts++;
        const Blockly = getBlockly();
        const workspace = getWorkspace();
        const ready = Blockly && workspace && workspace.getParentSvg && workspace.getParentSvg() &&
            workspace.getFlyout && workspace.getFlyout();
        if (!ready) {
            if (attempts > 600) clearInterval(timer);
            return;
        }
        clearInterval(timer);
        try {
            patchBlockDragger(Blockly);
            patchGesture(Blockly, vm);
            installMarquee(workspace);
            installPeek(workspace, vm);
            vm.on('workspaceUpdate', () => setTimeout(() => refreshSelection(workspace), 250));
        } catch (err) { console.warn('dimod: workspace tools failed to start', err); }
    }, 250);
};
const COMMENT_HELP = [
    'Comments understand a little formatting:',
    'Bold: **text**    Italic: */text*/    Strikethrough: ~~text~~',
    'Big heading: #1text#1    Smaller heading: #2text#2',
    'Colour: @c #ff0000: text@c    Highlight: @h #00ff00: text@h    Font: @f name: text@f',
    'Image: <i link i>    Audio: <a link a>    Video: <v link v>',
    'Right-click a comment to change its colours and font.'
].join('\n\n');
const isComplex = target => Boolean(target.sprite && target.sprite.dimod && target.sprite.dimod.complex);
const dispatch = action => {
    if (window.ReduxStore) window.ReduxStore.dispatch(action);
};
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
const reduxState = () => (window.ReduxStore ? window.ReduxStore.getState().scratchGui : null);
const onWorkspace = fn => () => {
    showBlocks();
    const workspace = getWorkspace();
    if (workspace) fn(workspace, getBlockly());
};
const setAllCollapsed = collapsed => onWorkspace((workspace, Blockly) => {
    Blockly.Events.setGroup(true);
    for (const block of workspace.getTopBlocks(false)) block.setCollapsed(collapsed);
    Blockly.Events.setGroup(false);
});
const addPaintedSprite = vm => {
    const n = vm.runtime.targets.filter(target => target.isOriginal && !target.isStage).length + 1;
    vm.addSprite(JSON.stringify(emptySprite(`Sprite${n}`, 'pop', 'costume1'))).then(() => {
        broadcastTargetCreate(vm);
        setTimeout(() => showTab(COSTUMES_TAB_INDEX));
    });
};
const downloadProject = vm => {
    const state = reduxState();
    const title = ((state && state.projectTitle) || 'Project').substring(0, 100);
    vm.saveProjectSb3().then(content => downloadBlob(`${title}.warp`, content));
};
const actionItems = vm => {
    const items = [];
    const add = (id, label, run, {keywords = '', group = '', hint = ''} = {}) => items.push({
        id: `action:${id}`, type: 'action', label, sub: group, hint, keywords, run
    });
    const editing = vm.editingTarget;
    const blocksWork = Boolean(editing) && !isComplex(editing);
    const sprite = editing && !editing.isStage ? editing : null;
    const status = reduxState();
    const turbo = Boolean(status && status.vmStatus.turbo);
    const sixty = vm.runtime.frameLoop ? vm.runtime.frameLoop.framerate === 60 : false;
    const interpolating = Boolean(vm.runtime.interpolationEnabled);
    const g = {group: 'Project'};
    add('flag', 'Run the project', () => vm.greenFlag(), {...g, keywords: 'green flag start play'});
    add('stop', 'Stop the project', () => vm.stopAll(), {...g, keywords: 'stop all halt'});
    add('turbo', turbo ? 'Turn off turbo mode' : 'Turn on turbo mode', () => vm.setTurboMode(!turbo),
        {...g, keywords: 'fast speed', hint: 'Shift+flag'});
    add('fps', sixty ? 'Run at 30 FPS' : 'Run at 60 FPS', () => vm.setFramerate(sixty ? 30 : 60),
        {...g, keywords: 'framerate frames smooth'});
    add('interpolation', interpolating ? 'Turn off interpolation' : 'Turn on interpolation',
        () => vm.setInterpolation(!interpolating), {...g, keywords: 'smooth frames'});
    add('download', 'Download the project to your computer', () => downloadProject(vm),
        {...g, keywords: 'save export file warp sb3'});
    if (blocksWork) {
        const b = {group: 'Blocks'};
        add('undo', 'Undo', onWorkspace(workspace => workspace.undo(false)), {...b, hint: `${MOD}+Z`});
        add('redo', 'Redo', onWorkspace(workspace => workspace.undo(true)), {...b, hint: `${MOD}+Shift+Z`});
        add('clean-up', 'Clean up blocks', onWorkspace(workspace => workspace.cleanUp()),
            {...b, keywords: 'tidy arrange sort line up'});
        add('collapse', 'Collapse all scripts', setAllCollapsed(true), {...b, keywords: 'fold hide'});
        add('expand', 'Expand all scripts', setAllCollapsed(false), {...b, keywords: 'unfold show'});
        add('zoom-in', 'Zoom in', onWorkspace(workspace => workspace.zoomCenter(1)), {...b, keywords: 'bigger'});
        add('zoom-out', 'Zoom out', onWorkspace(workspace => workspace.zoomCenter(-1)), {...b, keywords: 'smaller'});
        add('zoom-reset', 'Reset zoom', onWorkspace(workspace => {
            workspace.setScale(workspace.options.zoomOptions.startScale);
            workspace.scrollCenter();
        }), {...b, keywords: 'default size 100'});
        add('zoom-fit', 'Zoom to fit every script', onWorkspace(workspace => workspace.zoomToFit()),
            {...b, keywords: 'overview whole all'});
        add('new-variable', 'Make a variable', onWorkspace((workspace, Blockly) =>
            Blockly.Variables.createVariable(workspace, null, '')), {...b, keywords: 'create new data'});
        add('new-list', 'Make a list', onWorkspace((workspace, Blockly) =>
            Blockly.Variables.createVariable(workspace, null, 'list')), {...b, keywords: 'create new array data'});
        add('new-message', 'Make a message', onWorkspace((workspace, Blockly) =>
            Blockly.Variables.createVariable(workspace, null, 'broadcast_msg')), {...b, keywords: 'broadcast create new'});
        add('new-block', 'Make a block', onWorkspace((workspace, Blockly) =>
            Blockly.Procedures.createProcedureDefCallback_(workspace)), {...b, keywords: 'custom procedure function define'});
    }
    add('cleanup', 'Find broken things', () => window.dispatchEvent(new Event('dimod:cleanup')),
        {group: 'Blocks', keywords: 'unused variables loose blocks errors lint problems clean'});
    const s = {group: 'Sprite'};
    add('paint-sprite', 'Paint a new sprite', () => addPaintedSprite(vm), {...s, keywords: 'create draw empty'});
    add('sprite-library', 'Choose a sprite from the library', () => dispatch(openSpriteLibrary()), {...s, keywords: 'add new'});
    if (sprite) {
        add('duplicate-sprite', `Duplicate ${sprite.getName()}`,
            () => vm.duplicateSprite(sprite.id).then(() => broadcastTargetCreate(vm)), {...s, keywords: 'copy clone'});
        add('export-sprite', `Export ${sprite.getName()}`,
            () => vm.exportSprite(sprite.id).then(content => downloadBlob(`${sprite.getName()}.warps`, content)),
            {...s, keywords: 'download save file'});
        add('rename-sprite', `Rename ${sprite.getName()}`, async () => {
            const name = await askPrompt('Rename sprite', {initial: sprite.getName()});
            if (name && name.trim()) vm.renameSprite(sprite.id, name.trim());
        }, {...s, keywords: 'name title'});
        add('delete-sprite', `Delete ${sprite.getName()}`, async () => {
            if (await askConfirm(`Delete "${sprite.getName()}"?`)) vm.deleteSprite(sprite.id);
        }, {...s, keywords: 'remove trash'});
        add('toggle-visible', sprite.visible ? `Hide ${sprite.getName()}` : `Show ${sprite.getName()}`,
            () => vm.postSpriteInfo({visible: !sprite.visible}), {...s, keywords: 'visible'});
    }
    const stage = vm.runtime.getTargetForStage();
    if (stage && editing !== stage) add('go-stage', 'Edit the stage', () => switchToTarget(vm, stage.id), {...s, keywords: 'backdrop'});
    const t = {group: 'Go to'};
    add('tab-code', 'Code tab', () => showTab(BLOCKS_TAB_INDEX), {...t, keywords: 'blocks scripts'});
    add('tab-costumes', 'Costumes tab', () => showTab(COSTUMES_TAB_INDEX), {...t, keywords: 'backdrops paint'});
    add('tab-sounds', 'Sounds tab', () => showTab(SOUNDS_TAB_INDEX), {...t, keywords: 'audio music'});
    add('tab-variables', 'Variables tab', () => showTab(VARIABLES_TAB_INDEX), {...t, keywords: 'lists'});
    if (LIVE) {
        add('tab-animations', 'Animations tab', () => showTab(ANIMATIONS_TAB_INDEX), {...t, keywords: 'tween keyframes motion'});
        add('tab-assets', 'Assets tab', () => showTab(FILES_TAB_INDEX), {...t, keywords: 'files fonts data upload'});
    }
    if (editing && editing.isStage) add('tab-server', 'Server tab', () => showTab(SERVER_TAB_INDEX), {...t, keywords: 'backend multiplayer'});
    const l = {group: 'Add'};
    add('extensions', 'Add an extension', () => dispatch(openExtensionLibrary()), {...l, keywords: 'library plugin'});
    add('costume-library', 'Choose a costume from the library', () => dispatch(openCostumeLibrary()), l);
    add('backdrop-library', 'Choose a backdrop from the library', () => dispatch(openBackdropLibrary()), l);
    add('sound-library', 'Choose a sound from the library', () => dispatch(openSoundLibrary()), {...l, keywords: 'audio'});
    add('record-sound', 'Record a sound', () => dispatch(openSoundRecorder()), {...l, keywords: 'microphone audio'});
    add('fonts', 'Manage fonts', () => dispatch(openFontsModal()), {...l, keywords: 'text typeface'});
    const v = {group: 'Stage'};
    add('stage-small', 'Small stage', () => dispatch(setStageSize(STAGE_SIZE_MODES.small)), {...v, keywords: 'size'});
    add('stage-large', 'Large stage', () => dispatch(setStageSize(STAGE_SIZE_MODES.large)), {...v, keywords: 'size'});
    add('fullscreen', 'Full screen stage', () => dispatch(setFullScreen(true)), {...v, keywords: 'present player big'});
    const e = {group: 'Editor'};
    add('focus', isFocusMode() ? 'Leave focus mode' : 'Focus mode: hide the stage and sprites', toggleFocusMode,
        {...e, keywords: 'distraction zen fullscreen editor'});
    add('peek', isLivePeekEnabled() ? 'Turn off live value peek' : 'Turn on live value peek',
        () => setLivePeekEnabled(!isLivePeekEnabled()), {...e, keywords: 'hover variable value tooltip'});
    if (LIVE) {
        const themeAction = (id, label, keywords, detail) => add(`theme-${id}`, label,
            () => window.dispatchEvent(new CustomEvent('dimod-set-theme', {detail})), {...e, keywords: `theme ${keywords}`});
        for (const c of STUDIO_COLOURS) themeAction(`colour-${c.id}`, `Color: ${c.label}`, `colour ${c.keywords}`, {colour: c.id});
        for (const st of STUDIO_STYLES) themeAction(`style-${st.id}`, `Style: ${st.label}`, `look ${st.keywords}`, {style: st.id});
        add('code-colors', 'Code editor colors...', () => window.dispatchEvent(new Event('dimod:code-colors')),
            {...e, keywords: 'monaco theme syntax highlight'});
        add('code-colors-auto', 'Code colors: match the theme', () => setMonacoPref('auto'), {...e, keywords: 'monaco default'});
        for (const t of CODE_THEMES) {
            add(`code-colors-${t.id}`, `Code colors: ${t.name}`, () => setMonacoPref(t.id), {...e, keywords: 'monaco syntax theme'});
        }
        const scenes = vm.dimodScenes;
        if (scenes) {
            const sc = {group: 'Scenes'};
            add('scene-new', 'New scene', async () => {
                const name = await askPrompt('Name for the new scene', {initial: `Scene ${scenes.list.length + 1}`});
                if (name && name.trim()) scenes.goTo(scenes.create(name.trim()).id, {run: false});
            }, {...sc, keywords: 'room level add'});
            add('scene-next', 'Next scene', () => scenes.goRel('next', {run: false}), {...sc, keywords: 'room level'});
            add('scene-previous', 'Previous scene', () => scenes.goRel('previous', {run: false}), {...sc, keywords: 'room level'});
        }
    }
    add('settings', 'Open settings', () => dispatch(openSettingsModal()), {...e, keywords: 'preferences options addons'});
    add('restore-points', 'Restore points', () => dispatch(openRestorePointModal()), {...e, keywords: 'backup history recover'});
    if (vm.extensionManager.isExtensionLoaded('SPcomments')) {
        add('comment-help', 'Comment formatting help', () => askAlert(COMMENT_HELP, {title: 'Comment formatting'}),
            {...e, keywords: 'markdown bold italic colour better comments'});
    }
    return items;
};
const targetItems = (vm, index) => {
    const items = [];
    for (const target of index.targets) {
        const name = index.targetName(target);
        const complex = isComplex(target);
        items.push({
            id: `target:${target.id}`,
            type: 'sprite',
            label: name,
            sub: target.isStage ? 'Stage' : complex ? 'Complex sprite' : 'Sprite',
            targetId: target.id,
            run: () => switchToTarget(vm, target.id)
        });
        target.getCostumes().forEach((costume, i) => items.push({
            id: `costume:${target.id}:${i}`,
            type: 'costume',
            label: costume.name,
            sub: `${target.isStage ? 'Backdrop' : 'Costume'} in ${name}`,
            run: () => showCostume(vm, target.id, i)
        }));
        target.getSounds().forEach((sound, i) => items.push({
            id: `sound:${target.id}:${i}`,
            type: 'sound',
            label: sound.name,
            sub: `Sound in ${name}`,
            run: () => showSound(vm, target.id, i)
        }));
        if (complex) {
            let calls = [];
            try { calls = findBlockspaces(target.sprite.dimod.source); } catch (e) { calls = []; }
            for (const call of calls) {
                if (!call.id) continue;
                items.push({
                    id: `blockspace:${target.id}:${call.id}`,
                    type: 'blockspace',
                    label: call.id,
                    sub: `Blockspace in ${name}`,
                    run: () => {
                        switchToTarget(vm, target.id);
                        showTab(BLOCKS_TAB_INDEX);
                        setTimeout(() => {
                            if (openBlockspace(vm, target.id, call.id)) {
                                dispatch(setBlockspaceFocus({targetId: target.id, id: call.id}));
                            }
                        }, 120);
                    }
                });
            }
        }
    }
    return items;
};
const definitionItems = (vm, index, openUses) => {
    const items = [];
    const seen = new Set();
    for (const def of index.definitions) {
        const key = `${def.targetId}:${def.proccode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const target = vm.runtime.getTargetById(def.targetId);
        const label = readableProccode(def.proccode);
        items.push({
            id: `proc:${key}`,
            type: 'block',
            label,
            sub: `Custom block in ${target ? index.targetName(target) : ''}`,
            run: () => revealBlock(vm, def.targetId, def.blockId),
            uses: () => openUses({kind: 'procedure', subject: {targetId: def.targetId, proccode: def.proccode}, label})
        });
    }
    return items;
};
const variableItems = (index, openUses) => index.variables.map(variable => ({
    id: `var:${variable.id}`,
    type: 'variable',
    label: variable.name,
    sub: `${variable.isList ? 'List' : 'Variable'} ${variable.isGlobal ? 'for all sprites' : `in ${variable.targetName}`}`,
    run: () => openUses({kind: 'variable', subject: {id: variable.id}, label: variable.name}),
    opensUses: true
}));
const broadcastItems = (index, openUses) => {
    const names = new Set([...index.broadcastSends.keys(), ...index.broadcastReceives.keys()]);
    return Array.from(names).map(name => ({
        id: `broadcast:${name}`,
        type: 'message',
        label: name,
        sub: 'Message',
        run: () => openUses({kind: 'broadcast', subject: {name}, label: name}),
        opensUses: true
    }));
};
const createBlockSearch = vm => {
    let querier = null;
    let failed = false;
    const ensure = () => {
        if (querier || failed) return querier;
        try {
            const workspace = getWorkspace();
            const target = vm.editingTarget;
            if (!workspace || !target || isComplex(target)) { failed = true; return null; }
            const types = BlockTypeInfo.getBlocks(getBlockly(), vm, workspace, key => key);
            querier = new WorkspaceQuerier();
            querier.indexWorkspace([...types]);
        } catch (e) { failed = true; querier = null; }
        return querier;
    };
    return {
        query (text, limit = 8) {
            const q = ensure();
            if (!q || !text.trim()) return [];
            let found;
            try { found = q.queryWorkspace(text).results; } catch (e) { return []; }
            const seen = new Set();
            const rows = [];
            for (const result of found) {
                const label = result.toText(false);
                if (!label || seen.has(label)) continue;
                seen.add(label);
                rows.push({
                    id: `block:${label}`,
                    type: 'block',
                    label,
                    sub: '',
                    block: result.createBlock(),
                    run: () => insertResult(result)
                });
                if (rows.length >= limit) break;
            }
            return rows;
        },
        dispose () {
            if (querier) querier.clearWorkspaceIndex();
            querier = null;
        }
    };
};
const insertResult = result => {
    const Blockly = getBlockly();
    const workspace = getWorkspace();
    if (!Blockly || !workspace) return;
    showBlocks();
    let block;
    Blockly.Events.disable();
    try {
        block = result.createBlock().createWorkspaceForm();
        Blockly.scratchBlocksUtils.changeObscuredShadowIds(block);
        const scale = workspace.scale || 1;
        const flyoutWidth = workspace.getFlyout().getWidth ? workspace.getFlyout().getWidth() : 250;
        const at = block.getRelativeToSurfaceXY();
        block.moveBy((((-workspace.scrollX) + flyoutWidth + 60) / scale) - at.x, (((-workspace.scrollY) + 80) / scale) - at.y);
    } finally { Blockly.Events.enable(); }
    if (Blockly.Events.isEnabled()) Blockly.Events.fire(new Blockly.Events.BlockCreate(block));
    block.select();
};
const sceneItems = vm => {
    const host = vm.dimodScenes;
    if (!LIVE || !host) return [];
    return host.list.map(scene => ({
        id: `scene:${scene.id}`,
        type: 'scene',
        label: scene.name,
        sub: scene.id === host.current ? 'Scene (current)' : 'Scene',
        keywords: 'room level go',
        run: () => host.goTo(scene.id, {run: false})
    }));
};
const assetItems = vm => {
    const host = vm.dimodAssets;
    if (!LIVE || !host) return [];
    return host.list.map(asset => ({
        id: `asset:${asset.id}`,
        type: 'asset',
        label: asset.name,
        sub: `${asset.kind} asset`,
        keywords: asset.ext,
        run: () => {
            window.dimodAssetPick = asset.id;
            window.dispatchEvent(new CustomEvent('dimod:select-asset', {detail: asset.id}));
            showTab(FILES_TAB_INDEX);
        }
    }));
};
const buildItems = (vm, hooks) => {
    const index = buildIndex(vm);
    return [
        ...actionItems(vm),
        ...targetItems(vm, index),
        ...definitionItems(vm, index, hooks.openUses),
        ...variableItems(index, hooks.openUses),
        ...broadcastItems(index, hooks.openUses),
        ...sceneItems(vm),
        ...assetItems(vm)
    ];
};
const USE_VERBS = {
    data_variable: 'Reads it',
    data_setvariableto: 'Sets it',
    data_changevariableby: 'Changes it',
    data_showvariable: 'Shows its monitor',
    data_hidevariable: 'Hides its monitor',
    data_listcontents: 'Reads the list',
    data_addtolist: 'Adds an item',
    data_deleteoflist: 'Deletes an item',
    data_deletealloflist: 'Clears it',
    data_insertatlist: 'Inserts an item',
    data_replaceitemoflist: 'Replaces an item',
    data_itemoflist: 'Reads an item',
    data_itemnumoflist: 'Finds an item',
    data_lengthoflist: 'Reads its length',
    data_listcontainsitem: 'Checks for an item',
    data_showlist: 'Shows its monitor',
    data_hidelist: 'Hides its monitor',
    procedures_call: 'Calls it',
    procedures_definition: 'Defines it',
    event_broadcast: 'Sends it',
    event_broadcastandwait: 'Sends it and waits',
    event_whenbroadcastreceived: 'Receives it'
};
const usesItems = (vm, kind, subject) => {
    const index = buildIndex(vm);
    const labelOf = makeBlockLabeler();
    return findUses(index, kind, subject).map(use => {
        const target = vm.runtime.getTargetById(use.targetId);
        const blocks = target ? target.blocks._blocks : {};
        const block = blocks[use.blockId];
        let top = block;
        const seen = new Set();
        while (top && top.parent && blocks[top.parent] && !seen.has(top.parent)) {
            seen.add(top.parent);
            top = blocks[top.parent];
        }
        let scriptName = null;
        if (top) {
            scriptName = top.opcode.startsWith('procedures_definition') ?
                `define ${readableProccode((top.inputs.custom_block && blocks[top.inputs.custom_block.block] &&
                    blocks[top.inputs.custom_block.block].mutation.proccode) || '')}` :
                labelOf(top.opcode);
        }
        const opcode = block ? block.opcode : '';
        return {
            id: `use:${use.targetId}:${use.blockId}`,
            type: 'use',
            label: USE_VERBS[opcode] || labelOf(opcode) || opcode || 'A block',
            sub: `In ${target ? index.targetName(target) : 'a sprite'}${scriptName ? `, in "${scriptName}"` : ''}`,
            run: () => revealBlock(vm, use.targetId, use.blockId)
        };
    });
};
const scoreText = (text, query) => {
    if (!text) return -1;
    const t = text.toLowerCase();
    if (t === query) return 1000;
    if (t.startsWith(query)) return 800 - Math.min(t.length, 100);
    const at = t.indexOf(query);
    if (at !== -1) {
        const wordStart = at === 0 || /[\s_\-.:(]/.test(t[at - 1]);
        return (wordStart ? 600 : 450) - Math.min(at, 100);
    }
    let from = 0;
    let first = -1;
    let last = -1;
    for (const ch of query) {
        const found = t.indexOf(ch, from);
        if (found === -1) return -1;
        if (first === -1) first = found;
        last = found;
        from = found + 1;
    }
    const span = (last - first) + 1;
    if (query.length < 3 || span > (query.length * 2) + 1) return -1;
    return Math.max(50, 250 - ((span - query.length) * 10));
};
const TYPE_ORDER = {action: 0, sprite: 1, scene: 2, block: 3, variable: 4, message: 5, costume: 6, sound: 7, asset: 8, blockspace: 9, use: 10};
const PREFIX_TYPES = {
    '>': ['action'],
    '@': ['sprite', 'scene', 'costume', 'sound', 'asset', 'blockspace'],
    '$': ['variable', 'message', 'block']
};
const rankItems = (items, rawQuery, limit = 80) => {
    let query = rawQuery.trim().toLowerCase();
    let pool = items;
    const only = PREFIX_TYPES[query[0]];
    if (only) { pool = items.filter(item => only.includes(item.type)); query = query.slice(1).trim(); }
    if (!query) {
        if (only) return pool.slice(0, limit);
        const recent = recentIds().map(id => items.find(item => item.id === id)).filter(Boolean);
        const rest = pool.filter(item => item.type === 'action' || item.type === 'sprite' || item.type === 'scene')
            .filter(item => !recent.includes(item));
        return recent.map(item => ({...item, recent: true})).concat(rest.filter(item => item.type !== 'sprite'),
            rest.filter(item => item.type === 'sprite').slice(0, 12));
    }
    const tokens = query.split(/\s+/);
    const scored = [];
    for (const item of pool) {
        let total = 0;
        for (const token of tokens) {
            const best = Math.max(
                scoreText(item.label, token),
                scoreText(item.keywords || '', token) * 0.6,
                scoreText(item.sub, token) * 0.4
            );
            if (best < 0) { total = -1; break; }
            total += best;
        }
        if (total >= 0) scored.push({item, total});
    }
    scored.sort((a, b) => (b.total - a.total) ||
        ((TYPE_ORDER[a.item.type] || 0) - (TYPE_ORDER[b.item.type] || 0)) ||
        a.item.label.localeCompare(b.item.label));
    return scored.slice(0, limit).map(entry => entry.item);
};
const KEY = 'dimod:sprite-tabs-hidden';
const EVENT = 'dimod:sprite-tabs-hidden';
let hidden = false;
try { hidden = localStorage.getItem(KEY) === '1'; } catch (e) {
}
const areSpriteTabsHidden = () => hidden;
const setSpriteTabsHidden = value => {
    const next = Boolean(value);
    if (next === hidden) return;
    hidden = next;
    try {
        if (next) localStorage.setItem(KEY, '1');
        else localStorage.removeItem(KEY);
    } catch (e) {
    }
    window.dispatchEvent(new Event(EVENT));
};
const toggleSpriteTabs = () => setSpriteTabsHidden(!hidden);
const useSpriteTabsHidden = () => {
    const [value, setValue] = useState(hidden);
    useEffect(() => {
        const onChange = () => setValue(areSpriteTabsHidden());
        window.addEventListener(EVENT, onChange);
        onChange();
        return () => window.removeEventListener(EVENT, onChange);
    }, []);
    return value;
};
const COMMENT_LABELS = {font: 'Font', bold: 'Bold', italic: 'Italic', alignment: 'Text alignment', fontSize: 'Font size',
    txtColor: 'Text color', color: 'Fill color', opacity: 'Opacity'};
const skinCommentModal = original => {
    if (typeof window.dimodPaintModal !== 'function' || original.dataset.dimodSkinned) return;
    original.dataset.dimodSkinned = '1';
    original.style.display = 'none';
    const fields = Array.from(original.querySelectorAll('input, select')).map(field => ({field, id: field.id}));
    const title = (original.querySelector('h2') || {}).textContent || 'Comment customization';
    let answered = false;
    const finish = ok => {
        if (answered) return;
        answered = true;
        const button = original.querySelector(ok ? '#okayBtn' : '#cancelBtn');
        if (button) button.click();
        else original.remove();
    };
    window.dimodPaintModal(title, () => finish(false)).then(handle => {
        const root = handle.node;
        root.className = 'dimod-cm';
        const css = document.createElement('style');
        css.textContent = `.dimod-cm{display:flex;flex-direction:column;gap:.75rem;min-width:min(20rem,80vw)}
.dimod-cm label{display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:.85rem;font-weight:700}
.dimod-cm input[type=text],.dimod-cm input[type=number],.dimod-cm select{height:2.2rem;box-sizing:border-box;min-width:9rem;padding:0 .85rem;
border:1px solid rgba(128,128,128,.45);border-radius:2rem;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:center}
.dimod-cm input[type=color]{width:3rem;height:2.2rem;border:none;background:none;padding:0}
.dimod-cm input[type=range]{width:9rem}
.dimod-cm-swatch{height:3.2rem;border-radius:.75rem;border:1px solid rgba(128,128,128,.45)}
.dimod-cm-row{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.25rem}
.dimod-cm button{height:2.4rem;padding:0 1.2rem;border:none;border-radius:2rem;font:inherit;font-weight:700;cursor:pointer;touch-action:manipulation}
.dimod-cm .ok{background:var(--paint-motion-primary,#6c5ce7);color:var(--dimod-on-accent,#fff)}
.dimod-cm .cancel{background:rgba(128,128,128,.25);color:inherit}`;
        root.appendChild(css);
        const mine = new Map();
        const swatch = document.createElement('div');
        swatch.className = 'dimod-cm-swatch';
        const refresh = () => {
            const color = mine.get('color');
            const opacity = mine.get('opacity');
            if (color) { swatch.style.background = color.value; swatch.style.opacity = opacity ? opacity.value / 100 : 1; }
        };
        fields.forEach(({field, id}) => {
            const row = document.createElement('label');
            const name = document.createElement('span');
            name.textContent = COMMENT_LABELS[id] || id;
            const control = field.tagName === 'SELECT' ? document.createElement('select') : document.createElement('input');
            if (field.tagName === 'SELECT') {
                Array.from(field.options).forEach(option => {
                    const copy = document.createElement('option');
                    copy.value = option.value;
                    copy.textContent = option.textContent;
                    control.appendChild(copy);
                });
                control.value = field.value;
            } else {
                control.type = field.type;
                ['min', 'max', 'step'].forEach(attr => {
                    if (field.hasAttribute(attr)) control.setAttribute(attr, field.getAttribute(attr));
                });
                if (field.type === 'checkbox') control.checked = field.checked;
                else control.value = field.value;
            }
            control.addEventListener('input', refresh);
            mine.set(id, control);
            row.append(name, control);
            root.appendChild(row);
        });
        if (mine.has('color')) { root.appendChild(swatch); refresh(); }
        const buttons = document.createElement('div');
        buttons.className = 'dimod-cm-row';
        const cancel = document.createElement('button');
        cancel.className = 'cancel';
        cancel.textContent = 'Cancel';
        cancel.onclick = () => { finish(false); handle.close(); };
        const ok = document.createElement('button');
        ok.className = 'ok';
        ok.textContent = 'Okay';
        ok.onclick = () => {
            fields.forEach(({field, id}) => {
                const control = mine.get(id);
                if (field.type === 'checkbox') field.checked = control.checked;
                else field.value = control.value;
            });
            finish(true);
            handle.close();
        };
        buttons.append(cancel, ok);
        root.appendChild(buttons);
    });
};
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
            if (node.classList && node.classList.contains('SPcommentModal')) skinCommentModal(node);
        }));
    }).observe(document.body || document.documentElement, {childList: true});
}
if (typeof document !== 'undefined' && !document.getElementById('dimod-feedback-style')) {
    const style = document.createElement('style');
    style.id = 'dimod-feedback-style';
    style.textContent = `
button, [role="button"], select, label, summary { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
button:not(:disabled):active, [role="button"]:active { filter: brightness(.88); }`;
    document.head.appendChild(style);
}
export {rememberItem, DEFAULT_EXTENSIONS, EVENT$1 as FOCUS_MODE_EVENT, areSpriteTabsHidden, buildIndex, buildItems, createBlockSearch, deleteStack, deleteVariable, findIssues, findUses, getBlockly, getWorkspace, hideFromPalette, installDefaultExtensions, installWorkspaceTools, isFocusMode, isLivePeekEnabled, makeBlockLabeler, openUses, rankItems, readableProccode, revealBlock, scoreText, setFocusMode, setLivePeekEnabled, setSpriteTabsHidden, showBlocks, showCostume, showSound, showTab, showVariables, subjectOf, switchToTarget, takePendingSelect, toggleFocusMode, toggleSpriteTabs, useFocusMode, useSpriteTabsHidden, usesItems, waitFor};
