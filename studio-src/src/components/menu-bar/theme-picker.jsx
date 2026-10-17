import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import Modal from '../../containers/modal.jsx';
import {CODE_THEMES, getMonacoPref, loadMonaco, monacoThemeName, setMonacoPref, STUDIO_COLOURS, STUDIO_STYLES} from '../../lib/dimod-ui';
import styles from './code-theme-dialog.css';
import styles$1 from './theme-picker.css';
const SAMPLE = `// This sprite is complex.
const state = me.hold({coins: 0});

world.on("flag", async () => {
    me.goTo(0, -40);
    me.visible = true;
    await me.glide(0.5, 0, 0, "easeOutQuad");
    me.say("Ready!", 1.5);
});

world.on("key", "space", async () => {
    tween(me, {y: me.y + 60}, 0.25, "easeOutQuad");
    await wait(0.25);
    tween(me, {y: 0}, 0.3, "easeInQuad");
});

me.on("touch", "Coin", () => {
    state.coins += 1;
    world.coins = state.coins;
    if (state.coins >= 10) world.scene = "Level 2";
});

world.on("scene", "Level 2", scene => {
    log("now in", scene.name, \`with \${state.coins} coins\`);
});
`;
const ENTRIES = [{id: 'auto', name: 'Match the theme'}, ...CODE_THEMES];
const CodeThemeDialog = ({onClose}) => {
    const [pref, setPref] = React.useState(getMonacoPref);
    const host = React.useRef(null);
    React.useEffect(() => {
        let editor = null;
        let gone = false;
        loadMonaco().then(m => {
            if (gone || !host.current) return;
            editor = m.editor.create(host.current, {
                value: SAMPLE,
                language: 'javascript',
                theme: monacoThemeName(),
                automaticLayout: true,
                minimap: {enabled: false},
                fontSize: 13,
                scrollBeyondLastLine: false,
                renderLineHighlight: 'all'
            });
        });
        return () => {
            gone = true;
            if (editor) editor.dispose();
        };
    }, []);
    const pick = id => { setMonacoPref(id); setPref(id); };
    return (
        <Modal className={styles.modalContent} contentLabel="Code editor colors" id="dimodCodeColors" onRequestClose={onClose}>
            <div className={styles.body}>
                <div className={styles.list}>
                    {ENTRIES.map(entry => (
                        <button
                            className={classNames(styles.row, {[styles.rowActive]: pref === entry.id})}
                            key={entry.id}
                            onClick={() => pick(entry.id)}
                        >
                            <span className={styles.name}>{entry.name}</span>
                        </button>
                    ))}
                </div>
                <div className={styles.preview} data-dimod-no-colors ref={host} />
            </div>
        </Modal>
    );
};
CodeThemeDialog.propTypes = {onClose: PropTypes.func.isRequired};
const icon = paths => (
    <svg
        className={styles$1.icon}
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
        width="22"
    >{paths}</svg>
);
const ICONS = {
    light: icon(<React.Fragment>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </React.Fragment>),
    dark: icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />),
    code: icon(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />),
    midnight: icon(<React.Fragment>
        <path d="M17 14.5A6.5 6.5 0 0 1 9.5 7a7 7 0 1 0 7.5 7.5z" />
        <path d="M18 3v3M16.5 4.5h3M20.5 9v2M19.5 10h2" />
    </React.Fragment>),
    contrast: icon(<React.Fragment>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </React.Fragment>)
};
const COLOURS = STUDIO_COLOURS;
const STYLES = STUDIO_STYLES;
const current = () => ({
    colour: document.body.getAttribute('dimod-colour') || (document.body.getAttribute('theme') === 'dark' ? 'dark' : 'light'),
    style: document.body.getAttribute('dimod-style') || 'classic'
});
const ThemePicker = () => {
    const [open, setOpen] = React.useState(false);
    const [code, setCode] = React.useState(false);
    const [theme, setTheme] = React.useState(current);
    const [tip, setTip] = React.useState(null);
    const root = React.useRef(null);
    const pill = React.useRef(null);
    React.useEffect(() => {
        const sync = () => setTheme(current());
        const openCode = () => setCode(true);
        window.addEventListener('dimod-editor-theme', sync);
        window.addEventListener('dimod:code-colors', openCode);
        sync();
        return () => {
            window.removeEventListener('dimod-editor-theme', sync);
            window.removeEventListener('dimod:code-colors', openCode);
        };
    }, []);
    React.useEffect(() => {
        if (!open) return undefined;
        const close = e => {
            if (root.current && !root.current.contains(e.target)) setOpen(false);
        };
        const key = e => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
    }, [open]);
    const pick = detail => { window.dispatchEvent(new CustomEvent('dimod-set-theme', {detail})); setOpen(false); };
    const showTip = e => {
        const r = e.currentTarget.getBoundingClientRect();
        const p = pill.current.getBoundingClientRect();
        setTip({label: e.currentTarget.getAttribute('aria-label'), top: r.top - p.top + (r.height / 2)});
    };
    const item = (option, active, detail, glyph) => (
        <button
            aria-label={option.label}
            className={classNames(styles$1.item, {[styles$1.active]: active})}
            key={option.id}
            onClick={() => pick(detail)}
            onMouseEnter={showTip}
        >{glyph || ICONS[option.id]}</button>
    );
    return (
        <div className={classNames(styles$1.picker, {[styles$1.open]: open})} data-menu-bar-item="theme" ref={root}>
            <button className={styles$1.button} title="Theme" onClick={() => setOpen(!open)}>
                {ICONS[theme.colour]}
                <svg className={styles$1.caret} height="5" viewBox="0 0 8 5" width="8">
                    <path d="M0 0l4 5 4-5z" fill="currentColor" />
                </svg>
            </button>
            <div className={styles$1.flyout}>
                <div className={styles$1.pill} ref={pill} onMouseLeave={() => setTip(null)}>
                    <div className={styles$1.column}>
                        {COLOURS.map(c => item(c, theme.colour === c.id, {colour: c.id}))}
                    </div>
                    <div className={styles$1.column}>
                        {STYLES.map((st, i) => item(st, theme.style === st.id, {style: st.id},
                            <span className={styles$1.number}>{i + 1}</span>))}
                        <span className={styles$1.gap} />
                        <button
                            aria-label="Code editor colors"
                            className={styles$1.item}
                            onClick={() => { setOpen(false); setCode(true); }}
                            onMouseEnter={showTip}
                        >{ICONS.code}</button>
                    </div>
                </div>
                {tip ? (
                    <span className={styles$1.tip} style={{top: tip.top}}>{tip.label}</span>
                ) : null}
            </div>
            {code ? <CodeThemeDialog onClose={() => setCode(false)} /> : null}
        </div>
    );
};
export default ThemePicker;
