/* eslint-env jest */
import paper from '@turbowarp/paper';

import {itemAt, readStyle, sampleStyleAt} from '../../src/dimod/items';
import GradientTypes from '../../src/lib/gradient-types';

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    paper.project.activeLayer.data.isPaintingLayer = true;
});

const shape = style => new paper.Path.Rectangle(Object.assign({
    point: [100, 100],
    size: [100, 100]
}, style));

test('a solid style comes back whole', () => {
    const item = shape({fillColor: '#ff0000', strokeColor: '#0000ff', strokeWidth: 4});
    const style = readStyle(item);
    expect(style.fillColor).toBe('#ff0000');
    expect(style.strokeColor).toBe('#0000ff');
    expect(style.strokeWidth).toBe(4);
    expect(style.gradientType).toBe(GradientTypes.SOLID);
    expect(style.fillColor2).toBeNull();
});

test('no fill and no stroke are real answers, not failures', () => {
    const item = shape({fillColor: null, strokeColor: null});
    const style = readStyle(item);
    expect(style.fillColor).toBeNull();
    expect(style.strokeColor).toBeNull();
    expect(style.strokeWidth).toBe(0);
});

test('a gradient comes back as both stops and the right type', () => {
    const horizontal = shape({
        fillColor: {
            gradient: {stops: ['#ff0000', '#0000ff']},
            origin: [100, 150],
            destination: [200, 150]
        }
    });
    const horizontalStyle = readStyle(horizontal);
    expect(horizontalStyle.gradientType).toBe(GradientTypes.HORIZONTAL);
    expect(horizontalStyle.fillColor).toBe('#ff0000');
    expect(horizontalStyle.fillColor2).toBe('#0000ff');

    const vertical = shape({
        fillColor: {
            gradient: {stops: ['#ff0000', '#0000ff']},
            origin: [150, 100],
            destination: [150, 200]
        }
    });
    expect(readStyle(vertical).gradientType).toBe(GradientTypes.VERTICAL);

    const radial = shape({
        fillColor: {
            gradient: {stops: ['#ff0000', '#0000ff'], radial: true},
            origin: [150, 150],
            destination: [200, 150]
        }
    });
    expect(readStyle(radial).gradientType).toBe(GradientTypes.RADIAL);
});

test('sampling picks the topmost art and nothing else', () => {
    const below = shape({fillColor: '#ff0000'});
    const above = shape({fillColor: '#00ff00'});
    expect(itemAt(new paper.Point(150, 150))).toBe(above);
    expect(sampleStyleAt(new paper.Point(150, 150)).fillColor).toBe('#00ff00');
    expect(below.fillColor.toCSS(true)).toBe('#ff0000');

    expect(sampleStyleAt(new paper.Point(900, 700))).toBeNull();
});

test('guides and helper items are furniture, not art', () => {
    const guide = shape({fillColor: '#ff0000'});
    guide.guide = true;
    expect(itemAt(new paper.Point(150, 150))).toBeNull();

    const helper = shape({fillColor: '#ff0000'});
    helper.data = {isHelperItem: true};
    expect(itemAt(new paper.Point(150, 150))).toBeNull();
});
