import React from 'react';
import PropTypes from 'prop-types';
import bindAll from 'lodash.bindall';
import paper from '@turbowarp/paper';
import {getPeers, subscribePeers} from '../dimod/collab.js';
import {getItemByDid} from '../dimod/store.js';
import Modes from '../lib/modes.js';
import classNames from 'classnames';
import {connect} from 'react-redux';
import {defineMessages, intlShape, injectIntl} from 'react-intl';
import {isBitmap} from '../lib/format.js';
import {changeMode} from '../reducers/modes.js';
import {getSelectedRootItems} from '../helper/selection.js';
import {shouldShowGroup, shouldShowUngroup} from '../helper/group.js';
import {shouldShowBringForward, shouldShowSendBackward} from '../helper/order.js';
import {runCommand, getPaintOptions, setPaintOption, subscribePaintOptions} from '../dimod/core.js';
import styles from './dimod-canvas-menu/dimod-canvas-menu.css';
import {isPaintSuspended} from '../lib/dimod-flags';
import {CENTER} from '../helper/view.js';
import {guideAccentRgba} from '../lib/guide-colors.js';
import {ROTATE_HANDLE_DISTANCE} from '../helper/tools/dimod-tools.js';
import styles$1 from './dimod-canvas-overlay/dimod-canvas-overlay.css';
import ReactDOM from 'react-dom';
import styles$2 from './dimod-dialog/dimod-dialog.css';
import ToolSelectComponent from './tool-select-base/tool-select-base.jsx';
import handIcon from './dimod-hand-mode/hand.svg';
import handPixelIcon from './dimod-pixel-icons/hand.svg';
import styles$3 from './dimod-help/dimod-help.css';
import messages$2 from '../lib/messages.js';
import {SelectStyles, SymbolScopes} from '../dimod/items.js';
import {setSelectStyle} from '../reducers/dimod.js';
import vectorSelectIcon from './select-mode/select.svg';
import bitmapSelectIcon from './bit-select-mode/marquee.svg';
import lassoIcon from './dimod-select-style/lasso.svg';
import wandIcon from './dimod-select-style/wand.svg';
import polygonIcon from './dimod-select-style/polygon.svg';
import lassoPixelIcon from './dimod-pixel-icons/lasso.svg';
import polygonPixelIcon from './dimod-pixel-icons/polygon-lasso.svg';
import wandPixelIcon from './dimod-pixel-icons/wand.svg';
import styles$4 from './dimod-tool-group/dimod-tool-group.css';
import styles$5 from './dimod-options/dimod-options.css';
import styles$6 from './dimod-symbols/dimod-symbols.css';
import deleteIcon from './mode-tools/icons/delete.svg';
import detachIcon from './dimod-symbols/icons/detach.svg';
import newSymbolIcon from './dimod-symbols/icons/new-symbol.svg';
import placeCopyIcon from './dimod-symbols/icons/place-copy.svg';
import redefineIcon from './dimod-symbols/icons/redefine.svg';
import dialogStyles from './dimod-dialog/dimod-dialog.css';
import styles$7 from './dimod-symbols/symbol-picker.css';
const LABELS = {
    [Modes.BRUSH]: 'brush',
    [Modes.BIT_BRUSH]: 'brush',
    [Modes.PEN]: 'pen',
    [Modes.ERASER]: 'eraser',
    [Modes.BIT_ERASER]: 'eraser',
    [Modes.FILL]: 'fill',
    [Modes.BIT_FILL]: 'fill',
    [Modes.LINE]: 'line',
    [Modes.BIT_LINE]: 'line',
    [Modes.OVAL]: 'oval',
    [Modes.BIT_OVAL]: 'oval',
    [Modes.RECT]: 'rectangle',
    [Modes.BIT_RECT]: 'rectangle',
    [Modes.ROUNDED_RECT]: 'rectangle',
    [Modes.TEXT]: 'text',
    [Modes.BIT_TEXT]: 'text',
    [Modes.SELECT]: 'select',
    [Modes.BIT_SELECT]: 'select',
    [Modes.RESHAPE]: 'reshape',
    [Modes.TRIANGLE]: 'triangle',
    [Modes.ARROW]: 'arrow',
    [Modes.SUSSY]: 'sussy'
};
const labelForTool = function (tool) {
    if (!tool) return '';
    if (LABELS[tool]) return LABELS[tool];
    return String(tool)
        .toLowerCase()
        .replace(/_/g, ' ');
};
const SELECTION_PADDING = 2;
class DimodCollabOverlay extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handlePeersChanged', 'animationFrame', 'setRootRef']);
        this.state = {peers: getPeers()};
        this.groupRefs = {};
        this.cursorRefs = {};
        this.selectionRefs = {};
    }
    componentDidMount () {
        this.unsubscribe = subscribePeers(this.handlePeersChanged);
        this.sweepInterval = setInterval(this.handlePeersChanged, 1000);
        this.syncFrameLoop();
    }
    componentDidUpdate () { this.syncFrameLoop(); }
    componentWillUnmount () {
        if (this.unsubscribe) this.unsubscribe();
        this.stopFrameLoop();
        clearInterval(this.sweepInterval);
    }
    syncFrameLoop () {
        if (!this.state.peers.length) { this.stopFrameLoop(); return; }
        if (!this.rafId) this.rafId = requestAnimationFrame(this.animationFrame);
    }
    stopFrameLoop () {
        if (!this.rafId) return;
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }
    handlePeersChanged () {
        const peers = getPeers();
        const same = peers.length === this.state.peers.length &&
            peers.every((peer, i) => {
                const was = this.state.peers[i];
                return was && was.peerId === peer.peerId &&
                    was.preview === peer.preview &&
                    was.tool === peer.tool &&
                    was.selection === peer.selection &&
                    was.username === peer.username;
            });
        if (!same) this.setState({peers: peers.slice()});
    }
    setRootRef (element) { this.rootEl = element; }
    animationFrame () {
        if (!this.rafId) return;
        this.rafId = requestAnimationFrame(this.animationFrame);
        const root = this.rootEl;
        const canvas = this.props.canvas;
        if (!root) return;
        if (!canvas || !paper.view) { root.style.display = 'none'; return; }
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) { root.style.display = 'none'; return; }
        root.style.display = '';
        root.style.left = `${rect.left}px`;
        root.style.top = `${rect.top}px`;
        root.style.width = `${rect.width}px`;
        root.style.height = `${rect.height}px`;
        const transform = `matrix(${paper.view.matrix.values.join(',')})`;
        for (const peer of this.state.peers) {
            const group = this.groupRefs[peer.peerId];
            if (group) group.setAttribute('transform', transform);
            this.positionSelection(peer);
            this.positionCursor(peer, rect);
        }
    }
    positionSelection (peer) {
        const container = this.selectionRefs[peer.peerId];
        if (!container) return;
        const outlines = container.childNodes;
        for (let i = 0; i < outlines.length; i++) {
            const node = outlines[i];
            const item = getItemByDid(peer.selection[i]);
            if (!item) { node.setAttribute('width', '0'); node.setAttribute('height', '0'); continue; }
            const bounds = item.bounds;
            node.setAttribute('x', bounds.x - SELECTION_PADDING);
            node.setAttribute('y', bounds.y - SELECTION_PADDING);
            node.setAttribute('width', Math.max(0, bounds.width + (SELECTION_PADDING * 2)));
            node.setAttribute('height', Math.max(0, bounds.height + (SELECTION_PADDING * 2)));
        }
    }
    positionCursor (peer, rect) {
        const element = this.cursorRefs[peer.peerId];
        if (!element) return;
        if (!peer.cursor) { element.style.display = 'none'; return; }
        const point = paper.view.projectToView(new paper.Point(peer.cursor.x, peer.cursor.y));
        if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) {
            element.style.display = 'none';
            return;
        }
        element.style.display = '';
        element.style.transform = `translate(${point.x}px, ${point.y}px)`;
    }
    renderGhost (peer) {
        if (!peer.preview) return null;
        return (
            <g>
                {peer.preview.svg ? (
                    <g dangerouslySetInnerHTML={{__html: peer.preview.svg}} />
                ) : null}
                {peer.preview.dataUrl && peer.preview.rect ? (
                    <image
                        href={peer.preview.dataUrl}
                        x={peer.preview.rect.x}
                        y={peer.preview.rect.y}
                        width={peer.preview.rect.width}
                        height={peer.preview.rect.height}
                    />
                ) : null}
            </g>
        );
    }
    renderPeerArt (peer) {
        return (
            <g key={peer.peerId} ref={el => { this.groupRefs[peer.peerId] = el; }}>
                <g ref={el => { this.selectionRefs[peer.peerId] = el; }}>
                    {peer.selection.map(did => (
                        <rect
                            key={did}
                            width="0"
                            height="0"
                            fill="none"
                            stroke={peer.color}
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                            vectorEffect="non-scaling-stroke"
                        />
                    ))}
                </g>
                <g opacity="0.65">{this.renderGhost(peer)}</g>
            </g>
        );
    }
    renderPeerCursor (peer) {
        return (
            <div
                key={peer.peerId}
                ref={el => { this.cursorRefs[peer.peerId] = el; }}
                style={{position: 'absolute', left: 0, top: 0, display: 'none', willChange: 'transform'}}
            >
                <svg width="20" height="20" viewBox="0 0 20 20" style={{position: 'absolute', left: 0, top: 0, display: 'block'}}>
                    <path
                        d="M2 1 L2 17 L6.5 13.5 L9.5 19 L12 17.5 L9 12 L15 12 Z"
                        fill={peer.color}
                        stroke="#fff"
                        strokeWidth="1"
                    />
                </svg>
                <div
                    style={{
                        position: 'absolute',
                        left: 16,
                        top: 12,
                        whiteSpace: 'nowrap',
                        background: peer.color,
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 'bold',
                        lineHeight: '14px',
                        padding: '1px 6px',
                        borderRadius: 3,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
                        textShadow: '0 1px 1px rgba(0,0,0,0.4)'
                    }}
                >
                    {peer.username || 'Someone'}
                    {peer.tool ? (
                        <span style={{opacity: 0.8, fontWeight: 'normal'}}>
                            {` · ${labelForTool(peer.tool)}`}
                        </span>
                    ) : null}
                </div>
            </div>
        );
    }
    render () {
        const {peers} = this.state;
        if (!peers.length) return null;
        return (
            <div
                ref={this.setRootRef}
                style={{
                    position: 'fixed',
                    left: 0,
                    top: 0,
                    width: 0,
                    height: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    zIndex: 5
                }}
            >
                <svg style={{position: 'absolute', left: 0, top: 0, width: '100%', height: '100%'}}>
                    {peers.map(peer => this.renderPeerArt(peer))}
                </svg>
                {peers.map(peer => this.renderPeerCursor(peer))}
            </div>
        );
    }
}
DimodCollabOverlay.propTypes = {canvas: PropTypes.instanceOf(HTMLCanvasElement)};
export {DimodCollabOverlay, LABELS, labelForTool};
const messages$1 = defineMessages({
    cut: {defaultMessage: 'Cut', description: 'Canvas menu: cut', id: 'paint.canvasMenu.cut'},
    copy: {defaultMessage: 'Copy', description: 'Canvas menu: copy', id: 'paint.canvasMenu.copy'},
    paste: {defaultMessage: 'Paste', description: 'Canvas menu: paste', id: 'paint.canvasMenu.paste'},
    duplicate: {defaultMessage: 'Duplicate', description: 'Canvas menu: duplicate', id: 'paint.canvasMenu.duplicate'},
    delete: {defaultMessage: 'Delete', description: 'Canvas menu: delete', id: 'paint.canvasMenu.delete'},
    front: {defaultMessage: 'Bring to Front', description: 'Canvas menu: order', id: 'paint.canvasMenu.front'},
    forward: {defaultMessage: 'Bring Forward', description: 'Canvas menu: order', id: 'paint.canvasMenu.forward'},
    backward: {defaultMessage: 'Send Backward', description: 'Canvas menu: order', id: 'paint.canvasMenu.backward'},
    back: {defaultMessage: 'Send to Back', description: 'Canvas menu: order', id: 'paint.canvasMenu.back'},
    group: {defaultMessage: 'Group', description: 'Canvas menu: group', id: 'paint.canvasMenu.group'},
    ungroup: {defaultMessage: 'Ungroup', description: 'Canvas menu: ungroup', id: 'paint.canvasMenu.ungroup'},
    flipH: {defaultMessage: 'Flip Horizontal', description: 'Canvas menu: flip', id: 'paint.canvasMenu.flipH'},
    flipV: {defaultMessage: 'Flip Vertical', description: 'Canvas menu: flip', id: 'paint.canvasMenu.flipV'},
    center: {defaultMessage: 'Center', description: 'Canvas menu: center on canvas', id: 'paint.canvasMenu.center'},
    selectAll: {defaultMessage: 'Select All', description: 'Canvas menu: select all', id: 'paint.canvasMenu.selectAll'}
});
const MOD$1 = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const SELECT_MODES = [Modes.SELECT, Modes.RESHAPE, Modes.BIT_SELECT];
class DimodCanvasMenu extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleContextMenu', 'handleClose', 'handleDocumentDown', 'handleKey', 'handleItem', 'setRef']);
        this.state = {at: null};
    }
    componentDidMount () { this.attach(this.props.canvas); }
    componentWillReceiveProps (nextProps) {
        if (nextProps.canvas !== this.props.canvas) { this.detach(this.props.canvas); this.attach(nextProps.canvas); }
    }
    componentWillUnmount () { this.detach(this.props.canvas); this.handleClose(); }
    attach (canvas) {
        if (canvas) canvas.addEventListener('contextmenu', this.handleContextMenu);
    }
    detach (canvas) {
        if (canvas) canvas.removeEventListener('contextmenu', this.handleContextMenu);
    }
    handleContextMenu (event) {
        event.preventDefault();
        const rect = this.props.canvas.getBoundingClientRect();
        const point = paper.view.viewToProject(new paper.Point(event.clientX - rect.left, event.clientY - rect.top));
        if (!isBitmap(this.props.format)) {
            if (SELECT_MODES.indexOf(this.props.mode) === -1) this.props.changeMode(Modes.SELECT);
            runCommand('selectAt', point);
        }
        const x = Math.min(event.clientX, window.innerWidth - 200);
        const y = Math.min(event.clientY, window.innerHeight - 380);
        this.setState({at: {x, y}});
        document.addEventListener('mousedown', this.handleDocumentDown, true);
        document.addEventListener('keydown', this.handleKey, true);
        window.addEventListener('blur', this.handleClose);
    }
    handleClose () {
        if (!this.state.at) return;
        this.setState({at: null});
        document.removeEventListener('mousedown', this.handleDocumentDown, true);
        document.removeEventListener('keydown', this.handleKey, true);
        window.removeEventListener('blur', this.handleClose);
    }
    handleDocumentDown (event) {
        if (this.el && this.el.contains(event.target)) return;
        this.handleClose();
    }
    handleKey (event) {
        if (isPaintSuspended()) return;
        if (event.key === 'Escape') { event.stopPropagation(); this.handleClose(); }
    }
    handleItem (event) {
        const command = event.currentTarget.dataset.command;
        this.handleClose();
        if (command === 'selectAll' && SELECT_MODES.indexOf(this.props.mode) === -1) {
            this.props.changeMode(isBitmap(this.props.format) ? Modes.BIT_SELECT : Modes.SELECT);
        }
        runCommand(command);
    }
    setRef (el) { this.el = el; }
    renderItem (command, label, options = {}) {
        return (
            <button
                className={styles.item}
                data-command={command}
                disabled={options.disabled}
                key={command}
                onClick={this.handleItem}
            >
                <span>{label}</span>
                {options.key ? <span className={styles.key}>{options.key}</span> : null}
            </button>
        );
    }
    render () {
        if (!this.state.at) return null;
        const f = this.props.intl.formatMessage;
        const bitmap = isBitmap(this.props.format);
        const has = getSelectedRootItems().length > 0;
        const sep = key => (<div className={styles.separator} key={key} />);
        return (
            <div
                className={classNames(styles.menu)}
                ref={this.setRef}
                style={{left: this.state.at.x, top: this.state.at.y}}
                onContextMenu={e => e.preventDefault()}
            >
                {this.renderItem('cut', f(messages$1.cut), {disabled: !has, key: `${MOD$1}X`})}
                {this.renderItem('copy', f(messages$1.copy), {disabled: !has, key: `${MOD$1}C`})}
                {this.renderItem('paste', f(messages$1.paste), {disabled: !this.props.canPaste, key: `${MOD$1}V`})}
                {this.renderItem('duplicate', f(messages$1.duplicate), {disabled: !has, key: `${MOD$1}D`})}
                {this.renderItem('delete', f(messages$1.delete), {disabled: !has, key: 'Del'})}
                {bitmap ? null : sep('s1')}
                {bitmap ? null : this.renderItem('bringToFront', f(messages$1.front), {disabled: !shouldShowBringForward()})}
                {bitmap ? null : this.renderItem('bringForward', f(messages$1.forward), {disabled: !shouldShowBringForward()})}
                {bitmap ? null : this.renderItem('sendBackward', f(messages$1.backward), {disabled: !shouldShowSendBackward()})}
                {bitmap ? null : this.renderItem('sendToBack', f(messages$1.back), {disabled: !shouldShowSendBackward()})}
                {bitmap ? null : sep('s2')}
                {bitmap ? null : this.renderItem('group', f(messages$1.group), {disabled: !shouldShowGroup(), key: `${MOD$1}G`})}
                {bitmap ? null : this.renderItem('ungroup', f(messages$1.ungroup), {
                    disabled: !shouldShowUngroup(),
                    key: `${MOD$1}Shift+G`
                })}
                {sep('s3')}
                {this.renderItem('flipHorizontal', f(messages$1.flipH), {disabled: !has})}
                {this.renderItem('flipVertical', f(messages$1.flipV), {disabled: !has})}
                {this.renderItem('center', f(messages$1.center), {disabled: !has})}
                {sep('s4')}
                {this.renderItem('selectAll', f(messages$1.selectAll), {key: `${MOD$1}A`})}
            </div>
        );
    }
}
DimodCanvasMenu.propTypes = {
    canPaste: PropTypes.bool,
    canvas: PropTypes.instanceOf(Element),
    changeMode: PropTypes.func.isRequired,
    format: PropTypes.string,
    intl: intlShape.isRequired,
    mode: PropTypes.string
};
const mapStateToProps$3 = state => ({
    canPaste: state.scratchPaint.clipboard.items.length > 0,
    format: state.scratchPaint.format,
    mode: state.scratchPaint.mode,
    selectedItems: state.scratchPaint.selectedItems
});
const mapDispatchToProps$1 = dispatch => ({changeMode: mode => dispatch(changeMode(mode))});
const dimodCanvasMenu = connect(mapStateToProps$3, mapDispatchToProps$1)(injectIntl(DimodCanvasMenu));
const RULER = 18;
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const PIXEL_GRID_MIN = 8;
class DimodCanvasOverlay extends React.Component {
    constructor (props) {
        super(props);
        this.setRef = this.setRef.bind(this);
        this.tick = this.tick.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseLeave = this.handleMouseLeave.bind(this);
        this.mouse = null;
        this.last = '';
    }
    componentDidMount () { this.sync(); }
    componentDidUpdate () { this.last = ''; this.sync(); }
    componentWillUnmount () { this.stop(); }
    get active () {
        return this.props.grid || this.props.rulers || this.props.mirrorLines.length > 0 ||
            this.props.mirrorRadial.n > 1;
    }
    sync () {
        if (this.active) this.start();
        else this.stop();
    }
    start () {
        if (this.frame) return;
        if (this.props.canvas) {
            this.props.canvas.addEventListener('mousemove', this.handleMouseMove);
            this.props.canvas.addEventListener('mouseleave', this.handleMouseLeave);
            this.listening = this.props.canvas;
        }
        this.frame = requestAnimationFrame(this.tick);
    }
    stop () {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = null;
        if (this.listening) {
            this.listening.removeEventListener('mousemove', this.handleMouseMove);
            this.listening.removeEventListener('mouseleave', this.handleMouseLeave);
            this.listening = null;
        }
        if (this.el) {
            const context = this.el.getContext('2d');
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, this.el.width, this.el.height);
        }
        this.last = '';
    }
    handleMouseMove (event) {
        const rect = this.el.getBoundingClientRect();
        this.mouse = {x: event.clientX - rect.left, y: event.clientY - rect.top};
    }
    handleMouseLeave () { this.mouse = null; }
    tick () {
        this.frame = requestAnimationFrame(this.tick);
        if (!this.el || !paper.view) return;
        const width = this.el.clientWidth;
        const height = this.el.clientHeight;
        const m = paper.view.matrix;
        const key = [width, height, m.a, m.tx, m.ty, this.mouse && this.mouse.x, this.mouse && this.mouse.y,
            this.props.grid, this.props.gridSize, this.props.rulers, this.props.format, this.dark(),
            JSON.stringify(this.props.mirrorLines), JSON.stringify(this.props.mirrorRadial), this.props.mirrorEnabled, this.props.mirrorSelected,
            this.props.mode].join(',');
        if (key === this.last) return;
        this.last = key;
        this.draw(width, height);
    }
    dark () {
        const themed = this.el && this.el.closest('[data-paint-theme]');
        return Boolean(themed && themed.getAttribute('data-paint-theme') === 'dark');
    }
    draw (width, height) {
        const ratio = window.devicePixelRatio || 1;
        if (this.el.width !== Math.round(width * ratio) || this.el.height !== Math.round(height * ratio)) {
            this.el.width = Math.round(width * ratio);
            this.el.height = Math.round(height * ratio);
        }
        const context = this.el.getContext('2d');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        const m = paper.view.matrix;
        const zoom = Math.hypot(m.a, m.b);
        const turned = Math.abs(m.b) > 1e-9 || m.a < 0;
        if (turned) {
            if (this.props.grid) this.drawGridTurned(context, m, ratio, zoom, dark => dark);
            this.drawMirrors(context, width, height, m);
            if (this.props.rulers) this.drawRulers(context, width, height, {m, zoom, dark: this.dark()});
            return;
        }
        const toScreenX = x => (((CENTER.x + (x * 2)) * zoom) + m.tx);
        const toScreenY = y => (((CENTER.y - (y * 2)) * zoom) + m.ty);
        const toStageX = sx => (((sx - m.tx) / zoom) - CENTER.x) / 2;
        const toStageY = sy => (CENTER.y - ((sy - m.ty) / zoom)) / 2;
        const dark = this.dark();
        const line = dark ? 'rgba(255, 255, 255, ' : 'rgba(40, 40, 80, ';
        if (this.props.grid) { this.drawGrid(context, width, height, {toScreenX, toScreenY, toStageX, toStageY, zoom, line}); }
        this.drawMirrors(context, width, height, m);
        if (this.props.rulers) { this.drawRulers(context, width, height, {m, zoom, dark}); }
    }
    drawGridTurned (context, m, ratio, zoom) {
        const line = this.dark() ? 'rgba(255, 255, 255, ' : 'rgba(40, 40, 80, ';
        const bounds = paper.view.bounds;
        context.save();
        context.setTransform(ratio * m.a, ratio * m.b, ratio * m.c, ratio * m.d, ratio * m.tx, ratio * m.ty);
        context.lineWidth = 1 / zoom;
        const lines = (size, alpha) => {
            const step = size * 2;
            if (step * zoom < 4) return;
            context.beginPath();
            for (let x = CENTER.x + (Math.ceil((bounds.left - CENTER.x) / step) * step); x <= bounds.right; x += step) {
                context.moveTo(x, bounds.top);
                context.lineTo(x, bounds.bottom);
            }
            for (let y = CENTER.y + (Math.ceil((bounds.top - CENTER.y) / step) * step); y <= bounds.bottom; y += step) {
                context.moveTo(bounds.left, y);
                context.lineTo(bounds.right, y);
            }
            context.strokeStyle = `${line}${alpha})`;
            context.stroke();
        };
        if (isBitmap(this.props.format) && zoom >= PIXEL_GRID_MIN) lines(0.5, 0.08);
        lines(this.props.gridSize, 0.16);
        lines(this.props.gridSize * 4, 0.28);
        context.beginPath();
        context.moveTo(CENTER.x, bounds.top);
        context.lineTo(CENTER.x, bounds.bottom);
        context.moveTo(bounds.left, CENTER.y);
        context.lineTo(bounds.right, CENTER.y);
        context.strokeStyle = guideAccentRgba(0.55);
        context.stroke();
        context.restore();
    }
    drawGrid (context, width, height, v) {
        const x0 = v.toStageX(0);
        const x1 = v.toStageX(width);
        const y0 = v.toStageY(height);
        const y1 = v.toStageY(0);
        const lines = (size, alpha) => {
            if (size * 2 * v.zoom < 4) return;
            context.beginPath();
            for (let x = Math.ceil(x0 / size) * size; x <= x1; x += size) {
                const sx = Math.round(v.toScreenX(x)) + 0.5;
                context.moveTo(sx, 0);
                context.lineTo(sx, height);
            }
            for (let y = Math.ceil(y0 / size) * size; y <= y1; y += size) {
                const sy = Math.round(v.toScreenY(y)) + 0.5;
                context.moveTo(0, sy);
                context.lineTo(width, sy);
            }
            context.strokeStyle = `${v.line}${alpha})`;
            context.lineWidth = 1;
            context.stroke();
        };
        if (isBitmap(this.props.format) && v.zoom >= PIXEL_GRID_MIN) lines(0.5, 0.08);
        lines(this.props.gridSize, 0.16);
        lines(this.props.gridSize * 4, 0.28);
        context.beginPath();
        const ax = Math.round(v.toScreenX(0)) + 0.5;
        const ay = Math.round(v.toScreenY(0)) + 0.5;
        context.moveTo(ax, 0);
        context.lineTo(ax, height);
        context.moveTo(0, ay);
        context.lineTo(width, ay);
        context.strokeStyle = guideAccentRgba(0.55);
        context.stroke();
    }
    drawMirrors (context, width, height, m) {
        const editing = this.props.mode === Modes.MIRROR || this.props.mode === Modes.BIT_MIRROR;
        const toScreen = (x, y) => [(x * m.a) + (y * m.c) + m.tx, (x * m.b) + (y * m.d) + m.ty];
        const viewTurn = Math.atan2(m.b, m.a);
        const reach = width + height;
        const radial = this.props.mirrorRadial;
        if (radial.n > 1) {
            const [cx, cy] = toScreen(radial.x, radial.y);
            const alpha = this.props.mirrorEnabled ? 0.45 : 0.18;
            context.save();
            context.setLineDash([2, 6]);
            context.strokeStyle = `rgba(236, 72, 153, ${alpha})`;
            context.lineWidth = 1;
            context.beginPath();
            for (let i = 0; i < radial.n; i++) {
                const a = viewTurn + (-Math.PI / 2) + (i * Math.PI * 2 / radial.n);
                context.moveTo(cx, cy);
                context.lineTo(cx + (Math.cos(a) * reach), cy + (Math.sin(a) * reach));
            }
            context.stroke();
            context.restore();
            context.beginPath();
            context.arc(cx, cy, editing ? 7 : 4, 0, Math.PI * 2);
            context.fillStyle = 'rgb(236, 72, 153)';
            context.fill();
            if (editing) {
                context.fillStyle = 'white';
                context.font = 'bold 9px sans-serif';
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillText(String(radial.n), cx, cy + 0.5);
                context.textAlign = 'start';
                context.textBaseline = 'alphabetic';
            }
        }
        this.props.mirrorLines.forEach((line, index) => {
            const [cx, cy] = toScreen(line.x, line.y);
            const rad = (line.angle * Math.PI / 180) + viewTurn;
            const dx = Math.cos(rad);
            const dy = Math.sin(rad);
            const selected = editing && index === this.props.mirrorSelected;
            context.save();
            context.beginPath();
            context.moveTo(cx - (dx * reach), cy - (dy * reach));
            context.lineTo(cx + (dx * reach), cy + (dy * reach));
            context.setLineDash(this.props.mirrorEnabled ? [8, 5] : [3, 6]);
            context.lineWidth = selected ? 2 : 1.25;
            context.strokeStyle = this.props.mirrorEnabled ?
                'rgba(236, 72, 153, 0.9)' : 'rgba(236, 72, 153, 0.35)';
            context.stroke();
            context.restore();
            if (!editing) return;
            const rx = cx + (dx * ROTATE_HANDLE_DISTANCE);
            const ry = cy + (dy * ROTATE_HANDLE_DISTANCE);
            context.beginPath();
            context.moveTo(cx, cy);
            context.lineTo(rx, ry);
            context.strokeStyle = 'rgba(236, 72, 153, 0.9)';
            context.lineWidth = 2;
            context.stroke();
            for (const [x, y, r] of [[cx, cy, 6], [rx, ry, 4.5]]) {
                context.beginPath();
                context.arc(x, y, r, 0, Math.PI * 2);
                context.fillStyle = 'white';
                context.fill();
                context.lineWidth = 2;
                context.strokeStyle = 'rgb(236, 72, 153)';
                context.stroke();
            }
        });
    }
    drawRulers (context, width, height, v) {
        const pxPerUnit = 2 * v.zoom;
        const step = TICK_STEPS.find(s => s * pxPerUnit >= 48) || TICK_STEPS[TICK_STEPS.length - 1];
        const minor = step / (String(step)[0] === '5' || String(step)[0] === '2' ? 5 : 10);
        const background = v.dark ? 'rgba(30, 30, 30, 0.94)' : 'rgba(249, 249, 252, 0.94)';
        const ink = v.dark ? 'rgba(230, 230, 240, 0.75)' : 'rgba(87, 94, 117, 0.85)';
        context.fillStyle = background;
        context.fillRect(0, 0, width, RULER);
        context.fillRect(0, 0, RULER, height);
        context.font = '9px sans-serif';
        context.fillStyle = ink;
        context.strokeStyle = ink;
        context.lineWidth = 1;
        context.beginPath();
        const inv = v.m.inverted();
        const stageAt = (sx, sy) => {
            const p = inv.transform(new paper.Point(sx, sy));
            return [(p.x - CENTER.x) / 2, (CENTER.y - p.y) / 2];
        };
        const edge = (at, from, to, tick) => {
            const s0 = stageAt(...at(0));
            const s1 = stageAt(...at(1));
            const axis = Math.abs(s1[0] - s0[0]) >= Math.abs(s1[1] - s0[1]) ? 0 : 1;
            const u0 = s0[axis];
            const k = s1[axis] - s0[axis];
            if (Math.abs(k) < 1e-9) return;
            const ua = Math.min(u0 + (k * from), u0 + (k * to));
            const ub = Math.max(u0 + (k * from), u0 + (k * to));
            for (let u = Math.ceil(ua / minor) * minor; u <= ub; u += minor) {
                const t = Math.round((u - u0) / k) + 0.5;
                const major = Math.abs((u / step) - Math.round(u / step)) < 1e-6;
                tick(t, major, String(Math.round(u)));
            }
        };
        edge(t => [t, RULER], RULER, width, (sx, major, label) => {
            context.moveTo(sx, RULER);
            context.lineTo(sx, major ? RULER - 9 : RULER - 4);
            if (major) context.fillText(label, sx + 2, 9);
        });
        edge(t => [RULER, t], RULER, height, (sy, major, label) => {
            context.moveTo(RULER, sy);
            context.lineTo(major ? RULER - 9 : RULER - 4, sy);
            if (major) {
                context.save();
                context.translate(9, sy - 2);
                context.rotate(-Math.PI / 2);
                context.fillText(label, 0, 0);
                context.restore();
            }
        });
        context.stroke();
        if (this.mouse) {
            context.beginPath();
            context.strokeStyle = guideAccentRgba(0.95);
            context.moveTo(Math.round(this.mouse.x) + 0.5, 0);
            context.lineTo(Math.round(this.mouse.x) + 0.5, RULER);
            context.moveTo(0, Math.round(this.mouse.y) + 0.5);
            context.lineTo(RULER, Math.round(this.mouse.y) + 0.5);
            context.stroke();
        }
        context.clearRect(0, 0, RULER, RULER);
        context.fillStyle = background;
        context.fillRect(0, 0, RULER, RULER);
        context.beginPath();
        context.strokeStyle = v.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
        context.moveTo(0, RULER + 0.5);
        context.lineTo(width, RULER + 0.5);
        context.moveTo(RULER + 0.5, 0);
        context.lineTo(RULER + 0.5, height);
        context.stroke();
    }
    setRef (el) { this.el = el; }
    render () {
        return (
            <canvas className={styles$1.overlay} ref={this.setRef} />
        );
    }
}
DimodCanvasOverlay.propTypes = {
    canvas: PropTypes.instanceOf(Element),
    format: PropTypes.string,
    grid: PropTypes.bool,
    gridSize: PropTypes.number,
    mirrorEnabled: PropTypes.bool,
    mirrorLines: PropTypes.arrayOf(PropTypes.object),
    mirrorRadial: PropTypes.shape({n: PropTypes.number, x: PropTypes.number, y: PropTypes.number}),
    mirrorSelected: PropTypes.number,
    mode: PropTypes.string,
    rulers: PropTypes.bool
};
const mapStateToProps$2 = state => ({
    format: state.scratchPaint.format,
    grid: state.scratchPaint.dimodView.gridAddon && state.scratchPaint.dimodView.grid,
    gridSize: state.scratchPaint.dimodView.gridSize,
    rulers: state.scratchPaint.dimodView.rulers,
    mirrorLines: state.scratchPaint.dimodMirror.lines,
    mirrorRadial: state.scratchPaint.dimodMirror.radial,
    mirrorEnabled: state.scratchPaint.dimodMirror.enabled,
    mirrorSelected: state.scratchPaint.dimodMirror.selected,
    mode: state.scratchPaint.mode
});
const dimodCanvasOverlay = connect(mapStateToProps$2)(DimodCanvasOverlay);
class DimodDialog extends React.Component {
    constructor (props) {
        super(props);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleOverlayClick = this.handleOverlayClick.bind(this);
        this.handleCardClick = this.handleCardClick.bind(this);
        this.state = {node: null};
        this.useModal = typeof window !== 'undefined' && typeof window.dimodPaintModal === 'function';
    }
    componentDidMount () {
        if (!this.useModal) { document.addEventListener('keydown', this.handleKeyDown); return; }
        window.dimodPaintModal(this.props.title, () => {
            this.closed = true;
            if (!this.unmounted) this.props.onClose();
        }).then(handle => {
            this.handle = handle;
            if (this.unmounted) handle.close();
            else this.setState({node: handle.node});
        });
    }
    componentWillUnmount () {
        this.unmounted = true;
        document.removeEventListener('keydown', this.handleKeyDown);
        if (this.handle && !this.closed) this.handle.close();
    }
    handleKeyDown (event) {
        if (event.key !== 'Escape' || isPaintSuspended()) return;
        event.stopPropagation();
        this.props.onClose();
    }
    handleOverlayClick () { this.props.onClose(); }
    handleCardClick (event) { event.stopPropagation(); }
    render () {
        if (this.useModal) {
            if (!this.state.node) return null;
            return ReactDOM.createPortal(
                <div className={styles$2.inModal}>
                    <div className={styles$2.modalBody}>
                        {this.props.children}
                    </div>
                    {this.props.footer ?
                        <div className={styles$2.footer}>{this.props.footer}</div> :
                        null
                    }
                </div>,
                this.state.node
            );
        }
        return (
            <div className={styles$2.overlay} onClick={this.handleOverlayClick}>
                <div className={styles$2.card} onClick={this.handleCardClick}>
                    <div className={styles$2.header}>
                        <span className={styles$2.title}>{this.props.title}</span>
                        <button className={styles$2.close} title={this.props.closeLabel} onClick={this.props.onClose}>
                            {'×'}
                        </button>
                    </div>
                    <div className={styles$2.body}>
                        {this.props.children}
                    </div>
                    {this.props.footer ?
                        <div className={styles$2.footer}>{this.props.footer}</div> :
                        null
                    }
                </div>
            </div>
        );
    }
}
DimodDialog.propTypes = {
    children: PropTypes.node,
    closeLabel: PropTypes.string,
    footer: PropTypes.node,
    onClose: PropTypes.func.isRequired,
    title: PropTypes.string.isRequired
};
const OPTION_ROWS = [
    {
        key: 'mergeNodeCursor',
        label: 'Merge node cursor with cursor',
        help: 'Puts the node cursor in the same slot as the cursor and its select styles. Turn off to give it a button of its own.'
    },
    {
        key: 'twoColumns',
        label: 'Two tool columns',
        help: 'Lays the tools out in two columns instead of one, which leaves more height for the palette and more room on short screens.'
    },
    {
        key: 'foldTools',
        label: 'Fold related tools into one slot',
        help: 'Keeps the brush and pen, the shapes, and the fills together under one button each. Turn off to show every tool at once.'
    },
    {
        key: 'hoverFlyouts',
        label: 'Open tool flyouts on hover',
        help: 'Hold the mouse over a folded tool to show the others in its slot. Turn off to open them only with a right-click.'
    },
    {
        key: 'localGizmo',
        label: 'Rotated selection handles',
        help: 'The selection box turns with a rotated shape, so its handles sit on the shape\'s own sides and stretching works along them. Turn off for the usual upright box.'
    },
    {
        key: 'rotFollow',
        label: 'Rotation handle follows the mouse',
        help: 'Move the mouse just outside any edge of a selection and the rotation handle slides there, so you can turn it from any side. Turn off to keep the handle in one place under the selection.'
    },
    {
        key: 'rotReach',
        label: 'Rotation grab distance',
        type: 'range',
        min: 12,
        max: 80,
        unit: 'px',
        help: 'How far outside the selection the rotation handle will follow the mouse. Larger is easier to grab.'
    },
    {
        key: 'rotStart',
        label: 'Rotation handle start distance',
        type: 'range',
        min: 0,
        max: 40,
        unit: 'px',
        help: 'How far outside an edge the mouse has to be before the rotation handle starts moving toward it. Raise it to keep the handle from jumping around when you are near an edge.'
    }
];
class DimodOptionRow extends React.Component {
    constructor (props) {
        super(props);
        this.state = {help: false};
        this.handleHelp = () => this.setState({help: !this.state.help});
        this.handleChange = event => setPaintOption(this.props.row.key,
            this.props.row.type === 'range' ? Number(event.target.value) : event.target.checked);
    }
    render () {
        const {row, value} = this.props;
        return (
            <div className={classNames(styles$5.setting, {[styles$5.active]: row.type === 'range' ? false : value})}>
                <div className={styles$5.label}>
                    <label className={styles$5.label}>
                        {row.type === 'range' ? (
                            <input max={row.max} min={row.min} type="range" value={value} onChange={this.handleChange} />
                        ) : (
                            <input checked={value} className={styles$5.checkbox} type="checkbox" onChange={this.handleChange} />
                        )}
                        {row.type === 'range' ? `${row.label}: ${value}${row.unit}` : row.label}
                    </label>
                    <button className={styles$5.helpIcon} title="Click for help" onClick={this.handleHelp} />
                </div>
                {this.state.help ? <div className={styles$5.detail}>{row.help}</div> : null}
            </div>
        );
    }
}
DimodOptionRow.propTypes = {
    row: PropTypes.shape({key: PropTypes.string, label: PropTypes.string, help: PropTypes.string}).isRequired,
    value: PropTypes.oneOfType([PropTypes.bool, PropTypes.number])
};
class DimodOptionsButton extends React.Component {
    constructor (props) {
        super(props);
        this.state = {open: false};
        this.handleOpen = () => this.setState({open: true});
        this.handleClose = () => this.setState({open: false});
    }
    componentDidMount () { this.unsubscribe = subscribePaintOptions(() => this.forceUpdate()); }
    componentWillUnmount () { this.unsubscribe(); }
    render () {
        const options = getPaintOptions();
        return (
            <div>
                <button className={styles$5.button} title="Editor options" onClick={this.handleOpen}>
                    <svg viewBox="0 0 24 24">
                        <path
                            d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"
                            fill="currentColor"
                        />
                    </svg>
                </button>
                {this.state.open ? (
                    <DimodDialog closeLabel="Close" title="Editor Options" onClose={this.handleClose}>
                        {OPTION_ROWS.map(row => (
                            <DimodOptionRow key={row.key} row={row} value={options[row.key]} />
                        ))}
                    </DimodDialog>
                ) : null}
            </div>
        );
    }
}
const withPaintOptions = Wrapped => class PaintOptionsListener extends React.Component {
    componentDidMount () { this.unsubscribe = subscribePaintOptions(() => this.forceUpdate()); }
    componentWillUnmount () { this.unsubscribe(); }
    render () { return <Wrapped {...this.props} />; }
};
const messages = defineMessages({
    hand: {
        defaultMessage: 'Hand',
        description: 'Label for the tool that moves the view around the canvas',
        id: 'paint.handMode.hand'
    }
});
const DimodHandModeComponent = props => (
    <ToolSelectComponent
        imgDescriptor={messages.hand}
        imgSrc={props.isBitmap ? handPixelIcon : handIcon}
        isSelected={props.isSelected}
        keybinding="H"
        onMouseDown={props.onMouseDown}
    />
);
DimodHandModeComponent.propTypes = {
    isBitmap: PropTypes.bool,
    isSelected: PropTypes.bool.isRequired,
    onMouseDown: PropTypes.func.isRequired
};
const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
const vectorTools = [
    ['S', 'Select (box, lasso, polygon, wand)'], ['A', 'Reshape'], ['B', 'Brush'], ['E', 'Eraser'],
    ['F', 'Fill'], ['G', 'Gradient'], ['T', 'Text'], ['L', 'Line'], ['C', 'Circle'], ['R', 'Rectangle'],
    ['M', 'Mirror lines'], ['H', 'Hand']
];
const bitmapTools = [
    ['S', 'Select (box, lasso, polygon, wand)'], ['B', 'Brush'], ['E', 'Eraser'], ['F', 'Fill'],
    ['G', 'Gradient'], ['T', 'Text'], ['L', 'Line'], ['C', 'Circle'], ['R', 'Rectangle'],
    ['M', 'Mirror lines'], ['H', 'Hand']
];
const edit = [
    [`${MOD} Z`, 'Undo'], [`${MOD} Shift Z · ${MOD} Y`, 'Redo'],
    [`${MOD} C`, 'Copy'], [`${MOD} X`, 'Cut'], [`${MOD} V`, 'Paste'], [`${MOD} D`, 'Duplicate'],
    ['Delete', 'Delete'], [`${MOD} A`, 'Select all'], ['Esc', 'Deselect'],
    [`${MOD} G`, 'Group'], [`${MOD} Shift G`, 'Ungroup'], ['Right-click', 'More actions']
];
const view = [
    ['Space + drag', 'Pan with any tool'], ['Middle-drag', 'Pan'], [`${MOD} + wheel`, 'Zoom'],
    ['Shift + wheel', 'Scroll sideways'], ['?', 'This sheet']
];
const drawing = [
    ['Shift + drag', 'Straight / 45° / perfect shapes'], ['Alt + drag', 'Duplicate while moving'],
    [`${MOD} + drag`, 'Move the object, not the pivot'],
    ['Shift + click', 'Add to selection'], ['Arrow keys', 'Nudge'],
    ['Polygon lasso', 'Click corners · Enter or double-click ends · Backspace undoes a corner']
];
class DimodShortcutSheet extends React.Component {
    constructor (props) { super(props); bindAll(this, ['handleKey', 'handleClose', 'handleToggle']); this.state = {open: false}; }
    componentDidMount () {
        document.addEventListener('keydown', this.handleKey);
        document.addEventListener('dimod-paint-shortcuts', this.handleToggle);
    }
    componentWillUnmount () {
        document.removeEventListener('keydown', this.handleKey);
        document.removeEventListener('dimod-paint-shortcuts', this.handleToggle);
    }
    handleKey (event) {
        if (isPaintSuspended()) return;
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
            (target && target.isContentEditable)) return;
        if (event.key === '?' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            this.handleToggle();
        } else if (event.key === 'Escape' && this.state.open) { this.handleClose(); }
    }
    handleToggle () { this.setState({open: !this.state.open}); }
    handleClose () { this.setState({open: false}); }
    renderSection (title, rows) {
        return (
            <div className={styles$3.section}>
                <div className={styles$3.sectionTitle}>{title}</div>
                {rows.map(([keys, what]) => (
                    <div className={styles$3.row} key={keys + what}>
                        <span className={styles$3.keys}>
                            {keys.split(' · ').map(k => <kbd key={k}>{k}</kbd>)}
                        </span>
                        <span className={styles$3.what}>{what}</span>
                    </div>
                ))}
            </div>
        );
    }
    render () {
        if (!this.state.open) return null;
        return (
            <DimodDialog title="Keyboard shortcuts" onClose={this.handleClose}>
                <div className={styles$3.columns}>
                    {this.renderSection('Tools', isBitmap(this.props.format) ? bitmapTools : vectorTools)}
                    {this.renderSection('Edit', edit)}
                    {this.renderSection('View', view)}
                    {this.renderSection('Drawing', drawing)}
                </div>
            </DimodDialog>
        );
    }
}
DimodShortcutSheet.propTypes = {format: PropTypes.string};
const dimodShortcutSheet = connect(state => ({format: state.scratchPaint.format}))(DimodShortcutSheet);
const styleMessages = defineMessages({
    lasso: {
        defaultMessage: 'Lasso',
        description: 'Label for the selection style that selects inside a freehand loop',
        id: 'paint.selectStyle.lasso'
    },
    polygon: {
        defaultMessage: 'Polygon Lasso',
        description: 'Label for the selection style that selects inside a shape clicked out corner by corner',
        id: 'paint.selectStyle.polygon'
    },
    wand: {
        defaultMessage: 'Magic Wand',
        description: 'Label for the selection style that selects everything of the clicked colour',
        id: 'paint.selectStyle.wand'
    }
});
const selectStyleMessage = style => {
    if (style === SelectStyles.LASSO) return styleMessages.lasso;
    if (style === SelectStyles.POLYGON) return styleMessages.polygon;
    if (style === SelectStyles.WAND) return styleMessages.wand;
    return messages$2.select;
};
const iconFor = (style, mode) => {
    if (mode === Modes.BIT_SELECT) {
        if (style === SelectStyles.LASSO) return lassoPixelIcon;
        if (style === SelectStyles.POLYGON) return polygonPixelIcon;
        if (style === SelectStyles.WAND) return wandPixelIcon;
        return bitmapSelectIcon;
    }
    if (style === SelectStyles.LASSO) return lassoIcon;
    if (style === SelectStyles.POLYGON) return polygonIcon;
    if (style === SelectStyles.WAND) return wandIcon;
    return mode === Modes.BIT_SELECT ? bitmapSelectIcon : vectorSelectIcon;
};
const DimodSelectStyleButton = props => (
    <ToolSelectComponent
        imgDescriptor={selectStyleMessage(props.selectStyle)}
        imgSrc={iconFor(props.selectStyle, props.mode)}
        isSelected={props.isSelected}
        keybinding={props.selectStyle === SelectStyles.BOX ? 'S' : null}
        onMouseDown={props.onPick}
    />
);
DimodSelectStyleButton.propTypes = {
    isSelected: PropTypes.bool.isRequired,
    mode: PropTypes.oneOf([Modes.SELECT, Modes.BIT_SELECT]).isRequired,
    onPick: PropTypes.func.isRequired,
    selectStyle: PropTypes.oneOf(Object.keys(SelectStyles)).isRequired
};
const mapStateToProps$1 = (state, ownProps) => ({
    isSelected: state.scratchPaint.mode === ownProps.mode &&
        state.scratchPaint.dimodSelectStyle.style === ownProps.selectStyle
});
const mapDispatchToProps = (dispatch, ownProps) => ({
    onPick: () => { dispatch(setSelectStyle(ownProps.selectStyle)); dispatch(changeMode(ownProps.mode)); }
});
const dimodSelectStyle = connect(mapStateToProps$1, mapDispatchToProps)(DimodSelectStyleButton);
const itemId = item => item.id || item.mode;
const OPEN_DELAY = 500;
class DimodToolGroup extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleClick', 'handleMouseEnter', 'handleMouseLeave', 'handleContextMenu', 'open', 'setRef']);
        this.state = {last: itemId(props.items[0]), open: null};
    }
    componentWillReceiveProps (nextProps) {
        if (nextProps.activeId !== this.props.activeId && this.hasItem(nextProps, nextProps.activeId)) {
            this.setState({last: nextProps.activeId});
        }
    }
    hasItem (props, id) { return props.items.some(item => itemId(item) === id); }
    componentDidMount () { this.unsubscribe = subscribePaintOptions(() => this.forceUpdate()); }
    componentWillUnmount () { clearTimeout(this.timer); this.unsubscribe(); }
    handleMouseEnter () {
        clearTimeout(this.timer);
        if (!getPaintOptions().hoverFlyouts) return;
        this.timer = setTimeout(this.open, OPEN_DELAY);
    }
    handleContextMenu (event) { event.preventDefault(); clearTimeout(this.timer); this.open(); }
    open () {
        if (!this.ref) return;
        const rect = this.ref.getBoundingClientRect();
        const z = this.ref.offsetWidth ? rect.width / this.ref.offsetWidth : 1; // hack: workbench theme zooms the toolbar, fixed coords scale with it
        this.setState({open: {left: rect.left / z, top: rect.top / z, width: rect.width / z, height: rect.height / z}});
    }
    handleMouseLeave () { clearTimeout(this.timer); this.setState({open: null}); }
    handleClick () { clearTimeout(this.timer); this.setState({open: null}); }
    setRef (el) { this.ref = el; }
    render () {
        const {items, activeId} = this.props;
        if (!getPaintOptions().foldTools) {
            return (
                <div className={styles$4.flat}>
                    {items.map(item => <div key={itemId(item)}>{item.element}</div>)}
                </div>
            );
        }
        const open = this.state.open;
        let current = this.hasItem(this.props, activeId) ? activeId : this.state.last;
        if (!this.hasItem(this.props, current)) current = itemId(items[0]);
        return (
            <div
                className={styles$4.group}
                ref={this.setRef}
                style={open ? {width: open.width, height: open.height} : null}
                onContextMenu={this.handleContextMenu}
                onMouseEnter={this.handleMouseEnter}
                onMouseLeave={this.handleMouseLeave}
            >
                <div
                    className={classNames(styles$4.strip, {[styles$4.stripOpen]: open})}
                    style={open ? {left: open.left, top: open.top} : null}
                    onClickCapture={this.handleClick}
                >
                    {items.map(item => (
                        <div
                            className={classNames(styles$4.item, {[styles$4.itemCurrent]: itemId(item) === current})}
                            key={itemId(item)}
                        >
                            {item.element}
                        </div>
                    ))}
                </div>
                {open ? null : <span className={styles$4.corner} />}
            </div>
        );
    }
}
DimodToolGroup.propTypes = {
    activeId: PropTypes.string,
    items: PropTypes.arrayOf(PropTypes.shape({
        element: PropTypes.node.isRequired,
        id: PropTypes.string,
        mode: PropTypes.string
    })).isRequired
};
const mapStateToProps = (state, ownProps) => {
    const mode = state.scratchPaint.mode;
    if (!ownProps.styleOf) return {activeId: mode};
    if (mode === ownProps.styleOf) return {activeId: state.scratchPaint.dimodSelectStyle.style};
    return {activeId: ownProps.items.some(item => item.mode === mode) ? mode : null};
};
const dimodToolGroup = connect(mapStateToProps)(DimodToolGroup);
export {DimodOptionsButton, withPaintOptions, dimodCanvasMenu as DimodCanvasMenu, dimodCanvasOverlay as DimodCanvasOverlay, DimodDialog, DimodHandModeComponent, dimodSelectStyle as DimodSelectStyle, dimodShortcutSheet as DimodShortcutSheet, dimodToolGroup as DimodToolGroup, messages as handMessages, selectStyleMessage};
const messages$4 = defineMessages({
    empty: {
        defaultMessage: 'Select some art and make it a symbol. Every copy you place stays in step with it.',
        description: 'Shown in the symbols panel when there are no symbols yet',
        id: 'paint.symbols.empty'
    },
    create: {
        defaultMessage: 'New',
        description: 'Label for the button that turns the selection into a reusable symbol',
        id: 'paint.symbols.create'
    },
    createHint: {
        defaultMessage: 'Turn the selection into a symbol',
        description: 'Tooltip for the button that turns the selection into a reusable symbol',
        id: 'paint.symbols.createHint'
    },
    createDisabled: {
        defaultMessage: 'Select something to turn into a symbol',
        description: 'Tooltip explaining why the new-symbol button is unavailable',
        id: 'paint.symbols.createDisabled'
    },
    place: {
        defaultMessage: 'Copy',
        description: 'Label for the button that adds another instance of the selected symbol',
        id: 'paint.symbols.place'
    },
    placeHint: {
        defaultMessage: 'Place another copy of this symbol',
        description: 'Tooltip for the button that adds another instance',
        id: 'paint.symbols.placeHint'
    },
    redefine: {
        defaultMessage: 'Replace',
        description: 'Label for the button that replaces a symbol’s art with the selected art',
        id: 'paint.symbols.redefine'
    },
    redefineHint: {
        defaultMessage: 'Every copy of this symbol becomes the selected art',
        description: 'Tooltip for the button that replaces a symbol’s art',
        id: 'paint.symbols.redefineHint'
    },
    detach: {
        defaultMessage: 'Detach',
        description: 'Label for the button that unlinks a copy from its symbol, keeping the art',
        id: 'paint.symbols.detach'
    },
    detachHint: {
        defaultMessage: 'Keep the art and stop it following the symbol',
        description: 'Tooltip for the detach button',
        id: 'paint.symbols.detachHint'
    },
    remove: {
        defaultMessage: 'Delete',
        description: 'Label for the button that deletes a symbol and detaches its copies',
        id: 'paint.symbols.remove'
    },
    removeHint: {
        defaultMessage: 'Delete the symbol. The copies stay on the canvas as ordinary art.',
        description: 'Tooltip for the delete-symbol button',
        id: 'paint.symbols.removeHint'
    },
    rename: {
        defaultMessage: 'Double-click to rename',
        description: 'Tooltip on a symbol tile explaining how to rename it',
        id: 'paint.symbols.rename'
    },
    copies: {
        defaultMessage: '{count, plural, one {# copy} other {# copies}}',
        description: 'How many instances of a symbol the costume contains',
        id: 'paint.symbols.copies'
    },
    unused: {
        defaultMessage: 'Not used yet',
        description: 'Shown on a symbol that has no copies in the costume',
        id: 'paint.symbols.unused'
    },
    more: {
        defaultMessage: 'More…',
        description: 'Label for the tile that opens the full symbol picker',
        id: 'paint.symbols.more'
    },
    scope: {
        defaultMessage: 'Available in',
        description: 'Label for the control that chooses how widely a symbol is shared',
        id: 'paint.symbols.scope'
    },
    scopeCostume: {
        defaultMessage: 'This costume',
        description: 'Label for a symbol that is only available in the costume it was made in',
        id: 'paint.symbols.scopeCostume'
    },
    scopeSprite: {
        defaultMessage: 'This sprite',
        description: 'Label for a symbol that is available in every costume of one sprite',
        id: 'paint.symbols.scopeSprite'
    },
    scopeGlobal: {
        defaultMessage: 'Everywhere',
        description: 'Label for a symbol that is available in every project',
        id: 'paint.symbols.scopeGlobal'
    }
});
const SCOPE_MESSAGES = {
    [SymbolScopes.COSTUME]: messages$4.scopeCostume,
    [SymbolScopes.SPRITE]: messages$4.scopeSprite,
    [SymbolScopes.GLOBAL]: messages$4.scopeGlobal
};
const SCOPE_ORDER = [SymbolScopes.COSTUME, SymbolScopes.SPRITE, SymbolScopes.GLOBAL];
const symbolShape = PropTypes.shape({
    id: PropTypes.string.isRequired,
    instances: PropTypes.number,
    name: PropTypes.string.isRequired,
    scope: PropTypes.string,
    thumbnail: PropTypes.string
});
class ScopeButton extends React.Component {
    constructor (props) { super(props); this.handleClick = this.handleClick.bind(this); }
    handleClick () { this.props.onSelect(this.props.scope); }
    render () {
        return (
            <button
                className={classNames(styles$6.scopeButton, {[styles$6.scopeButtonActive]: this.props.active})}
                onClick={this.handleClick}
            >
                {this.props.label}
            </button>
        );
    }
}
ScopeButton.propTypes = {
    active: PropTypes.bool,
    label: PropTypes.string.isRequired,
    onSelect: PropTypes.func.isRequired,
    scope: PropTypes.string.isRequired
};
class SymbolTile extends React.Component {
    constructor (props) {
        super(props);
        this.state = {editing: false, draft: props.symbol.name};
        this.handleClick = this.handleClick.bind(this);
        this.handleDoubleClick = this.handleDoubleClick.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.handleBlur = this.handleBlur.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }
    handleClick () { this.props.onSelect(this.props.symbol.id); }
    handleDoubleClick () { this.setState({editing: true, draft: this.props.symbol.name}); }
    handleChange (event) { this.setState({draft: event.target.value}); }
    handleBlur () {
        if (!this.state.editing) return;
        this.setState({editing: false});
        const name = this.state.draft.trim();
        if (name && name !== this.props.symbol.name) { this.props.onRename(this.props.symbol.id, name); }
    }
    handleKeyDown (event) {
        if (event.key === 'Enter') { event.target.blur(); } else if (event.key === 'Escape') { this.setState({editing: false, draft: this.props.symbol.name}); }
        event.stopPropagation();
    }
    render () {
        const {symbol} = this.props;
        const scopeMessage = SCOPE_MESSAGES[symbol.scope] || messages$4.scopeGlobal;
        return (
            <div
                className={classNames(styles$6.tile, {[styles$6.tileSelected]: this.props.selected})}
                title={this.props.intl.formatMessage(messages$4.rename)}
                onClick={this.handleClick}
                onDoubleClick={this.handleDoubleClick}
            >
                <div className={styles$6.preview}>
                    {symbol.thumbnail ?
                        <img alt={symbol.name} className={styles$6.previewImage} draggable={false} src={symbol.thumbnail} /> :
                        <div className={styles$6.previewMissing} />
                    }
                    {symbol.scope === SymbolScopes.GLOBAL ? null : (
                        <span className={styles$6.scopeBadge} title={this.props.intl.formatMessage(scopeMessage)}>
                            {symbol.scope === SymbolScopes.COSTUME ? 'C' : 'S'}
                        </span>
                    )}
                </div>
                {this.state.editing ?
                    <input
                        autoFocus
                        className={styles$6.nameInput}
                        value={this.state.draft}
                        onBlur={this.handleBlur}
                        onChange={this.handleChange}
                        onKeyDown={this.handleKeyDown}
                    /> :
                    <span className={styles$6.name}>{symbol.name}</span>
                }
                <span className={styles$6.count}>
                    {symbol.instances === 0 ?
                        this.props.intl.formatMessage(messages$4.unused) :
                        this.props.intl.formatMessage(messages$4.copies, {count: symbol.instances})}
                </span>
            </div>
        );
    }
}
SymbolTile.propTypes = {
    intl: intlShape.isRequired,
    onRename: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired,
    selected: PropTypes.bool,
    symbol: symbolShape.isRequired
};
const VISIBLE_LIMIT = 6;
const ActionButton = props => (
    <button
        className={classNames(styles$6.action, {[styles$6.actionDestructive]: props.destructive})}
        disabled={props.disabled}
        title={props.title}
        onClick={props.onClick}
    >
        <img className={styles$6.actionIcon} draggable={false} src={props.icon} />
        <span className={styles$6.actionLabel}>{props.label}</span>
    </button>
);
ActionButton.propTypes = {
    destructive: PropTypes.bool,
    disabled: PropTypes.bool,
    icon: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired,
    title: PropTypes.string
};
const DimodSymbolsComponent = props => {
    const symbols = props.symbols || [];
    const selected = symbols.find(symbol => symbol.id === props.selectedSymbol) || null;
    const overflowing = symbols.length > VISIBLE_LIMIT;
    const shown = overflowing ? symbols.slice(0, VISIBLE_LIMIT - 1) : symbols;
    const format = id => props.intl.formatMessage(id);
    return (
        <div className={styles$6.panel}>
            {symbols.length === 0 ?
                <p className={styles$6.empty}>{format(messages$4.empty)}</p> :
                <div className={styles$6.grid}>
                    {shown.map(symbol => (
                        <SymbolTile
                            key={symbol.id}
                            intl={props.intl}
                            selected={symbol.id === props.selectedSymbol}
                            symbol={symbol}
                            onRename={props.onRenameSymbol}
                            onSelect={props.onSelectSymbol}
                        />
                    ))}
                    {overflowing ?
                        <button className={classNames(styles$6.tile, styles$6.moreTile)} onClick={props.onOpenPicker}>
                            <span className={styles$6.moreCount}>{`+${symbols.length - shown.length}`}</span>
                            <span className={styles$6.name}>{format(messages$4.more)}</span>
                        </button> : null
                    }
                </div>
            }
            <div className={styles$6.actions}>
                <ActionButton
                    disabled={!props.hasSelection}
                    icon={newSymbolIcon}
                    label={format(messages$4.create)}
                    title={format(props.hasSelection ? messages$4.createHint : messages$4.createDisabled)}
                    onClick={props.onCreateSymbol}
                />
                <ActionButton
                    disabled={!selected}
                    icon={placeCopyIcon}
                    label={format(messages$4.place)}
                    title={format(messages$4.placeHint)}
                    onClick={props.onPlaceInstance}
                />
                <ActionButton
                    disabled={!selected || !props.hasSelection}
                    icon={redefineIcon}
                    label={format(messages$4.redefine)}
                    title={format(messages$4.redefineHint)}
                    onClick={props.onRedefineSymbol}
                />
                <ActionButton
                    disabled={!props.hasSelectedInstance}
                    icon={detachIcon}
                    label={format(messages$4.detach)}
                    title={format(messages$4.detachHint)}
                    onClick={props.onDetachInstance}
                />
                <ActionButton
                    destructive
                    disabled={!selected}
                    icon={deleteIcon}
                    label={format(messages$4.remove)}
                    title={format(messages$4.removeHint)}
                    onClick={props.onDeleteSymbol}
                />
            </div>
            {selected ?
                <div className={styles$6.scopeRow}>
                    <span className={styles$6.scopeLabel}>{format(messages$4.scope)}</span>
                    <div className={styles$6.scopeGroup}>
                        {SCOPE_ORDER.map(scope => (
                            <ScopeButton
                                key={scope}
                                active={(selected.scope || SymbolScopes.GLOBAL) === scope}
                                label={format(SCOPE_MESSAGES[scope])}
                                scope={scope}
                                onSelect={props.onSetSymbolScope}
                            />
                        ))}
                    </div>
                </div> : null
            }
        </div>
    );
};
DimodSymbolsComponent.propTypes = {
    hasSelectedInstance: PropTypes.bool,
    hasSelection: PropTypes.bool,
    intl: intlShape.isRequired,
    onCreateSymbol: PropTypes.func.isRequired,
    onDeleteSymbol: PropTypes.func.isRequired,
    onDetachInstance: PropTypes.func.isRequired,
    onOpenPicker: PropTypes.func.isRequired,
    onPlaceInstance: PropTypes.func.isRequired,
    onRedefineSymbol: PropTypes.func.isRequired,
    onRenameSymbol: PropTypes.func.isRequired,
    onSelectSymbol: PropTypes.func.isRequired,
    onSetSymbolScope: PropTypes.func.isRequired,
    selectedSymbol: PropTypes.string,
    symbols: PropTypes.arrayOf(symbolShape)
};
DimodSymbolsComponent.defaultProps = {symbols: []};
const dimodSymbols = injectIntl(DimodSymbolsComponent);
const messages$3 = defineMessages({
    title: {
        defaultMessage: 'Symbols',
        description: 'Title of the dialog that lists every available symbol',
        id: 'paint.symbolPicker.title'
    },
    search: {
        defaultMessage: 'Search symbols',
        description: 'Placeholder for the symbol search field',
        id: 'paint.symbolPicker.search'
    },
    close: {
        defaultMessage: 'Close',
        description: 'Label for the button that closes the symbol picker',
        id: 'paint.symbolPicker.close'
    },
    none: {
        defaultMessage: 'Nothing matches that.',
        description: 'Shown when a symbol search has no results',
        id: 'paint.symbolPicker.none'
    },
    use: {
        defaultMessage: 'Place a copy',
        description: 'Label for the button that places the chosen symbol and closes the picker',
        id: 'paint.symbolPicker.use'
    }
});
class SymbolPicker extends React.Component {
    constructor (props) { super(props); this.state = {query: ''}; this.handleQueryChange = this.handleQueryChange.bind(this); }
    handleQueryChange (event) { this.setState({query: event.target.value}); }
    render () {
        const query = this.state.query.trim().toLowerCase();
        const matches = query ?
            this.props.symbols.filter(symbol => symbol.name.toLowerCase().indexOf(query) !== -1) :
            this.props.symbols;
        return (
            <DimodDialog
                closeLabel={this.props.intl.formatMessage(messages$3.close)}
                footer={
                    <button
                        className={dialogStyles.primary}
                        disabled={!this.props.selectedSymbol}
                        onClick={this.props.onPlaceInstance}
                    >
                        {this.props.intl.formatMessage(messages$3.use)}
                    </button>
                }
                title={this.props.intl.formatMessage(messages$3.title)}
                onClose={this.props.onClose}
            >
                <input
                    autoFocus
                    className={styles$7.search}
                    placeholder={this.props.intl.formatMessage(messages$3.search)}
                    value={this.state.query}
                    onChange={this.handleQueryChange}
                />
                {matches.length === 0 ?
                    <p className={dialogStyles.none}>{this.props.intl.formatMessage(messages$3.none)}</p> :
                    <div className={styles$7.grid}>
                        {matches.map(symbol => (
                            <SymbolTile
                                key={symbol.id}
                                intl={this.props.intl}
                                selected={symbol.id === this.props.selectedSymbol}
                                symbol={symbol}
                                onRename={this.props.onRenameSymbol}
                                onSelect={this.props.onSelectSymbol}
                            />
                        ))}
                    </div>
                }
            </DimodDialog>
        );
    }
}
SymbolPicker.propTypes = {
    intl: intlShape.isRequired,
    onClose: PropTypes.func.isRequired,
    onPlaceInstance: PropTypes.func.isRequired,
    onRenameSymbol: PropTypes.func.isRequired,
    onSelectSymbol: PropTypes.func.isRequired,
    selectedSymbol: PropTypes.string,
    symbols: PropTypes.arrayOf(symbolShape).isRequired
};
const symbolPicker = injectIntl(SymbolPicker);
export {ActionButton, dimodSymbols as DimodSymbols, SCOPE_MESSAGES, SCOPE_ORDER, ScopeButton, symbolPicker as SymbolPicker, SymbolTile, VISIBLE_LIMIT, messages$4 as messages, symbolShape};
