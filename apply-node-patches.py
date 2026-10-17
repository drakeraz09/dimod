#!/usr/bin/env python3
# Reapplies dimod's patches to node_modules (lost on reinstall). Usage: apply-node-patches.py [root ...]  (default: this folder)
# 1. scratch-svg-renderer sanitizer keeps same-document <use>   2. sprite blend modes (render + vm)
import os, sys

def patch(path, edits):
    if not os.path.exists(path):
        return
    s = open(path).read()
    changed = False
    for marker, old, new in edits:
        if marker in s:
            continue
        if old not in s:
            print('MISSING anchor in', path, old[:50])
            continue
        s = s.replace(old, new, 1)
        changed = True
    if changed:
        open(path, 'w').write(s)
        print('patched', path)

for root in sys.argv[1:] or [os.path.dirname(os.path.abspath(__file__))]:
    for app in ('studio-src', 'packager-src'):
        nm = os.path.join(root, app, 'node_modules')
        patch(nm + '/scratch-svg-renderer/src/sanitize-svg.js', [('dimod-use', """sanitizeSvg.sanitizeSvgText = function (rawSvgText) {
    let sanitizedText = DOMPurify.sanitize(rawSvgText, {
        USE_PROFILES: {svg: true}
    });""", """// dimod-use: keep <use> but only with same-document "#id" references
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (node.nodeName && node.nodeName.toLowerCase() === 'use' && /^(xlink:)?href$/.test(data.attrName) &&
        !/^#[\\w-]+$/.test(data.attrValue)) data.keepAttr = false;
});

sanitizeSvg.sanitizeSvgText = function (rawSvgText) {
    let sanitizedText = DOMPurify.sanitize(rawSvgText, {
        USE_PROFILES: {svg: true},
        ADD_TAGS: ['use']
    });""")])
        patch(nm + '/scratch-render/src/Drawable.js', [('dimod-blend', "        this._visible = true;\n", "        this._visible = true;\n        this.blendMode = null; // dimod-blend\n")])
        patch(nm + '/scratch-render/src/RenderWebGL.js', [
            ('dimod-blend', """            twgl.setUniforms(currentShader, uniforms);
            twgl.drawBufferInfo(gl, this._bufferInfo, gl.TRIANGLES);
        }

        this._regionId = null;""", """            twgl.setUniforms(currentShader, uniforms);
            // dimod-blend: per-sprite blend mode (default draw only)
            const blended = drawable.blendMode && drawMode === ShaderManager.DRAW_MODE.default;
            if (blended) this._setBlendMode(drawable.blendMode);
            twgl.drawBufferInfo(gl, this._bufferInfo, gl.TRIANGLES);
            if (blended) this._setBlendMode(null);
        }

        this._regionId = null;"""),
            ('_setBlendMode (', """    updateDrawableVisible (drawableID, visible) {""", """    _setBlendMode (mode) {
        const gl = this._gl;
        gl.blendEquation(mode === 'lighten' ? gl.MAX : mode === 'subtract' ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD);
        if (mode === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
        else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
        else if (mode === 'exclusion') gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR);
        else if (mode === 'erase') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        else if (mode === 'add' || mode === 'lighten' || mode === 'subtract') gl.blendFunc(gl.ONE, gl.ONE);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    updateDrawableBlendMode (drawableID, mode) {
        const drawable = this._allDrawables[drawableID];
        if (!drawable) return;
        drawable.blendMode = mode && mode !== 'normal' ? mode : null;
        this.dirty = true;
    }

    updateDrawableVisible (drawableID, visible) {""")])
        rt = nm + '/scratch-vm/src/sprites/rendered-target.js'
        patch(rt, [
            ('dimod-blend', "        this.rotationStyle = RenderedTarget.ROTATION_STYLE_ALL_AROUND;\n", "        this.rotationStyle = RenderedTarget.ROTATION_STYLE_ALL_AROUND;\n        this.blendMode = 'normal'; // dimod-blend\n"),
            ('setBlendMode (', "    setEffect (effectName, value) { // used by compiler", """    setBlendMode (mode) {
        this.blendMode = mode;
        if (this.renderer) this.renderer.updateDrawableBlendMode(this.drawableID, mode);
        if (this.visible) this.emitVisualChange();
    }

    setEffect (effectName, value) { // used by compiler"""),
            ('this.renderer.updateDrawableBlendMode(this.drawableID, this.blendMode)', "            this.renderer.updateDrawableVisible(this.drawableID, this.visible);\n", "            this.renderer.updateDrawableVisible(this.drawableID, this.visible);\n            this.renderer.updateDrawableBlendMode(this.drawableID, this.blendMode);\n"),
            ('newClone.blendMode', "        newClone.rotationStyle = this.rotationStyle;\n", "        newClone.rotationStyle = this.rotationStyle;\n        newClone.blendMode = this.blendMode;\n"),
            ('newTarget.blendMode', "            newTarget.rotationStyle = this.rotationStyle;\n", "            newTarget.rotationStyle = this.rotationStyle;\n            newTarget.blendMode = this.blendMode;\n")])
        patch(nm + '/scratch-vm/src/serialization/sb3.js', [
            ('obj.blendMode', "        obj.rotationStyle = target.rotationStyle;\n", "        obj.rotationStyle = target.rotationStyle;\n        if (target.blendMode && target.blendMode !== 'normal') obj.blendMode = target.blendMode;\n"),
            ("target.blendMode = object", "    if (object.hasOwnProperty('rotationStyle')) {\n        target.rotationStyle = object.rotationStyle;\n    }\n", "    if (object.hasOwnProperty('rotationStyle')) {\n        target.rotationStyle = object.rotationStyle;\n    }\n    if (object.blendMode) target.blendMode = object.blendMode;\n")])
        patch(nm + '/scratch-vm/src/blocks/scratch3_looks.js', [
            ('looks_setblendmode', "            looks_seteffectto: this.setEffect,\n", "            looks_seteffectto: this.setEffect,\n            looks_setblendmode: (args, util) => util.target.setBlendMode(['multiply', 'screen', 'add', 'subtract', 'lighten', 'exclusion', 'erase'].includes(args.MODE) ? args.MODE : 'normal'),\n"),
            ('looks_blendmode', "            looks_getEffectValue: this.getEffectValue,\n", "            looks_getEffectValue: this.getEffectValue,\n            looks_blendmode: (args, util) => util.target.blendMode || 'normal',\n")])
        patch(nm + '/scratch-render/src/RenderWebGL.js', [
            ('dimod-backdrop', """            if (blended) this._setBlendMode(drawable.blendMode);
            twgl.drawBufferInfo(gl, this._bufferInfo, gl.TRIANGLES);
            if (blended) this._setBlendMode(null);""", """            const shaderMode = blended ? DIMOD_SHADER_BLENDS.indexOf(drawable.blendMode) + 1 : 0; // dimod-backdrop
            if (shaderMode) {
                const bd = this._dimodBackdrop(gl);
                twgl.setUniforms(currentShader, {u_dimodBlend: shaderMode, u_dimodBackdrop: bd.tex, u_dimodVp: bd.vp});
            } else if (blended) this._setBlendMode(drawable.blendMode);
            twgl.drawBufferInfo(gl, this._bufferInfo, gl.TRIANGLES);
            if (shaderMode) twgl.setUniforms(currentShader, {u_dimodBlend: 0});
            else if (blended) this._setBlendMode(null);"""),
            ('_dimodBackdrop (', """    _setBlendMode (mode) {""", """    _dimodBackdrop (gl) {
        const vp = gl.getParameter(gl.VIEWPORT);
        let bd = this._dimodBd;
        if (!bd) bd = this._dimodBd = {tex: gl.createTexture(), w: 0, h: 0, vp: [0, 0, 1, 1]};
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bd.tex);
        if (bd.w !== vp[2] || bd.h !== vp[3]) {
            gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, vp[0], vp[1], vp[2], vp[3], 0);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            bd.w = vp[2];
            bd.h = vp[3];
        } else gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, vp[0], vp[1], vp[2], vp[3]);
        gl.activeTexture(gl.TEXTURE0);
        bd.vp = [vp[0], vp[1], vp[2], vp[3]];
        return bd;
    }

    _setBlendMode (mode) {"""),
            ('DIMOD_SHADER_BLENDS =', "class RenderWebGL extends EventEmitter {", "const DIMOD_SHADER_BLENDS = ['darken', 'difference', 'overlay', 'hardlight', 'softlight', 'dodge', 'burn']; // dimod-backdrop\n\nclass RenderWebGL extends EventEmitter {")])
        patch(nm + '/scratch-render/src/shaders/sprite.frag.glsl', [
            ('dimod-backdrop', "uniform sampler2D u_skin;\n", """uniform sampler2D u_skin;
#ifdef DRAW_MODE_default
uniform float u_dimodBlend; // dimod-backdrop
uniform sampler2D u_dimodBackdrop;
uniform vec4 u_dimodVp;
vec3 dimodBlend(float m, vec3 s, vec3 b) {
	if (m < 1.5) return min(s, b);
	if (m < 2.5) return abs(b - s);
	if (m < 3.5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
	if (m < 4.5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
	if (m < 5.5) {
		vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
		return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
	}
	if (m < 6.5) return min(b / max(1.0 - s, 0.001), 1.0);
	return 1.0 - min((1.0 - b) / max(s, 0.001), 1.0);
}
#endif
"""),
            ('dimod-backdrop-apply', "\t#ifdef DRAW_MODE_straightAlpha\n", """	#ifdef DRAW_MODE_default
	if (u_dimodBlend > 0.5) { // dimod-backdrop-apply
		#ifdef GL_FRAGMENT_PRECISION_HIGH
		highp vec2 bduv = (gl_FragCoord.xy - u_dimodVp.xy) / u_dimodVp.zw;
		#else
		vec2 bduv = (gl_FragCoord.xy - u_dimodVp.xy) / u_dimodVp.zw;
		#endif
		vec3 cb = texture2D(u_dimodBackdrop, bduv).rgb;
		float sa = gl_FragColor.a;
		vec3 cs = clamp(gl_FragColor.rgb / (sa + epsilon), 0.0, 1.0);
		gl_FragColor.rgb = sa * dimodBlend(u_dimodBlend, cs, cb);
	}
	#endif

	#ifdef DRAW_MODE_straightAlpha
""")])
