import paper from '@turbowarp/paper';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {defineMessages, intlShape, injectIntl} from 'react-intl';
import bindAll from 'lodash.bindall';
import {getMinZoom, zoomOnFixedPoint, zoomToFit, resetZoom} from '../../helper/view';
import {isBitmap} from '../../lib/format';
import {updateViewBounds} from '../../reducers/view-bounds';
import {redrawSelectionBox} from '../../reducers/selected-items';
import {GRID_SIZES, setViewOption, Panels, setPanel} from '../../reducers/dimod';
import {setViewRotation, getRotation} from '../../dimod/items';
import styles from './dimod-view-controls.css';
import tiltIcon from './tilt.svg';
import gridIcon from './grid.svg';
import rulersIcon from './rulers.svg';
import boundlessIcon from './boundless.svg';
import layersIcon from './layers.svg';
import historyIcon from './history.svg';
import keyboardIcon from './keyboard.svg';
const SNAP_ANGLES = 45;
const SNAP_WITHIN = 6;
const SHIFT_STEP = 15;
const wrap = degrees => ((((degrees + 180) % 360) + 360) % 360) - 180;
const snap = (degrees, shift) => {
    if (shift) return Math.round(degrees / SHIFT_STEP) * SHIFT_STEP;
    const nearest = Math.round(degrees / SNAP_ANGLES) * SNAP_ANGLES;
    return Math.abs(degrees - nearest) <= SNAP_WITHIN ? nearest : Math.round(degrees);
};
class TiltWheel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleDown', 'handleMove', 'handleUp', 'handleWheel', 'handleLeft', 'handleRight',
            'handleReset', 'setRef']);
        this.wheelCarry = 0;
    }
    componentDidMount () { this.el.addEventListener('wheel', this.handleWheel, {passive: false}); }
    componentWillUnmount () { this.el.removeEventListener('wheel', this.handleWheel); this.handleUp(); }
    setRef (el) { this.el = el; }
    pointerAngle (event) {
        const r = this.el.getBoundingClientRect();
        return Math.atan2(event.clientY - (r.top + (r.height / 2)), event.clientX - (r.left + (r.width / 2))) *
            180 / Math.PI;
    }
    turnTo (degrees) { setViewRotation(wrap(degrees)); }
    handleDown (event) {
        event.preventDefault();
        this.drag = {pointer: this.pointerAngle(event), view: getRotation(), travel: 0, last: this.pointerAngle(event)};
        document.addEventListener('pointermove', this.handleMove);
        document.addEventListener('pointerup', this.handleUp);
    }
    handleMove (event) {
        const now = this.pointerAngle(event);
        let delta = now - this.drag.last;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        this.drag.last = now;
        this.drag.travel += delta;
        this.turnTo(snap(this.drag.view + this.drag.travel, event.shiftKey));
    }
    handleUp () {
        this.drag = null;
        document.removeEventListener('pointermove', this.handleMove);
        document.removeEventListener('pointerup', this.handleUp);
    }
    handleWheel (event) {
        event.preventDefault();
        const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (event.shiftKey) {
            const current = Math.round(getRotation() / SHIFT_STEP) * SHIFT_STEP;
            this.turnTo(current + (Math.sign(delta) * SHIFT_STEP));
            return;
        }
        this.wheelCarry += delta * (event.deltaMode === 1 ? 15 : 1) / 6;
        const whole = Math.trunc(this.wheelCarry);
        this.wheelCarry -= whole;
        if (whole) this.turnTo(Math.round(getRotation()) + whole);
    }
    handleLeft () { this.turnTo((Math.ceil(getRotation() / SHIFT_STEP) - 1) * SHIFT_STEP); }
    handleRight () { this.turnTo((Math.floor(getRotation() / SHIFT_STEP) + 1) * SHIFT_STEP); }
    handleReset () { this.turnTo(0); }
    render () {
        return (
            <div className={styles.tiltBody}>
                <div className={styles.tiltWheel} ref={this.setRef} title={this.props.title} onPointerDown={this.handleDown}>
                    {[0, 45, 90, 135, 180, 225, 270, 315].map(tick => (
                        <div className={styles.tiltTick} key={tick} style={{transform: `rotate(${tick}deg)`}} />
                    ))}
                    <div className={styles.tiltHand} style={{transform: `rotate(${this.props.angle}deg)`}} />
                    <span className={styles.tiltValue}>{`${this.props.angle}°`}</span>
                </div>
                <div className={styles.tiltButtons}>
                    <button className={styles.chip} title="-15°" onClick={this.handleLeft}>{'↺'}</button>
                    <button className={styles.chip} title={this.props.resetTitle} onClick={this.handleReset}>{'0°'}</button>
                    <button className={styles.chip} title="+15°" onClick={this.handleRight}>{'↻'}</button>
                </div>
            </div>
        );
    }
}
TiltWheel.propTypes = {
    angle: PropTypes.number.isRequired,
    resetTitle: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired
};
const messages = defineMessages({
    zoom: {defaultMessage: 'Zoom', description: 'Tooltip for the zoom percentage button', id: 'paint.viewControls.zoom'},
    fit: {defaultMessage: 'Fit to costume', description: 'Zoom so the whole costume fits', id: 'paint.viewControls.fit'},
    actual: {defaultMessage: 'Actual size', description: 'Zoom to 100%', id: 'paint.viewControls.actual'},
    grid: {defaultMessage: 'Grid', description: 'Toggle the canvas grid', id: 'paint.viewControls.grid'},
    gridSize: {defaultMessage: 'Grid size', description: 'Label for the grid spacing choices', id: 'paint.viewControls.gridSize'},
    boundless: {
        defaultMessage: 'Boundless canvas: pan and zoom out as far as you like (vector costumes)',
        description: 'Toggle that removes the limits on panning and zooming out in the costume editor',
        id: 'paint.viewControls.boundless'
    },
    boundlessBitmap: {
        defaultMessage: 'Boundless canvas only works on vector costumes',
        description: 'Tooltip on the boundless canvas toggle while editing a bitmap costume',
        id: 'paint.viewControls.boundlessBitmap'
    },
    rulers: {defaultMessage: 'Rulers', description: 'Toggle the canvas rulers', id: 'paint.viewControls.rulers'},
    snap: {
        defaultMessage: 'Snap to grid (hold Alt to place freely)',
        description: 'Checkbox in the grid menu',
        id: 'paint.viewControls.snap'
    },
    tilt: {
        defaultMessage: 'Tilt the view',
        description: 'Button that opens the wheel for turning the canvas view',
        id: 'paint.viewControls.tilt'
    },
    tiltWheel: {
        defaultMessage: 'Drag or scroll to tilt the view (Shift: 15° steps). The drawing is not changed.',
        description: 'Tooltip on the wheel that turns the canvas view',
        id: 'paint.viewControls.tiltWheel'
    },
    unturn: {
        defaultMessage: 'The view is turned (right-drag to turn it)... click to straighten',
        description: 'Button that resets the view rotation',
        id: 'paint.viewControls.unturn'
    },
    shortcuts: {
        defaultMessage: 'Keyboard shortcuts (?)',
        description: 'Button that shows every keyboard shortcut',
        id: 'paint.viewControls.shortcuts'
    },
    layers: {defaultMessage: 'Layers', description: 'Toggle the Layers panel', id: 'paint.viewControls.layers'},
    history: {defaultMessage: 'History', description: 'Toggle the History panel', id: 'paint.viewControls.history'}
});
const PRESETS = [50, 100, 200, 400, 800, 1600];
const MAX_PERCENT = 3200;
const toPercent = zoom => Math.round(zoom * 200);
const toZoom = percent => percent / 200;
class DimodViewControls extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleToggleZoom',
            'handleToggleGridMenu',
            'handleToggleBoundless',
            'handleToggleTilt',
            'handleClose',
            'handleZoomInput',
            'handleZoomKey',
            'handleFit',
            'handleActual',
            'handlePreset',
            'handleToggleGrid',
            'handleToggleRulers',
            'handleGridSize',
            'handleDocumentDown',
            'handlePanel',
            'handleToggleSnap',
            'setRef'
        ]);
        this.state = {menu: null, draft: ''};
    }
    componentWillUnmount () { document.removeEventListener('mousedown', this.handleDocumentDown, true); }
    open (menu) {
        this.setState({menu, draft: String(toPercent(paper.view ? paper.view.zoom : 0.5))});
        document.addEventListener('mousedown', this.handleDocumentDown, true);
    }
    handleClose () { this.setState({menu: null}); document.removeEventListener('mousedown', this.handleDocumentDown, true); }
    handleDocumentDown (event) {
        if (this.el && !this.el.contains(event.target)) this.handleClose();
    }
    handleToggleZoom () {
        if (this.state.menu === 'zoom') this.handleClose();
        else this.open('zoom');
    }
    handleToggleTilt () {
        if (this.state.menu === 'tilt') this.handleClose();
        else this.open('tilt');
    }
    handleToggleGridMenu (event) {
        event.preventDefault();
        if (this.state.menu === 'grid') this.handleClose();
        else this.open('grid');
    }
    setZoomPercent (percent) {
        const target = toZoom(Math.max(toPercent(getMinZoom()), Math.min(MAX_PERCENT, percent)));
        zoomOnFixedPoint(target - paper.view.zoom, paper.view.center);
        this.afterZoom();
    }
    afterZoom () { this.props.updateViewBounds(paper.view.matrix); this.props.redrawSelectionBox(); }
    handleZoomInput (event) { this.setState({draft: event.target.value}); }
    handleZoomKey (event) {
        if (event.key === 'Enter') {
            const value = parseFloat(this.state.draft);
            if (value > 0) this.setZoomPercent(value);
            this.handleClose();
        } else if (event.key === 'Escape') { this.handleClose(); }
    }
    handleFit () { zoomToFit(isBitmap(this.props.format)); this.afterZoom(); this.handleClose(); }
    handleActual () { resetZoom(); this.afterZoom(); this.handleClose(); }
    handlePreset (event) { this.setZoomPercent(Number(event.currentTarget.dataset.percent)); this.handleClose(); }
    handleToggleGrid () { this.props.setViewOption('grid', !this.props.grid); }
    handleToggleRulers () { this.props.setViewOption('rulers', !this.props.rulers); }
    handleGridSize (event) {
        this.props.setViewOption('gridSize', Number(event.currentTarget.dataset.size));
        this.props.setViewOption('grid', true);
        this.handleClose();
    }
    handleToggleBoundless () { this.props.setViewOption('boundless', !this.props.boundless); this.afterZoom(); }
    handleToggleSnap () { this.props.setViewOption('snap', !this.props.snap); }
    handleUnturn (event) {
        if (event) event.preventDefault();
        setViewRotation(0);
    }
    handleShortcuts () { document.dispatchEvent(new CustomEvent('dimod-paint-shortcuts')); }
    handlePanel (event) {
        const panel = event.currentTarget.dataset.panel;
        this.props.setPanel(this.props.panel === panel ? null : panel);
    }
    setRef (el) { this.el = el; }
    render () {
        const f = this.props.intl.formatMessage;
        const m = this.props.viewBounds;
        const zoom = m ? Math.hypot(m.a, m.b) : 0.5;
        const turn = m ? Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) : 0;
        return (
            <div className={styles.controls} ref={this.setRef}>
                <div className={styles.group}>
                    {this.props.gridAddon ? [<button
                        key="grid"
                        className={classNames(styles.button, {[styles.active]: this.props.grid})}
                        title={`${f(messages.grid)} (${this.props.gridSize})`}
                        onClick={this.handleToggleGrid}
                        onContextMenu={this.handleToggleGridMenu}
                    >
                        <img className={styles.icon} draggable={false} src={gridIcon} />
                    </button>,
                    <button
                        key="caret"
                        className={classNames(styles.button, styles.caret)}
                        title={f(messages.gridSize)}
                        onClick={this.handleToggleGridMenu}
                    >
                        <span className={styles.caretArrow} />
                    </button>] : null}
                    <button
                        className={classNames(styles.button, {[styles.active]: this.props.rulers})}
                        title={f(messages.rulers)}
                        onClick={this.handleToggleRulers}
                    >
                        <img className={styles.icon} draggable={false} src={rulersIcon} />
                    </button>
                    <button
                        className={classNames(styles.button, {
                            [styles.active]: this.props.boundless && !isBitmap(this.props.format)
                        })}
                        disabled={isBitmap(this.props.format)}
                        title={f(isBitmap(this.props.format) ? messages.boundlessBitmap : messages.boundless)}
                        onClick={this.handleToggleBoundless}
                    >
                        <img className={styles.icon} draggable={false} src={boundlessIcon} />
                    </button>
                    <button
                        className={classNames(styles.button, {[styles.active]: this.props.panel === Panels.LAYERS})}
                        data-panel={Panels.LAYERS}
                        title={f(messages.layers)}
                        onClick={this.handlePanel}
                    >
                        <img className={styles.icon} draggable={false} src={layersIcon} />
                    </button>
                    <button
                        className={classNames(styles.button, {[styles.active]: this.props.panel === Panels.HISTORY})}
                        data-panel={Panels.HISTORY}
                        title={f(messages.history)}
                        onClick={this.handlePanel}
                    >
                        <img className={styles.icon} draggable={false} src={historyIcon} />
                    </button>
                    <button className={styles.button} title={f(messages.shortcuts)} onClick={this.handleShortcuts}>
                        <img className={styles.icon} draggable={false} src={keyboardIcon} />
                    </button>
                </div>
                <div className={styles.tiltAnchor}>
                    <button
                        className={classNames(styles.button, {[styles.active]: turn !== 0})}
                        title={f(messages.tilt)}
                        onClick={this.handleToggleTilt}
                        onContextMenu={turn ? this.handleUnturn : null}
                    >
                        <img
                            className={classNames(styles.icon, styles.tiltIcon)}
                            draggable={false}
                            src={tiltIcon}
                            style={{transform: `rotate(${turn}deg)`}}
                        />
                        {turn ? <span className={styles.tiltBadge}>{`${turn}°`}</span> : null}
                    </button>
                    {this.state.menu === 'tilt' ? (
                        <div className={classNames(styles.menu, styles.menuGrid, styles.menuTilt)}>
                            <TiltWheel angle={turn} resetTitle={f(messages.unturn)} title={f(messages.tiltWheel)} />
                        </div>
                    ) : null}
                </div>
                <button
                    className={classNames(styles.button, styles.zoom)}
                    title={f(messages.zoom)}
                    onClick={this.handleToggleZoom}
                >
                    {`${toPercent(zoom)}%`}
                </button>
                {this.state.menu === 'zoom' ? (
                    <div className={classNames(styles.menu, styles.menuGrid, styles.menuZoom)}>
                        <input
                            autoFocus
                            className={styles.input}
                            type="number"
                            value={this.state.draft}
                            onChange={this.handleZoomInput}
                            onKeyDown={this.handleZoomKey}
                        />
                        <button className={styles.item} onClick={this.handleFit}>{f(messages.fit)}</button>
                        <button className={styles.item} onClick={this.handleActual}>{f(messages.actual)}</button>
                        <div className={styles.presets}>
                            {PRESETS.map(percent => (
                                <button
                                    className={classNames(styles.chip, {[styles.chipActive]: toPercent(zoom) === percent})}
                                    data-percent={percent}
                                    key={percent}
                                    onClick={this.handlePreset}
                                >{`${percent}%`}</button>
                            ))}
                        </div>
                    </div>
                ) : null}
                {this.state.menu === 'grid' && this.props.gridAddon ? (
                    <div className={classNames(styles.menu, styles.menuGrid)}>
                        <label className={styles.menuGridLine}>
                            {f(messages.snap)}
                            <input checked={this.props.snap} type="checkbox" onChange={this.handleToggleSnap} />
                        </label>
                        <div className={styles.menuGridLine}>
                            {f(messages.gridSize)}
                            <div className={styles.presets}>
                                {GRID_SIZES.map(size => (
                                    <button
                                        className={classNames(styles.chip, {[styles.chipActive]: this.props.gridSize === size})}
                                        data-size={size}
                                        key={size}
                                        onClick={this.handleGridSize}
                                    >{size}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }
}
DimodViewControls.propTypes = {
    boundless: PropTypes.bool,
    format: PropTypes.string,
    grid: PropTypes.bool,
    gridAddon: PropTypes.bool,
    gridSize: PropTypes.number,
    intl: intlShape.isRequired,
    redrawSelectionBox: PropTypes.func.isRequired,
    panel: PropTypes.string,
    rulers: PropTypes.bool,
    snap: PropTypes.bool,
    setPanel: PropTypes.func.isRequired,
    setViewOption: PropTypes.func.isRequired,
    updateViewBounds: PropTypes.func.isRequired,
    viewBounds: PropTypes.instanceOf(paper.Matrix)
};
const mapStateToProps = state => ({
    boundless: state.scratchPaint.dimodView.boundless,
    format: state.scratchPaint.format,
    grid: state.scratchPaint.dimodView.grid,
    gridAddon: state.scratchPaint.dimodView.gridAddon,
    gridSize: state.scratchPaint.dimodView.gridSize,
    panel: state.scratchPaint.dimodPanels.open,
    rulers: state.scratchPaint.dimodView.rulers,
    snap: state.scratchPaint.dimodView.snap,
    viewBounds: state.scratchPaint.viewBounds
});
const mapDispatchToProps = dispatch => ({
    redrawSelectionBox: () => dispatch(redrawSelectionBox()),
    setPanel: panel => dispatch(setPanel(panel)),
    setViewOption: (key, value) => dispatch(setViewOption(key, value)),
    updateViewBounds: matrix => dispatch(updateViewBounds(matrix))
});
const dimodViewControls = connect(mapStateToProps, mapDispatchToProps)(injectIntl(DimodViewControls));
export {dimodViewControls as DimodViewControls, TiltWheel};
