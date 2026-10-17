import paper from '@turbowarp/paper';
let suspended = false;
const isPaintSuspended = () => suspended;
const setPaintSuspended = value => {
    suspended = Boolean(value);
    if (suspended && paper.View) paper.View._focused = null;
};
const flushers = new Set();
const registerPaintFlusher = fn => { flushers.add(fn); return () => flushers.delete(fn); };
const flushPaintUpdate = () => { flushers.forEach(fn => fn()); };
export {isPaintSuspended, setPaintSuspended, registerPaintFlusher, flushPaintUpdate};
const SYMBOLS_ENABLED = false;
const LIVETEST = true;
export {LIVETEST, SYMBOLS_ENABLED};
