// undo functionality
// modifed from https://github.com/memononen/stylii
import paper from '@turbowarp/paper';
import {applySelectionColor, hideGuideLayers, showGuideLayers, getRaster} from '../helper/layer';
import {getSelectedLeafItems} from '../helper/selection';
import Formats, {isVector, isBitmap} from '../lib/format';
import log from '../log/log';
import {getPaintingLayer, rebuildIndex} from '../dimod/store';
import {remoteSeq, replayRemoteOpsSince, pendingRasters, whenRastersLoaded} from '../dimod/collab';
import {takeHistoryLabel} from '../dimod/core';
import {restoreInPlace, noteRestored} from '../dimod/render';

const performSnapshot = function (dispatchPerformSnapshot, format) {
    if (!format) {
        log.error('Format must be specified.');
    }
    const guideLayers = hideGuideLayers();
    const snapshot = {
        json: paper.project.exportJSON({asString: false}),
        paintEditorFormat: format,
        remoteSeq: remoteSeq(),
        label: takeHistoryLabel(),
        time: Date.now()
    };
    dispatchPerformSnapshot(snapshot);
    showGuideLayers(guideLayers);
    return snapshot;
};

const _restoreInFull = function (entry) {
    for (let i = paper.project.layers.length - 1; i >= 0; i--) {
        const layer = paper.project.layers[i];
        if (!layer.data.isBackgroundGuideLayer &&
            !layer.data.isDragCrosshairLayer &&
            !layer.data.isOutlineLayer) {
            layer.removeChildren();
            layer.remove();
        }
    }
    paper.project.importJSON(entry.json);
    applySelectionColor();
    showGuideLayers(hideGuideLayers());
};

const _restore = function (entry, fromEntry, setSelectedItems, onUpdateImage, isBitmapMode) {
    const inPlace = !isBitmapMode && fromEntry && isVector(fromEntry.paintEditorFormat) &&
        restoreInPlace(entry);
    if (!inPlace) _restoreInFull(entry);
    setSelectedItems();

    rebuildIndex();

    noteRestored(entry);

    replayRemoteOpsSince(entry.remoteSeq);

    if (inPlace) {
        whenRastersLoaded(pendingRasters(getPaintingLayer()))
            .then(() => onUpdateImage(true /* skipSnapshot */));
        return;
    }

    // Ensure that all rasters are loaded before updating storage with new image data.
    const rastersThatNeedToLoad = [];
    const onLoad = () => {
        if (!getRaster().loaded) return;
        for (const raster of rastersThatNeedToLoad) {
            if (!raster.loaded) return;
        }
        onUpdateImage(true /* skipSnapshot */);
    };

    // Bitmap mode should have at most 1 selected item
    if (isBitmapMode) {
        const selectedItems = getSelectedLeafItems();
        if (selectedItems.length === 1 && selectedItems[0] instanceof paper.Raster) {
            rastersThatNeedToLoad.push(selectedItems[0]);
            if (selectedItems[0].data && selectedItems[0].data.expanded instanceof paper.Raster) {
                rastersThatNeedToLoad.push(selectedItems[0].data.expanded);
            }
        }
    }

    getRaster().onLoad = onLoad;
    for (const raster of rastersThatNeedToLoad) {
        raster.onLoad = onLoad;
        if (raster.loaded) raster.onLoad();
    }
};

const performUndo = function (undoState, dispatchPerformUndo, setSelectedItems, onUpdateImage) {
    if (undoState.pointer > 0) {
        const state = undoState.stack[undoState.pointer - 1];
        _restore(state, undoState.stack[undoState.pointer], setSelectedItems, onUpdateImage,
            isBitmap(state.paintEditorFormat));
        const format = isVector(state.paintEditorFormat) ? Formats.VECTOR_SKIP_CONVERT :
            isBitmap(state.paintEditorFormat) ? Formats.BITMAP_SKIP_CONVERT : null;
        dispatchPerformUndo(format);
    }
};


const performRedo = function (undoState, dispatchPerformRedo, setSelectedItems, onUpdateImage) {
    if (undoState.pointer >= 0 && undoState.pointer < undoState.stack.length - 1) {
        const state = undoState.stack[undoState.pointer + 1];
        _restore(state, undoState.stack[undoState.pointer], setSelectedItems, onUpdateImage,
            isBitmap(state.paintEditorFormat));
        const format = isVector(state.paintEditorFormat) ? Formats.VECTOR_SKIP_CONVERT :
            isBitmap(state.paintEditorFormat) ? Formats.BITMAP_SKIP_CONVERT : null;
        dispatchPerformRedo(format);
    }
};

const performGoto = function (undoState, index, dispatchPerformGoto, setSelectedItems, onUpdateImage) {
    if (index < 0 || index >= undoState.stack.length || index === undoState.pointer) return;
    const state = undoState.stack[index];
    _restore(state, undoState.stack[undoState.pointer], setSelectedItems, onUpdateImage,
        isBitmap(state.paintEditorFormat));
    const format = isVector(state.paintEditorFormat) ? Formats.VECTOR_SKIP_CONVERT :
        isBitmap(state.paintEditorFormat) ? Formats.BITMAP_SKIP_CONVERT : null;
    dispatchPerformGoto(index, format);
};

const shouldShowUndo = function (undoState) {
    return undoState.pointer > 0;
};

const shouldShowRedo = function (undoState) {
    return (undoState.pointer > -1 && undoState.pointer !== (undoState.stack.length - 1));
};

export {
    performGoto,
    performSnapshot,
    performUndo,
    performRedo,
    shouldShowUndo,
    shouldShowRedo
};
