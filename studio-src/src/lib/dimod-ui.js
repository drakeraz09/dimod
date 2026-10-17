const RAW = [
    ['dracula', 'Dracula', 'vs-dark', '282a36 f8f8f2 6272a4 f1fa8c bd93f9 ff79c6 8be9fd ff79c6 44475a 2f3240 f8f8f0'],
    ['one-dark', 'One Dark', 'vs-dark', '282c34 abb2bf 5c6370 98c379 d19a66 c678dd e5c07b 56b6c2 3e4451 2c313c 528bff'],
    ['monokai', 'Monokai', 'vs-dark', '272822 f8f8f2 75715e e6db74 ae81ff f92672 66d9ef f92672 49483e 3e3d32 f8f8f0'],
    ['solarized-dark', 'Solarized Dark', 'vs-dark', '002b36 839496 586e75 2aa198 d33682 859900 b58900 93a1a1 073642 073642 839496'],
    ['solarized-light', 'Solarized Light', 'vs', 'fdf6e3 657b83 93a1a1 2aa198 d33682 859900 b58900 586e75 eee8d5 eee8d5 657b83'],
    ['nord', 'Nord', 'vs-dark', '2e3440 d8dee9 616e88 a3be8c b48ead 81a1c1 8fbcbb 81a1c1 434c5e 3b4252 d8dee9'],
    ['gruvbox-dark', 'Gruvbox Dark', 'vs-dark', '282828 ebdbb2 928374 b8bb26 d3869b fb4934 fabd2f fe8019 504945 32302f ebdbb2'],
    ['gruvbox-light', 'Gruvbox Light', 'vs', 'fbf1c7 3c3836 928374 79740e 8f3f71 9d0006 b57614 af3a03 d5c4a1 f2e5bc 3c3836'],
    ['tokyo-night', 'Tokyo Night', 'vs-dark', '1a1b26 a9b1d6 565f89 9ece6a ff9e64 bb9af7 2ac3de 89ddff 283457 1f2335 c0caf5'],
    ['catppuccin-mocha', 'Catppuccin Mocha', 'vs-dark', '1e1e2e cdd6f4 6c7086 a6e3a1 fab387 cba6f7 f9e2af 89dceb 45475a 313244 f5e0dc'],
    ['catppuccin-latte', 'Catppuccin Latte', 'vs', 'eff1f5 4c4f69 9ca0b0 40a02b fe640b 8839ef df8e1d 04a5e5 ccd0da e6e9ef dc8a78'],
    ['github-dark', 'GitHub Dark', 'vs-dark', '0d1117 c9d1d9 8b949e a5d6ff 79c0ff ff7b72 ffa657 ff7b72 264f78 161b22 c9d1d9'],
    ['github-light', 'GitHub Light', 'vs', 'ffffff 24292f 6e7781 0a3069 0550ae cf222e 953800 cf222e b6e3ff f6f8fa 24292f'],
    ['material-ocean', 'Material Ocean', 'vs-dark', '0f111a 8f93a2 464b5d c3e88d f78c6c c792ea ffcb6b 89ddff 1f2233 1a1c25 ffcc00'],
    ['night-owl', 'Night Owl', 'vs-dark', '011627 d6deeb 637777 ecc48d f78c6c c792ea addb67 7fdbca 1d3b53 0b2942 80a4c2'],
    ['ayu-mirage', 'Ayu Mirage', 'vs-dark', '1f2430 cccac2 707a8c bae67e dfbfff ffa759 73d0ff f29e74 33415e 272d3b ffcc66'],
    ['rose-pine', 'Rose Pine', 'vs-dark', '191724 e0def4 6e6a86 f6c177 ebbcba 31748f 9ccfd8 908caa 403d52 21202e e0def4'],
    ['synthwave', 'Synthwave', 'vs-dark', '262335 ffffff 848bbd ff8b39 f97e72 fede5d 36f9f6 fede5d 463465 2a2139 ff7edb'],
    ['cobalt', 'Cobalt', 'vs-dark', '002240 ffffff 0088ff 3ad900 ff628c ffc600 80ffbb ff9d00 0050a4 00305a ffffff'],
    ['high-contrast', 'High Contrast', 'vs-dark', '000000 ffffff 7ca668 ce9178 b5cea8 569cd6 4ec9b0 ffffff 264f78 111111 ffffff'],
    ['paper', 'Paper', 'vs', 'fbf7ef 3d3528 a39579 6f7d1c b4532a 9a3f8a 2d6f8e 7a6a52 eadfc9 f3ecdf 3d3528']
];
const build = (base, [bg, fg, comment, string, number, keyword, type, op, sel, line, cursor]) => ({
    base,
    inherit: true,
    rules: [
        {token: '', foreground: fg},
        {token: 'comment', foreground: comment},
        {token: 'string', foreground: string},
        {token: 'string.escape', foreground: op},
        {token: 'regexp', foreground: string},
        {token: 'number', foreground: number},
        {token: 'keyword', foreground: keyword},
        {token: 'keyword.control', foreground: keyword},
        {token: 'type', foreground: type},
        {token: 'type.identifier', foreground: type},
        {token: 'identifier', foreground: fg},
        {token: 'delimiter', foreground: op},
        {token: 'operator', foreground: op},
        {token: 'tag', foreground: keyword},
        {token: 'attribute.name', foreground: type}
    ],
    colors: {
        'editor.background': `#${bg}`,
        'editor.foreground': `#${fg}`,
        'editorLineNumber.foreground': `#${comment}`,
        'editorLineNumber.activeForeground': `#${fg}`,
        'editor.lineHighlightBackground': `#${line}`,
        'editor.lineHighlightBorder': `#${line}`,
        'editor.selectionBackground': `#${sel}`,
        'editor.inactiveSelectionBackground': `#${sel}88`,
        'editor.wordHighlightBackground': `#${sel}88`,
        'editorCursor.foreground': `#${cursor}`,
        'editorIndentGuide.background1': `#${line}`,
        'editorIndentGuide.activeBackground1': `#${comment}`,
        'editorWhitespace.foreground': `#${line}`,
        'editorGutter.background': `#${bg}`,
        'editorWidget.background': `#${line}`,
        'editorWidget.border': `#${sel}`,
        'editorSuggestWidget.background': `#${line}`,
        'editorSuggestWidget.border': `#${sel}`,
        'editorSuggestWidget.selectedBackground': `#${sel}`,
        'input.background': `#${bg}`,
        'minimap.background': `#${bg}`
    }
});
const CODE_THEMES = [
    {id: 'godot', name: 'Tasteful', dark: true, swatch: ['1d2128', 'cdcfd2', 'ff7085', 'ffeda1', 'a1ffe0', '42ffc2'], monaco: 'dimod-godot'},
    ...RAW.map(([id, name, base, spec]) => {
        const p = spec.split(' ');
        return {
            id, name, dark: base === 'vs-dark', swatch: [p[0], p[1], p[5], p[3], p[4], p[6]],
            monaco: `dimod-${id}`, def: build(base, p)
        };
    })
];
const defineCodeThemes = m => {
    for (const t of CODE_THEMES) if (t.def) m.editor.defineTheme(t.monaco, t.def);
};
const STUDIO_COLOURS = [
    {id: 'light', label: 'Light', dark: false, code: null, keywords: 'bright day'},
    {id: 'dark', label: 'Dark', dark: true, code: null, keywords: 'night'},
    {id: 'midnight', label: 'Midnight', dark: true, code: 'github-dark', keywords: 'oled black'},
    {id: 'contrast', label: 'High contrast', dark: true, code: 'high-contrast', keywords: 'accessibility a11y bold'}
];
const STUDIO_STYLES = [
    {id: 'classic', label: 'Classic', keywords: 'normal default scratch'},
    {id: 'tasteful', label: 'Tasteful', keywords: 'godot flat'},
    {id: 'workbench', label: 'Bench', keywords: 'blender dense pro compact'},
    {id: 'rail', label: 'Vess', keywords: 'vscode code editor sidebar vertical tabs rail'}
];
const DEFAULT_PANELS = ['scenes', 'editor', 'stage', 'chat'];
const studioColour = id => STUDIO_COLOURS.find(t => t.id === id) || null;
const studioStyle = id => STUDIO_STYLES.find(t => t.id === id) || null;
const LEGACY_THEMES = {godot: ['dark', 'tasteful'], paper: ['light', 'tasteful'], candy: ['light', 'tasteful'],
    midnight: ['midnight', 'tasteful'], terminal: ['dark', 'tasteful'], contrast: ['contrast', 'tasteful']};
export {CODE_THEMES, DEFAULT_PANELS, LEGACY_THEMES, STUDIO_COLOURS, STUDIO_STYLES, defineCodeThemes, studioColour, studioStyle};
let opener$1 = null;
const setDialogHost = fn => {
    opener$1 = fn;
    return () => {
        if (opener$1 === fn) opener$1 = null;
    };
};
const ask = (kind, message, options) => new Promise(resolve => {
    if (!opener$1) {
        if (kind === 'confirm') resolve(confirm(message));
        else if (kind === 'prompt') resolve(prompt(message, (options && options.initial) || ''));
        else { alert(message); resolve(); }
        return;
    }
    opener$1({kind, message: String(message), ...options}, resolve);
});
const askConfirm = (message, options = {}) => ask('confirm', message, options);
const askAlert = (message, options = {}) => ask('alert', message, options);
const askPrompt = (message, options = {}) => ask('prompt', message, options);
let host = null;
const setCustomPromptHost = fn => {
    host = fn;
    return () => {
        if (host === fn) host = null;
    };
};
const getCustomPromptHost = () => host;
let opener = null;
const setRenamePrompt = fn => {
    opener = fn;
    return () => {
        if (opener === fn) opener = null;
    };
};
const askRename = options => new Promise(resolve => {
    if (!opener) { resolve(prompt(options.title, options.initial || '') || null); return; }
    opener(options, resolve);
});
const AUTO_HIDE_MS = 8000;
const MAX_VISIBLE = 4;
let container = null;
const visible = new Map();
const getContainer = () => {
    if (container && container.isConnected) return container;
    container = document.createElement('div');
    container.className = 'dimod-error-toasts';
    Object.assign(container.style, {
        position: 'fixed',
        top: '0.5rem',
        left: '0.5rem',
        zIndex: '2147483000',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
        maxWidth: 'min(26rem, calc(100vw - 1rem))',
        pointerEvents: 'none'
    });
    document.body.appendChild(container);
    return container;
};
const remove = message => {
    const entry = visible.get(message);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.element.remove();
    visible.delete(message);
};
const scheduleHide = (message, entry) => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => remove(message), AUTO_HIDE_MS);
};
const showErrorToast = (error, where) => {
    if (typeof document === 'undefined' || !document.body) return;
    const text = `${(error && error.message) || error || 'Unknown error'}`;
    const message = where ? `${where}: ${text}` : text;
    const existing = visible.get(message);
    if (existing) {
        existing.count++;
        existing.countElement.textContent = `×${existing.count}`;
        scheduleHide(message, existing);
        return;
    }
    const element = document.createElement('div');
    Object.assign(element.style, {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
        padding: '0.5rem 0.625rem',
        borderRadius: '0.375rem',
        background: 'hsla(0, 70%, 42%, 0.95)',
        color: 'white',
        font: '12px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif',
        boxShadow: '0 0.25rem 0.75rem hsla(0, 0%, 0%, 0.3)',
        pointerEvents: 'auto',
        wordBreak: 'break-word'
    });
    element.setAttribute('role', 'alert');
    const label = document.createElement('div');
    label.style.flex = '1';
    const title = document.createElement('strong');
    title.textContent = 'Something went wrong, but it was recovered. ';
    const body = document.createElement('span');
    body.style.fontFamily = 'monospace';
    body.textContent = message;
    label.append(title, body);
    const countElement = document.createElement('span');
    countElement.style.fontWeight = 'bold';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss');
    Object.assign(close.style, {
        border: 'none',
        background: 'none',
        color: 'inherit',
        font: 'bold 16px/1 sans-serif',
        cursor: 'pointer',
        padding: '0'
    });
    close.addEventListener('click', () => remove(message));
    element.append(label, countElement, close);
    const entry = {element, count: 1, countElement, timer: null};
    visible.set(message, entry);
    element.addEventListener('mouseenter', () => clearTimeout(entry.timer));
    element.addEventListener('mouseleave', () => scheduleHide(message, entry));
    const box = getContainer();
    box.appendChild(element);
    while (visible.size > MAX_VISIBLE) remove(visible.keys().next().value);
    scheduleHide(message, entry);
};
const KEY = 'notif_sound';
const DEFAULT_SOUND = 'notif.ogg';
const VOLUME = 0.7;
const MIN_GAP_MS = 1500;
let lastPlayedAt = 0;
let cached = null;
let cachedFile = null;
const chosenSound = () => {
    try { return localStorage.getItem(KEY) || DEFAULT_SOUND; } catch (e) { return DEFAULT_SOUND; }
};
const playNotifSound = () => {
    const file = chosenSound();
    if (!file || file === 'none') return;
    const now = Date.now();
    if (now - lastPlayedAt < MIN_GAP_MS) return;
    lastPlayedAt = now;
    if (cachedFile !== file) {
        cachedFile = file;
        cached = new Audio(`/sounds/${file.includes('.') ? file : `${file}.ogg`}`);
        cached.preload = 'auto';
    }
    const a = cached.cloneNode();
    a.volume = VOLUME;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
};
function generateAvatarSVG(seed, size = 256) {
    function hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    let state = hash(seed);
    function rand() {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967295;
    }
    const palette = [
        `hsl(${Math.floor(rand() * 360)} 70% 55%)`,
        `hsl(${Math.floor(rand() * 360)} 70% 55%)`,
        `hsl(${Math.floor(rand() * 360)} 70% 55%)`,
        `hsl(${Math.floor(rand() * 360)} 70% 55%)`
    ];
    const bg = `hsl(${Math.floor(rand() * 360)} 20% 12%)`;
    const cells = 8;
    const cellSize = size / cells;
    let svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="${size}"
     height="${size}"
     viewBox="0 0 ${size} ${size}">
<rect width="100%" height="100%" fill="${bg}"/>
`;
    const pattern = [];
    for (let y = 0; y < cells / 2; y++) {
        for (let x = 0; x <= y; x++) {
            if (rand() > 0.5) { pattern.push({x, y, color: palette[Math.floor(rand() * palette.length)]}); }
        }
    }
    function drawCell(x, y, color) {
        return `<rect
        x="${x * cellSize}"
        y="${y * cellSize}"
        width="${cellSize}"
        height="${cellSize}"
        fill="${color}"
      />`;
    }
    function placeSymmetric(x, y, color) {
        const coords = [
            [x, y],
            [y, x],
            [cells - 1 - x, y],
            [cells - 1 - y, x],
            [x, cells - 1 - y],
            [y, cells - 1 - x],
            [cells - 1 - x, cells - 1 - y],
            [cells - 1 - y, cells - 1 - x]
        ];
        for (const [cx, cy] of coords) { svg += drawCell(cx, cy, color); }
    }
    pattern.forEach(p => placeSymmetric(p.x, p.y, p.color));
    svg += `
    <circle
      cx="${size/2}"
      cy="${size/2}"
      r="${size*0.12}"
      fill="${palette[0]}"
      opacity="0.9"/>
  `;
    svg += "</svg>";
    return svg;
}
function getDefaultPfp(username = '') {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generateAvatarSVG(username))}`
}
const STYLE_ID = 'dimod-accent-style';
const HEX = /^#[0-9a-f]{6}$/i;
const hexToHsl = hex => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
        else if (max === g) h = ((b - r) / d) + 2;
        else h = ((r - g) / d) + 4;
        h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hexFromHsl = (h, s, l) => {
    const a = (s / 100) * Math.min(l / 100, 1 - (l / 100));
    const f = n => {
        const k = (n + (h / 30)) % 12;
        const c = (l / 100) - (a * Math.max(Math.min(k - 3, 9 - k, 1), -1));
        return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
};
const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};
const onAccent = hex => (luminance(hex) > 0.4 ? '#1f2433' : '#ffffff');
const accentCss = hex => {
    const [h, s, l] = hexToHsl(hex);
    const dark = onAccent(hex) !== '#ffffff';
    let textL = l;
    while (textL > 5 && 1.05 / (luminance(hexFromHsl(h, s, textL)) + 0.05) < 4.5) textL -= 2;
    const hsla = (sat, light, a) => `hsla(${h}, ${clamp(sat, 0, 100)}%, ${clamp(light, 0, 100)}%, ${a})`;
    const primary = hex;
    const tertiary = hsla(s * 0.82, l - 7, 1);
    const k = Math.min(s / 45, 1);
    const tint = (sat, light) => `hsla(${h}, ${Math.round(sat * k)}%, ${light}%, 1)`;
    return `:root {
    --dimod-motion-primary: ${primary};
    --dimod-motion-tertiary: ${tertiary};
    --dimod-motion-transparent: ${hsla(s, l, 0.35)};
    --dimod-motion-light-transparent: ${hsla(s * 0.82, l - 7, 0.15)};
    --dimod-drop-highlight: ${hsla(s, l + 14, 1)};
    --dimod-icon-filter: url(#${FILTER_ID});
    --dimod-on-accent: ${onAccent(hex)};
    --dimod-on-accent-filter: ${dark ? 'brightness(0)' : 'brightness(0) invert(1)'};
    --dimod-accent-text: ${hexFromHsl(h, s, textL)};
    --paint-on-accent: ${onAccent(hex)};
    --paint-on-accent-filter: ${dark ? 'brightness(0)' : 'brightness(0) invert(1)'};
    --dimod-accent-10: ${hsla(s, l, 0.1)};
    --dimod-accent-20: ${hsla(s, l, 0.2)};
    --dimod-accent-25: ${hsla(s, l, 0.25)};
    --dimod-accent-50: ${hsla(s, l, 0.5)};
    --paint-motion-primary: ${primary};
    --paint-motion-tertiary: ${tertiary};
    --paint-motion-transparent: ${hsla(s, l, 0.35)};
    --paint-motion-light-transparent: ${hsla(s * 0.82, l - 7, 0.15)};
}
body[theme="light"] {
    --ui-primary: ${tint(100, 95)};
    --ui-secondary: ${tint(75, 95)};
    --ui-tertiary: ${tint(50, 90)};
    --ui-modal-overlay: ${hsla(s, l + 9, 0.9)};
}
`;
};
const PURPLE = [0x6c, 0x5c, 0xe7];
const FILTER_ID = 'dimod-accent-filter';
const SLATE = [0x57, 0x5e, 0x75];
const SLATE_DARK = [0x94, 0xa0, 0xc7];
const DARK_FILTER_ID = `${FILTER_ID}-dark`;
const accentMatrix = (hex, slateTo = SLATE) => {
    const P = PURPLE.map(v => v / 255);
    const S = SLATE.map(v => v / 255);
    const T = slateTo.map(v => v / 255);
    const A = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const src = [[1, P[0], S[0]], [1, P[1], S[1]], [1, P[2], S[2]]];
    const dst = [[1, A[0], T[0]], [1, A[1], T[1]], [1, A[2], T[2]]];
    const [[a, b, c], [d, e, f], [g, h, i]] = src;
    const det = (a * ((e * i) - (f * h))) - (b * ((d * i) - (f * g))) + (c * ((d * h) - (e * g)));
    const inv = [
        [(e * i) - (f * h), (c * h) - (b * i), (b * f) - (c * e)],
        [(f * g) - (d * i), (a * i) - (c * g), (c * d) - (a * f)],
        [(d * h) - (e * g), (b * g) - (a * h), (a * e) - (b * d)]
    ].map(row => row.map(v => v / det));
    const rows = [0, 1, 2].map(r => [0, 1, 2].map(col =>
        (dst[r][0] * inv[0][col]) + (dst[r][1] * inv[1][col]) + (dst[r][2] * inv[2][col])));
    const f4 = v => Number(v.toFixed(4));
    return [...rows[0].map(f4), 0, 0, ...rows[1].map(f4), 0, 0, ...rows[2].map(f4), 0, 0, 0, 0, 0, 1, 0].join(' ');
};
const PURPLE_HEX = '#6c5ce7';
const setIconFilter = hex => {
    const html = document.documentElement;
    let svg = document.getElementById(`${FILTER_ID}-svg`);
    html.classList.toggle('dimod-custom-accent', !!hex);
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = `${FILTER_ID}-svg`;
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        const filter = id => `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" ` +
            `width="100%" height="100%"><feColorMatrix type="matrix" values=""/></filter>`;
        svg.innerHTML = filter(FILTER_ID) + filter(DARK_FILTER_ID);
        (document.body || html).appendChild(svg);
    }
    const accent = hex || PURPLE_HEX;
    svg.querySelector(`#${FILTER_ID} feColorMatrix`).setAttribute('values', accentMatrix(accent));
    svg.querySelector(`#${DARK_FILTER_ID} feColorMatrix`).setAttribute('values', accentMatrix(accent, SLATE_DARK));
};
const DARK_ICON_CSS = `img[src$=".accent.svg"] { --dimod-dark-icon-filter: url(#${DARK_FILTER_ID}); }\n`;
const applyAccent = hex => {
    const valid = !!hex && HEX.test(hex);
    let el = document.getElementById(STYLE_ID);
    if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
    el.textContent = DARK_ICON_CSS + (valid ?
        `${accentCss(hex)}html.dimod-custom-accent :where(img[src$=".accent.svg"]) { filter: url(#${FILTER_ID}); }\n` :
        '');
    const set = () => setIconFilter(valid ? hex : null);
    if (document.body) set();
    else document.addEventListener('DOMContentLoaded', set, {once: true});
};
const stored = () => {
    try { return localStorage.getItem('accent_color') || ''; } catch (e) { return ''; }
};
applyAccent(stored());
window.addEventListener('storage', e => {
    if (e.key === 'accent_color') applyAccent(e.newValue || '');
});
const POPUPS = '[class*="menu_menu_"], [class*="context-menu_context-menu_"], [class*="menu-bar_menu-bar-menu_"], .__react_component_tooltip.show';
let clampQueued = false;
const clampPopups = () => {
    clampQueued = false;
    for (const el of document.querySelectorAll(POPUPS)) {
        el.style.translate = '';
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const dx = Math.min(0, innerWidth - 4 - r.right) || Math.max(0, 4 - r.left);
        const dy = Math.min(0, innerHeight - 4 - r.bottom) || Math.max(0, 4 - r.top);
        if (dx || dy) el.style.translate = `${dx}px ${dy}px`;
    }
};
const isPopup = n => n.nodeType === 1 && (n.matches(POPUPS) || (n.firstElementChild && n.querySelector(POPUPS)));
new MutationObserver(records => {
    if (clampQueued) return;
    for (const r of records) {
        if (r.type === 'attributes' ? isPopup(r.target) : Array.prototype.some.call(r.addedNodes, isPopup)) {
            clampQueued = true;
            requestAnimationFrame(clampPopups);
            return;
        }
    }
}).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
const isDarkTheme = () => document.body.getAttribute('theme') === 'dark';
const deepActiveElement = () => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; }
    return el;
};
const isTextEntryFocused = () => {
    const el = deepActiveElement();
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    if (tag === 'CANVAS' && document.querySelector('[class*="text-tool"][class*="is-active"]')) return true;
    return false;
};
const isBlocklyEditorOpen = ScratchBlocks => {
    if (!ScratchBlocks) return false;
    try {
        const widget = ScratchBlocks.WidgetDiv;
        const dropdown = ScratchBlocks.DropDownDiv;
        if (widget && typeof widget.isVisible === 'function' && widget.isVisible()) return true;
        if (dropdown && typeof dropdown.isVisible === 'function' && dropdown.isVisible()) return true;
    } catch (e) {
    }
    return false;
};
const isUserTyping = ScratchBlocks => isTextEntryFocused() || isBlocklyEditorOpen(ScratchBlocks);
const PREV = ['ArrowUp', 'ArrowLeft'];
const NEXT = ['ArrowDown', 'ArrowRight'];
const LIST_PROPS = {'data-dimod-asset-list': true};
if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', event => {
        const active = document.activeElement;
        if (active && active.hasAttribute && active.hasAttribute('data-dimod-asset-list') &&
            !active.contains(event.target)) { active.blur(); }
    }, true);
}
const handleListKey = (event, count, current, select, itemAt) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target !== event.currentTarget) return;
    let step = 0;
    if (PREV.includes(event.key)) step = -1;
    else if (NEXT.includes(event.key)) step = 1;
    if (!step || count === 0) return;
    event.preventDefault();
    const next = current < 0 ? 0 : Math.max(0, Math.min(count - 1, current + step));
    if (next === current) return;
    select(next);
    requestAnimationFrame(() => {
        const el = itemAt(next);
        if (el && el.scrollIntoView) el.scrollIntoView({block: 'nearest'});
    });
};
const REPORT_TONES = {
    number: ['#e8f0ff', '#4c97ff', '#1f4f9f', '#1e2d4a', '#6aa8ff', '#a9ccff'],
    true: ['#e4f7ea', '#3fb868', '#17683a', '#1c3a29', '#4fcf7c', '#a6ecc0'],
    false: ['#fde9e9', '#e0585b', '#9a2327', '#432125', '#f06a6d', '#ffb4b6'],
    object: ['#f1eaff', '#9966ff', '#5a33a8', '#2f2548', '#a883ff', '#d3c0ff'],
    empty: ['#f0f0f2', '#b0b4bd', '#6b7080', '#2c2f38', '#6b7080', '#a0a4b0'],
    asset: ['#fbefe1', '#c97b2a', '#7a4510', '#3a2a1a', '#d98c3a', '#f3c999'],
    costume: ['#f1eaff', '#9966ff', '#5a33a8', '#2f2548', '#a883ff', '#d3c0ff'],
    sound: ['#fbe8fb', '#cf63cf', '#7d2a7d', '#3a2238', '#dd7fdd', '#f2c2f2']
};
const reportKind = value => {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return String(value);
    if (value === null || value === undefined || value === '') return 'empty';
    if (value.dimodRefKind) return value.dimodRefKind;
    if (typeof value === 'object') return 'object';
    return null;
};
const paintReport = (ScratchBlocks, value, isError) => {
    const kind = isError ? null : reportKind(value);
    const tone = kind && REPORT_TONES[kind];
    const dark = document.body.getAttribute('theme') === 'dark';
    const box = ScratchBlocks.DropDownDiv.getContentDiv().firstChild;
    if (!tone) {
        ScratchBlocks.DropDownDiv.setColour(ScratchBlocks.Colours.valueReportBackground, isError ? ScratchBlocks.Colours.blockError : ScratchBlocks.Colours.valueReportBorder);
        if (box) box.style.color = '';
        return;
    }
    ScratchBlocks.DropDownDiv.setColour(tone[dark ? 3 : 0], tone[dark ? 4 : 1]);
    if (box) box.style.color = tone[dark ? 5 : 2];
};
const installReportColours = ScratchBlocks => {
    const proto = ScratchBlocks.WorkspaceSvg.prototype;
    if (proto.dimodReportColours) return;
    proto.dimodReportColours = true;
    let inner = proto.reportValue;
    const wrapped = function (id, value, isError) {
        inner.call(this, id, value, isError);
        paintReport(ScratchBlocks, value, isError);
    };
    Object.defineProperty(proto, 'reportValue', {configurable: true, get: () => wrapped, set: fn => { inner = fn; }});
};
let monacoModule = null;
let monacoPending = null;
const monaco = new Proxy({}, {get: (o, k) => {
    if (!monacoModule) throw new Error(`monaco used before loadMonaco (${String(k)})`);
    return monacoModule[k];
}});
const GODOT_MONACO = {
    base: 'vs-dark',
    inherit: true,
    rules: [
        {token: '', foreground: 'cdcfd2'},
        {token: 'comment', foreground: '7b7f87'},
        {token: 'string', foreground: 'ffeda1'},
        {token: 'string.escape', foreground: 'ffd1a1'},
        {token: 'number', foreground: 'a1ffe0'},
        {token: 'keyword', foreground: 'ff7085'},
        {token: 'keyword.control', foreground: 'ff8ccc'},
        {token: 'type', foreground: '42ffc2'},
        {token: 'type.identifier', foreground: '8fffdb'},
        {token: 'identifier', foreground: 'cdcfd2'},
        {token: 'delimiter', foreground: 'abc9ff'},
        {token: 'operator', foreground: 'abc9ff'},
        {token: 'regexp', foreground: 'ffb373'},
        {token: 'tag', foreground: 'ff7085'},
        {token: 'attribute.name', foreground: 'bce0ff'}
    ],
    colors: {
        'editor.background': '#1d2128',
        'editor.foreground': '#cdcfd2',
        'editorLineNumber.foreground': '#5f646d',
        'editorLineNumber.activeForeground': '#a9adb6',
        'editor.lineHighlightBackground': '#262b34',
        'editor.lineHighlightBorder': '#262b34',
        'editor.selectionBackground': '#3b5f82aa',
        'editor.inactiveSelectionBackground': '#3b5f8266',
        'editor.wordHighlightBackground': '#478cbf33',
        'editorCursor.foreground': '#aaffee',
        'editorIndentGuide.background1': '#2a2f39',
        'editorIndentGuide.activeBackground1': '#3c424e',
        'editorWhitespace.foreground': '#2f3540',
        'editorGutter.background': '#1d2128',
        'editorWidget.background': '#242933',
        'editorWidget.border': '#14171c',
        'editorSuggestWidget.background': '#242933',
        'editorSuggestWidget.border': '#14171c',
        'editorSuggestWidget.selectedBackground': '#2f3d50',
        'input.background': '#1a1d24',
        'scrollbarSlider.background': '#4a516180',
        'scrollbarSlider.hoverBackground': '#5a6275aa',
        'minimap.background': '#1d2128'
    }
};
const isGodotTheme = () => document.body.getAttribute('editor-theme') === 'godot';
const MONACO_PREF_KEY = 'dimod:monaco-theme';
const getMonacoPref = () => {
    try {
        const v = localStorage.getItem(MONACO_PREF_KEY);
        if (v === 'tasteful') return 'godot';
        return CODE_THEMES.some(t => t.id === v) ? v : 'auto';
    } catch (e) { return 'auto'; }
};
const setMonacoPref = pref => {
    try { localStorage.setItem(MONACO_PREF_KEY, pref); } catch (e) {
    }
    window.dispatchEvent(new Event('dimod-editor-theme'));
};
const monacoThemeName = () => {
    const pref = getMonacoPref();
    if (pref !== 'auto') return CODE_THEMES.find(t => t.id === pref).monaco;
    const colour = studioColour(document.body.getAttribute('dimod-colour'));
    const style = document.body.getAttribute('dimod-style');
    const id = colour && colour.id === 'dark' && style && style !== 'classic' ? 'godot' : colour && colour.code;
    const code = id && CODE_THEMES.find(t => t.id === id);
    if (code) return code.monaco;
    return isDarkTheme() ? 'vs-dark' : 'vs';
};
const COLORS_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 ' +
    '0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/>' +
    '<circle cx="16.5" cy="10.5" r="1"/></svg>';
const addColorsButton = editor => setTimeout(() => {
    const host = editor.getContainerDomNode && editor.getContainerDomNode();
    if (!host || host.clientHeight < 80 || host.closest('[data-dimod-no-colors]')) return;
    const node = document.createElement('button');
    node.className = 'dimod-monaco-colors';
    node.title = 'Code editor colors';
    node.innerHTML = COLORS_ICON;
    node.onclick = () => window.dispatchEvent(new Event('dimod:code-colors'));
    editor.addOverlayWidget({getId: () => 'dimod.colors', getDomNode: () => node, getPosition: () => ({preference: 0})});
});
const loadMonaco = () => monacoPending || (monacoPending = import(/* webpackChunkName: "monaco", webpackPrefetch: true */ 'monaco-editor')
    .then(m => {
        monacoModule = m;
        m.editor.defineTheme('dimod-godot', GODOT_MONACO);
        defineCodeThemes(m);
        m.editor.onDidCreateEditor(addColorsButton);
        window.addEventListener('dimod-editor-theme', () => m.editor.setTheme(monacoThemeName()));
        return m;
    }, e => { monacoPending = null; throw e; }));
const monacoReady = () => !!monacoModule;
export {LIST_PROPS, accentCss, accentMatrix, applyAccent, askAlert, askConfirm, askPrompt, askRename, generateAvatarSVG, getCustomPromptHost, getDefaultPfp, handleListKey, isBlocklyEditorOpen, isDarkTheme, getMonacoPref, isGodotTheme, monacoThemeName, setMonacoPref, installReportColours, isTextEntryFocused, paintReport, isUserTyping, loadMonaco, monaco, monacoReady, playNotifSound, setCustomPromptHost, setDialogHost, setRenamePrompt, showErrorToast};
