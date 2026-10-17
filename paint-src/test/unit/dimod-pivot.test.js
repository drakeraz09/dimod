/* eslint-env jest, browser */
import paper from '@turbowarp/paper';

import {
    clearPivot,
    clearSelectionPivot,
    getEffectivePivot,
    getEffectiveSelectionPivot,
    getPivot,
    getSelectionPivot,
    hasPivot,
    isDefaultPivot,
    setPivot,
    setSelectionPivot,
    snapPivot
} from '../../src/dimod/pivot';
import {
    applyItemData,
    getItemData,
    readItemDataAttributes,
    syncItemData,
    writeItemDataAttributes
} from '../../src/dimod/items';
import {rebuildIndex, resetDimod} from '../../src/dimod/store';
import {CENTER} from '../../src/helper/view';
import {groupItems} from '../../src/helper/group';

let layer;
let square;

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    resetDimod();
    layer = paper.project.activeLayer;
    layer.data.isPaintingLayer = true;
    square = new paper.Path.Rectangle({point: [100, 100], size: [50, 50], insert: true});
    square.fillColor = 'red';
    rebuildIndex();
});

test('an item with no anchor transforms around its bounds center', () => {
    expect(hasPivot(square)).toBe(false);
    expect(getPivot(square)).toBeNull();
    expect(getEffectivePivot(square)).toEqual(square.bounds.center);
});

test('the anchor round trips through project space', () => {
    setPivot(square, new paper.Point(100, 100));
    expect(hasPivot(square)).toBe(true);
    expect(getPivot(square).round()).toEqual(new paper.Point(100, 100));

    clearPivot(square);
    expect(hasPivot(square)).toBe(false);
});

test('the anchor follows the item', () => {
    setPivot(square, square.bounds.topLeft);
    square.translate(new paper.Point(40, 25));
    expect(getPivot(square).round()).toEqual(square.bounds.topLeft.round());

    square.rotate(90, square.bounds.center);
    expect(getPivot(square).round()).toEqual(square.bounds.topRight.round());
});

test('dragging the anchor snaps to bounds points and the rotation center', () => {
    const corner = square.bounds.topLeft;
    expect(snapPivot([square], corner.add(2, 2)).round()).toEqual(corner.round());
    expect(snapPivot([square], square.bounds.center.add(1, 0)).round()).toEqual(square.bounds.center.round());
    expect(snapPivot([square], CENTER.subtract(3, 0)).round()).toEqual(CENTER.round());

    const free = square.bounds.center.add(25, 25);
    expect(snapPivot([square], free)).toEqual(free);
});

test('dropping the anchor back on the center counts as having none', () => {
    expect(isDefaultPivot([square], square.bounds.center)).toBe(true);
    expect(isDefaultPivot([square], square.bounds.topLeft)).toBe(false);
});

test('a group is one item and carries its own anchor', () => {
    const other = new paper.Path.Rectangle({point: [300, 300], size: [10, 10]});
    const group = new paper.Group([square, other]);

    setSelectionPivot([group], group.bounds.topLeft);
    expect(getSelectionPivot([group]).round()).toEqual(group.bounds.topLeft.round());

    group.rotate(90, group.bounds.center);
    expect(getSelectionPivot([group]).round()).toEqual(group.bounds.topRight.round());
});

test('a loose multi-selection only has an anchor when its items agree', () => {
    const other = new paper.Path.Rectangle({point: [300, 300], size: [10, 10]});
    const items = [square, other];

    expect(getSelectionPivot(items)).toBeNull();
    expect(getEffectiveSelectionPivot(items).round())
        .toEqual(square.bounds.unite(other.bounds).center.round());

    const anchor = new paper.Point(200, 200);
    setSelectionPivot(items, anchor);
    expect(getSelectionPivot(items).round()).toEqual(anchor.round());

    setPivot(other, new paper.Point(210, 200));
    expect(getSelectionPivot(items)).toBeNull();

    clearSelectionPivot(items);
    expect(hasPivot(square)).toBe(false);
    expect(hasPivot(other)).toBe(false);
});

test('the snap targets follow the whole selection, not one item', () => {
    const other = new paper.Path.Rectangle({point: [300, 300], size: [10, 10]});
    const items = [square, other];
    const center = square.bounds.unite(other.bounds).center;

    expect(snapPivot(items, center.add(1, 1)).round()).toEqual(center.round());
});

test('the anchor rides on the item\'s own element', () => {
    setPivot(square, square.bounds.topLeft);
    syncItemData(square);

    expect(getItemData(square)).toEqual({pivot: [100 - CENTER.x, 100 - CENTER.y]});

    const node = new DOMParser().parseFromString(
        '<path xmlns="http://www.w3.org/2000/svg" d="M0 0"/>', 'text/xml').documentElement;
    writeItemDataAttributes(square, node);
    expect(node.getAttribute('data-dimod-pivot')).toBe(`${100 - CENTER.x},${100 - CENTER.y}`);

    const imported = new paper.Path.Rectangle({point: [100, 100], size: [50, 50]});
    readItemDataAttributes(imported, node);
    expect(hasPivot(imported)).toBe(false);
    applyItemData(imported);
    expect(getPivot(imported).round()).toEqual(new paper.Point(100, 100));
});

test('an item with no anchor carries no attribute', () => {
    const node = new DOMParser().parseFromString(
        '<path xmlns="http://www.w3.org/2000/svg" d="M0 0" data-dimod-pivot="1,2"/>', 'text/xml').documentElement;
    syncItemData(square);
    expect(getItemData(square)).toBeNull();

    writeItemDataAttributes(square, node);
    expect(node.hasAttribute('data-dimod-pivot')).toBe(false);
});

test('a malformed attribute is ignored rather than applied', () => {
    const node = new DOMParser().parseFromString(
        '<path xmlns="http://www.w3.org/2000/svg" d="M0 0" data-dimod-pivot="nonsense"/>', 'text/xml').documentElement;
    readItemDataAttributes(square, node);
    applyItemData(square);
    expect(hasPivot(square)).toBe(false);
});

test('the center pulls from further away than the corners do', () => {
    const big = new paper.Path.Rectangle({point: [100, 100], size: [200, 200]});
    const middle = big.bounds.center;

    expect(snapPivot([big], middle.add(12, 0)).round()).toEqual(middle.round());
    const corner = big.bounds.topLeft;
    expect(snapPivot([big], corner.add(3, 3)).round()).toEqual(corner.round());
    const free = middle.add(60, 60);
    expect(snapPivot([big], free)).toEqual(free);
});

test('grouping carries the selection anchor onto the group', () => {
    const left = new paper.Path.Rectangle({point: [0, 0], size: [20, 20]});
    const right = new paper.Path.Rectangle({point: [100, 0], size: [20, 20]});
    const items = [left, right];
    const anchor = new paper.Point(110, 10);
    setSelectionPivot(items, anchor);

    const noop = () => {};
    const group = groupItems(items, noop, noop, noop);

    expect(group).toBeTruthy();
    expect(getPivot(group).round()).toEqual(anchor.round());
    expect(hasPivot(left)).toBe(false);
    expect(hasPivot(right)).toBe(false);
    expect(getEffectiveSelectionPivot([group]).round()).toEqual(anchor.round());
});

test('grouping things with no anchor does not invent one', () => {
    const items = [
        new paper.Path.Rectangle({point: [0, 0], size: [20, 20]}),
        new paper.Path.Rectangle({point: [100, 0], size: [20, 20]})
    ];
    const noop = () => {};
    const group = groupItems(items, noop, noop, noop);
    expect(hasPivot(group)).toBe(false);
});

test('grouping items that disagree about the anchor does not pick one', () => {
    const left = new paper.Path.Rectangle({point: [0, 0], size: [20, 20]});
    const right = new paper.Path.Rectangle({point: [100, 0], size: [20, 20]});
    setPivot(left, new paper.Point(0, 0));
    setPivot(right, new paper.Point(120, 20));

    const noop = () => {};
    const group = groupItems([left, right], noop, noop, noop);
    expect(hasPivot(group)).toBe(false);
});
