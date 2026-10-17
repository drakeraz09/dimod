import {PoseSet, bindingsFor, makeAnimId, uniqueName} from '../lib/dimod-animation/core.js';
import {animationsOf, poseBounds} from '../lib/dimod-animation/runtime.js';
import {OffscreenView, animFileObject, animFromFileObject, getEditorVM, setEditorVM} from '../lib/dimod-animation/editor.js';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {inlineSvgFonts} from 'scratch-svg-renderer';
import * as twPaint from '../lib/tw-scratch-paint.js';
import SoundEditor from './sound-editor.jsx';
import {loadMonaco, monacoThemeName, askConfirm, askPrompt} from '../lib/dimod-ui.js';
import {openFontsModal} from '../reducers/modals.js';
import {DimodFullscreenButton} from '../components/dimod-fullscreen/dimod-fullscreen.jsx';
import styles from '../components/asset-panel/dimod-assets-tab.css';
import DragConstants from '../lib/drag-constants.js';
import log from '../lib/log.js';
import VM from 'scratch-vm';
import classNames from 'classnames';
import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import paintIcon from '../components/action-menu/icon--paint.svg';
import textIcon from '../components/asset-panel/icon--new-text.svg';
import downloadBlob from '../lib/download-blob.js';
import errorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {kindOfExt, mimeOfExt, spriteListKey} from '../lib/dimod-scenes.js';
const ANIM_EXT = 'ks5anim';
const PREVIEW_FPS = 12;
const PREVIEW_SIZE = 96;
const animHost = vm => {
    if (!getEditorVM()) setEditorVM(vm);
    return vm.dimodAnimations;
};
const bytesOf = data => (data instanceof Uint8Array ? data : new Uint8Array(data));
const renderFrames = (host, sprite, doc, target) => {
    const renderer = host.runtime.renderer;
    if (!renderer) return [];
    const view = new OffscreenView(renderer);
    if (!view.ok) return [];
    try {
        const record = host.recordOf(sprite, doc);
        const compiled = record.compiled;
        const bindings = bindingsFor(host.runtime, compiled, target, sprite);
        const duration = Math.max(0, Number(doc.duration) || 0);
        const count = Math.max(1, Math.min(36, Math.ceil(duration * PREVIEW_FPS)));
        const now = Date.now() / 1000;
        const poses = [];
        let box = null;
        for (let i = 0; i < count; i++) {
            const pose = compiled.evaluate(count === 1 ? 0 : (i / count) * duration, new PoseSet(0), record.state.data, now,
                bindings, null);
            const b = poseBounds(renderer, compiled, pose, bindings);
            poses.push(pose);
            if (b) {
                box = box ? {minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY),
                    maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY)} : b;
            }
        }
        if (!box) return [];
        const W = box.maxX - box.minX + 4;
        const H = box.maxY - box.minY + 4;
        const scale = PREVIEW_SIZE / Math.max(W, H);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(W * scale));
        out.height = Math.max(1, Math.round(H * scale));
        const ctx = out.getContext('2d');
        return poses.map(pose => {
            view.render(W, H, scale, [{compiled, pose, bindings}], {cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2});
            const src = view.toCanvas();
            ctx.clearRect(0, 0, out.width, out.height);
            ctx.drawImage(src, 0, 0, out.width, out.height);
            return out.toDataURL('image/png');
        });
    } catch (e) { return []; } finally {
        if (view.dispose) view.dispose();
    }
};
const animationToAsset = (vm, assets, animId, sprite = vm.editingTarget && vm.editingTarget.sprite) => {
    const host = animHost(vm);
    const target = sprite && sprite.clones[0];
    const doc = host && sprite && animationsOf(sprite).find(d => d.id === animId);
    if (!doc) return null;
    const file = animFileObject(doc, target);
    file.dimodPreview = {fps: PREVIEW_FPS, frames: renderFrames(host, sprite, doc, target)};
    return assets.add(doc.name, new TextEncoder().encode(JSON.stringify(file)), ANIM_EXT);
};
const animCache = new WeakMap();
const animInfo = (assets, asset) => {
    const bytes = assets.bytes(asset);
    if (animCache.has(bytes)) return animCache.get(bytes);
    let info = null;
    try {
        const obj = JSON.parse(new TextDecoder().decode(bytes));
        const anim = obj.anim || {};
        info = {
            obj,
            duration: Number(anim.duration) || 0,
            parts: Array.isArray(anim.groups) ? anim.groups.map(g => g.name) : [],
            frames: (obj.dimodPreview && obj.dimodPreview.frames) || [],
            fps: (obj.dimodPreview && obj.dimodPreview.fps) || PREVIEW_FPS,
            images: (obj.assets || []).map(a => `data:${a.dataFormat === 'svg' ? 'image/svg+xml' : `image/${a.dataFormat}`};base64,${a.data}`)
        };
    } catch (e) { info = null; }
    animCache.set(bytes, info);
    return info;
};
const addAnimationAsset = async (vm, assets, asset, targetId) => {
    const host = animHost(vm);
    const target = vm.runtime.getTargetById(targetId);
    const info = animInfo(assets, asset);
    if (!host || !info || !target || target.isStage || !target.sprite) return null;
    const doc = await animFromFileObject(info.obj, target);
    const list = animationsOf(target.sprite).slice();
    doc.id = makeAnimId();
    doc.name = uniqueName(asset.name, new Set(list.map(d => d.name)));
    host.setAnimations(target.sprite, list.concat(doc));
    vm.runtime.emitProjectChanged();
    return doc;
};
const mediaToAsset = (assets, item) => {
    const asset = item && item.asset;
    if (!asset || !asset.data) return null;
    return assets.add(item.name, bytesOf(asset.data).slice(), asset.dataFormat || 'png');
};
const backpackToAsset = async (assets, item) => {
    const data = item.bodyData || await (await fetch(item.bodyUrl)).arrayBuffer();
    const ext = String(item.body || '').split('.').pop() || (item.mime === 'image/svg+xml' ? 'svg' : 'png');
    return assets.add(item.name, new Uint8Array(data).slice(), ext);
};
const isAnimationAsset = asset => asset.kind === 'animation' || asset.ext.toLowerCase() === ANIM_EXT;
const assetToTarget = (vm, assets, asset, targetId) => {
    const target = vm.runtime.getTargetById(targetId);
    if (!asset || !target || !assets.list.includes(asset)) return Promise.resolve(null);
    if (isAnimationAsset(asset)) return addAnimationAsset(vm, assets, asset, targetId);
    if (asset.kind === 'image') return assets.toCostume(asset, asset.name).then(c => vm.addCostume(c.md5, c, targetId));
    if (asset.kind === 'sound') return assets.toSound(asset, asset.name).then(s => vm.addSound(s, targetId));
    return Promise.resolve(null);
};
export {ANIM_EXT, addAnimationAsset, animInfo, animationToAsset, assetToTarget, backpackToAsset, isAnimationAsset, mediaToAsset};
const FULLSCREEN_BUTTON = <DimodFullscreenButton />;
const PaintEditor = twPaint.default;
const EXT_LANG = {
    json: 'json', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript',
    tsx: 'typescript', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    md: 'markdown', markdown: 'markdown', yaml: 'yaml', yml: 'yaml', ini: 'ini', cfg: 'ini', toml: 'ini',
    lua: 'lua', py: 'python', glsl: 'cpp', frag: 'cpp', vert: 'cpp', hlsl: 'cpp', c: 'cpp', h: 'cpp', cpp: 'cpp',
    sh: 'shell', bash: 'shell', bat: 'bat', ps1: 'powershell', sql: 'sql', rb: 'ruby', rs: 'rust', go: 'go',
    java: 'java', cs: 'csharp', kt: 'kotlin', swift: 'swift', dart: 'dart', php: 'php', r: 'r', pl: 'perl',
    graphql: 'graphql', gql: 'graphql', txt: 'plaintext', csv: 'plaintext', tsv: 'plaintext', log: 'plaintext'
};
const MEDIA_MIME = {
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
    mkv: 'video/x-matroska', pdf: 'application/pdf', opus: 'audio/ogg', weba: 'audio/webm', avif: 'image/avif',
    ico: 'image/x-icon', apng: 'image/apng', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml'
};
const VIDEO = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'];
const PAINTABLE = ['png', 'svg'];
const BLANK_SVG = '<svg version="1.1" width="2" height="2" viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"></svg>';
const looksTextual = bytes => {
    const n = Math.min(bytes.length, 4096);
    for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
    try { new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, n)); return true; } catch (e) { return n === 4096; }
};
const sniffLanguage = text => {
    const t = text.trimStart();
    if (/^[[{]/.test(t)) {
        try { JSON.parse(t); return 'json'; } catch (e) {
        }
    }
    if (/^<!doctype html|^<html/i.test(t)) return 'html';
    if (/^<\?xml|^<svg/i.test(t)) return 'xml';
    if (/^---\r?\n/.test(t) || /^(?:[\w-]+:\s.*\r?\n){2,}/.test(t)) return 'yaml';
    if (/^#{1,6} |\n#{1,6} |\n\s*[-*] \S|\[[^\]]+\]\([^)]+\)/.test(t)) return 'markdown';
    if (/^\s*(def|class) \w.*:\s*$/m.test(t) || /^\s*(from \w+ )?import \w+\s*$/m.test(t)) return 'python';
    if (/\blocal \w/.test(t) && /\bend\b/.test(t)) return 'lua';
    if (/\b(const|let|function|=>|import|export|world\.|me\.)\b/.test(t)) return 'javascript';
    if (/^[\w.#:\-\s,>*[\]="]+\{[^}]*:[^}]*\}/m.test(t)) return 'css';
    return 'plaintext';
};
const languageOf = (asset, text) => {
    const byExt = EXT_LANG[asset.ext.toLowerCase()];
    return byExt && byExt !== 'plaintext' ? byExt : (asset.ext === 'csv' || asset.ext === 'tsv' ? 'plaintext' : sniffLanguage(text));
};
const isTextAsset = (asset, host) => asset.kind === 'text' || Boolean(EXT_LANG[asset.ext.toLowerCase()]) ||
    (asset.kind === 'data' && !VIDEO.includes(asset.ext) && asset.ext !== 'pdf' && looksTextual(host.bytes(asset)));
const editMode = (asset, host) => {
    const ext = asset.ext.toLowerCase();
    if (asset.kind === 'image' && PAINTABLE.includes(ext)) return 'paint';
    if (asset.kind === 'image') return 'image';
    if (asset.kind === 'sound') return 'sound';
    if (asset.kind === 'font') return 'font';
    if (isAnimationAsset(asset)) return 'animation';
    if (VIDEO.includes(ext)) return 'video';
    if (ext === 'pdf') return 'pdf';
    if (isTextAsset(asset, host)) return 'text';
    return 'binary';
};
const useMediaUrl = (asset, host) => {
    const bytes = host.bytes(asset);
    const url = React.useMemo(() => URL.createObjectURL(new Blob([bytes],
        {type: MEDIA_MIME[asset.ext.toLowerCase()] || 'application/octet-stream'})), [bytes, asset.ext]);
    React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
    return url;
};
const useExternalVersion = (asset, host, ownBytes) => {
    const [version, setVersion] = React.useState(0);
    const seen = React.useRef(host.bytes(asset));
    const bytes = host.bytes(asset);
    React.useEffect(() => {
        if (bytes === seen.current) return;
        seen.current = bytes;
        if (bytes !== ownBytes.current) setVersion(v => v + 1);
    }, [bytes]);
    return version;
};
const setFormat = (asset, ext, kind) => {
    asset.ext = ext;
    if (kind) asset.kind = kind;
};
const CodeEditor = ({asset, host, language, onLanguage}) => {
    const box = React.useRef(null);
    const editor = React.useRef(null);
    const own = React.useRef(null);
    const timer = React.useRef(null);
    const version = useExternalVersion(asset, host, own);
    const save = React.useCallback(() => {
        clearTimeout(timer.current);
        timer.current = null;
        const ed = editor.current;
        if (!ed || ed.getValue() === host.text(asset)) return;
        own.current = new TextEncoder().encode(ed.getValue());
        host.replace(asset, own.current);
    }, [asset, host]);
    React.useEffect(() => {
        let gone = false;
        let subs = [];
        loadMonaco().then(m => {
            if (gone || !box.current) return;
            const text = host.text(asset);
            const auto = languageOf(asset, text);
            const known = m.languages.getLanguages().map(l => l.id);
            const lang = language && known.includes(language) ? language : (known.includes(auto) ? auto : 'plaintext');
            onLanguage(lang, known);
            const ed = m.editor.create(box.current, {
                value: text,
                language: lang,
                theme: monacoThemeName(),
                automaticLayout: true,
                minimap: {enabled: text.length > 4000},
                fontSize: 13,
                scrollBeyondLastLine: false,
                wordWrap: ['markdown', 'plaintext'].includes(lang) ? 'on' : 'off',
                tabSize: 2
            });
            editor.current = ed;
            subs = [
                ed.onDidChangeModelContent(() => { clearTimeout(timer.current); timer.current = setTimeout(save, 600); }),
                ed.onDidBlurEditorText(save)
            ];
        });
        return () => {
            gone = true;
            if (editor.current) {
                save();
                subs.forEach(s => s.dispose());
                editor.current.dispose();
                editor.current = null;
            }
        };
    }, [asset.id, version, language]);
    return (
        <div className={styles.codeBox} ref={box} />
    );
};
CodeEditor.propTypes = {asset: PropTypes.object, host: PropTypes.object, language: PropTypes.string, onLanguage: PropTypes.func};
const loadImageInfo = url => new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({width: img.naturalWidth || 2, height: img.naturalHeight || 2});
    img.onerror = () => resolve({width: 2, height: 2});
    img.src = url;
});
const toDataUrl = (bytes, mime) => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(new Blob([bytes], {type: mime}));
});
const imageDataToPng = image => new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = image.sourceWidth === 0 ? 0 : image.width;
    canvas.height = image.sourceHeight === 0 ? 0 : image.height;
    if (canvas.width && canvas.height) canvas.getContext('2d').putImageData(image, 0, 0);
    canvas.toBlob(blob => blob.arrayBuffer().then(b => resolve(new Uint8Array(b))), 'image/png');
});
const otherPaintOpen = () => document.querySelectorAll('canvas[class*="paper-canvas_paper-canvas"]').length > 0;
class PaintAssetEditorRaw extends React.Component {
    constructor (props) {
        super(props);
        this.state = {status: 'loading', image: null, format: null, center: [0, 0], version: 0};
        this.own = null;
        this.pending = null;
        this.handleUpdateImage = this.handleUpdateImage.bind(this);
        this.handleUpdateName = this.handleUpdateName.bind(this);
        this.flush = this.flush.bind(this);
    }
    componentDidMount () {
        this.seen = this.props.host.bytes(this.props.asset);
        if (twPaint.ensurePaintReducer) twPaint.ensurePaintReducer();
        this.props.onPaintInit();
        window.dispatchEvent(new Event('dimod:paint-evict'));
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (this.gone) return;
            if (!this.props.paintReady || otherPaintOpen()) {
                this.setState({status: this.props.paintReady ? 'blocked' : 'cold'});
                return;
            }
            twPaint.setPaintSuspended(false);
            this.load();
        }));
    }
    componentDidUpdate (prevProps) {
        const bytes = this.props.host.bytes(this.props.asset);
        if (prevProps.asset.id !== this.props.asset.id) {
            this.flush();
            this.seen = bytes;
            this.load();
        } else if (bytes !== this.seen) {
            this.seen = bytes;
            if (bytes !== this.own) this.load();
        }
    }
    componentWillUnmount () {
        this.gone = true;
        twPaint.flushPaint();
        this.flush();
        twPaint.setPaintSuspended(true);
    }
    async load () {
        const {asset, host} = this.props;
        const vector = asset.ext.toLowerCase() === 'svg';
        const bytes = host.bytes(asset);
        const url = URL.createObjectURL(new Blob([bytes], {type: MEDIA_MIME[asset.ext.toLowerCase()] || 'image/png'}));
        const {width, height} = await loadImageInfo(url);
        URL.revokeObjectURL(url);
        const image = vector ? host.text(asset) : await toDataUrl(bytes, MEDIA_MIME[asset.ext.toLowerCase()] || 'image/png');
        if (this.gone || this.props.asset !== asset) return;
        this.setState(s => ({status: 'ready', image, format: vector ? 'svg' : 'png', center: [width / 2, height / 2],
            version: s.version + 1}));
    }
    handleUpdateImage (isVector, image) {
        this.pending = {isVector, image, asset: this.props.asset};
        clearTimeout(this.timer);
        this.timer = setTimeout(this.flush, 300);
    }
    async flush () {
        clearTimeout(this.timer);
        const pending = this.pending;
        this.pending = null;
        if (!pending) return;
        const {host} = this.props;
        const bytes = pending.isVector ? new TextEncoder().encode(pending.image) : await imageDataToPng(pending.image);
        if (!host.list.includes(pending.asset)) return;
        setFormat(pending.asset, pending.isVector ? 'svg' : 'png', 'image');
        this.own = bytes;
        host.replace(pending.asset, bytes);
    }
    handleUpdateName (name) { this.props.host.rename(this.props.asset, name); }
    render () {
        const {asset, isDark, rtl, stageSize, vm, onManageFonts} = this.props;
        if (this.state.status === 'blocked' || this.state.status === 'cold') {
            return (
                <div className={styles.blocked}>
                    <p>{this.state.status === 'cold' ? 'Open the Costumes tab once, then come back to paint this image.' :
                        'The costume editor is still open in the Costumes tab. Reopen the Assets tab to paint this image here.'}</p>
                </div>
            );
        }
        if (this.state.status !== 'ready') return <div className={styles.loading} />;
        return (
            <div className={styles.paintBox}>
                <PaintEditor
                    customFonts={vm.runtime.fontManager.getFonts()}
                    extraViewControls={FULLSCREEN_BUTTON}
                    fontInlineFn={inlineSvgFonts}
                    height={stageSize.height}
                    image={this.state.image}
                    imageFormat={this.state.format}
                    imageId={`dimod-asset-${asset.id}-${this.state.version}`}
                    name={asset.name}
                    rotationCenterX={this.state.center[0]}
                    rotationCenterY={this.state.center[1]}
                    rtl={rtl}
                    spriteId={null}
                    theme={isDark ? 'dark' : 'light'}
                    width={stageSize.width}
                    zoomLevelId={`dimod-asset-${asset.id}`}
                    onManageFonts={onManageFonts}
                    onUpdateImage={this.handleUpdateImage}
                    onUpdateName={this.handleUpdateName}
                />
            </div>
        );
    }
}
PaintAssetEditorRaw.propTypes = {
    asset: PropTypes.object, host: PropTypes.object, isDark: PropTypes.bool, onManageFonts: PropTypes.func,
    onPaintInit: PropTypes.func, paintReady: PropTypes.bool, rtl: PropTypes.bool, stageSize: PropTypes.object,
    vm: PropTypes.object
};
const PaintAssetEditor = connect(state => ({
    paintReady: Boolean(state.scratchPaint && state.scratchPaint.mode),
    rtl: state.locales.isRtl,
    stageSize: state.scratchGui.customStageSize
}), dispatch => ({
    onManageFonts: () => dispatch(openFontsModal()),
    onPaintInit: () => dispatch({type: 'dimod/paint-init'})
}))(PaintAssetEditorRaw);
const SoundEditorInner = SoundEditor.WrappedComponent;
const audioContextOf = vm => (vm.runtime.audioEngine && vm.runtime.audioEngine.audioContext) ||
    (audioContextOf.own || (audioContextOf.own = new (window.AudioContext || window.webkitAudioContext)()));
const SoundAssetEditorRaw = ({asset, host, vm, chunkSize}) => {
    const own = React.useRef(null);
    const version = useExternalVersion(asset, host, own);
    const [buffer, setBuffer] = React.useState(null);
    const [failed, setFailed] = React.useState(false);
    const url = useMediaUrl(asset, host);
    React.useEffect(() => {
        let gone = false;
        setBuffer(null);
        setFailed(false);
        audioContextOf(vm).decodeAudioData(host.bytes(asset).slice().buffer)
            .then(b => !gone && setBuffer(b), () => !gone && setFailed(true));
        return () => { gone = true; };
    }, [asset.id, version]);
    const adapter = React.useMemo(() => {
        const a = Object.create(vm);
        Object.defineProperty(a, 'editingTarget', {value: null});
        a.updateSoundBuffer = (index, audioBuffer, wavBytes) => {
            if (!host.list.includes(asset)) return;
            setFormat(asset, 'wav', 'sound');
            own.current = wavBytes;
            host.replace(asset, wavBytes);
        };
        a.renameSound = (index, name) => host.rename(asset, name);
        a.addSound = sound => {
            host.add(sound.name || asset.name, new Uint8Array(sound.asset.data), 'wav');
            return Promise.resolve();
        };
        return a;
    }, [vm, host, asset]);
    if (failed) {
        return (
            <div className={styles.mediaBox}>
                <audio controls src={url} />
                <p className={styles.note}>{'This sound can\'t be decoded for editing, but it still plays.'}</p>
            </div>
        );
    }
    if (!buffer) return <div className={styles.loading} />;
    return (
        <div className={styles.soundBox}>
            <SoundEditorInner
                audioBuffer={buffer}
                dataFormat={asset.ext}
                duration={buffer.duration}
                isFullScreen={false}
                isStereo={buffer.numberOfChannels !== 1}
                name={asset.name}
                sampleRate={buffer.sampleRate}
                size={asset.size}
                soundId={`${asset.id}:${version}`}
                soundIndex={0}
                vm={adapter}
                waveformChunkSize={chunkSize}
            />
        </div>
    );
};
SoundAssetEditorRaw.propTypes = {asset: PropTypes.object, chunkSize: PropTypes.number, host: PropTypes.object, vm: PropTypes.object};
const SoundAssetEditor = connect(state => ({
    chunkSize: state.scratchGui.addonUtil.soundEditorWaveformChunkSize
}))(SoundAssetEditorRaw);
const FontSample = ({asset, host}) => {
    const [text, setText] = React.useState('The quick brown fox jumps over the lazy dog');
    const url = useMediaUrl(asset, host);
    const family = `dimod-asset-${asset.id}`;
    return (
        <div className={styles.fontBox}>
            <style>{`@font-face { font-family: "${family}"; src: url("${url}"); }`}</style>
            <input className={styles.fontInput} spellCheck={false} value={text} onChange={e => setText(e.target.value)} />
            {[48, 32, 20, 14].map(size => (
                <div
                    key={size}
                    style={{fontFamily: `"${family}"`, fontSize: size, lineHeight: 1.25, wordBreak: 'break-word'}}
                >{text || ' '}</div>
            ))}
            <div style={{fontFamily: `"${family}"`, fontSize: 16, opacity: 0.75}}>
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?&@#'}
            </div>
        </div>
    );
};
FontSample.propTypes = {asset: PropTypes.object, host: PropTypes.object};
const ImagePreview = ({asset, host, onEdit}) => {
    const url = useMediaUrl(asset, host);
    return (
        <div className={styles.mediaBox}>
            <div className={styles.imageBox}>
                <img alt={asset.name} src={url} />
            </div>
            {onEdit ? (
                <p className={styles.note}>
                    {`.${asset.ext} files can't be painted on directly. `}
                    <button className={styles.linkButton} onClick={onEdit}>{'Edit as PNG'}</button>
                    {asset.ext === 'gif' ? ' (only the first frame is kept)' : null}
                </p>
            ) : null}
        </div>
    );
};
ImagePreview.propTypes = {asset: PropTypes.object, host: PropTypes.object, onEdit: PropTypes.func};
const MediaPreview = ({asset, host, mode}) => {
    const url = useMediaUrl(asset, host);
    if (mode === 'video') {
        return (
            <div className={styles.mediaBox}>
                <video controls className={styles.video} key={url} src={url} />
            </div>
        );
    }
    if (mode === 'pdf') {
        return (
            <iframe className={styles.pdf} src={url} title={asset.name} />
        );
    }
    const bytes = host.bytes(asset).subarray(0, 256);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');
    return (
        <div className={styles.mediaBox}>
            <p className={styles.note}>{'No preview for this kind of file.'}</p>
            <pre className={styles.hex}>{hex}{host.bytes(asset).length > 256 ? ' ...' : ''}</pre>
        </div>
    );
};
MediaPreview.propTypes = {asset: PropTypes.object, host: PropTypes.object, mode: PropTypes.string};
const AnimationPreview = ({asset, host}) => {
    const info = animInfo(host, asset);
    const [frame, setFrame] = React.useState(0);
    const [playing, setPlaying] = React.useState(true);
    const frames = info ? info.frames : [];
    React.useEffect(() => setFrame(0), [asset.id]);
    React.useEffect(() => {
        if (!playing || frames.length < 2) return undefined;
        const timer = setInterval(() => setFrame(f => (f + 1) % frames.length), 1000 / info.fps);
        return () => clearInterval(timer);
    }, [playing, frames, info && info.fps]);
    if (!info) return <div className={styles.mediaBox}><p className={styles.note}>{'This animation file can\'t be read.'}</p></div>;
    return (
        <div className={styles.animBox}>
            <div className={styles.animStage}>
                {frames.length ? (
                    <img alt={asset.name} draggable={false} src={frames[Math.min(frame, frames.length - 1)]} />
                ) : info.images[0] ? (
                    <img alt={asset.name} draggable={false} src={info.images[0]} />
                ) : null}
            </div>
            <div className={styles.animControls}>
                {frames.length > 1 ? (
                    <button
                        className={styles.headButton}
                        onClick={() => setPlaying(!playing)}
                    >{playing ? 'Pause' : 'Play'}</button>
                ) : null}
                <span className={styles.meta}>
                    {`${info.duration.toFixed(2)}s - ${info.parts.length} part${info.parts.length === 1 ? '' : 's'}`}
                </span>
            </div>
            {info.parts.length ? <div className={styles.animParts}>{info.parts.join(', ')}</div> : null}
        </div>
    );
};
AnimationPreview.propTypes = {asset: PropTypes.object, host: PropTypes.object};
const convertToPng = async (asset, host) => {
    const url = URL.createObjectURL(new Blob([host.bytes(asset)], {type: MEDIA_MIME[asset.ext.toLowerCase()]}));
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
    }).finally(() => URL.revokeObjectURL(url));
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    setFormat(asset, 'png', 'image');
    host.replace(asset, new Uint8Array(await blob.arrayBuffer()));
};
export {AnimationPreview, BLANK_SVG, CodeEditor, FontSample, ImagePreview, MediaPreview, PaintAssetEditor, SoundAssetEditor, convertToPng,
    editMode};
const OVER = 'data-dimod-drop-over';
const zoneAt = point => {
    const el = point && document.elementFromPoint(point.x, point.y);
    if (!el || !el.closest) return null;
    const tab = el.closest('[data-dimod-tab]');
    if (tab) return {name: tab.getAttribute('data-dimod-tab'), el: tab};
    const root = el.closest('[data-dimod-assets-root]');
    return root ? {name: 'assets', el: root} : null;
};
const accepts = (zone, drag) => {
    const type = drag.dragType;
    const asset = drag.payload;
    if (zone === 'assets') {
        return [DragConstants.COSTUME, DragConstants.SOUND, DragConstants.ANIMATION, DragConstants.BACKPACK_COSTUME,
            DragConstants.BACKPACK_SOUND].includes(type);
    }
    if (type !== DragConstants.ASSET || !asset) return false;
    if (zone === 'costume') return asset.kind === 'image';
    if (zone === 'sound') return asset.kind === 'sound';
    if (zone === 'animation') return isAnimationAsset(asset);
    return false;
};
const AssetDragBridge = ({drag, vm}) => {
    const last = React.useRef(null);
    const lit = React.useRef(null);
    const light = el => {
        if (lit.current === el) return;
        if (lit.current) lit.current.removeAttribute(OVER);
        lit.current = el;
        if (el) el.setAttribute(OVER, 'true');
    };
    React.useEffect(() => {
        if (drag.dragging) {
            last.current = {drag, point: drag.currentOffset};
            const zone = zoneAt(drag.currentOffset);
            light(zone && accepts(zone.name, drag) ? zone.el : null);
            return;
        }
        light(null);
        const ended = last.current;
        last.current = null;
        const assets = vm && vm.dimodAssets;
        const zone = ended && assets && zoneAt(ended.point);
        if (!zone || !accepts(zone.name, ended.drag)) return;
        const {dragType, index, payload} = ended.drag;
        const target = vm.editingTarget;
        let added = null;
        if (zone.name !== 'assets') {
            if (target) assetToTarget(vm, assets, payload, target.id).catch(e => log.warn(e));
            return;
        }
        if (dragType === DragConstants.COSTUME && target) added = mediaToAsset(assets, target.getCostumes()[index]);
        else if (dragType === DragConstants.SOUND && target) added = mediaToAsset(assets, target.sprite.sounds[index]);
        else if (dragType === DragConstants.ANIMATION && payload) added = animationToAsset(vm, assets, payload.dimodAnimId);
        else if (dragType === DragConstants.BACKPACK_COSTUME || dragType === DragConstants.BACKPACK_SOUND) {
            backpackToAsset(assets, payload).then(a => window.dispatchEvent(new CustomEvent('dimod:select-asset', {detail: a.id})))
                .catch(e => log.warn(e));
        }
        if (added) {
            window.dimodAssetPick = added.id;
            window.dispatchEvent(new CustomEvent('dimod:select-asset', {detail: added.id}));
        }
    }, [drag.dragging, drag.currentOffset]);
    return null;
};
AssetDragBridge.propTypes = {drag: PropTypes.object, vm: PropTypes.object};
const DimodAssetDrag = connect(state => ({drag: state.scratchGui.assetDrag, vm: state.scratchGui.vm}))(AssetDragBridge);
export {DimodAssetDrag};
const GLYPHS = {
    sound: 'M10 20v8h6l8 6V14l-8 6zM30 17c2 2 2 8 0 10M34 13c4 4 4 14 0 18',
    font: 'M12 34L22 12l10 22M15 28h14',
    text: 'M12 14h24M12 22h24M12 30h16',
    video: 'M10 14h20v20H10zM30 21l8-5v16l-8-5',
    animation: 'M12 12h24v24H12zM12 18h24M12 30h24M18 12v6M24 12v6M30 12v6M18 30v6M24 30v6M30 30v6',
    pdf: 'M14 10h14l6 6v22H14zM28 10v6h6',
    data: 'M14 14h20v20H14zM14 22h20M22 14v20'
};
const iconFor = (asset, mode) => {
    const glyph = GLYPHS[mode === 'video' || mode === 'pdf' || mode === 'animation' ? mode : mode === 'text' ? 'text' :
        asset.kind] || GLYPHS.data;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path d="${glyph}" ` +
        'fill="none" stroke="#8a8fa8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        `<text x="24" y="45" font-family="sans-serif" font-size="8" text-anchor="middle" fill="#8a8fa8">${asset.ext.toUpperCase()}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
const sizeText = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const MODE_LABEL = {paint: 'image', image: 'image', sound: 'sound', font: 'font', video: 'video', pdf: 'PDF', text: 'text',
    animation: 'animation', binary: 'file'};
const listImage = (asset, mode, host) => {
    if (asset.kind === 'image') return host.url(asset);
    const info = mode === 'animation' && animInfo(host, asset);
    return (info && (info.frames[0] || info.images[0])) || iconFor(asset, mode);
};
const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
});
const splitName = fileName => {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot + 1)] : [fileName, 'bin'];
};
const NameField = ({asset, host, renameSignal}) => {
    const [editing, setEditing] = React.useState(false);
    const [value, setValue] = React.useState(asset.name);
    React.useEffect(() => setEditing(false), [asset.id]);
    React.useEffect(() => {
        if (!renameSignal) return;
        setValue(asset.name);
        setEditing(true);
    }, [renameSignal]);
    if (!editing) {
        return (
            <button
                className={styles.name}
                title="Rename"
                onClick={() => { setValue(asset.name); setEditing(true); }}
            >{asset.name}</button>
        );
    }
    const commit = () => {
        setEditing(false);
        if (value.trim() && value.trim() !== asset.name) host.rename(asset, value.trim());
    };
    return (
        <input
            autoFocus
            className={styles.nameInput}
            spellCheck={false}
            value={value}
            onBlur={commit}
            onChange={e => setValue(e.target.value)}
            onFocus={e => e.target.select()}
            onKeyDown={e => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
            }}
        />
    );
};
NameField.propTypes = {asset: PropTypes.object, host: PropTypes.object, renameSignal: PropTypes.number};
const AssetsTab = ({vm}) => {
    const host = vm.dimodAssets;
    const [, bump] = React.useReducer(n => n + 1, 0);
    const [selectedId, setSelectedId] = React.useState(() => window.dimodAssetPick || null);
    const [view, setView] = React.useState(null);
    const [lang, setLang] = React.useState({id: null, auto: null, known: []});
    const [dropping, setDropping] = React.useState(false);
    const [renameSignal, setRenameSignal] = React.useState(0);
    const fileInput = React.useRef(null);
    const replaceInput = React.useRef(null);
    React.useEffect(() => {
        let key = spriteListKey(vm.runtime);
        const onTargets = () => {
            const next = spriteListKey(vm.runtime);
            if (next !== key) { key = next; bump(); }
        };
        vm.runtime.on('DIMOD_ASSETS', bump);
        vm.on('targetsUpdate', onTargets);
        const pick = e => setSelectedId(e.detail);
        window.addEventListener('dimod:select-asset', pick);
        window.addEventListener('dimod-editor-theme', bump);
        return () => {
            window.removeEventListener('dimod-editor-theme', bump);
            vm.runtime.removeListener('DIMOD_ASSETS', bump);
            vm.removeListener('targetsUpdate', onTargets);
            window.removeEventListener('dimod:select-asset', pick);
        };
    }, [vm]);
    const selected = host ? host.list.find(a => a.id === selectedId) || host.list[0] || null : null;
    React.useEffect(() => { setView(null); setLang({id: null, auto: null, known: []}); }, [selected && selected.id]);
    if (!host) return null;
    const modes = new Map(host.list.map(a => [a.id, editMode(a, host)]));
    const items = host.list.map(a => ({
        url: listImage(a, modes.get(a.id), host),
        name: a.name,
        details: `${a.ext} - ${sizeText(a.size)}`,
        dragPayload: a
    }));
    const addFiles = async files => {
        let last = null;
        for (const file of files) { const [name, ext] = splitName(file.name); last = host.add(name, await readFile(file), ext); }
        if (last) setSelectedId(last.id);
    };
    const handleUpload = e => { const files = Array.from(e.target.files || []); e.target.value = null; addFiles(files); };
    const handleReplace = async e => {
        const file = (e.target.files || [])[0];
        e.target.value = null;
        if (!file || !selected) return;
        const [, ext] = splitName(file.name);
        selected.ext = ext.toLowerCase();
        selected.kind = kindOfExt(selected.ext);
        host.replace(selected, await readFile(file));
    };
    const handleNewText = async () => {
        const name = await askPrompt('Name for the new text file. Add a file extension for neato syntax highlighting.',
            {initial: 'notes.txt'});
        if (!name || !name.trim()) return;
        const [base, ext] = name.includes('.') ? splitName(name.trim()) : [name.trim(), 'txt'];
        setSelectedId(host.addText(base, '', ext.toLowerCase()).id);
    };
    const handleNewImage = () => setSelectedId(host.add('image', new TextEncoder().encode(BLANK_SVG), 'svg').id);
    const handleDelete = async index => {
        const asset = host.list[index];
        if (asset && await askConfirm(`Delete asset "${asset.name}"? Blocks and code that use it will stop finding it.`)) {
            host.remove(asset);
        }
    };
    const handleDuplicate = index => {
        const asset = host.list[index];
        if (asset) setSelectedId(host.add(asset.name, host.bytes(asset).slice(), asset.ext).id);
    };
    const handleExport = index => {
        const asset = host.list[index];
        if (asset) downloadBlob(`${asset.name}.${asset.ext}`, new Blob([host.bytes(asset)], {type: mimeOfExt(asset.ext)}));
    };
    const handleDrop = info => {
        if (info.dragType !== 'ASSET' || typeof info.newIndex !== 'number' || info.newIndex === info.index) return;
        const asset = host.list[info.index];
        if (asset) host.move(asset, info.newIndex);
    };
    const hasFiles = e => Array.from(e.dataTransfer.types || []).includes('Files');
    const mode = selected ? modes.get(selected.id) : null;
    const editing = vm.editingTarget;
    const addable = Boolean(selected && editing) && (mode === 'paint' || mode === 'image' || mode === 'sound' ||
        (mode === 'animation' && !editing.isStage));
    const isSvg = selected && selected.ext.toLowerCase() === 'svg';
    const shown = view || mode;
    let body = null;
    if (selected) {
        if (shown === 'paint') {
            body = (
                <PaintAssetEditor asset={selected} host={host} isDark={document.body.getAttribute('theme') === 'dark'} vm={vm} />
            );
        } else if (shown === 'text') {
            body = (
                <CodeEditor
                    asset={selected}
                    host={host}
                    language={lang.id}
                    onLanguage={(auto, known) => setLang(l => ({...l, auto, known}))}
                />
            );
        } else if (shown === 'sound') {
            body = (
                <SoundAssetEditor asset={selected} host={host} vm={vm} />
            );
        } else if (shown === 'font') {
            body = (
                <FontSample asset={selected} host={host} />
            );
        } else if (shown === 'animation') {
            body = (
                <AnimationPreview asset={selected} host={host} />
            );
        } else if (shown === 'image') {
            body = (
                <ImagePreview asset={selected} host={host} onEdit={() => convertToPng(selected, host).catch(() => {})} />
            );
        } else {
            body = (
                <MediaPreview asset={selected} host={host} mode={shown} />
            );
        }
    }
    return (
        <div
            className={classNames(styles.root, {[styles.dropping]: dropping})}
            data-dimod-assets-root
            onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
            }}
            onDragOver={e => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (!dropping) setDropping(true);
            }}
            onDrop={e => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                setDropping(false);
                addFiles(Array.from(e.dataTransfer.files));
            }}
        >
            <AssetPanel
                buttons={[{
                    title: 'Upload files',
                    img: fileUploadIcon,
                    onClick: () => fileInput.current && fileInput.current.click()
                }, {title: 'New text file', img: textIcon, onClick: handleNewText}, {title: 'Paint a new image', img: paintIcon, onClick: handleNewImage}]}
                collapsible
                dimodAssetKind="asset"
                dragType="ASSET"
                items={items}
                selectedItemIndex={selected ? host.list.indexOf(selected) : 0}
                onDeleteClick={handleDelete}
                onDrop={handleDrop}
                onDuplicateClick={handleDuplicate}
                onExportClick={handleExport}
                onItemClick={index => setSelectedId(host.list[index] && host.list[index].id)}
                onRenameClick={index => {
                    if (!host.list[index]) return;
                    setSelectedId(host.list[index].id);
                    setRenameSignal(n => n + 1);
                }}
            >
                <input hidden multiple ref={fileInput} type="file" onChange={handleUpload} />
                <input hidden ref={replaceInput} type="file" onChange={handleReplace} />
                {selected ? (
                    <div className={styles.detail}>
                        <div className={styles.head}>
                            <NameField asset={selected} host={host} renameSignal={renameSignal} />
                            <span className={styles.meta}>{`${MODE_LABEL[mode]} .${selected.ext} - ${sizeText(selected.size)}`}</span>
                            <span className={styles.spacer} />
                            {isSvg ? (
                                <div className={styles.segmented}>
                                    {[['paint', 'Paint'], ['text', 'Source']].map(([id, label]) => (
                                        <button
                                            className={classNames({[styles.segmentOn]: shown === id})}
                                            key={id}
                                            onClick={() => setView(id === 'paint' ? null : id)}
                                        >{label}</button>
                                    ))}
                                </div>
                            ) : null}
                            {shown === 'text' && lang.known.length ? (
                                <select
                                    className={styles.select}
                                    title="Language"
                                    value={lang.id || ''}
                                    onChange={e => setLang({...lang, id: e.target.value || null})}
                                >
                                    <option value="">{`Auto (${lang.auto || 'plaintext'})`}</option>
                                    {lang.known.slice().sort()
                                        .map(id => <option key={id} value={id}>{id}</option>)}
                                </select>
                            ) : null}
                            {addable ? (
                                <button
                                    className={styles.headButton}
                                    title={`Add a copy to ${editing.isStage ? 'the stage' : editing.getName()}`}
                                    onClick={() => assetToTarget(vm, host, selected, editing.id).catch(() => {})}
                                >{`Add to ${editing.isStage ? 'Stage' : editing.getName()}`}</button>
                            ) : null}
                            <button
                                className={styles.headButton}
                                onClick={() => replaceInput.current && replaceInput.current.click()}
                            >{'Replace'}</button>
                            <button
                                className={styles.headButton}
                                onClick={() => handleExport(host.list.indexOf(selected))}
                            >{'Download'}</button>
                        </div>
                        <div className={styles.body}>{body}</div>
                    </div>
                ) : (
                    <div className={styles.empty}>
                        <div className={styles.emptyIcon}>
                            <img alt="" draggable={false} src={fileUploadIcon} />
                        </div>
                        <p className={styles.emptyTitle}>{'Drop files here'}</p>
                        <div className={styles.emptyButtons}>
                            <button
                                className={styles.headButton}
                                onClick={() => fileInput.current && fileInput.current.click()}
                            >{'Upload files'}</button>
                            <button className={styles.headButton} onClick={handleNewImage}>{'Paint an image'}</button>
                            <button className={styles.headButton} onClick={handleNewText}>{'New text file'}</button>
                        </div>
                    </div>
                )}
            </AssetPanel>
            {dropping ? <div className={styles.dropHint}>{'Drop to add to the project\'s assets'}</div> : null}
        </div>
    );
};
AssetsTab.propTypes = {vm: PropTypes.instanceOf(VM).isRequired};
export {kindOfExt};
export default errorBoundaryHOC('Assets Tab')(AssetsTab);
