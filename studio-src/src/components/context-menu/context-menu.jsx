import React from 'react';
import ReactDOM from 'react-dom';
import {ContextMenu, MenuItem} from 'react-contextmenu';
import classNames from 'classnames';

import styles from './context-menu.css';

const StyledContextMenu = props => {
    const menu = (
        <ContextMenu
            {...props}
            className={styles.contextMenu}
        />
    );
    return typeof document === 'undefined' ? menu : ReactDOM.createPortal(menu, document.body);
};

const StyledMenuItem = props => (
    <MenuItem
        {...props}
        attributes={{className: styles.menuItem}}
    />
);

const BorderedMenuItem = props => (
    <MenuItem
        {...props}
        attributes={{className: classNames(styles.menuItem, styles.menuItemBordered)}}
    />
);

const DangerousMenuItem = props => (
    <MenuItem
        {...props}
        attributes={{className: classNames(styles.menuItem, styles.menuItemBordered, styles.menuItemDanger)}}
    />
);


export {
    BorderedMenuItem,
    DangerousMenuItem,
    StyledContextMenu as ContextMenu,
    StyledMenuItem as MenuItem
};
