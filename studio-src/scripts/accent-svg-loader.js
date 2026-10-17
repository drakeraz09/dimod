const P = [0x6c, 0x5c, 0xe7];
const luma = c => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
const hex = c => `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
module.exports = function (src) {
    return src.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m, h) => {
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
        const max = Math.max(...c), min = Math.min(...c), l = (max + min) / 510, d = (max - min) / 255;
        const s = d === 0 ? 0 : d / (1 - Math.abs((2 * l) - 1));
        if (s < 0.2 || l > 0.94 || l < 0.06 || !(c[2] >= c[1] && c[2] >= c[0] - 40 && c[0] >= c[1] - 30)) return m;
        const L = luma(c), LP = luma(P);
        if (L >= LP) { const t = (L - LP) / (255 - LP); return hex(P.map(v => v + (t * (255 - v)))); }
        return hex(P.map(v => v * (L / LP)));
    });
};
