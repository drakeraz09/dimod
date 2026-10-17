import React from 'react';

import Box from '../box/box.jsx';
import Selector from './selector.jsx';
import styles from './asset-panel.css';
import PropTypes from 'prop-types';

const collapsedKey = kind => `dimod.assetList.collapsed.${kind || 'assets'}`;
const readCollapsed = kind => {
    try {
        return localStorage.getItem(collapsedKey(kind)) === '1';
    } catch (e) {
        return false;
    }
};

const AssetPanel = ({dimodAssetKind, collapsible, ...props}) => {
    const [collapsed, setCollapsed] = React.useState(() => Boolean(collapsible) && readCollapsed(dimodAssetKind));
    const toggle = React.useCallback(() => {
        setCollapsed(was => {
            try {
                localStorage.setItem(collapsedKey(dimodAssetKind), was ? '0' : '1');
            } catch (e) {
            }
            return !was;
        });
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }, [dimodAssetKind]);
    const isCollapsed = collapsible && collapsed;
    return (
        <Box
            className={styles.wrapper}
            data-dimod-asset-kind={dimodAssetKind}
            data-dimod-list-collapsed={isCollapsed ? 'true' : null}
            style={{position: 'relative'}}
        >
            <Selector
                className={styles.selector}
                {...props}
            />
            {collapsible ? (
                <button
                    className={styles.collapseStrip}
                    title={isCollapsed ? 'Show the list' : 'Hide the list'}
                    onClick={toggle}
                >
                    <svg
                        height="12"
                        viewBox="0 0 8 12"
                        width="8"
                    >
                        <path
                            d={isCollapsed ? 'M2 1l5 5-5 5' : 'M6 1L1 6l5 5'}
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.6"
                        />
                    </svg>
                </button>
            ) : null}
            <Box className={styles.detailArea}>
                {props.children}
            </Box>

        </Box>
    );
};

AssetPanel.propTypes = {
    ...Selector.propTypes,
    collapsible: PropTypes.bool,
    dimodAssetKind: PropTypes.string
};

export default AssetPanel;
