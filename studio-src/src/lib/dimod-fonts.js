const STORAGE_KEY = 'font';
const GUEST_SETTINGS_KEY = 'guest_frontend_settings';
const HELVETICA = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const DEFAULT_FONT = 'nunito';
const FONTS = [
    {name: 'nunito', label: 'Nunito', family: `'Nunito', sans-serif`, url: 'Nunito:wght@400;600;700;800'},
    {name: 'helvetica', label: 'Helvetica', family: HELVETICA},
    {name: 'comic-sans',
        label: 'Comic Sans',
        family: `'Comic Sans MS', 'Chalkboard SE', sans-serif`,
        css: 'https://fonts.cdnfonts.com/css/comic-sans-ms-coptic'},
    {name: 'opendyslexic',
        label: 'OpenDyslexic',
        family: `'OpenDyslexic', sans-serif`,
        src: 'https://draker.8os.space/OpenDyslexic-Regular.ttf',
        fontName: 'OpenDyslexic'},
    {name: 'inter', label: 'Inter', family: `'Inter', sans-serif`, url: 'Inter:wght@400;700'},
    {name: 'poppins', label: 'Poppins', family: `'Poppins', sans-serif`, url: 'Poppins:wght@400;600'},
    {name: 'rubik', label: 'Rubik', family: `'Rubik', sans-serif`, url: 'Rubik:wght@400;700'},
    {name: 'merriweather', label: 'Merriweather', family: `'Merriweather', serif`, url: 'Merriweather:wght@400;700'},
    {name: 'jetbrains-mono', label: 'JB Mono', family: `'JetBrains Mono', monospace`, url: 'JetBrains+Mono:wght@400;700'},
    {name: 'fredoka', label: 'Fredoka', family: `'Fredoka', sans-serif`, url: 'Fredoka:wght@400;600'},
    {name: 'ms-gothic',
        label: 'MS Gothic',
        family: `'MS Gothic', 'MS PGothic', 'Hiragino Kaku Gothic Pro', monospace`,
        src: '/fonts/MS-Gothic.woff2',
        fontName: 'MS Gothic',
        local: ['MS Gothic', 'MS-Gothic']},
    {name: 'determination',
        label: 'Determination',
        family: `'Determination Bold', sans-serif`,
        src: 'https://draker.8os.space/Determination-Bold.ttf',
        fontName: 'Determination Bold'},
    {name: 'monospace', label: 'Monospace', family: `ui-monospace, 'Cascadia Code', Menlo, Monaco, Consolas, monospace`},
    {name: 'vcr', label: 'VCR', family: `'VCR', sans-serif`, src: 'https://draker.8os.space/VCR.ttf', fontName: 'VCR'},
    {name: 'oldlondon',
        label: 'Old London',
        family: `'Old London', sans-serif`,
        src: 'https://draker.8os.space/OldLondon.ttf',
        fontName: 'Old London'},
    {name: 'wingdings',
        label: 'Wingdings (Oh no.)',
        family: `'Wingdings', sans-serif`,
        src: 'https://draker.8os.space/Wingdings-Regular.ttf',
        fontName: 'Wingdings'},
    {name: 'drakerfont',
        label: 'Draker Writes A Poopoo Font',
        family: `'Draker Font', monospace`,
        src: 'https://draker.8os.space/draker-writes-a-poopoo-font.ttf',
        fontName: 'Draker Font'}
];
const getFont = name => FONTS.find(font => font.name === name) || FONTS[0];
const BLOCKLY_SELECTORS = [
    '.blocklyText',
    '.blocklyHtmlInput',
    '.blocklyFlyoutLabelText',
    '.blocklyTreeLabel',
    '.blocklyTooltipDiv',
    '.blocklyNumPadButton',
    '.blocklyToolboxDiv',
    '.valueReportBox',
    '.scratchCommentText',
    '.scratchColourPickerLabel',
    '.scratchNotePickerKeyLabel'
].join(',\n');
const BLOCKLY_CSS = `${BLOCKLY_SELECTORS} {
    font-family: var(--dimod-font-ui, ${HELVETICA});
}
`;
let blocklyStylesheet = null;
const injectBlocklyCSS = () => {
    if (blocklyStylesheet) { return; }
    blocklyStylesheet = document.createElement('style');
    blocklyStylesheet.textContent = BLOCKLY_CSS;
    document.head.appendChild(blocklyStylesheet);
};
const loaded = new Set();
const addLink = href => {
    if (!href || loaded.has(href)) { return; }
    loaded.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
};
const addFontFace = (name, src, local = []) => {
    if (!src || loaded.has(src)) { return; }
    loaded.add(src);
    const ext = src.split('.').pop()
        .toLowerCase();
    const format = ext === 'ttf' ? 'truetype' : (ext === 'otf' ? 'opentype' : ext);
    const style = document.createElement('style');
    const sources = local.map(installed => `local('${installed}')`)
        .concat(`url('${src}') format('${format}')`)
        .join(', ');
    style.textContent =
        `@font-face { font-family: '${name}'; src: ${sources}; font-display: block; }`;
    document.head.appendChild(style);
};
const load = font => {
    if (font.url) { addLink(`https://fonts.googleapis.com/css2?family=${font.url}&display=swap`); }
    if (font.css) { addLink(font.css); }
    if (font.src) { addFontFace(font.fontName || font.label, font.src, font.local); }
};
const readGuestSetting = () => {
    try { return JSON.parse(localStorage.getItem(GUEST_SETTINGS_KEY) || '{}').font; } catch (e) { return null; }
};
export const getFontName = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY) || readGuestSetting();
        if (stored && FONTS.some(font => font.name === stored)) { return stored; }
    } catch (e) {
    }
    return DEFAULT_FONT;
};
const listeners = new Set();
export const onFontChanged = callback => { listeners.add(callback); return () => listeners.delete(callback); };
export const applyFont = () => {
    const font = getFont(getFontName());
    injectBlocklyCSS();
    load(font);
    document.documentElement.style.setProperty('--dimod-font-ui', font.family);
    return font;
};
const persist = name => {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (e) {
    }
    const value = name === DEFAULT_FONT ? null : name;
    const token = (() => {
        try { return localStorage.getItem('token'); } catch (e) { return null; }
    })();
    if (!token) {
        try {
            const guest = JSON.parse(localStorage.getItem(GUEST_SETTINGS_KEY) || '{}');
            guest.font = value;
            localStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify(guest));
        } catch (e) {
        }
        return;
    }
    fetch(`${process.env.DIMOD_API_BASE}/users/me`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
        body: JSON.stringify({frontend_settings: {font: value}})
    }).catch(() => {});
};
export const fontArrivedLate = () => {
    const font = getFont(getFontName());
    const family = font.family.split(',')[0];
    const spec = `500 16px ${family}`;
    if (!document.fonts) { return Promise.resolve(false); }
    try {
        if (document.fonts.check(spec)) { return Promise.resolve(false); }
    } catch (e) { return Promise.resolve(false); }
    return document.fonts.load(spec).then(faces => faces.length > 0, () => false);
};
export const setFont = name => {
    persist(name);
    const font = applyFont();
    const needsLoading = font.url || font.css || font.src;
    const ready = needsLoading && document.fonts ?
        document.fonts.load(`500 16px ${font.family.split(',')[0]}`).catch(() => {}) :
        Promise.resolve();
    return ready.then(() => {
        for (const listener of listeners) { listener(font); }
    });
};
export const onUiFontFaceLoaded = callback => {
    if (!document.fonts || !document.fonts.addEventListener) { return () => {}; }
    const unquote = family => family.trim().replace(/^['"]|['"]$/g, '');
    const handle = event => {
        const family = unquote(getFont(getFontName()).family.split(',')[0]);
        const faces = (event && event.fontfaces) || [];
        if (faces.some(face => unquote(face.family) === family)) { callback(); }
    };
    document.fonts.addEventListener('loadingdone', handle);
    return () => document.fonts.removeEventListener('loadingdone', handle);
};
export {FONTS};
