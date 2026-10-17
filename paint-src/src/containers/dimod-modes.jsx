import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';
import {defineMessages} from 'react-intl';
import Modes, {VectorModes, BitmapModes} from '../lib/modes';
import {changeMode} from '../reducers/modes';
import {setSelectedItems, clearSelectedItems} from '../reducers/selected-items';
import {getSelectedLeafItems, clearSelection} from '../helper/selection';
import {DimodGradientTool, HandTool, MirrorTool, DimodPolygonTool} from '../helper/tools/dimod-tools';
import ToolSelectComponent from '../components/tool-select-base/tool-select-base.jsx';
import gradientIcon from '../components/dimod-gradient-mode/gradient.svg';
import gradientPixelIcon from '../components/dimod-pixel-icons/gradient.svg';
import {setCursor} from '../reducers/cursor';
import {updateViewBounds} from '../reducers/view-bounds';
import {DimodHandModeComponent} from '../components/dimod-widgets.jsx';
import {
    setMirrorRadial,
    setMirrorLines,
    selectMirrorLine,
    setMirrorEnabled,
    setSelectStyle,
    setWandTolerance,
    setWandMatch,
    setViewOption,
    setBrushOption,
    setPanel,
    syncSymbols,
    selectSymbol,
    setSymbolPickerOpen
} from '../reducers/dimod';
import mirrorIcon from '../components/dimod-mirror-mode/mirror.svg';
import mirrorPixelIcon from '../components/dimod-pixel-icons/mirror.svg';
import polygonIcon from '../components/dimod-polygon-mode/polygon.svg';
import bitPolygonIcon from '../components/dimod-polygon-mode/polygon-pixel.svg';
import lassoIcon from '../components/dimod-polygon-mode/lasso-shape.svg';
import bitLassoIcon from '../components/dimod-polygon-mode/lasso-shape-pixel.svg';
import Formats, {isBitmap, isVector} from '../lib/format';
import {loadSettings, saveSettings} from '../dimod/core';
import {changeBrushSize, changeSimplifySize, setBrushType} from '../reducers/brush-mode';
import {changeBrushSize as changeBrushSize$1, changeSimplifySize as changeSimplifySize$1} from '../reducers/eraser-mode';
import {changeBitBrushSize} from '../reducers/bit-brush-size';
import {changeBitEraserSize} from '../reducers/bit-eraser-size';
import paper from '@turbowarp/paper';
import {SymbolPicker as SymbolPickerComponent} from '../components/dimod-widgets.jsx';
import {placeInstance, renameSymbol} from '../dimod/items';
import {getPaintingLayer, runPass} from '../dimod/store';
import {CENTER} from '../helper/view';
const messages$2 = defineMessages({
    gradient: {
        defaultMessage: 'Gradient',
        description: 'Label for the tool that drags out a gradient',
        id: 'paint.gradientMode.gradient'
    }
});
let fillState = {primary: null, secondary: null, gradientType: 'SOLID'};
class DimodGradientMode extends React.Component {
    constructor (props) { super(props); bindAll(this, ['activateTool', 'deactivateTool']); }
    componentDidMount () {
        if (this.props.isActive) this.activateTool();
    }
    componentWillReceiveProps (nextProps) {
        if (nextProps.isActive && !this.props.isActive) this.activateTool();
        else if (!nextProps.isActive && this.props.isActive) this.deactivateTool();
    }
    shouldComponentUpdate (nextProps) { return nextProps.isActive !== this.props.isActive; }
    componentWillUnmount () {
        if (this.tool) this.deactivateTool();
    }
    activateTool () {
        this.tool = new DimodGradientTool(
            Boolean(this.props.isBitmap),
            () => fillState,
            this.props.onUpdateImage,
            this.props.setSelectedItems
        );
        this.tool.activate();
    }
    deactivateTool () { this.tool.deactivateTool(); this.tool.remove(); this.tool = null; }
    render () {
        return (
            <ToolSelectComponent
                imgDescriptor={messages$2.gradient}
                imgSrc={this.props.isBitmap ? gradientPixelIcon : gradientIcon}
                isSelected={this.props.isActive}
                keybinding="G"
                onMouseDown={this.props.onPick}
            />
        );
    }
}
DimodGradientMode.propTypes = {
    isActive: PropTypes.bool.isRequired,
    isBitmap: PropTypes.bool,
    onPick: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired
};
const modeFor$3 = ownProps => {
    if (ownProps.isBitmap) return Modes.BIT_GRADIENT;
    return Modes.GRADIENT;
};
const mapStateToProps$5 = (state, ownProps) => {
    fillState = state.scratchPaint.color.fillColor;
    return {isActive: state.scratchPaint.mode === modeFor$3(ownProps)};
};
const mapDispatchToProps$4 = (dispatch, ownProps) => ({
    onPick: () => dispatch(changeMode(modeFor$3(ownProps))),
    setSelectedItems: () => dispatch(setSelectedItems(getSelectedLeafItems(), Boolean(ownProps.isBitmap)))
});
const dimodGradientMode = connect(mapStateToProps$5, mapDispatchToProps$4)(DimodGradientMode);
class DimodHandMode extends React.Component {
    constructor (props) { super(props); bindAll(this, ['activateTool', 'deactivateTool']); }
    componentDidMount () {
        if (this.props.isActive) this.activateTool();
    }
    componentWillReceiveProps (nextProps) {
        if (nextProps.isActive && !this.props.isActive) {
            this.activateTool();
        } else if (!nextProps.isActive && this.props.isActive) { this.deactivateTool(); }
    }
    shouldComponentUpdate (nextProps) { return nextProps.isActive !== this.props.isActive; }
    componentWillUnmount () {
        if (this.tool) this.deactivateTool();
    }
    activateTool () {
        clearSelection(this.props.clearSelectedItems);
        this.tool = new HandTool(this.props.setCursor, this.props.updateViewBounds);
        this.tool.activate();
    }
    deactivateTool () { this.tool.deactivateTool(); this.tool.remove(); this.tool = null; }
    render () {
        return (
            <DimodHandModeComponent
                isBitmap={this.props.isBitmap}
                isSelected={this.props.isActive}
                onMouseDown={this.props.onPick}
            />
        );
    }
}
DimodHandMode.propTypes = {
    clearSelectedItems: PropTypes.func.isRequired,
    isActive: PropTypes.bool.isRequired,
    isBitmap: PropTypes.bool,
    onPick: PropTypes.func.isRequired,
    setCursor: PropTypes.func.isRequired,
    updateViewBounds: PropTypes.func.isRequired
};
const modeFor$2 = ownProps => {
    if (ownProps.isBitmap) return Modes.BIT_HAND;
    return Modes.HAND;
};
const mapStateToProps$4 = (state, ownProps) => ({isActive: state.scratchPaint.mode === modeFor$2(ownProps)});
const mapDispatchToProps$3 = (dispatch, ownProps) => ({
    clearSelectedItems: () => dispatch(clearSelectedItems()),
    setCursor: cursor => dispatch(setCursor(cursor)),
    updateViewBounds: matrix => dispatch(updateViewBounds(matrix)),
    onPick: () => dispatch(changeMode(modeFor$2(ownProps)))
});
const dimodHandMode = connect(mapStateToProps$4, mapDispatchToProps$3)(DimodHandMode);
const messages$1 = defineMessages({
    mirror: {
        defaultMessage: 'Mirror',
        description: 'Label for the tool that places mirror lines for symmetric drawing',
        id: 'paint.mirrorMode.mirror'
    }
});
class DimodMirrorMode extends React.Component {
    constructor (props) { super(props); bindAll(this, ['activateTool', 'deactivateTool', 'getSelected']); }
    componentDidMount () {
        if (this.props.isActive) this.activateTool();
    }
    componentWillReceiveProps (nextProps) {
        if (nextProps.isActive && !this.props.isActive) this.activateTool();
        else if (!nextProps.isActive && this.props.isActive) this.deactivateTool();
    }
    shouldComponentUpdate (nextProps) { return nextProps.isActive !== this.props.isActive; }
    componentWillUnmount () {
        if (this.tool) this.deactivateTool();
    }
    getSelected () { return this.props.getSelected(); }
    activateTool () {
        clearSelection(this.props.clearSelectedItems);
        this.tool = new MirrorTool(this.props.setLines, this.props.selectLine, this.getSelected,
            this.props.setCursor, this.props.setRadial);
        this.tool.activate();
    }
    deactivateTool () {
        this.tool.deactivateTool();
        this.tool.remove();
        this.tool = null;
        this.props.selectLine(-1);
    }
    render () {
        return (
            <ToolSelectComponent
                imgDescriptor={messages$1.mirror}
                imgSrc={this.props.isBitmap ? mirrorPixelIcon : mirrorIcon}
                isSelected={this.props.isActive}
                keybinding="M"
                onMouseDown={this.props.onPick}
            />
        );
    }
}
DimodMirrorMode.propTypes = {
    clearSelectedItems: PropTypes.func.isRequired,
    getSelected: PropTypes.func.isRequired,
    isActive: PropTypes.bool.isRequired,
    isBitmap: PropTypes.bool,
    onPick: PropTypes.func.isRequired,
    selectLine: PropTypes.func.isRequired,
    setCursor: PropTypes.func.isRequired,
    setLines: PropTypes.func.isRequired,
    setRadial: PropTypes.func.isRequired
};
const modeFor$1 = ownProps => {
    if (ownProps.isBitmap) return Modes.BIT_MIRROR;
    return Modes.MIRROR;
};
let selectedIndex = -1;
const mapStateToProps$3 = (state, ownProps) => {
    selectedIndex = state.scratchPaint.dimodMirror.selected;
    return {isActive: state.scratchPaint.mode === modeFor$1(ownProps)};
};
const mapDispatchToProps$2 = (dispatch, ownProps) => ({
    clearSelectedItems: () => dispatch(clearSelectedItems()),
    getSelected: () => selectedIndex,
    selectLine: index => dispatch(selectMirrorLine(index)),
    setCursor: cursor => dispatch(setCursor(cursor)),
    setLines: lines => dispatch(setMirrorLines(lines)),
    setRadial: radial => dispatch(setMirrorRadial(radial)),
    onPick: () => dispatch(changeMode(modeFor$1(ownProps)))
});
const dimodMirrorMode = connect(mapStateToProps$3, mapDispatchToProps$2)(DimodMirrorMode);
const messages = defineMessages({
    polygon: {
        defaultMessage: 'Polygon',
        description: 'Label for the tool that draws a shape corner by corner',
        id: 'paint.polygonMode.polygon'
    },
    lassoShape: {
        defaultMessage: 'Lasso Shape',
        description: 'Label for the tool that draws a filled shape by dragging round its outline',
        id: 'paint.polygonMode.lassoShape'
    }
});
class DimodPolygonMode extends React.Component {
    constructor (props) { super(props); bindAll(this, ['activateTool', 'deactivateTool']); }
    componentDidMount () {
        if (this.props.isActive) this.activateTool();
    }
    componentWillReceiveProps (nextProps) {
        if (this.tool) {
            if (nextProps.colorState !== this.props.colorState) this.tool.setColorState(nextProps.colorState);
            this.tool.setBitmapOptions(nextProps.colorState.fillColor.primary, nextProps.filled, nextProps.thickness);
        }
        if (nextProps.isActive && !this.props.isActive) this.activateTool(nextProps);
        else if (!nextProps.isActive && this.props.isActive) this.deactivateTool();
    }
    shouldComponentUpdate (nextProps) { return nextProps.isActive !== this.props.isActive; }
    componentWillUnmount () {
        if (this.tool) this.deactivateTool();
    }
    activateTool (props = this.props) {
        this.tool = new DimodPolygonTool(Boolean(props.isBitmap), {
            clearSelectedItems: props.clearSelectedItems,
            onUpdateImage: props.onUpdateImage,
            setSelectedItems: props.setSelectedItems
        }, props.lasso);
        this.tool.setColorState(props.colorState);
        this.tool.setBitmapOptions(props.colorState.fillColor.primary, props.filled, props.thickness);
        this.tool.activate();
    }
    deactivateTool () { this.tool.deactivateTool(); this.tool.remove(); this.tool = null; }
    render () {
        return (
            <ToolSelectComponent
                imgDescriptor={this.props.lasso ? messages.lassoShape : messages.polygon}
                imgSrc={this.props.lasso ?
                    (this.props.isBitmap ? bitLassoIcon : lassoIcon) :
                    (this.props.isBitmap ? bitPolygonIcon : polygonIcon)}
                isSelected={this.props.isActive}
                onMouseDown={this.props.onPick}
            />
        );
    }
}
DimodPolygonMode.propTypes = {
    clearSelectedItems: PropTypes.func.isRequired,
    colorState: PropTypes.object.isRequired,
    filled: PropTypes.bool,
    isActive: PropTypes.bool.isRequired,
    isBitmap: PropTypes.bool,
    lasso: PropTypes.bool,
    onPick: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired,
    thickness: PropTypes.number
};
const modeFor = ownProps => {
    if (ownProps.lasso) return ownProps.isBitmap ? Modes.BIT_LASSO_SHAPE : Modes.LASSO_SHAPE;
    if (ownProps.isBitmap) return Modes.BIT_POLYGON;
    return Modes.POLYGON;
};
const mapStateToProps$2 = (state, ownProps) => ({
    colorState: state.scratchPaint.color,
    filled: state.scratchPaint.fillBitmapShapes,
    isActive: state.scratchPaint.mode === modeFor(ownProps),
    thickness: state.scratchPaint.bitBrushSize
});
const mapDispatchToProps$1 = (dispatch, ownProps) => ({
    clearSelectedItems: () => dispatch(clearSelectedItems()),
    onPick: () => dispatch(changeMode(modeFor(ownProps))),
    setSelectedItems: () => dispatch(setSelectedItems(getSelectedLeafItems(), Boolean(ownProps.isBitmap)))
});
const dimodPolygonMode = connect(mapStateToProps$2, mapDispatchToProps$1)(DimodPolygonMode);
const ENTRIES = [
    ['brushSize', s => s.brushMode.brushSize, v => changeBrushSize(v)],
    ['brushSimplify', s => s.brushMode.simplifySize, v => changeSimplifySize(v)],
    ['brushType', s => s.brushMode.brushType, v => setBrushType(v)],
    ['eraserSize', s => s.eraserMode.brushSize, v => changeBrushSize$1(v)],
    ['eraserSimplify', s => s.eraserMode.simplifySize, v => changeSimplifySize$1(v)],
    ['bitBrushSize', s => s.bitBrushSize, v => changeBitBrushSize(v)],
    ['bitEraserSize', s => s.bitEraserSize, v => changeBitEraserSize(v)],
    ['selectStyle', s => s.dimodSelectStyle.style, v => setSelectStyle(v)],
    ['wandTolerance', s => s.dimodSelectStyle.tolerance, v => setWandTolerance(v)],
    ['wandMatch', s => s.dimodSelectStyle.match, v => setWandMatch(v)],
    ['grid', s => s.dimodView.grid, v => setViewOption('grid', v)],
    ['gridSize', s => s.dimodView.gridSize, v => setViewOption('gridSize', v)],
    ['rulers', s => s.dimodView.rulers, v => setViewOption('rulers', v)],
    ['snap', s => s.dimodView.snap, v => setViewOption('snap', v)],
    ['boundless', s => s.dimodView.boundless, v => setViewOption('boundless', v)],
    ['brushPreset', s => s.dimodBrush.preset, v => setBrushOption('preset', v)],
    ['bitBrushPreset', s => s.dimodBrush.bitPreset, v => setBrushOption('bitPreset', v)],
    ['pressure', s => s.dimodBrush.pressure, v => setBrushOption('pressure', v)],
    ['taper', s => s.dimodBrush.taper, v => setBrushOption('taper', v)],
    ['gradientDither', s => s.dimodBrush.gradientDither, v => setBrushOption('gradientDither', v)],
    ['mirrorLines', s => s.dimodMirror.lines, v => setMirrorLines(v)],
    ['mirrorOn', s => s.dimodMirror.enabled, v => setMirrorEnabled(v)],
    ['mirrorRadial', s => s.dimodMirror.radial, v => setMirrorRadial(v)],
    ['fillTolerance', s => s.dimodBrush.fillTolerance, v => setBrushOption('fillTolerance', v)],
    ['effectSize', s => s.dimodBrush.effectSize, v => setBrushOption('effectSize', v)],
    ['sprayDensity', s => s.dimodBrush.sprayDensity, v => setBrushOption('sprayDensity', v)],
    ['lineProfile', s => s.dimodBrush.lineProfile, v => setBrushOption('lineProfile', v)],
    ['lineStyle', s => s.dimodBrush.lineStyle, v => setBrushOption('lineStyle', v)],
    ['lassoSmoothing', s => s.dimodBrush.lassoSmoothing, v => setBrushOption('lassoSmoothing', v)],
    ['panel', s => s.dimodPanels.open, v => setPanel(v)]
];
class DimodSettingsSync extends React.Component {
    componentDidMount () {
        const saved = loadSettings();
        for (const [key, , restore] of ENTRIES) {
            if (key in saved && saved[key] !== null && typeof saved[key] !== 'undefined') {
                this.props.dispatch(restore(saved[key]));
            }
        }
        this.restoreMode(saved);
        this.restored = true;
    }
    componentDidUpdate (prevProps) {
        if (!this.restored) return;
        const changed = {};
        for (const [key, select] of ENTRIES) {
            const value = select(this.props.paint);
            if (value !== select(prevProps.paint)) changed[key] = value;
        }
        const mode = this.props.paint.mode;
        if (mode !== prevProps.paint.mode) {
            if (mode in VectorModes) changed.vectorMode = mode;
            if (mode in BitmapModes) changed.bitmapMode = mode;
        }
        if (Object.keys(changed).length) saveSettings(changed);
    }
    restoreMode (saved) {
        const format = this.props.paint.format;
        const mode = isBitmap(format) ? saved.bitmapMode : isVector(format) ? saved.vectorMode : null;
        if (!mode || !(mode in Modes)) return;
        if (isBitmap(format) && !(mode in BitmapModes)) return;
        if (isVector(format) && !(mode in VectorModes)) return;
        if (mode !== this.props.paint.mode) this.props.dispatch(changeMode(mode));
    }
    render () { return null; }
}
DimodSettingsSync.propTypes = {dispatch: PropTypes.func.isRequired, paint: PropTypes.object.isRequired};
const mapStateToProps$1 = state => ({paint: state.scratchPaint});
const dimodSettingsSync = connect(mapStateToProps$1)(DimodSettingsSync);
class DimodSymbolPicker extends React.Component {
    constructor (props) { super(props); bindAll(this, ['handlePlace', 'handleRename']); }
    handlePlace () {
        if (!this.props.selectedSymbol) return;
        const layer = getPaintingLayer() || paper.project.activeLayer;
        const existing = layer.children.length;
        const offset = new paper.Point((existing % 6) * 12, (existing % 6) * 12);
        const instance = placeInstance(this.props.selectedSymbol, CENTER.add(offset), layer);
        if (!instance) return;
        this.props.clearSelectedItems();
        instance.selected = true;
        runPass();
        this.props.onSyncSymbols();
        this.props.setSelectedItems(this.props.format);
        this.props.onUpdateImage();
        this.props.onClose();
    }
    handleRename (symbolId, name) {
        if (!renameSymbol(symbolId, name)) return;
        this.props.onSyncSymbols();
        this.props.onUpdateImage();
    }
    render () {
        if (!this.props.open) return null;
        return (
            <SymbolPickerComponent
                selectedSymbol={this.props.selectedSymbol}
                symbols={this.props.symbols}
                onClose={this.props.onClose}
                onPlaceInstance={this.handlePlace}
                onRenameSymbol={this.handleRename}
                onSelectSymbol={this.props.onSelectSymbol}
            />
        );
    }
}
DimodSymbolPicker.propTypes = {
    clearSelectedItems: PropTypes.func.isRequired,
    format: PropTypes.oneOf(Object.keys(Formats)),
    onClose: PropTypes.func.isRequired,
    onSelectSymbol: PropTypes.func.isRequired,
    onSyncSymbols: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    open: PropTypes.bool,
    selectedSymbol: PropTypes.string,
    setSelectedItems: PropTypes.func.isRequired,
    symbols: PropTypes.arrayOf(PropTypes.shape({id: PropTypes.string.isRequired})).isRequired
};
const mapStateToProps = state => ({
    format: state.scratchPaint.format,
    open: state.scratchPaint.dimodSymbols.pickerOpen,
    selectedSymbol: state.scratchPaint.dimodSymbols.selected,
    symbols: state.scratchPaint.dimodSymbols.symbols
});
const mapDispatchToProps = dispatch => ({
    clearSelectedItems: () => { dispatch(clearSelectedItems()); },
    onClose: () => { dispatch(setSymbolPickerOpen(false)); },
    onSelectSymbol: symbolId => { dispatch(selectSymbol(symbolId)); },
    onSyncSymbols: () => { dispatch(syncSymbols()); },
    setSelectedItems: format => { dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format))); }
});
const dimodSymbolPicker = connect(mapStateToProps, mapDispatchToProps)(DimodSymbolPicker);
export {dimodGradientMode as DimodGradientMode, dimodHandMode as DimodHandMode, dimodMirrorMode as DimodMirrorMode, dimodPolygonMode as DimodPolygonMode, dimodSettingsSync as DimodSettingsSync, dimodSymbolPicker as DimodSymbolPicker, messages$2 as gradientMessages, messages$1 as mirrorMessages, messages as polygonMessages};
