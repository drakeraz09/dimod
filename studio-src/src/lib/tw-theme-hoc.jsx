import React from 'react';
import darkModeCSS from '!raw-loader!./tw-theme-dark.css';
import coloursCSS from '!raw-loader!./dimod-colours.css';
import godotCSS from '!raw-loader!./dimod-godot-theme.css';
import workbenchCSS from '!raw-loader!./dimod-style-workbench.css';
import railCSS from '!raw-loader!./dimod-style-rail.css';
import touchesCSS from '!raw-loader!./dimod-touches.css';
import {DEFAULT_PANELS, LEGACY_THEMES, studioColour, studioStyle} from './dimod-ui';

const THEME_KEY = 'tw:theme';
const COLOUR_KEY = 'dimod:colour';
const STYLE_KEY = 'dimod:style';

const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

const read = key => {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        return null;
    }
};
const allowedColour = id => (id === 'light' || id === 'dark' || studioColour(id) ? id : null);
const allowedStyle = id => (id === 'classic' || studioStyle(id) ? id : null);

const initialChoice = () => {
    const legacy = LEGACY_THEMES[read(THEME_KEY)];
    const base = read(THEME_KEY) === 'light' || read(THEME_KEY) === 'dark' ? read(THEME_KEY) : null;
    let colour = allowedColour(read(COLOUR_KEY)) || (legacy && allowedColour(legacy[0])) || base;
    if (!colour && legacy) colour = studioColour(legacy[0]).dark ? 'dark' : 'light';
    if (colour && !allowedColour(colour)) colour = studioColour(colour).dark ? 'dark' : 'light';
    if (!colour) colour = darkMediaQuery.matches ? 'dark' : 'light';
    const style = allowedStyle(read(STYLE_KEY)) || (legacy && allowedStyle(legacy[1])) || 'classic';
    return {colour, style};
};

const colourIsDark = colour => Boolean(studioColour(colour) && studioColour(colour).dark);

export const getInitialTheme = () => (colourIsDark(initialChoice().colour) ? 'dark' : 'light');
export const getInitialDarkMode = () => getInitialTheme() === 'dark';

const sheet = css => {
    const el = document.createElement('style');
    el.textContent = css;
    return el;
};
const darkModeStylesheet = sheet(darkModeCSS);
const coloursStylesheet = sheet(coloursCSS);
const styleStylesheet = sheet([godotCSS, workbenchCSS, railCSS].join('\n'));
document.head.appendChild(sheet(touchesCSS));
document.addEventListener('click', e => {
    const flag = e.target.closest && e.target.closest('[class*="green-flag_green-flag_"]');
    if (!flag) return;
    flag.removeAttribute('data-dimod-pulse');
    void flag.offsetWidth;
    flag.setAttribute('data-dimod-pulse', '');
    flag.addEventListener('animationend', () => flag.removeAttribute('data-dimod-pulse'), {once: true});
}, true);

const ThemeHOC = function (WrappedComponent) {
    class ThemeComponent extends React.Component {
        constructor (props) {
            super(props);
            this.handleQueryChange = this.handleQueryChange.bind(this);
            this.handleClickTheme = this.handleClickTheme.bind(this);
            this.handleSetTheme = this.handleSetTheme.bind(this);
            this.state = initialChoice();
        }
        handleSetTheme (e) {
            const detail = e.detail || {};
            const legacy = typeof detail === 'string' && LEGACY_THEMES[detail];
            const next = typeof detail === 'string' ?
                (legacy ? {colour: legacy[0], style: legacy[1]} : studioStyle(detail) ? {style: detail} : {colour: detail}) :
                detail;
            const change = {};
            if (next.colour && allowedColour(next.colour)) change.colour = next.colour;
            if (next.style && allowedStyle(next.style)) change.style = next.style;
            if (change.colour || change.style) this.setState(change);
        }
        componentDidMount () {
            window.addEventListener('dimod-set-theme', this.handleSetTheme);
            if (read(STYLE_KEY) === 'theater') {
                window.dispatchEvent(new CustomEvent('dimod:panel-order', {detail: DEFAULT_PANELS}));
                try {
                    localStorage.setItem(STYLE_KEY, this.state.style);
                } catch (e) {
                    // ignore
                }
            }
            // media query does not have listeners in legacy edge
            if (darkMediaQuery.addEventListener) {
                darkMediaQuery.addEventListener('change', this.handleQueryChange);
            }
            this.updateDark();
        }
        componentDidUpdate () {
            try {
                localStorage.setItem(THEME_KEY, colourIsDark(this.state.colour) ? 'dark' : 'light');
                localStorage.setItem(COLOUR_KEY, this.state.colour);
                localStorage.setItem(STYLE_KEY, this.state.style);
            } catch (e) {
                // ignore
            }
            this.updateDark();
        }
        componentWillUnmount () {
            window.removeEventListener('dimod-set-theme', this.handleSetTheme);
            // media query does not have listeners in legacy edge
            if (darkMediaQuery.removeEventListener) {
                darkMediaQuery.removeEventListener('change', this.handleQueryChange);
            }
        }
        updateDark () {
            const {colour, style} = this.state;
            const dark = colourIsDark(colour);
            const body = document.body;
            body.setAttribute('theme', dark ? 'dark' : 'light');
            body.setAttribute('dimod-colour', colour);
            body.setAttribute('dimod-style', style);
            if (style === 'classic') body.removeAttribute('editor-theme');
            else body.setAttribute('editor-theme', 'godot');
            const wanted = [dark && darkModeStylesheet, coloursStylesheet, style !== 'classic' && styleStylesheet];
            for (const el of [darkModeStylesheet, coloursStylesheet, styleStylesheet]) {
                if (!wanted.includes(el) && el.parentNode) el.parentNode.removeChild(el);
            }
            let after = null;
            for (const el of wanted) {
                if (!el) continue;
                const at = after ? after.nextSibling : body.firstChild;
                if (el !== at) body.insertBefore(el, at);
                after = el;
            }
            const key = `${colour}/${style}`;
            if (key !== this.lastTheme) {
                this.lastTheme = key;
                window.dispatchEvent(new Event('dimod-editor-theme'));
            }
        }
        handleQueryChange () {
            if (this.state.colour !== 'light' && this.state.colour !== 'dark') return;
            this.setState({colour: darkMediaQuery.matches ? 'dark' : 'light'});
        }
        handleClickTheme () {
            this.setState(state => ({colour: colourIsDark(state.colour) ? 'light' : 'dark'}));
        }
        render () {
            return (
                <WrappedComponent
                    onClickTheme={this.handleClickTheme}
                    isDark={colourIsDark(this.state.colour)}
                    editorTheme={this.state.style === 'classic' ? this.state.colour : this.state.style}
                    {...this.props}
                />
            );
        }
    }
    return ThemeComponent;
};

export {
    ThemeHOC as default
};
