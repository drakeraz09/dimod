import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {useEffect, useMemo, useRef, useState} from 'react';

import {getDimodToken} from '../../lib/dimod-project';
import {libraryApi as codeApi} from '../../lib/block-space/editor';
import styles from './library-upload.css';

const API_BASE = process.env.DIMOD_API_BASE;
const SITE = process.env.DIMOD_SITE_ORIGIN || '';
const MAX_FILE = 10 * 1024 * 1024;
const MAX_CODE = 200 * 1024;
const MAX_TAGS = 8;

const KIND = {
    costume: {one: 'costume', ext: ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'], accept: 'image/*,.svg', editor: true},
    backdrop: {one: 'backdrop', ext: ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'], accept: 'image/*,.svg', editor: true},
    sound: {one: 'sound', ext: ['mp3', 'wav', 'ogg'], accept: 'audio/*,.mp3,.wav,.ogg', editor: true},
    sprite: {one: 'sprite', ext: ['sprite3', 'pms', 'warps'], accept: '.sprite3,.pms,.warps', editor: false},
    code: {one: 'piece of code', ext: ['js', 'mjs', 'txt'], accept: '.js,.mjs,.txt,text/plain', editor: false}
};
const MIME = {
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg'
};

const formatBytes = n => {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
};
const extOf = name => (name.split('.').pop() || '').toLowerCase();
const splitTags = text => {
    const out = [];
    String(text || '').split(/[,\n]/)
        .forEach(raw => {
            const t = raw.toLowerCase().replace(/[^a-z0-9 '_-]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 24);
            if (t && !out.includes(t)) out.push(t);
        });
    return out;
};
const measure = url => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({width: image.naturalWidth, height: image.naturalHeight});
    image.onerror = () => resolve(null);
    image.src = url;
});

const sendForm = (fd, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/library-assets`);
    xhr.setRequestHeader('Authorization', `Bearer ${getDimodToken()}`);
    xhr.upload.addEventListener('progress', e => e.lengthComputable && onProgress(e.loaded / e.total));
    xhr.addEventListener('load', () => {
        let data = {};
        try {
            data = JSON.parse(xhr.responseText);
        } catch (e) {
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed. Check your connection')));
    xhr.send(fd);
});

const projectItems = (vm, kind) => {
    if (!vm) return [];
    const target = vm.editingTarget;
    const asFile = (asset, name, format) => () => Promise.resolve(
        new File([asset.data], `${name}.${format}`, {type: MIME[format] || 'application/octet-stream'}));
    if (kind === 'costume' || kind === 'backdrop') {
        const owner = kind === 'backdrop' ? vm.runtime.getTargetForStage() : target;
        if (!owner || (kind === 'costume' && owner.isStage)) return [];
        return owner.getCostumes().filter(c => c.asset && KIND.costume.ext.includes(c.dataFormat))
            .map((c, i) => ({
                key: `c${i}`,
                name: c.name,
                thumb: c.asset.encodeDataURI(),
                detail: c.dataFormat,
                file: asFile(c.asset, c.name, c.dataFormat),
                rcx: c.rotationCenterX,
                rcy: c.rotationCenterY,
                res: c.bitmapResolution || 1
            }));
    }
    if (kind === 'sound') {
        if (!target) return [];
        return target.sprite.sounds.filter(s => s.asset && KIND.sound.ext.includes(s.dataFormat))
            .map((s, i) => ({
                key: `s${i}`,
                name: s.name,
                thumb: null,
                detail: `${s.dataFormat}${s.sampleCount && s.rate ? ` · ${(s.sampleCount / s.rate).toFixed(1)}s` : ''}`,
                file: asFile(s.asset, s.name, s.dataFormat)
            }));
    }
    if (kind === 'sprite') {
        return vm.runtime.targets.filter(t => t.isOriginal && !t.isStage)
            .map(t => {
                const costume = t.getCostumes()[t.currentCostume];
                return {
                    key: t.id,
                    name: t.getName(),
                    thumb: costume && costume.asset ? costume.asset.encodeDataURI() : null,
                    detail: `${t.getCostumes().length} costume${t.getCostumes().length === 1 ? '' : 's'}, ` +
                        `${t.sprite.sounds.length} sound${t.sprite.sounds.length === 1 ? '' : 's'}`,
                    file: () => vm.exportSprite(t.id).then(blob => new File([blob], `${t.getName()}.sprite3`,
                        {type: 'application/x.scratch.sprite3'}))
                };
            });
    }
    return [];
};

const CentrePicker = ({src, x, y, size, onChange}) => {
    const img = useRef(null);
    const place = e => {
        const box = img.current.getBoundingClientRect();
        if (!box.width || !size) return;
        onChange(
            Math.max(0, Math.min(size.width, Math.round(((e.clientX - box.left) / box.width) * size.width))),
            Math.max(0, Math.min(size.height, Math.round(((e.clientY - box.top) / box.height) * size.height)))
        );
    };
    return (
        <div className={styles.centre}>
            <div
                className={styles.centreFrame}
                onClick={place}
            >
                <img
                    ref={img}
                    alt=""
                    draggable={false}
                    src={src}
                />
                {size ? (
                    <span
                        className={styles.centreMark}
                        style={{left: `${(x / size.width) * 100}%`, top: `${(y / size.height) * 100}%`}}
                    />
                ) : null}
            </div>
            <span className={styles.hint}>{'Click where it should turn around.'}</span>
        </div>
    );
};
CentrePicker.propTypes = {
    onChange: PropTypes.func,
    size: PropTypes.shape({width: PropTypes.number, height: PropTypes.number}),
    src: PropTypes.string,
    x: PropTypes.number,
    y: PropTypes.number
};

const LibraryUpload = ({kind, vm, suggestedTags, codeContext, initialTarget, onDone}) => {
    const k = KIND[kind];
    const isCode = kind === 'code';
    const isPicture = kind === 'costume' || kind === 'backdrop';
    const signedIn = Boolean(getDimodToken());

    const [step, setStep] = useState(0);
    const [source, setSource] = useState(isCode ? 'sprite' : 'project');
    const [picked, setPicked] = useState(null);
    const [file, setFile] = useState(null);
    const [fileErr, setFileErr] = useState('');
    const [preview, setPreview] = useState(null);
    const [pasted, setPasted] = useState('');
    const [target, setTarget] = useState(initialTarget);
    const [mine, setMine] = useState([]);
    const [form, setForm] = useState({
        name: '', description: '', tags: '', visibility: 'public', warp: false, rcx: 0, rcy: 0, res: 1, notes: ''
    });
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(null);
    const [err, setErr] = useState('');
    const [done, setDone] = useState(null);
    const [dragging, setDragging] = useState(false);
    const fileInput = useRef(null);

    const offered = useMemo(() => projectItems(vm, kind), [vm, kind, done]);
    useEffect(() => () => preview && preview.url && preview.url.startsWith('blob:') && URL.revokeObjectURL(preview.url),
        [preview]);
    useEffect(() => {
        if (isCode && signedIn) codeApi.list({mine: true}).then(data => setMine(data.items), () => setMine([]));
    }, [isCode, signedIn, done]);

    const set = (name, value) => setForm(f => ({...f, [name]: value}));
    const field = name => e => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        set(name, value);
    };
    const nameFrom = name => setForm(f => (f.name.trim() ? f : {...f, name: name.replace(/\.[^.]+$/, '').slice(0, 128)}));

    const code = !isCode ? '' : (source === 'paste' ? pasted : (source === 'selection' ?
        codeContext.selection : codeContext.whole));
    const codeBytes = isCode ? new Blob([code]).size : 0;
    const updating = isCode && Boolean(target);
    const tagList = splitTags(form.tags);

    const usePicture = async (url, rcx, rcy, res) => {
        const size = isPicture ? await measure(url) : null;
        setPreview({url, ...(size || {})});
        if (isPicture && size) {
            setForm(f => ({
                ...f,
                rcx: typeof rcx === 'number' ? rcx : Math.round(size.width / 2),
                rcy: typeof rcy === 'number' ? rcy : Math.round(size.height / 2),
                res: res || 1
            }));
        }
    };

    const pickProject = item => {
        setPicked(item);
        setFile(null);
        setFileErr('');
        nameFrom(item.name);
        if (isPicture) usePicture(item.thumb, item.rcx, item.rcy, item.res);
        else setPreview(item.thumb ? {url: item.thumb} : null);
    };

    const takeFile = async f => {
        if (!f) return;
        setFileErr('');
        setPicked(null);
        if (!k.ext.includes(extOf(f.name))) {
            setFile(null);
            return setFileErr(`That isn't a ${k.one} file. It takes ${k.ext.join(', ')}.`);
        }
        if (f.size > (isCode ? MAX_CODE : MAX_FILE)) {
            setFile(null);
            return setFileErr(`That file is ${formatBytes(f.size)}. ${formatBytes(isCode ? MAX_CODE : MAX_FILE)} is the most.`);
        }
        if (isCode) {
            setPasted(await f.text());
            setSource('paste');
            nameFrom(f.name);
            return;
        }
        if (extOf(f.name) === 'svg' && /<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(await f.text())) {
            setFile(null);
            return setFileErr('That SVG has scripts in it. Export it again as a plain SVG.');
        }
        setFile(f);
        nameFrom(f.name);
        const url = URL.createObjectURL(f);
        if (isPicture) {
            const size = await measure(url);
            if (!size) {
                setFile(null);
                return setFileErr('That image couldn\'t be read.');
            }
        }
        usePicture(url);
    };

    const steps = [];
    if (isCode) {
        steps.push({id: 'file', label: 'Code', heading: 'What to share', valid: Boolean(code.trim()) &&
            codeBytes <= MAX_CODE, blocker: codeBytes > MAX_CODE ? `Over ${formatBytes(MAX_CODE)}` : 'Add some code'});
    } else {
        steps.push({id: 'file', label: 'File', heading: `Choose the ${k.one}`,
            valid: Boolean(picked || file) && !fileErr, blocker: `Pick a ${k.one} or choose a file`});
    }
    if (updating) {
        steps.push({id: 'details', label: 'Notes', heading: 'What changed', valid: true});
    } else {
        steps.push({id: 'details', label: 'Details', heading: 'Tell people about it',
            valid: Boolean(form.name.trim()) && tagList.length <= MAX_TAGS,
            blocker: form.name.trim() ? `At most ${MAX_TAGS} tags` : 'Give it a name'});
        steps.push({id: 'share', label: 'Share', heading: 'Who gets to see it', valid: true});
    }
    steps.push({id: 'review', label: 'Review', heading: 'Look it over', valid: true});
    const current = Math.min(step, steps.length - 1);
    const active = steps[current];
    const canJump = i => i <= current || steps.slice(0, i).every(s => s.valid);
    const isLast = current === steps.length - 1;

    const submit = async () => {
        setBusy(true);
        setErr('');
        setProgress(null);
        try {
            if (isCode) {
                if (updating) {
                    await codeApi.addVersion(target, code, form.notes.trim());
                    setDone({name: (mine.find(m => m.id === target) || {}).name || 'It', id: target, version: true});
                } else {
                    const made = await codeApi.create({
                        name: form.name.trim(), description: form.description.trim(), tags: tagList,
                        visibility: form.visibility, code, notes: form.notes.trim()
                    });
                    setDone({name: made.name, id: made.id});
                }
            } else {
                const upload = picked ? await picked.file() : file;
                if (upload.size > MAX_FILE) throw new Error(`That is ${formatBytes(upload.size)}. ${formatBytes(MAX_FILE)} is the most.`);
                const fd = new FormData();
                fd.append('kind', kind);
                fd.append('name', form.name.trim());
                fd.append('description', form.description.trim());
                fd.append('tags', tagList.join(','));
                fd.append('visibility', form.visibility);
                if (isPicture) {
                    fd.append('rotation_center_x', String(form.rcx));
                    fd.append('rotation_center_y', String(form.rcy));
                    fd.append('bitmap_resolution', String(form.res));
                }
                if (form.warp && k.editor) fd.append('request_warp', '1');
                fd.append('file', upload);
                const made = await sendForm(fd, setProgress);
                setDone({name: made.name, id: made.id, warp: made.warp_status});
            }
        } catch (e) {
            setErr(e.message || 'That didn\'t work');
        }
        setBusy(false);
    };

    const again = () => {
        setDone(null);
        setStep(0);
        setPicked(null);
        setFile(null);
        setPreview(null);
        setPasted('');
        setForm(f => ({...f, name: '', description: '', tags: '', notes: '', warp: false}));
    };

    if (!signedIn) {
        return (
            <div className={styles.wizard}>
                <div className={styles.card}>
                    <div className={styles.body}>
                        <h2 className={styles.heading}>{'Log in to add to the Library'}</h2>
                        <p className={styles.hint}>{'Anything you add shows up in everyone\'s Browser tab.'}</p>
                        <a
                            className={styles.primary}
                            href={`${SITE}/login`}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            {'Log in'}
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    if (done) {
        return (
            <div className={styles.wizard}>
                <div className={styles.card}>
                    <div className={styles.body}>
                        <h2 className={styles.heading}>
                            {done.version ? `Published a new version of ${done.name}` : `${done.name} is in the Library`}
                        </h2>
                        <p className={styles.hint}>
                            {done.warp === 'pending' ? 'It\'s in the Browser tab now. Staff will look at putting it in the Library tab too.' :
                                (done.warp === 'approved' ? 'It\'s in the Library tab for everyone.' : 'It\'s in the Browser tab for everyone now.')}
                        </p>
                        <div className={styles.footRow}>
                            <button
                                className={styles.primary}
                                onClick={() => onDone(done)}
                            >
                                {isCode ? 'Back to browsing' : 'See it in the Browser'}
                            </button>
                            <button
                                className={styles.button}
                                onClick={again}
                            >
                                {'Add another'}
                            </button>
                            <a
                                className={styles.link}
                                href={`${SITE}/library/${done.id}`}
                                rel="noopener noreferrer"
                                target="_blank"
                            >
                                {'Open its page'}
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const renderFile = () => {
        if (isCode) {
            return (
                <React.Fragment>
                    <div className={styles.choices}>
                        {[
                            ['', 'A new entry', 'Starts at version 1'],
                            ...mine.map(m => [m.id, `New version of "${m.name}"`, `Now at v${m.latest_version}`])
                        ].slice(0, 6).map(([id, title, text]) => (
                            <button
                                key={id || 'new'}
                                className={classNames(styles.choice, {[styles.choiceSelected]: target === id})}
                                onClick={() => setTarget(id)}
                            >
                                <strong>{title}</strong>
                                <span>{text}</span>
                            </button>
                        ))}
                    </div>
                    <label className={styles.label}>{'The code'}</label>
                    <div className={styles.segmented}>
                        {[['sprite', 'All of this sprite\'s code'], ['selection', 'What\'s selected'], ['paste', 'Paste or choose a file']]
                            .map(([id, label]) => (
                                <button
                                    key={id}
                                    className={classNames(styles.segment, {[styles.segmentSelected]: source === id})}
                                    disabled={id === 'selection' && !codeContext.selection.trim()}
                                    onClick={() => setSource(id)}
                                >
                                    {label}
                                </button>
                            ))}
                    </div>
                    {source === 'paste' ? (
                        <React.Fragment>
                            <textarea
                                className={styles.codeBox}
                                placeholder="// a piece of a complex sprite's code"
                                rows={12}
                                spellCheck={false}
                                value={pasted}
                                onChange={e => setPasted(e.target.value)}
                            />
                            <button
                                className={styles.button}
                                onClick={() => fileInput.current.click()}
                            >
                                {'Choose a .js file'}
                            </button>
                        </React.Fragment>
                    ) : (
                        <pre className={styles.codePreview}>{code.slice(0, 3000)}{code.length > 3000 ? '\n…' : ''}</pre>
                    )}
                    <p className={styles.hint}>
                        {`${formatBytes(codeBytes)} of ${formatBytes(MAX_CODE)}. Nothing runs until someone puts it ` +
                            'in a sprite, and they see it first.'}
                    </p>
                </React.Fragment>
            );
        }
        return (
            <React.Fragment>
                <div className={styles.segmented}>
                    <button
                        className={classNames(styles.segment, {[styles.segmentSelected]: source === 'project'})}
                        onClick={() => setSource('project')}
                    >
                        {kind === 'sprite' ? 'A sprite in this project' : `From ${kind === 'backdrop' ? 'the stage' : 'this sprite'}`}
                    </button>
                    <button
                        className={classNames(styles.segment, {[styles.segmentSelected]: source === 'file'})}
                        onClick={() => setSource('file')}
                    >
                        {'A file'}
                    </button>
                </div>
                {source === 'project' ? (
                    offered.length ? (
                        <div className={styles.pickGrid}>
                            {offered.map(item => (
                                <button
                                    key={item.key}
                                    className={classNames(styles.pick, {[styles.pickSelected]: picked && picked.key === item.key})}
                                    onClick={() => pickProject(item)}
                                >
                                    {item.thumb ? (
                                        <img
                                            alt=""
                                            draggable={false}
                                            src={item.thumb}
                                        />
                                    ) : <span className={styles.pickGlyph}>{'♪'}</span>}
                                    <strong>{item.name}</strong>
                                    <span>{item.detail}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <p className={styles.hint}>
                            {kind === 'sound' ? 'This sprite has no mp3, wav or ogg sounds.' : `Nothing to share here yet.`}
                        </p>
                    )
                ) : (
                    <div
                        className={classNames(styles.drop, {[styles.dropActive]: dragging})}
                        onClick={() => fileInput.current.click()}
                        onDragLeave={() => setDragging(false)}
                        onDragOver={e => {
                            e.preventDefault();
                            setDragging(true);
                        }}
                        onDrop={e => {
                            e.preventDefault();
                            setDragging(false);
                            takeFile(e.dataTransfer.files[0]);
                        }}
                    >
                        <strong>{file ? `${file.name} (${formatBytes(file.size)})` : `Choose the ${k.one} or drop it here`}</strong>
                        <span>{`${k.ext.join(', ')}, up to ${formatBytes(MAX_FILE)}`}</span>
                    </div>
                )}
                {fileErr ? <p className={styles.error}>{fileErr}</p> : null}
                {preview && kind !== 'sprite' && (picked || file) ? (
                    <div className={styles.preview}>
                        {kind === 'sound' ? (
                            file ? <audio
                                controls
                                src={preview.url}
                            /> : null
                        ) : (
                            <img
                                alt=""
                                src={preview.url}
                            />
                        )}
                        {preview.width ? <span className={styles.hint}>{`${preview.width} by ${preview.height}`}</span> : null}
                    </div>
                ) : null}
            </React.Fragment>
        );
    };

    const renderDetails = () => {
        if (updating) {
            return (
                <label className={styles.label}>
                    <span>{'What changed '}<span className={styles.optional}>{'(optional)'}</span></span>
                    <input
                        maxLength={500}
                        placeholder="Fixed the rounding"
                        value={form.notes}
                        onChange={field('notes')}
                    />
                </label>
            );
        }
        return (
            <React.Fragment>
                <label className={styles.label}>
                    {'Name'}
                    <input
                        maxLength={isCode ? 80 : 128}
                        placeholder="What is it called?"
                        value={form.name}
                        onChange={field('name')}
                    />
                </label>
                <label className={styles.label}>
                    <span>{'Description '}<span className={styles.optional}>{'(optional)'}</span></span>
                    <textarea
                        maxLength={isCode ? 2000 : 1000}
                        placeholder="Who made it, what it's for, anything people should know"
                        rows={3}
                        value={form.description}
                        onChange={field('description')}
                    />
                </label>
                <label className={styles.label}>
                    <span>{'Tags '}<span className={styles.optional}>{'(optional, commas between)'}</span></span>
                    <input
                        placeholder="animals, cute"
                        value={form.tags}
                        onChange={field('tags')}
                    />
                </label>
                <div className={styles.chips}>
                    {suggestedTags.map(tag => {
                        const on = tagList.includes(tag);
                        return (
                            <button
                                key={tag}
                                className={classNames(styles.chip, {[styles.chipOn]: on})}
                                onClick={() => set('tags', (on ? tagList.filter(t => t !== tag) : [...tagList, tag]).join(', '))}
                            >
                                {on ? `✓ ${tag}` : `+ ${tag}`}
                            </button>
                        );
                    })}
                </div>
                {suggestedTags.length ? (
                    <p className={styles.hint}>{'The pickers filter by these, so one of them helps people find it.'}</p>
                ) : null}
                {isPicture && preview ? (
                    <div className={styles.label}>
                        {'Rotation centre'}
                        <CentrePicker
                            size={preview.width ? preview : null}
                            src={preview.url}
                            x={form.rcx}
                            y={form.rcy}
                            onChange={(x, y) => setForm(f => ({...f, rcx: x, rcy: y}))}
                        />
                    </div>
                ) : null}
                {isCode ? (
                    <label className={styles.label}>
                        <span>{'Notes for version 1 '}<span className={styles.optional}>{'(optional)'}</span></span>
                        <input
                            maxLength={500}
                            value={form.notes}
                            onChange={field('notes')}
                        />
                    </label>
                ) : null}
            </React.Fragment>
        );
    };

    const visibilities = [
        ['public', 'Public', 'Listed in the Library and everyone\'s Browser tab.'],
        ['unlisted', 'Unlisted', 'Only people you give the link to.'],
        ...(isCode ? [['private', 'Private', 'Only you.']] : [])
    ];
    const renderShare = () => (
        <React.Fragment>
            <div className={styles.choices}>
                {visibilities.map(([id, title, text]) => (
                    <button
                        key={id}
                        className={classNames(styles.choice, {[styles.choiceSelected]: form.visibility === id})}
                        onClick={() => set('visibility', id)}
                    >
                        <strong>{title}</strong>
                        <span>{text}</span>
                    </button>
                ))}
            </div>
            {k.editor ? (
                <label className={styles.check}>
                    <input
                        checked={form.warp}
                        type="checkbox"
                        onChange={field('warp')}
                    />
                    <span>
                        {'Also ask for it to be in the Library tab, for everyone'}
                        <span className={styles.hint}>
                            {' Staff look at it first. Only ask for things you made or may share.'}
                        </span>
                    </span>
                </label>
            ) : (
                <p className={styles.hint}>
                    {isCode ? 'Code is found from a complex sprite\'s Code tab, under Library.' :
                        'Sprites are code as well as art, so staff put those in the Library tab themselves.'}
                </p>
            )}
        </React.Fragment>
    );

    const renderReview = () => (
        <div className={styles.review}>
            {!isCode && preview && preview.url && kind !== 'sound' ? (
                <img
                    alt=""
                    className={styles.reviewThumb}
                    src={preview.url}
                />
            ) : null}
            <dl className={styles.reviewList}>
                <dt>{'Type'}</dt><dd>{isCode ? 'Code' : k.one}</dd>
                {updating ? (
                    <React.Fragment>
                        <dt>{'New version of'}</dt><dd>{(mine.find(m => m.id === target) || {}).name}</dd>
                    </React.Fragment>
                ) : (
                    <React.Fragment>
                        <dt>{'Name'}</dt><dd>{form.name}</dd>
                        {form.description ? <React.Fragment><dt>{'About'}</dt><dd>{form.description}</dd></React.Fragment> : null}
                        <dt>{'Tags'}</dt><dd>{tagList.length ? tagList.join(', ') : 'None'}</dd>
                        <dt>{'Visible to'}</dt>
                        <dd>{form.visibility === 'public' ? 'Everyone' : (form.visibility === 'unlisted' ? 'People with the link' : 'Only you')}</dd>
                    </React.Fragment>
                )}
                <dt>{isCode ? 'Code' : 'From'}</dt>
                <dd>{isCode ? formatBytes(codeBytes) : (picked ? `${picked.name}, in this project` : file && `${file.name} (${formatBytes(file.size)})`)}</dd>
                {k.editor ? <React.Fragment><dt>{'Library tab'}</dt><dd>{form.warp ? 'Asked for' : 'Not asked'}</dd></React.Fragment> : null}
            </dl>
        </div>
    );

    return (
        <div className={styles.wizard}>
            <ol
                className={styles.rail}
                style={{gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`}}
            >
                {steps.map((s, i) => (
                    <li
                        key={s.id}
                        className={classNames(styles.railStep, {
                            [styles.isCurrent]: i === current,
                            [styles.isDone]: i < current
                        })}
                    >
                        <button
                            className={styles.railButton}
                            disabled={!canJump(i)}
                            onClick={() => setStep(i)}
                        >
                            <span className={styles.railDot}>{i < current ? '✓' : i + 1}</span>
                            <span className={styles.railLabel}>{s.label}</span>
                        </button>
                    </li>
                ))}
            </ol>
            <div className={styles.card}>
                <div className={styles.body}>
                    <h2 className={styles.heading}>
                        <span className={styles.stepCount}>{`Step ${current + 1} of ${steps.length}`}</span>
                        {active.heading}
                    </h2>
                    {active.id === 'file' ? renderFile() : null}
                    {active.id === 'details' ? renderDetails() : null}
                    {active.id === 'share' ? renderShare() : null}
                    {active.id === 'review' ? renderReview() : null}
                </div>
                <div className={styles.foot}>
                    {err ? <p className={styles.error}>{err}</p> : null}
                    {busy && progress !== null ? (
                        <div className={styles.progress}><span style={{width: `${Math.round(progress * 100)}%`}} /></div>
                    ) : null}
                    <div className={styles.footRow}>
                        {current > 0 ? (
                            <button
                                className={styles.button}
                                disabled={busy}
                                onClick={() => setStep(current - 1)}
                            >
                                {'‹ Back'}
                            </button>
                        ) : null}
                        <span className={styles.spacer} />
                        {!active.valid && active.blocker ? <span className={styles.blocker}>{active.blocker}</span> : null}
                        {isLast ? (
                            <button
                                className={styles.primary}
                                disabled={busy || !steps.every(s => s.valid)}
                                onClick={submit}
                            >
                                {busy ? 'Sending…' : (updating ? 'Publish new version' : (isCode ? 'Publish' : 'Add to the Library'))}
                            </button>
                        ) : (
                            <button
                                className={styles.primary}
                                disabled={!active.valid}
                                onClick={() => setStep(current + 1)}
                            >
                                {'Next ›'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <input
                accept={k.accept}
                ref={fileInput}
                style={{display: 'none'}}
                type="file"
                onChange={e => {
                    takeFile(e.target.files[0]);
                    e.target.value = '';
                }}
            />
        </div>
    );
};

LibraryUpload.propTypes = {
    codeContext: PropTypes.shape({whole: PropTypes.string, selection: PropTypes.string}),
    initialTarget: PropTypes.string,
    kind: PropTypes.oneOf(Object.keys(KIND)).isRequired,
    onDone: PropTypes.func.isRequired,
    suggestedTags: PropTypes.arrayOf(PropTypes.string),
    vm: PropTypes.shape({runtime: PropTypes.object})
};
LibraryUpload.defaultProps = {
    codeContext: {whole: '', selection: ''},
    initialTarget: '',
    suggestedTags: []
};

const uploadTab = props => ({
    id: 'upload',
    label: 'Upload',
    render: ({setTab}) => (
        <LibraryUpload
            {...props}
            onDone={() => setTab('browser')}
        />
    )
});

export {uploadTab};
export default LibraryUpload;
