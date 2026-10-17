import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import styles from './dimod-fullscreen-button.css';
const ATTR = 'data-dimod-fullscreen';
const listeners = new Set();
let active = null;
const resized = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
const changed = () => listeners.forEach(fn => fn(active));
const panelOf = el => (el && el.closest ? el.closest('[role="tabpanel"]') : null);
const isFullscreen = panel => !!panel && active === panel;
const onFullscreenChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const handleBrowserFullscreenChange = () => {
    if (!document.fullscreenElement && active) exitFullscreen();
};
const handleKeyDown = event => {
    if (event.key === 'Escape' && active && !document.fullscreenElement) exitFullscreen();
};
const enterFullscreen = panel => {
    if (!panel || active === panel) return;
    if (active) exitFullscreen();
    active = panel;
    panel.setAttribute(ATTR, 'true');
    document.addEventListener('fullscreenchange', handleBrowserFullscreenChange);
    document.addEventListener('keydown', handleKeyDown);
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
        root.requestFullscreen().catch(() => {
        });
    }
    changed();
    resized();
};
const exitFullscreen = () => {
    if (!active) return;
    active.removeAttribute(ATTR);
    active = null;
    document.removeEventListener('fullscreenchange', handleBrowserFullscreenChange);
    document.removeEventListener('keydown', handleKeyDown);
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(() => {}); }
    changed();
    resized();
};
const toggleFullscreen = panel => {
    if (isFullscreen(panel)) exitFullscreen();
    else enterFullscreen(panel);
};
const ENTER_PATH = 'M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4';
const EXIT_PATH = 'M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4';
const FullscreenIcon = ({on, width = 22}) => (
    <svg height={width} viewBox="0 0 16 16" width={width}>
        <path
            d={on ? EXIT_PATH : ENTER_PATH}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
        />
    </svg>
);
FullscreenIcon.propTypes = {on: PropTypes.bool, width: PropTypes.number};
class DimodFullscreenButton extends React.Component {
    constructor (props) {
        super(props);
        this.state = {on: false};
        this.ref = React.createRef();
        this.handleClick = this.handleClick.bind(this);
        this.handleChange = this.handleChange.bind(this);
    }
    componentDidMount () { this.unsubscribe = onFullscreenChange(this.handleChange); }
    componentWillUnmount () {
        this.unsubscribe();
        if (this.state.on) exitFullscreen();
    }
    handleChange () { this.setState({on: isFullscreen(panelOf(this.ref.current))}); }
    handleClick () { toggleFullscreen(panelOf(this.ref.current)); }
    render () {
        const on = this.state.on;
        return (
            <button
                className={classNames(styles.button, {[styles.on]: on})}
                ref={this.ref}
                title={on ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                onClick={this.handleClick}
            >
                <FullscreenIcon on={on} />
            </button>
        );
    }
}
export {DimodFullscreenButton, ENTER_PATH, EXIT_PATH, FullscreenIcon, enterFullscreen, exitFullscreen, isFullscreen, onFullscreenChange, panelOf, toggleFullscreen};
