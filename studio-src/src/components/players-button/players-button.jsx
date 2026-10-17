import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import playersIcon from '../stage-header/stagecontrols/players.svg';
import styles from './players-button.css';

const PlayersButtonComponent = function (props) {
    const {
        count,
        className,
        onClick,
        title,
        ...componentProps
    } = props;
    return (
        <span className={styles.playersWrap}>
            <img
                className={classNames(
                    className,
                    styles.playersBtn
                )}
                draggable={false}
                src={playersIcon}
                title={title}
                onClick={onClick}
                {...componentProps}
            />
            {count > 0 ? <span className={styles.playersCount}>{count + 1}</span> : null}
        </span>
    );
};
PlayersButtonComponent.propTypes = {
    className: PropTypes.string,
    count: PropTypes.number,
    onClick: PropTypes.func.isRequired,
    title: PropTypes.string
};
PlayersButtonComponent.defaultProps = {
    count: 0,
    title: 'Open another player'
};
export default PlayersButtonComponent;
