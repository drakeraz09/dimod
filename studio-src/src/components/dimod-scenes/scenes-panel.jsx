import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import {connect} from 'react-redux';
import {askConfirm} from '../../lib/dimod-ui';
import {spriteListKey} from '../../lib/dimod-scenes';
import styles from './scenes-panel.css';
const COLLAPSED_KEY = 'dimod:scenes-collapsed';
const OPEN_KEY = 'dimod:scenes-open';
const read = (key, fallback) => {
    try { const stored = localStorage.getItem(key); return stored === null ? fallback : JSON.parse(stored); } catch (e) { return fallback; }
};
const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
    }
};
const useHost = vm => {
    const [, bump] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
        const runtime = vm.runtime;
        let key = spriteListKey(runtime);
        const onTargets = () => {
            const next = spriteListKey(runtime);
            if (next !== key) { key = next; bump(); }
        };
        runtime.on('DIMOD_SCENES', bump);
        vm.on('targetsUpdate', onTargets);
        runtime.on('PROJECT_LOADED', bump);
        return () => {
            runtime.removeListener('DIMOD_SCENES', bump);
            vm.removeListener('targetsUpdate', onTargets);
            runtime.removeListener('PROJECT_LOADED', bump);
        };
    }, [vm]);
    return vm.dimodScenes;
};
const ChevronIcon = ({open}) => (
    <svg className={styles.chevron} height="10" viewBox="0 0 10 10" width="10">
        <path
            d={open ? 'M1 3l4 4 4-4' : 'M3 1l4 4-4 4'}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
        />
    </svg>
);
ChevronIcon.propTypes = {open: PropTypes.bool};
const StarIcon = ({on}) => (
    <svg height="12" viewBox="0 0 12 12" width="12">
        <path
            d="M6 1l1.5 3.1 3.4.5-2.5 2.4.6 3.4L6 8.8 3 10.4l.6-3.4L1.1 4.6l3.4-.5z"
            fill={on ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1"
        />
    </svg>
);
StarIcon.propTypes = {on: PropTypes.bool};
const RenameInput = ({initial, onDone}) => {
    const [value, setValue] = React.useState(initial);
    const done = save => onDone(save && value.trim() ? value.trim() : null);
    return (
        <input
            autoFocus
            className={styles.renameInput}
            value={value}
            onBlur={() => done(true)}
            onChange={e => setValue(e.target.value)}
            onClick={e => e.stopPropagation()}
            onFocus={e => e.target.select()}
            onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') done(true);
                if (e.key === 'Escape') done(false);
            }}
        />
    );
};
RenameInput.propTypes = {initial: PropTypes.string, onDone: PropTypes.func};
const BackdropSelect = ({host, scene, stage}) => (
    <select
        className={styles.backdropSelect}
        title="Backdrop shown when this scene starts"
        value={scene.backdrop}
        onChange={e => host.setBackdrop(scene.id, e.target.value)}
        onClick={e => e.stopPropagation()}
    >
        <option value="">{'Keep the current backdrop'}</option>
        {(stage ? stage.getCostumes() : []).map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
        ))}
    </select>
);
BackdropSelect.propTypes = {host: PropTypes.object, scene: PropTypes.object, stage: PropTypes.object};
const ScenesPanel = ({vm, drag}) => {
    const host = useHost(vm);
    const [collapsed, setCollapsed] = React.useState(() => read(COLLAPSED_KEY, true));
    const [open, setOpen] = React.useState(() => read(OPEN_KEY, {}));
    const [dragId, setDragId] = React.useState(null);
    const [overId, setOverId] = React.useState(null);
    const [renaming, setRenaming] = React.useState(null);
    const [menuFor, setMenuFor] = React.useState(null);
    const [spriteOver, setSpriteOver] = React.useState(null);
    const lastOver = React.useRef(null);
    const editing = vm.editingTarget;
    const spriteDrag = drag.dragging && drag.dragType === 'SPRITE';
    React.useEffect(() => {
        if (spriteDrag && drag.currentOffset) {
            const el = document.elementFromPoint(drag.currentOffset.x, drag.currentOffset.y);
            const row = el && el.closest && el.closest('[data-dimod-scene]');
            lastOver.current = row ? row.getAttribute('data-dimod-scene') : null;
            setSpriteOver(lastOver.current);
        } else if (!drag.dragging && lastOver.current) {
            const target = host && vm.runtime.getTargetById(drag.payload);
            if (target) host.addTo(target, lastOver.current);
            lastOver.current = null;
            setSpriteOver(null);
        }
    }, [drag.dragging, drag.currentOffset]);
    React.useEffect(() => {
        if (!menuFor) return undefined;
        const close = e => {
            if (!(e.target.closest && e.target.closest('[data-dimod-scene-menu]'))) setMenuFor(null);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [menuFor]);
    if (!host) return null;
    const toggleCollapsed = () => {
        setCollapsed(was => { write(COLLAPSED_KEY, !was); return !was; });
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    };
    const toggleOpen = id => setOpen(was => { const next = {...was, [id]: !was[id]}; write(OPEN_KEY, next); return next; });
    const select = scene => {
        host.goTo(scene.id, {run: false});
        if (!host.inScene(editing)) {
            const first = host.spritesIn(scene.id)[0];
            vm.setEditingTarget(first ? first.id : vm.runtime.getTargetForStage().id);
        }
    };
    const add = () => {
        let n = host.list.length + 1;
        while (host.names.includes(`Scene ${n}`)) n++;
        const scene = host.create(`Scene ${n}`);
        select(scene);
        setRenaming(scene.id);
    };
    const remove = async scene => {
        if (host.list.length < 2) return;
        const sprites = host.spritesIn(scene.id).length;
        const ok = await askConfirm(`Delete "${scene.name}"?${sprites ? ` Its ${sprites} sprite${sprites === 1 ? '' : 's'} stay in the project.` : ''}`);
        if (!ok) return;
        host.remove(scene.id);
        const now = host.scene(host.current);
        if (now) select(now);
    };
    const handleDrop = (e, toId) => {
        e.preventDefault();
        if (dragId && dragId !== toId) host.move(dragId, host.list.findIndex(s => s.id === toId));
        setDragId(null);
        setOverId(null);
    };
    const onRowKey = (e, scene) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'F2') setRenaming(scene.id);
        else if (e.key === 'Delete' || e.key === 'Backspace') remove(scene);
        else if (e.key === 'Enter') select(scene);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const sibling = e.currentTarget.closest('[data-dimod-scene]')[e.key === 'ArrowDown' ? 'nextSibling' : 'previousSibling'];
            const row = sibling && sibling.querySelector('[tabindex]');
            if (row) row.focus();
        }
    };
    if (collapsed) {
        return (
            <div className={classNames(styles.panel, styles.collapsed)}>
                <button className={styles.railButton} title="Show scenes" onClick={toggleCollapsed}>
                    <ChevronIcon open={false} />
                    <span className={styles.railLabel}>{'Scenes'}</span>
                </button>
            </div>
        );
    }
    const stage = vm.runtime.getTargetForStage();
    const others = scene => vm.runtime.targets.filter(t => t.isOriginal && !t.isStage && !host.inScene(t, scene.id));
    const everywhere = editing && !editing.isStage && host.membership(editing) === '*';
    const menuItem = (label, run, disabled) => (
        <button disabled={disabled} onClick={() => { setMenuFor(null); run(); }}>{label}</button>
    );
    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <button className={styles.headerButton} title="Hide scenes" onClick={toggleCollapsed}>
                    <ChevronIcon open />
                </button>
                <span className={styles.title}>{'Scenes'}</span>
                <button className={styles.headerButton} title="New scene" onClick={add}>{'+'}</button>
            </div>
            <div className={styles.list}>
                {host.list.map(scene => {
                    const isOpen = !!open[scene.id];
                    const sprites = host.spritesIn(scene.id);
                    const addable = isOpen ? others(scene) : [];
                    const isMain = host.main === scene.id;
                    return (
                        <div
                            className={classNames(styles.scene, {
                                [styles.sceneOver]: overId === scene.id && dragId && dragId !== scene.id,
                                [styles.spriteOver]: spriteDrag && spriteOver === scene.id
                            })}
                            data-dimod-scene={scene.id}
                            draggable={renaming !== scene.id}
                            key={scene.id}
                            onDragEnd={() => { setDragId(null); setOverId(null); }}
                            onDragOver={e => {
                                if (!dragId) return;
                                e.preventDefault();
                                setOverId(scene.id);
                            }}
                            onDragStart={e => {
                                setDragId(scene.id);
                                e.dataTransfer.effectAllowed = 'move';
                                try { e.dataTransfer.setData('text/plain', scene.id); } catch (err) {
                                }
                            }}
                            onDrop={e => handleDrop(e, scene.id)}
                        >
                            <div
                                className={classNames(styles.row, {[styles.current]: host.current === scene.id})}
                                tabIndex={0}
                                onClick={() => select(scene)}
                                onContextMenu={e => { e.preventDefault(); setMenuFor(scene.id); }}
                                onDoubleClick={() => setRenaming(scene.id)}
                                onKeyDown={e => onRowKey(e, scene)}
                            >
                                <button
                                    className={styles.iconButton}
                                    title={isOpen ? 'Hide sprites' : 'Show sprites'}
                                    onClick={e => { e.stopPropagation(); toggleOpen(scene.id); }}
                                >
                                    <ChevronIcon open={isOpen} />
                                </button>
                                {renaming === scene.id ? (
                                    <RenameInput
                                        initial={scene.name}
                                        onDone={name => {
                                            if (name) host.rename(scene.id, name);
                                            setRenaming(null);
                                        }}
                                    />
                                ) : <span className={styles.name}>{scene.name}</span>}
                                {isMain ? (
                                    <span
                                        className={classNames(styles.star, styles.starOn)}
                                        title="The project starts here"
                                    ><StarIcon on /></span>
                                ) : null}
                                <span
                                    className={styles.count}
                                    title={`${sprites.length} sprite${sprites.length === 1 ? '' : 's'}`}
                                >{sprites.length}</span>
                                <button
                                    className={classNames(styles.iconButton, styles.more)}
                                    data-dimod-scene-menu
                                    title="More"
                                    onClick={e => { e.stopPropagation(); setMenuFor(menuFor === scene.id ? null : scene.id); }}
                                    onMouseDown={e => e.stopPropagation()}
                                >{'⋯'}</button>
                                {menuFor === scene.id ? (
                                    <div
                                        className={styles.menu}
                                        data-dimod-scene-menu
                                        onClick={e => e.stopPropagation()}
                                        onMouseDown={e => e.stopPropagation()}
                                    >
                                        {menuItem('Rename', () => setRenaming(scene.id))}
                                        {menuItem('Duplicate', () => host.duplicate(scene.id))}
                                        {menuItem(isMain ? 'Already the start scene' : 'Start the project here', () => host.setMain(scene.id), isMain)}
                                        {menuItem('Delete', () => remove(scene), host.list.length < 2)}
                                    </div>
                                ) : null}
                            </div>
                            {isOpen ? (
                                <div className={styles.children}>
                                    {sprites.map(t => (
                                        <div
                                            className={classNames(styles.sprite, {[styles.spriteCurrent]: editing && editing.id === t.id})}
                                            key={t.id}
                                            onClick={() => { select(scene); vm.setEditingTarget(t.id); }}
                                        >
                                            <span className={styles.name}>{t.getName()}</span>
                                            <button
                                                className={styles.iconButton}
                                                title="Take out of this scene"
                                                onClick={e => { e.stopPropagation(); host.removeFrom(t, scene.id); }}
                                            >{'×'}</button>
                                        </div>
                                    ))}
                                    {sprites.length ? null : <div className={styles.hint}>{'Drag sprites here from the sprite list'}</div>}
                                    {addable.length ? (
                                        <select
                                            className={styles.addSprite}
                                            value=""
                                            onChange={e => {
                                                const t = vm.runtime.getTargetById(e.target.value);
                                                if (t) host.addTo(t, scene.id);
                                            }}
                                        >
                                            <option value="">{'+ Add a sprite'}</option>
                                            {addable.map(t => (
                                                <option key={t.id} value={t.id}>{t.getName()}</option>
                                            ))}
                                        </select>
                                    ) : null}
                                    <BackdropSelect host={host} scene={scene} stage={stage} />
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            {editing && !editing.isStage ? (
                <div className={styles.membership}>
                    <div className={styles.membershipTitle}>{`${editing.getName()} appears in`}</div>
                    <label className={styles.check}>
                        <input
                            checked={!!everywhere}
                            type="checkbox"
                            onChange={e => host.setMembership(editing, e.target.checked ? '*' : [host.current])}
                        />
                        {'every scene'}
                    </label>
                    {everywhere ? null : host.list.map(scene => (
                        <label className={styles.check} key={scene.id}>
                            <input
                                checked={host.inScene(editing, scene.id)}
                                type="checkbox"
                                onChange={e => (e.target.checked ?
                                    host.addTo(editing, scene.id) :
                                    host.removeFrom(editing, scene.id))}
                            />
                            {scene.name}
                        </label>
                    ))}
                </div>
            ) : null}
        </div>
    );
};
ScenesPanel.propTypes = {
    vm: PropTypes.shape({
        editingTarget: PropTypes.object,
        runtime: PropTypes.object,
        setEditingTarget: PropTypes.func
    }).isRequired,
    drag: PropTypes.object
};
export default connect(state => ({drag: state.scratchGui.assetDrag}))(ScenesPanel);
