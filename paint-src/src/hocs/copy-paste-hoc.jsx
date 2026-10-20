import paper from '@turbowarp/paper';
import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import omit from 'lodash.omit';
import {connect} from 'react-redux';

import {
    clearSelection,
    deleteSelection,
    getAllRootItems,
    getSelectedLeafItems,
    getSelectedRootItems
} from '../helper/selection';
import {getTrimmedRaster} from '../helper/bitmap';
import {ART_BOARD_HEIGHT, ART_BOARD_WIDTH, CENTER} from '../helper/view';
import Formats, {isBitmap} from '../lib/format';
import Modes from '../lib/modes';

import {clearSelectedItems, setSelectedItems} from '../reducers/selected-items';
import {incrementPasteOffset, setClipboardItems} from '../reducers/clipboard';

const CLIP_KEY = 'dimod:paintClipboard';
let clipStamp = 0;
let lastImage = null;
const readSharedClip = () => {
    try { return JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch (e) { return null; }
};
const writeSystemClipboard = (items, jsonItems) => {
    clipStamp = Date.now();
    try { localStorage.setItem(CLIP_KEY, JSON.stringify({t: clipStamp, items: jsonItems})); } catch (e) {}
    try {
        if (!navigator.clipboard) return;
        const markup = `${items.map(item => item.exportSVG({asString: true})).join('\n')}\n<!-- dimod-clip:${clipStamp} -->`;
        const raster = items.length === 1 && items[0] instanceof paper.Raster && items[0];
        if (raster && window.ClipboardItem && navigator.clipboard.write) {
            const png = new Promise(resolve => raster.canvas.toBlob(resolve, 'image/png'));
            navigator.clipboard.write([new window.ClipboardItem({'text/plain': new Blob([markup], {type: 'text/plain'}), 'image/png': png})])
                .catch(() => navigator.clipboard.writeText(markup).catch(() => {}));
        } else if (navigator.clipboard.writeText) navigator.clipboard.writeText(markup).catch(() => {});
    } catch (e) {
    }
};
const CopyPasteHOC = function (WrappedComponent) {
    class CopyPasteWrapper extends React.Component {
        constructor (props) {
            super(props);
            bindAll(this, [
                'handleCopy',
                'handleCut',
                'handlePaste',
                'handleDocumentPaste'
            ]);
            this.queuedPaste = null;
        }
        componentDidMount () {
            const shared = readSharedClip();
            if (shared && shared.t !== clipStamp && shared.items && shared.items.length && !this.props.clipboardItems.length) {
                clipStamp = shared.t;
                this.props.setClipboardItems(shared.items);
            }
        }
        componentWillUnmount () {
            clearTimeout(this.queuedPaste);
        }
        handleCopy () {
            let selectedItems = [];
            if (this.props.mode === Modes.RESHAPE) {
                const leafItems = getSelectedLeafItems();
                // Copy root of compound paths
                for (const item of leafItems) {
                    if (item.parent && item.parent instanceof paper.CompoundPath) {
                        selectedItems.push(item.parent);
                    } else {
                        selectedItems.push(item);
                    }
                }
            } else {
                selectedItems = getSelectedRootItems();
            }
            if (selectedItems.length === 0) {
                if (isBitmap(this.props.format)) {
                    const raster = getTrimmedRaster(false /* shouldInsert */);
                    if (!raster) return;
                    selectedItems.push(raster);
                } else {
                    selectedItems = getAllRootItems();
                }
            }
            const clipboardItems = [];
            for (let i = 0; i < selectedItems.length; i++) {
                const jsonItem = selectedItems[i].exportJSON({asString: false});
                clipboardItems.push(jsonItem);
            }
            this.props.setClipboardItems(clipboardItems);
            writeSystemClipboard(selectedItems, clipboardItems);
        }
        handleCut () {
            let selectedItems = [];
            if (this.props.mode === Modes.RESHAPE) {
                const leafItems = getSelectedLeafItems();
                // Copy root of compound paths
                for (const item of leafItems) {
                    if (item.parent && item.parent instanceof paper.CompoundPath) {
                        selectedItems.push(item.parent);
                    } else {
                        selectedItems.push(item);
                    }
                }
            } else {
                selectedItems = getSelectedRootItems();
            }
            if (selectedItems.length === 0) {
                if (isBitmap(this.props.format)) {
                    const raster = getTrimmedRaster(false /* shouldInsert */);
                    if (!raster) return;
                    selectedItems.push(raster);
                } else {
                    selectedItems = getAllRootItems();
                }
            }
            const clipboardItems = [];
            for (let i = 0; i < selectedItems.length; i++) {
                const jsonItem = selectedItems[i].exportJSON({asString: false});
                clipboardItems.push(jsonItem);
            }
            this.props.setClipboardItems(clipboardItems);
            writeSystemClipboard(selectedItems, clipboardItems);
            // delete items
            if (deleteSelection(this.props.mode, this.props.onUpdateImage)) {
                clearSelection(this.props.clearSelectedItems);
            }
        }
        handlePaste () {
            clearTimeout(this.queuedPaste);
            this.queuedPaste = setTimeout(() => {
                this.queuedPaste = null;
                this.pasteClipboardItems();
            });
        }
        handleDocumentPaste (event) {
            if (event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement ||
                (event.target instanceof HTMLElement && event.target.isContentEditable) ||
                this.props.textEditing) {
                return;
            }
            const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
            const mark = /<!-- dimod-clip:(\d+) -->/.exec(text || '');
            if (mark) {
                const shared = readSharedClip();
                if (shared && String(shared.t) === mark[1] && shared.t !== clipStamp && shared.items && shared.items.length) {
                    clipStamp = shared.t;
                    this.props.setClipboardItems(shared.items);
                }
                return;
            }
            const items = event.clipboardData ? Array.from(event.clipboardData.items) : [];
            const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'));
            const file = imageItem && imageItem.getAsFile();
            if (!file) return;
            const sig = `${file.type}:${file.size}`;
            if (lastImage && lastImage.sig === sig && clipStamp > lastImage.t && this.props.clipboardItems.length) return;
            lastImage = {sig, t: Date.now()};

            event.preventDefault();
            clearTimeout(this.queuedPaste);
            this.queuedPaste = null;
            this.pasteImageFile(file);
        }
        pasteImageFile (file) {
            const reader = new FileReader();
            reader.onload = () => {
                const image = new Image();
                image.onload = () => this.placeRaster(image);
                image.src = reader.result;
            };
            reader.readAsDataURL(file);
        }
        placeRaster (image) {
            clearSelection(this.props.clearSelectedItems);

            const raster = new paper.Raster(image);
            raster.remove();
            paper.project.getActiveLayer().addChild(raster);

            const scale = Math.min(
                1,
                ART_BOARD_WIDTH / Math.max(raster.width, 1),
                ART_BOARD_HEIGHT / Math.max(raster.height, 1)
            );
            if (scale < 1) raster.scale(scale);
            raster.position = CENTER;

            raster.selected = true;
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
        pasteClipboardItems () {
            clearSelection(this.props.clearSelectedItems);

            if (this.props.clipboardItems.length === 0) return;

            let items = [];
            for (let i = 0; i < this.props.clipboardItems.length; i++) {
                const item = paper.Base.importJSON(this.props.clipboardItems[i]);
                if (item) {
                    items.push(item);
                }
            }
            if (!items.length) return;
            // If pasting a group or non-raster to bitmap, rasterize first
            if (isBitmap(this.props.format) && !(items.length === 1 && items[0] instanceof paper.Raster)) {
                const group = new paper.Group(items);
                items = [group.rasterize()];
                group.remove();
            }
            for (const item of items) {
                const placedItem = paper.project.getActiveLayer().addChild(item);
                placedItem.selected = true;
                placedItem.position.x += 10 * this.props.pasteOffset;
                placedItem.position.y += 10 * this.props.pasteOffset;
            }
            this.props.incrementPasteOffset();
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
        render () {
            const componentProps = omit(this.props, [
                'clearSelectedItems',
                'clipboardItems',
                'format',
                'incrementPasteOffset',
                'mode',
                'pasteOffset',
                'setClipboardItems',
                'setSelectedItems',
                'textEditing']);
            return (
                <WrappedComponent
                    onCopyToClipboard={this.handleCopy}
                    onCutToClipboard={this.handleCut}
                    onPasteFromClipboard={this.handlePaste}
                    onSystemPaste={this.handleDocumentPaste}
                    {...componentProps}
                />
            );
        }
    }

    CopyPasteWrapper.propTypes = {
        clearSelectedItems: PropTypes.func.isRequired,
        clipboardItems: PropTypes.arrayOf(PropTypes.array),
        format: PropTypes.oneOf(Object.keys(Formats)),
        incrementPasteOffset: PropTypes.func.isRequired,
        mode: PropTypes.oneOf(Object.keys(Modes)),
        onUpdateImage: PropTypes.func.isRequired,
        pasteOffset: PropTypes.number,
        textEditing: PropTypes.bool,
        setClipboardItems: PropTypes.func.isRequired,
        setSelectedItems: PropTypes.func.isRequired
    };
    const mapStateToProps = state => ({
        clipboardItems: state.scratchPaint.clipboard.items,
        format: state.scratchPaint.format,
        mode: state.scratchPaint.mode,
        pasteOffset: state.scratchPaint.clipboard.pasteOffset,
        textEditing: state.scratchPaint.textEditTarget !== null
    });
    const mapDispatchToProps = dispatch => ({
        setClipboardItems: items => {
            dispatch(setClipboardItems(items));
        },
        incrementPasteOffset: () => {
            dispatch(incrementPasteOffset());
        },
        clearSelectedItems: () => {
            dispatch(clearSelectedItems());
        },
        setSelectedItems: format => {
            dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format)));
        }
    });

    return connect(
        mapStateToProps,
        mapDispatchToProps
    )(CopyPasteWrapper);
};

export default CopyPasteHOC;
