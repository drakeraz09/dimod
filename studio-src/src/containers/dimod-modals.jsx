import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import Box from '../components/box/box.jsx';
import Modal from './modal.jsx';
import {
    DIT_ICON,
    getCloudState,
    setCloudPurchasePrompt,
    onCloudStateChange,
    enableCloudProject,
    getDimodToken
} from '../lib/dimod-project';
import styles from '../components/dimod-cloud-purchase-modal/dimod-cloud-purchase-modal.css';
import Prompt from './prompt.jsx';
import {setCustomPromptHost, setDialogHost, setRenamePrompt} from '../lib/dimod-ui';
import settingsStyles from '../components/tw-settings-modal/settings-modal.css';
import promptStyles from '../components/prompt/prompt.css';
import {Provider} from 'react-redux';
import styles$1 from '../components/dimod-project-chat/dimod-project-chat.css';
const DitAmount = ({amount}) => (
    <span className={styles.dits}>
        <img className={styles.ditIcon} src={DIT_ICON} alt="" draggable={false} />
        {typeof amount === 'number' ? amount.toLocaleString() : amount}
    </span>
);
DitAmount.propTypes = {amount: PropTypes.oneOfType([PropTypes.number, PropTypes.string])};
class DimodCloudPurchaseModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['open', 'handleCancel', 'handleBuy', 'handleCloudState']);
        this.resolvers = [];
        this.state = {visible: false, busy: false, error: null, cloud: getCloudState()};
    }
    componentDidMount () {
        this.offPrompt = setCloudPurchasePrompt(this.open);
        this.offCloud = onCloudStateChange(this.handleCloudState);
    }
    componentWillUnmount () { this.offPrompt(); this.offCloud(); this.finish(false); }
    open (resolve) {
        this.resolvers.push(resolve);
        this.setState({visible: true, busy: false, error: null, cloud: getCloudState()});
    }
    finish (result) { const resolvers = this.resolvers; this.resolvers = []; resolvers.forEach(resolve => resolve(result)); }
    handleCloudState (cloud) {
        this.setState({cloud});
        if (cloud.isCloud && this.state.visible && !this.state.busy) { this.setState({visible: false}); this.finish(true); }
    }
    handleCancel () {
        if (this.state.busy) return;
        this.setState({visible: false});
        this.finish(false);
    }
    async handleBuy () {
        this.setState({busy: true, error: null});
        const error = await enableCloudProject();
        if (error) { this.setState({busy: false, error}); return; }
        this.setState({busy: false, visible: false});
        this.finish(true);
    }
    render () {
        if (!this.state.visible) return null;
        const {busy, error, cloud} = this.state;
        const {cost, balance} = cloud;
        const free = cloud.free === true || cost === 0;
        const hasBalance = typeof balance === 'number';
        const short = !free && hasBalance && balance < cost;
        return (
            <Modal
                className={styles.modalContent}
                contentLabel="Cloud project"
                id="dimodCloudPurchaseModal"
                onRequestClose={this.handleCancel}
            >
                <Box className={styles.body}>
                    <div className={styles.lead}>
                        {'Make this project multiplayer:'}
                    </div>
                    <ul className={styles.list}>
                        <li>{'Client blocks: send data, ask the server, ping'}</li>
                        <li>{'Server tab (in the STAGE!!!) for rounds, scores and checking what players send'}</li>
                        <li>{'Cloud variables that hold text, up to 1 MB each'}</li>
                    </ul>
                    <div className={styles.priceRow}>
                        {free ? (
                            <div className={styles.price}>
                                <strong>{'Free'}</strong>
                                <span className={styles.once}>{'your first cloud project is on us'}</span>
                            </div>
                        ) : (
                            <div className={styles.price}>
                                <DitAmount amount={cost} />
                                <span className={styles.once}>{'once, for this project'}</span>
                            </div>
                        )}
                        {hasBalance && !free ? (
                            <div className={styles.balance}>
                                {'You have '}
                                <DitAmount amount={balance} />
                            </div>
                        ) : null}
                    </div>
                    {short ? (
                        <div className={styles.error}>
                            {'You need '}
                            <DitAmount amount={cost - balance} />
                            {' more.'}
                        </div>
                    ) : null}
                    {error ? <div className={styles.error}>{error}</div> : null}
                    <Box className={styles.buttonRow}>
                        <button className={styles.cancelButton} disabled={busy} onClick={this.handleCancel}>
                            {'Cancel'}
                        </button>
                        <button className={styles.okButton} disabled={busy || short} onClick={this.handleBuy}>
                            {busy ? (free ? 'Turning it on…' : 'Buying…') : free ? 'Make it a cloud project' : (
                                <React.Fragment>
                                    {'Buy for '}
                                    <DitAmount amount={cost} />
                                </React.Fragment>
                            )}
                        </button>
                    </Box>
                </Box>
            </Modal>
        );
    }
}
const isObject = value => typeof value === 'object' && value !== null;
let nextId = 0;
let paintModalId = 0;
class DimodPaintModals extends React.Component {
    constructor (props) { super(props); this.state = {modals: []}; this.open = this.open.bind(this); }
    componentDidMount () { window.dimodPaintModal = this.open; }
    componentWillUnmount () {
        if (window.dimodPaintModal === this.open) delete window.dimodPaintModal;
    }
    open (title, onClose) {
        return new Promise(resolve => {
            const modal = {id: `dimodPaintModal${paintModalId++}`, title, onClose};
            modal.ref = node => {
                if (!node || modal.node) return;
                modal.node = node;
                setTimeout(() => window.dispatchEvent(new Event('dimod-modal-open')), 0);
                resolve({node, close: () => this.close(modal, true)});
            };
            this.setState(state => ({modals: state.modals.concat(modal)}));
        });
    }
    close (modal, silent) {
        this.setState(state => ({modals: state.modals.filter(m => m !== modal)}));
        if (!silent && modal.onClose) modal.onClose();
    }
    render () {
        return this.state.modals.map(modal => (
            <Modal
                className={settingsStyles.modalContent}
                contentLabel={modal.title}
                id={modal.id}
                key={modal.id}
                onRequestClose={() => this.close(modal)}
            >
                <Box className={settingsStyles.body}>
                    <div ref={modal.ref} />
                </Box>
            </Modal>
        ));
    }
}
class DimodCustomPrompts extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['customPrompt']);
        this.state = {prompts: []};
        this.refCallbacks = new Map();
    }
    componentDidMount () { this.unregister = setCustomPromptHost(this.customPrompt); }
    componentWillUnmount () {
        if (this.unregister) this.unregister();
    }
    customPrompt (config, styles, buttons, handleCallback) {
        return new Promise((resolve, reject) => {
            if (!isObject(config)) {
                reject("Custom Modal -- Param 1 must be an object with at least properties: 'title' (string)");
                return;
            }
            if (!config.title) { reject("Custom Modal -- Missing 'title' (string) property in Param 1"); return; }
            if (styles && !isObject(styles)) { reject('Custom Modal -- Param 2 must be an object'); return; }
            if (styles && !styles.content && !styles.overlay) {
                reject("Custom Modal -- If Param 2 is specified, specify CSS styles within either: 'content' or 'overlay'");
                return;
            }
            const prompt = {id: `dimodCustomPrompt${nextId++}`, config, styles, buttons};
            this.refCallbacks.set(prompt.id, node => {
                if (!node) return;
                resolve(node);
                if (typeof handleCallback === 'function') {
                    handleCallback({customPromptObject: prompt, closePrompt: () => this.close(prompt)});
                }
            });
            this.setState(state => ({prompts: state.prompts.concat(prompt)}));
        });
    }
    close (prompt) {
        this.refCallbacks.delete(prompt.id);
        this.setState(state => ({prompts: state.prompts.filter(p => p !== prompt)}));
    }
    handleButton (button, prompt) {
        button.callback();
        if (!button.dontClose) this.close(prompt);
    }
    handleOk (prompt) {
        const okButton = (prompt.buttons || []).find(button => button.role === 'ok');
        if (okButton) this.handleButton(okButton, prompt);
    }
    handleCancel (prompt) {
        const closeButton = (prompt.buttons || []).find(button => button.role === 'close');
        if (closeButton) closeButton.callback();
        this.close(prompt);
    }
    render () {
        return this.state.prompts.map(prompt => (
            <Prompt
                isCustom
                config={prompt.config}
                customButtons={prompt.buttons}
                customRef={this.refCallbacks.get(prompt.id)}
                key={prompt.id}
                styleContent={prompt.styles ? prompt.styles.content : null}
                styleOverlay={prompt.styles ? prompt.styles.overlay : null}
                title={prompt.config.title}
                vm={this.props.vm}
                onCancel={() => this.handleCancel(prompt)}
                onCustomButton={button => this.handleButton(button, prompt)}
                onOk={() => this.handleOk(prompt)}
            />
        ));
    }
}
DimodCustomPrompts.propTypes = {vm: PropTypes.object};
const ABOVE = {zIndex: 2000};
const DANGER = {background: 'hsla(0, 80%, 52%, 1)', borderColor: 'hsla(0, 80%, 52%, 1)', color: 'white'};
class DimodDialogs extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['open', 'handleOk', 'handleCancel', 'handleChange', 'handleKeyDown', 'handleFocus']);
        this.state = {current: null, text: ''};
        this.queue = [];
    }
    componentDidMount () { this.off = setDialogHost(this.open); }
    componentWillUnmount () {
        this.off();
        if (this.state.current) this.state.current.resolve(this.answer(this.state.current, false));
        this.queue.forEach(item => item.resolve(this.answer(item, false)));
        this.queue = [];
    }
    open (options, resolve) {
        const item = {options, resolve};
        if (this.state.current) { this.queue.push(item); return; }
        this.show(item);
    }
    show (item) { this.setState({current: item, text: item.options.initial || ''}); }
    answer (item, ok) {
        const {kind} = item.options;
        if (kind === 'confirm') return ok;
        if (kind === 'prompt') return ok ? this.state.text : null;
        return null;
    }
    finish (ok) {
        const item = this.state.current;
        if (!item) return;
        const value = this.answer(item, ok);
        const next = this.queue.shift() || null;
        this.setState({current: next, text: next ? next.options.initial || '' : ''});
        item.resolve(value);
    }
    handleOk () { this.finish(true); }
    handleCancel () { this.finish(false); }
    handleChange (e) { this.setState({text: e.target.value}); }
    handleFocus (e) { e.target.select(); }
    handleKeyDown (e) {
        if (e.key === 'Enter') this.handleOk();
    }
    render () {
        const {current, text} = this.state;
        if (!current) return null;
        const {options} = current;
        const isAlert = options.kind === 'alert';
        const paragraphs = options.message.split(/\n\s*\n/);
        return (
            <Modal
                id="dimodDialog"
                contentLabel={options.title || (isAlert ? 'Heads up' : 'Are you sure?')}
                className={promptStyles.modalContent}
                styleOverlay={ABOVE}
                onRequestClose={isAlert ? this.handleOk : this.handleCancel}
            >
                <Box className={promptStyles.body}>
                    <Box className={promptStyles.label}>
                        {options.message ? paragraphs.map((p, i) => (
                            <p key={i} style={{margin: i === 0 ? 0 : '0.6rem 0 0', whiteSpace: 'pre-line'}}>
                                {p}
                            </p>
                        )) : null}
                    </Box>
                    {options.kind === 'prompt' ? (
                        <Box>
                            <input
                                autoFocus
                                className={promptStyles.variableNameTextInput}
                                value={text}
                                onChange={this.handleChange}
                                onFocus={this.handleFocus}
                                onKeyDown={this.handleKeyDown}
                            />
                        </Box>
                    ) : null}
                    <Box className={promptStyles.buttonRow}>
                        {isAlert ? null : (
                            <button className={promptStyles.cancelButton} onClick={this.handleCancel}>
                                {options.cancel || 'Cancel'}
                            </button>
                        )}
                        <button
                            autoFocus={options.kind !== 'prompt'}
                            className={promptStyles.okButton}
                            style={options.danger ? DANGER : null}
                            onClick={this.handleOk}
                        >
                            {options.ok || 'OK'}
                        </button>
                    </Box>
                </Box>
            </Modal>
        );
    }
}
const makeFreezableStore = store => {
    let frozen = false;
    let snapshot = null;
    const listeners = new Set();
    const notify = () => Array.from(listeners).forEach(listener => listener());
    const unsubscribe = store.subscribe(() => {
        if (!frozen) notify();
    });
    return {
        dispatch: (...args) => store.dispatch(...args),
        getState: () => (frozen ? snapshot : store.getState()),
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        replaceReducer: (...args) => store.replaceReducer(...args),
        freeze: () => {
            if (frozen) return;
            snapshot = store.getState();
            frozen = true;
        },
        thaw: () => {
            if (!frozen) return;
            frozen = false;
            snapshot = null;
            notify();
        },
        dispose: unsubscribe
    };
};
class DimodKeepAlive extends React.Component {
    constructor (props, context) {
        super(props, context);
        this.store = makeFreezableStore(context.store);
        this.shown = props.visible;
        this.evict = () => {
            if (this.props.visible || !this.shown) return;
            this.shown = false;
            this.forceUpdate();
        };
        window.addEventListener('dimod:paint-evict', this.evict);
    }
    shouldComponentUpdate (nextProps) { return nextProps.visible || this.props.visible; }
    componentDidUpdate (prevProps) {
        if (this.props.visible === prevProps.visible) return;
        if (this.props.visible) {
            this.store.thaw();
            if (this.props.onShow) this.props.onShow();
        } else {
            this.store.freeze();
            if (this.props.onHide) this.props.onHide();
        }
    }
    componentWillUnmount () { window.removeEventListener('dimod:paint-evict', this.evict); this.store.dispose(); }
    render () {
        if (this.props.visible) this.shown = true;
        if (!this.shown) return null;
        return (
            <Provider store={this.store}>
                {this.props.children}
            </Provider>
        );
    }
}
DimodKeepAlive.contextTypes = {store: PropTypes.object};
DimodKeepAlive.propTypes = {children: PropTypes.node, onHide: PropTypes.func, onShow: PropTypes.func, visible: PropTypes.bool};
const getDimodProjectId = () => new URLSearchParams(location.search).get('p');
const DimodProjectChat = () => {
    const projectId = getDimodProjectId();
    const signedIn = !!getDimodToken();
    if (!projectId) {
        return (
            <div className={styles$1.panel}>
                <p className={styles$1.note}>{'Project chat opens once this project is saved to Dimod.'}</p>
            </div>
        );
    }
    if (!signedIn) {
        return (
            <div className={styles$1.panel}>
                <p className={styles$1.note}>{'Log in on Dimod to use project chat.'}</p>
            </div>
        );
    }
    return (
        <div className={styles$1.panel}>
            <iframe
                className={styles$1.frame}
                src={`/embed/chat/project/${encodeURIComponent(projectId)}`}
                title="Project chat"
            />
        </div>
    );
};
class DimodRenameModal extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['open', 'handleChange', 'handleKeyDown', 'handleOk', 'handleCancel']);
        this.state = {options: null, text: ''};
        this.resolve = null;
    }
    componentDidMount () { this.off = setRenamePrompt(this.open); }
    componentWillUnmount () { this.off(); this.finish(null); }
    open (options, resolve) { this.finish(null); this.resolve = resolve; this.setState({options, text: options.initial || ''}); }
    finish (value) {
        const resolve = this.resolve;
        this.resolve = null;
        if (resolve) resolve(value);
    }
    handleChange (e) { this.setState({text: e.target.value}); }
    handleKeyDown (e) {
        if (e.key === 'Enter') this.handleOk();
    }
    handleOk () {
        const text = this.state.text.trim();
        if (!text) return;
        this.setState({options: null});
        this.finish(text);
    }
    handleCancel () { this.setState({options: null}); this.finish(null); }
    render () {
        const {options, text} = this.state;
        if (!options) return null;
        const names = options.preview ? options.preview(text.trim()) : [];
        const shown = names.slice(0, 5);
        return (
            <Modal
                id="dimodRename"
                contentLabel={options.title}
                className={promptStyles.modalContent}
                onRequestClose={this.handleCancel}
            >
                <Box className={promptStyles.body}>
                    <Box className={promptStyles.label}>
                        {options.label || 'New name'}
                    </Box>
                    <Box>
                        <input
                            autoFocus
                            className={promptStyles.variableNameTextInput}
                            maxLength={100}
                            value={text}
                            onChange={this.handleChange}
                            onKeyDown={this.handleKeyDown}
                            onFocus={e => e.target.select()}
                        />
                    </Box>
                    {options.hint ? (
                        <div style={{fontSize: '0.75rem', opacity: 0.7, marginTop: '0.5rem'}}>{options.hint}</div>
                    ) : null}
                    {shown.length > 0 && text.trim() ? (
                        <div
                            style={{
                                marginTop: '0.6rem', padding: '0.4rem 0.6rem', borderRadius: 6, fontSize: '0.8rem',
                                background: 'rgba(128,128,128,0.12)'
                            }}
                        >
                            <div style={{fontSize: '0.7rem', opacity: 0.6, marginBottom: 2}}>{'Will become'}</div>
                            {shown.map((n, i) => (
                                <div key={i}>{n}</div>
                            ))}
                            {names.length > shown.length ? (
                                <div style={{opacity: 0.6}}>{`…and ${names.length - shown.length} more`}</div>
                            ) : null}
                        </div>
                    ) : null}
                    <Box className={promptStyles.buttonRow}>
                        <button className={promptStyles.cancelButton} onClick={this.handleCancel}>
                            {'Cancel'}
                        </button>
                        <button className={promptStyles.okButton} disabled={!text.trim()} onClick={this.handleOk}>
                            {'Rename'}
                        </button>
                    </Box>
                </Box>
            </Modal>
        );
    }
}
export {DimodCloudPurchaseModal, DimodCustomPrompts, DimodPaintModals, DimodDialogs, DimodKeepAlive, DimodProjectChat, DimodRenameModal, DitAmount};
