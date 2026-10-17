/* eslint-env jest, browser */

jest.mock('../../src/lib/dimod-flags', () => ({SYMBOLS_ENABLED: true}));

import paper from '@turbowarp/paper';

import {
    countInstances,
    createSymbol,
    describeSymbols,
    detachInstanceContaining,
    getSymbolThumbnail,
    deleteSymbol,
    detachInstance,
    getInstanceSymbolId,
    getInstances,
    getSymbol,
    getSymbols,
    isInstance,
    parseSymbolPlacement,
    placeInstance,
    readSymbolPlacement,
    redefineSymbol,
    renameSymbol,
    adoptDocSymbols,
    resetSymbolLibrary,
    setSpriteScope,
    setSymbolScope,
    SymbolScopes,
    writeUsedSymbolsToDoc,
    serializeSymbolPlacement,
    writeSymbolPlacement
} from '../../src/dimod/items';
import {markDirty, runPass, getDoc, resetDimod} from '../../src/dimod/store';
import {CENTER} from '../../src/helper/view';
import {scaleWithStrokes} from '../../src/helper/math';

const rect = (x, y, width, height) => new paper.Path.Rectangle({
    point: [x, y],
    size: [width, height],
    fillColor: '#ff0000'
});

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    paper.project.activeLayer.data.isPaintingLayer = true;
    try {
        localStorage.clear();
    } catch (error) {
    }
    resetSymbolLibrary();
    setSpriteScope(null);
    resetDimod();
});

test('creating a symbol replaces the art with an instance in the same place', () => {
    const source = rect(100, 100, 40, 20);
    const bounds = source.bounds.clone();

    const created = createSymbol('Star', [source]);
    expect(created).not.toBeNull();
    expect(getSymbols().map(symbol => symbol.name)).toEqual(['Star']);

    const instance = created.instance;
    expect(isInstance(instance)).toBe(true);
    expect(instance.parent).toBe(paper.project.activeLayer);
    expect(source.parent).toBeNull();
    expect(instance.bounds.center.round()).toEqual(bounds.center.round());
    expect(instance.bounds.width).toBeCloseTo(bounds.width, 4);
});

test('an instance keeps its placement in its own matrix, not in its children', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const instance = created.instance;
    expect(instance.applyMatrix).toBe(false);

    instance.translate(new paper.Point(50, 0));
    instance.rotate(90);
    expect(instance.matrix.tx).toBeCloseTo(170, 4);
    expect(Math.round(instance.matrix.a)).toBe(0);
});

test('placing a copy makes a second instance of the same definition', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const second = placeInstance(created.symbol.id, CENTER, paper.project.activeLayer);

    expect(second).not.toBeNull();
    expect(getInstanceSymbolId(second)).toBe(created.symbol.id);
    expect(countInstances(created.symbol.id)).toBe(2);
    expect(second.bounds.center.round()).toEqual(CENTER.round());
    expect(second.bounds.width).toBeCloseTo(created.instance.bounds.width, 4);
    expect(second.children[0].fillColor.toCSS(true)).toBe('#ff0000');
});

test('redefining a symbol repaints every instance and keeps each placement', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const symbolId = created.symbol.id;
    const elsewhere = placeInstance(symbolId, new paper.Point(400, 300), paper.project.activeLayer);
    const elsewhereCenter = elsewhere.bounds.center.round();

    const replacement = rect(600, 600, 80, 80);
    expect(redefineSymbol(symbolId, [replacement])).not.toBeNull();
    runPass();

    const instances = getInstances(symbolId);
    expect(instances).toHaveLength(3);
    for (const instance of instances) {
        expect(instance.bounds.width).toBeCloseTo(80, 4);
        expect(instance.bounds.height).toBeCloseTo(80, 4);
    }
    const moved = instances.find(instance => instance.bounds.center.round().equals(elsewhereCenter));
    expect(moved).toBeDefined();
});

test('a redefine reaches instances through the pass, not only through the call', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const symbolId = created.symbol.id;
    placeInstance(symbolId, new paper.Point(400, 300), paper.project.activeLayer);

    const definition = getSymbol(symbolId);
    const temporary = rect(0, 0, 8, 8);
    temporary.position = new paper.Point(0, 0);
    definition.json = new paper.Group([temporary]).exportJSON({asString: true});
    markDirty('symbol', symbolId);

    runPass();
    for (const instance of getInstances(symbolId)) {
        expect(instance.bounds.width).toBeCloseTo(8, 4);
    }
});

test('detaching keeps the art and drops the link', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const instance = created.instance;
    const before = instance.bounds.clone();

    expect(detachInstance(instance)).toBe(true);
    expect(detachInstance(instance)).toBe(false);
    expect(isInstance(instance)).toBe(false);
    expect(instance.applyMatrix).toBe(true);
    expect(instance.bounds.center.round()).toEqual(before.center.round());
    expect(getSymbols()).toHaveLength(1);
});

test('deleting a symbol detaches its instances instead of deleting art', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const symbolId = created.symbol.id;
    placeInstance(symbolId, CENTER, paper.project.activeLayer);

    expect(deleteSymbol(symbolId)).toBe(2);
    expect(getSymbols()).toHaveLength(0);
    expect(getInstances()).toHaveLength(0);
    expect(paper.project.activeLayer.children).toHaveLength(2);
});

test('symbols can be renamed', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    expect(renameSymbol(created.symbol.id, 'Wheel')).toBe(true);
    expect(getSymbol(created.symbol.id).name).toBe('Wheel');
    expect(renameSymbol('nope', 'Wheel')).toBe(false);
});

test('a definition made from an instance is flattened, not nested', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const outer = createSymbol('Outer', [created.instance]);

    expect(outer).not.toBeNull();
    expect(getInstanceSymbolId(outer.instance)).toBe(outer.symbol.id);
    expect(countInstances(created.symbol.id)).toBe(0);
});

test('the placement survives the attribute round trip', () => {
    const created = createSymbol('Box', [rect(100, 100, 40, 20)]);
    const instance = created.instance;
    instance.rotate(30);
    instance.scale(2);

    const written = readSymbolPlacement(instance);
    expect(written[0]).toBe(created.symbol.id);
    const parsed = parseSymbolPlacement(serializeSymbolPlacement(written));
    expect(parsed[0]).toBe(created.symbol.id);
    for (let i = 1; i < written.length; i++) {
        expect(parsed[i]).toBeCloseTo(written[i], 4);
    }

    const target = new paper.Group([rect(0, 0, 1, 1)]);
    writeSymbolPlacement(target, parsed);
    expect(target.data.symbolId).toBe(created.symbol.id);
    expect(target.data.symbolPlacement.tx).toBeCloseTo(instance.matrix.tx, 3);
    expect(target.data.symbolPlacement.a).toBeCloseTo(instance.matrix.a, 3);
});

test('a placement whose symbol is missing is dropped, and the art is kept', () => {
    const target = new paper.Group([rect(0, 0, 10, 10)]);
    writeSymbolPlacement(target, ['nosuch', 1, 0, 0, 1, 0, 0]);
    expect(target.data.symbolId).toBeUndefined();
    expect(target.children).toHaveLength(1);

    expect(readSymbolPlacement(target)).toBeNull();
    expect(parseSymbolPlacement('too,short')).toBeNull();
    expect(parseSymbolPlacement('id,1,0,0,1,x,0')).toBeNull();
});

test('creating a symbol from nothing does not create one', () => {
    expect(createSymbol('Empty', [])).toBeNull();
    expect(getSymbols()).toHaveLength(0);
    expect(placeInstance('nosuch', CENTER, paper.project.activeLayer)).toBeNull();
});

test('the placement matrix and stroke scaling do not agree yet', () => {
    const outlined = rect(100, 100, 40, 20);
    outlined.strokeColor = '#000000';
    outlined.strokeWidth = 4;
    const created = createSymbol('Outlined', [outlined]);
    const child = created.instance.children[0];

    scaleWithStrokes(paper.project.activeLayer, 0.5, new paper.Point());
    expect(child.strokeWidth).toBe(2);
    expect(created.instance.matrix.a).toBeCloseTo(0.5, 6);

    scaleWithStrokes(paper.project.activeLayer, 2, new paper.Point());
    expect(child.strokeWidth).toBe(4);
});

test('the panel gets a name, a live instance count and a preview per symbol', () => {
    const created = createSymbol('Wheel', [rect(100, 100, 40, 20)]);
    placeInstance(created.symbol.id, CENTER, paper.project.activeLayer);

    const [described] = describeSymbols();
    expect(described.id).toBe(created.symbol.id);
    expect(described.name).toBe('Wheel');
    expect(described.instances).toBe(2);
    expect(described.thumbnail).toMatch(/^data:image\/svg\+xml,/);
    expect(paper.project.activeLayer.children).toHaveLength(2);
});

test('a preview is cached until the symbol actually changes', () => {
    const created = createSymbol('Wheel', [rect(100, 100, 40, 20)]);
    const first = getSymbolThumbnail(created.symbol.id);
    expect(getSymbolThumbnail(created.symbol.id)).toBe(first);

    redefineSymbol(created.symbol.id, [rect(500, 500, 90, 90)]);
    expect(getSymbolThumbnail(created.symbol.id)).not.toBe(first);
    expect(getSymbolThumbnail('nosuch')).toBeNull();
});

test('detaching reaches up from a child, which is how reshape breaks the link', () => {
    const created = createSymbol('Wheel', [rect(100, 100, 40, 20)]);
    const child = created.instance.children[0];

    expect(detachInstanceContaining(child)).toBe(created.instance);
    expect(isInstance(created.instance)).toBe(false);
    expect(detachInstanceContaining(child)).toBeNull();
    expect(detachInstanceContaining(rect(0, 0, 5, 5))).toBeNull();
});

test('the library outlives the costume it was made in', () => {
    const created = createSymbol('Wheel', [rect(100, 100, 40, 20)]);

    resetDimod();
    expect(getSymbol(created.symbol.id)).not.toBeNull();
    expect(getSymbols().map(symbol => symbol.name)).toEqual(['Wheel']);

    const instance = placeInstance(created.symbol.id, CENTER, paper.project.activeLayer);
    expect(instance).not.toBeNull();
});

test('only the symbols a costume uses are written into its blob', () => {
    const used = createSymbol('Used', [rect(100, 100, 40, 20)]);
    const spare = createSymbol('Spare', [rect(300, 300, 40, 20)]);
    detachInstance(spare.instance);

    expect(writeUsedSymbolsToDoc()).toBe(1);
    expect(Object.keys(getDoc().symbols)).toEqual([used.symbol.id]);
    expect(getSymbol(spare.symbol.id)).not.toBeNull();
});

test('a costume brings its own symbols into the library', () => {
    resetSymbolLibrary();
    resetDimod();
    getDoc().symbols = {abc123: {id: 'abc123', name: 'Imported', json: '{"applyMatrix":true}'}};
    expect(getSymbol('abc123').name).toBe('Imported');

    expect(adoptDocSymbols()).toBe(1);
    resetDimod();
    expect(getSymbol('abc123').name).toBe('Imported');
});

test('two projects that minted the same id do not end up sharing art', () => {
    const mine = createSymbol('Mine', [rect(100, 100, 40, 20)]);
    const id = mine.symbol.id;
    const myJson = getSymbol(id).json;

    const theirs = placeInstance(id, CENTER, paper.project.activeLayer);
    getDoc().symbols = {[id]: {id, name: 'Theirs', json: '{"applyMatrix":true}'}};

    expect(adoptDocSymbols()).toBe(1);
    expect(getSymbol(id).json).toBe(myJson);
    expect(theirs.data.symbolId).not.toBe(id);
    expect(getSymbol(theirs.data.symbolId).name).toBe('Theirs');
});

test('a library that cannot be saved does not take the edit down with it', () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = () => {
        throw new Error('QuotaExceededError');
    };
    try {
        const created = createSymbol('Wheel', [rect(100, 100, 40, 20)]);
        expect(created).not.toBeNull();
        expect(getSymbol(created.symbol.id)).not.toBeNull();
    } finally {
        localStorage.setItem = setItem;
    }
});

test('reopening a costume saved before the last edit does not fork the symbol', () => {
    const created = createSymbol('Wheel', [rect(100, 100, 40, 20)]);
    const id = created.symbol.id;
    const staleJson = getSymbol(id).json;

    redefineSymbol(id, [rect(500, 500, 90, 90)]);
    const currentJson = getSymbol(id).json;
    expect(getSymbol(id).rev).toBe(2);

    resetDimod();
    const instance = placeInstance(id, CENTER, paper.project.activeLayer);
    getDoc().symbols = {[id]: {id, name: 'Wheel', json: staleJson, rev: 1, scope: 'global'}};

    expect(adoptDocSymbols()).toBe(0);
    expect(getSymbol(id).json).toBe(currentJson);
    expect(instance.data.symbolId).toBe(id);
    expect(getSymbols()).toHaveLength(1);
});

test('a costume saved after the library last heard about a symbol wins', () => {
    const created = createSymbol('Wheel', [rect(100, 100, 40, 20)]);
    const id = created.symbol.id;

    resetDimod();
    getDoc().symbols = {[id]: {id, name: 'Wheel', json: '{"applyMatrix":true}', rev: 9, scope: 'global'}};
    expect(adoptDocSymbols()).toBe(1);
    expect(getSymbol(id).json).toBe('{"applyMatrix":true}');
    expect(getSymbol(id).rev).toBe(9);
});

test('scope decides where a symbol is stored and whether it is listed', () => {
    setSpriteScope('sprite-a');

    const local = createSymbol('Local', [rect(100, 100, 20, 20)], SymbolScopes.COSTUME);
    const mine = createSymbol('Mine', [rect(200, 100, 20, 20)], SymbolScopes.SPRITE);
    const everywhere = createSymbol('Everywhere', [rect(300, 100, 20, 20)], SymbolScopes.GLOBAL);

    const named = () => getSymbols()
        .map(symbol => symbol.name)
        .sort();
    expect(named()).toEqual(['Everywhere', 'Local', 'Mine']);
    expect(Object.keys(getDoc().symbols)).toEqual([local.symbol.id]);

    resetDimod();
    expect(named()).toEqual(['Everywhere', 'Mine']);
    expect(getSymbol(local.symbol.id)).toBeNull();

    setSpriteScope('sprite-b');
    expect(getSymbols().map(symbol => symbol.name)).toEqual(['Everywhere']);
    expect(getSymbol(mine.symbol.id)).not.toBeNull();

    setSpriteScope('sprite-a');
    expect(getSymbols()).toHaveLength(2);
    expect(everywhere.symbol.scope).toBe(SymbolScopes.GLOBAL);
});

test('changing scope moves a symbol between the blob and the library', () => {
    setSpriteScope('sprite-a');
    const created = createSymbol('Wheel', [rect(100, 100, 40, 20)], SymbolScopes.GLOBAL);
    const id = created.symbol.id;

    expect(setSymbolScope(id, SymbolScopes.COSTUME)).toBe(true);
    expect(Object.keys(getDoc().symbols)).toEqual([id]);
    resetDimod();
    expect(getSymbol(id)).toBeNull();

    resetSymbolLibrary();
    resetDimod();
    const again = createSymbol('Wheel', [rect(100, 100, 40, 20)], SymbolScopes.COSTUME);
    expect(setSymbolScope(again.symbol.id, SymbolScopes.SPRITE)).toBe(true);
    expect(getSymbol(again.symbol.id).spriteId).toBe('sprite-a');
    expect(getDoc().symbols[again.symbol.id]).toBeUndefined();

    expect(setSymbolScope(again.symbol.id, 'nonsense')).toBe(false);
    expect(setSymbolScope('nosuch', SymbolScopes.GLOBAL)).toBe(false);
});
