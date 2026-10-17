/* eslint-env jest, browser */
import paper from '@turbowarp/paper';

import {drawPivotHandle} from '../../src/helper/tools/dimod-tools';
import {setSelectionPivot} from '../../src/dimod/pivot';
import {setupLayers} from '../../src/helper/layer';
import Formats from '../../src/lib/format';

let square;

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    setupLayers(Formats.VECTOR);
    square = new paper.Path.Rectangle({point: [100, 100], size: [100, 100], insert: true});
    square.fillColor = 'red';
});

test('the crosshair sits on the center of the selection until an anchor moves it', () => {
    const handle = drawPivotHandle([square], true);
    expect(handle.position.round()).toEqual(square.bounds.center.round());

    setSelectionPivot([square], square.bounds.topLeft);
    expect(drawPivotHandle([square], true).position.round()).toEqual(square.bounds.topLeft.round());
});

test('the crosshair is hit testable, which is what makes it draggable', () => {
    const handle = drawPivotHandle([square], true);
    expect(handle.data.isPivotHandle).toBe(true);
    expect(handle.locked).toBe(false);
    expect(handle.guide).toBeFalsy();

    const hits = paper.project.hitTestAll(square.bounds.center, {fill: true, stroke: true});
    expect(hits.some(hit => hit.item.data && hit.item.data.isPivotHandle)).toBe(true);
});

test('the bitmap crosshair is only a marker', () => {
    const handle = drawPivotHandle([square], false);
    expect(handle.locked).toBe(true);

    const hits = paper.project.hitTestAll(square.bounds.center, {fill: true, stroke: true});
    expect(hits.some(hit => hit.item.data && hit.item.data.isPivotHandle)).toBe(false);
});

test('nothing selected means no crosshair', () => {
    expect(drawPivotHandle([], true)).toBeNull();
});
