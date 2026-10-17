/* eslint-env jest, browser */
import paper from '@turbowarp/paper';

import {SYMBOLS_ENABLED} from '../../src/lib/dimod-flags';
import {
    adoptDocSymbols,
    describeSymbols,
    readSymbolPlacement,
    rebakeImported,
    writeUsedSymbolsToDoc,
    readItemDataAttributes,
    writeItemDataAttributes,
    syncItemData
} from '../../src/dimod/items';
import {getDoc, resetDimod} from '../../src/dimod/store';

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    paper.project.activeLayer.data.isPaintingLayer = true;
    resetDimod();
});

test('the feature is off', () => {
    expect(SYMBOLS_ENABLED).toBe(false);
});

test('nothing walks the tree or renders a preview while it is off', () => {
    expect(describeSymbols()).toEqual([]);
    expect(adoptDocSymbols()).toBe(0);
    expect(rebakeImported()).toBe(0);
});

test("a costume's own definitions are left exactly as they arrived", () => {
    const symbols = {abc123: {id: 'abc123', name: 'Wheel', json: '{"applyMatrix":true}', rev: 3}};
    getDoc().symbols = symbols;

    expect(writeUsedSymbolsToDoc()).toBe(0);
    expect(getDoc().symbols).toBe(symbols);
});

test('an instance survives a re-save with its link intact', () => {
    const group = new paper.Group([new paper.Path.Rectangle({point: [0, 0], size: [10, 10]})]);
    const node = {
        getAttribute: name => {
            if (name === 'data-dimod-symbol') return 'abc123,1,0,0,1,4,5';
            return null;
        }
    };
    readItemDataAttributes(group, node);
    expect(group.data.dimod.symbol[0]).toBe('abc123');

    expect(readSymbolPlacement(group)).toEqual(group.data.dimod.symbol);
    syncItemData(group);

    const written = {};
    writeItemDataAttributes(group, {
        setAttribute: (name, value) => {
            written[name] = value;
        },
        removeAttribute: name => {
            delete written[name];
        }
    });
    expect(written['data-dimod-symbol']).toBe('abc123,1,0,0,1,4,5');
});
