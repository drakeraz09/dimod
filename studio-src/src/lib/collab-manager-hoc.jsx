import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import CollabProvider from './collab-provider';

const getDimodProjectId = () => new URLSearchParams(location.search).get('p');

const collabManagerHOC = function (WrappedComponent) {
    class CollabManager extends React.Component {
        constructor (props) {
            super(props);
            this.tryConnect = this.tryConnect.bind(this);
        }
        componentDidMount () {
            this.tryConnect();
            if (!this.isConnected()) {
                window.addEventListener('dimod:vm-ready', this.tryConnect);
            }
        }
        componentWillUnmount () {
            window.removeEventListener('dimod:vm-ready', this.tryConnect);
            this.disconnect();
        }
        shouldConnect () {
            const projectId = getDimodProjectId();
            const token = localStorage.getItem('token');
            if (localStorage.getItem('dimod-collab-disabled') === '1') return false;
            return !!(projectId && token && window.vm);
        }
        isConnected () {
            return !!(window.dimodCollab && window.dimodCollab.connection);
        }
        tryConnect () {
            if (this.shouldConnect() && !this.isConnected()) {
                this.connect();
                window.removeEventListener('dimod:vm-ready', this.tryConnect);
            }
        }
        connect () {
            const projectId = getDimodProjectId();
            const token = localStorage.getItem('token');
            window.dimodCollab = new CollabProvider(projectId, token);
            window.dispatchEvent(new Event('dimod:collab-ready'));
        }
        disconnect () {
            if (window.dimodCollab) {
                window.dimodCollab.requestCloseConnection();
                window.dimodCollab = null;
            }
        }
        render () {
            return (
                <WrappedComponent {...this.props} />
            );
        }
    }

    CollabManager.propTypes = {
        vm: PropTypes.instanceOf(VM).isRequired
    };

    return CollabManager;
};

export default collabManagerHOC;
