/* eslint-env jest */
import {
    MAX_SWATCHES,
    addSwatch,
    clearSwatches,
    getSwatches,
    hasSwatch,
    isPaletteLocked,
    moveSwatch,
    nearestSwatch,
    normalizeColor,
    normalizeStyle,
    removeSwatch,
    setPaletteLocked,
    setSwatches,
    snapToPalette,
    styleKey,
    styleToCss,
    styleToSave,
    getDoc,
    resetDimod
} from '../../src/dimod/store';
import {createDoc, deserializeDoc, isEmptyDoc, serializeDoc} from '../../src/dimod/core';
import GradientTypes from '../../src/lib/gradient-types';

const solid = color => ({
    fill: color,
    fill2: null,
    gradientType: GradientTypes.SOLID,
    stroke: null,
    strokeWidth: 0
});

beforeEach(() => {
    resetDimod();
});

test('colours are normalized to one spelling', () => {
    expect(normalizeColor('#FFF')).toBe('#ffffff');
    expect(normalizeColor('ffffff')).toBe('#ffffff');
    expect(normalizeColor('#FFFFFFFF')).toBe('#ffffff');
    expect(normalizeColor('#12345678')).toBe('#12345678');
    expect(normalizeColor('rebeccapurple')).toBeNull();
    expect(normalizeColor(null)).toBeNull();
    expect(normalizeColor('#12345')).toBeNull();
});

test('a bare colour and a sampled style normalize to the same thing', () => {
    expect(normalizeStyle('#FFF')).toEqual(solid('#ffffff'));
    expect(normalizeStyle({fillColor: '#ffffff'})).toEqual(solid('#ffffff'));
    expect(normalizeStyle({fill: '#ffffff'})).toEqual(solid('#ffffff'));
    expect(normalizeStyle({fillColor: null, strokeColor: null})).toBeNull();
    expect(normalizeStyle(null)).toBeNull();
});

test('a gradient needs two stops, and an outline needs a colour', () => {
    const gradient = normalizeStyle({
        fillColor: '#ff0000',
        fillColor2: '#0000ff',
        gradientType: GradientTypes.RADIAL
    });
    expect(gradient.gradientType).toBe(GradientTypes.RADIAL);
    expect(gradient.fill2).toBe('#0000ff');

    const halfGradient = normalizeStyle({fillColor: '#ff0000', gradientType: GradientTypes.VERTICAL});
    expect(halfGradient.gradientType).toBe(GradientTypes.SOLID);
    expect(halfGradient.fill2).toBeNull();

    expect(normalizeStyle({fillColor: '#ff0000', strokeWidth: 8}).strokeWidth).toBe(0);
    const outlined = normalizeStyle({fillColor: null, strokeColor: '#000000', strokeWidth: 8});
    expect(outlined.stroke).toBe('#000000');
    expect(outlined.strokeWidth).toBe(8);
});

test('chips are drawn from the entry, gradients and outlines included', () => {
    expect(styleToCss(solid('#ff0000')).background).toBe('#ff0000');

    const vertical = normalizeStyle({
        fillColor: '#ff0000', fillColor2: '#0000ff', gradientType: GradientTypes.VERTICAL
    });
    expect(styleToCss(vertical).background).toBe('linear-gradient(to bottom, #ff0000, #0000ff)');

    const radial = normalizeStyle({
        fillColor: '#ff0000', fillColor2: '#0000ff', gradientType: GradientTypes.RADIAL
    });
    expect(styleToCss(radial).background).toContain('radial-gradient');

    const outlined = styleToCss(normalizeStyle({fillColor: null, strokeColor: '#000000', strokeWidth: 8}));
    expect(outlined.borderColor).toBe('#000000');
    expect(outlined.borderWidth).toBe('4px');
    expect(outlined.background).toBeUndefined();
    expect(styleToCss(normalizeStyle({strokeColor: '#000000', strokeWidth: 1})).borderWidth).toBe('1px');
});

test('the same style is only stored once, however it is spelled', () => {
    expect(addSwatch('#FFF')).toEqual(solid('#ffffff'));
    expect(addSwatch('#ffffff')).toBeNull();
    expect(addSwatch({fillColor: '#ffffffff'})).toBeNull();
    expect(getSwatches()).toEqual([solid('#ffffff')]);
    expect(hasSwatch('#FFFFFF')).toBe(true);

    expect(addSwatch({fillColor: '#ffffff', strokeColor: '#000000', strokeWidth: 2})).not.toBeNull();
    expect(getSwatches()).toHaveLength(2);
});

test('add, remove, reorder and clear', () => {
    setSwatches(['#ff0000', '#00ff00', '#0000ff']);
    expect(moveSwatch(0, 2)).toBe(true);
    expect(getSwatches().map(entry => entry.fill)).toEqual(['#00ff00', '#0000ff', '#ff0000']);
    expect(moveSwatch(0, 9)).toBe(false);
    expect(removeSwatch('#0000ff')).toBe(true);
    expect(removeSwatch('#0000ff')).toBe(false);
    expect(getSwatches()).toHaveLength(2);
    expect(removeSwatch(styleKey(solid('#ff0000')))).toBe(true);
    expect(clearSwatches()).toBe(1);
    expect(getSwatches()).toEqual([]);
});

test('setSwatches drops duplicates and anything that is not paintable', () => {
    expect(setSwatches(['#fff', 'nope', '#FFFFFF', null, '#000']).map(entry => entry.fill))
        .toEqual(['#ffffff', '#000000']);
});

test('the palette has a ceiling', () => {
    const many = [];
    for (let i = 0; i < MAX_SWATCHES + 10; i++) many.push(`#${i.toString(16).padStart(6, '0')}`);
    expect(setSwatches(many)).toHaveLength(MAX_SWATCHES);
    expect(addSwatch('#abcdef')).toBeNull();
});

test('nearest swatch weights red and blue by brightness, and ignores gradients', () => {
    setSwatches(['#ff0000', '#00ff00', '#0000ff']);
    expect(nearestSwatch('#ee1111')).toBe('#ff0000');
    expect(nearestSwatch('#101080')).toBe('#0000ff');
    expect(nearestSwatch('not a colour')).toBeNull();

    setSwatches([{fillColor: '#ff0000', fillColor2: '#0000ff', gradientType: GradientTypes.HORIZONTAL}]);
    expect(nearestSwatch('#ee1111')).toBeNull();

    clearSwatches();
    expect(nearestSwatch('#ff0000')).toBeNull();
});

test('the lock is off by default and is the identity when there is nothing to snap to', () => {
    expect(isPaletteLocked()).toBe(false);
    expect(snapToPalette('#123456')).toBe('#123456');
    setPaletteLocked(true);
    expect(snapToPalette('#123456')).toBe('#123456');
    setSwatches(['#000000', '#ffffff']);
    expect(snapToPalette('#eeeeee')).toBe('#ffffff');
    expect(snapToPalette(null)).toBeNull();
    setPaletteLocked(false);
    expect(snapToPalette('#eeeeee')).toBe('#eeeeee');
});

test('the palette rides in the costume blob', () => {
    setSwatches(['#ff0000', {fillColor: '#00ff00', strokeColor: '#000000', strokeWidth: 3}]);
    setPaletteLocked(true);
    expect(isEmptyDoc(getDoc())).toBe(false);

    const restored = deserializeDoc(serializeDoc(getDoc()));
    expect(restored.swatches.lock).toBe(true);
    expect(restored.swatches.entries).toHaveLength(2);
    expect(restored.swatches.entries[1].strokeWidth).toBe(3);
    expect(isEmptyDoc(createDoc())).toBe(true);
});

test('a v1 palette of bare colours is read once and left behind', () => {
    getDoc().swatches = {colors: ['#ff0000', '#00ff00'], lock: true};
    expect(getSwatches().map(entry => entry.fill)).toEqual(['#ff0000', '#00ff00']);
    expect(isPaletteLocked()).toBe(true);
    expect(getDoc().swatches.colors).toBeUndefined();
});

test('what "+" saves: the selected shape first, the pickers second', () => {
    const colorState = {
        fillColor: {primary: '#111111', secondary: null, gradientType: GradientTypes.SOLID},
        strokeColor: {primary: null, secondary: null, gradientType: GradientTypes.SOLID},
        strokeWidth: 0
    };

    expect(styleToSave(null, colorState)).toEqual(solid('#111111'));

    const selection = {
        fillColor: '#ff0000',
        fillColor2: '#0000ff',
        gradientType: GradientTypes.HORIZONTAL,
        strokeColor: '#000000',
        strokeWidth: 4
    };
    expect(styleToSave(selection, colorState)).toEqual({
        fill: '#ff0000',
        fill2: '#0000ff',
        gradientType: GradientTypes.HORIZONTAL,
        stroke: '#000000',
        strokeWidth: 4
    });

    expect(styleToSave({fillColor: null, strokeColor: null, strokeWidth: 0}, colorState))
        .toEqual(solid('#111111'));
    expect(styleToSave(null, null)).toBeNull();
});

test('an outline-only style survives the save and comes back whole', () => {
    const entry = addSwatch({fillColor: null, strokeColor: '#123456', strokeWidth: 6});
    expect(entry).toEqual({
        fill: null,
        fill2: null,
        gradientType: GradientTypes.SOLID,
        stroke: '#123456',
        strokeWidth: 6
    });
    expect(getSwatches()[0]).toEqual(entry);
});
