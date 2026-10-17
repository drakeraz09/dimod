import React from 'react';
import PropTypes from 'prop-types';
const ENTER_MS = 160;
const LEAVE_MS = 120;
const CSS = `
@keyframes dimodBulkIn { from { max-height: 0; opacity: 0; } to { max-height: 130px; opacity: 1; } }
@keyframes dimodBulkOut { from { max-height: 130px; opacity: 1; } to { max-height: 0; opacity: 0; } }
.dimod-bulk-bar > div { background: #fff !important; box-shadow: 0 6px 22px rgba(0,0,0,.28); }
[theme="dark"] .dimod-bulk-bar > div { background: #3b3b3b !important; }
.dimod-bulk-bar { overflow: hidden; animation: dimodBulkIn ${ENTER_MS}ms ease-out both; }
.dimod-bulk-bar.leaving { animation: dimodBulkOut ${LEAVE_MS}ms ease-in both; pointer-events: none; }
.dimod-bulk-btn { transition: background .1s; }
.dimod-bulk-btn:hover { background: rgba(128,128,128,0.28) !important; }
.dimod-bulk-btn.danger { color: #d9463b; }
.dimod-bulk-btn.danger:hover { background: rgba(217,70,59,0.16) !important; }
`;
const SHORT = {Duplicate: 'Copy', Download: 'Export'};
const ICON_PATHS = {
    Duplicate: 'M5.5 5.5h7v7h-7z M3.5 10.5v-7h7',
    Rename: 'M3 13l.6-2.8 6.9-6.9 2.2 2.2-6.9 6.9z M9.3 4.5l2.2 2.2',
    Send: 'M3 8h8 M8 4.5l3.5 3.5-3.5 3.5 M13 3v10',
    Top: 'M3 3h10 M8 13V6 M5 8.5l3-3 3 3',
    Bottom: 'M3 13h10 M8 3v7 M5 7.5l3 3 3-3',
    Download: 'M8 2.5v7.5 M5 7.5l3 3 3-3 M3 13h10',
    Delete: 'M3.5 4.5h9 M6.5 4.5v-1.5h3v1.5 M4.7 4.5l.6 8.5h5.4l.6-8.5 M7 7v4 M9 7v4'
};
const Icon = ({name}) => (
    <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{display: 'block', margin: '0 auto 1px'}}
    >
        <path d={ICON_PATHS[name] || ''} />
    </svg>
);
Icon.propTypes = {name: PropTypes.string};
class BulkBar extends React.Component {
    constructor (props) {
        super(props);
        this.state = {leaving: false, shown: props.count >= (props.minCount || 2), last: props.actions || [], lastCount: props.count};
        this.handleKey = this.handleKey.bind(this);
    }
    componentDidMount () { window.addEventListener('keydown', this.handleKey); }
    componentDidUpdate (prevProps) {
        const min = this.props.minCount || 2;
        const active = this.props.count >= min;
        if (active) {
            if (this.state.leaving || !this.state.shown) { clearTimeout(this._t); this.setState({leaving: false, shown: true}); }
            if ((this.props.actions && this.props.actions !== this.state.last) ||
                this.props.count !== this.state.lastCount) {
                this.setState({last: this.props.actions || this.state.last, lastCount: this.props.count});
            }
        } else if (this.state.shown && !this.state.leaving && prevProps.count >= min) {
            this.setState({leaving: true});
            this._t = setTimeout(() => this.setState({shown: false, leaving: false}), LEAVE_MS);
        }
    }
    componentWillUnmount () { clearTimeout(this._t); window.removeEventListener('keydown', this.handleKey); }
    handleKey (e) {
        if (e.key !== 'Escape' || this.props.count < (this.props.minCount || 2) || !this.props.onClear) return;
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        this.props.onClear();
    }
    render () {
        const {count, onClear, hidden} = this.props;
        const {shown, leaving, last, lastCount} = this.state;
        if (!shown) return null;
        const actions = this.props.actions || last;
        const selectAll = actions.find(a => a.label === 'All');
        const buttons = actions.filter(a => a.label !== 'All');
        const chip = {
            border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', borderRadius: 4,
            padding: '3px 0 2px', fontSize: 9.5, lineHeight: 1.1, fontFamily: 'inherit', textAlign: 'center'
        };
        return (
            <div
                className={`dimod-bulk-bar${leaving ? ' leaving' : ''}`}
                style={{
                    position: 'absolute', zIndex: 200, pointerEvents: 'auto',
                    ...(window.innerWidth < 700 ?
                        {left: 8, right: 8, bottom: '5rem'} :
                        {left: 'calc(100% + 8px)', top: 8, width: 190}),
                    visibility: hidden ? 'hidden' : 'visible'
                }}
            >
                <style>{CSS}</style>
                <div
                    style={{
                        padding: '3px 4px', borderRadius: 8, fontSize: 10.5,
                        background: 'rgba(128,128,128,0.14)', border: '1px solid rgba(128,128,128,0.25)'
                    }}
                >
                    <div style={{display: 'flex', alignItems: 'center', padding: '0 2px 2px'}}>
                        <span style={{flex: 1, opacity: 0.75}}>{`${leaving ? lastCount : count} selected`}</span>
                        {selectAll ? (
                            <button
                                className="dimod-bulk-btn"
                                title={selectAll.title}
                                onClick={selectAll.onClick}
                                style={{...chip, padding: '0 5px', marginRight: 2}}
                            >{'All'}</button>
                        ) : null}
                        <button
                            className="dimod-bulk-btn"
                            title="Clear selection (Esc)"
                            onClick={onClear}
                            style={{...chip, padding: '0 5px', opacity: 0.8}}
                        >{'✕'}</button>
                    </div>
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1}}>
                        {buttons.map(a => (
                            <button
                                key={a.label}
                                className={`dimod-bulk-btn${a.danger ? ' danger' : ''}`}
                                title={a.title || a.label}
                                onClick={a.onClick}
                                style={chip}
                            >
                                <Icon name={a.label} />
                                {SHORT[a.label] || a.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }
}
BulkBar.propTypes = {
    actions: PropTypes.arrayOf(PropTypes.shape({
        label: PropTypes.string.isRequired,
        onClick: PropTypes.func.isRequired,
        danger: PropTypes.bool,
        title: PropTypes.string
    })),
    count: PropTypes.number.isRequired,
    hidden: PropTypes.bool,
    onClear: PropTypes.func,
    order: PropTypes.number
};
export default BulkBar;
