import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {defineMessages, intlShape, injectIntl} from 'react-intl';
import {Panels, setPanel} from '../../reducers/dimod';
import {performGoto} from '../../helper/undo';
import {undoGoto} from '../../reducers/undo';
import {setSelectedItems, clearSelectedItems} from '../../reducers/selected-items';
import {getSelectedLeafItems, getSelectedRootItems, setItemSelection, clearSelection} from '../../helper/selection';
import {isBitmap} from '../../lib/format';
import {TOOL_NAMES} from '../dimod-context-bar/dimod-context-bar.jsx';
import styles from './dimod-side-panel.css';
import paper from '@turbowarp/paper';
import Modes from '../../lib/modes';
import {changeMode} from '../../reducers/modes';
import {getRootItem} from '../../helper/item';
import {hoverItem, hoverBounds} from '../../helper/guides';
import {getPaintingLayer} from '../../dimod/store';
import {getDid, setHistoryLabel, runCommand, loadSettings, saveSettings} from '../../dimod/core';
import {getSymbolSource, placeSymbol, refreshSymbol, symbolStale, detachSymbol} from '../../dimod/items';
import {DimodDialog} from '../dimod-widgets.jsx';
import {subscribeRemoteApplied} from '../../dimod/collab';
const messages$2 = defineMessages({
    opened: {defaultMessage: 'Opened', description: 'History: the costume as it was opened', id: 'paint.history.opened'},
    edit: {defaultMessage: 'Edit', description: 'History: a change with no better name', id: 'paint.history.edit'},
    empty: {
        defaultMessage: 'Changes you make appear here. Click one to go back to it.',
        description: 'History panel, before anything has been changed',
        id: 'paint.history.empty'
    },
    justNow: {defaultMessage: 'just now', description: 'History: time', id: 'paint.history.justNow'},
    undone: {
        defaultMessage: 'Undone... drawing now discards these',
        description: 'Tooltip on history steps after the current one',
        id: 'paint.history.undone'
    }
});
const COMMAND_NAMES = defineMessages({
    paste: {defaultMessage: 'Paste', description: 'History step', id: 'paint.history.cmd.paste'},
    cut: {defaultMessage: 'Cut', description: 'History step', id: 'paint.history.cmd.cut'},
    duplicate: {defaultMessage: 'Duplicate', description: 'History step', id: 'paint.history.cmd.duplicate'},
    delete: {defaultMessage: 'Delete', description: 'History step', id: 'paint.history.cmd.delete'},
    flipHorizontal: {defaultMessage: 'Flip Horizontal', description: 'History step', id: 'paint.history.cmd.flipH'},
    flipVertical: {defaultMessage: 'Flip Vertical', description: 'History step', id: 'paint.history.cmd.flipV'},
    rotate: {defaultMessage: 'Rotate', description: 'History step', id: 'paint.history.cmd.rotate'},
    center: {defaultMessage: 'Center', description: 'History step', id: 'paint.history.cmd.center'},
    group: {defaultMessage: 'Group', description: 'History step', id: 'paint.history.cmd.group'},
    ungroup: {defaultMessage: 'Ungroup', description: 'History step', id: 'paint.history.cmd.ungroup'},
    bringToFront: {defaultMessage: 'Bring to Front', description: 'History step', id: 'paint.history.cmd.front'},
    bringForward: {defaultMessage: 'Bring Forward', description: 'History step', id: 'paint.history.cmd.forward'},
    sendBackward: {defaultMessage: 'Send Backward', description: 'History step', id: 'paint.history.cmd.backward'},
    sendToBack: {defaultMessage: 'Send to Back', description: 'History step', id: 'paint.history.cmd.back'},
    merge: {defaultMessage: 'Merge', description: 'History step', id: 'paint.history.cmd.merge'},
    subtract: {defaultMessage: 'Subtract', description: 'History step', id: 'paint.history.cmd.subtract'},
    mask: {defaultMessage: 'Mask', description: 'History step', id: 'paint.history.cmd.mask'},
    filter: {defaultMessage: 'Filter', description: 'History step', id: 'paint.history.cmd.filter'},
    align: {defaultMessage: 'Align', description: 'History step', id: 'paint.history.cmd.align'},
    rename: {defaultMessage: 'Rename', description: 'History step', id: 'paint.history.cmd.rename'},
    hide: {defaultMessage: 'Show / Hide', description: 'History step', id: 'paint.history.cmd.hide'},
    opacity: {defaultMessage: 'Opacity', description: 'History step', id: 'paint.history.cmd.opacity'},
    blend: {defaultMessage: 'Blend Mode', description: 'History step', id: 'paint.history.cmd.blend'},
    lock: {defaultMessage: 'Lock / Unlock', description: 'History step', id: 'paint.history.cmd.lock'},
    reorder: {defaultMessage: 'Reorder', description: 'History step', id: 'paint.history.cmd.reorder'},
    effect: {defaultMessage: 'Effect', description: 'History step', id: 'paint.history.cmd.effect'},
    gradient: {defaultMessage: 'Gradient', description: 'History step', id: 'paint.history.cmd.gradient'}
});
const ago = (time, now, f) => {
    if (!time) return '';
    const seconds = Math.round((now - time) / 1000);
    if (seconds < 10) return f(messages$2.justNow);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
};
class HistoryPanel extends React.Component {
    constructor (props) { super(props); bindAll(this, ['handleClick', 'setListRef', 'setCurrentRef']); }
    componentDidMount () { this.scrollToCurrent(); this.timer = setInterval(() => this.forceUpdate(), 30000); }
    componentDidUpdate (prevProps) {
        if (prevProps.undoState.pointer !== this.props.undoState.pointer ||
            prevProps.undoState.stack.length !== this.props.undoState.stack.length) { this.scrollToCurrent(); }
    }
    componentWillUnmount () { clearInterval(this.timer); }
    scrollToCurrent () {
        if (this.current && this.list) {
            const item = this.current;
            const list = this.list;
            if (item.offsetTop < list.scrollTop ||
                item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
                list.scrollTop = item.offsetTop - (list.clientHeight / 2);
            }
        }
    }
    handleClick (event) {
        const index = Number(event.currentTarget.dataset.index);
        performGoto(
            this.props.undoState,
            index,
            this.props.onGoto,
            () => this.props.setSelectedItems(this.props.format),
            this.props.onUpdateImage
        );
    }
    label (entry, index) {
        const f = this.props.intl.formatMessage;
        if (index === 0) return f(messages$2.opened);
        const label = entry.label;
        if (label && label.kind === 'command' && COMMAND_NAMES[label.value]) return f(COMMAND_NAMES[label.value]);
        if (label && label.kind === 'mode' && TOOL_NAMES[label.value]) return f(TOOL_NAMES[label.value]);
        return f(messages$2.edit);
    }
    setListRef (el) { this.list = el; }
    setCurrentRef (el) { this.current = el; }
    render () {
        const f = this.props.intl.formatMessage;
        const {stack, pointer} = this.props.undoState;
        const now = Date.now();
        if (stack.length <= 1) { return <div className={styles.empty}>{f(messages$2.empty)}</div>; }
        return (
            <div className={styles.list} ref={this.setListRef}>
                {stack.map((entry, index) => (
                    <button
                        className={classNames(styles.historyRow, {
                            [styles.historyCurrent]: index === pointer,
                            [styles.historyUndone]: index > pointer
                        })}
                        data-index={index}
                        key={index}
                        ref={index === pointer ? this.setCurrentRef : null}
                        title={index > pointer ? f(messages$2.undone) : null}
                        onClick={this.handleClick}
                    >
                        <span className={styles.historyDot} />
                        <span className={styles.historyLabel}>{this.label(entry, index)}</span>
                        <span className={styles.historyTime}>{ago(entry.time, now, f)}</span>
                    </button>
                ))}
            </div>
        );
    }
}
HistoryPanel.propTypes = {
    format: PropTypes.string,
    intl: intlShape.isRequired,
    onGoto: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired,
    undoState: PropTypes.shape({pointer: PropTypes.number, stack: PropTypes.array}).isRequired
};
const mapStateToProps$2 = state => ({format: state.scratchPaint.format, undoState: state.scratchPaint.undo});
const mapDispatchToProps$2 = dispatch => ({
    onGoto: (index, format) => dispatch(undoGoto(index, format)),
    setSelectedItems: format => dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format)))
});
const HistoryPanel$1 = connect(mapStateToProps$2, mapDispatchToProps$2)(injectIntl(HistoryPanel));
const messages$1 = defineMessages({
    group: {defaultMessage: 'Group', description: 'Layers: default name of a group', id: 'paint.layers.group'},
    compound: {
        defaultMessage: 'Compound path',
        description: 'Layers: default name of a compound path',
        id: 'paint.layers.compound'
    },
    path: {defaultMessage: 'Path', description: 'Layers: default name of a closed path', id: 'paint.layers.path'},
    line: {defaultMessage: 'Line', description: 'Layers: default name of an open path', id: 'paint.layers.line'},
    text: {defaultMessage: 'Text', description: 'Layers: default name of text', id: 'paint.layers.text'},
    image: {defaultMessage: 'Image', description: 'Layers: default name of an image', id: 'paint.layers.image'},
    shape: {defaultMessage: 'Shape', description: 'Layers: default name of a shape', id: 'paint.layers.shape'},
    hide: {defaultMessage: 'Hide', description: 'Layers: hide button', id: 'paint.layers.hide'},
    show: {defaultMessage: 'Show', description: 'Layers: show button', id: 'paint.layers.show'},
    lock: {defaultMessage: 'Lock', description: 'Layers: lock button', id: 'paint.layers.lock'},
    unlock: {defaultMessage: 'Unlock', description: 'Layers: unlock button', id: 'paint.layers.unlock'},
    rename: {
        defaultMessage: 'Double-click to rename. Drag to reorder.',
        description: 'Layers: tooltip on a layer name',
        id: 'paint.layers.renameHint'
    },
    empty: {
        defaultMessage: 'Nothing drawn yet... highest shape = top part.',
        description: 'Layers panel with an empty costume',
        id: 'paint.layers.empty'
    },
    bitmap: {
        defaultMessage: 'Bitmap costumes are a single image, so they have no layers. Convert to vector to use them.',
        description: 'Layers panel in bitmap mode',
        id: 'paint.layers.bitmap'
    },
    groupSelected: {defaultMessage: 'Group', description: 'Layers footer', id: 'paint.layers.groupSel'},
    ungroupSelected: {defaultMessage: 'Ungroup', description: 'Layers footer', id: 'paint.layers.ungroupSel'},
    deleteSelected: {defaultMessage: 'Delete', description: 'Layers footer', id: 'paint.layers.deleteSel'},
    cluster: {
        defaultMessage: '{count} similar shapes',
        description: 'Layers: a run of neighbouring shapes in about the same colour, shown as one row',
        id: 'paint.layers.cluster'
    },
    clusterTolerance: {
        defaultMessage: 'Group similar colours',
        description: 'Layers: slider for how alike neighbouring shapes must be to share a row',
        id: 'paint.layers.clusterTolerance'
    },
    clusterMin: {
        defaultMessage: 'Min. shapes',
        description: 'Layers: how many similar shapes in a row it takes to group them',
        id: 'paint.layers.clusterMin'
    },
    clusterOff: {
        defaultMessage: 'Off',
        description: 'Layers: similar-colour grouping switched off',
        id: 'paint.layers.clusterOff'
    }
});
const visibleChildren = item => (item.children || [])
    .filter(child => !child.guide && !(child.data && child.data.isHelperItem) && !child.isClipMask())
    .slice()
    .reverse();
const kindOf = item => {
    if (item instanceof paper.Group) return 'group';
    if (item instanceof paper.CompoundPath) return 'compound';
    if (item instanceof paper.PointText) return 'text';
    if (item instanceof paper.Raster) return 'image';
    if (item instanceof paper.Shape) return 'shape';
    if (item instanceof paper.Path) return item.closed ? 'path' : 'line';
    return 'shape';
};
const Icon = ({kind}) => {
    const common = {width: 14, height: 14, viewBox: '0 0 14 14', className: styles.layerIcon};
    switch (kind) {
    case 'group':
        return (<svg {...common}><path
            d="M1.5 3.5a1 1 0 0 1 1-1h3l1.2 1.4h4.8a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"
            fill="currentColor"
            opacity=".85"
        /></svg>);
    case 'compound':
        return (<svg {...common}><path
            d="M7 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
            fill="currentColor"
            fillRule="evenodd"
        /></svg>);
    case 'text':
        return (<svg {...common}><path
            d="M2.5 2.5h9v2h-1.2l-.3-.8H7.8v7.1h1.2V12H5v-1.2h1.2V3.7H4l-.3.8H2.5z"
            fill="currentColor"
        /></svg>);
    case 'image':
        return (<svg {...common}><rect
            height="9"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="none"
            width="11"
            x="1.5"
            y="2.5"
        /><path d="M3 10l3-3.2 2 2 1.4-1.3L11 10z" fill="currentColor" /></svg>);
    case 'line':
        return (<svg {...common}><path
            d="M2.5 11.5C5 4 8 10 11.5 2.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.6"
        /></svg>);
    default:
        return (<svg {...common}><path d="M3 4.5L7 2l4.5 3-1.2 6H3.8z" fill="currentColor" opacity=".85" /></svg>);
    }
};
Icon.propTypes = {kind: PropTypes.string.isRequired};
const swatchOf = item => {
    const color = item.fillColor || item.strokeColor;
    if (!color || color.alpha === 0) return null;
    if (color.gradient) { return `linear-gradient(90deg, ${color.gradient.stops.map(stop => stop.color.toCSS()).join(', ')})`; }
    return color.toCSS();
};
const LOCKED_SHACKLE = 'M3.8 5.5V4a2.2 2.2 0 0 1 4.4 0v1.5';
const OPEN_SHACKLE = 'M3.8 5.5V4a2.2 2.2 0 0 1 4.3-.6';
const keyOf = item => getDid(item) || `p${item.id}`;
const CLUSTER_MIN = 3;
const CLUSTER_TOLERANCE = 12;
const solidColorOf = item => {
    if (!(item instanceof paper.Path || item instanceof paper.CompoundPath || item instanceof paper.Shape)) { return null; }
    if (item.data && item.data.layerName) return null;
    const color = item.fillColor && item.fillColor.alpha > 0 ? item.fillColor : item.strokeColor;
    if (!color || color.gradient || color.alpha === 0) return null;
    return color;
};
const similar = (a, b, tolerance) =>
    Math.hypot(a.red - b.red, a.green - b.green, a.blue - b.blue) <= tolerance / 100 &&
    Math.abs(a.alpha - b.alpha) < 0.25;
const clusterRuns = (items, tolerance, min) => {
    if (tolerance <= 0) return items;
    const out = [];
    let run = [];
    let runColor = null;
    const flush = () => {
        if (run.length >= min) out.push(run);
        else out.push(...run);
        run = [];
        runColor = null;
    };
    for (const item of items) {
        const color = solidColorOf(item);
        if (color && runColor && similar(color, runColor, tolerance)) { run.push(item); continue; }
        flush();
        if (color) { run = [item]; runColor = color; } else { out.push(item); }
    }
    flush();
    return out;
};
class SymbolPicker extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleQuery', 'handleToggle', 'handlePick']);
        this.state = {query: '', open: {}};
        this.sprites = getSymbolSource().list();
        this.thumbs = new Map();
    }
    handleQuery (event) { this.setState({query: event.target.value}); }
    handleToggle (event) {
        const id = event.currentTarget.dataset.sprite;
        this.setState({open: Object.assign({}, this.state.open, {[id]: !this.isOpen({id})})});
    }
    handlePick (event) { this.props.onPick(event.currentTarget.dataset.sprite, event.currentTarget.dataset.costume); }
    isOpen (sprite) { const flag = this.state.open[sprite.id]; return flag === undefined ? Boolean(sprite.current) : flag; }
    thumb (sprite, costume) {
        const key = `${sprite.id}/${costume.name}/${costume.assetId}`;
        if (!this.thumbs.has(key)) {
            const info = getSymbolSource().get(sprite.id, costume.name);
            this.thumbs.set(key, info ? info.url : '');
        }
        return this.thumbs.get(key);
    }
    render () {
        const query = this.state.query.trim().toLowerCase();
        const groups = this.sprites.map(sprite => {
            const spriteHit = query && sprite.name.toLowerCase().includes(query);
            const costumes = sprite.costumes.filter(costume => !costume.blocked &&
                (!query || spriteHit || costume.name.toLowerCase().includes(query)));
            return {sprite, costumes};
        }).filter(group => group.costumes.length);
        return (
            <DimodDialog closeLabel="Cancel" title="Pick a costume" onClose={this.props.onClose}>
            <div className={styles.symbolPicker}>
                <input
                    autoFocus
                    className={styles.symbolSearch}
                    placeholder={'Search sprites and costumes'}
                    value={this.state.query}
                    onChange={this.handleQuery}
                />
                <div className={styles.symbolScroll}>
                    {groups.length ? groups.map(({sprite, costumes}) => {
                        const open = query ? true : this.isOpen(sprite);
                        return (
                            <div key={sprite.id}>
                                <button
                                    className={styles.symbolHead}
                                    data-sprite={sprite.id}
                                    onClick={this.handleToggle}
                                >{`${open ? '▾' : '▸'} ${sprite.name}`}<span className={styles.symbolCount}>{costumes.length}</span></button>
                                {open ? (
                                    <div className={styles.symbolGrid}>
                                        {costumes.map(costume => (
                                            <button
                                                className={classNames(styles.symbolTile, {[styles.symbolTileOn]: costume.name === this.props.current && sprite.id === this.props.currentSprite})}
                                                data-costume={costume.name}
                                                data-sprite={sprite.id}
                                                key={costume.name}
                                                title={`${sprite.name} / ${costume.name}`}
                                                onClick={this.handlePick}
                                            >
                                                <img
                                                    alt=""
                                                    className={styles.symbolThumb}
                                                    loading="lazy"
                                                    src={this.thumb(sprite, costume)}
                                                />
                                                <span className={styles.symbolName}>{costume.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    }) : <div className={styles.empty}>{'Nothing matches (costumes that would loop back into this one are hidden).'}</div>}
                </div>
            </div>
            </DimodDialog>
        );
    }
}
SymbolPicker.propTypes = {
    current: PropTypes.string,
    currentSprite: PropTypes.string,
    onClose: PropTypes.func.isRequired,
    onPick: PropTypes.func.isRequired
};
class LayersPanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleToggle',
            'handleSelect',
            'handleEnter',
            'handleLeave',
            'handleVisibility',
            'handleLock',
            'handleStartRename',
            'handleRenameChange',
            'handleRenameKey',
            'handleRenameCommit',
            'handleDragStart',
            'handleDragOver',
            'handleDragLeave',
            'handleDrop',
            'handleDragEnd',
            'handleListDragOver',
            'handleListDrop',
            'handleGroup',
            'handleSymbolToggle',
            'handleSymbolPick',
            'handleUngroup',
            'handleDelete',
            'handleClusterSelect',
            'handleClusterEnter',
            'handleClusterLock',
            'handleClusterVisibility',
            'handleClusterTolerance',
            'handleClusterMin'
        ]);
        const saved = loadSettings();
        this.state = {
            symbols: false,
            expanded: {},
            renaming: null,
            draft: '',
            dropTarget: null,
            draggingKey: null,
            clusterTolerance: typeof saved.layersClusterTolerance === 'number' ?
                saved.layersClusterTolerance : CLUSTER_TOLERANCE,
            clusterMin: typeof saved.layersClusterMin === 'number' ? saved.layersClusterMin : CLUSTER_MIN
        };
        this.byKey = new Map();
        this.clusters = new Map();
    }
    componentDidMount () {
        this.unsubscribeRemote = subscribeRemoteApplied(() => this.forceUpdate());
        this.poll = setInterval(() => {
            if (this.signature() !== this.shownSignature) this.forceUpdate();
        }, 200);
    }
    signature () {
        const layer = getPaintingLayer();
        const parts = [];
        const walk = items => items.forEach(item => {
            parts.push(keyOf(item), item.visible ? 1 : 0, item.locked ? 1 : 0, item.selected ? 1 : 0,
                item.data && item.data.layerName, item.content, swatchOf(item));
            walk(visibleChildren(item));
        });
        if (layer) walk(visibleChildren(layer));
        return parts.join('|');
    }
    componentWillUnmount () {
        clearInterval(this.poll);
        this.clearHover();
        if (this.unsubscribeRemote) this.unsubscribeRemote();
    }
    itemFor (event) { return this.byKey.get(event.currentTarget.dataset.key) || null; }
    clearHover () {
        if (this.hoverGuide) this.hoverGuide.remove();
        this.hoverGuide = null;
        if (this.hoverGuides) this.hoverGuides.forEach(guide => guide.remove());
        this.hoverGuides = null;
    }
    clusterFor (event) { return this.clusters.get(event.currentTarget.dataset.cluster) || null; }
    handleClusterTolerance (event) {
        const clusterTolerance = Number(event.target.value);
        this.setState({clusterTolerance});
        saveSettings({layersClusterTolerance: clusterTolerance});
    }
    handleClusterMin (event) {
        const clusterMin = Math.max(2, Math.min(50, Math.round(Number(event.target.value)) || CLUSTER_MIN));
        this.setState({clusterMin});
        saveSettings({layersClusterMin: clusterMin});
    }
    handleClusterSelect (event) {
        const members = this.clusterFor(event);
        if (!members) return;
        const pickable = members.filter(item => !item.locked && item.visible);
        if (!pickable.length) return;
        if (this.props.mode !== Modes.SELECT) this.props.changeMode(Modes.SELECT);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            const on = !pickable.every(item => item.selected);
            pickable.forEach(item => setItemSelection(item, on, true));
        } else { clearSelection(this.props.clearSelectedItems); pickable.forEach(item => setItemSelection(item, true, true)); }
        this.props.setSelectedItems();
    }
    handleClusterEnter (event) {
        this.clearHover();
        const members = this.clusterFor(event);
        if (!members) return;
        this.hoverGuides = members.filter(item => item.visible).map(item => {
            const guide = item instanceof paper.Path ? hoverItem(item) : hoverBounds(item);
            if (guide) guide.data.isHelperItem = true;
            return guide;
        })
            .filter(Boolean);
    }
    handleClusterLock (event) {
        event.stopPropagation();
        const members = this.clusterFor(event);
        if (!members) return;
        const lock = !members.every(item => item.locked);
        members.forEach(item => {
            item.locked = lock;
            if (lock) item.selected = false;
        });
        this.props.setSelectedItems();
        this.commit('lock');
    }
    handleClusterVisibility (event) {
        event.stopPropagation();
        const members = this.clusterFor(event);
        if (!members) return;
        const show = members.every(item => !item.visible);
        members.forEach(item => {
            item.visible = show;
            if (!show) item.selected = false;
        });
        this.props.setSelectedItems();
        this.clearHover();
        this.commit('hide');
    }
    commit (label) { setHistoryLabel(label); this.props.onUpdateImage(); }
    handleToggle (event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        this.setState({expanded: {...this.state.expanded, [key]: !this.state.expanded[key]}});
    }
    handleSelect (event) {
        const item = this.itemFor(event);
        if (!item || item.locked || !item.visible) return;
        if (this.props.mode !== Modes.SELECT) this.props.changeMode(Modes.SELECT);
        const root = getRootItem(item);
        if (event.shiftKey || event.metaKey || event.ctrlKey) { setItemSelection(root, !root.selected, true); } else { clearSelection(this.props.clearSelectedItems); setItemSelection(root, true, true ); }
        this.props.setSelectedItems();
    }
    handleEnter (event) {
        this.clearHover();
        const item = this.itemFor(event);
        if (!item || !item.visible) return;
        this.hoverGuide = item instanceof paper.Path ? hoverItem(item) : hoverBounds(item);
        if (this.hoverGuide) this.hoverGuide.data.isHelperItem = true;
    }
    handleLeave () { this.clearHover(); }
    handleVisibility (event) {
        event.stopPropagation();
        const item = this.itemFor(event);
        if (!item) return;
        item.visible = !item.visible;
        if (!item.visible && item.selected) { item.selected = false; this.props.setSelectedItems(); }
        this.clearHover();
        this.commit('hide');
    }
    handleLock (event) {
        event.stopPropagation();
        const item = this.itemFor(event);
        if (!item) return;
        item.locked = !item.locked;
        if (item.locked && item.selected) { item.selected = false; this.props.setSelectedItems(); }
        this.commit('lock');
    }
    handleStartRename (event) {
        event.stopPropagation();
        const item = this.itemFor(event);
        if (!item) return;
        this.setState({renaming: keyOf(item), draft: this.nameOf(item)});
    }
    handleRenameChange (event) { this.setState({draft: event.target.value}); }
    handleRenameKey (event) {
        event.stopPropagation();
        if (event.key === 'Enter') this.handleRenameCommit();
        if (event.key === 'Escape') this.setState({renaming: null});
    }
    handleRenameCommit () {
        const item = this.byKey.get(this.state.renaming);
        const name = this.state.draft.trim();
        this.setState({renaming: null});
        if (!item) return;
        const current = item.data && item.data.layerName;
        if ((current || '') === name) return;
        if (name && name !== this.defaultName(item)) { item.data.layerName = name; } else { delete item.data.layerName; }
        this.commit('rename');
    }
    handleDragStart (event) {
        const item = this.itemFor(event);
        if (!item || item.parent instanceof paper.CompoundPath) { event.preventDefault(); return; }
        this.dragging = item;
        this.setState({draggingKey: keyOf(item)});
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', keyOf(item));
    }
    dropPlacement (event, target) {
        const rect = event.currentTarget.getBoundingClientRect();
        const y = (event.clientY - rect.top) / rect.height;
        if (target instanceof paper.Group && y > 0.25 && y < 0.75) return 'inside';
        return y < 0.5 ? 'above' : 'below';
    }
    canDrop (dragged, target, placement) {
        if (!dragged || !target || dragged === target) return false;
        if (target.isDescendant(dragged)) return false;
        if (target.parent instanceof paper.CompoundPath) return false;
        if (placement === 'inside' && !(target instanceof paper.Group)) return false;
        return true;
    }
    handleDragOver (event) {
        const target = this.itemFor(event);
        const placement = this.dropPlacement(event, target);
        if (!this.canDrop(this.dragging, target, placement)) return;
        event.preventDefault();
        const dropTarget = {key: keyOf(target), placement};
        if (!this.state.dropTarget || this.state.dropTarget.key !== dropTarget.key ||
            this.state.dropTarget.placement !== placement) { this.setState({dropTarget}); }
    }
    handleDragLeave (event) {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        this.setState({dropTarget: null});
    }
    handleDrop (event) {
        event.preventDefault();
        const target = this.itemFor(event);
        const dragged = this.dragging;
        const placement = this.dropPlacement(event, target);
        this.setState({dropTarget: null});
        this.dragging = null;
        if (!this.canDrop(dragged, target, placement)) return;
        if (placement === 'inside') target.addChild(dragged);
        else if (placement === 'above') dragged.insertAbove(target);
        else dragged.insertBelow(target);
        this.props.setSelectedItems();
        this.commit('reorder');
    }
    handleDragEnd () { this.dragging = null; this.setState({dropTarget: null, draggingKey: null}); }
    handleListDragOver (event) {
        if (event.target !== event.currentTarget || !this.dragging) return;
        event.preventDefault();
        if (!this.state.dropTarget || this.state.dropTarget.key !== 'end') {
            this.setState({dropTarget: {key: 'end', placement: 'end'}});
        }
    }
    handleListDrop (event) {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        const dragged = this.dragging;
        const layer = getPaintingLayer();
        this.dragging = null;
        this.setState({dropTarget: null, draggingKey: null});
        if (!dragged || !layer) return;
        layer.insertChild(0, dragged);
        this.props.setSelectedItems();
        this.commit('reorder');
    }
    handleGroup () { runCommand('group'); }
    handleSymbolToggle () { this.setState({symbols: !this.state.symbols}); }
    handleSymbolPick (sprite, costume) {
        this.setState({symbols: false});
        placeSymbol({sprite, costume}).then(raster => {
            if (!raster) return;
            clearSelection(this.props.clearSelectedItems);
            raster.selected = true;
            this.props.setSelectedItems(this.props.format);
            setHistoryLabel('symbol');
            this.props.onUpdateImage();
        });
    }
    handleUngroup () { runCommand('ungroup'); }
    handleDelete () { runCommand('delete'); }
    defaultName (item) {
        const f = this.props.intl.formatMessage;
        const kind = kindOf(item);
        if (kind === 'text' && item.content) {
            const text = item.content.replace(/\s+/g, ' ').trim();
            return `“${text.length > 24 ? `${text.slice(0, 24)}…` : text}”`;
        }
        return f(messages$1[kind] || messages$1.shape);
    }
    nameOf (item) { return (item.data && item.data.layerName) || this.defaultName(item); }
    renderCluster (members, depth, rows) {
        const f = this.props.intl.formatMessage;
        const key = `c${keyOf(members[0])}`;
        this.clusters.set(key, members);
        const collapsed = !this.state.expanded[key];
        const locked = members.every(item => item.locked);
        const visible = members.some(item => item.visible);
        rows.push(
            <div
                className={classNames(styles.layerRow, {
                    [styles.layerSelected]: members.every(item => item.selected),
                    [styles.layerHidden]: !visible
                })}
                data-cluster={key}
                key={key}
                style={{paddingLeft: `${(depth * 0.875) + 0.25}rem`}}
                onClick={this.handleClusterSelect}
                onMouseEnter={this.handleClusterEnter}
                onMouseLeave={this.handleLeave}
            >
                <button className={styles.caretButton} data-key={key} onClick={this.handleToggle}>{collapsed ? '▸' : '▾'}</button>
                <Icon kind="group" />
                <span className={styles.layerSwatch} style={{background: swatchOf(members[0])}} />
                <span className={classNames(styles.layerName, styles.layerNameDefault)}>
                    {f(messages$1.cluster, {count: members.length})}
                </span>
                <button
                    className={classNames(styles.rowToggle, {[styles.rowToggleOn]: locked})}
                    data-cluster={key}
                    title={f(locked ? messages$1.unlock : messages$1.lock)}
                    onClick={this.handleClusterLock}
                >
                    <svg height="12" viewBox="0 0 12 12" width="12">
                        <rect fill="currentColor" height="5" rx="1" width="8" x="2" y="5.5" />
                        <path d={locked ? LOCKED_SHACKLE : OPEN_SHACKLE} fill="none" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                </button>
                <button
                    className={classNames(styles.rowToggle, {[styles.rowToggleOn]: !visible})}
                    data-cluster={key}
                    title={f(visible ? messages$1.hide : messages$1.show)}
                    onClick={this.handleClusterVisibility}
                >
                    <svg height="12" viewBox="0 0 12 12" width="12">
                        <path
                            d="M1 6s1.8-3.4 5-3.4S11 6 11 6s-1.8 3.4-5 3.4S1 6 1 6z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.2"
                        />
                        {visible ?
                            <circle cx="6" cy="6" fill="currentColor" r="1.6" /> :
                            <path d="M2 10L10 2" stroke="currentColor" strokeWidth="1.3" />}
                    </svg>
                </button>
            </div>
        );
        if (!collapsed) this.renderRows(members, depth + 1, rows, false);
    }
    renderRows (items, depth, rows, cluster = true) {
        const f = this.props.intl.formatMessage;
        const entries = cluster ? clusterRuns(items, this.state.clusterTolerance, this.state.clusterMin) : items;
        for (const entry of entries) {
            if (Array.isArray(entry)) { this.renderCluster(entry, depth, rows); continue; }
            const item = entry;
            const key = keyOf(item);
            this.byKey.set(key, item);
            const children = visibleChildren(item);
            const hasChildren = children.length > 0;
            const collapsed = !this.state.expanded[key];
            const kind = kindOf(item);
            const swatch = kind === 'group' ? null : swatchOf(item);
            const drop = this.state.dropTarget && this.state.dropTarget.key === key ?
                this.state.dropTarget.placement : null;
            const named = Boolean(item.data && item.data.layerName);
            rows.push(
                <div
                    className={classNames(styles.layerRow, {
                        [styles.layerSelected]: item.selected,
                        [styles.layerHidden]: !item.visible,
                        [styles.dropAbove]: drop === 'above',
                        [styles.dropBelow]: drop === 'below',
                        [styles.dropInside]: drop === 'inside',
                        [styles.layerDragging]: this.state.draggingKey === key
                    })}
                    data-key={key}
                    draggable={this.state.renaming !== key}
                    key={key}
                    style={{paddingLeft: `${(depth * 0.875) + 0.25}rem`}}
                    onClick={this.handleSelect}
                    onDragEnd={this.handleDragEnd}
                    onDragLeave={this.handleDragLeave}
                    onDragOver={this.handleDragOver}
                    onDragStart={this.handleDragStart}
                    onDrop={this.handleDrop}
                    onMouseEnter={this.handleEnter}
                    onMouseLeave={this.handleLeave}
                >
                    {hasChildren ? (
                        <button
                            className={styles.caretButton}
                            data-key={key}
                            onClick={this.handleToggle}
                        >{collapsed ? '▸' : '▾'}</button>
                    ) : <span className={styles.caretSpacer} />}
                    <Icon kind={kind} />
                    {swatch ? (
                        <span className={styles.layerSwatch} style={{background: swatch}} />
                    ) : null}
                    {this.state.renaming === key ? (
                        <input
                            autoFocus
                            className={styles.renameInput}
                            value={this.state.draft}
                            onBlur={this.handleRenameCommit}
                            onChange={this.handleRenameChange}
                            onClick={e => e.stopPropagation()}
                            onFocus={e => e.target.select()}
                            onKeyDown={this.handleRenameKey}
                        />
                    ) : (
                        <span
                            className={classNames(styles.layerName, {[styles.layerNameDefault]: !named})}
                            data-key={key}
                            title={f(messages$1.rename)}
                            onDoubleClick={this.handleStartRename}
                        >{this.nameOf(item)}</span>
                    )}
                    <button
                        className={classNames(styles.rowToggle, {[styles.rowToggleOn]: item.locked})}
                        data-key={key}
                        title={f(item.locked ? messages$1.unlock : messages$1.lock)}
                        onClick={this.handleLock}
                    >
                        <svg height="12" viewBox="0 0 12 12" width="12">
                            <rect fill="currentColor" height="5" rx="1" width="8" x="2" y="5.5" />
                            <path
                                d={item.locked ? LOCKED_SHACKLE : OPEN_SHACKLE}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.3"
                            />
                        </svg>
                    </button>
                    <button
                        className={classNames(styles.rowToggle, {[styles.rowToggleOn]: !item.visible})}
                        data-key={key}
                        title={f(item.visible ? messages$1.hide : messages$1.show)}
                        onClick={this.handleVisibility}
                    >
                        <svg height="12" viewBox="0 0 12 12" width="12">
                            <path
                                d="M1 6s1.8-3.4 5-3.4S11 6 11 6s-1.8 3.4-5 3.4S1 6 1 6z"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.2"
                            />
                            {item.visible ?
                                <circle cx="6" cy="6" fill="currentColor" r="1.6" /> :
                                <path d="M2 10L10 2" stroke="currentColor" strokeWidth="1.3" />}
                        </svg>
                    </button>
                </div>
            );
            if (hasChildren && !collapsed) this.renderRows(children, depth + 1, rows);
        }
        return rows;
    }
    render () {
        const f = this.props.intl.formatMessage;
        if (isBitmap(this.props.format)) { return <div className={styles.empty}>{f(messages$1.bitmap)}</div>; }
        const layer = getPaintingLayer();
        const roots = layer ? visibleChildren(layer) : [];
        this.byKey = new Map();
        this.clusters = new Map();
        const hasSelection = roots.some(item => item.selected);
        this.shownSignature = this.signature();
        return (
            <div className={styles.layers}>
                {roots.length === 0 ?
                    <div className={styles.empty}>{f(messages$1.empty)}</div> :
                    <div
                        className={classNames(styles.list, {
                            [styles.dropEnd]: this.state.dropTarget && this.state.dropTarget.key === 'end'
                        })}
                        onDragOver={this.handleListDragOver}
                        onDrop={this.handleListDrop}
                    >{this.renderRows(roots, 0, [])}</div>}
                <div className={styles.clusterSettings}>
                    <label className={styles.clusterLine}>
                        <span>{f(messages$1.clusterTolerance)}</span>
                        <input
                            className={styles.clusterSlider}
                            max={50}
                            min={0}
                            type="range"
                            value={this.state.clusterTolerance}
                            onChange={this.handleClusterTolerance}
                        />
                        <span className={styles.clusterValue}>
                            {this.state.clusterTolerance ? `${this.state.clusterTolerance}%` : f(messages$1.clusterOff)}
                        </span>
                    </label>
                    {this.state.clusterTolerance ? (
                        <label className={styles.clusterLine}>
                            <span>{f(messages$1.clusterMin)}</span>
                            <input
                                className={styles.clusterNumber}
                                max={50}
                                min={2}
                                type="number"
                                value={this.state.clusterMin}
                                onChange={this.handleClusterMin}
                            />
                        </label>
                    ) : null}
                </div>
                {this.state.symbols ? <SymbolPicker onClose={this.handleSymbolToggle} onPick={this.handleSymbolPick} /> : null}
                <div className={styles.footer}>
                    {getSymbolSource() ? (
                        <button className={styles.footerButton} onClick={this.handleSymbolToggle}>{'Symbol'}</button>
                    ) : null}
                    <button
                        className={styles.footerButton}
                        disabled={!hasSelection}
                        onClick={this.handleGroup}
                    >{f(messages$1.groupSelected)}</button>
                    <button
                        className={styles.footerButton}
                        disabled={!hasSelection}
                        onClick={this.handleUngroup}
                    >{f(messages$1.ungroupSelected)}</button>
                    <button
                        className={styles.footerButton}
                        disabled={!hasSelection}
                        onClick={this.handleDelete}
                    >{f(messages$1.deleteSelected)}</button>
                </div>
            </div>
        );
    }
}
LayersPanel.propTypes = {
    changeMode: PropTypes.func.isRequired,
    clearSelectedItems: PropTypes.func.isRequired,
    format: PropTypes.string,
    intl: intlShape.isRequired,
    mode: PropTypes.string,
    onUpdateImage: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired
};
const mapStateToProps$1 = state => ({
    format: state.scratchPaint.format,
    mode: state.scratchPaint.mode,
    selectedItems: state.scratchPaint.selectedItems,
    undo: state.scratchPaint.undo
});
const mapDispatchToProps$1 = dispatch => ({
    changeMode: mode => dispatch(changeMode(mode)),
    clearSelectedItems: () => dispatch(clearSelectedItems()),
    setSelectedItems: () => dispatch(setSelectedItems(getSelectedLeafItems(), false))
});
const LayersPanel$1 = connect(mapStateToProps$1, mapDispatchToProps$1)(injectIntl(LayersPanel));
const messages = defineMessages({
    layers: {defaultMessage: 'Layers', description: 'Side panel tab', id: 'paint.sidePanel.layers'},
    history: {defaultMessage: 'History', description: 'Side panel tab', id: 'paint.sidePanel.history'},
    composition: {defaultMessage: 'Composition', description: 'Side panel tab', id: 'paint.sidePanel.composition'},
    close: {defaultMessage: 'Close', description: 'Close the side panel', id: 'paint.sidePanel.close'}
});
const BLEND_MODES = [
    ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
    ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
    ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'],
    ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'],
    ['luminosity', 'Luminosity']
];
class CompositionPanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleOpacity', 'handleOpacityNumber', 'handleCommit', 'handleBlend', 'handleSymbolChange', 'handleSymbolCostume', 'handleSymbolRefresh', 'handleSymbolDetach']);
        this.dirty = false;
        this.state = {picking: false};
    }
    items () { return isBitmap(this.props.format) ? [] : getSelectedRootItems(); }
    apply (key, value) { this.items().forEach(item => { item[key] = value; }); this.forceUpdate(); }
    handleOpacity (event) { this.apply('opacity', Number(event.target.value) / 100); this.dirty = true; }
    handleOpacityNumber (event) {
        const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
        this.apply('opacity', value / 100);
        this.dirty = true;
    }
    handleCommit () {
        if (!this.dirty) return;
        this.dirty = false;
        setHistoryLabel('opacity');
        this.props.onUpdateImage();
    }
    symbolItem () {
        const items = this.items();
        return items.length === 1 && items[0].data && items[0].data.dimodSymbol ? items[0] : null;
    }
    handleSymbolChange () { this.setState({picking: !this.state.picking}); }
    handleSymbolCostume (sprite, costume) {
        this.setState({picking: false});
        const item = this.symbolItem();
        if (item && sprite !== item.data.dimodSymbol.sprite) item.data = Object.assign({}, item.data, {dimodSymbol: Object.assign({}, item.data.dimodSymbol, {sprite})});
        this.swapSymbol(costume);
    }
    handleSymbolRefresh () { this.swapSymbol(); }
    swapSymbol (costume) {
        const item = this.symbolItem();
        if (!item) return;
        refreshSymbol(item, costume).then(raster => {
            if (!raster) return;
            setHistoryLabel('symbol');
            this.props.onUpdateImage();
            this.forceUpdate();
        });
    }
    handleSymbolDetach () {
        const item = this.symbolItem();
        if (!item) return;
        detachSymbol(item);
        setHistoryLabel('symbol');
        this.props.onUpdateImage();
        this.forceUpdate();
    }
    renderSymbol () {
        const item = this.symbolItem();
        if (!item) return null;
        const ref = item.data.dimodSymbol;
        const source = getSymbolSource();
        const sprite = source && source.list().find(entry => entry.id === ref.sprite);
        const stale = symbolStale(item);
        return (
            <div className={styles.compBody}>
                <div className={styles.compRow}>
                    <span className={styles.compLabel}>{sprite ? `${sprite.name} / ${ref.costume}` : `${ref.costume} (missing)`}</span>
                    <button className={styles.footerButton} onClick={this.handleSymbolChange}>{'Change'}</button>
                </div>
                {this.state.picking ? (
                    <SymbolPicker
                        current={ref.costume}
                        currentSprite={ref.sprite}
                        onClose={this.handleSymbolChange}
                        onPick={this.handleSymbolCostume}
                    />
                ) : null}
                <div className={styles.compRow}>
                    <button
                        className={styles.footerButton}
                        onClick={this.handleSymbolRefresh}
                    >{stale ? 'Updating...' : 'Refresh'}</button>
                    <button className={styles.footerButton} onClick={this.handleSymbolDetach}>{'Detach'}</button>
                </div>
            </div>
        );
    }
    handleBlend (event) { this.apply('blendMode', event.target.value); setHistoryLabel('blend'); this.props.onUpdateImage(); }
    render () {
        const items = this.items();
        if (!items.length) {
            return (
                <div className={styles.layers}>
                    <div className={styles.empty}>
                        {isBitmap(this.props.format) ?
                            'Composition is for vector costumes.' :
                            'Select something to set its opacity and blend mode.'}
                    </div>
                </div>
            );
        }
        const same = key => items.every(item => item[key] === items[0][key]);
        const opacity = same('opacity') ? Math.round(items[0].opacity * 100) : null;
        const blend = same('blendMode') ? items[0].blendMode : '';
        return (
            <div className={styles.layers}>
                <div className={styles.compBody}>
                    <label className={styles.compRow}>
                        <span className={styles.compLabel}>{'Opacity'}</span>
                        <input
                            className={styles.clusterSlider}
                            max="100"
                            min="0"
                            type="range"
                            value={opacity === null ? 100 : opacity}
                            onBlur={this.handleCommit}
                            onChange={this.handleOpacity}
                            onKeyUp={this.handleCommit}
                            onMouseUp={this.handleCommit}
                            onTouchEnd={this.handleCommit}
                        />
                        <input
                            className={styles.clusterNumber}
                            max="100"
                            min="0"
                            placeholder={opacity === null ? '...' : ''}
                            type="number"
                            value={opacity === null ? '' : opacity}
                            onBlur={this.handleCommit}
                            onChange={this.handleOpacityNumber}
                        />
                    </label>
                    <label className={styles.compRow}>
                        <span className={styles.compLabel}>{'Blend'}</span>
                        <select className={styles.compSelect} value={blend} onChange={this.handleBlend}>
                            {blend === '' ? <option value="">{'Mixed'}</option> : null}
                            {BLEND_MODES.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                    </label>
                </div>
                {this.renderSymbol()}
            </div>
        );
    }
}
CompositionPanel.propTypes = {format: PropTypes.string, onUpdateImage: PropTypes.func.isRequired};
const CompositionPanel$1 = connect(state => ({
    format: state.scratchPaint.format,
    selectedItems: state.scratchPaint.selectedItems,
    undo: state.scratchPaint.undo
}))(CompositionPanel);
class DimodSidePanel extends React.Component {
    constructor (props) { super(props); bindAll(this, ['handleTab', 'handleClose', 'handleExpand']); this.last = Panels.LAYERS; }
    handleTab (event) { this.props.setPanel(event.currentTarget.dataset.panel); }
    handleClose () { this.props.setPanel(null); }
    handleExpand () { this.props.setPanel(this.last); }
    render () {
        const f = this.props.intl.formatMessage;
        if (!this.props.open) {
            return (
                <div className={styles.collapsedSlot}>
                    <button
                        className={styles.collapsedBar}
                        title={f(messages[this.last.toLowerCase()])}
                        onClick={this.handleExpand}
                    >
                        <span className={styles.collapsedChevron}>{'‹'}</span>
                        <span className={styles.collapsedLabel}>{[Panels.LAYERS, Panels.HISTORY, Panels.COMPOSITION]
                            .map(panel => f(messages[panel.toLowerCase()])).join(' · ')}</span>
                    </button>
                </div>
            );
        }
        this.last = this.props.open;
        return (
            <div className={styles.panelSlot}>
                <div className={styles.panel}>
                <div className={styles.tabs}>
                    {[Panels.LAYERS, Panels.HISTORY, Panels.COMPOSITION].map(panel => (
                        <button
                            className={classNames(styles.tab, {[styles.tabActive]: this.props.open === panel})}
                            data-panel={panel}
                            key={panel}
                            onClick={this.handleTab}
                        >{f(messages[panel.toLowerCase()])}</button>
                    ))}
                    <button className={styles.close} title={f(messages.close)} onClick={this.handleClose}>{'×'}</button>
                </div>
                <div className={styles.body}>
                    {this.props.open === Panels.LAYERS ?
                        <LayersPanel$1 onUpdateImage={this.props.onUpdateImage} /> :
                        this.props.open === Panels.COMPOSITION ?
                            <CompositionPanel$1 onUpdateImage={this.props.onUpdateImage} /> :
                            <HistoryPanel$1 onUpdateImage={this.props.onUpdateImage} />}
                </div>
                </div>
            </div>
        );
    }
}
DimodSidePanel.propTypes = {
    intl: intlShape.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    open: PropTypes.string,
    setPanel: PropTypes.func.isRequired
};
const mapStateToProps = state => ({open: state.scratchPaint.dimodPanels.open});
const mapDispatchToProps = dispatch => ({setPanel: panel => dispatch(setPanel(panel))});
const dimodSidePanel = connect(mapStateToProps, mapDispatchToProps)(injectIntl(DimodSidePanel));
export {dimodSidePanel as DimodSidePanel, HistoryPanel$1 as HistoryPanel, LayersPanel$1 as LayersPanel};
