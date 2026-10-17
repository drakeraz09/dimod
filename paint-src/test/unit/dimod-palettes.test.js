/* eslint-env jest, browser */
import {
    MAX_PALETTES,
    adoptPaletteForCostume,
    deletePalette,
    getCurrentPaletteId,
    getCurrentPaletteName,
    getPalette,
    listPalettes,
    mostRecentPalette,
    openPalette,
    persistCurrentPalette,
    renamePalette,
    resetPalettes,
    savePaletteAs,
    addSwatch,
    getSwatches,
    isPaletteLocked,
    setPaletteLocked,
    setSwatches,
    resetDimod
} from '../../src/dimod/store';

beforeEach(() => {
    try {
        localStorage.clear();
    } catch (error) {
    }
    resetPalettes();
    resetDimod();
});

test('saving names the current colours and binds to them', () => {
    setSwatches(['#ff0000', '#00ff00']);
    setPaletteLocked(true);

    const saved = savePaletteAs('Forest');
    expect(saved.name).toBe('Forest');
    expect(saved.entries).toHaveLength(2);
    expect(saved.lock).toBe(true);
    expect(getCurrentPaletteId()).toBe(saved.id);
    expect(getCurrentPaletteName()).toBe('Forest');
});

test('an edit is written through to the saved palette, with nothing to commit', () => {
    setSwatches(['#ff0000']);
    const saved = savePaletteAs('Forest');

    addSwatch('#0000ff');
    persistCurrentPalette();
    expect(getPalette(saved.id).entries).toHaveLength(2);

    setPaletteLocked(true);
    persistCurrentPalette();
    expect(getPalette(saved.id).lock).toBe(true);

    resetDimod();
    setSwatches(['#123456']);
    expect(persistCurrentPalette()).toBeNull();
    expect(getPalette(saved.id).entries).toHaveLength(2);
});

test('opening a palette replaces the colours and the lock', () => {
    setSwatches(['#ff0000']);
    setPaletteLocked(false);
    const forest = savePaletteAs('Forest');

    setSwatches(['#0000ff', '#00ffff', '#ffffff']);
    setPaletteLocked(true);
    savePaletteAs('Ice');

    expect(openPalette(forest.id)).toBe(true);
    expect(getSwatches().map(entry => entry.fill)).toEqual(['#ff0000']);
    expect(isPaletteLocked()).toBe(false);
    expect(getCurrentPaletteName()).toBe('Forest');
    expect(openPalette('nosuch')).toBe(false);
});

test('the most recently touched palette is the one that comes first', () => {
    setSwatches(['#ff0000']);
    const forest = savePaletteAs('Forest');
    setSwatches(['#0000ff']);
    const ice = savePaletteAs('Ice');

    expect(listPalettes().map(palette => palette.name)).toEqual(['Ice', 'Forest']);
    expect(mostRecentPalette().id).toBe(ice.id);

    openPalette(forest.id);
    expect(listPalettes().map(palette => palette.name)).toEqual(['Forest', 'Ice']);
    expect(mostRecentPalette().id).toBe(forest.id);
});

test('a fresh costume starts with the palette that was used last', () => {
    setSwatches(['#ff0000', '#00ff00']);
    const forest = savePaletteAs('Forest');

    resetDimod();
    expect(getSwatches()).toEqual([]);

    expect(adoptPaletteForCostume().id).toBe(forest.id);
    expect(getSwatches()).toHaveLength(2);
    expect(getCurrentPaletteName()).toBe('Forest');

    resetDimod();
    setSwatches(['#123456']);
    expect(adoptPaletteForCostume()).toBeNull();
    expect(getSwatches().map(entry => entry.fill)).toEqual(['#123456']);
});

test('saving over a name you can already see replaces that palette', () => {
    setSwatches(['#ff0000']);
    const first = savePaletteAs('Forest');
    setSwatches(['#0000ff', '#00ff00']);
    const second = savePaletteAs('forest');

    expect(second.id).toBe(first.id);
    expect(listPalettes()).toHaveLength(1);
    expect(getPalette(first.id).entries).toHaveLength(2);
});

test('deleting removes the palette and unbinds, but keeps the colours on screen', () => {
    setSwatches(['#ff0000', '#00ff00']);
    const forest = savePaletteAs('Forest');

    expect(deletePalette(forest.id)).toBe(true);
    expect(deletePalette(forest.id)).toBe(false);
    expect(listPalettes()).toEqual([]);
    expect(getCurrentPaletteId()).toBeNull();
    expect(getSwatches()).toHaveLength(2);
    expect(persistCurrentPalette()).toBeNull();
});

test('palettes can be renamed', () => {
    setSwatches(['#ff0000']);
    const forest = savePaletteAs('Forest');
    expect(renamePalette(forest.id, 'Woods')).toBe(true);
    expect(getCurrentPaletteName()).toBe('Woods');
    expect(renamePalette('nosuch', 'Woods')).toBe(false);
    renamePalette(forest.id, '   ');
    expect(getCurrentPaletteName()).toBe('Woods');
});

test('there is a ceiling, and hitting it does not lose the current colours', () => {
    for (let i = 0; i < MAX_PALETTES; i++) {
        setSwatches([`#${i.toString(16).padStart(6, '0')}`]);
        savePaletteAs(`Palette ${i}`);
    }
    expect(listPalettes()).toHaveLength(MAX_PALETTES);
    setSwatches(['#abcdef']);
    expect(savePaletteAs('One more')).toBeNull();
    expect(getSwatches().map(entry => entry.fill)).toEqual(['#abcdef']);
});

test('a storage that refuses to write does not take the edit down with it', () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = () => {
        throw new Error('QuotaExceededError');
    };
    try {
        setSwatches(['#ff0000']);
        const saved = savePaletteAs('Forest');
        expect(saved).not.toBeNull();
        expect(getSwatches()).toHaveLength(1);
    } finally {
        localStorage.setItem = setItem;
    }
});

test('palettes survive a reload', () => {
    setSwatches(['#ff0000', '#00ff00']);
    const forest = savePaletteAs('Forest');

    resetPalettes();
    expect(listPalettes().map(palette => palette.name)).toEqual(['Forest']);
    expect(getPalette(forest.id).entries).toHaveLength(2);
});
