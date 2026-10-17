import React from 'react';

let realScratchPaint;
const getRealScratchPaint = () => {
    if (!realScratchPaint) {
        realScratchPaint = require('scratch-paint');
    }
    return realScratchPaint;
};

const PaintEditor = props => React.createElement(getRealScratchPaint().default, props);

let hasSetupReducer = false;
const ScratchPaintReducer = (state, action) => {
    if (!hasSetupReducer && action.type === 'scratch-gui/navigation/ACTIVATE_TAB' && action.activeTabIndex === 1) {
        hasSetupReducer = true;
    }
    if (hasSetupReducer) {
        return getRealScratchPaint().ScratchPaintReducer(state, action);
    }
    return {};
};

const setPaintSuspended = value => {
    if (realScratchPaint && realScratchPaint.setPaintSuspended) realScratchPaint.setPaintSuspended(value);
};

const setSymbolSource = value => getRealScratchPaint().setSymbolSource(value);

let flushHost = null;
const setPaintFlushHost = fn => {
    flushHost = fn;
};
const flushPaint = () => {
    if (realScratchPaint && realScratchPaint.flushPaintUpdate) realScratchPaint.flushPaintUpdate();
    if (flushHost) flushHost();
};
if (typeof window !== 'undefined') window.dimodFlushPaint = flushPaint;

const ensurePaintReducer = () => {
    hasSetupReducer = true;
};

export {
    ensurePaintReducer,
    PaintEditor as default,
    ScratchPaintReducer,
    setPaintSuspended,
    flushPaint,
    setPaintFlushHost,
    setSymbolSource
};
