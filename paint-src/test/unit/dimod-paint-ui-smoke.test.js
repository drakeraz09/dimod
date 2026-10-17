/* eslint-env jest */

import ConnectedModeTools, {ModeToolsComponent} from '../../src/components/mode-tools/mode-tools.jsx';
import ConnectedColorPicker, {ColorPickerComponent} from '../../src/components/color-picker/color-picker.jsx';
import ColorPickerContainer from '../../src/containers/color-picker.jsx';
import {
    DimodSwatches as DimodSwatchesComponent,
    PaletteOpenDialog,
    PaletteSaveDialog
} from '../../src/components/dimod-swatches/dimod-swatches.jsx';
import DimodSwatchesContainer from '../../src/containers/dimod-swatches.jsx';
import {DimodDialog} from '../../src/components/dimod-widgets.jsx';
import {
    DimodSymbols as DimodSymbolsComponent,
    SymbolPicker as SymbolPickerComponent
} from '../../src/components/dimod-symbols/dimod-symbols.jsx';
import {DimodSymbolPicker as DimodSymbolPickerContainer} from '../../src/containers/dimod-modes.jsx';

import scratchPaintReducer from '../../src/reducers/scratch-paint-reducer';
import {
    swatchesDefault as swatchesReducer,
    addSwatchColor,
    clearSwatchColors,
    setSwatchLock,
    syncSwatches,
    symbolsDefault as symbolsReducer,
    selectSymbol,
    setSymbolPickerOpen,
    syncSymbols
} from '../../src/reducers/dimod';
import eyeDropperReducer, {activateEyeDropper, deactivateEyeDropper} from '../../src/reducers/eye-dropper';
import EyeDropperStyles from '../../src/lib/eye-dropper-styles';
import {resetDimod} from '../../src/dimod/store';

beforeEach(() => {
    resetDimod();
});

test('the containers and components load', () => {
    for (const thing of [
        ConnectedModeTools, ConnectedColorPicker, ColorPickerContainer,
        DimodSwatchesComponent, DimodSwatchesContainer, DimodSymbolsComponent,
        SymbolPickerComponent, DimodSymbolPickerContainer,
        DimodDialog, PaletteOpenDialog, PaletteSaveDialog
    ]) {
        expect(typeof thing).toBe('function');
    }
});

test('the symbol handlers are declared props on the mode tools', () => {
    for (const name of [
        'symbols', 'selectedSymbol', 'hasSelectedInstance', 'hasSelection',
        'onSelectSymbol', 'onCreateSymbol', 'onPlaceInstance',
        'onDetachInstance', 'onRedefineSymbol', 'onRenameSymbol', 'onDeleteSymbol',
        'onSetSymbolScope', 'onOpenPicker'
    ]) {
        expect(ModeToolsComponent.propTypes[name]).toBeDefined();
    }
});

test('the second eyedropper is declared props on the colour picker', () => {
    const propTypes = ColorPickerComponent.propTypes;
    for (const name of ['onActivateStyleEyeDropper', 'isStyleDropping']) {
        expect(propTypes[name]).toBeDefined();
    }
    expect(propTypes.swatches).toBeUndefined();
});

test('the store carries the palette and the symbol library', () => {
    const state = scratchPaintReducer(void 0, {type: '@@INIT'});
    expect(state.dimodSwatches).toEqual({
        entries: [],
        lock: false,
        palettes: [],
        paletteId: null,
        paletteName: null,
        dialog: null
    });
    expect(state.dimodSymbols).toEqual({symbols: [], selected: null, pickerOpen: false, version: 0});
});

test('the swatch actions write through to the document and report back', () => {
    let state = swatchesReducer(void 0, addSwatchColor('#FF0000'));
    expect(state.entries.map(entry => entry.fill)).toEqual(['#ff0000']);
    state = swatchesReducer(state, addSwatchColor({fillColor: '#00ff00', strokeColor: '#000000', strokeWidth: 2}));
    expect(state.entries).toHaveLength(2);
    expect(state.entries[1].stroke).toBe('#000000');
    state = swatchesReducer(state, setSwatchLock(true));
    expect(state.lock).toBe(true);
    state = swatchesReducer(state, clearSwatchColors());
    expect(state.entries).toEqual([]);
    expect(state.palettes).toEqual([]);
    expect(swatchesReducer(state, syncSwatches()).entries).toEqual([]);
});

test('the symbol mirror keeps a selection that still exists', () => {
    let state = symbolsReducer(void 0, syncSymbols());
    expect(state.symbols).toEqual([]);
    expect(state.selected).toBeNull();

    state = symbolsReducer(state, {
        type: 'scratch-paint/dimod-symbols/SET_SYMBOLS',
        symbols: [{id: 'a', name: 'A', instances: 1}, {id: 'b', name: 'B', instances: 0}]
    });
    expect(state.selected).toBe('a');
    state = symbolsReducer(state, selectSymbol('b'));
    expect(state.selected).toBe('b');

    state = symbolsReducer(state, {
        type: 'scratch-paint/dimod-symbols/SET_SYMBOLS',
        symbols: [{id: 'a', name: 'A', instances: 1}]
    });
    expect(state.selected).toBe('a');
    expect(state.version).toBe(3);

    state = symbolsReducer(state, setSymbolPickerOpen(true));
    expect(state.pickerOpen).toBe(true);
    expect(state.symbols).toHaveLength(1);
    expect(symbolsReducer(state, setSymbolPickerOpen(false)).pickerOpen).toBe(false);
});

test('the eyedropper remembers which of the two is running', () => {
    let state = eyeDropperReducer(void 0, {type: '@@INIT'});
    expect(state.style).toBe(EyeDropperStyles.COLOR);

    state = eyeDropperReducer(state, activateEyeDropper(null, () => {}, EyeDropperStyles.STYLE));
    expect(state.active).toBe(true);
    expect(state.style).toBe(EyeDropperStyles.STYLE);

    state = eyeDropperReducer(state, deactivateEyeDropper());
    expect(state.active).toBe(false);
    expect(state.style).toBe(EyeDropperStyles.COLOR);

    state = eyeDropperReducer(state, activateEyeDropper(null, () => {}));
    expect(state.style).toBe(EyeDropperStyles.COLOR);
});
