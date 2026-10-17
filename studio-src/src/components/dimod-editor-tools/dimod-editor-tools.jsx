import PropTypes from 'prop-types';
import React, {useState, useRef, useCallback, useEffect, useMemo} from 'react';
import ReactDOM from 'react-dom';
import VM from 'scratch-vm';
import {Icon, icons} from '../block-space/block-space-panel.jsx';
import {
    findIssues,
    deleteVariable,
    deleteStack,
    makeBlockLabeler,
    revealBlock,
    switchToTarget,
    showVariables,
    usesItems,
    buildItems,
    createBlockSearch,
    rankItems,
    rememberItem,
    installDefaultExtensions,
    installWorkspaceTools,
    toggleFocusMode,
    setFocusMode,
    useFocusMode,
    useSpriteTabsHidden,
    toggleSpriteTabs,
    areSpriteTabsHidden
} from '../../lib/dimod-editor';
import {askConfirm} from '../../lib/dimod-ui';
import styles from './editor-tools.css';
import classNames from 'classnames';
import renderBlock, {getBlockHeight} from '../../addons/addons/middle-click-popup/BlockRenderer.js';
import codeIcon from '../gui/icon--code.svg';
import costumesIcon from '../gui/icon--costumes.svg';
import soundsIcon from '../gui/icon--sounds.svg';
import variablesIcon from '../gui/icon--variables.svg';
import actionIcon from './icon--action.svg';
import spriteIcon from './icon--sprite.svg';
import messageIcon from './icon--message.svg';
import {connect} from 'react-redux';
import getCostumeUrl from '../../lib/get-costume-url';
import Button from '../button/button.jsx';
import stageStyles from '../stage-header/stage-header.css';
import focusIcon from './icon--focus.svg';
import searchIcon from './icon--search.svg';
import cleanupIcon from './icon--cleanup.svg';
import tabsIcon from './icon--tabs.svg';
const GROUPS = [
    ['missing-definition', 'Custom blocks called but not defined'],
    ['unknown-block', 'Blocks from an extension that is not loaded'],
    ['unused-variable', 'Unused variables'],
    ['unused-list', 'Unused lists'],
    ['unused-custom-block', 'Custom blocks nothing calls'],
    ['loose-stack', 'Loose blocks that never run'],
    ['empty-script', 'Empty scripts'],
    ['broadcast-no-listener', 'Messages nothing receives'],
    ['broadcast-no-sender', 'Messages nothing sends']
];
const reachableFrom = (vm, targetId) => {
    const owner = vm.runtime.getTargetById(targetId);
    return owner && owner.isStage && vm.editingTarget ? vm.editingTarget.id : targetId;
};
const act = async (vm, issue) => {
    if (issue.fix === 'delete') return deleteVariable(vm, reachableFrom(vm, issue.targetId), issue.variableId);
    if (issue.fix === 'delete-block') return deleteStack(vm, issue.targetId, issue.blockId);
    return false;
};
const CleanupPanel = ({vm}) => {
    const [open, setOpen] = useState(false);
    const [issues, setIssues] = useState([]);
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');
    const timer = useRef(null);
    const scan = useCallback(() => { setIssues(findIssues(vm, makeBlockLabeler())); }, [vm]);
    useEffect(() => {
        const onOpen = () => { scan(); setQuery(''); setOpen(true); };
        window.addEventListener('dimod:cleanup', onOpen);
        return () => window.removeEventListener('dimod:cleanup', onOpen);
    }, [scan]);
    useEffect(() => {
        if (!open) return undefined;
        const onChange = () => { clearTimeout(timer.current); timer.current = setTimeout(scan, 800); };
        vm.on('PROJECT_CHANGED', onChange);
        const onKey = e => {
            if (e.key === 'Escape' && !e.defaultPrevented) {
                const target = e.target;
                const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
                    target.isContentEditable);
                if (!typing) setOpen(false);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            clearTimeout(timer.current);
            vm.removeListener('PROJECT_CHANGED', onChange);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, vm, scan]);
    const show = useCallback(async issue => {
        if (issue.blockId) { await revealBlock(vm, issue.targetId, issue.blockId); } else { switchToTarget(vm, reachableFrom(vm, issue.targetId)); showVariables(); }
    }, [vm]);
    const remove = useCallback(async issue => {
        setBusy(true);
        try { await act(vm, issue); } finally { setBusy(false); scan(); }
    }, [vm, scan]);
    const removeAll = useCallback(async (label, group) => {
        const ok = await askConfirm(
            `Delete all ${group.length} of these? ${label}\n\nYou can undo them one at a time from the Code tab.`,
            {title: 'Delete them all', ok: 'Delete', danger: true}
        );
        if (!ok) return;
        setBusy(true);
        try {
            for (const issue of group) { await act(vm, issue); }
        } finally { setBusy(false); scan(); }
    }, [vm, scan]);
    if (!open) return null;
    const words = query.trim().toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const matches = (issue, label) => {
        const text = `${issue.title} ${issue.detail} ${label}`.toLowerCase();
        return words.every(word => text.includes(word));
    };
    const grouped = GROUPS
        .map(([kind, label]) => ({kind, label, group: issues.filter(issue => issue.kind === kind && matches(issue, label))}))
        .filter(entry => entry.group.length);
    return ReactDOM.createPortal((
        <div aria-label="Broken things" className={styles.cleanupPanel} role="dialog">
            <div className={styles.cleanupHeader}>
                <input
                    aria-label="Filter"
                    autoComplete="off"
                    className={styles.paletteInput}
                    placeholder={`Broken things (${issues.length}), type to filter`}
                    spellCheck={false}
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => {
                        if (e.key !== 'Escape') return;
                        e.preventDefault();
                        if (query) setQuery('');
                        else setOpen(false);
                    }}
                />
                <button
                    className={styles.cleanupTextButton}
                    disabled={busy}
                    title="Scan the project again"
                    type="button"
                    onClick={scan}
                >
                    {'Scan again'}
                </button>
                <button
                    aria-label="Close"
                    className={styles.cleanupIconButton}
                    title="Close"
                    type="button"
                    onClick={() => setOpen(false)}
                >
                    <Icon src={icons.close} tint />
                </button>
            </div>
            <div className={styles.cleanupBody}>
                {grouped.length === 0 ? (
                    <div className={styles.cleanupEmpty}>
                        {issues.length ? 'Nothing matches that.' :
                            'Nothing looks broken. No unused variables, loose blocks or missing pieces.'}
                    </div>
                ) : (
                    <React.Fragment>
                        {grouped.map(({kind, label, group}) => (
                            <div key={kind}>
                                <div className={styles.cleanupGroupHead}>
                                    <span className={styles.cleanupGroupTitle}>{`${label} (${group.length})`}</span>
                                    {group[0].fix && group.length > 1 ? (
                                        <button
                                            className={styles.cleanupTextButton}
                                            disabled={busy}
                                            type="button"
                                            onClick={() => removeAll(label, group)}
                                        >
                                            {'Delete all'}
                                        </button>
                                    ) : null}
                                </div>
                                {group.map(issue => (
                                    <div className={styles.cleanupRow} key={issue.id} onClick={() => show(issue)}>
                                        <span className={issue.severity === 'warn' ? styles.cleanupWarn : styles.cleanupNote} />
                                        <div className={styles.cleanupRowText}>
                                            <div className={styles.cleanupRowTitle}>{issue.title}</div>
                                            <div className={styles.cleanupRowDetail}>{issue.detail}</div>
                                        </div>
                                        <div className={styles.cleanupRowButtons}>
                                            <button
                                                aria-label="Show it"
                                                className={styles.cleanupIconButton}
                                                title="Show it"
                                                type="button"
                                                onClick={e => { e.stopPropagation(); show(issue); }}
                                            >
                                                <Icon src={icons.search} tint />
                                            </button>
                                            {issue.fix ? (
                                                <button
                                                    aria-label="Delete it"
                                                    className={`${styles.cleanupIconButton} ${styles.cleanupIconButtonDanger}`}
                                                    disabled={busy}
                                                    title="Delete it"
                                                    type="button"
                                                    onClick={e => { e.stopPropagation(); remove(issue); }}
                                                >
                                                    <Icon src={icons.trash} tint />
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </React.Fragment>
                )}
            </div>
        </div>
    ), document.body);
};
CleanupPanel.propTypes = {vm: PropTypes.instanceOf(VM).isRequired};
const ICON_FOR_TYPE = {
    action: actionIcon,
    sprite: spriteIcon,
    block: codeIcon,
    blockspace: codeIcon,
    use: codeIcon,
    variable: variablesIcon,
    message: messageIcon,
    costume: costumesIcon,
    sound: soundsIcon,
    scene: spriteIcon,
    asset: costumesIcon
};
const PREVIEW_SCALE = 0.6;
const BlockPreview = ({block}) => {
    const group = useRef(null);
    const [width, setWidth] = useState(1);
    const height = getBlockHeight(block) * PREVIEW_SCALE;
    useEffect(() => {
        const g = group.current;
        if (!g) return;
        while (g.firstChild) g.removeChild(g.firstChild);
        try {
            const rendered = renderBlock(block, g);
            g.setAttribute('transform', `translate(4, ${height / 2}) scale(${PREVIEW_SCALE})`);
            setWidth((rendered.width * PREVIEW_SCALE) + 8);
        } catch (e) {
        }
    }, [block, height]);
    return (
        <svg height={height} width={width}>
            <g ref={group} />
        </svg>
    );
};
BlockPreview.propTypes = {block: PropTypes.shape({typeInfo: PropTypes.shape({})})};
const inMonaco = target => Boolean(target && target.closest && target.closest('.monaco-editor'));
const CommandPalette = ({vm}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [items, setItems] = useState([]);
    const [uses, setUses] = useState(null);
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState({x: 0, y: 0});
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const rootRef = useRef(null);
    const blockSearch = useRef(null);
    const pointer = useRef({x: 200, y: 120});
    const close = useCallback(() => {
        setOpen(false);
        if (blockSearch.current) blockSearch.current.dispose();
        blockSearch.current = null;
    }, []);
    const openUses = useCallback(({kind, subject, label}) => {
        setUses({label, items: usesItems(vm, kind, subject)});
        setQuery('');
        setActive(0);
    }, [vm]);
    const show = useCallback((detail = {}) => {
        setItems(buildItems(vm, {openUses, close}));
        if (blockSearch.current) blockSearch.current.dispose();
        blockSearch.current = createBlockSearch(vm);
        setPos({x: pointer.current.x + 16, y: pointer.current.y - 8});
        setUses(null);
        setQuery('');
        setActive(0);
        setOpen(true);
        if (detail.mode === 'uses') openUses(detail);
    }, [vm, openUses, close]);
    useEffect(() => {
        const onOpen = e => show(e.detail || {});
        const onKey = e => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return;
            if (inMonaco(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            if (open) close(); else show();
        };
        const onMove = e => { pointer.current = {x: e.clientX, y: e.clientY}; };
        window.addEventListener('dimod:palette', onOpen);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousemove', onMove);
        return () => {
            document.removeEventListener('mousemove', onMove);
            window.removeEventListener('dimod:palette', onOpen);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open, show, close]);
    useEffect(() => {
        if (open && inputRef.current) inputRef.current.focus();
    }, [open, uses]);
    useEffect(() => {
        if (!open) return undefined;
        const onDown = e => {
            if (rootRef.current && !rootRef.current.contains(e.target)) close();
        };
        document.addEventListener('mousedown', onDown, true);
        return () => document.removeEventListener('mousedown', onDown, true);
    }, [open, close]);
    useEffect(() => {
        const el = rootRef.current;
        if (!open || !el) return;
        const x = Math.max(8, Math.min(pos.x, window.innerWidth - el.offsetWidth - 8));
        const y = Math.max(8, Math.min(pos.y, window.innerHeight - el.offsetHeight - 8));
        if (x !== pos.x || y !== pos.y) setPos({x, y});
    }, [open, pos, uses, query]);
    const results = useMemo(() => {
        if (!open) return [];
        if (uses) return query.trim() ? rankItems(uses.items, query, 200) : uses.items;
        const ranked = rankItems(items, query);
        const text = query.trim();
        if (!text || text.startsWith('>') || !blockSearch.current) return ranked;
        return [...ranked.slice(0, 4), ...blockSearch.current.query(text), ...ranked.slice(4)];
    }, [open, uses, items, query]);
    useEffect(() => {
        if (active >= results.length) setActive(Math.max(0, results.length - 1));
    }, [results, active]);
    useEffect(() => {
        const row = listRef.current && listRef.current.children[active];
        if (row && row.scrollIntoView) row.scrollIntoView({block: 'nearest'});
    }, [active, results]);
    const choose = useCallback(item => {
        if (!item) return;
        rememberItem(item.id);
        item.run();
        if (!item.opensUses) close();
    }, [close]);
    const onInputKey = e => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(i => Math.min(results.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = results[active];
            if (item && e.shiftKey && item.uses) { item.uses(); } else { choose(item); }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (uses) { setUses(null); setQuery(''); } else { close(); }
        } else if (e.key === 'Backspace' && uses && !query) { setUses(null); }
    };
    if (!open) return null;
    return ReactDOM.createPortal((
        <div
            aria-label="Search everything"
            className={styles.palette}
            ref={rootRef}
            role="dialog"
            style={{left: pos.x, top: pos.y}}
        >
            {uses ? (
                <div className={styles.paletteHeader}>
                    <button className={styles.paletteBack} type="button" onClick={() => { setUses(null); setQuery(''); }}>
                        <Icon src={icons.back} tint />
                        {'Back'}
                    </button>
                    <span>{`Uses of "${uses.label}"`}</span>
                </div>
            ) : null}
            <input
                aria-controls="dimod-palette-list"
                aria-label="Search"
                autoComplete="off"
                className={styles.paletteInput}
                placeholder={uses ? 'Narrow these down' : 'Search the project, > actions, @ sprites and files, $ variables'}
                ref={inputRef}
                spellCheck={false}
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onInputKey}
            />
            {results.length ? (
                <ul className={styles.paletteList} id="dimod-palette-list" ref={listRef} role="listbox">
                    {results.map((item, i) => (
                        <li
                            aria-selected={i === active}
                            className={classNames(styles.paletteRow, {
                                [styles.paletteRowActive]: i === active,
                                [styles.paletteRowBlock]: Boolean(item.block)
                            })}
                            key={item.id}
                            role="option"
                            onClick={() => choose(item)}
                            onMouseMove={() => i !== active && setActive(i)}
                        >
                            {item.block ? <BlockPreview block={item.block} /> : (
                                <React.Fragment>
                                    <img
                                        alt=""
                                        className={styles.paletteRowIcon}
                                        draggable={false}
                                        src={ICON_FOR_TYPE[item.type] || codeIcon}
                                    />
                                    <span className={styles.paletteRowLabel}>{item.label}</span>
                                    {item.recent ? <span className={styles.paletteRowSub}>{'Recent'}</span> : item.sub ?
                                        <span className={styles.paletteRowSub}>{item.sub}</span> : null}
                                    {item.hint ? <kbd className={styles.paletteRowHint}>{item.hint}</kbd> : null}
                                </React.Fragment>
                            )}
                        </li>
                    ))}
                </ul>
            ) : query.trim() || uses ? (
                <div className={styles.paletteEmpty}>
                    {uses ? 'Nothing uses this yet.' : 'Nothing matches that.'}
                </div>
            ) : null}
        </div>
    ), document.body);
};
CommandPalette.propTypes = {vm: PropTypes.instanceOf(VM).isRequired};
const DimodEditorTools = ({vm}) => {
    useEffect(() => { const stop = installDefaultExtensions(vm); installWorkspaceTools(vm); return stop; }, [vm]);
    useEffect(() => {
        const onKey = e => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocusMode(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => { document.removeEventListener('keydown', onKey, true); setFocusMode(false); };
    }, []);
    return (
        <React.Fragment>
            <CommandPalette vm={vm} />
            <CleanupPanel vm={vm} />
        </React.Fragment>
    );
};
DimodEditorTools.propTypes = {vm: PropTypes.instanceOf(VM).isRequired};
const ToolButton = ({title, icon, active, compact, onClick}) => (
    <Button
        aria-label={title}
        aria-pressed={typeof active === 'boolean' ? active : undefined}
        className={classNames(stageStyles.stageButton, {[styles.toolButtonActive]: active, [styles.compactButton]: compact})}
        title={title}
        onClick={onClick}
    >
        <img alt="" className={stageStyles.stageButtonIcon} draggable={false} src={icon} />
    </Button>
);
ToolButton.propTypes = {
    active: PropTypes.bool,
    compact: PropTypes.bool,
    icon: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired,
    title: PropTypes.string.isRequired
};
const FocusButton = ({compact}) => {
    const focused = useFocusMode();
    return (
        <ToolButton
            active={focused}
            compact={compact}
            icon={focusIcon}
            title={focused ? 'Focus mode: on. Click to bring the stage back' :
                'Focus mode: hide the stage and sprites'}
            onClick={toggleFocusMode}
        />
    );
};
const openPalette = () => window.dispatchEvent(new CustomEvent('dimod:palette', {detail: {}}));
const openCleanup = () => window.dispatchEvent(new Event('dimod:cleanup'));
const SearchButton = ({compact}) => (
    <ToolButton compact={compact} icon={searchIcon} title="Search everything (Ctrl+K)" onClick={openPalette} />
);
const CleanupButton = ({compact}) => (
    <ToolButton compact={compact} icon={cleanupIcon} title="Find broken things" onClick={openCleanup} />
);
const SpriteTabsButton = ({compact}) => {
    const hidden = useSpriteTabsHidden();
    return (
        <ToolButton
            active={!hidden}
            compact={compact}
            icon={tabsIcon}
            title={hidden ? 'Sprite tabs: hidden. Click to show them above the editor' :
                'Sprite tabs: shown. Click to hide them'}
            onClick={toggleSpriteTabs}
        />
    );
};
FocusButton.propTypes = {compact: PropTypes.bool};
SpriteTabsButton.propTypes = {compact: PropTypes.bool};
SearchButton.propTypes = {compact: PropTypes.bool};
CleanupButton.propTypes = {compact: PropTypes.bool};
const MAX_TABS = 12;
const thumbnails = new Map();
const thumbnailOf = costume => {
    if (!costume || !costume.asset) return null;
    const key = costume.asset.assetId;
    if (!thumbnails.has(key)) {
        try { thumbnails.set(key, getCostumeUrl(costume.asset)); } catch (e) { return null; }
        if (thumbnails.size > 200) thumbnails.delete(thumbnails.keys().next().value);
    }
    return thumbnails.get(key);
};
class SpriteTabs extends React.Component {
    constructor (props) {
        super(props);
        this.state = {open: props.editingTarget ? [props.editingTarget] : [], hidden: areSpriteTabsHidden()};
        this.handleClose = this.handleClose.bind(this);
        this.handleHiddenChange = this.handleHiddenChange.bind(this);
        this.handleSelect = this.handleSelect.bind(this);
        this.handleAuxClick = this.handleAuxClick.bind(this);
    }
    componentDidMount () {
        window.addEventListener('dimod:sprite-tabs-hidden', this.handleHiddenChange);
        this.handleScenes = () => this.forceUpdate();
        this.props.vm.runtime.on('DIMOD_SCENES', this.handleScenes);
    }
    inScene (id) {
        const host = this.props.vm.dimodScenes;
        const target = host && this.props.vm.runtime.getTargetById(id);
        return !host || !target || host.inScene(target);
    }
    componentDidUpdate () {
        const {editingTarget} = this.props;
        const exists = id => Boolean(id) && this.inScene(id) &&
            (this.props.stage.id === id || Boolean(this.props.sprites[id]));
        let open = this.state.open.filter(exists);
        if (exists(editingTarget) && !open.includes(editingTarget)) {
            open = open.concat(editingTarget);
            while (open.length > MAX_TABS) { const drop = open.findIndex(id => id !== editingTarget); open.splice(drop, 1); }
        }
        const changed = open.length !== this.state.open.length || open.some((id, i) => id !== this.state.open[i]);
        if (changed) this.setState({open});
    }
    componentWillUnmount () {
        window.removeEventListener('dimod:sprite-tabs-hidden', this.handleHiddenChange);
        this.props.vm.runtime.removeListener('DIMOD_SCENES', this.handleScenes);
    }
    handleHiddenChange () { this.setState({hidden: areSpriteTabsHidden()}); }
    nameOf (id) {
        const {stage, sprites} = this.props;
        if (stage.id === id) return 'Stage';
        return sprites[id] ? sprites[id].name : '';
    }
    costumeOf (id) {
        const {stage, sprites} = this.props;
        const target = stage.id === id ? stage : sprites[id];
        return target ? target.costume : null;
    }
    handleSelect (e) {
        const id = e.currentTarget.dataset.targetId;
        if (id !== this.props.editingTarget) this.props.vm.setEditingTarget(id);
    }
    close (id) {
        if (this.state.open.length < 2) return;
        const index = this.state.open.indexOf(id);
        const open = this.state.open.filter(other => other !== id);
        this.setState({open});
        if (id === this.props.editingTarget) { this.props.vm.setEditingTarget(open[Math.min(index, open.length - 1)]); }
    }
    handleClose (e) { e.stopPropagation(); this.close(e.currentTarget.dataset.targetId); }
    handleAuxClick (e) {
        if (e.button !== 1) return;
        e.preventDefault();
        this.close(e.currentTarget.dataset.targetId);
    }
    render () {
        const {editingTarget} = this.props;
        const multiple = this.state.open.length > 1;
        const showRow = multiple && !this.state.hidden;
        return (
            <div className={classNames(styles.tabStrip, {[styles.tabStripSingle]: !showRow})} role="tablist">
                <div className={styles.tabScroller}>
                    {!showRow ? null : this.state.open.map(id => {
                        const active = id === editingTarget;
                        const thumb = thumbnailOf(this.costumeOf(id));
                        return (
                            <div
                                aria-selected={active}
                                className={classNames(styles.spriteTab, {[styles.spriteTabActive]: active})}
                                data-target-id={id}
                                key={id}
                                role="tab"
                                tabIndex={0}
                                title={this.nameOf(id)}
                                onAuxClick={this.handleAuxClick}
                                onClick={this.handleSelect}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') this.handleSelect(e);
                                }}
                            >
                                {thumb ? (
                                    <img alt="" className={styles.spriteTabThumb} draggable={false} src={thumb} />
                                ) : <span className={styles.spriteTabThumb} />}
                                <span className={styles.spriteTabName}>{this.nameOf(id)}</span>
                                {multiple ? (
                                    <button
                                        aria-label={`Close ${this.nameOf(id)}`}
                                        className={styles.spriteTabClose}
                                        data-target-id={id}
                                        title={`Close ${this.nameOf(id)}`}
                                        type="button"
                                        onClick={this.handleClose}
                                    >
                                        <Icon src={icons.close} tint />
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
                <div className={styles.tabStripButtons}>
                    <SpriteTabsButton compact />
                    <SearchButton compact />
                    <CleanupButton compact />
                    <FocusButton compact />
                </div>
            </div>
        );
    }
}
SpriteTabs.propTypes = {
    editingTarget: PropTypes.string,
    sprites: PropTypes.objectOf(PropTypes.shape({name: PropTypes.string})),
    stage: PropTypes.shape({id: PropTypes.string}),
    vm: PropTypes.instanceOf(VM).isRequired
};
const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget,
    sprites: state.scratchGui.targets.sprites,
    stage: state.scratchGui.targets.stage
});
const spriteTabs = connect(mapStateToProps)(SpriteTabs);
export {CleanupButton, CleanupPanel, CommandPalette, DimodEditorTools, FocusButton, SearchButton, spriteTabs as SpriteTabs, SpriteTabsButton};
