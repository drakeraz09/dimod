import classNames from 'classnames';
import {connect} from 'react-redux';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, intlShape, injectIntl} from 'react-intl';
import {setProjectTitle} from '../../reducers/project-title';
import {fetchProjectName, saveProjectName} from '../../lib/dimod-project';

import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import Input from '../forms/input.jsx';
const BufferedInput = BufferedInputHOC(Input);

import styles from './project-title-input.css';

const messages = defineMessages({
    projectTitlePlaceholder: {
        id: 'gui.gui.projectTitlePlaceholder',
        description: 'Placeholder for project title when blank',
        defaultMessage: 'Project title here'
    }
});

class ProjectTitleInput extends React.Component {
    constructor (props) {
        super(props);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.state = {error: null};
        this._mounted = false;
        this._renamed = false;
        this._lastSubmitted = null;
    }
    componentDidMount () {
        this._mounted = true;
        fetchProjectName().then(name => {
            if (!name) return;
            this._lastSubmitted = name.trim();
            if (this._mounted && !this._renamed) this.props.onSetTitle(name);
        });
    }
    componentWillUnmount () {
        this._mounted = false;
    }
    handleSubmit (title) {
        this._renamed = true;
        this.props.onSetTitle(title);
        const trimmed = String(title || '').trim();
        if (trimmed === this._lastSubmitted) return;
        this._lastSubmitted = trimmed;
        this.setState({error: null});
        saveProjectName(title).then(error => {
            if (!error) return;
            this._lastSubmitted = null;
            if (!this._mounted) return;
            this.setState({error});
            window.dispatchEvent(new CustomEvent('dimod:system-message', {
                detail: {text: `Couldn't rename this project: ${error}`}
            }));
        });
    }
    render () {
        return (
            <BufferedInput
                className={classNames(styles.titleField, this.props.className)}
                maxLength="100"
                placeholder={this.props.intl.formatMessage(messages.projectTitlePlaceholder)}
                title={this.state.error || ''}
                tabIndex="0"
                type="text"
                value={this.props.projectTitle}
                onSubmit={this.handleSubmit}
            />
        );
    }
}

ProjectTitleInput.propTypes = {
    className: PropTypes.string,
    intl: intlShape.isRequired,
    onSetTitle: PropTypes.func,
    projectTitle: PropTypes.string
};

const mapStateToProps = state => ({
    projectTitle: state.scratchGui.projectTitle
});

const mapDispatchToProps = dispatch => ({
    onSetTitle: title => dispatch(setProjectTitle(title))
});

export default injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps
)(ProjectTitleInput));
