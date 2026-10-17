import paper from '@turbowarp/paper';
import classNames from 'classnames';
import { connect } from 'react-redux';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import React from 'react';
import PropTypes from 'prop-types';

import PaperCanvas from '../../containers/paper-canvas.jsx';
import {DimodCollabOverlay} from '../dimod-widgets.jsx';
import ScrollableCanvas from '../../containers/scrollable-canvas.jsx';

import BitBrushMode from '../../containers/bit-brush-mode.jsx';
import BitLineMode from '../../containers/bit-line-mode.jsx';
import BitOvalMode from '../../containers/bit-oval-mode.jsx';
import BitRectMode from '../../containers/bit-rect-mode.jsx';
import BitFillMode from '../../containers/bit-fill-mode.jsx';
import BitEraserMode from '../../containers/bit-eraser-mode.jsx';
import BitSelectMode from '../../containers/bit-select-mode.jsx';
import Box from '../box/box.jsx';
import Button from '../button/button.jsx';
import ButtonGroup from '../button-group/button-group.jsx';
import BrushMode from '../../containers/brush-mode.jsx';
import EraserMode from '../../containers/eraser-mode.jsx';
import FillColorIndicatorComponent from '../../containers/fill-color-indicator.jsx';
import FillMode from '../../containers/fill-mode.jsx';
import InputGroup from '../input-group/input-group.jsx';
import LineMode from '../../containers/line-mode.jsx';
import Loupe from '../loupe/loupe.jsx';
import DimodSwatches from '../../containers/dimod-swatches.jsx';
import {
    DimodSymbolPicker,
    DimodHandMode,
    DimodMirrorMode,
    DimodGradientMode,
    DimodPolygonMode,
    DimodSettingsSync
} from '../../containers/dimod-modes.jsx';
import {
    DimodToolGroup,
    DimodOptionsButton,
    withPaintOptions,
    DimodCanvasOverlay,
    DimodCanvasMenu,
    DimodShortcutSheet,
    DimodSelectStyle as DimodSelectStyleButton
} from '../dimod-widgets.jsx';
import {DimodViewControls} from '../dimod-view-controls/dimod-view-controls.jsx';
import {DimodSidePanel} from '../dimod-side-panel/dimod-side-panel.jsx';
import {SelectStyles} from '../../dimod/items';
import {LIVETEST, SYMBOLS_ENABLED} from '../../lib/dimod-flags';
import {getPaintOptions} from '../../dimod/core';
import FixedToolsContainer from '../../containers/fixed-tools.jsx';
import ModeToolsContainer from '../../containers/mode-tools.jsx';
import OvalMode from '../../containers/oval-mode.jsx';
import PenMode from '../../containers/pen-mode.jsx';
import RectMode from '../../containers/rect-mode.jsx';
import RoundedRectMode from '../../containers/rounded-rect-mode.jsx';
import SussyMode from '../../containers/sussy-mode.jsx';
import TriangleMode from '../../containers/triangle-mode.jsx';
import ArrowMode from '../../containers/arrow-mode.jsx';
import ReshapeMode from '../../containers/reshape-mode.jsx';
import SelectMode from '../../containers/select-mode.jsx';
import StrokeColorIndicatorComponent from '../../containers/stroke-color-indicator.jsx';
import StrokeWidthIndicatorComponent from '../../containers/stroke-width-indicator.jsx';
import TextMode from '../../containers/text-mode.jsx';

import Formats, {isBitmap, isVector} from '../../lib/format';
import Modes from '../../lib/modes';
import styles from './paint-editor.css';

import bitmapIcon from './icons/bitmap.svg';
import zoomInIcon from './icons/zoom-in.svg';
import zoomOutIcon from './icons/zoom-out.svg';
import zoomResetIcon from './icons/zoom-reset.svg';
import themeIcon from './icons/theme.svg';

const messages = defineMessages({
    bitmap: {
        defaultMessage: 'Convert to Bitmap',
        description: 'Label for button that converts the paint editor to bitmap mode',
        id: 'paint.paintEditor.bitmap'
    },
    vector: {
        defaultMessage: 'Convert to Vector',
        description: 'Label for button that converts the paint editor to vector mode',
        id: 'paint.paintEditor.vector'
    }
});

const SelectStyleGroup = props => (
    <DimodToolGroup
        items={[SelectStyles.BOX, SelectStyles.LASSO, SelectStyles.POLYGON, SelectStyles.WAND].map(style => ({
            id: style,
            element: (
                <DimodSelectStyleButton
                    mode={props.mode}
                    selectStyle={style}
                />
            )
        })).concat(props.extraItems || [])}
        styleOf={props.mode}
    />
);

SelectStyleGroup.propTypes = {
    extraItems: PropTypes.arrayOf(PropTypes.object),
    mode: PropTypes.string.isRequired
};

const GroupedVectorModes = withPaintOptions(props => {
    const merge = getPaintOptions().mergeNodeCursor;
    const reshape = {mode: Modes.RESHAPE, element: <ReshapeMode onUpdateImage={props.onUpdateImage} />};
    return (
    <div className={classNames(styles.modeSelector, {[styles.modeSelectorTwo]: getPaintOptions().twoColumns})}>
        <SelectMode
            hideButton
            onUpdateImage={props.onUpdateImage}
        />
        <SelectStyleGroup
            extraItems={merge ? [reshape] : []}
            mode={Modes.SELECT}
        />
        {merge ? null : reshape.element}
        <DimodToolGroup
            items={[
                {mode: Modes.BRUSH, element: <BrushMode onUpdateImage={props.onUpdateImage} />},
                {mode: Modes.PEN, element: <PenMode onUpdateSvg={props.onUpdateImage} />}
            ]}
        />
        <EraserMode onUpdateImage={props.onUpdateImage} />
        <DimodToolGroup
            items={[
                {mode: Modes.FILL, element: <FillMode onUpdateImage={props.onUpdateImage} />},
                {mode: Modes.GRADIENT, element: <DimodGradientMode onUpdateImage={props.onUpdateImage} />}
            ]}
        />
        <TextMode
            textArea={props.textArea}
            onUpdateImage={props.onUpdateImage}
        />
        <LineMode onUpdateImage={props.onUpdateImage} />
        <DimodToolGroup
            items={[
                {mode: Modes.RECT, element: <RectMode onUpdateImage={props.onUpdateImage} />},
                {mode: Modes.OVAL, element: <OvalMode onUpdateImage={props.onUpdateImage} />},
                props.showRoundedRectMode ?
                    {mode: Modes.ROUNDED_RECT, element: <RoundedRectMode onUpdateImage={props.onUpdateImage} />} :
                    null,
                {mode: Modes.TRIANGLE, element: <TriangleMode onUpdateImage={props.onUpdateImage} />},
                {mode: Modes.POLYGON, element: <DimodPolygonMode onUpdateImage={props.onUpdateImage} />},
                {
                    mode: Modes.LASSO_SHAPE,
                    element: (
                        <DimodPolygonMode
                            lasso
                            onUpdateImage={props.onUpdateImage}
                        />
                    )
                },
                {mode: Modes.ARROW, element: <ArrowMode onUpdateImage={props.onUpdateImage} />},
                {mode: Modes.SUSSY, element: <SussyMode onUpdateImage={props.onUpdateImage} />}
            ].filter(Boolean)}
        />
        <DimodMirrorMode />
        <DimodHandMode />
    </div>
    );
});

const GroupedBitmapModes = withPaintOptions(props => (
    <div className={classNames(styles.modeSelector, {[styles.modeSelectorTwo]: getPaintOptions().twoColumns})}>
        <BitBrushMode onUpdateImage={props.onUpdateImage} />
        <BitLineMode onUpdateImage={props.onUpdateImage} />
        <DimodToolGroup
            items={[
                {mode: Modes.BIT_RECT, element: <BitRectMode onUpdateImage={props.onUpdateImage} />},
                {mode: Modes.BIT_OVAL, element: <BitOvalMode onUpdateImage={props.onUpdateImage} />},
                {
                    mode: Modes.BIT_POLYGON,
                    element: (
                        <DimodPolygonMode
                            isBitmap
                            onUpdateImage={props.onUpdateImage}
                        />
                    )
                },
                {
                    mode: Modes.BIT_LASSO_SHAPE,
                    element: (
                        <DimodPolygonMode
                            isBitmap
                            lasso
                            onUpdateImage={props.onUpdateImage}
                        />
                    )
                }
            ]}
        />
        <TextMode
            isBitmap
            textArea={props.textArea}
            onUpdateImage={props.onUpdateImage}
        />
        <DimodToolGroup
            items={[
                {mode: Modes.BIT_FILL, element: <BitFillMode onUpdateImage={props.onUpdateImage} />},
                {
                    mode: Modes.BIT_GRADIENT,
                    element: (
                        <DimodGradientMode
                            isBitmap
                            onUpdateImage={props.onUpdateImage}
                        />
                    )
                }
            ]}
        />
        <BitEraserMode onUpdateImage={props.onUpdateImage} />
        <BitSelectMode
            hideButton
            onUpdateImage={props.onUpdateImage}
        />
        <SelectStyleGroup mode={Modes.BIT_SELECT} />
        <DimodMirrorMode isBitmap />
        <DimodHandMode isBitmap />
    </div>
));

const LivetestTopBar = props => (
    <div className={classNames(styles.editorContainerTop, styles.topBar)}>
        <div className={classNames(styles.row, styles.topRow)}>
            <FixedToolsContainer
                compact
                canRedo={props.canRedo}
                canUndo={props.canUndo}
                name={props.name}
                onRedo={props.onRedo}
                onUndo={props.onUndo}
                onUpdateImage={props.onUpdateImage}
                onUpdateName={props.onUpdateName}
                width={props.width}
            />
            <InputGroup
                className={classNames(
                    styles.row,
                    styles.topSection,
                    styles.modLabeledIconHeight
                )}
            >
                <FillColorIndicatorComponent
                    className={styles.modMarginAfter}
                    onUpdateImage={props.onUpdateImage}
                />
                {isVector(props.format) ? (
                    <StrokeColorIndicatorComponent
                        onUpdateImage={props.onUpdateImage}
                    />
                ) : null}
                {isVector(props.format) ? (
                    <StrokeWidthIndicatorComponent
                        onUpdateImage={props.onUpdateImage}
                    />
                ) : null}
            </InputGroup>
            <InputGroup
                className={classNames(styles.topSection, styles.modLabeledIconHeight)}
            >
                <DimodSwatches
                    compact
                    onUpdateImage={props.onUpdateImage}
                />
            </InputGroup>
        </div>
        <div className={styles.contextRow}>
            <ModeToolsContainer
                contextBar
                height={props.height}
                width={props.width}
                onManageFonts={props.onManageFonts}
                onUpdateImage={props.onUpdateImage}
            />
        </div>
    </div>
);

LivetestTopBar.propTypes = {
    canRedo: PropTypes.func.isRequired,
    canUndo: PropTypes.func.isRequired,
    format: PropTypes.oneOf(Object.keys(Formats)),
    height: PropTypes.number,
    name: PropTypes.string,
    onManageFonts: PropTypes.func,
    onRedo: PropTypes.func.isRequired,
    onUndo: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    onUpdateName: PropTypes.func.isRequired,
    width: PropTypes.number
};

const canvasControls = (props, noExtra) => (
    <div className={styles.canvasControls}>
        {isVector(props.format) ?
            <Button
                className={classNames(styles.bitmapButton, {[styles.bitmapButtonCompact]: LIVETEST})}
                title={props.intl.formatMessage(messages.bitmap)}
                onClick={props.onSwitchToBitmap}
            >
                <img
                    className={styles.bitmapButtonIcon}
                    draggable={false}
                    src={bitmapIcon}
                />
                <span className={styles.buttonText}>
                    {props.intl.formatMessage(messages.bitmap)}
                </span>
            </Button> :
            isBitmap(props.format) ?
                <Button
                    className={classNames(styles.bitmapButton, {[styles.bitmapButtonCompact]: LIVETEST})}
                    title={props.intl.formatMessage(messages.vector)}
                    onClick={props.onSwitchToVector}
                >
                    <img
                        className={styles.bitmapButtonIcon}
                        draggable={false}
                        src={bitmapIcon}
                    />
                    <span className={styles.buttonText}>
                        {props.intl.formatMessage(messages.vector)}
                    </span>
                </Button> : null
        }
        {/* Zoom controls */}
        <InputGroup className={styles.zoomControls}>
            {props.extraViewControls && !noExtra ? (
                <div className={styles.extraViewControls}>{props.extraViewControls}</div>
            ) : null}
            <ButtonGroup>
                <Button
                    className={styles.buttonGroupButton}
                    onClick={props.onZoomOut}
                >
                    <img
                        alt="Zoom Out"
                        className={styles.buttonGroupButtonIcon}
                        draggable={false}
                        src={zoomOutIcon}
                    />
                </Button>
                <Button
                    className={styles.buttonGroupButton}
                    onClick={props.onZoomReset}
                >
                    <img
                        alt="Zoom Reset"
                        className={styles.buttonGroupButtonIcon}
                        draggable={false}
                        src={zoomResetIcon}
                    />
                </Button>
                <Button
                    className={styles.buttonGroupButton}
                    onClick={props.onZoomIn}
                >
                    <img
                        alt="Zoom In"
                        className={styles.buttonGroupButtonIcon}
                        draggable={false}
                        src={zoomInIcon}
                    />
                </Button>
            </ButtonGroup>
            <ButtonGroup>
                <Button
                    className={styles.buttonGroupButton}
                    onClick={props.onChangeTheme}
                >
                    <img
                        alt="Change theme"
                        className={styles.buttonGroupButtonIcon}
                        draggable={false}
                        src={themeIcon}
                    />
                </Button>
            </ButtonGroup>
            {LIVETEST ? <DimodViewControls /> : null}
        </InputGroup>
    </div>
);

const PaintEditorComponent = props => (
    <div
        className={styles.editorContainer}
        dir={props.rtl ? 'rtl' : 'ltr'}
        data-paint-theme={props.theme}
    >
        {SYMBOLS_ENABLED ? (
            <DimodSymbolPicker
                onUpdateImage={props.onUpdateImage}
            />
        ) : null}
        {LIVETEST ? <DimodSettingsSync /> : null}
        {LIVETEST ? <DimodShortcutSheet /> : null}
        {LIVETEST && props.canvas ? (
            <LivetestTopBar {...props} />
        ) : null}
        {!LIVETEST && props.canvas !== null ? ( // eslint-disable-line no-negated-condition
            <div className={styles.editorContainerTop}>
                {/* First Row */}
                <div className={styles.row}>
                    <FixedToolsContainer
                        canRedo={props.canRedo}
                        canUndo={props.canUndo}
                        name={props.name}
                        onRedo={props.onRedo}
                        onUndo={props.onUndo}
                        onUpdateImage={props.onUpdateImage}
                        onUpdateName={props.onUpdateName}
                        width={props.width}
                    />
                </div>
                {/* Second Row */}
                {isVector(props.format) ?
                    <div className={styles.row}>
                        <InputGroup
                            className={classNames(
                                styles.row,
                                styles.modDashedBorder,
                                styles.modLabeledIconHeight
                            )}
                        >
                            {/* fill */}
                            <FillColorIndicatorComponent
                                className={styles.modMarginAfter}
                                onUpdateImage={props.onUpdateImage}
                            />
                            {/* stroke */}
                            <StrokeColorIndicatorComponent
                                onUpdateImage={props.onUpdateImage}
                            />
                            {/* stroke width */}
                            <StrokeWidthIndicatorComponent
                                onUpdateImage={props.onUpdateImage}
                            />
                        </InputGroup>
                        <InputGroup className={styles.modModeTools}>
                            <ModeToolsContainer
                                onUpdateImage={props.onUpdateImage}
                                width={props.width}
                                height={props.height}
                                onManageFonts={props.onManageFonts}
                            />
                        </InputGroup>
                    </div> :
                    isBitmap(props.format) ?
                        <div className={styles.row}>
                            <InputGroup
                                className={classNames(
                                    styles.row,
                                    styles.modDashedBorder,
                                    styles.modLabeledIconHeight
                                )}
                            >
                                {/* fill */}
                                <FillColorIndicatorComponent
                                    className={styles.modMarginAfter}
                                    onUpdateImage={props.onUpdateImage}
                                />
                            </InputGroup>
                            <InputGroup className={styles.modModeTools}>
                                <ModeToolsContainer
                                    onUpdateImage={props.onUpdateImage}
                                    width={props.width}
                                    height={props.height}
                                    onManageFonts={props.onManageFonts}
                                />
                            </InputGroup>
                        </div> : null
                }
            </div>
        ) : null}

        <div className={styles.topAlignRow}>
            <div className={styles.toolColumn}>
                {/* Modes */}
                {LIVETEST && props.canvas && isVector(props.format) ? (
                    <GroupedVectorModes
                        showRoundedRectMode={props.showRoundedRectMode}
                        textArea={props.textArea}
                        onUpdateImage={props.onUpdateImage}
                    />
                ) : null}
                {LIVETEST && props.canvas && isBitmap(props.format) ? (
                    <GroupedBitmapModes
                        textArea={props.textArea}
                        onUpdateImage={props.onUpdateImage}
                    />
                ) : null}

                {!LIVETEST && props.canvas && isVector(props.format) ? (
                    <div className={styles.modeSelector}>
                        <SelectMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <ReshapeMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <BrushMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <EraserMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <PenMode
                            onUpdateSvg={props.onUpdateImage}
                        />
                        <FillMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <TextMode
                            textArea={props.textArea}
                            onUpdateImage={props.onUpdateImage}
                        />
                        <LineMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <OvalMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <RectMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        {props.showRoundedRectMode && (
                            <RoundedRectMode
                                onUpdateImage={props.onUpdateImage}
                            />
                        )}
                        <TriangleMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <SussyMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <ArrowMode
                            onUpdateImage={props.onUpdateImage}
                        />
                    </div>
                ) : null}

                {!LIVETEST && props.canvas && isBitmap(props.format) ? (
                    <div className={styles.modeSelector}>
                        <BitBrushMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <BitLineMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <BitOvalMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <BitRectMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <TextMode
                            isBitmap
                            textArea={props.textArea}
                            onUpdateImage={props.onUpdateImage}
                        />
                        <BitFillMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <BitEraserMode
                            onUpdateImage={props.onUpdateImage}
                        />
                        <BitSelectMode
                            onUpdateImage={props.onUpdateImage}
                        />
                    </div>
                ) : null}

                {LIVETEST && props.canvas ? <DimodOptionsButton /> : null}

                {LIVETEST || props.canvas === null ? null : (
                    <DimodSwatches
                        onUpdateImage={props.onUpdateImage}
                    />
                )}
            </div>

            <div className={styles.controlsContainer}>
                {/* Canvas */}
                <ScrollableCanvas
                    canvas={props.canvas}
                    hideScrollbars={props.isEyeDropping}
                    style={styles.canvasContainer}
                >
                    <PaperCanvas
                        canvasRef={props.setCanvas}
                        image={props.image}
                        imageFormat={props.imageFormat}
                        imageId={props.imageId}
                        rotationCenterX={props.rotationCenterX}
                        rotationCenterY={props.rotationCenterY}
                        theme={props.theme}
                        zoomLevelId={props.zoomLevelId}
                        onUpdateImage={props.onUpdateImage}
                    />
                    <DimodCollabOverlay canvas={props.canvas} />
                    {LIVETEST ? <DimodCanvasOverlay canvas={props.canvas} /> : null}
                    {LIVETEST ? <DimodCanvasMenu canvas={props.canvas} /> : null}
                    <textarea
                        className={styles.textArea}
                        ref={props.setTextArea}
                        spellCheck={false}
                    />
                    {props.isEyeDropping &&
                        props.colorInfo !== null &&
                        !props.colorInfo.hideLoupe ? (
                            <Box className={styles.colorPickerWrapper}>
                                <Loupe
                                    colorInfo={props.colorInfo}
                                    pixelRatio={paper.project.view.pixelRatio}
                                    theme={props.theme}
                                />
                            </Box>
                        ) : null
                    }
                </ScrollableCanvas>
                {LIVETEST ? null : canvasControls(props)}
            </div>
            {LIVETEST && props.canvas ? <DimodSidePanel onUpdateImage={props.onUpdateImage} /> : null}
        </div>
        {LIVETEST ? <div className={styles.bottomRow}>{canvasControls(props, true)}{props.extraViewControls ? <div className={styles.extraViewControls}>{props.extraViewControls}</div> : null}</div> : null}
    </div>
);

PaintEditorComponent.propTypes = {
    extraViewControls: PropTypes.node,
    canRedo: PropTypes.func.isRequired,
    canUndo: PropTypes.func.isRequired,
    canvas: PropTypes.instanceOf(Element),
    colorInfo: Loupe.propTypes.colorInfo,
    format: PropTypes.oneOf(Object.keys(Formats)),
    image: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(HTMLImageElement)
    ]),
    imageFormat: PropTypes.string,
    imageId: PropTypes.string,
    intl: intlShape,
    isEyeDropping: PropTypes.bool,
    name: PropTypes.string,
    onChangeTheme: PropTypes.func.isRequired,
    onManageFonts: PropTypes.func,
    onRedo: PropTypes.func.isRequired,
    onSwitchToBitmap: PropTypes.func.isRequired,
    onSwitchToVector: PropTypes.func.isRequired,
    onUndo: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    onUpdateName: PropTypes.func.isRequired,
    onZoomIn: PropTypes.func.isRequired,
    onZoomOut: PropTypes.func.isRequired,
    onZoomReset: PropTypes.func.isRequired,
    rotationCenterX: PropTypes.number,
    rotationCenterY: PropTypes.number,
    rtl: PropTypes.bool,
    setCanvas: PropTypes.func.isRequired,
    setTextArea: PropTypes.func.isRequired,
    showRoundedRectMode: PropTypes.bool,
    textArea: PropTypes.instanceOf(Element),
    theme: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    zoomLevelId: PropTypes.string
};

const mapStateToProps = state => ({
    showRoundedRectMode: state.scratchPaint.addonUtil.showRoundedRectMode
});

export default connect(
    mapStateToProps,
)(injectIntl(PaintEditorComponent));
