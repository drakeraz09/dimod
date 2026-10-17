import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import {connect} from 'react-redux';

import ControlsComponent from '../components/controls/controls.jsx';
import {
    testWindowsAvailable,
    openTestWindow,
    updateTestWindows,
    onTestWindowsChange,
    installTestWindowsEditor
} from '../lib/dimod-server';

class Controls extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleGreenFlagClick',
            'handlePauseButtonClick',
            'handleStopAllClick',
            'handlePlayersClick',
            'handleWindowsChange'
        ]);
        this.state = {playerWindows: 0, playersAvailable: false};
    }
    componentDidMount () {
        this.offWindows = onTestWindowsChange(this.handleWindowsChange);
        this.handleWindowsChange(0);
        if (this.props.vm) installTestWindowsEditor(this.props.vm);
    }
    componentWillUnmount () {
        if (this.offWindows) this.offWindows();
    }
    handleWindowsChange (count) {
        this.setState({playerWindows: count, playersAvailable: testWindowsAvailable()});
    }
    handlePlayersClick (e) {
        e.preventDefault();
        if (e.shiftKey && this.state.playerWindows > 0) {
            updateTestWindows(this.props.vm);
        } else {
            openTestWindow(this.props.vm);
        }
    }
    handleGreenFlagClick (e) {
        e.preventDefault();
        // tw: implement alt+click and right click to toggle FPS
        if (e.shiftKey || e.altKey || e.type === 'contextmenu') {
            if (e.shiftKey) {
                this.props.vm.setTurboMode(!this.props.turbo);
            }
            if (e.altKey || e.type === 'contextmenu') {
                if (this.props.framerate === 30) {
                    this.props.vm.setFramerate(60);
                } else {
                    this.props.vm.setFramerate(30);
                }
            }
        } else {
            if (!this.props.isStarted) {
                this.props.vm.start();
            }
            this.props.vm.greenFlag();
        }
    }
    handlePauseButtonClick (e) {
        e.preventDefault();
        if (!this.props.paused) {
            this.props.vm.pause();
            return;
        }
        this.props.vm.play();
    }
    handleStopAllClick (e) {
        e.preventDefault();
        this.props.vm.stopAll();
    }
    render () {
        const {
            vm, // eslint-disable-line no-unused-vars
            isStarted, // eslint-disable-line no-unused-vars
            projectRunning,
            paused,
            turbo,
            ...props
        } = this.props;
        return (
            <ControlsComponent
                {...props}
                active={projectRunning && isStarted}
                paused={paused}
                turbo={turbo}
                onGreenFlagClick={this.handleGreenFlagClick}
                onPauseButtonClick={this.handlePauseButtonClick}
                onStopAllClick={this.handleStopAllClick}
                onPlayersClick={this.state.playersAvailable ? this.handlePlayersClick : null}
                playersCount={this.state.playerWindows}
            />
        );
    }
}

Controls.propTypes = {
    isStarted: PropTypes.bool.isRequired,
    projectRunning: PropTypes.bool.isRequired,
    turbo: PropTypes.bool.isRequired,
    framerate: PropTypes.number.isRequired,
    interpolation: PropTypes.bool.isRequired,
    isSmall: PropTypes.bool,
    paused: PropTypes.bool,
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = state => ({
    isStarted: state.scratchGui.vmStatus.started,
    projectRunning: state.scratchGui.vmStatus.running,
    framerate: state.scratchGui.tw.framerate,
    interpolation: state.scratchGui.tw.interpolation,
    turbo: state.scratchGui.vmStatus.turbo,
    paused: state.scratchGui.vmStatus.paused
});
// no-op function to prevent dispatch prop being passed to component
const mapDispatchToProps = () => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Controls);
