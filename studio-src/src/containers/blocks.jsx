import {getCustomPromptHost, isUserTyping} from '../lib/dimod-ui';
import bindAll from 'lodash.bindall';
import debounce from 'lodash.debounce';
import defaultsDeep from 'lodash.defaultsdeep';
import makeToolboxXML from '../lib/make-toolbox-xml';
import PropTypes from 'prop-types';
import React from 'react';
import {intlShape, injectIntl, defineMessages} from 'react-intl';
import VMScratchBlocks from '../lib/blocks';
import VM from 'scratch-vm';

import log from '../lib/log.js';
import Prompt from './prompt.jsx';
import BlocksComponent from '../components/blocks/blocks.jsx';
import ExtensionLibrary from './extension-library.jsx';
import extensionData from '../lib/libraries/extensions/index.jsx';
import CustomProcedures from './custom-procedures.jsx';
import errorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {BLOCKS_DEFAULT_SCALE, STAGE_DISPLAY_SIZES} from '../lib/layout-constants';
import DropAreaHOC from '../lib/drop-area-hoc.jsx';
import DragConstants from '../lib/drag-constants';
import defineDynamicBlock from '../lib/define-dynamic-block';
import AddonHooks from '../addons/hooks';
import LoadScratchBlocksHOC from '../lib/tw-load-scratch-blocks-hoc.jsx';
import {
    confirmAndEnableCloud,
    loadCloudState,
    onCloudStateChange,
    getDimodUserId,
    getLastLocalEditAt,
    hasUnsavedLocalEdits,
    runAsRemote
} from '../lib/dimod-project';
import uid from "../lib/uid.js";
import {DimodCollabCursors} from './dimod-collab.jsx';
import {
    installDragPreviewHook,
    attachShadowRef,
    resolveIncomingEvent,
    shareBlocksToTargetWithSync,
    computeBlocksHash,
    allTargetHashes,
    applyTargetBlocks,
    installBlockStateResponder,
    targetBlocksHash,
    ensureEventVariables,
    abandonGesture,
    hasActiveGesture,
    installGestureRecovery,
    installFieldCarets,
    registerFieldCaretScope
} from '../lib/dimod-collab.js';
import {
    ENTER_PATH,
    EXIT_PATH,
    isFullscreen,
    onFullscreenChange,
    panelOf,
    toggleFullscreen
} from '../components/dimod-fullscreen/dimod-fullscreen.jsx';
import RestorePointAPI from '../lib/tw-restore-point-api';
import {
    clearPersistentFieldWidths,
    findStaleField,
    installPersistentFieldWidths,
    watchFieldWidths,
    WorkspaceCache
} from '../lib/dimod-blocks';
import {installConnectSafetyRails, repairAskewBlocks} from '../lib/dimod-collab';
import {fontArrivedLate, onFontChanged, onUiFontFaceLoaded} from '../lib/dimod-fonts';
import {manuallyTrustExtension} from './tw-security-manager.jsx';
import {loadExtensionURLWithTimeout} from '../lib/dimod-vm-patches';
import {hideFromPalette} from '../lib/dimod-editor';

import {connect} from 'react-redux';
import {updateToolbox} from '../reducers/toolbox';
import {toggleMenuShowsAll as toggleAnimationMenuShowsAll} from '../lib/dimod-animation/blocks';
import {activateColorPicker} from '../reducers/color-picker';
import {
    closeExtensionLibrary,
    openSoundRecorder,
    openConnectionModal,
    openCustomExtensionModal
} from '../reducers/modals';
import {activateCustomProcedures, deactivateCustomProcedures} from '../reducers/custom-procedures';
import {setConnectionModalExtensionId} from '../reducers/connection-modal';
import {updateMetrics} from '../reducers/workspace-metrics';

import {activateTab, SOUNDS_TAB_INDEX} from '../reducers/editor-tab';

// TW: Strings we add to scratch-blocks are localized here
const messages = defineMessages({
    PROCEDURES_RETURN: {
        defaultMessage: 'return {v}',
        // eslint-disable-next-line max-len
        description: 'The name of the "return" block from the Custom Reporters extension. {v} is replaced with a slot to insert a value.',
        id: 'tw.blocks.PROCEDURES_RETURN'
    },
    PROCEDURES_TO_REPORTER: {
        defaultMessage: 'Change To Reporter',
        // eslint-disable-next-line max-len
        description: 'Context menu item to change a command-shaped custom block into a reporter. Part of the Custom Reporters extension.',
        id: 'tw.blocks.PROCEDURES_TO_REPORTER'
    },
    PROCEDURES_TO_STATEMENT: {
        defaultMessage: 'Change To Statement',
        // eslint-disable-next-line max-len
        description: 'Context menu item to change a reporter-shaped custom block into a statement/command. Part of the Custom Reporters extension.',
        id: 'tw.blocks.PROCEDURES_TO_STATEMENT'
    },
    PROCEDURES_DOCS: {
        defaultMessage: 'How to use return',
        // eslint-disable-next-line max-len
        description: 'Button in extension list to learn how to use the "return" block from the Custom Reporters extension.',
        id: 'tw.blocks.PROCEDURES_DOCS'
    }
});

const fullscreenIconHref = on => `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">' +
    '<circle cx="18" cy="18" r="18" fill="#231f20" opacity=".15"/><circle cx="18" cy="18" r="16" fill="#fff"/>' +
    `<path transform="translate(10 10)" d="${on ? EXIT_PATH : ENTER_PATH}" fill="none" stroke="#575e75" ` +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/></svg>'
)}`;

const addFullscreenZoomControl = ZoomControls => {
    if (ZoomControls.prototype.dimodFullscreen) return;
    ZoomControls.prototype.dimodFullscreen = true;
    ZoomControls.prototype.HEIGHT_ += ZoomControls.prototype.WIDTH_ + ZoomControls.prototype.MARGIN_BETWEEN_;
    const createDom = ZoomControls.prototype.createDom;
    ZoomControls.prototype.createDom = function () {
        const group = createDom.call(this);
        const workspace = this.workspace_;
        const button = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        button.setAttribute('width', this.WIDTH_);
        button.setAttribute('height', this.WIDTH_);
        button.setAttribute('y', 3 * (this.WIDTH_ + this.MARGIN_BETWEEN_));
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        button.appendChild(title);
        const panel = () => panelOf(workspace.getInjectionDiv());
        const update = () => {
            const on = isFullscreen(panel());
            button.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', fullscreenIconHref(on));
            title.textContent = on ? 'Exit fullscreen (Esc)' : 'Fullscreen';
        };
        update();
        button.addEventListener('mousedown', e => {
            workspace.markFocused();
            toggleFullscreen(panel());
            e.stopPropagation();
            e.preventDefault();
        });
        this.dimodOffFullscreen = onFullscreenChange(update);
        group.appendChild(button);
        return group;
    };
    const dispose = ZoomControls.prototype.dispose;
    ZoomControls.prototype.dispose = function () {
        if (this.dimodOffFullscreen) this.dimodOffFullscreen();
        dispose.call(this);
    };
};

const addFunctionListener = (object, property, callback) => {
    const oldFn = object[property];
    object[property] = function (...args) {
        const result = oldFn.apply(this, args);
        callback.apply(this, result);
        return result;
    };
};
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const WORKSPACE_HEALTH_CHECK_MS = 2500;
const BLOCK_STATE_REPLY_TIMEOUT_MS = 8000;
const WORKSPACE_HEALTH_MISMATCH_THRESHOLD = 3;
const WORKSPACE_HEALTH_WARMUP_MS = 15000;
const LOCAL_MISMATCH_REPAIR_THRESHOLD = 2;
const WORKSPACE_HEALTH_RUN_GRACE_MS = 3000;
const WORKSPACE_RESYNC_COOLDOWN_MS = 5 * 60 * 1000;
const RENDER_HASH_DEBOUNCE_MS = 400;

const withCommentEventFields = (event, json) => {
    if (event.type === 'comment_create') {
        return {
            ...json,
            text: event.text,
            xy: event.xy ? {x: event.xy.x, y: event.xy.y} : null,
            width: event.width,
            height: event.height,
            minimized: !!event.minimized
        };
    }
    if (event.type === 'comment_change') {
        return {...json, newValue: event.newContents_};
    }
    return json;
};
const restoreCommentEventFields = (event, json) => {
    if (json.type === 'comment_create' && json.xy) {
        event.xy = json.xy;
        event.text = json.text || '';
        event.width = json.width;
        event.height = json.height;
        event.minimized = !!json.minimized;
    } else if (json.type === 'comment_change' && !event.newContents_ && json.newContents) {
        event.newContents_ = json.newContents;
    }
};
const commentEventForVm = json => {
    if (json.type === 'comment_create') {
        if (!json.xy) return null;
        return {
            ...json,
            text: json.text || '',
            width: typeof json.width === 'number' ? json.width : 200,
            height: typeof json.height === 'number' ? json.height : 200,
            minimized: !!json.minimized
        };
    }
    if (json.type === 'comment_change') {
        const contents = json.newValue || json.newContents;
        return contents ? {...json, newContents_: contents} : null;
    }
    if (json.type === 'comment_move') {
        if (typeof json.newCoordinate !== 'string') return null;
        const [x, y] = json.newCoordinate.split(',').map(parseFloat);
        return {...json, newCoordinate_: {x, y}};
    }
    return json;
};

const installEventStamp = ScratchBlocks => {
    const Events = ScratchBlocks.Events;
    if (Events.__dimodStamped) return;
    Events.__dimodStamped = true;
    const fire = Events.fire;
    Events.fire = function (event) {
        if (event && !event.dimodTargetId && Events.dimodStampFor) {
            const targetId = Events.dimodStampFor(event);
            if (targetId) event.dimodTargetId = targetId;
        }
        return fire.call(this, event);
    };
};

const DroppableBlocks = DropAreaHOC([
    DragConstants.BACKPACK_CODE
])(BlocksComponent);

class Blocks extends React.Component {
    constructor (props) {
        super(props);
        this.ScratchBlocks = VMScratchBlocks(props.vm);
        installDragPreviewHook(this.ScratchBlocks);
        installGestureRecovery(this.ScratchBlocks);
        installFieldCarets(this.ScratchBlocks);
        installPersistentFieldWidths(this.ScratchBlocks);
        installConnectSafetyRails(this.ScratchBlocks);
        installEventStamp(this.ScratchBlocks);
        this._loadingTargetId = null;
        this.ScratchBlocks.Events.dimodStampFor = event => {
            if (!this.workspace || event.workspaceId !== this.workspace.id) return null;
            if (this._loadingTargetId) return this._loadingTargetId;
            if (this._loaded) return this._loaded.targetId;
            return this.props.vm.editingTarget ? this.props.vm.editingTarget.id : null;
        };
        this.workspaceCache = new WorkspaceCache(this.ScratchBlocks, props.vm);
        this._loaded = null;
        this._workspaceDirty = false;
        this._renderHash = null;
        this._renderedHidden = false;
        this._renderHashTimeout = null;
        this.repairAskewBlocksSoon = debounce(() => {
            if (this.workspace) repairAskewBlocks(this.workspace);
        }, 250);
        this.ScratchBlocks.Toolbox.registerMenu('extensionControls', [
            {
                text: 'Remove Extension',
                enabled: true,
                callback: ext => {
                    const url = props.vm.extensionManager.extensionUrlFromId(ext);
                    props.vm.extensionManager.removeExtension(ext);
                    if (window.dimodCollab) {
                        window.dimodCollab.sendExtensionRemove({extensionIds: [ext], urls: url ? [url] : []});
                    }
                }
            },
            {
                text: 'Remove Unused Extensions',
                enabled: true,
                callback: () => {
                    const before = props.vm.extensionManager.getExtensionURLs();
                    props.vm.extensionManager.removeUnusedExtensions();
                    const after = props.vm.extensionManager.getExtensionURLs();
                    const removedIds = Object.keys(before).filter(extId => !(extId in after));
                    if (window.dimodCollab && removedIds.length) {
                        window.dimodCollab.sendExtensionRemove({
                            extensionIds: removedIds,
                            urls: removedIds.map(extId => before[extId]).filter(Boolean)
                        });
                    }
                }
            },
            {
                text: 'Replace Extension',
                enabled: true,
                callback: ext => this.props.onOpenCustomExtensionModal(ext)
            }
        ]);
        window.ScratchBlocks = this.ScratchBlocks;
        AddonHooks.blockly = this.ScratchBlocks;
        AddonHooks.blocklyCallbacks.forEach(i => i());
        AddonHooks.blocklyCallbacks.length = 0;
        bindAll(this, [
            'attachVM',
            'handleVmBlockEvent',
            'detachVM',
            'getToolboxXML',
            'handleCategorySelected',
            'handleConnectionModalStart',
            'handleDrop',
            'handleStatusButtonUpdate',
            'handleOpenSoundRecorder',
            'handlePromptStart',
            'handleCustomPrompt',
            'handleCreateCustomPromptUtility',
            'handlePromptCallback',
            'handlePromptClose',
            'handleCustomProceduresClose',
            'handleExtensionRemoved',
            'onScriptGlowOn',
            'onScriptGlowOff',
            'onBlockGlowOn',
            'onBlockGlowOff',
            'handleMonitorsUpdate',
            'handleExtensionAdded',
            'handleBlocksInfoUpdate',
            'onTargetsUpdate',
            'onVisualReport',
            'onBlockStackError',
            'onWorkspaceUpdate',
            'onWorkspaceMetricsChange',
            'setBlocks',
            'handleFontChanged',
            'setLocale',
            'handleEnableProcedureReturns',
            'handleFieldBoxChange',
            'handleCollabBroadcast',
            'handleRemoteBlockEvent',
            'attachCollabListener',
            'getWorkspaceForCollabCursors',
            'handleRemoteExtensionImport',
            'handleExtensionSync',
            'handleRemoteExtensionRemove',
            'checkWorkspaceHealth',
            'handleRemoteWorkspaceHealth',
            'handleBlockStateMessage'
        ]);
        this.ScratchBlocks.prompt = this.handlePromptStart;
        this.ScratchBlocks.customPrompt = (...args) => {
            const host = getCustomPromptHost();
            return host ? host(...args) : this.handleCustomPrompt(...args);
        };
        this.ScratchBlocks.statusButtonCallback = this.handleConnectionModalStart;
        this.ScratchBlocks.recordSoundCallback = this.handleOpenSoundRecorder;

        this.state = {
            prompt: null,
            customPrompts: [],
        };
        this.onTargetsUpdate = debounce(this.onTargetsUpdate, 100);
        this.toolboxUpdateQueue = [];
        this.customModalRefs = new Map();
        this._deferredRemoteBlockEvents = [];
        this._deferredRemoteFlushTimer = null;
    }
    componentDidMount () {
        this.props.vm.setCompilerOptions({
            warpTimer: true
        });
        this.props.vm.setInEditor(false);

        this.ScratchBlocks.FieldColourSlider.activateEyedropper_ = this.props.onActivateColorPicker;
        this.ScratchBlocks.Procedures.externalProcedureDefCallback = this.props.onActivateCustomProcedures;
        this.ScratchBlocks.ScratchMsgs.setLocale(this.props.locale);

        const Msg = this.ScratchBlocks.Msg;
        Msg.PROCEDURES_RETURN = this.props.intl.formatMessage(messages.PROCEDURES_RETURN, {
            v: '%1'
        });
        Msg.PROCEDURES_TO_REPORTER = this.props.intl.formatMessage(messages.PROCEDURES_TO_REPORTER);
        Msg.PROCEDURES_TO_STATEMENT = this.props.intl.formatMessage(messages.PROCEDURES_TO_STATEMENT);
        Msg.PROCEDURES_DOCS = this.props.intl.formatMessage(messages.PROCEDURES_DOCS);

        const workspaceConfig = defaultsDeep({},
            Blocks.defaultOptions,
            this.props.options,
            {rtl: this.props.isRtl, toolbox: this.props.toolboxXML}
        );
        addFullscreenZoomControl(this.ScratchBlocks.ZoomControls);
        this.workspace = this.ScratchBlocks.inject(this.blocks, workspaceConfig);
        if (window.ResizeObserver) { // hack: blockly only resizes on window resize, so layout shifts cut the code area off
            this.sizeObserver = new ResizeObserver(() => {
                if (this.workspace && this.props.isVisible) this.ScratchBlocks.svgResize(this.workspace);
            });
            this.sizeObserver.observe(this.blocks);
        }
        this.offFieldCarets = registerFieldCaretScope(
            'code',
            () => this.workspace,
            () => (this.props.vm.editingTarget ? this.props.vm.editingTarget.id : null)
        );

        // Register buttons under new callback keys for creating variables,
        // lists, and procedures from extensions.

        const toolboxWorkspace = this.workspace.getFlyout().getWorkspace();

        const varListButtonCallback = type =>
            (() => this.ScratchBlocks.Variables.createVariable(this.workspace, null, type));
        const procButtonCallback = () => {
            this.ScratchBlocks.Procedures.createProcedureDefCallback_(this.workspace);
        };

        toolboxWorkspace.registerButtonCallback('MAKE_A_VARIABLE', varListButtonCallback(''));
        toolboxWorkspace.registerButtonCallback('MAKE_A_LIST', varListButtonCallback('list'));
        toolboxWorkspace.registerButtonCallback('MAKE_A_PROCEDURE', procButtonCallback);
        toolboxWorkspace.registerButtonCallback('DIMOD_ENABLE_CLOUD', () => confirmAndEnableCloud());
        toolboxWorkspace.registerButtonCallback('DIMOD_ANIMATION_MENU_ALL', () => {
            toggleAnimationMenuShowsAll();
            this.handleExtensionRemoved();
        });
        toolboxWorkspace.registerButtonCallback('EXTENSION_CALLBACK', block => {
            this.props.vm.handleExtensionButtonPress(block.callbackData_);
        });
        toolboxWorkspace.registerButtonCallback('OPEN_EXTENSION_DOCS', block => {
            const docsURI = block.callbackData_;
            const url = new URL(docsURI);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                window.open(docsURI, '_blank');
            }
        });
        toolboxWorkspace.registerButtonCallback('OPEN_RETURN_DOCS', () => {
            window.open('https://docs.turbowarp.org/return', '_blank');
        });
        toolboxWorkspace.registerButtonCallback('OPEN_USERNAME_DOCS', () => {
            window.open('https://docs.penguinmod.com/username', '_blank');
        });

        // Store the xml of the toolbox that is actually rendered.
        // This is used in componentDidUpdate instead of prevProps, because
        // the xml can change while e.g. on the costumes tab.
        this._renderedToolboxXML = this.props.toolboxXML;

        // we actually never want the workspace to enable "refresh toolbox" - this basically re-renders the
        // entire toolbox every time we reset the workspace.  We call updateToolbox as a part of
        // componentDidUpdate so the toolbox will still correctly be updated
        this.setToolboxRefreshEnabled = this.workspace.setToolboxRefreshEnabled.bind(this.workspace);
        this.workspace.setToolboxRefreshEnabled = value => {
            this.setToolboxRefreshEnabled(value);
        };

        // @todo change this when blockly supports UI events
        addFunctionListener(this.workspace, 'translate', this.onWorkspaceMetricsChange);
        addFunctionListener(this.workspace, 'zoom', this.onWorkspaceMetricsChange);

        this.attachVM();
        // Only update blocks/vm locale when visible to avoid sizing issues
        // If locale changes while not visible it will get handled in didUpdate
        if (this.props.isVisible) {
            this.setLocale();
        }

        // tw: Handle when extensions are added when Blocks isn't mounted
        for (const category of this.props.vm.runtime._blockInfo) {
            this.handleExtensionAdded(category);
        }

        this.offFontChanged = onFontChanged(this.handleFontChanged);
        this.handleUiFontFaceLoaded = debounce(() => {
            if (!this.offFontChanged || !this.workspace) return;
            if (!this.props.isVisible) {
                this._renderedHidden = true;
                return;
            }
            const flyout = this.workspace.getFlyout();
            if (findStaleField([flyout && flyout.getWorkspace(), this.workspace]) !== null) this.handleFontChanged();
        }, 300);
        fontArrivedLate().then(late => {
            if (late) this.handleUiFontFaceLoaded();
        });
        this.offUiFontFaceLoaded = onUiFontFaceLoaded(this.handleUiFontFaceLoaded);
        this.offWidthWatch = watchFieldWidths({
            getWorkspace: () => this.workspace,
            isActive: () => this.props.isVisible && !this.toolboxUpdateTimeout && !this.ScratchBlocks.WidgetDiv.isVisible(),
            refresh: () => {
                clearPersistentFieldWidths(this.ScratchBlocks, true);
                this.handleFontChanged();
            }
        });
    }
    shouldComponentUpdate (nextProps, nextState) {
        return (
            this.state.prompt !== nextState.prompt ||
            this.state.customPrompts !== nextState.customPrompts ||
            (nextState.customPrompts && this.state.customPrompts.length !== nextState.customPrompts.length) ||
            this.props.isVisible !== nextProps.isVisible ||
            this._renderedToolboxXML !== nextProps.toolboxXML ||
            this.props.extensionLibraryVisible !== nextProps.extensionLibraryVisible ||
            this.props.customProceduresVisible !== nextProps.customProceduresVisible ||
            this.props.locale !== nextProps.locale ||
            this.props.anyModalVisible !== nextProps.anyModalVisible ||
            this.props.stageSize !== nextProps.stageSize ||
            this.props.customStageSize !== nextProps.customStageSize
        );
    }
    componentDidUpdate (prevProps) {
        // If any modals are open, call hideChaff to close z-indexed field editors
        if (this.props.anyModalVisible && !prevProps.anyModalVisible) {
            this.ScratchBlocks.hideChaff();
        }

        // Only rerender the toolbox when the blocks are visible and the xml is
        // different from the previously rendered toolbox xml.
        // Do not check against prevProps.toolboxXML because that may not have been rendered.
        if (this.props.isVisible && this.props.toolboxXML !== this._renderedToolboxXML) {
            this.requestToolboxUpdate();
        }

        if (this.props.isVisible === prevProps.isVisible) {
            if (
                this.props.stageSize !== prevProps.stageSize ||
                this.props.customStageSize !== prevProps.customStageSize
            ) {
                // force workspace to redraw for the new stage size
                window.dispatchEvent(new Event('resize'));
            }
            return;
        }
        // @todo hack to resize blockly manually in case resize happened while hidden
        // @todo hack to reload the workspace due to gui bug #413
        if (this.props.isVisible) { // Scripts tab
            this.workspace.setVisible(true);
            if (prevProps.locale !== this.props.locale || this.props.locale !== this.props.vm.getLocale()) {
                // call setLocale if the locale has changed, or changed while the blocks were hidden.
                // vm.getLocale() will be out of sync if locale was changed while not visible
                this.setLocale();
            } else {
                this.showTabRaf = requestAnimationFrame(() => {
                    this.showTabTimer = setTimeout(() => {
                        if (this.workspace && this.props.isVisible) {
                            this.props.vm.refreshWorkspace();
                            window.dispatchEvent(new Event('resize'));
                        }
                    }, 0);
                });
            }

            window.dispatchEvent(new Event('resize'));
        } else {
            cancelAnimationFrame(this.showTabRaf);
            clearTimeout(this.showTabTimer);
            this.workspace.setVisible(false);
        }
    }
    componentWillUnmount () {
        if (this.sizeObserver) this.sizeObserver.disconnect();
        this.repairAskewBlocksSoon.cancel();
        if (this.offFieldCarets) this.offFieldCarets();
        if (this.offFontChanged) {
            this.offFontChanged();
            this.offFontChanged = null;
        }
        if (this.offUiFontFaceLoaded) {
            this.offUiFontFaceLoaded();
            this.offUiFontFaceLoaded = null;
        }
        if (this.handleUiFontFaceLoaded) this.handleUiFontFaceLoaded.cancel();
        if (this.offWidthWatch) this.offWidthWatch();
        this.detachVM();
        this.workspace.dispose();
        clearTimeout(this.toolboxUpdateTimeout);
        clearTimeout(this._renderHashTimeout);
        cancelAnimationFrame(this.showTabRaf);
        clearTimeout(this.showTabTimer);
        this.props.vm.setInEditor(false);
    }
    requestToolboxUpdate () {
        clearTimeout(this.toolboxUpdateTimeout);
        this.toolboxUpdateTimeout = setTimeout(() => {
            this.updateToolbox();
        }, 0);
    }
    handleFontChanged () {
        if (!this.workspace) {
            return;
        }
        clearPersistentFieldWidths(this.ScratchBlocks);
        this.workspace.getFlyout().setRecyclingEnabled(false);
        this.props.vm.refreshWorkspace();
        this.requestToolboxUpdate();
        this.withToolboxUpdates(() => {
            this.workspace.getFlyout().setRecyclingEnabled(true);
        });
    }
    setLocale () {
        this.ScratchBlocks.ScratchMsgs.setLocale(this.props.locale);
        this.props.vm.setLocale(this.props.locale, this.props.messages)
            .then(() => {
                this.workspace.getFlyout().setRecyclingEnabled(false);
                this.props.vm.refreshWorkspace();
                this.requestToolboxUpdate();
                this.withToolboxUpdates(() => {
                    this.workspace.getFlyout().setRecyclingEnabled(true);
                });
            });
    }

    updateToolbox () {
        this.toolboxUpdateTimeout = false;

        const categoryId = this.workspace.toolbox_.getSelectedCategoryId();
        const offset = this.workspace.toolbox_.getCategoryScrollOffset();
        this.workspace.updateToolbox(this.props.toolboxXML);
        this._renderedToolboxXML = this.props.toolboxXML;

        // In order to catch any changes that mutate the toolbox during "normal runtime"
        // (variable changes/etc), re-enable toolbox refresh.
        // Using the setter function will rerender the entire toolbox which we just rendered.
        this.workspace.toolboxRefreshEnabled_ = true;

        const currentCategoryPos = this.workspace.toolbox_.getCategoryPositionById(categoryId);
        const currentCategoryLen = this.workspace.toolbox_.getCategoryLengthById(categoryId);
        if (offset < currentCategoryLen) {
            this.workspace.toolbox_.setFlyoutScrollPos(currentCategoryPos + offset);
        } else {
            this.workspace.toolbox_.setFlyoutScrollPos(currentCategoryPos);
        }

        this.labelExtensionCategories();

        const queue = this.toolboxUpdateQueue;
        this.toolboxUpdateQueue = [];
        queue.forEach(fn => fn());
    }

    labelExtensionCategories () {
        try {
            const toolbox = this.workspace && this.workspace.toolbox_;
            const menu = toolbox && toolbox.categoryMenu_;
            if (!menu || !menu.categories_) return;
            for (const category of menu.categories_) {
                if (!category.item_ || !category.getMenuOptions()) continue;
                category.item_.title = 'Right-click to remove or replace this extension';
            }
        } catch (e) {
        }
    }

    withToolboxUpdates (fn) {
        // if there is a queued toolbox update, we need to wait
        if (this.toolboxUpdateTimeout) {
            this.toolboxUpdateQueue.push(fn);
        } else {
            fn();
        }
    }

    handleVmBlockEvent (event) {
        const vm = this.props.vm;
        const editing = vm.editingTarget;
        const targetId = event.dimodTargetId;
        if (!targetId || !editing || targetId === editing.id) {
            vm.blockListener(event);
            return;
        }
        const target = vm.runtime.getTargetById(targetId);
        if (!target) return;
        const runtime = vm.runtime;
        const previous = runtime.getEditingTarget();
        runtime._editingTarget = target;
        try {
            target.blocks.blocklyListen(event);
        } finally {
            runtime._editingTarget = previous;
        }
    }
    handleCollabBroadcast (event) {
        if (this._applyingRemoteBlockEvent) return;
        if (this._suppressCollabBroadcast) return;
        if (!window.dimodCollab) return;
        const BROADCASTABLE_TYPES = [
            'create', 'delete', 'change', 'move',
            'var_create', 'var_delete', 'var_rename',
            'comment_create', 'comment_change', 'comment_move', 'comment_delete'
        ];
        if (!BROADCASTABLE_TYPES.includes(event.type)) return;
        const target = event.dimodTargetId ?
            this.props.vm.runtime.getTargetById(event.dimodTargetId) :
            this.props.vm.editingTarget;
        if (!target) return;
        if (!this._localTargetEditAt) this._localTargetEditAt = {};
        this._localTargetEditAt[target.id] = Date.now();
        window.dimodCollab.sendBlockEvent(
            attachShadowRef(target.blocks, withCommentEventFields(event, {
                ...event.toJson(),
                targetId: target.id
            }))
        );
    }
    applyWithoutBroadcast (fn) {
        const canFlush = typeof this.ScratchBlocks.Events.fireNow_ === 'function';
        if (canFlush) this.ScratchBlocks.Events.fireNow_();
        this._applyingRemoteBlockEvent = true;
        let flushedSynchronously = false;
        try {
            runAsRemote(() => {
                fn();
                if (canFlush) {
                    this.ScratchBlocks.Events.fireNow_();
                    flushedSynchronously = true;
                }
            });
        } finally {
            if (flushedSynchronously) {
                this._applyingRemoteBlockEvent = false;
            } else {
                setTimeout(() => {
                    this._applyingRemoteBlockEvent = false;
                }, 0);
            }
        }
    }
    handleRemoteBlockEvent (rawEventJson) {
        if (this._deferredRemoteBlockEvents.length || hasActiveGesture(this.workspace)) {
            this._deferredRemoteBlockEvents.push(rawEventJson);
            this.scheduleDeferredRemoteFlush();
            return;
        }
        this.applyRemoteBlockEvent(rawEventJson);
    }
    scheduleDeferredRemoteFlush () {
        if (this._deferredRemoteFlushTimer) return;
        this._deferredRemoteFlushTimer = setTimeout(() => {
            this._deferredRemoteFlushTimer = null;
            if (hasActiveGesture(this.workspace)) {
                this.scheduleDeferredRemoteFlush();
                return;
            }
            const queued = this._deferredRemoteBlockEvents;
            this._deferredRemoteBlockEvents = [];
            queued.forEach(eventJson => this.applyRemoteBlockEvent(eventJson));
        }, 100);
    }
    applyRemoteBlockEvent (rawEventJson) {
        const target = this.props.vm.editingTarget;
        if (!target) return;
        //
        const isProcedureDefinition = rawEventJson.type === 'create' &&
            typeof rawEventJson.xml === 'string' &&
            rawEventJson.xml.includes('type="procedures_definition"');
        if (rawEventJson.targetId !== target.id || this._workspaceDeferred) {
            this.applyRemoteBlockEventToBackgroundTarget(rawEventJson);
            return;
        }
        const eventJson = resolveIncomingEvent(target.blocks, rawEventJson);
        if (!eventJson) return;
        if (eventJson.type === 'create' && eventJson.blockId && this.workspace.getBlockById(eventJson.blockId)) {
            return;
        }
        if (eventJson.type === 'create' && this.createClashesWithWorkspace(eventJson)) return;
        if (!ensureEventVariables(eventJson, this.workspace, this.props.vm, target)) return;
        //
        //
        try {
            this.applyWithoutBroadcast(() => {
                const event = this.ScratchBlocks.Events.fromJson(eventJson, this.workspace);
                restoreCommentEventFields(event, eventJson);
                event.run(true);
            });
            if (eventJson.type === 'create' && eventJson.blockId) {
                const newBlockId = eventJson.blockId;
                this.workspace.glowBlock(newBlockId, true);
                setTimeout(() => {
                    if (this.workspace.getBlockById(newBlockId)) {
                        this.workspace.glowBlock(newBlockId, false);
                    }
                }, 1500);
            }
        } catch (e) {
            log.warn('Failed to apply remote collab block event', e);
        }
        this.repairAskewBlocksSoon();
        if (isProcedureDefinition) {
            this.props.vm.refreshWorkspace();
            this.requestToolboxUpdate();
        }
    }
    createClashesWithWorkspace (eventJson) {
        if (typeof eventJson.xml !== 'string') return false;
        const ids = eventJson.xml.match(/<block\b[^>]*\sid="[^"]*"/g) || [];
        return ids.some(tag => {
            const raw = tag.match(/\sid="([^"]*)"/)[1]
                .replace(/&quot;/g, '"')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&apos;/g, "'")
                .replace(/&amp;/g, '&');
            if (!this.workspace.getBlockById(raw)) return false;
            log.warn(`Ignoring a remote create for block ${raw}, which is already on this workspace`);
            return true;
        });
    }
    //
    applyRemoteBlockEventToBackgroundTarget (rawEventJson) {
        const BACKGROUND_APPLICABLE_TYPES = [
            'create', 'change', 'move', 'delete',
            'var_create', 'var_rename', 'var_delete',
            'comment_create', 'comment_change', 'comment_move', 'comment_delete'
        ];
        if (!BACKGROUND_APPLICABLE_TYPES.includes(rawEventJson.type)) return;
        const runtime = this.props.vm.runtime;
        const otherTarget = runtime.getTargetById(rawEventJson.targetId);
        if (!otherTarget) return;

        const eventJson = resolveIncomingEvent(otherTarget.blocks, rawEventJson);
        if (!eventJson) return;

        let preparedEvent = eventJson;
        if (eventJson.type === 'create') {
            if (eventJson.blockId && otherTarget.blocks.getBlock(eventJson.blockId)) return;
            if (typeof eventJson.xml !== 'string') return;
            preparedEvent = {...eventJson, xml: this.ScratchBlocks.Xml.textToDom(eventJson.xml)};
        } else if (eventJson.type.startsWith('comment_')) {
            preparedEvent = commentEventForVm(eventJson);
            if (!preparedEvent) return;
        }
        const varStage = runtime.getTargetForStage();
        const wasGlobalVar = eventJson.type.startsWith('var_') && varStage &&
            Object.prototype.hasOwnProperty.call(varStage.variables, eventJson.varId);

        const previousEditingTarget = runtime.getEditingTarget();
        runtime._editingTarget = otherTarget;
        try {
            otherTarget.blocks.blocklyListen(preparedEvent);
        } catch (e) {
            log.warn('Failed to apply remote collab block event to a background sprite', e);
        } finally {
            runtime._editingTarget = previousEditingTarget;
        }
        if (eventJson.type.startsWith('var_')) this.mirrorGlobalVariableEvent(eventJson, wasGlobalVar);
    }
    mirrorGlobalVariableEvent (eventJson, wasGlobalVar) {
        const stage = this.props.vm.runtime.getTargetForStage();
        const ws = this.workspace;
        if (!stage || !ws) return;
        const isGlobalNow = Object.prototype.hasOwnProperty.call(stage.variables, eventJson.varId);
        try {
            if (eventJson.type === 'var_create' && isGlobalNow && !ws.getVariableById(eventJson.varId)) {
                const v = stage.variables[eventJson.varId];
                this.applyWithoutBroadcast(() => {
                    ws.createVariable(v.name, v.type, v.id, false, !!v.isCloud);
                });
            } else if (eventJson.type === 'var_rename' && isGlobalNow && ws.getVariableById(eventJson.varId)) {
                this.applyWithoutBroadcast(() => {
                    ws.renameVariableById(eventJson.varId, eventJson.newName);
                });
            } else if (eventJson.type === 'var_delete' && wasGlobalVar && !isGlobalNow &&
                ws.getVariableById(eventJson.varId) && ws.getVariableUsesById(eventJson.varId).length === 0) {
                this.applyWithoutBroadcast(() => {
                    ws.deleteVariableById(eventJson.varId);
                });
            } else {
                return;
            }
            this.requestToolboxUpdate();
        } catch (e) {
            log.warn('Failed to mirror remote global variable change onto the workspace', e);
        }
    }
    attachVM () {
        this.workspace.addChangeListener(this.handleVmBlockEvent);
        this.workspace.addChangeListener(this.handleCollabBroadcast);
        this.attachCollabListener();
        this.flyoutWorkspace = this.workspace
            .getFlyout()
            .getWorkspace();
        this.flyoutWorkspace.addChangeListener(this.props.vm.flyoutBlockListener);
        this.flyoutWorkspace.addChangeListener(this.props.vm.monitorBlockListener);
        this.flyoutWorkspace.addChangeListener(this.handleFieldBoxChange);
        this.props.vm.addListener('SCRIPT_GLOW_ON', this.onScriptGlowOn);
        this.props.vm.addListener('SCRIPT_GLOW_OFF', this.onScriptGlowOff);
        this.props.vm.addListener('BLOCK_GLOW_ON', this.onBlockGlowOn);
        this.props.vm.addListener('BLOCK_GLOW_OFF', this.onBlockGlowOff);
        this.props.vm.addListener('VISUAL_REPORT', this.onVisualReport);
        this.props.vm.addListener('BLOCK_STACK_ERROR', this.onBlockStackError);
        this.props.vm.addListener('workspaceUpdate', this.onWorkspaceUpdate);
        this.props.vm.addListener('targetsUpdate', this.onTargetsUpdate);
        this.props.vm.addListener('MONITORS_UPDATE', this.handleMonitorsUpdate);
        this.props.vm.addListener('EXTENSION_ADDED', this.handleExtensionAdded);
        this._dropWorkspaceCache = () => {
            if (this.workspaceCache) this.workspaceCache.clear();
            this._loaded = null;
            this._renderHash = null;
        };
        this.props.vm.addListener('EXTENSION_ADDED', this._dropWorkspaceCache);
        this.props.vm.runtime.addListener('PROJECT_LOADED', this._dropWorkspaceCache);
        this._markWorkspaceDirty = e => {
            if (!e || e.isUiEvent) return;
            this._workspaceRevision = (this._workspaceRevision || 0) + 1;
            if (!this.props.isVisible) this._renderedHidden = true;
            if (this._suppressCollabBroadcast) return;
            this._workspaceDirty = true;
            this._renderHash = null;
            this.scheduleRenderHash();
        };
        this.workspace.addChangeListener(this._markWorkspaceDirty);
        this.props.vm.addListener('EXTENSION_REMOVED', this.handleExtensionRemoved);
        this.props.vm.addListener('BLOCKSINFO_UPDATE', this.handleBlocksInfoUpdate);
        this.props.vm.addListener('PERIPHERAL_CONNECTED', this.handleStatusButtonUpdate);
        this.props.vm.addListener('PERIPHERAL_DISCONNECTED', this.handleStatusButtonUpdate);
        this._offCloudState = onCloudStateChange(() => this.requestToolboxUpdate());
        this.handleAnimationsChanged = () => {
            clearTimeout(this._animationsToolboxTimer);
            this._animationsToolboxTimer = setTimeout(() => this.handleExtensionRemoved(), 500);
        };
        this.props.vm.runtime.on('DIMOD_ANIMATIONS_CHANGED', this.handleAnimationsChanged);
        this.handleMediaNamesChanged = () => {
            const vm = this.props.vm;
            const sig = JSON.stringify([vm.dimodAssets && vm.dimodAssets.list.map(a => [a.name, a.kind]),
                vm.dimodScenes && vm.dimodScenes.names]);
            if (sig === this._mediaNamesSig) return;
            this._mediaNamesSig = sig;
            this.handleAnimationsChanged();
        };
        this.props.vm.runtime.on('DIMOD_ASSETS', this.handleMediaNamesChanged);
        this.props.vm.runtime.on('DIMOD_SCENES', this.handleMediaNamesChanged);
        loadCloudState();
        this._peerWorkspaceHashes = {};
        this._pendingBlockStates = new Map();
        this._localMismatchStreak = 0;
        this._wasProjectFullyLoaded = false;
        this._workspaceHealthArmAt = 0;
        this._workspaceRevision = 0;
        this._healthCache = null;
        this._projectRunning = false;
        this._runStoppedAt = 0;
        this._lastResyncAt = 0;
        this._onProjectRunStart = () => {
            this._projectRunning = true;
        };
        this._onProjectRunStop = () => {
            this._projectRunning = false;
            this._runStoppedAt = Date.now();
        };
        this.props.vm.runtime.on('PROJECT_RUN_START', this._onProjectRunStart);
        this.props.vm.runtime.on('PROJECT_RUN_STOP', this._onProjectRunStop);
        this._workspaceHealthInterval = setInterval(this.checkWorkspaceHealth, WORKSPACE_HEALTH_CHECK_MS);
    }
    attachCollabListener () {
        if (window.dimodCollab) {
            window.dimodCollab.onBlockEvent = this.handleRemoteBlockEvent;
            window.dimodCollab.onExtensionImport = this.handleRemoteExtensionImport;
            window.dimodCollab.onExtensionSync = this.handleExtensionSync;
            window.dimodCollab.onExtensionRemove = this.handleRemoteExtensionRemove;
            window.dimodCollab.onWorkspaceHealth = this.handleRemoteWorkspaceHealth;
            if (this._offBlockState) this._offBlockState();
            const offResponder = installBlockStateResponder(this.props.vm, window.dimodCollab);
            const offReceiver = window.dimodCollab.addMessageListener(this.handleBlockStateMessage);
            this._offBlockState = () => {
                offResponder();
                offReceiver();
                this._offBlockState = null;
            };
            return;
        }
        window.addEventListener('dimod:collab-ready', this.attachCollabListener, {once: true});
    }
    //
    handleRemoteExtensionImport (payload) {
        if (!payload || !payload.url) return;
        if (payload.unsandboxed) manuallyTrustExtension(payload.url);
        if (this.props.vm.extensionManager.isExtensionLoaded(payload.url)) return;
        loadExtensionURLWithTimeout(this.props.vm, payload.url)
            .then(() => {
                this.announceRemoteExtensionLoad(payload);
            })
            .catch(err => {
                log.warn('Failed to apply remote collab extension import', err);
            });
    }
    handleExtensionSync (extensions) {
        if (!Array.isArray(extensions)) return;
        extensions.forEach(ext => this.handleRemoteExtensionImport({...ext, _isInitialSync: true}));
    }
    announceRemoteExtensionLoad (payload) {
        if (payload._isInitialSync) return;
        const who = payload.fromUsername || 'Someone';
        window.dispatchEvent(new CustomEvent('dimod:system-message', {
            detail: {text: `${who} loaded extension: ${this.extensionUrlLabel(payload.url)}`}
        }));
    }
    extensionUrlLabel (url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'data:' ?
                'a custom extension' :
                parsed.hostname + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '');
        } catch (e) {
            return 'a custom extension';
        }
    }
    handleRemoteExtensionRemove (payload) {
        if (!payload || !Array.isArray(payload.extensionIds)) return;
        payload.extensionIds.forEach(extId => {
            if (!this.props.vm.extensionManager.isExtensionLoaded(extId)) return;
            this.props.vm.extensionManager.removeExtension(extId);
        });
        if (!payload.extensionIds.length) return;
        const who = payload.fromUsername || 'Someone';
        const label = (payload.urls && payload.urls[0]) ? this.extensionUrlLabel(payload.urls[0]) : 'an extension';
        window.dispatchEvent(new CustomEvent('dimod:system-message', {
            detail: {text: `${who} removed extension: ${label}`}
        }));
    }
    //
    //
    isProjectRunning () {
        return this._projectRunning || Date.now() - this._runStoppedAt < WORKSPACE_HEALTH_RUN_GRACE_MS;
    }
    workspaceHealthHash (target) {
        const revision = this._workspaceRevision;
        const cached = this._healthCache;
        if (cached && cached.revision === revision && cached.targetId === target.id &&
            typeof cached.hash === 'number') {
            return cached.hash;
        }
        const hash = computeBlocksHash(target);
        this._healthCache = Object.assign({localMismatch: false}, cached, {
            revision, targetId: target.id, hash
        });
        return hash;
    }
    checkWorkspaceHealth () {
        const vm = this.props.vm;
        const target = vm && vm.editingTarget;
        if (!target || !this.workspace) return;

        const fullyLoaded = Boolean(vm.__dimodProjectFullyLoaded);
        if (fullyLoaded && !this._wasProjectFullyLoaded) {
            this._workspaceHealthArmAt = Date.now() + WORKSPACE_HEALTH_WARMUP_MS;
            this._peerWorkspaceHashes = {};
        }
        this._wasProjectFullyLoaded = fullyLoaded;
        if (!fullyLoaded || Date.now() < this._workspaceHealthArmAt) return;
        if (hasActiveGesture(this.workspace) || this._deferredRemoteBlockEvents.length) return;
        if (this.isProjectRunning()) return;

        const cached = this._healthCache;
        const revision = this._workspaceRevision;
        const blockspace = vm.runtime.dimodBlockspace;
        const focus = blockspace && blockspace._focusedOn(target.blocks);
        const focused = focus && focus.targetId === target.id && blockspace.spaces.entry(target.sprite, focus.id);
        let localMismatch;
        if (!focused && cached && cached.revision === revision && cached.targetId === target.id) {
            localMismatch = cached.localMismatch;
        } else {
            const vmIds = focused ?
                [...focused.blockIds].filter(id => target.blocks._blocks[id]) :
                Object.keys(target.blocks._blocks);
            const wsIds = new Set(this.workspace.getAllBlocks(false).map(b => b.id));
            localMismatch = vmIds.length !== wsIds.size || vmIds.some(id => !wsIds.has(id));
            this._healthCache = {revision: focused ? null : revision, targetId: target.id, hash: null, localMismatch};
        }
        if (!localMismatch) {
            this._localMismatchStreak = 0;
        } else if (isUserTyping(this.ScratchBlocks)) {
        } else if (++this._localMismatchStreak >= LOCAL_MISMATCH_REPAIR_THRESHOLD) {
            this._localMismatchStreak = 0;
            log.warn(
                'Workspace/VM block mismatch detected for this target - repairing from VM data ' +
                '(see checkWorkspaceHealth in containers/blocks.jsx)'
            );
            vm.refreshWorkspace();
        }

        if (!window.dimodCollab || !window.dimodCollab.peerCount) return;
        window.dimodCollab.sendWorkspaceHealth({
            targetId: target.id,
            hash: this.workspaceHealthHash(target),
            hashes: allTargetHashes(vm),
            targetEditAt: this._localTargetEditAt || {},
            lastEditAt: getLastLocalEditAt()
        });
    }
    handleRemoteWorkspaceHealth (payload, fromUserId) {
        const vm = this.props.vm;
        if (!vm || !payload) return;
        if (!vm.__dimodProjectFullyLoaded || Date.now() < this._workspaceHealthArmAt) return;
        if (this._deferredRemoteBlockEvents.length) return;
        if (this.isProjectRunning()) return;
        const theirs = payload.hashes && typeof payload.hashes === 'object' ?
            payload.hashes :
            {[payload.targetId]: payload.hash};
        const peerKey = payload.fromTab || fromUserId;
        const streaks = this._peerWorkspaceHashes[peerKey] || (this._peerWorkspaceHashes[peerKey] = {});
        for (const targetId in theirs) {
            const target = vm.runtime.getTargetById(targetId);
            if (!target || !target.isOriginal || !target.blocks) {
                delete streaks[targetId];
                continue;
            }
            const theirHash = theirs[targetId];
            if (theirHash === targetBlocksHash(target)) {
                delete streaks[targetId];
                continue;
            }
            const prev = streaks[targetId];
            const mismatchStreak = ((prev && prev.hash === theirHash && prev.mismatchStreak) || 0) + 1;
            streaks[targetId] = {hash: theirHash, mismatchStreak};
            if (mismatchStreak < WORKSPACE_HEALTH_MISMATCH_THRESHOLD) continue;
            streaks[targetId] = {hash: theirHash, mismatchStreak: 0};
            if (!this.isStalerThan(payload, fromUserId, targetId)) continue;
            this.requestPeerBlocks(target, payload);
        }
    }
    isStalerThan (payload, fromUserId, targetId) {
        const mine = (this._localTargetEditAt && this._localTargetEditAt[targetId]) || 0;
        const theirs = Number(payload.targetEditAt && payload.targetEditAt[targetId]) || 0;
        if (mine !== theirs) return mine < theirs;
        const theirLastEdit = Number(payload.lastEditAt) || 0;
        const myLastEdit = getLastLocalEditAt();
        if (myLastEdit !== theirLastEdit) return myLastEdit < theirLastEdit;
        const myTab = window.dimodCollab ? window.dimodCollab.tabId : '';
        return `${getDimodUserId() || ''}|${myTab}` < `${fromUserId || ''}|${payload.fromTab || ''}`;
    }
    requestPeerBlocks (target, payload) {
        if (!window.dimodCollab || !payload.fromTab) {
            this.resyncFromSave(payload);
            return;
        }
        if (this._pendingBlockStates.has(target.id)) return;
        const timer = setTimeout(() => {
            this._pendingBlockStates.delete(target.id);
            log.warn(`No live copy of ${target.getName()} from ${payload.fromUsername || 'a peer'} - ` +
                'falling back to the last save');
            this.resyncFromSave(payload);
        }, BLOCK_STATE_REPLY_TIMEOUT_MS);
        this._pendingBlockStates.set(target.id, {timer});
        log.warn(`${target.getName()} is out of sync with ${payload.fromUsername || 'a peer'} - ` +
            'fetching their live copy');
        window.dimodCollab.send('blocks-state-request', {targetId: target.id, toTab: payload.fromTab});
    }
    handleBlockStateMessage (msg) {
        if (!msg || msg.type !== 'blocks-state' || !window.dimodCollab ||
            msg.toTab !== window.dimodCollab.tabId) return;
        const pending = this._pendingBlockStates.get(msg.targetId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this._pendingBlockStates.delete(msg.targetId);
        const vm = this.props.vm;
        const onScreen = vm.editingTarget && vm.editingTarget.id === msg.targetId;
        if (this.isProjectRunning() || (onScreen && (hasActiveGesture(this.workspace) ||
            isUserTyping(this.ScratchBlocks) || this._deferredRemoteBlockEvents.length))) return;
        const target = vm.runtime.getTargetById(msg.targetId);
        if (!applyTargetBlocks(vm, msg)) return;
        this._workspaceRevision = (this._workspaceRevision || 0) + 1;
        this._healthCache = null;
        if (onScreen) vm.refreshWorkspace();
        log.warn(`Resynced ${target ? target.getName() : msg.targetId} live from ` +
            `${msg.fromUsername || 'a collaborator'}`);
    }
    resyncFromSave (payload) {
        const mismatchStreak = WORKSPACE_HEALTH_MISMATCH_THRESHOLD;
        if (hasUnsavedLocalEdits()) {
            log.warn(
                `Out of sync with ${payload.fromUsername || 'a peer'}, but this tab has unsaved edits - ` +
                'not resyncing until they are saved (see hasUnsavedLocalEdits in lib/dimod-edit-clock.js)'
            );
            return;
        }
        if (Date.now() - (this._lastResyncAt || 0) < WORKSPACE_RESYNC_COOLDOWN_MS) {
            log.warn(
                `Still out of sync with ${payload.fromUsername || 'a peer'} after a recent resync - not ` +
                'reloading again (see WORKSPACE_RESYNC_COOLDOWN_MS in containers/blocks.jsx)'
            );
            return;
        }
        this._lastResyncAt = Date.now();
        log.warn(
            `Workspace out of sync with ${payload.fromUsername || 'a peer'} for ${mismatchStreak} consecutive ` +
            'checks - resyncing from the last save (see handleRemoteWorkspaceHealth in containers/blocks.jsx)'
        );
        this._peerWorkspaceHashes = {};
        this._workspaceHealthArmAt = Date.now() + WORKSPACE_HEALTH_WARMUP_MS;
        RestorePointAPI.createRestorePoint(
            this.props.vm,
            `${this.props.projectTitle || 'Project'} (before resync)`,
            RestorePointAPI.TYPE_MANUAL
        ).then(() => {
            window.dispatchEvent(new CustomEvent('dimod:collab-desync', {
                detail: {
                    reason: 'auto-resync',
                    text: 'Your workspace was out of sync, so it was reset to the last save.',
                    canRestore: true
                }
            }));
            window.dispatchEvent(new CustomEvent('dimod:system-message', {
                detail: {
                    text: 'Workspace out of sync with a collaborator... resyncing. ' +
                        'Your work up to now was saved as a restore point.'
                }
            }));
        }).catch(e => {
            log.warn('Could not save a restore point before resyncing', e);
            window.dispatchEvent(new CustomEvent('dimod:system-message', {
                detail: {
                    text: 'Workspace out of sync with a collaborator... resyncing from the last save. ' +
                        'Unsaved changes since then could not be backed up.'
                }
            }));
        }).then(() => {
            window.dispatchEvent(new CustomEvent('dimod:project-resync-needed'));
        });
    }
    getWorkspaceForCollabCursors () {
        return this.workspace;
    }
    detachVM () {
        window.removeEventListener('dimod:collab-ready', this.attachCollabListener);
        if (window.dimodCollab) {
            if (window.dimodCollab.onBlockEvent === this.handleRemoteBlockEvent) {
                window.dimodCollab.onBlockEvent = null;
            }
            if (window.dimodCollab.onExtensionImport === this.handleRemoteExtensionImport) {
                window.dimodCollab.onExtensionImport = null;
            }
            if (window.dimodCollab.onExtensionSync === this.handleExtensionSync) {
                window.dimodCollab.onExtensionSync = null;
            }
            if (window.dimodCollab.onExtensionRemove === this.handleRemoteExtensionRemove) {
                window.dimodCollab.onExtensionRemove = null;
            }
            if (window.dimodCollab.onWorkspaceHealth === this.handleRemoteWorkspaceHealth) {
                window.dimodCollab.onWorkspaceHealth = null;
            }
        }
        if (this._offBlockState) this._offBlockState();
        if (this._pendingBlockStates) {
            this._pendingBlockStates.forEach(pending => clearTimeout(pending.timer));
            this._pendingBlockStates.clear();
        }
        clearInterval(this._workspaceHealthInterval);
        clearTimeout(this._deferredRemoteFlushTimer);
        this._deferredRemoteFlushTimer = null;
        this._deferredRemoteBlockEvents = [];
        this.props.vm.removeListener('SCRIPT_GLOW_ON', this.onScriptGlowOn);
        this.props.vm.removeListener('SCRIPT_GLOW_OFF', this.onScriptGlowOff);
        this.props.vm.removeListener('BLOCK_GLOW_ON', this.onBlockGlowOn);
        this.props.vm.removeListener('BLOCK_GLOW_OFF', this.onBlockGlowOff);
        this.props.vm.removeListener('VISUAL_REPORT', this.onVisualReport);
        this.props.vm.removeListener('BLOCK_STACK_ERROR', this.onBlockStackError);
        this.props.vm.removeListener('workspaceUpdate', this.onWorkspaceUpdate);
        this.props.vm.runtime.removeListener('PROJECT_RUN_START', this._onProjectRunStart);
        this.props.vm.runtime.removeListener('PROJECT_RUN_STOP', this._onProjectRunStop);
        this.props.vm.removeListener('targetsUpdate', this.onTargetsUpdate);
        this.props.vm.removeListener('MONITORS_UPDATE', this.handleMonitorsUpdate);
        this.props.vm.removeListener('EXTENSION_ADDED', this.handleExtensionAdded);
        if (this._dropWorkspaceCache) {
            this.props.vm.removeListener('EXTENSION_ADDED', this._dropWorkspaceCache);
            this.props.vm.runtime.removeListener('PROJECT_LOADED', this._dropWorkspaceCache);
        }
        if (this._markWorkspaceDirty && this.workspace) this.workspace.removeChangeListener(this._markWorkspaceDirty);
        this.props.vm.removeListener('EXTENSION_REMOVED', this.handleExtensionRemoved);
        this.props.vm.removeListener('BLOCKSINFO_UPDATE', this.handleBlocksInfoUpdate);
        this.props.vm.removeListener('PERIPHERAL_CONNECTED', this.handleStatusButtonUpdate);
        this.props.vm.removeListener('PERIPHERAL_DISCONNECTED', this.handleStatusButtonUpdate);
        if (this._offCloudState) this._offCloudState();
        if (this.handleAnimationsChanged) {
            this.props.vm.runtime.off('DIMOD_ANIMATIONS_CHANGED', this.handleAnimationsChanged);
            this.props.vm.runtime.off('DIMOD_ASSETS', this.handleMediaNamesChanged);
            this.props.vm.runtime.off('DIMOD_SCENES', this.handleMediaNamesChanged);
            clearTimeout(this._animationsToolboxTimer);
        }
    }

    updateToolboxBlockValue (id, value) {
        this.withToolboxUpdates(() => {
            const block = this.workspace
                .getFlyout()
                .getWorkspace()
                .getBlockById(id);
            if (block) {
                block.inputList[0].fieldRow[0].setValue(value);
            }
        });
    }

    onTargetsUpdate () {
        if (this.props.vm.editingTarget && this.workspace.getFlyout()) {
            ['glide', 'move', 'set'].forEach(prefix => {
                this.updateToolboxBlockValue(`${prefix}x`, Math.round(this.props.vm.editingTarget.x).toString());
                this.updateToolboxBlockValue(`${prefix}y`, Math.round(this.props.vm.editingTarget.y).toString());
            });
        }
    }
    onWorkspaceMetricsChange () {
        const target = this.props.vm.editingTarget;
        if (target && target.id) {
            // Dispatch updateMetrics later, since onWorkspaceMetricsChange may be (very indirectly)
            // called from a reducer, i.e. when you create a custom procedure.
            // TODO: Is this a vehement hack?
            setTimeout(() => {
                this.props.updateMetrics({
                    targetID: target.id,
                    scrollX: this.workspace.scrollX,
                    scrollY: this.workspace.scrollY,
                    scale: this.workspace.scale
                });
            }, 0);
        }
    }
    onScriptGlowOn (data) {
        this.workspace.glowStack(data.id, true);
    }
    onScriptGlowOff (data) {
        this.workspace.glowStack(data.id, false);
    }
    onBlockGlowOn (data) {
        this.workspace.glowBlock(data.id, true);
    }
    onBlockGlowOff (data) {
        this.workspace.glowBlock(data.id, false);
    }
    onVisualReport (data) {
        this.workspace.reportValue(data.id, data.value, false);
    }
    onBlockStackError (data) {
        // blocks still exist in fullscreen for some reason
        if (this.props.isFullScreen) return;
        if (!this.props.vm.editingTarget) return;
        const targetBlock = this.workspace.getBlockById(data.id);
        if (!targetBlock) return; // this happens when we switch sprites
        this.workspace.glowBlock(data.id, false);
        this.workspace.reportValue(data.id, data.value, true);
        this.workspace.errorStack(data.id, true);
    }
    getToolboxXML () {
        // Use try/catch because this requires digging pretty deep into the VM
        // Code inside intentionally ignores several error situations (no stage, etc.)
        // Because they would get caught by this try/catch
        try {
            let {editingTarget: target, runtime} = this.props.vm;
            const stage = runtime.getTargetForStage();
            if (!target) target = stage; // If no editingTarget, use the stage

            const stageCostumes = stage.getCostumes();
            const targetCostumes = target.getCostumes();
            const targetSounds = target.getSounds();
            const dynamicBlocksXML = hideFromPalette(this.props.vm.runtime.getBlocksXML(target));
            return makeToolboxXML(false, target.isStage, target.id, dynamicBlocksXML,
                targetCostumes[targetCostumes.length - 1].name,
                stageCostumes[stageCostumes.length - 1].name,
                targetSounds.length > 0 ? targetSounds[targetSounds.length - 1].name : '',
                this.props.isLiveTest
            );
        } catch (error) {
            return null;
        }
    }
    handleExtensionRemoved () {
        const toolboxXML = this.getToolboxXML();
        if (toolboxXML) {
            this.props.updateToolboxState(toolboxXML);
        }
    }
    workspaceShows (targetId) {
        const target = targetId && this.props.vm.runtime.getTargetById(targetId);
        if (!target || !target.blocks || !this.workspace) return false;
        const vmBlocks = target.blocks._blocks;
        return this.workspace.getTopBlocks(false).every(block =>
            Object.prototype.hasOwnProperty.call(vmBlocks, block.id));
    }
    scheduleRenderHash () {
        clearTimeout(this._renderHashTimeout);
        this._renderHashTimeout = setTimeout(() => {
            const target = this.props.vm.editingTarget;
            if (!this._loaded || !target || target.id !== this._loaded.targetId) return;
            if (!this.workspaceShows(target.id)) return;
            this._renderHash = WorkspaceCache.targetHash(target);
        }, RENDER_HASH_DEBOUNCE_MS);
    }
    onWorkspaceUpdate (data) {
        abandonGesture(this.ScratchBlocks, this.workspace);
        if (!this.props.isVisible && !window.__dimodNoHiddenDefer) {
            this.deferWorkspaceWhileHidden();
            return;
        }
        this._workspaceDeferred = false;
        // When we change sprites, update the toolbox to have the new sprite's blocks
        const toolboxXML = this.getToolboxXML();
        if (toolboxXML) {
            this.props.updateToolboxState(toolboxXML);
        }

        if (this.props.vm.editingTarget && !this.props.workspaceMetrics.targets[this.props.vm.editingTarget.id]) {
            this.onWorkspaceMetricsChange();
        }

        // Remove and reattach the workspace listener (but allow flyout events)
        this.workspace.removeChangeListener(this.handleVmBlockEvent);
        this.workspace.removeChangeListener(this.handleCollabBroadcast);
        //
        //
        this._suppressCollabBroadcast = true;
        const dom = this.ScratchBlocks.Xml.textToDom(data.xml);
        const nextTargetId = this.props.vm.editingTarget ? this.props.vm.editingTarget.id : null;
        this._loadingTargetId = nextTargetId || '(none)';
        const toolboxRefreshWas = this.workspace.toolboxRefreshEnabled_;
        this.workspace.toolboxRefreshEnabled_ = false;
        let loadedVariables = false;
        try {
            const cache = window.__dimodNoWsCache ? null : this.workspaceCache;
            const leaving = this._loaded;
            const nextTarget = nextTargetId && this.props.vm.runtime.getTargetById(nextTargetId);
            const nextHash = cache && nextTarget ? WorkspaceCache.targetHash(nextTarget) : null;
            let reused = false;
            let attachedFromCache = false;
            if (cache && leaving && leaving.targetId === nextTargetId && leaving.signature === cache.signature() &&
                !this._renderedHidden &&
                ((!this._workspaceDirty && leaving.xml === data.xml) ||
                    (nextHash && this._renderHash === nextHash && this.workspaceShows(nextTargetId)))) {
                reused = true;
            } else if (cache && leaving && leaving.targetId !== nextTargetId && !this._renderedHidden &&
                this.props.vm.runtime.getTargetById(leaving.targetId) &&
                this.workspaceShows(leaving.targetId)) {
                const left = this.props.vm.runtime.getTargetById(leaving.targetId);
                cache.detach(this.workspace, leaving.targetId,
                    this._renderHash || WorkspaceCache.targetHash(left));
            }
            if (!reused && cache && nextTargetId && WorkspaceCache.cacheable(data.xml) &&
                cache.has(nextTargetId, nextHash)) {
                this.ScratchBlocks.Events.disable();
                try {
                    this.workspace.clear();
                } finally {
                    this.ScratchBlocks.Events.enable();
                }
                WorkspaceCache.clearVariables(this.workspace);
                cache.attach(this.workspace, nextTargetId, dom);
                attachedFromCache = true;
                loadedVariables = true;
                if (this.workspaceShows(nextTargetId)) {
                    reused = true;
                } else {
                    log.warn(
                        'Cached workspace for this sprite did not match its VM blocks - reloading it from ' +
                        'VM data (see onWorkspaceUpdate in containers/blocks.jsx)'
                    );
                    cache.evict(nextTargetId);
                }
            }
            if (!reused) {
                if (cache && nextTargetId) cache.evict(nextTargetId);
                this.workspace.setResizesEnabled(false);
                this.ScratchBlocks.Events.disable();
                try {
                    this.workspace.clear();
                } finally {
                    this.ScratchBlocks.Events.enable();
                }
                this.ScratchBlocks.Xml.domToWorkspace(dom, this.workspace);
                this.workspace.setResizesEnabled(true);
                loadedVariables = true;
            }
            if (attachedFromCache && reused) this._renderedHidden = false;
            else if (!reused) this._renderedHidden = !this.props.isVisible;
            this._loaded = {targetId: nextTargetId, xml: data.xml, signature: cache ? cache.signature() : null};
            this._workspaceDirty = false;
            clearTimeout(this._renderHashTimeout);
            this._renderHash = nextHash;
        } catch (error) {
            this._loaded = null;
            this._renderHash = null;
            if (this.workspaceCache) this.workspaceCache.clear();
            // The workspace is likely incomplete. What did update should be
            // functional.
            //
            // Instead of throwing the error, by logging it and continuing as
            // normal lets the other workspace update processes complete in the
            // gui and vm, which lets the vm run even if the workspace is
            // incomplete. Throwing the error would keep things like setting the
            // correct editing target from happening which can interfere with
            // some blocks and processes in the vm.
            log.error('Workspace Update Error:', error);
        }
        this._loadingTargetId = null;
        this.workspace.toolboxRefreshEnabled_ = toolboxRefreshWas;
        if (loadedVariables && toolboxRefreshWas && (!toolboxXML || toolboxXML === this._renderedToolboxXML)) {
            try {
                this.workspace.refreshToolboxSelection_();
            } catch (error) {
                log.error('Toolbox refresh failed after a workspace update:', error);
            }
        }
        this.workspace.addChangeListener(this.handleVmBlockEvent);
        this.workspace.addChangeListener(this.handleCollabBroadcast);
        setTimeout(() => {
            this._suppressCollabBroadcast = false;
        }, 0);

        if (this.props.vm.editingTarget && this.props.workspaceMetrics.targets[this.props.vm.editingTarget.id]) {
            const {scrollX, scrollY, scale} = this.props.workspaceMetrics.targets[this.props.vm.editingTarget.id];
            this.workspace.scrollX = scrollX;
            this.workspace.scrollY = scrollY;
            this.workspace.scale = scale;
            this.workspace.resize();
        }

        // Clear the undo state of the workspace since this is a
        // fresh workspace and we don't want any changes made to another sprites
        // workspace to be 'undone' here.
        this.workspace.clearUndo();
    }
    deferWorkspaceWhileHidden () {
        if (this._workspaceDeferred) return;
        const cache = window.__dimodNoWsCache ? null : this.workspaceCache;
        const leaving = this._loaded;
        this.workspace.removeChangeListener(this.handleVmBlockEvent);
        this.workspace.removeChangeListener(this.handleCollabBroadcast);
        try {
            const left = leaving && this.props.vm.runtime.getTargetById(leaving.targetId);
            if (cache && left && !this._renderedHidden && this.workspaceShows(leaving.targetId)) {
                cache.detach(this.workspace, leaving.targetId,
                    this._renderHash || WorkspaceCache.targetHash(left));
            }
            this.ScratchBlocks.Events.disable();
            try {
                this.workspace.clear();
            } finally {
                this.ScratchBlocks.Events.enable();
            }
            WorkspaceCache.clearVariables(this.workspace);
        } catch (error) {
            if (this.workspaceCache) this.workspaceCache.clear();
            log.error('Workspace park error:', error);
        } finally {
            this.workspace.addChangeListener(this.handleVmBlockEvent);
            this.workspace.addChangeListener(this.handleCollabBroadcast);
        }
        clearTimeout(this._renderHashTimeout);
        this._loaded = null;
        this._renderHash = null;
        this._workspaceDirty = false;
        this._renderedHidden = false;
        this._workspaceDeferred = true;
        this.workspace.clearUndo();
    }
    handleMonitorsUpdate (monitors) {
        // Update the checkboxes of the relevant monitors.
        const flyout = this.workspace.getFlyout();
        for (const monitor of monitors.values()) {
            const blockId = monitor.get('id');
            const isVisible = monitor.get('visible');
            flyout.setCheckboxState(blockId, isVisible);
            // We also need to update the isMonitored flag for this block on the VM, since it's used to determine
            // whether the checkbox is activated or not when the checkbox is re-displayed (e.g. local variables/blocks
            // when switching between sprites).
            const block = this.props.vm.runtime.monitorBlocks.getBlock(blockId);
            if (block) {
                block.isMonitored = isVisible;
            }
        }
    }
    handleExtensionAdded (categoryInfo) {
        const defineBlocks = blockInfoArray => {
            if (blockInfoArray && blockInfoArray.length > 0) {
                const staticBlocksJson = [];
                const dynamicBlocksInfo = [];
                blockInfoArray.forEach(blockInfo => {
                    if (blockInfo.info && blockInfo.info.isDynamic) {
                        dynamicBlocksInfo.push(blockInfo);
                    } else if (blockInfo.json) {
                        staticBlocksJson.push(blockInfo.json);
                    } else if (blockInfo.info.blockType === 'button') {
                        this.workspace.registerButtonCallback(blockInfo.info.opcode, blockInfo.info.func);
                    }
                    // otherwise it's a non-block entry such as '---'
                });

                this.ScratchBlocks.defineBlocksWithJsonArray(staticBlocksJson, true);
                dynamicBlocksInfo.forEach(blockInfo => {
                    // This is creating the block factory / constructor -- NOT a specific instance of the block.
                    // The factory should only know static info about the block: the category info and the opcode.
                    // Anything else will be picked up from the XML attached to the block instance.
                    const extendedOpcode = `${categoryInfo.id}_${blockInfo.info.opcode}`;
                    const blockDefinition =
                        defineDynamicBlock(this.ScratchBlocks, categoryInfo, blockInfo, extendedOpcode);
                    this.ScratchBlocks.Blocks[extendedOpcode] = blockDefinition;
                });
            }
        };

        // scratch-blocks implements a menu or custom field as a special kind of block ("shadow" block)
        // these actually define blocks and MUST run regardless of the UI state
        defineBlocks(
            Object.getOwnPropertyNames(categoryInfo.customFieldTypes)
                .map(fieldTypeName => categoryInfo.customFieldTypes[fieldTypeName].scratchBlocksDefinition));
        defineBlocks(categoryInfo.menus);
        defineBlocks(categoryInfo.blocks);

        // Update the toolbox with new blocks if possible
        const toolboxXML = this.getToolboxXML();
        if (toolboxXML) {
            this.props.updateToolboxState(toolboxXML);
        }
    }
    handleBlocksInfoUpdate (categoryInfo) {
        // @todo Later we should replace this to avoid all the warnings from redefining blocks.
        this.handleExtensionAdded(categoryInfo);
    }
    handleCategorySelected (categoryId) {
        const extension = extensionData.find(ext => ext.extensionId === categoryId);
        if (extension && extension.launchPeripheralConnectionFlow) {
            this.handleConnectionModalStart(categoryId);
        }

        this.withToolboxUpdates(() => {
            this.workspace.toolbox_.setSelectedCategoryById(categoryId);
        });
    }
    setBlocks (blocks) {
        this.blocks = blocks;
    }
    handlePromptStart (message, defaultValue, callback, optTitle, optVarType) {
        const p = {prompt: {callback, message, defaultValue}};
        p.prompt.title = optTitle ? optTitle :
            this.ScratchBlocks.Msg.VARIABLE_MODAL_TITLE;
        p.prompt.varType = typeof optVarType === 'string' ?
            optVarType : this.ScratchBlocks.SCALAR_VARIABLE_TYPE;
        p.prompt.showVariableOptions = // This flag means that we should show variable/list options about scope
            optVarType !== this.ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE &&
            p.prompt.title !== this.ScratchBlocks.Msg.RENAME_VARIABLE_MODAL_TITLE &&
            p.prompt.title !== this.ScratchBlocks.Msg.RENAME_LIST_MODAL_TITLE;
        p.prompt.showCloudOption = (optVarType === this.ScratchBlocks.SCALAR_VARIABLE_TYPE) && this.props.canUseCloud;
        this.setState(p);
    }

    /**
     * @param {{title:string, scrollable:boolean?}} config The config for the modal
     * @param {{content:CSSStyleDeclaration?, overlay:CSSStyleDeclaration?}?} styles Sets styles on parts of the modal. If specified, at least one of the parts should have styles.
     * @param {Array<{
     *      name:string,
     *      role:"ok"|"close"|null,
     *      class:"ok"|"cancel"|null,
     *      style:CSSStyleDeclaration?,
     *      dontClose:boolean?,
     *      callback:function():void
     * }>?} buttons Buttons to place onto the modal. `role` makes the button callback run for other types of interactions.
     * @param {() -> ()} handleCallback A callback that runs when the modal is created, with more internal handles passed into it.
     * @returns {Promise<HTMLElement>}
     */
    handleCustomPrompt (config, styles, buttons, handleCallback) {
        return new Promise((resolve, reject) => {
            /* validate arguments */
            if (config && isObject(config)) {
                if (!config.title) return reject("Custom Modal -- Missing 'title' (string) property in Param 1");
            } else {
                return reject("Custom Modal -- Param 1 must be an object with at least properties: 'title' (string)");
            }
            if (styles && !isObject(styles)) {
                return reject("Custom Modal -- Param 2 must be an object");
            }
            if (styles && (!styles.content && !styles.overlay)) {
                return reject("Custom Modal -- If Param 2 is specified, specify CSS styles within either: 'content' or 'overlay'");
            }

            // create the callback for when the node is created. an HTML element (or modal) with ref={functionHere} will run the function with the HTMLElement as 1st arg
            const thisPromptId = uid();
            const customPromptObject = {
                id: thisPromptId,
                config, styles, buttons
            };
            this.customModalRefs.set(thisPromptId, (node) => {
                resolve(node);

                // dont bother creating the util if handleCallback is undefined
                if (typeof handleCallback !== "function") return;
                const handle = this.handleCreateCustomPromptUtility(customPromptObject);
                handleCallback(handle);
            })

            // Setting state with this info will cause blocks.jsx to re-render, rendering the modal before any code after setState can run.
            // However, the callback & ref are not be usable until slightly later. this is why ref is set to a callback above.
            // This is one of many reasons why React is pretty stupid.
            this.setState({
                customPrompts: this.state.customPrompts.concat(customPromptObject)
            });
        });
    }
    handleCreateCustomPromptUtility (customPromptObject) {
        const handle = {};
        handle.customPromptObject = customPromptObject;
        handle.closePrompt = () => {
            return this.setState({
                customPrompts: this.state.customPrompts.filter(prompt => prompt !== customPromptObject)
            });
        };
        return handle;
    }
    handleConnectionModalStart (extensionId) {
        this.props.onOpenConnectionModal(extensionId);
    }
    handleStatusButtonUpdate () {
        this.ScratchBlocks.refreshStatusButtons(this.workspace);
    }
    handleOpenSoundRecorder () {
        this.props.onOpenSoundRecorder();
    }

    /*
     * Pass along information about proposed name and variable options (scope and isCloud)
     * and additional potentially conflicting variable names from the VM
     * to the variable validation prompt callback used in scratch-blocks.
     */
    handlePromptCallback (input, variableOptions) {
        this.state.prompt.callback(
            input,
            this.props.vm.runtime.getAllVarNamesOfType(this.state.prompt.varType),
            variableOptions);
        this.handlePromptClose();
    }
    handleCustomPromptButton(button, customPrompt) {
        button.callback();
        if (button.dontClose) return;
        this.setState({
            customPrompts: this.state.customPrompts.filter(prompt => prompt !== customPrompt)
        });
    }
    handleCustomPromptOk(customPrompt) {
        const okButton = (customPrompt.buttons || []).find(button => button.role === "ok");
        if (okButton) {
            okButton.callback();
            if (okButton.dontClose) return;
            return this.setState({
                customPrompts: this.state.customPrompts.filter(prompt => prompt !== customPrompt)
            });
        }
    }
    handlePromptClose (customPrompt) {
        if (customPrompt) {
            const closeButton = (customPrompt.buttons || []).find(button => button.role === "close");
            if (closeButton) {
                closeButton.callback();
            }
            return this.setState({
                customPrompts: this.state.customPrompts.filter(prompt => prompt !== customPrompt)
            });
        }

        this.setState({prompt: null});
    }
    handleCustomProceduresClose (data) {
        this.props.onRequestCloseCustomProcedures(data);
        const ws = this.workspace;
        ws.refreshToolboxSelection_();
        ws.toolbox_.scrollToCategoryById('myBlocks');
    }
    handleDrop (dragInfo) {
        fetch(dragInfo.payload.bodyUrl)
            .then(response => response.json())
            .then(blocks => shareBlocksToTargetWithSync(this.props.vm, blocks, this.props.vm.editingTarget.id))
            .then(() => {
                this.props.vm.refreshWorkspace();
                this.updateToolbox(); // To show new variables/custom blocks
            });
    }
    handleEnableProcedureReturns () {
        this.workspace.enableProcedureReturns();
        this.requestToolboxUpdate();
    }
    handleFieldBoxChange (args) {
        // update checkbox states with menu-dependent blocks
        if (args.element !== 'field') return;

        const flyout = this.workspace.getFlyout();
        if (!flyout) return;

        // check if monitoring
        const monitorState = this.props.vm.runtime.getMonitorState();
        const id = args.blockId;
        const value = String(args.newValue);
        const shouldCheck = (
            monitorState.get(`${id}_${value}`) !== undefined ||
            monitorState.get(`${id}_${value.toLowerCase()}`) !== undefined
        );

        const checkbox = flyout.checkboxes_[id];
        if (checkbox) {
            checkbox.clicked = shouldCheck;
            if (shouldCheck) {
                this.ScratchBlocks.utils.addClass(checkbox.svgRoot, 'checked');
            } else {
                this.ScratchBlocks.utils.removeClass(checkbox.svgRoot, 'checked');
            }
        }
    }
    render () {
        /* eslint-disable no-unused-vars */
        const {
            anyModalVisible,
            canUseCloud,
            customStageSize,
            customProceduresVisible,
            extensionLibraryVisible,
            options,
            stageSize,
            vm,
            isRtl,
            isVisible,
            onActivateColorPicker,
            onOpenConnectionModal,
            onOpenSoundRecorder,
            onOpenCustomExtensionModal,
            updateToolboxState,
            onActivateCustomProcedures,
            onRequestCloseExtensionLibrary,
            onRequestCloseCustomProcedures,
            toolboxXML,
            updateMetrics: updateMetricsProp,
            workspaceMetrics,
            ...props
        } = this.props;
        /* eslint-enable no-unused-vars */
        return (
            <React.Fragment>
                <DroppableBlocks
                    componentRef={this.setBlocks}
                    onDrop={this.handleDrop}
                    {...props}
                />
                <DimodCollabCursors
                    getWorkspace={this.getWorkspaceForCollabCursors}
                />
                {this.state.prompt ? (
                    <Prompt
                        defaultValue={this.state.prompt.defaultValue}
                        isStage={vm.runtime.getEditingTarget().isStage}
                        showListMessage={this.state.prompt.varType === this.ScratchBlocks.LIST_VARIABLE_TYPE}
                        label={this.state.prompt.message}
                        showCloudOption={this.state.prompt.showCloudOption}
                        showVariableOptions={this.state.prompt.showVariableOptions}
                        title={this.state.prompt.title}
                        vm={vm}
                        onCancel={this.handlePromptClose}
                        onOk={this.handlePromptCallback}
                    />
                ) : null}
                {this.state.customPrompts.map(prompt => (
                    <Prompt
                        isCustom={true}
                        vm={vm}
                        customRef={this.customModalRefs.get(prompt.id)}
                        onOk={() => this.handleCustomPromptOk(prompt)}
                        onCancel={() => this.handlePromptClose(prompt)}
                        config={prompt.config}
                        title={prompt.config.title}
                        styleContent={prompt.styles ? prompt.styles.content : null}
                        styleOverlay={prompt.styles ? prompt.styles.overlay : null}
                        customButtons={prompt.buttons}
                        onCustomButton={(button) => this.handleCustomPromptButton(button, prompt)}
                    />
                ))}
                {extensionLibraryVisible ? (
                    <ExtensionLibrary
                        vm={vm}
                        liveTest={this.props.isLiveTest}
                        onCategorySelected={this.handleCategorySelected}
                        onEnableProcedureReturns={this.handleEnableProcedureReturns}
                        onRequestClose={onRequestCloseExtensionLibrary}
                        onOpenCustomExtensionModal={this.props.onOpenCustomExtensionModal}
                    />
                ) : null}
                {customProceduresVisible ? (
                    <CustomProcedures
                        options={{
                            media: options.media
                        }}
                        onRequestClose={this.handleCustomProceduresClose}
                    />
                ) : null}
            </React.Fragment>
        );
    }
}

Blocks.propTypes = {
    intl: intlShape,
    anyModalVisible: PropTypes.bool,
    canUseCloud: PropTypes.bool,
    customStageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number
    }),
    customProceduresVisible: PropTypes.bool,
    extensionLibraryVisible: PropTypes.bool,
    isRtl: PropTypes.bool,
    isVisible: PropTypes.bool,
    locale: PropTypes.string.isRequired,
    messages: PropTypes.objectOf(PropTypes.string),
    onActivateColorPicker: PropTypes.func,
    onActivateCustomProcedures: PropTypes.func,
    onOpenConnectionModal: PropTypes.func,
    onOpenSoundRecorder: PropTypes.func,
    onOpenCustomExtensionModal: PropTypes.func,
    onRequestCloseCustomProcedures: PropTypes.func,
    onRequestCloseExtensionLibrary: PropTypes.func,
    options: PropTypes.shape({
        media: PropTypes.string,
        zoom: PropTypes.shape({
            controls: PropTypes.bool,
            wheel: PropTypes.bool,
            startScale: PropTypes.number
        }),
        colours: PropTypes.shape({
            workspace: PropTypes.string,
            flyout: PropTypes.string,
            toolbox: PropTypes.string,
            toolboxSelected: PropTypes.string,
            scrollbar: PropTypes.string,
            scrollbarHover: PropTypes.string,
            insertionMarker: PropTypes.string,
            insertionMarkerOpacity: PropTypes.number,
            fieldShadow: PropTypes.string,
            dragShadowOpacity: PropTypes.number
        }),
        comments: PropTypes.bool,
        collapse: PropTypes.bool
    }),
    projectTitle: PropTypes.string,
    stageSize: PropTypes.oneOf(Object.keys(STAGE_DISPLAY_SIZES)).isRequired,
    toolboxXML: PropTypes.string,
    updateMetrics: PropTypes.func,
    updateToolboxState: PropTypes.func,
    vm: PropTypes.instanceOf(VM).isRequired,
    workspaceMetrics: PropTypes.shape({
        targets: PropTypes.objectOf(PropTypes.object)
    }),
    isLiveTest: PropTypes.bool,
    isFullScreen: PropTypes.bool
};

Blocks.defaultOptions = {
    zoom: {
        controls: true,
        wheel: true,
        startScale: BLOCKS_DEFAULT_SCALE
    },
    grid: {
        spacing: 40,
        length: 2,
        colour: '#ddd'
    },
    colours: {
        workspace: '#F9F9F9',
        flyout: '#F9F9F9',
        toolbox: '#FFFFFF',
        toolboxSelected: '#E9EEF2',
        scrollbar: '#CECDCE',
        scrollbarHover: '#CECDCE',
        insertionMarker: '#000000',
        insertionMarkerOpacity: 0.2,
        fieldShadow: 'rgba(255, 255, 255, 0.3)',
        dragShadowOpacity: 0.6
    },
    comments: true,
    collapse: false,
    sounds: false
};

Blocks.defaultProps = {
    isVisible: true,
    options: Blocks.defaultOptions
};

const mapStateToProps = state => ({
    anyModalVisible: (
        Object.keys(state.scratchGui.modals).some(key => state.scratchGui.modals[key]) ||
        state.scratchGui.mode.isFullScreen
    ),
    customStageSize: state.scratchGui.customStageSize,
    extensionLibraryVisible: state.scratchGui.modals.extensionLibrary,
    isRtl: state.locales.isRtl,
    locale: state.locales.locale,
    messages: state.locales.messages,
    toolboxXML: state.scratchGui.toolbox.toolboxXML,
    customProceduresVisible: state.scratchGui.customProcedures.active,
    workspaceMetrics: state.scratchGui.workspaceMetrics,
    isLiveTest: state.scratchGui.vm.isLiveTest,
    isFullScreen: state.scratchGui.mode.isFullScreen,
    projectTitle: state.scratchGui.projectTitle
});

const mapDispatchToProps = dispatch => ({
    onActivateColorPicker: callback => dispatch(activateColorPicker(callback)),
    onActivateCustomProcedures: (data, callback) => dispatch(activateCustomProcedures(data, callback)),
    onOpenConnectionModal: id => {
        dispatch(setConnectionModalExtensionId(id));
        dispatch(openConnectionModal());
    },
    onOpenSoundRecorder: () => {
        dispatch(activateTab(SOUNDS_TAB_INDEX));
        dispatch(openSoundRecorder());
    },
    onOpenCustomExtensionModal: swapId => dispatch(openCustomExtensionModal(swapId)),
    onRequestCloseExtensionLibrary: () => {
        dispatch(closeExtensionLibrary());
    },
    onRequestCloseCustomProcedures: data => {
        dispatch(deactivateCustomProcedures(data));
    },
    updateToolboxState: toolboxXML => {
        dispatch(updateToolbox(toolboxXML));
    },
    updateMetrics: metrics => {
        dispatch(updateMetrics(metrics));
    }
});

export default injectIntl(errorBoundaryHOC('Blocks')(
    connect(
        mapStateToProps,
        mapDispatchToProps
    )(LoadScratchBlocksHOC(Blocks))
));

export {Blocks as BlocksContainer};
