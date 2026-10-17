import PaintEditor from './containers/tw-paint-editor-wrapper.jsx';
import ScratchPaintReducer from './reducers/scratch-paint-reducer';
import * as PaintCollab from './dimod/collab';
import {setPaintSuspended, flushPaintUpdate} from './lib/dimod-flags';
import {setSymbolSource} from './dimod/items';
import {installRafGuard} from './dimod/render';

installRafGuard();

export {
    PaintEditor as default,
    ScratchPaintReducer,
    PaintCollab,
    setSymbolSource,
    setPaintSuspended,
    flushPaintUpdate
};
