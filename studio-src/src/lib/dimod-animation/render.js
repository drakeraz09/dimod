import { parseCssColor, intToRGB, SLOT, NUM_SLOTS } from './core.js';
const QUAD_VS = `
precision highp float;
attribute vec2 a_pos;
uniform mat3 u_geo;     // geometry (box space) -> clip space
uniform vec4 u_qRect;   // box-space rect this quad covers (x0, y0, x1, y1)
uniform vec4 u_gRect;   // geometry rect (differs from u_qRect only for nine-slice)
varying vec2 v_q;
void main() {
  vec2 q = mix(u_qRect.xy, u_qRect.zw, a_pos);
  vec2 g = mix(u_gRect.xy, u_gRect.zw, a_pos);
  v_q = q;
  vec3 p = u_geo * vec3(g, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}
`;
const SPRITE_FS = `
precision highp float;
uniform sampler2D u_tex;
uniform vec4 u_padUV;     // uv = q * xy - zw
uniform vec2 u_boxPx;     // padded box size in costume pixels
uniform float u_alpha;
#ifdef FX_PIXELATE
uniform float u_pixelate;   // block size in box pixels
#endif
#ifdef FX_MOSAIC
uniform float u_mosaic;     // tile count
#endif
#ifdef FX_WHIRL
uniform float u_whirl;      // radians
#endif
#ifdef FX_FISHEYE
uniform float u_fisheye;    // exponent
#endif
#ifdef FX_CHROMA
uniform vec2 u_chroma;      // offset in box pixels
#endif
#ifdef FX_CLIP
uniform vec4 u_clip;        // x0, y0, x1, y1 in q space
#endif
#ifdef FX_TINT
uniform vec3 u_tint;
#endif
#ifdef FX_MATRIX
uniform mat4 u_cm;          // straight-alpha color matrix
uniform vec4 u_co;          // offset
#endif
varying vec2 v_q;

vec4 sampleBox(vec2 q) {
  vec2 uv = q * u_padUV.xy - u_padUV.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(u_tex, uv);
}

// Image after pixelate -> mosaic -> whirl -> fisheye (KS4's order), sampled at q.
vec4 shaped(vec2 q) {
#ifdef FX_FISHEYE
  {
    vec2 v = (q - 0.5) * 2.0;
    float len = length(v);
    if (len > 0.0) {
      float r = pow(min(len, 1.0), u_fisheye) * max(1.0, len);
      q = 0.5 + v * (r / len) * 0.5;
    }
  }
#endif
#ifdef FX_WHIRL
  {
    vec2 c = u_boxPx * 0.5;
    vec2 d = q * u_boxPx - c;
    float radius = min(c.x, c.y);
    float f = max(0.0, 1.0 - length(d) / max(radius, 1e-3));
    float a = u_whirl * f * f;
    float cs = cos(a), sn = sin(a);
    d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    q = (c + d) / u_boxPx;
  }
#endif
#ifdef FX_MOSAIC
  q = fract(q * u_mosaic);
#endif
#ifdef FX_PIXELATE
  {
    vec2 px = q * u_boxPx;
    px = (floor(px / u_pixelate) + 0.5) * u_pixelate;
    q = px / u_boxPx;
  }
#endif
  return sampleBox(q);
}

void main() {
  vec2 q = v_q;
#ifdef FX_CLIP
  if (q.x < u_clip.x || q.y < u_clip.y || q.x > u_clip.z || q.y > u_clip.w) discard;
#endif
#ifdef FX_CHROMA
  vec2 off = u_chroma / u_boxPx;
  vec4 cm = shaped(q);
  vec4 cr = shaped(q - off);
  vec4 cb = shaped(q + off);
  // KS4 composed straight channels; do it on unpremultiplied values then re-premultiply.
  float a = max(cm.a, max(cr.a, cb.a));
  vec3 straight = vec3(cr.r / max(cr.a, 1e-4) * step(1e-4, cr.a), cm.g / max(cm.a, 1e-4) * step(1e-4, cm.a), cb.b / max(cb.a, 1e-4) * step(1e-4, cb.a));
  vec4 col = vec4(straight * a, a);
#else
  vec4 col = shaped(q);
#endif
#ifdef FX_TINT
  col.rgb *= u_tint;
#endif
#ifdef FX_MATRIX
  if (col.a > 0.0) {
    vec4 s = vec4(col.rgb / col.a, col.a);
    s = clamp(u_cm * s + u_co, 0.0, 1.0);
    col = vec4(s.rgb * s.a, s.a);
  }
#endif
  gl_FragColor = col * u_alpha;
}
`;
const FULL_VS = `
precision highp float;
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;
const COPY_FS = `
precision highp float;
uniform sampler2D u_src;
uniform float u_alpha;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_src, v_uv) * u_alpha; }
`;
const COMPOSITE_FS = `
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_dst;
uniform float u_alpha;
uniform float u_mode;
#ifdef MASKED
uniform sampler2D u_mask;
uniform float u_maskInvert;
#endif
varying vec2 v_uv;

float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 setSat(vec3 c, float s) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float range = mx - mn;
  if (range <= 1e-5) return vec3(0.0);
  return (c - mn) * s / range;
}
float softLightC(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float dodgeC(float b, float s) { if (b == 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float burnC(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
float hardLightC(float b, float s) { return s <= 0.5 ? b * 2.0 * s : 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)); }

vec3 blendFn(float m, vec3 b, vec3 s) {
  if (m < 1.5) return b * s;                                        // 1 multiply
  if (m < 2.5) return b + s - b * s;                                // 2 screen
  if (m < 3.5) return vec3(hardLightC(s.r, b.r), hardLightC(s.g, b.g), hardLightC(s.b, b.b)); // 3 overlay
  if (m < 4.5) return min(b, s);                                    // 4 darken
  if (m < 5.5) return max(b, s);                                    // 5 lighten
  if (m < 6.5) return vec3(dodgeC(b.r, s.r), dodgeC(b.g, s.g), dodgeC(b.b, s.b));    // 6 color-dodge
  if (m < 7.5) return vec3(burnC(b.r, s.r), burnC(b.g, s.g), burnC(b.b, s.b));       // 7 color-burn
  if (m < 8.5) return vec3(hardLightC(b.r, s.r), hardLightC(b.g, s.g), hardLightC(b.b, s.b)); // 8 hard-light
  if (m < 9.5) return vec3(softLightC(b.r, s.r), softLightC(b.g, s.g), softLightC(b.b, s.b)); // 9 soft-light
  if (m < 10.5) return abs(b - s);                                  // 10 difference
  if (m < 11.5) return b + s - 2.0 * b * s;                         // 11 exclusion
  if (m < 12.5) return setLum(setSat(s, sat(b)), lum(b));           // 12 hue
  if (m < 13.5) return setLum(setSat(b, sat(s)), lum(b));           // 13 saturation
  if (m < 14.5) return setLum(s, lum(b));                           // 14 color
  return setLum(b, lum(s));                                         // 15 luminosity
}

void main() {
  vec4 s = texture2D(u_src, v_uv) * u_alpha;
#ifdef MASKED
  float ma = texture2D(u_mask, v_uv).a;
  s *= u_maskInvert > 0.5 ? (1.0 - ma) : ma;
#endif
  vec4 d = texture2D(u_dst, v_uv);
  float as = s.a, ab = d.a;
  float m = u_mode;
  vec4 o;
  if (m < 0.5) {                       // 0 source-over
    o = s + d * (1.0 - as);
  } else if (m < 15.5) {               // 1..15 separable / non-separable blend modes
    vec3 cs = as > 0.0 ? s.rgb / as : vec3(0.0);
    vec3 cb = ab > 0.0 ? d.rgb / ab : vec3(0.0);
    vec3 r = (1.0 - ab) * s.rgb + (1.0 - as) * d.rgb + as * ab * clamp(blendFn(m, cb, cs), 0.0, 1.0);
    o = vec4(r, as + ab - as * ab);
  } else {                             // Porter-Duff operators
    float fa, fb;
    if (m < 16.5) { o = min(s + d, 1.0); gl_FragColor = o; return; } // 16 lighter
    else if (m < 17.5) { fa = 1.0 - ab; fb = 1.0; }        // 17 destination-over
    else if (m < 18.5) { fa = 0.0; fb = as; }              // 18 destination-in
    else if (m < 19.5) { fa = 0.0; fb = 1.0 - as; }        // 19 destination-out
    else if (m < 20.5) { fa = 1.0 - ab; fb = as; }         // 20 destination-atop
    else if (m < 21.5) { fa = ab; fb = 1.0 - as; }         // 21 source-atop
    else if (m < 22.5) { fa = ab; fb = 0.0; }              // 22 source-in
    else if (m < 23.5) { fa = 1.0 - ab; fb = 0.0; }        // 23 source-out
    else if (m < 24.5) { fa = 1.0 - ab; fb = 1.0 - as; }   // 24 xor
    else { fa = 1.0; fb = 0.0; }                           // 25 copy
    o = s * fa + d * fb;
  }
  gl_FragColor = o;
}
`;
const BLUR_FS = `
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_step;     // one tap step in uv
uniform float u_sigma;   // in taps
varying vec2 v_uv;
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -12; i <= 12; i++) {
    float fi = float(i);
    float w = exp(-0.5 * fi * fi / (u_sigma * u_sigma));
    acc += texture2D(u_src, v_uv + u_step * fi) * w;
    wsum += w;
  }
  gl_FragColor = acc / wsum;
}
`;
const STYLE_FS = `
precision highp float;
uniform sampler2D u_src;        // the rendered layer
uniform sampler2D u_glowTex;    // blurred layer for glow
uniform sampler2D u_shadowTex;  // blurred layer for shadow
uniform vec2 u_px;              // one pixel in uv
uniform float u_outline;        // outline width in pixels (0 = off)
uniform vec4 u_outlineColor;
uniform float u_glow;           // 0 = off, else strength
uniform vec4 u_glowColor;
uniform float u_shadow;         // 0 = off, else alpha
uniform vec4 u_shadowColor;
uniform vec2 u_shadowOff;       // in uv
varying vec2 v_uv;
void main() {
  vec4 base = texture2D(u_src, v_uv);
  vec4 o = vec4(0.0);
  if (u_shadow > 0.0) {
    float a = texture2D(u_shadowTex, v_uv - u_shadowOff).a * u_shadow;
    o = vec4(u_shadowColor.rgb * a, a);
  }
  if (u_glow > 0.0) {
    float a = clamp(texture2D(u_glowTex, v_uv).a * u_glow, 0.0, 1.0);
    vec4 g = vec4(u_glowColor.rgb * a, a);
    o = g + o * (1.0 - g.a);
  }
  if (u_outline > 0.0) {
    float m = 0.0;
    for (int ring = 1; ring <= 3; ring++) {
      float r = u_outline * float(ring) / 3.0;
      for (int k = 0; k < 16; k++) {
        float ang = float(k) * 0.39269908;
        m = max(m, texture2D(u_src, v_uv + vec2(cos(ang), sin(ang)) * r * u_px).a);
      }
    }
    vec4 ol = vec4(u_outlineColor.rgb * m, m) * u_outlineColor.a;
    o = ol + o * (1.0 - ol.a);
  }
  gl_FragColor = base + o * (1.0 - base.a);
}
`;
const BLEND_INDEX = {
  "source-over": 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  "color-dodge": 6,
  "color-burn": 7,
  "hard-light": 8,
  "soft-light": 9,
  difference: 10,
  exclusion: 11,
  hue: 12,
  saturation: 13,
  color: 14,
  luminosity: 15,
  lighter: 16,
  "destination-over": 17,
  "destination-in": 18,
  "destination-out": 19,
  "destination-atop": 20,
  "source-atop": 21,
  "source-in": 22,
  "source-out": 23,
  xor: 24,
  copy: 25,
};
const UNPREMULT_FS = `
precision highp float;
uniform sampler2D u_src;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_src, v_uv);
  gl_FragColor = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}
`;
const TINT_FS = `
precision highp float;
uniform sampler2D u_tex;
uniform vec3 u_color;
uniform float u_gain;
uniform float u_alpha;
varying vec2 v_q;
void main() {
  float a = min(1.0, texture2D(u_tex, v_q).a * u_gain) * u_alpha;
  gl_FragColor = vec4(u_color * a, a);
}
`;
const DILATE_FS = `
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_px;
uniform float u_radius;
varying vec2 v_uv;
void main() {
  float m = texture2D(u_src, v_uv).a;
  for (int ring = 1; ring <= 4; ring++) {
    float r = u_radius * float(ring) / 4.0;
    for (int k = 0; k < 16; k++) {
      float ang = float(k) * 0.39269908;
      m = max(m, texture2D(u_src, v_uv + vec2(cos(ang), sin(ang)) * r * u_px).a);
    }
  }
  gl_FragColor = vec4(m);
}
`;
const IDENT = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
function mul(a, b) {
  const o = new Array(20);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let s = c === 4 ? a[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) s += a[r * 5 + k] * b[k * 5 + c];
      o[r * 5 + c] = s;
    }
  }
  return o;
}
function hueRotateMatrix(deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
const scaleM = (k) => [k, 0, 0, 0, 0, 0, k, 0, 0, 0, 0, 0, k, 0, 0, 0, 0, 0, 1, 0];
function saturateM(s) {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
function grayscaleM(g) {
  g = 1 - Math.min(1, g);
  return [
    0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g, 0, 0,
    0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g, 0, 0,
    0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
function sepiaM(v) {
  v = 1 - Math.min(1, v);
  return [
    0.393 + 0.607 * v, 0.769 - 0.769 * v, 0.189 - 0.189 * v, 0, 0,
    0.349 - 0.349 * v, 0.686 + 0.314 * v, 0.168 - 0.168 * v, 0, 0,
    0.272 - 0.272 * v, 0.534 - 0.534 * v, 0.131 + 0.869 * v, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
const contrastM = (c) => [c, 0, 0, 0, 0.5 - 0.5 * c, 0, c, 0, 0, 0.5 - 0.5 * c, 0, 0, c, 0, 0.5 - 0.5 * c, 0, 0, 0, 1, 0];
const invertM = (i) => {
  i = Math.min(1, i);
  const k = 1 - 2 * i;
  return [k, 0, 0, 0, i, 0, k, 0, 0, i, 0, 0, k, 0, i, 0, 0, 0, 1, 0];
};
const opacityM = (o) => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, Math.min(1, o), 0];
function amount(arg, def = 1) {
  arg = (arg || "").trim();
  if (!arg) return def;
  const v = parseFloat(arg);
  if (!Number.isFinite(v)) return def;
  return arg.endsWith("%") ? v / 100 : v;
}
function angle(arg) {
  arg = (arg || "").trim();
  const v = parseFloat(arg) || 0;
  if (arg.endsWith("turn")) return v * 360;
  if (arg.endsWith("grad")) return v * 0.9;
  if (arg.endsWith("rad") && !arg.endsWith("grad")) return (v * 180) / Math.PI;
  return v;
}
const px = (arg) => parseFloat(arg) || 0;
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const _cache = new Map();
function parseFilter(str) {
  str = (str || "").trim();
  if (!str || str === "none") return EMPTY;
  const hit = _cache.get(str);
  if (hit) return hit;
  let m = IDENT;
  let changed = false;
  let blur = 0;
  const shadows = [];
  const re = /([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/gi;
  let match;
  while ((match = re.exec(str))) {
    const fn = match[1].toLowerCase();
    const arg = match[2];
    let fm = null;
    switch (fn) {
      case "brightness": fm = scaleM(amount(arg)); break;
      case "contrast": fm = contrastM(amount(arg)); break;
      case "grayscale": fm = grayscaleM(amount(arg)); break;
      case "hue-rotate": fm = hueRotateMatrix(angle(arg)); break;
      case "invert": fm = invertM(amount(arg)); break;
      case "opacity": fm = opacityM(amount(arg)); break;
      case "saturate": fm = saturateM(amount(arg)); break;
      case "sepia": fm = sepiaM(amount(arg)); break;
      case "blur": blur += px(arg); break;
      case "drop-shadow": {
        const parts = splitArgs(arg);
        const nums = [];
        let color = "black";
        for (const p of parts) {
          if (/^-?[\d.]/.test(p)) nums.push(px(p));
          else color = p;
        }
        shadows.push({ x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, color: parseCssColor(color) });
        break;
      }
      default:
        break;
    }
    if (fm) { m = mul(fm, m); changed = true; }
  }
  const out = { matrix: changed ? m : null, blur, shadows };
  if (_cache.size > 256) _cache.clear();
  _cache.set(str, out);
  return out;
}
const EMPTY = { matrix: null, blur: 0, shadows: [] };
function groupColorMatrix(fxColor, fxBrightness, custom) {
  let m = null;
  if (fxColor) m = hueRotateMatrix((fxColor / 200) * 360);
  if (fxBrightness) { const b = scaleM(Math.max(0, 100 + fxBrightness) / 100); m = m ? mul(b, m) : b; }
  if (custom && custom.matrix) m = m ? mul(custom.matrix, m) : custom.matrix;
  return m;
}
function matrixUniforms(m, mat4Out, offOut) {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) mat4Out[c * 4 + r] = m[r * 5 + c];
    offOut[r] = m[r * 5 + 4];
  }
}
const S = SLOT;
const _pipelines = new WeakMap();
class GpuPipeline {
  static for(renderer) {
    if (!renderer || !renderer.gl || !renderer.exports || !renderer.exports.twgl) return null;
    let p = _pipelines.get(renderer);
    if (p === undefined) {
      try { p = new GpuPipeline(renderer); } catch (e) { console.warn("[KS5] GPU pipeline unavailable, using the canvas fallback:", e); p = null; }
      _pipelines.set(renderer, p);
    }
    return p;
  }
  constructor(renderer) {
    this.renderer = renderer;
    const gl = (this.gl = renderer.gl);
    this.twgl = renderer.exports.twgl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.programs = new Map();
    this.pool = [];
    this.attribLocs = new Set();
    this.region = { enter: () => this._enter(), exit: () => this._exit() };
    this.boundFb = null;
    this.u = {
      geo: new Float32Array(9),
      qRect: new Float32Array([0, 0, 1, 1]),
      gRect: new Float32Array([0, 0, 1, 1]),
      padUV: new Float32Array(4),
      boxPx: new Float32Array(2),
      cm: new Float32Array(16),
      co: new Float32Array(4),
      clip: new Float32Array(4),
      tint: new Float32Array(3),
      chroma: new Float32Array(2),
    };
    this.stats = { draws: 0, layers: 0 };
  }
  begin() { this.renderer.enterDrawRegion(this.region); }
  _enter() {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    this.boundFb = undefined;
  }
  _exit() {
    const gl = this.gl;
    for (const loc of this.attribLocs) gl.disableVertexAttribArray(loc);
    this.attribLocs.clear();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.boundFb = undefined;
    this.curProgram = null;
  }
  program(key, vs, fs, defines = []) {
    const id = key + "|" + defines.join(",");
    let p = this.programs.get(id);
    if (p) return p;
    const head = defines.map((d) => `#define ${d}\n`).join("");
    p = this.twgl.createProgramInfo(this.gl, [vs, head + fs]);
    if (!p) throw new Error("KS5 shader failed to compile: " + id);
    p.posLoc = this.gl.getAttribLocation(p.program, "a_pos");
    this.programs.set(id, p);
    return p;
  }
  use(p) {
    const gl = this.gl;
    if (this.curProgram !== p) { gl.useProgram(p.program); this.curProgram = p; }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p.posLoc);
    gl.vertexAttribPointer(p.posLoc, 2, gl.FLOAT, false, 0, 0);
    this.attribLocs.add(p.posLoc);
  }
  drawQuad() { this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4); this.stats.draws++; }
  createTarget(w, h) {
    const gl = this.gl;
    const tex = this.twgl.createTexture(gl, { width: w, height: h, min: gl.LINEAR, mag: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE, auto: false });
    const fbi = this.twgl.createFramebufferInfo(gl, [{ attachment: tex }], w, h);
    return { fbi, fb: fbi.framebuffer, tex, w, h };
  }
  deleteTarget(t) {
    if (!t) return;
    const gl = this.gl;
    gl.deleteFramebuffer(t.fb);
    gl.deleteTexture(t.tex);
    t.fb = t.tex = null;
  }
  temp(w, h) {
    for (let i = 0; i < this.pool.length; i++) {
      const t = this.pool[i];
      if (t.w === w && t.h === h) { this.pool.splice(i, 1); return t; }
    }
    return this.createTarget(w, h);
  }
  release(t) {
    if (!t) return;
    this.pool.push(t);
    while (this.pool.length > 8) this.deleteTarget(this.pool.shift());
  }
  bind(t) {
    const gl = this.gl;
    const fb = t ? t.fb : null;
    if (this.boundFb !== fb) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); this.boundFb = fb; }
    if (t) gl.viewport(0, 0, t.w, t.h);
  }
  clear(t) {
    const gl = this.gl;
    this.bind(t);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  bindTex(unit, tex, linear = true) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  }
  copy(src, dst, alpha = 1, blend = false) {
    const gl = this.gl;
    const p = this.program("copy", FULL_VS, COPY_FS);
    this.bind(dst);
    this.use(p);
    this.bindTex(0, src.tex);
    this.twgl.setUniforms(p, { u_src: src.tex, u_alpha: alpha });
    if (!blend) gl.disable(gl.BLEND);
    this.drawQuad();
    if (!blend) gl.enable(gl.BLEND);
  }
  composite(src, dst, out, mode, alpha, mask, maskInvert) {
    const gl = this.gl;
    const p = this.program("comp", FULL_VS, COMPOSITE_FS, mask ? ["MASKED"] : []);
    this.bind(out);
    this.use(p);
    this.bindTex(0, src.tex);
    this.bindTex(1, dst.tex);
    const uni = { u_src: src.tex, u_dst: dst.tex, u_alpha: alpha, u_mode: BLEND_INDEX[mode] ?? 0 };
    if (mask) { this.bindTex(2, mask.tex); uni.u_mask = mask.tex; uni.u_maskInvert = maskInvert ? 1 : 0; }
    this.twgl.setUniforms(p, uni);
    gl.disable(gl.BLEND);
    this.drawQuad();
    gl.enable(gl.BLEND);
    return out;
  }
  blur(t, radiusPx) {
    if (radiusPx <= 0.25) return t;
    const gl = this.gl;
    const p = this.program("blur", FULL_VS, BLUR_FS);
    const tmp = this.temp(t.w, t.h);
    const sigmaPx = radiusPx / 2;
    const stepPx = Math.max(1, sigmaPx / 4);
    const sigmaTaps = sigmaPx / stepPx;
    gl.disable(gl.BLEND);
    this.bind(tmp);
    this.use(p);
    this.bindTex(0, t.tex);
    this.twgl.setUniforms(p, { u_src: t.tex, u_step: [stepPx / t.w, 0], u_sigma: sigmaTaps });
    this.drawQuad();
    this.bind(t);
    this.bindTex(0, tmp.tex);
    this.twgl.setUniforms(p, { u_src: tmp.tex, u_step: [0, stepPx / t.h], u_sigma: sigmaTaps });
    this.drawQuad();
    gl.enable(gl.BLEND);
    this.release(tmp);
    return t;
  }
  spriteProgram(bits) {
    const defs = [];
    if (bits & 1) defs.push("FX_PIXELATE");
    if (bits & 2) defs.push("FX_MOSAIC");
    if (bits & 4) defs.push("FX_WHIRL");
    if (bits & 8) defs.push("FX_FISHEYE");
    if (bits & 16) defs.push("FX_CHROMA");
    if (bits & 32) defs.push("FX_CLIP");
    if (bits & 64) defs.push("FX_TINT");
    if (bits & 128) defs.push("FX_MATRIX");
    return this.program("sprite", QUAD_VS, SPRITE_FS, defs);
  }
  drawSprite(d, alpha, linear) {
    const gl = this.gl;
    const p = this.spriteProgram(d.bits);
    this.use(p);
    this.bindTex(0, d.tex, linear);
    const u = {u_tex: d.tex, u_geo: d.geo, u_padUV: d.padUV, u_boxPx: d.boxPx, u_alpha: alpha};
    if (d.bits & 1) u.u_pixelate = d.pixelate;
    if (d.bits & 2) u.u_mosaic = d.mosaic;
    if (d.bits & 4) u.u_whirl = d.whirl;
    if (d.bits & 8) u.u_fisheye = d.fisheye;
    if (d.bits & 16) u.u_chroma = d.chroma;
    if (d.bits & 32) u.u_clip = d.clip;
    if (d.bits & 64) u.u_tint = d.tint;
    if (d.bits & 128) { u.u_cm = d.cm; u.u_co = d.co; }
    if (d.slices) {
      for (const sl of d.slices) {
        u.u_qRect = sl.q;
        u.u_gRect = sl.g;
        this.twgl.setUniforms(p, u);
        this.drawQuad();
      }
    } else {
      u.u_qRect = FULL_RECT;
      u.u_gRect = FULL_RECT;
      this.twgl.setUniforms(p, u);
      this.drawQuad();
    }
    gl.activeTexture(gl.TEXTURE0);
  }
}
const FULL_RECT = new Float32Array([0, 0, 1, 1]);
function buildDrawCmd(ctx, compiled, pose, gi, binding, out) {
  const cg = compiled.groups[gi];
  const num = pose.num;
  const base = gi * NUM_SLOTS;
  const ci = pose.costume[gi];
  if (!binding || ci < 0 || ci >= binding.count) return null;
  const costume = binding.costumes[ci];
  if (!costume) return null;
  const skin = ctx.renderer && ctx.renderer._allSkins[costume.skinId];
  if (!skin) return null;
  const size = skin.size;
  const rc = skin.rotationCenter;
  const k = costume.bitmapResolution && costume.dataFormat !== "svg" ? costume.bitmapResolution : 1;
  const sw = size[0] * k, sh = size[1] * k;
  if (!(sw > 0 && sh > 0)) return null;
  const rcx = rc[0] * k, rcy = rc[1] * k;
  const w5 = gi * 5;
  const x = pose.world[w5], y = pose.world[w5 + 1], rot = pose.world[w5 + 2];
  const fx = Math.cos((num[base + S.flipX] * Math.PI) / 180), fy = Math.cos((num[base + S.flipY] * Math.PI) / 180);
  const sx = (pose.world[w5 + 3] || 1e-5) / 100 * (Math.abs(fx) < 1e-4 ? 1e-4 : fx);
  const sy = (pose.world[w5 + 4] || 1e-5) / 100 * (Math.abs(fy) < 1e-4 ? 1e-4 : fy);
  const tx = Math.tan((num[base + S.skewX] * Math.PI) / 180);
  const ty = Math.tan((num[base + S.skewY] * Math.PI) / 180);
  const pivX = num[base + S.pivotX] + cg.pivotX;
  const pivY = num[base + S.pivotY] + cg.pivotY;
  const pad = Math.max(0, Math.round(num[base + S.padding]));
  const boxW = sw + pad * 2, boxH = sh + pad * 2;
  const W = ctx.W, H = ctx.H;
  const r = (rot * Math.PI) / 180;
  const cs = Math.cos(r), sn = Math.sin(r);
  const a = sx * (cs - sn * ty);
  const b = sx * (sn + cs * ty);
  const c = sy * (cs * tx - sn);
  const d = sy * (sn * tx + cs);
  const e = W / 2 + x - (ctx.cx || 0);
  const f = H / 2 - y + (ctx.cy || 0);
  const ox = pad + rcx + pivX;
  const oy = pad + rcy + pivY;
  out ||= newDrawCmd();
  out.gi = gi;
  out.W = W;
  out.H = H;
  out.skin = skin;
  out.costume = costume;
  const A = a * boxW, C = c * boxH, E = e - a * ox - c * oy;
  const B = b * boxW, D = d * boxH, F = f - b * ox - d * oy;
  out.canvas[0] = A; out.canvas[1] = B; out.canvas[2] = C; out.canvas[3] = D; out.canvas[4] = E; out.canvas[5] = F;
  const geo = out.geo;
  geo[0] = (2 * A) / W; geo[1] = (2 * B) / H; geo[2] = 0;
  geo[3] = (2 * C) / W; geo[4] = (2 * D) / H; geo[5] = 0;
  geo[6] = (2 * E) / W - 1; geo[7] = (2 * F) / H - 1; geo[8] = 1;
  out.padUV[0] = boxW / sw; out.padUV[1] = boxH / sh; out.padUV[2] = pad / sw; out.padUV[3] = pad / sh;
  out.boxPx[0] = boxW; out.boxPx[1] = boxH;
  out.x = x; out.y = y; out.rot = rot; out.sx = sx; out.sy = sy; out.sw = sw; out.sh = sh; out.pad = pad;
  out.rcx = rcx; out.rcy = rcy; out.pivX = pivX; out.pivY = pivY;
  out.mat[0] = a; out.mat[1] = b; out.mat[2] = c; out.mat[3] = d; out.mat[4] = e; out.mat[5] = f;
  let bits = 0;
  const pix = Math.max(0, num[base + S.fxPixelate]);
  if (pix > 0) { bits |= 1; out.pixelate = Math.max(1, Math.round(((pix / 10) * Math.max(boxW, boxH)) / 10)); }
  const mos = num[base + S.fxMosaic];
  if (mos) {
    const tiles = Math.max(1, Math.min(512, Math.round(Math.abs(mos) / 10 + 1)));
    if (tiles > 1) { bits |= 2; out.mosaic = tiles; }
  }
  const wh = num[base + S.fxWhirl];
  if (wh) { bits |= 4; out.whirl = (wh * Math.PI) / 180; }
  const fe = num[base + S.fxFisheye];
  if (fe) { bits |= 8; out.fisheye = Math.max(0, (fe + 100) / 100); }
  const chx = num[base + S.fxChromaticX], chy = num[base + S.fxChromaticY];
  if (chx || chy) { bits |= 16; out.chroma[0] = Math.round(chx); out.chroma[1] = Math.round(chy); }
  const ct = clamp01(num[base + S.clipTop] / 100), cb = clamp01(num[base + S.clipBottom] / 100);
  const cl = clamp01(num[base + S.clipLeft] / 100), cr = clamp01(num[base + S.clipRight] / 100);
  if (ct || cb || cl || cr) {
    bits |= 32;
    out.clip[0] = cl; out.clip[1] = ct; out.clip[2] = 1 - cr; out.clip[3] = 1 - cb;
  }
  const tint = num[base + S.tint];
  if (tint !== 0xffffff) {
    bits |= 64;
    const t = intToRGB(tint);
    out.tint[0] = t[0]; out.tint[1] = t[1]; out.tint[2] = t[2];
  }
  const filterStr = pose.filter[gi];
  const parsed = filterStr ? parseFilter(filterStr) : null;
  const m = groupColorMatrix(num[base + S.fxColor], num[base + S.fxBrightness], parsed);
  if (m) { bits |= 128; matrixUniforms(m, out.cm, out.co); }
  out.bits = bits;
  out.filter = parsed;
  const alpha = clamp01(num[base + S.alpha] / 100) * (1 - clamp01(num[base + S.fxGhost] / 100));
  out.alpha = alpha;
  out.blend = pose.blend[gi] || "source-over";
  const ns = cg.nineSlice;
  if (ns && (ns.l || ns.r || ns.t || ns.b) && (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4)) {
    out.slices = nineSlices(ns, boxW, boxH, pad, Math.abs(sx), Math.abs(sy), out.slices);
  } else out.slices = null;
  out.tex = skin.getTexture ? skin.getTexture([100 * Math.max(Math.abs(sx), Math.abs(sy)) * (ctx.texScale || 1), 100 * Math.max(Math.abs(sx), Math.abs(sy)) * (ctx.texScale || 1)]) : null;
  if (!out.tex) return null;
  return out;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function newDrawCmd() {
  return {
    gi: -1,
    skin: null,
    costume: null,
    tex: null,
    bits: 0,
    geo: new Float32Array(9),
    canvas: new Float64Array(6),
    mat: new Float64Array(6),
    padUV: new Float32Array(4),
    boxPx: new Float32Array(2),
    cm: new Float32Array(16),
    co: new Float32Array(4),
    clip: new Float32Array(4),
    tint: new Float32Array(3),
    chroma: new Float32Array(2),
    pixelate: 0,
    mosaic: 1,
    whirl: 0,
    fisheye: 1,
    alpha: 1,
    blend: "source-over",
    filter: null,
    slices: null,
  };
}
function cloneDrawCmd(d) {
  const o = newDrawCmd();
  for (const k of Object.keys(d)) {
    const v = d[k];
    if (ArrayBuffer.isView(v)) o[k] = v.slice();
    else if (k === "slices" && v) o[k] = v.map((s) => ({ q: s.q.slice(), g: s.g.slice() }));
    else o[k] = v;
  }
  return o;
}
function nineSlices(ns, boxW, boxH, pad, sx, sy, reuse) {
  const l = Math.max(0, ns.l) + pad, r = Math.max(0, ns.r) + pad, t = Math.max(0, ns.t) + pad, b = Math.max(0, ns.b) + pad;
  const qx = [0, l / boxW, 1 - r / boxW, 1];
  const qy = [0, t / boxH, 1 - b / boxH, 1];
  const scaledW = boxW * sx, scaledH = boxH * sy;
  let gl_ = l / scaledW, gr = r / scaledW, gt = t / scaledH, gb = b / scaledH;
  if (gl_ + gr > 1) { const k = 1 / (gl_ + gr); gl_ *= k; gr *= k; }
  if (gt + gb > 1) { const k = 1 / (gt + gb); gt *= k; gb *= k; }
  const gx = [0, gl_, 1 - gr, 1];
  const gy = [0, gt, 1 - gb, 1];
  const out = reuse && reuse.length === 9 ? reuse : Array.from({ length: 9 }, () => ({ q: new Float32Array(4), g: new Float32Array(4) }));
  let i = 0;
  for (let yy = 0; yy < 3; yy++) {
    for (let xx = 0; xx < 3; xx++) {
      const s = out[i++];
      s.q[0] = qx[xx]; s.q[1] = qy[yy]; s.q[2] = qx[xx + 1]; s.q[3] = qy[yy + 1];
      s.g[0] = gx[xx]; s.g[1] = gy[yy]; s.g[2] = gx[xx + 1]; s.g[3] = gy[yy + 1];
    }
  }
  return out;
}
function needsLayer(d, pose, gi) {
  if (d.blend !== "source-over") return true;
  if (pose.mask[gi] >= 0) return true;
  if (d.filter && (d.filter.blur > 0 || d.filter.shadows.length)) return true;
  const base = gi * NUM_SLOTS;
  const n = pose.num;
  if (n[base + S.motionBlur] > 0) return true;
  return false;
}
const _effectInfo = new WeakMap();
function effectInfo(renderer) {
  let info = _effectInfo.get(renderer);
  if (!info) {
    const SM = renderer._shaderManager && renderer._shaderManager.constructor;
    info = (SM && SM.EFFECT_INFO) || {};
    _effectInfo.set(renderer, info);
  }
  return info;
}
function nativeEligible(renderer, d, pose, gi) {
  if (d.slices || d.pad) return false;
  if (d.bits & (16 | 32)) return false;
  if (d.filter && d.filter.matrix) return false;
  if (d.bits & 64 && !effectInfo(renderer).tintColor) return false;
  return true;
}
class NativeParts {
  constructor(renderer) { this.renderer = renderer; this.ids = []; this.queue = []; }
  drawable(i) {
    const r = this.renderer;
    let id = this.ids[i];
    if (id === undefined || !r._allDrawables[id]) {
      const Drawable = r.exports.Drawable;
      id = r._nextDrawableId++;
      const dr = new Drawable(id, r);
      dr.skin = null;
      if (dr.setHighQuality) dr.setHighQuality(true);
      r._allDrawables[id] = dr;
      this.ids[i] = id;
    }
    return r._allDrawables[id];
  }
  prepare(slot, d, pose, gi, alphaMul, pxPerUnit, tintMul) {
    const dr = this.drawable(slot);
    const num = pose.num;
    const b = gi * NUM_SLOTS;
    dr.skin = d.skin;
    const alpha = d.alpha * alphaMul;
    setEffect(dr, "ghost", 100 - 100 * alpha);
    setEffect(dr, "color", num[b + S.fxColor]);
    setEffect(dr, "brightness", num[b + S.fxBrightness]);
    setEffect(dr, "pixelate", Math.max(0, num[b + S.fxPixelate]));
    setEffect(dr, "mosaic", num[b + S.fxMosaic]);
    setEffect(dr, "whirl", num[b + S.fxWhirl]);
    setEffect(dr, "fisheye", num[b + S.fxFisheye]);
    if (effectInfo(this.renderer).tintColor) {
      let tint = num[b + S.tint];
      if (tintMul) tint = mulTint(tint, tintMul);
      setEffect(dr, "tintColor", tint === 0xffffff ? 0 : tint + 1);
    }
    const [a, bb, c, dd, e0, f0] = d.mat;
    const sw = d.sw, sh = d.sh;
    const ox = d.rcx + d.pivX, oy = d.rcy + d.pivY;
    const W = d.W, H = d.H;
    const X0 = e0 - W / 2, Y0 = H / 2 - f0;
    const m = dr._uniforms.u_modelMatrix;
    m[0] = -a * sw;
    m[1] = bb * sw;
    m[4] = c * sh;
    m[5] = -dd * sh;
    m[12] = X0 + a * (0.5 * sw - ox) + c * (0.5 * sh - oy);
    m[13] = Y0 - bb * (0.5 * sw - ox) - dd * (0.5 * sh - oy);
    dr._transformDirty = false;
    const s = 100 * Math.max(Math.abs(d.sx), Math.abs(d.sy)) * (d.costume && d.costume.dataFormat !== "svg" ? d.costume.bitmapResolution || 1 : 1) * pxPerUnit;
    dr._scale[0] = s;
    dr._scale[1] = s;
    dr._direction = 90 + d.rot;
    this.queue.push(dr.id);
  }
  flush(pipe, target, W, H, cx, cy) {
    if (!this.queue.length) return;
    const r = this.renderer;
    const twgl = r.exports.twgl;
    r._doExitDrawRegion();
    const gl = r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    const proj = (this._proj ||= new Float32Array(16));
    twgl.m4.ortho(cx - W / 2, cx + W / 2, cy + H / 2, cy - H / 2, -1, 1, proj);
    const off = r.renderOffscreen;
    r.renderOffscreen = true;
    const sm = r._shaderManager;
    const swapped = sm && Object.prototype.hasOwnProperty.call(sm, "getShader") ? sm.getShader : null;
    if (swapped) delete sm.getShader;
    try { r._drawThese(this.queue, "default", proj, { ignoreVisibility: true }); } finally {
      if (swapped) sm.getShader = swapped;
      r.renderOffscreen = off;
    }
    this.queue.length = 0;
    pipe.curProgram = null;
    pipe.boundFb = undefined;
    pipe.begin();
  }
  dispose() {
    const r = this.renderer;
    for (const id of this.ids) {
      const dr = r._allDrawables[id];
      if (dr) {
        dr.skin = null;
        if (dr.dispose) dr.dispose();
        delete r._allDrawables[id];
      }
    }
    this.ids = [];
  }
}
function setEffect(dr, name, value) {
  const cur = dr._effects ? dr._effects[name] : undefined;
  if (cur === value) return;
  (dr._effects ||= {})[name] = value;
  dr.updateEffect(name, value);
}
function mulTint(a, m) {
  const r = ((a >> 16) & 255) * m[0], g = ((a >> 8) & 255) * m[1], b = (a & 255) * m[2];
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
const MAX_ENTRIES = 64;
const CACHE_PX = 192;
let _texIds = new WeakMap();
let _nextTex = 1;
const texId = (t) => {
  let id = _texIds.get(t);
  if (!id) _texIds.set(t, (id = _nextTex++));
  return id;
};
class StyleCache {
  constructor(pipe) { this.pipe = pipe; this.map = new Map(); }
  get(d, kind, radius) {
    const r = Math.max(0, Math.round(radius * 2) / 2);
    const key = `${texId(d.tex)}|${d.sw}|${d.sh}|${kind}|${r}`;
    let e = this.map.get(key);
    if (e) { this.map.delete(key); this.map.set(key, e); return e; }
    e = this.build(d, kind, r);
    this.map.set(key, e);
    while (this.map.size > MAX_ENTRIES) {
      const [k, old] = this.map.entries().next().value;
      this.map.delete(k);
      this.pipe.deleteTarget(old.target);
    }
    return e;
  }
  build(d, kind, r) {
    const pipe = this.pipe;
    const gl = pipe.gl;
    const ext = Math.ceil(kind === "blur" ? r * 1.6 : r) + 2;
    const bw = d.sw + ext * 2, bh = d.sh + ext * 2;
    const q = Math.min(1, CACHE_PX / Math.max(bw, bh));
    const w = Math.max(4, Math.ceil(bw * q)), h = Math.max(4, Math.ceil(bh * q));
    const target = pipe.createTarget(w, h);
    pipe.clear(target);
    const p = pipe.program("sprite", QUAD_VS, SPRITE_FS, []);
    pipe.bind(target);
    pipe.use(p);
    pipe.bindTex(0, d.tex, true);
    pipe.twgl.setUniforms(p, {
      u_tex: d.tex,
      u_geo: [2, 0, 0, 0, 2, 0, -1, -1, 1],
      u_qRect: [0, 0, 1, 1],
      u_gRect: [0, 0, 1, 1],
      u_padUV: [bw / d.sw, bh / d.sh, ext / d.sw, ext / d.sh],
      u_boxPx: [bw, bh],
      u_alpha: 1,
    });
    gl.disable(gl.BLEND);
    pipe.drawQuad();
    gl.enable(gl.BLEND);
    if (kind === "blur" && r > 0) pipe.blur(target, r * q);
    else if (kind === "dilate" && r > 0) {
      const tmp = pipe.temp(w, h);
      const dp = pipe.program("dilate", FULL_VS, DILATE_FS);
      pipe.bind(tmp);
      pipe.use(dp);
      pipe.bindTex(0, target.tex);
      pipe.twgl.setUniforms(dp, { u_src: target.tex, u_px: [1 / w, 1 / h], u_radius: r * q });
      gl.disable(gl.BLEND);
      pipe.drawQuad();
      pipe.copy(tmp, target);
      gl.enable(gl.BLEND);
      pipe.release(tmp);
    }
    return { target, ext };
  }
  draw(d, entry, color, alpha, gain, dx = 0, dy = 0) {
    const pipe = this.pipe;
    const E = entry.ext;
    const [a, b, c, dd, e0, f0] = d.mat;
    const ox = d.rcx + d.pivX, oy = d.rcy + d.pivY;
    const bw = d.sw + E * 2, bh = d.sh + E * 2;
    const A = a * bw, C = c * bh, EE = e0 + dx + a * (-E - ox) + c * (-E - oy);
    const B = b * bw, D = dd * bh, F = f0 + dy + b * (-E - ox) + dd * (-E - oy);
    const W = d.W, H = d.H;
    const geo = (this._geo ||= new Float32Array(9));
    geo[0] = (2 * A) / W; geo[1] = (2 * B) / H; geo[2] = 0;
    geo[3] = (2 * C) / W; geo[4] = (2 * D) / H; geo[5] = 0;
    geo[6] = (2 * EE) / W - 1; geo[7] = (2 * F) / H - 1; geo[8] = 1;
    const p = pipe.program("tint", QUAD_VS, TINT_FS);
    pipe.use(p);
    pipe.bindTex(0, entry.target.tex, true);
    pipe.twgl.setUniforms(p, { u_tex: entry.target.tex, u_geo: geo, u_qRect: [0, 0, 1, 1], u_gRect: [0, 0, 1, 1], u_color: color, u_gain: gain, u_alpha: alpha });
    pipe.drawQuad();
  }
  dispose() {
    for (const e of this.map.values()) this.pipe.deleteTarget(e.target);
    this.map.clear();
  }
}
const MB_SAMPLES = 6;
const TRAIL_MAX = 40;
class Surface {
  constructor(pipe) {
    this.pipe = pipe;
    this.acc = [null, null];
    this.cur = 0;
    this.W = 480;
    this.H = 360;
    this.scale = 1;
    this.fbw = 0;
    this.fbh = 0;
    this.trails = new Map();
    this.cmds = [];
    this.mbPoses = [];
    this.lastSec = NaN;
  }
  get tex() { const t = this.acc[this.cur]; return t ? t.tex : null; }
  get target() { return this.acc[this.cur]; }
  ensure(W, H, scale) {
    const pipe = this.pipe;
    const max = pipe.maxTex;
    let s = Math.max(0.05, scale);
    if (W * s > max) s = max / W;
    if (H * s > max) s = max / H;
    const fbw = Math.max(1, Math.round(W * s));
    const fbh = Math.max(1, Math.round(H * s));
    this.W = W;
    this.H = H;
    this.scale = s;
    if (fbw === this.fbw && fbh === this.fbh && this.acc[0]) return false;
    this.fbw = fbw;
    this.fbh = fbh;
    for (let i = 0; i < 2; i++) { pipe.deleteTarget(this.acc[i]); this.acc[i] = pipe.createTarget(fbw, fbh); }
    this.cur = 0;
    return true;
  }
  dispose() {
    if (this.native) this.native.dispose();
    for (let i = 0; i < 2; i++) this.pipe.deleteTarget(this.acc[i]);
    this.acc = [null, null];
    this.trails.clear();
  }
  clearTrails() { this.trails.clear(); }
}
function renderPose(pipe, surface, compiled, pose, opts) {
  const gl = pipe.gl;
  const W = surface.W, H = surface.H;
  const renderer = opts.renderer;
  const ctx = { renderer, W, H, texScale: (opts.texScale || 1) * surface.scale, cx: opts.cx || 0, cy: opts.cy || 0 };
  const tintAll = opts.tint || null;
  const bindings = opts.bindings;
  const globalAlpha = opts.alpha ?? 1;
  const linear = opts.aa !== false;
  const native = (surface.native ||= renderer && renderer._drawThese && renderer.exports && renderer.exports.Drawable ? new NativeParts(renderer) : null);
  const styles = (pipe.styles ||= new StyleCache(pipe));
  const pxPerUnit = surface.scale * (opts.texScale || 1);
  pipe.begin();
  let acc = surface.acc[surface.cur];
  if (opts.clear !== false) pipe.clear(acc);
  else pipe.bind(acc);
  const t = pose.t;
  const n = compiled.groups.length;
  while (surface.cmds.length < n) surface.cmds.push(newDrawCmd());
  let mbCache = null;
  let slot = 0;
  let target = acc;
  const flush = () => {
    if (native && native.queue.length) { native.flush(pipe, target, W, H, 0, 0); slot = 0; }
  };
  const setTarget = (tg) => {
    if (tg !== target) flush();
    target = tg;
    pipe.bind(tg);
  };
  const drawPart = (d, gi, alpha, forceCustom = false) => {
    if (alpha <= 0.001) return;
    if (native && !forceCustom && nativeEligible(renderer, d, pose, gi)) {
      native.prepare(slot++, d, pose, gi, alpha / (d.alpha || 1), pxPerUnit, tintAll);
      return;
    }
    flush();
    pipe.bind(target);
    pipe.drawSprite(d, alpha, linear);
  };
  const drawStyles = (d, num, base, alphaMul) => {
    const glow = num[base + S.glowSize], outline = num[base + S.outlineWidth];
    const shA = num[base + S.shadowAlpha];
    const hasShadow = shA > 0 && (num[base + S.shadowX] || num[base + S.shadowY] || num[base + S.shadowBlur]);
    if (!(glow > 0 || outline > 0 || hasShadow)) return;
    flush();
    const eShadow = hasShadow ? styles.get(d, "blur", num[base + S.shadowBlur]) : null;
    const eGlow = glow > 0 ? styles.get(d, "blur", glow) : null;
    const eOutline = outline > 0 ? styles.get(d, "dilate", outline) : null;
    pipe.bind(target);
    const a = d.alpha * alphaMul;
    if (eShadow) styles.draw(d, eShadow, intToRGB(num[base + S.shadowColor]), a * (shA / 100), 1, num[base + S.shadowX], -num[base + S.shadowY]);
    if (eGlow) styles.draw(d, eGlow, intToRGB(num[base + S.glowColor]), a, 2 * Math.max(0, num[base + S.glowStrength] / 100));
    if (eOutline) styles.draw(d, eOutline, intToRGB(num[base + S.outlineColor]), a, 1);
  };
  for (let oi = 0; oi < n; oi++) {
    const gi = pose.order[oi];
    const trailKey = compiled.groups[gi].name;
    if (!compiled.isVisible(pose, gi)) { surface.trails.delete(trailKey); continue; }
    const d = buildDrawCmd(ctx, compiled, pose, gi, bindings ? bindings[gi] : null, surface.cmds[gi]);
    if (!d) continue;
    if (tintAll) {
      if (!(d.bits & 64)) { d.tint[0] = d.tint[1] = d.tint[2] = 1; d.bits |= 64; }
      d.tint[0] *= tintAll[0];
      d.tint[1] *= tintAll[1];
      d.tint[2] *= tintAll[2];
    }
    const alpha = d.alpha * globalAlpha;
    const base = gi * NUM_SLOTS;
    const num = pose.num;
    if (!needsLayer(d, pose, gi)) {
      setTarget(acc);
      if (surface.trails.has(trailKey) || num[base + S.afterimageIntensity] > 0) {
        flush();
        pipe.bind(target);
        drawTrail(pipe, surface, trailKey, num, base, t, alpha, linear, d);
      }
      drawStyles(d, num, base, globalAlpha);
      drawPart(d, gi, alpha);
      recordTrail(surface, trailKey, num, base, t, d);
      continue;
    }
    pipe.stats.layers++;
    flush();
    let L = pipe.temp(surface.fbw, surface.fbh);
    pipe.clear(L);
    setTarget(L);
    drawStyles(d, num, base, 1);
    const mb = num[base + S.motionBlur];
    if (mb > 0 && opts.poseAt) {
      mbCache ||= [];
      const shutter = (mb / 100) * (2 / (opts.fps || 30));
      flush();
      pipe.bind(L);
      gl.blendFunc(gl.ONE, gl.ONE);
      const tmp = surface._mbCmd || (surface._mbCmd = newDrawCmd());
      for (let s = 0; s < MB_SAMPLES; s++) {
        let ps = mbCache[s];
        if (!ps) ps = mbCache[s] = opts.poseAt(t - (shutter * s) / (MB_SAMPLES - 1), s);
        const ds = s === 0 ? d : buildDrawCmd(ctx, compiled, ps, gi, bindings ? bindings[gi] : null, tmp);
        if (ds) pipe.drawSprite(ds, 1 / MB_SAMPLES, linear);
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      if (num[base + S.afterimageIntensity] > 0) { pipe.bind(L); drawTrail(pipe, surface, trailKey, num, base, t, 1, linear, d); }
      drawPart(d, gi, 1);
      recordTrail(surface, trailKey, num, base, t, d);
    }
    flush();
    const scale = surface.scale;
    if (d.filter && d.filter.blur > 0) pipe.blur(L, d.filter.blur * scale);
    if (d.filter) for (const sh of d.filter.shadows) L = stylePass(pipe, L, { shadow: sh, scale });
    let M = null;
    const mi = pose.mask[gi];
    if (mi >= 0) {
      M = pipe.temp(surface.fbw, surface.fbh);
      pipe.clear(M);
      const md = buildDrawCmd(ctx, compiled, pose, mi, bindings ? bindings[mi] : null, surface._maskCmd || (surface._maskCmd = newDrawCmd()));
      if (md) {
        md.bits = 0;
        md.slices = null;
        pipe.bind(M);
        pipe.drawSprite(md, 1, linear);
      }
    }
    const out = surface.acc[1 - surface.cur];
    pipe.composite(L, acc, out, d.blend, alpha, M, mi >= 0 && num[base + S.maskInvert]);
    surface.cur = 1 - surface.cur;
    acc = out;
    target = acc;
    pipe.release(L);
    if (M) pipe.release(M);
  }
  target = acc;
  flush();
  surface.lastSec = t;
  return acc;
}
function drawTrail(pipe, surface, key, num, base, t, alphaMul, linear) {
  const intensity = Math.min(100, Math.max(0, num[base + S.afterimageIntensity]));
  if (!(intensity > 0)) {
    if (surface.trails.has(key)) surface.trails.delete(key);
    return;
  }
  const fade = Math.min(100, Math.max(0, num[base + S.afterimageFade])) / 100;
  const interval = Math.max(0.01, num[base + S.afterimageInterval] || 0.05);
  let trail = surface.trails.get(key);
  if (!trail) return;
  const last = trail[trail.length - 1];
  if (last && Math.abs(t - last.sec) > interval * 5) { surface.trails.set(key, (trail = [])); return; }
  const windowSec = Math.max(interval * 20, 2);
  const a0 = (alphaMul * intensity) / 100;
  for (const snap of trail) {
    const steps = Math.abs(t - snap.sec) / interval;
    if (steps > windowSec / interval) continue;
    const a = a0 * Math.pow(fade, steps);
    if (a < 0.005) continue;
    pipe.drawSprite(snap.cmd, a * snap.alpha, linear);
  }
}
function recordTrail(surface, key, num, base, t, d) {
  const intensity = num[base + S.afterimageIntensity];
  if (!(intensity > 0)) return;
  const interval = Math.max(0.01, num[base + S.afterimageInterval] || 0.05);
  let trail = surface.trails.get(key);
  if (!trail) surface.trails.set(key, (trail = []));
  const last = trail[trail.length - 1];
  if (!last || Math.abs(t - last.sec) >= interval) {
    trail.push({ sec: t, cmd: cloneDrawCmd(d), alpha: 1 });
    if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX);
  }
}
function stylePass(pipe, L, o) {
  const gl = pipe.gl;
  const w = L.w, h = L.h;
  let G = null, SH = null;
  if (o.glow) { G = pipe.temp(w, h); pipe.copy(L, G); pipe.blur(G, o.glow.size * o.scale); }
  if (o.shadow) {
    SH = pipe.temp(w, h);
    pipe.copy(L, SH);
    if (o.shadow.blur > 0) pipe.blur(SH, o.shadow.blur * o.scale);
  }
  const out = pipe.temp(w, h);
  const p = pipe.program("style", FULL_VS, STYLE_FS);
  pipe.bind(out);
  pipe.use(p);
  pipe.bindTex(0, L.tex);
  pipe.bindTex(1, G ? G.tex : L.tex);
  pipe.bindTex(2, SH ? SH.tex : L.tex);
  const sc = o.shadow && o.shadow.color ? o.shadow.color : [0, 0, 0, 1];
  pipe.twgl.setUniforms(p, {
    u_src: L.tex,
    u_glowTex: G ? G.tex : L.tex,
    u_shadowTex: SH ? SH.tex : L.tex,
    u_px: [1 / w, 1 / h],
    u_outline: o.outline ? o.outline.width * o.scale : 0,
    u_outlineColor: o.outline ? [...o.outline.color, 1] : [0, 0, 0, 1],
    u_glow: o.glow ? Math.max(0, o.glow.strength) * 2 : 0,
    u_glowColor: o.glow ? [...o.glow.color, 1] : [1, 1, 1, 1],
    u_shadow: o.shadow ? (o.shadow.alpha ?? sc[3] ?? 1) : 0,
    u_shadowColor: sc,
    u_shadowOff: o.shadow ? [(o.shadow.x * o.scale) / w, (o.shadow.y * o.scale) / h] : [0, 0],
  });
  gl.disable(gl.BLEND);
  pipe.drawQuad();
  gl.enable(gl.BLEND);
  pipe.release(L);
  if (G) pipe.release(G);
  if (SH) pipe.release(SH);
  return out;
}
const _classes = new WeakMap();
const SIL_MAX = 480;
function createKS5Skin(renderer, pipe) {
  let Cls = _classes.get(renderer);
  if (!Cls) { Cls = makeClass(renderer.exports.Skin); _classes.set(renderer, Cls); }
  const id = renderer._nextSkinId++;
  const skin = new Cls(id, renderer, pipe);
  renderer._allSkins[id] = skin;
  return skin;
}
function makeClass(Skin) {
  const KS5Skin = class KS5Skin extends Skin {
    constructor(id, renderer, pipe) {
      super(id, renderer);
      this.pipe = pipe;
      this.surface = new Surface(pipe);
      this._size = [480, 360];
      this._rotationCenter[0] = 240;
      this._rotationCenter[1] = 180;
      this.aa = true;
      this.silDirty = true;
      this.requestedScale = 1;
      this.isKS5 = true;
      this._silPixels = null;
      this._silImage = null;
    }
    get size() { return this._size; }
    useNearest() { return !this.aa; }
    getTexture(scale) {
      if (scale) {
        const s = Math.max(Math.abs(scale[0]), Math.abs(scale[1])) / 100;
        if (s > 0 && Number.isFinite(s)) {
          if (this._scaleFrame !== skinFrame.value) {
            this._scaleFrame = skinFrame.value;
            this.requestedScale = s;
          } else if (s > this.requestedScale) this.requestedScale = s;
        }
      }
      return this.surface.tex || null;
    }
    setGeometry(W, H, rcx, rcy) {
      if (this._size[0] === W && this._size[1] === H && this._rotationCenter[0] === rcx && this._rotationCenter[1] === rcy) return;
      this._size = [W, H];
      this._rotationCenter[0] = rcx;
      this._rotationCenter[1] = rcy;
      this.silDirty = true;
      this.emitWasAltered();
    }
    markContentChanged() { this.silDirty = true; }
    updateSilhouette() {
      if (!this.silDirty) return;
      this.silDirty = false;
      const src = this.surface.target;
      if (!src) return;
      const pipe = this.pipe;
      const gl = pipe.gl;
      const k = Math.min(1, SIL_MAX / Math.max(src.w, src.h));
      const w = Math.max(1, Math.round(src.w * k));
      const h = Math.max(1, Math.round(src.h * k));
      pipe.begin();
      let read = src;
      let tmp = null;
      if (w !== src.w || h !== src.h) {
        tmp = pipe.temp(w, h);
        pipe.clear(tmp);
        const p = pipe.program("copy", FULL_VS, COPY_FS);
        pipe.bind(tmp);
        pipe.use(p);
        pipe.bindTex(0, src.tex, true);
        pipe.twgl.setUniforms(p, { u_src: src.tex, u_alpha: 1 });
        gl.disable(gl.BLEND);
        pipe.drawQuad();
        gl.enable(gl.BLEND);
        read = tmp;
      }
      pipe.bind(read);
      if (!this._silPixels || this._silPixels.length !== w * h * 4) {
        this._silPixels = new Uint8Array(w * h * 4);
        this._silImage = new ImageData(w, h);
      }
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this._silPixels);
      if (tmp) pipe.release(tmp);
      this._silImage.data.set(this._silPixels);
      this._silhouette.update(this._silImage, true);
    }
    dispose() { this.surface.dispose(); super.dispose(); }
  };
  return KS5Skin;
}
const skinFrame = { value: 0 };
export { BLEND_INDEX, BLUR_FS, COMPOSITE_FS, COPY_FS, DILATE_FS, FULL_VS, GpuPipeline, NativeParts, QUAD_VS, SPRITE_FS, STYLE_FS, StyleCache, Surface, TINT_FS, UNPREMULT_FS, buildDrawCmd, cloneDrawCmd, createKS5Skin, groupColorMatrix, hueRotateMatrix, matrixUniforms, nativeEligible, needsLayer, newDrawCmd, parseFilter, renderPose, skinFrame };
