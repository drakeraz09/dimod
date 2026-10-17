import React from 'react';
import PropTypes from 'prop-types';
import CrashMessageComponent from '../components/crash-message/crash-message.jsx';
import log from '../lib/log.js';
import {recommendedBrowser} from '../lib/supported-browser';
import {showErrorToast} from '../lib/dimod-ui.js';

const CRASH_LOOP_COUNT = 3;
const CRASH_LOOP_MS = 5000;

class ErrorBoundary extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            hasError: false,
            errorId: null,
            resetKey: 0,
            crashLoop: false
        };
        this.recentCrashes = [];
        this.handleRetry = this.handleRetry.bind(this);
    }

    componentDidCatch (error, info) {
        // Error object may be undefined (IE?)
        error = error || {
            stack: 'Unknown stack',
            message: 'Unknown error'
        };

        // Log errors to analytics, leaving out browsers that are not in our recommended set
        if (recommendedBrowser() && window.Sentry) {
            window.Sentry.withScope(scope => {
                Object.keys(info).forEach(key => {
                    scope.setExtra(key, info[key]);
                });
                scope.setExtra('action', this.props.action);
                window.Sentry.captureException(error);
            });
        }

        // Log error locally for debugging as well.
        log.error(`Unhandled Error: ${error.stack ? error.stack : error}\nComponent stack: ${info.componentStack}`);

        if (this.props.recover) {
            showErrorToast(error, this.props.label || this.props.action);
            const now = Date.now();
            this.recentCrashes = this.recentCrashes.filter(time => now - time < CRASH_LOOP_MS);
            this.recentCrashes.push(now);
            this.setState(state => ({
                resetKey: state.resetKey + 1,
                crashLoop: this.recentCrashes.length >= CRASH_LOOP_COUNT
            }));
            return;
        }

        // Display fallback UI
        this.setState({
            hasError: true,
            errorId: window.Sentry ? window.Sentry.lastEventId() : null,
            errorMessage: `${(error && error.message) || error}`
        });
    }

    handleRetry () {
        this.recentCrashes = [];
        this.setState(state => ({
            resetKey: state.resetKey + 1,
            crashLoop: false
        }));
    }

    handleBack () {
        window.history.back();
    }

    handleReload () {
        const projectId = new URLSearchParams(window.location.search).get('p');
        const query = projectId ? `?p=${encodeURIComponent(projectId)}` : '';
        window.location.replace(window.location.origin + window.location.pathname + query);
    }

    render () {
        if (this.state.hasError) {
            return (
                <CrashMessageComponent
                    eventId={this.state.errorId}
                    errorMessage={this.state.errorMessage}
                    onReload={this.handleReload}
                />
            );
        }
        if (this.state.crashLoop) {
            return (
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        width: '100%',
                        height: '100%',
                        padding: '1rem',
                        boxSizing: 'border-box',
                        textAlign: 'center'
                    }}
                >
                    <div>{'This panel keeps crashing. The rest of the studio still works.'}</div>
                    <button
                        type="button"
                        onClick={this.handleRetry}
                    >
                        {'Try again'}
                    </button>
                </div>
            );
        }
        if (this.props.recover) {
            return (
                <React.Fragment key={this.state.resetKey}>
                    {this.props.children}
                </React.Fragment>
            );
        }
        return this.props.children;
    }
}

ErrorBoundary.propTypes = {
    action: PropTypes.string.isRequired, // Used for defining tracking action
    children: PropTypes.node,
    label: PropTypes.string,
    recover: PropTypes.bool
};

export default ErrorBoundary;
