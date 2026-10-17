import fs from 'fs';
import path from 'path';
import {injectShader, soundIndexOf, setSoundOverlap, getSoundOverlap} from '../../../src/lib/dimod-block-defs';

const frag = fs.readFileSync(path.join(__dirname, '../../../node_modules/scratch-render/src/shaders/sprite.frag.glsl'), 'utf8');
const vert = fs.readFileSync(path.join(__dirname, '../../../node_modules/scratch-render/src/shaders/sprite.vert.glsl'), 'utf8');

const target = sounds => ({
    sprite: {sounds: sounds.map((name, i) => ({name, soundId: `id${i}`}))},
    getSoundIndexByName (name) {
        return this.sprite.sounds.findIndex(s => s.name === name);
    }
});

describe('dimod media effects', () => {
    test('splices the new effects into the real fragment shader, once', () => {
        const out = injectShader(frag);
        expect(out).toContain('uniform float u_mosaicWidth;');
        expect(out).toContain('texcoord0.x -= u_mosaicX;');
        expect(out).toContain('#ifdef ENABLE_invert');
        expect(out.indexOf('u_mosaicX;')).toBeLessThan(out.indexOf('void main()'));
        expect(injectShader(out)).toBe(out);
    });
    test('pads the quad for the effects that draw outside the costume', () => {
        const out = injectShader(vert);
        expect(out).toContain('uniform vec2 u_dimodShadow;');
        expect(out.indexOf('dimodPad')).toBeGreaterThan(out.indexOf('v_texCoord = a_texCoord;'));
        expect(injectShader(out)).toBe(out);
    });
    test('draws shadow, glow and outline after the shader\'s own main', () => {
        const out = injectShader(frag);
        expect(out).toContain('void dimodMain()');
        expect(out.match(/void main\(\)/g)).toHaveLength(1);
        expect(out.indexOf('void main()')).toBeGreaterThan(out.indexOf('void dimodMain()'));
        expect(out).toContain('uniform float u_contrast;');
    });
    test('leaves other shaders alone', () => {
        const other = 'attribute vec2 a_position; void main() {}';
        expect(injectShader(other)).toBe(other);
    });
    test('finds sounds by name, then by number, wrapping', () => {
        const t = target(['meow', 'pop', '2']);
        expect(soundIndexOf(t, 'pop')).toBe(1);
        expect(soundIndexOf(t, '2')).toBe(2);
        expect(soundIndexOf(t, 1)).toBe(0);
        expect(soundIndexOf(t, 4)).toBe(0);
        expect(soundIndexOf(t, 'nope')).toBe(-1);
    });
    test('overlap is per sound', () => {
        const t = target(['meow', 'pop']);
        setSoundOverlap(t, 'pop', true);
        expect(getSoundOverlap(t, 'pop')).toBe(true);
        expect(getSoundOverlap(t, 'meow')).toBe(false);
        setSoundOverlap(t, 'pop', false);
        expect(getSoundOverlap(t, 'pop')).toBe(false);
    });
});
