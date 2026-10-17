import React from 'react';
import PropTypes from 'prop-types';
import styles from './drag-layer.css';

/* eslint no-confusing-arrow: ["error", {"allowParens": true}] */
const DragLayer = ({dragging, img, imgs, currentOffset}) => (dragging ? (
    <div className={styles.dragLayer}>
        <div
            className={styles.imageWrapper}
            style={{
                transform: `translate(${currentOffset.x}px, ${currentOffset.y}px)`
            }}
        >
            {imgs && imgs.length > 1 ? (
                <div style={{position: 'relative'}}>
                    {imgs.slice(0, 4).reverse().map((src, i, arr) => (
                        <img
                            key={src + i}
                            className={styles.image}
                            src={src}
                            style={{
                                position: i === arr.length - 1 ? 'relative' : 'absolute',
                                left: (arr.length - 1 - i) * 7, top: (arr.length - 1 - i) * 7,
                                opacity: i === arr.length - 1 ? 1 : 0.85
                            }}
                        />
                    ))}
                    <span
                        style={{
                            position: 'absolute', top: -14, right: -14, zIndex: 2, minWidth: 22, height: 22,
                            borderRadius: 11, background: '#ff8c1a', color: '#fff', fontSize: 12, lineHeight: '22px',
                            textAlign: 'center', fontWeight: 'bold', padding: '0 4px'
                        }}
                    >{imgs.length}</span>
                </div>
            ) : (
                <img
                    className={styles.image}
                    src={img}
                />
            )}
        </div>
    </div>
) : null);

DragLayer.propTypes = {
    currentOffset: PropTypes.shape({
        x: PropTypes.number.isRequired,
        y: PropTypes.number.isRequired
    }),
    dragging: PropTypes.bool.isRequired,
    img: PropTypes.string,
    imgs: PropTypes.arrayOf(PropTypes.string)
};

export default DragLayer;
