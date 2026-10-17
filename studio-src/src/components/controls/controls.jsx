import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import GreenFlag from '../green-flag/green-flag.jsx';
import PauseButton from '../pause-button/pause-button.jsx';
import PlayersButton from '../players-button/players-button.jsx';
import StopAll from '../stop-all/stop-all.jsx';
import TurboMode from '../turbo-mode/turbo-mode.jsx';
import FramerateIndicator from '../tw-framerate-indicator/framerate-indicator.jsx';

import styles from './controls.css';

const dimodParams = typeof URLSearchParams === 'undefined' ? null : new URLSearchParams(location.search);
const dimodShow = key => {
    if (!dimodParams || !dimodParams.has('dimod_id')) return true;
    return dimodParams.get(key) === '1';
};

const messages = defineMessages({
    goTitle: {
        id: 'gui.controls.go',
        defaultMessage: 'Go',
        description: 'Green flag button title'
    },
    pauseTitle: {
        id: 'pm.controls.pause',
        defaultMessage: 'Pause',
        description: 'Pause button title'
    },
    stopTitle: {
        id: 'gui.controls.stop',
        defaultMessage: 'Stop',
        description: 'Stop button title'
    }
});

const Controls = function (props) {
    const {
        active,
        paused,
        className,
        intl,
        onGreenFlagClick,
        onPauseButtonClick,
        onStopAllClick,
        onPlayersClick,
        playersCount,
        turbo,
        framerate,
        interpolation,
        isSmall,
        ...componentProps
    } = props;
    return (
        <div
            className={classNames(styles.controlsContainer, className)}
            {...componentProps}
        >
            {dimodShow('dimod_show_greenflag') ? (
                <GreenFlag
                    active={active}
                    title={intl.formatMessage(messages.goTitle)}
                    onClick={onGreenFlagClick}
                />
            ) : null}
            {dimodShow('dimod_show_pause') ? (
                <PauseButton
                    paused={paused}
                    title={intl.formatMessage(messages.pauseTitle)}
                    onClick={onPauseButtonClick}
                />
            ) : null}
            {dimodShow('dimod_show_stopall') ? (
                <StopAll
                    active={active}
                    title={intl.formatMessage(messages.stopTitle)}
                    onClick={onStopAllClick}
                />
            ) : null}
            {onPlayersClick ? (
                <PlayersButton
                    count={playersCount}
                    title={playersCount > 0 ?
                        'Open another player (shift+click: send every player window the latest project)' :
                        'Open another player in a new window, to test multiplayer'}
                    onClick={onPlayersClick}
                />
            ) : null}
            {turbo ? (
                <TurboMode isSmall={isSmall} />
            ) : null}
            {!isSmall && (
                <FramerateIndicator
                    framerate={framerate}
                    interpolation={interpolation}
                />
            )}
        </div>
    );
};

Controls.propTypes = {
    active: PropTypes.bool,
    paused: PropTypes.bool,
    className: PropTypes.string,
    intl: intlShape.isRequired,
    onGreenFlagClick: PropTypes.func.isRequired,
    onPauseButtonClick: PropTypes.func.isRequired,
    onStopAllClick: PropTypes.func.isRequired,
    onPlayersClick: PropTypes.func,
    playersCount: PropTypes.number,
    framerate: PropTypes.number,
    interpolation: PropTypes.bool,
    isSmall: PropTypes.bool,
    turbo: PropTypes.bool
};

Controls.defaultProps = {
    active: false,
    turbo: false,
    isSmall: false
};

export default injectIntl(Controls);
