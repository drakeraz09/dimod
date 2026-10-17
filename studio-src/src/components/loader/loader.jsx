import React from 'react';
import {defineMessages, FormattedMessage, intlShape, injectIntl} from 'react-intl';
import classNames from 'classnames';
import styles from './loader.css';
import PropTypes from 'prop-types';
import bindAll from 'lodash.bindall';

import * as progressMonitor from './tw-progress-monitor';
import isScratchDesktop from '../../lib/isScratchDesktop';

// tw:
// we make some rather large changes here:
//  - remove random message, replaced with message dependent on what is actually being loaded
//  - add a progress bar
//  - bring in intl so that we can translate everything
// The way of doing this is extremely unusual and weird compared to how things are typically done for performance.
// This is because react updates are too performance crippling to handle the progress bar rapidly updating.

const mainMessages = {
    'gui.loader.headline': (
        <FormattedMessage
            defaultMessage="Loading Project"
            description="Main loading message"
            id="gui.loader.headline"
        />
    ),
    'gui.loader.creating': (
        <FormattedMessage
            defaultMessage="Creating Project"
            description="Main creating message"
            id="gui.loader.creating"
        />
    ),
    'pm.loader.playground': (
        <FormattedMessage
            defaultMessage="Loading Playground"
            description="Playground load message"
            id="pm.loader.playground"
        />
    )
};

const messages = defineMessages({
    generic: {
        defaultMessage: 'Loading project …',
        description: 'Initial generic loading message',
        id: 'tw.loader.generic'
    },
    projectData: {
        defaultMessage: 'Downloading project data …',
        description: 'Appears when loading project data',
        id: 'tw.loader.data'
    },
    assetsKnown: {
        defaultMessage: 'Downloading assets ({complete}/{total}) …',
        description: 'Appears when loading project assets and amount of assets is known',
        id: 'tw.loader.assets.known'
    },
    assetsDecoding: {
        defaultMessage: 'Loading assets ({complete}/{total}) …',
        description: 'Appears while the costumes and sounds of a downloaded project are being loaded',
        id: 'dimod.loader.assets.decoding'
    },
    starting: {
        defaultMessage: 'Starting project …',
        description: 'Appears after every asset has loaded, while the project finishes setting up',
        id: 'dimod.loader.starting'
    },
    assetsUnknown: {
        defaultMessage: 'Downloading assets …',
        description: 'Appears when loading project assets but amount of assets is unknown',
        id: 'tw.loader.assets.unknown'
    }
});

const formatMB = bytes => `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
const formatMbps = bytesPerSec => `${((bytesPerSec * 8) / 1e6).toFixed(1)} Mbps`;
const formatEta = seconds => {
    if (!isFinite(seconds)) return '?';
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

class LoaderComponent extends React.Component {
    constructor (props) {
        super(props);
        this._state = 0;
        this.progress = 0;
        this.complete = 0;
        this.total = 0;
        bindAll(this, [
            'barInnerRef',
            'handleProgressChange',
            'messageRef',
            'detailRef'
        ]);
    }
    componentDidMount () {
        if (!isScratchDesktop()) {
            progressMonitor.setProgressHandler(this.handleProgressChange);
        }
        this.updateMessage();
    }
    componentDidUpdate () {
        this.update();
    }
    componentWillUnmount () {
        // force completion
        this.progress = 1;
        this.update();
        progressMonitor.setProgressHandler(() => {});
    }
    handleProgressChange (state, progress, complete, total, info) {
        this.info = info;
        if (state !== this._state) {
            this._state = state;
            this.updateMessage();
        }
        this.progress = progress;
        this.complete = complete;
        this.total = total;
        this.update();
    }
    update () {
        if (this.barInner) {
            this.barInner.style.width = `${this.progress * 100}%`;
        }
        if (this._state >= 1) {
            this.updateMessage();
        }
        this.updateDetail();
    }
    updateDetail () {
        if (!this.detail) return;
        const info = this.info;
        let text = '';
        if (info && this._state === 1 && info.loaded > 0) {
            const parts = [];
            if (info.totalBytes > 0) {
                const left = Math.max(0, info.totalBytes - info.loaded);
                parts.push(`${formatMB(info.loaded)} of ${formatMB(info.totalBytes)}`, `${formatMB(left)} left`);
                if (info.rate > 0 && left > 0) parts.push(`${formatMbps(info.rate)}`, `${formatEta(left / info.rate)} left`);
            } else {
                parts.push(formatMB(info.loaded));
                if (info.rate > 0) parts.push(formatMbps(info.rate));
            }
            text = parts.join(' · ');
        } else if (info && this._state === 3 && this.total > 0) {
            const left = info.totalBytes * (1 - (this.complete / this.total));
            text = this.complete < this.total ?
                `${this.total - this.complete} assets · ${formatMB(left)} left of ${formatMB(info.totalBytes)}` :
                `${this.total} assets · ${formatMB(info.totalBytes)}`;
        }
        this.detail.textContent = text;
    }
    updateMessage () {
        if (this._state === 0) {
            this.message.textContent = this.props.intl.formatMessage(messages.generic);
        } else if (this._state === 1) {
            this.message.textContent = this.props.intl.formatMessage(messages.projectData);
        } else if (this._state === 3) {
            this.message.textContent = this.complete >= this.total ?
                this.props.intl.formatMessage(messages.starting) :
                this.props.intl.formatMessage(messages.assetsDecoding, {complete: this.complete, total: this.total});
        } else if (this.total > 0) {
            this.message.textContent = this.props.intl.formatMessage(messages.assetsKnown, {
                complete: this.complete,
                total: this.total
            });
        } else {
            this.message.textContent = this.props.intl.formatMessage(messages.assetsUnknown);
        }
    }
    barInnerRef (element) {
        this.barInner = element;
    }
    messageRef (element) {
        this.message = element;
    }
    detailRef (element) {
        this.detail = element;
    }
    render () {
        return (
            <div
                className={classNames(styles.background, {
                    [styles.fullscreen]: this.props.isFullScreen
                })}
            >
                <div className={styles.container}>
                    <div className={styles.title}>
                        {mainMessages[this.props.messageId]}
                    </div>
                    <div className={styles.messageContainerOuter}>
                        <div
                            className={styles.messageContainerInner}
                            ref={this.messageRef}
                        />
                    </div>
                    <div
                        className={styles.dimodDetail}
                        ref={this.detailRef}
                    />
                    {!isScratchDesktop() && (
                        <div className={styles.twProgressOuter}>
                            <div
                                className={styles.twProgressInner}
                                ref={this.barInnerRef}
                            />
                        </div>
                    )}
                </div>
            </div>
        );
    }
}

LoaderComponent.propTypes = {
    isFullScreen: PropTypes.bool,
    intl: intlShape.isRequired,
    messageId: PropTypes.string
};
LoaderComponent.defaultProps = {
    isFullScreen: false,
    messageId: 'gui.loader.headline'
};

export default injectIntl(LoaderComponent);
