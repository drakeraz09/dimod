import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape, FormattedMessage} from 'react-intl';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import {resolveComplexSpriteGate} from '../../lib/dimod-vm-patches';

import styles from './complex-sprite-warning-modal.css';

const messages = defineMessages({
    title: {
        id: 'dimod.complexSpriteWarning.title',
        defaultMessage: 'This project has complex sprites.',
        description: 'Title of the complex sprite warning modal'
    },
    body: {
        id: 'dimod.complexSpriteWarning.body',
        defaultMessage: 'They run completely unsandboxed! A complex sprite\'s code can do anything ' +
            'JavaScript can do on this page... so only proceed if you trust whoever made it. ' +
            'The DimodWarp developers are not responsible for any resulting issues.',
        description: 'Body text of the complex sprite warning modal'
    },
    dontShowAgain: {
        id: 'dimod.complexSpriteWarning.dontShowAgain',
        defaultMessage: 'Don\'t show this again',
        description: 'Checkbox label to stop showing the complex sprite warning modal'
    },
    leaveButton: {
        id: 'dimod.complexSpriteWarning.buttonLeave',
        defaultMessage: 'Leave',
        description: 'Button to cancel loading a project with complex sprites and leave'
    },
    proceedButton: {
        id: 'dimod.complexSpriteWarning.buttonProceed',
        defaultMessage: 'Proceed',
        description: 'Button to continue loading a project with complex sprites'
    }
});

class ComplexSpriteWarningModal extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleProceed',
            'handleLeave',
            'handleDontShowAgainChanged'
        ]);
        this.state = {
            dontShowAgain: false
        };
    }
    handleProceed () {
        if (this.state.dontShowAgain && this.props.onDontShowAgain) {
            this.props.onDontShowAgain();
        }
        resolveComplexSpriteGate(true);
        this.props.onRequestClose();
    }
    handleLeave () {
        resolveComplexSpriteGate(false);
        this.props.onRequestClose();
        window.location.href = '/';
    }
    handleDontShowAgainChanged (e) {
        this.setState({dontShowAgain: e.target.checked});
    }
    render () {
        return (<Modal
            className={styles.modalContent}
            contentLabel={this.props.intl.formatMessage(messages.title)}
            id="complexspritewarningmodal"
            onRequestClose={this.handleLeave}
        >
            <Box className={styles.body}>
                <div className={styles.warningBox}>
                    <FormattedMessage {...messages.body} />
                </div>
                <Box className={styles.buttonRow}>
                    <label className={styles.dontShowAgain}>
                        <input
                            checked={this.state.dontShowAgain}
                            type="checkbox"
                            onChange={this.handleDontShowAgainChanged}
                        />
                        <FormattedMessage {...messages.dontShowAgain} />
                    </label>
                    <Box className={styles.actionButtons}>
                        <button
                            className={styles.leaveButton}
                            onClick={this.handleLeave}
                        >
                            <FormattedMessage {...messages.leaveButton} />
                        </button>
                        <button
                            className={styles.proceedButton}
                            onClick={this.handleProceed}
                        >
                            <FormattedMessage {...messages.proceedButton} />
                        </button>
                    </Box>
                </Box>
            </Box>
        </Modal>);
    }
}

ComplexSpriteWarningModal.propTypes = {
    intl: intlShape.isRequired,
    onDontShowAgain: PropTypes.func,
    onRequestClose: PropTypes.func.isRequired
};

export default injectIntl(ComplexSpriteWarningModal);
