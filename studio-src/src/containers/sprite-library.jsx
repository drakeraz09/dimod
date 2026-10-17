import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {injectIntl, intlShape, defineMessages} from 'react-intl';
import VM from 'scratch-vm';

import {getSpriteLibrary} from '../lib/libraries/tw-async-libraries';
import randomizeSpritePosition from '../lib/randomize-sprite-position';
import spriteTags from '../lib/libraries/sprite-tags';

import LibraryComponent from '../components/library/library.jsx';
import {assetBrowser, addDimodLibraryEntry} from '../lib/dimod-assets';
import {showErrorToast} from '../lib/dimod-ui';
import {uploadTab} from '../components/library/library-upload.jsx';

const messages = defineMessages({
    libraryTitle: {
        defaultMessage: 'Choose a Sprite',
        description: 'Heading for the sprite library',
        id: 'gui.spriteLibrary.chooseASprite'
    },
    libraryHeader: {
        defaultMessage: 'Sprites',
        description: 'Header for the sprite picker',
        id: 'pm.costumeLibrary.spritesHeader'
    }
});

class SpriteLibrary extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleItemSelect'
        ]);
        this.browser = assetBrowser('sprite');
    }
    handleItemSelect (item) {
        if (item.dimodLibraryId) {
            return addDimodLibraryEntry(this.props.vm, 'sprite', item)
                .then(() => this.props.onActivateBlocksTab(), err => showErrorToast(err, 'Library'));
        }
        if (item.fromDimodLibrary && item.spriteFileUrl) {
            return fetch(item.spriteFileUrl)
                .then(res => res.arrayBuffer())
                .then(buffer => this.props.vm.addSprite(buffer))
                .then(() => this.props.onActivateBlocksTab());
        }
        // Randomize position of library sprite
        randomizeSpritePosition(item);
        this.props.vm.addSprite(JSON.stringify(item)).then(() => this.props.onActivateBlocksTab());
    }
    render () {
        return (
            <LibraryComponent
                browser={this.browser}
                extraTabs={[uploadTab({kind: 'sprite', vm: this.props.vm, suggestedTags: spriteTags.map(t => t.tag).filter(t => t && t !== 'penguinmod')})]}
                data={getSpriteLibrary()}
                id="spriteLibrary"
                header={this.props.intl.formatMessage(messages.libraryHeader)}
                tags={spriteTags}
                title={this.props.intl.formatMessage(messages.libraryTitle)}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

SpriteLibrary.propTypes = {
    intl: intlShape.isRequired,
    onActivateBlocksTab: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default injectIntl(SpriteLibrary);
