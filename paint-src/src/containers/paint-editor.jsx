import paper from '@turbowarp/paper';
import PropTypes from 'prop-types';
import log from '../log/log';
import React from 'react';
import {connect} from 'react-redux';

import PaintEditorComponent from '../components/paint-editor/paint-editor.jsx';
import KeyboardShortcutsHOC from '../hocs/keyboard-shortcuts-hoc.jsx';
import SelectionHOC from '../hocs/selection-hoc.jsx';
import UndoHOC from '../hocs/undo-hoc.jsx';
import UpdateImageHOC from '../hocs/update-image-hoc.jsx';

import {changeMode} from '../reducers/modes';
import {changeFormat} from '../reducers/format';
import {clearSelectedItems, setSelectedItems} from '../reducers/selected-items';
import {deactivateEyeDropper} from '../reducers/eye-dropper';
import {changeFillColor, changeFillColor2, changeFillGradientType} from '../reducers/fill-style';
import {changeStrokeColor, changeStrokeGradientType} from '../reducers/stroke-style';
import {changeStrokeWidth} from '../reducers/stroke-width';
import {setTextEditTarget} from '../reducers/text-edit-target';
import {updateViewBounds} from '../reducers/view-bounds';
import {setLayout} from '../reducers/layout';
import {setTheme as setReduxTheme} from '../reducers/theme';
import {setCustomFonts} from '../reducers/custom-fonts';

import {getSelectedLeafItems} from '../helper/selection';
import {getRaster} from '../helper/layer';
import {convertToBitmap, convertToVector} from '../helper/bitmap';
import {resizeView, resetZoom, zoomOnSelection, OUTERMOST_ZOOM_LEVEL} from '../helper/view';
import EyeDropperTool from '../helper/tools/eye-dropper';
import EyeDropperStyles from '../lib/eye-dropper-styles';
import {
    applyStyleToSelection,
    setSpriteScope,
    installViewGestures,
    installGridSnap,
    installMirrorApply
} from '../dimod/items';
import {
    beginGesture,
    endGesture,
    isTrackingGesture,
    sendLocalCursor,
    setCollabHost,
    setLocalTool,
    shouldSampleCursor,
    trackGesturePoint
} from '../dimod/collab';
import {syncSymbols} from '../reducers/dimod';
import {setHistoryMode} from '../dimod/core';
import {startSymbolSync, stopSymbolSync} from '../dimod/items';
import {installRenderCache, installLevelOfDetail} from '../dimod/render';
import {LIVETEST} from '../lib/dimod-flags';

import Modes, {BitmapModes, VectorModes} from '../lib/modes';
import Formats, {isBitmap, isVector} from '../lib/format';
import GradientTypes from '../lib/gradient-types';
import bindAll from 'lodash.bindall';
import {isPaintSuspended} from '../lib/dimod-flags';

window.paper = paper;

/**
 * The top-level paint editor component. See README for more details on usage.
 *
 * <PaintEditor
 *     image={optionalImage}
 *     imageId={optionalId}
 *     imageFormat='svg'
 *     rotationCenterX={optionalCenterPointX}
 *     rotationCenterY={optionalCenterPointY}
 *     rtl={true|false}
 *     onUpdateImage={handleUpdateImageFunction}
 *     zoomLevelId={optionalZoomLevelId}
 * />
 *
 * `image`: may either be nothing, an SVG string or a base64 data URI)
 * SVGs of up to size 480 x 360 will fit into the view window of the paint editor,
 * while bitmaps of size up to 960 x 720 will fit into the paint editor. One unit
 * of an SVG will appear twice as tall and wide as one unit of a bitmap. This quirky
 * import behavior comes from needing to support legacy projects in Scratch.
 *
 * `imageId`: If this parameter changes, then the paint editor will be cleared, the
 * undo stack reset, and the image re-imported.
 *
 * `imageFormat`: 'svg', 'png', or 'jpg'. Other formats are currently not supported.
 *
 * `rotationCenterX`: x coordinate relative to the top left corner of the sprite of
 * the point that should be centered.
 *
 * `rotationCenterY`: y coordinate relative to the top left corner of the sprite of
 * the point that should be centered.
 *
 * `rtl`: True if the paint editor should be laid out right to left (meant for right
 * to left languages)
 *
 * `onUpdateImage`: A handler called with the new image (either an SVG string or an
 * ImageData) each time the drawing is edited.
 *
 * `zoomLevelId`: All costumes with the same zoom level ID will share the same saved
 * zoom level. When a new zoom level ID is encountered, the paint editor will zoom to
 * fit the current costume comfortably. Leave undefined to perform no zoom to fit.
 */
const CANVAS_KEY = 'dimod:canvas-theme';
const readCanvasTheme = () => {
    try {
        const value = localStorage.getItem(CANVAS_KEY);
        return value === 'light' || value === 'dark' ? value : 'default';
    } catch (e) {
        return 'default';
    }
};
const writeCanvasTheme = value => {
    try {
        localStorage.setItem(CANVAS_KEY, value);
    } catch (e) {
    }
    window.dispatchEvent(new Event('dimod-canvas-theme'));
};

class PaintEditor extends React.Component {
    static get ZOOM_INCREMENT () {
        return 0.5;
    }
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleDocumentKeyDown',
            'handleDocumentPaste',
            'switchModeForFormat',
            'onMouseDown',
            'onMouseMove',
            'onMouseUp',
            'setCanvas',
            'setTextArea',
            'startEyeDroppingLoop',
            'stopEyeDroppingLoop',
            'handlePickStyle',
            'handleSetSelectedItems',
            'handleChangeTheme',
            'handleZoomIn',
            'handleZoomOut',
            'handleZoomReset'
        ]);
        this.state = {
            canvas: null,
            colorInfo: null
        };
        this.props.setLayout(this.props.rtl ? 'rtl' : 'ltr');
        this.props.onCustomFontsChanged(this.props.customFonts);
        resizeView(this.props.width, this.props.height);
    }
    componentDidMount () {
        this.syncCanvasTheme = () => {
            const pref = readCanvasTheme();
            const next = pref === this.props.theme ? 'default' : pref;
            if (next !== this.props.reduxTheme) this.props.setReduxTheme(next);
        };
        this.syncCanvasTheme();
        window.addEventListener('dimod-canvas-theme', this.syncCanvasTheme);
        startSymbolSync(() => this.props.onUpdateImage());
        if (setSpriteScope(this.props.spriteId)) this.props.onSyncSymbols();
        document.addEventListener('keydown', this.handleDocumentKeyDown);
        document.addEventListener('paste', this.handleDocumentPaste);

        // document listeners used to detect if a mouse is down outside of the
        // canvas, and should therefore stop the eye dropper
        document.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('touchstart', this.onMouseDown);
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('touchend', this.onMouseUp);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('touchmove', this.onMouseMove);
        setCollabHost({
            updateImage: () => this.props.onUpdateImage(true )
        });
        setLocalTool(this.props.mode);
        setHistoryMode(this.props.mode);
        if (LIVETEST) {
            this.uninstallRenderCache = installRenderCache(() => this.props.mode);
            installGridSnap(() => this.props.mode);
            installLevelOfDetail();
            this.uninstallMirrorApply = installMirrorApply(() => this.props.mode);
            this.uninstallViewGestures = installViewGestures({
                onViewChanged: () => {
                    this.props.updateViewBounds(paper.view.matrix);
                    this.handleSetSelectedItems();
                },
                undo: () => this.props.onUndo(),
                redo: () => this.props.onRedo(),
                setRotationBadge: () => null
            });
        }
    }
    componentWillReceiveProps (newProps) {
        if (!isBitmap(this.props.format) && isBitmap(newProps.format)) {
            this.switchModeForFormat(Formats.BITMAP);
        } else if (!isVector(this.props.format) && isVector(newProps.format)) {
            this.switchModeForFormat(Formats.VECTOR);
        }
        if (newProps.rtl !== this.props.rtl) {
            this.props.setLayout(newProps.rtl ? 'rtl' : 'ltr');
        }
        if (this.props.theme !== newProps.theme) {
            const pref = readCanvasTheme();
            this.props.setReduxTheme(pref === newProps.theme ? 'default' : pref);
        }
        if (this.props.customFonts !== newProps.customFonts) {
            this.props.onCustomFontsChanged(newProps.customFonts);
        }
    }
    componentDidUpdate (prevProps) {
        if (this.props.mode !== prevProps.mode) {
            setLocalTool(this.props.mode);
            setHistoryMode(this.props.mode);
        }
        if (this.props.spriteId !== prevProps.spriteId) {
            if (setSpriteScope(this.props.spriteId)) this.props.onSyncSymbols();
        }
        if (this.props.isEyeDropping && !prevProps.isEyeDropping) {
            this.startEyeDroppingLoop();
        } else if (!this.props.isEyeDropping && prevProps.isEyeDropping) {
            this.stopEyeDroppingLoop();
        } else if (this.props.isEyeDropping && this.props.viewBounds !== prevProps.viewBounds) {
            if (this.props.previousTool) this.props.previousTool.activate();
            this.props.onDeactivateEyeDropper();
            this.stopEyeDroppingLoop();
        }

        if (this.props.format === Formats.VECTOR && isBitmap(prevProps.format)) {
            convertToVector(this.props.clearSelectedItems, this.props.onUpdateImage);
        } else if (isVector(prevProps.format) && this.props.format === Formats.BITMAP) {
            convertToBitmap(this.props.clearSelectedItems, this.props.onUpdateImage, this.props.fontInlineFn);
        }
    }
    componentWillUnmount () {
        window.removeEventListener('dimod-canvas-theme', this.syncCanvasTheme);
        stopSymbolSync();
        if (this.uninstallRenderCache) this.uninstallRenderCache();
        if (this.uninstallViewGestures) this.uninstallViewGestures();
        if (this.uninstallMirrorApply) this.uninstallMirrorApply();
        document.removeEventListener('keydown', this.handleDocumentKeyDown);
        document.removeEventListener('paste', this.handleDocumentPaste);
        this.stopEyeDroppingLoop();
        document.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('touchstart', this.onMouseDown);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.removeEventListener('touchend', this.onMouseUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('touchmove', this.onMouseMove);
        endGesture();
        setCollabHost(null);
        setLocalTool(null);
    }
    handleDocumentKeyDown (event) {
        if (!isPaintSuspended()) this.props.onKeyPress(event);
    }
    handleDocumentPaste (event) {
        if (!isPaintSuspended()) this.props.onSystemPaste(event);
    }
    switchModeForFormat (newFormat) {
        if ((isVector(newFormat) && (this.props.mode in VectorModes)) ||
            (isBitmap(newFormat) && (this.props.mode in BitmapModes))) {
            // Format didn't change; no mode change needed
            return;
        }
        if (isVector(newFormat)) {
            switch (this.props.mode) {
            case Modes.BIT_BRUSH:
                this.props.changeMode(Modes.BRUSH);
                break;
            case Modes.BIT_LINE:
                this.props.changeMode(Modes.LINE);
                break;
            case Modes.BIT_OVAL:
                this.props.changeMode(Modes.OVAL);
                break;
            case Modes.BIT_RECT:
                this.props.changeMode(Modes.RECT);
                break;
            case Modes.BIT_TEXT:
                this.props.changeMode(Modes.TEXT);
                break;
            case Modes.BIT_FILL:
                this.props.changeMode(Modes.FILL);
                break;
            case Modes.BIT_ERASER:
                this.props.changeMode(Modes.ERASER);
                break;
            case Modes.BIT_SELECT:
                this.props.changeMode(Modes.SELECT);
                break;
            case Modes.BIT_HAND:
                this.props.changeMode(Modes.HAND);
                break;
            case Modes.BIT_GRADIENT:
                this.props.changeMode(Modes.GRADIENT);
                break;
            case Modes.BIT_MIRROR:
                this.props.changeMode(Modes.MIRROR);
                break;
            case Modes.BIT_POLYGON:
                this.props.changeMode(Modes.POLYGON);
                break;
            case Modes.BIT_LASSO_SHAPE:
                this.props.changeMode(Modes.LASSO_SHAPE);
                break;
            default:
                log.error(`Mode not handled: ${this.props.mode}`);
                this.props.changeMode(Modes.BRUSH);
            }
        } else if (isBitmap(newFormat)) {
            switch (this.props.mode) {
            case Modes.BRUSH:
                this.props.changeMode(Modes.BIT_BRUSH);
                break;
            case Modes.ARROW:
                /* falls through */
            case Modes.LINE:
                this.props.changeMode(Modes.BIT_LINE);
                break;
            case Modes.OVAL:
                this.props.changeMode(Modes.BIT_OVAL);
                break;
            case Modes.ROUNDED_RECT:
                /* falls through */
            case Modes.SUSSY:
                /* falls through */
            case Modes.RECT:
                this.props.changeMode(Modes.BIT_RECT);
                break;
            case Modes.TEXT:
                this.props.changeMode(Modes.BIT_TEXT);
                break;
            case Modes.FILL:
                this.props.changeMode(Modes.BIT_FILL);
                break;
            case Modes.ERASER:
                this.props.changeMode(Modes.BIT_ERASER);
                break;
            case Modes.RESHAPE:
                /* falls through */
            case Modes.SELECT:
                this.props.changeMode(Modes.BIT_SELECT);
                break;
            case Modes.HAND:
                this.props.changeMode(Modes.BIT_HAND);
                break;
            case Modes.GRADIENT:
                this.props.changeMode(Modes.BIT_GRADIENT);
                break;
            case Modes.MIRROR:
                this.props.changeMode(Modes.BIT_MIRROR);
                break;
            case Modes.POLYGON:
                this.props.changeMode(Modes.BIT_POLYGON);
                break;
            case Modes.LASSO_SHAPE:
                this.props.changeMode(Modes.BIT_LASSO_SHAPE);
                break;
            default:
                log.error(`Mode not handled: ${this.props.mode}`);
                this.props.changeMode(Modes.BIT_BRUSH);
            }
        }
    }
    getEffectiveTheme () {
        return this.props.reduxTheme === 'default' ? this.props.theme : this.props.reduxTheme;
    }
    handleChangeTheme () {
        const newTheme = this.getEffectiveTheme() === 'light' ? 'dark' : 'light';
        this.props.setReduxTheme(newTheme === this.props.theme ? 'default' : newTheme);
        writeCanvasTheme(newTheme === this.props.theme ? 'default' : newTheme);
    }
    handleZoomIn () {
        // Make the "next step" after the outermost zoom level be the default
        // zoom level (0.5)
        let zoomIncrement = PaintEditor.ZOOM_INCREMENT;
        if (paper.view.zoom === OUTERMOST_ZOOM_LEVEL) {
            zoomIncrement = 0.5 - OUTERMOST_ZOOM_LEVEL;
        }
        zoomOnSelection(zoomIncrement);
        this.props.updateViewBounds(paper.view.matrix);
        this.handleSetSelectedItems();
    }
    handleZoomOut () {
        zoomOnSelection(-PaintEditor.ZOOM_INCREMENT);
        this.props.updateViewBounds(paper.view.matrix);
        this.handleSetSelectedItems();
    }
    handleZoomReset () {
        resetZoom();
        this.props.updateViewBounds(paper.view.matrix);
        this.handleSetSelectedItems();
    }
    handleSetSelectedItems () {
        this.props.setSelectedItems(this.props.format);
    }
    setCanvas (canvas) {
        this.setState({canvas: canvas});
        this.canvas = canvas;
    }
    setTextArea (element) {
        this.setState({textArea: element});
    }
    onMouseDown (event) {
        if (event.target === paper.view.element &&
                document.activeElement instanceof HTMLInputElement) {
            document.activeElement.blur();
        }

        if (event.target !== paper.view.element && event.target !== this.state.textArea) {
            // Exit text edit mode if you click anywhere outside of canvas
            this.props.removeTextEditTarget();
        }

        if (event.target === paper.view.element) {
            beginGesture({
                isVector: isVector(this.props.format),
                getRaster: getRaster
            });
        }
    }
    onMouseMove (event) {
        const tracking = isTrackingGesture();
        const sampling = shouldSampleCursor();
        if (!tracking && !sampling) return;
        if (!paper.view || !paper.view.element) return;
        const touch = event.touches && event.touches[0];
        const clientX = touch ? touch.clientX : event.clientX;
        const clientY = touch ? touch.clientY : event.clientY;
        if (typeof clientX !== 'number') return;
        const rect = paper.view.element.getBoundingClientRect();
        const point = paper.view.viewToProject(
            new paper.Point(clientX - rect.left, clientY - rect.top));
        if (tracking) trackGesturePoint(point);
        if (sampling && event.target === paper.view.element) sendLocalCursor(point);
    }
    onMouseUp () {
        endGesture();
        if (this.props.isEyeDropping) {
            const colorString = this.eyeDropper.colorString;
            const pickedStyle = this.eyeDropper.pickedStyle;
            const isStyleDropper = this.props.eyeDropperStyle === EyeDropperStyles.STYLE;
            const callback = this.props.changeColorToEyeDropper;
            const insideCanvas = !this.eyeDropper.hideLoupe;

            this.eyeDropper.remove();
            if (insideCanvas && isStyleDropper) {
                if (pickedStyle) this.handlePickStyle(pickedStyle);
            } else if (insideCanvas) {
                // If not hide loupe, that means the click is inside the canvas,
                // so apply the new color
                callback(colorString);
            }
            if (this.props.previousTool) this.props.previousTool.activate();
            this.props.onDeactivateEyeDropper();
            this.stopEyeDroppingLoop();
        }
    }
    handlePickStyle (style) {
        this.props.onPickStyle(style);
        if (applyStyleToSelection(style, this.props.textEditTargetId)) {
            this.props.onUpdateImage();
        }
    }
    startEyeDroppingLoop () {
        this.eyeDropper = new EyeDropperTool(
            this.canvas,
            paper.project.view.bounds.width,
            paper.project.view.bounds.height,
            paper.project.view.pixelRatio,
            paper.view.zoom,
            paper.project.view.bounds.x,
            paper.project.view.bounds.y,
            isBitmap(this.props.format)
        );
        this.eyeDropper.pickX = -1;
        this.eyeDropper.pickY = -1;
        this.eyeDropper.activate();

        const callback = () => {
            this.animationFrameId = requestAnimationFrame(callback);
            const colorInfo = this.eyeDropper.getColorInfo(
                this.eyeDropper.pickX,
                this.eyeDropper.pickY,
                this.eyeDropper.hideLoupe
            );
            if (!colorInfo) return;
            if (
                this.state.colorInfo === null ||
                this.state.colorInfo.x !== colorInfo.x ||
                this.state.colorInfo.y !== colorInfo.y
            ) {
                this.setState({
                    colorInfo: colorInfo
                });
            }
        };
        this.animationFrameId = requestAnimationFrame(callback);
    }
    stopEyeDroppingLoop () {
        cancelAnimationFrame(this.animationFrameId);
        this.setState({colorInfo: null});
    }
    render () {
        return (
            <PaintEditorComponent
                extraViewControls={this.props.extraViewControls}
                canRedo={this.props.shouldShowRedo}
                canUndo={this.props.shouldShowUndo}
                canvas={this.state.canvas}
                colorInfo={this.state.colorInfo}
                format={this.props.format}
                image={this.props.image}
                imageFormat={this.props.imageFormat}
                imageId={this.props.imageId}
                isEyeDropping={this.props.isEyeDropping}
                name={this.props.name}
                rotationCenterX={this.props.rotationCenterX}
                rotationCenterY={this.props.rotationCenterY}
                rtl={this.props.rtl}
                setCanvas={this.setCanvas}
                setTextArea={this.setTextArea}
                textArea={this.state.textArea}
                theme={this.getEffectiveTheme()}
                width={this.props.width}
                height={this.props.height}
                zoomLevelId={this.props.zoomLevelId}
                onChangeTheme={this.handleChangeTheme}
                onManageFonts={this.props.onManageFonts}
                onRedo={this.props.onRedo}
                onSwitchToBitmap={this.props.handleSwitchToBitmap}
                onSwitchToVector={this.props.handleSwitchToVector}
                onUndo={this.props.onUndo}
                onUpdateImage={this.props.onUpdateImage}
                onUpdateName={this.props.onUpdateName}
                onZoomIn={this.handleZoomIn}
                onZoomOut={this.handleZoomOut}
                onZoomReset={this.handleZoomReset}
            />
        );
    }
}

PaintEditor.propTypes = {
    extraViewControls: PropTypes.node,
    changeColorToEyeDropper: PropTypes.func,
    changeMode: PropTypes.func.isRequired,
    clearSelectedItems: PropTypes.func.isRequired,
    customFonts: PropTypes.arrayOf(PropTypes.shape({
        name: PropTypes.string.isRequired,
        family: PropTypes.string.isRequired
    })).isRequired,
    onCustomFontsChanged: PropTypes.func.isRequired,
    onManageFonts: PropTypes.func,
    format: PropTypes.oneOf(Object.keys(Formats)), // Internal, up-to-date data format
    fontInlineFn: PropTypes.func,
    handleSwitchToBitmap: PropTypes.func.isRequired,
    handleSwitchToVector: PropTypes.func.isRequired,
    image: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(HTMLImageElement)
    ]),
    imageFormat: PropTypes.string, // The incoming image's data format, used during import
    imageId: PropTypes.string,
    eyeDropperStyle: PropTypes.oneOf(Object.keys(EyeDropperStyles)),
    isEyeDropping: PropTypes.bool,
    onPickStyle: PropTypes.func.isRequired,
    onSyncSymbols: PropTypes.func.isRequired,
    spriteId: PropTypes.string,
    textEditTargetId: PropTypes.number,
    mode: PropTypes.oneOf(Object.keys(Modes)).isRequired,
    name: PropTypes.string,
    onDeactivateEyeDropper: PropTypes.func.isRequired,
    onKeyPress: PropTypes.func.isRequired,
    onSystemPaste: PropTypes.func.isRequired,
    onRedo: PropTypes.func.isRequired,
    onUndo: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    onUpdateName: PropTypes.func.isRequired,
    previousTool: PropTypes.shape({ // paper.Tool
        activate: PropTypes.func.isRequired,
        remove: PropTypes.func.isRequired
    }),
    removeTextEditTarget: PropTypes.func.isRequired,
    rotationCenterX: PropTypes.number,
    rotationCenterY: PropTypes.number,
    rtl: PropTypes.bool,
    setLayout: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired,
    shouldShowRedo: PropTypes.func.isRequired,
    shouldShowUndo: PropTypes.func.isRequired,
    theme: PropTypes.oneOf(['light', 'dark']),
    reduxTheme: PropTypes.oneOf(['default', 'light', 'dark']),
    setReduxTheme: PropTypes.func.isRequired,
    width: PropTypes.number,
    height: PropTypes.number,
    updateViewBounds: PropTypes.func.isRequired,
    viewBounds: PropTypes.instanceOf(paper.Matrix).isRequired,
    zoomLevelId: PropTypes.string
};

PaintEditor.defaultProps = {
    width: 480,
    height: 360,
    theme: 'light',
    customFonts: []
};

const mapStateToProps = state => ({
    changeColorToEyeDropper: state.scratchPaint.color.eyeDropper.callback,
    eyeDropperStyle: state.scratchPaint.color.eyeDropper.style,
    textEditTargetId: state.scratchPaint.textEditTarget,
    format: state.scratchPaint.format,
    isEyeDropping: state.scratchPaint.color.eyeDropper.active,
    mode: state.scratchPaint.mode,
    previousTool: state.scratchPaint.color.eyeDropper.previousTool,
    reduxTheme: state.scratchPaint.theme,
    viewBounds: state.scratchPaint.viewBounds
});
const mapDispatchToProps = dispatch => ({
    changeMode: mode => {
        dispatch(changeMode(mode));
    },
    clearSelectedItems: () => {
        dispatch(clearSelectedItems());
    },
    onCustomFontsChanged: customFonts => {
        dispatch(setCustomFonts(customFonts));
    },
    handleSwitchToBitmap: () => {
        dispatch(changeFormat(Formats.BITMAP));
    },
    handleSwitchToVector: () => {
        dispatch(changeFormat(Formats.VECTOR));
    },
    removeTextEditTarget: () => {
        dispatch(setTextEditTarget());
    },
    setLayout: layout => {
        dispatch(setLayout(layout));
    },
    setReduxTheme: theme => {
        dispatch(setReduxTheme(theme));
    },
    setSelectedItems: format => {
        dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format)));
    },
    onPickStyle: style => {
        dispatch(changeFillGradientType(style.gradientType));
        dispatch(changeFillColor(style.fillColor));
        if (style.gradientType !== GradientTypes.SOLID) {
            dispatch(changeFillColor2(style.fillColor2));
        }
        dispatch(changeStrokeGradientType(GradientTypes.SOLID));
        dispatch(changeStrokeColor(style.strokeColor));
        dispatch(changeStrokeWidth(style.strokeWidth));
    },
    onSyncSymbols: () => {
        dispatch(syncSymbols());
    },
    onDeactivateEyeDropper: () => {
        // set redux values to default for eye dropper reducer
        dispatch(deactivateEyeDropper());
    },
    updateViewBounds: matrix => {
        dispatch(updateViewBounds(matrix));
    }
});

export default UpdateImageHOC(SelectionHOC(UndoHOC(KeyboardShortcutsHOC(connect(
    mapStateToProps,
    mapDispatchToProps
)(PaintEditor)))));
