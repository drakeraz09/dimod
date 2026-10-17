const DEFAULT_RGB = [108, 92, 231];
let accentRgb = DEFAULT_RGB;

let GUIDE_ACCENT = '#6c5ce7';

let GUIDE_ACCENT_WASH = 'rgba(108, 92, 231, 0.12)';

const guideAccentRgba = alpha => `rgba(${accentRgb.join(', ')}, ${alpha})`;

const syncGuideColors = function () {
    let hex = '';
    try {
        hex = getComputedStyle(document.documentElement).getPropertyValue('--paint-motion-primary')
            .trim();
    } catch (e) {
        hex = '';
    }
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    accentRgb = m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : DEFAULT_RGB;
    GUIDE_ACCENT = m ? hex : '#6c5ce7';
    GUIDE_ACCENT_WASH = guideAccentRgba(0.12);
};
syncGuideColors();

const GUIDE_HALO = 'rgba(255, 255, 255, 0.9)';

const SELECTION_STROKE_WIDTH = 1.5;

export {
    GUIDE_ACCENT,
    GUIDE_ACCENT_WASH,
    GUIDE_HALO,
    SELECTION_STROKE_WIDTH,
    guideAccentRgba,
    syncGuideColors
};
