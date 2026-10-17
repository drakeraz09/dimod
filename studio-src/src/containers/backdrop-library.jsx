import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import VM from 'scratch-vm';

import {getBackdropLibrary} from '../lib/libraries/tw-async-libraries';
import backdropTags from '../lib/libraries/backdrop-tags';
import LibraryComponent from '../components/library/library.jsx';
import {assetBrowser, addDimodLibraryEntry} from '../lib/dimod-assets';
import {showErrorToast} from '../lib/dimod-ui';
import {uploadTab} from '../components/library/library-upload.jsx';
import {broadcastCostumeAdd} from '../lib/dimod-collab';

const messages = defineMessages({
    libraryTitle: {
        defaultMessage: 'Choose a Backdrop',
        description: 'Heading for the backdrop library',
        id: 'gui.costumeLibrary.chooseABackdrop'
    },
    libraryHeader: {
        defaultMessage: 'Backdrops',
        description: 'Header for the backdrop asset picker',
        id: 'pm.costumeLibrary.backdropsHeader'
    }
});


class BackdropLibrary extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleItemSelect'
        ]);
        this.browser = assetBrowser('backdrop');
    }
    handleItemSelect (item) {
        if (item.dimodLibraryId) {
            return addDimodLibraryEntry(this.props.vm, 'backdrop', item).catch(err => showErrorToast(err, 'Library'));
        }
        const vmBackdrop = {
            name: item.name,
            rotationCenterX: item.rotationCenterX,
            rotationCenterY: item.rotationCenterY,
            bitmapResolution: item.bitmapResolution,
            skinId: null
        };
        if (item.fromPenguinModLibrary) {
            vmBackdrop.fromPenguinModLibrary = true;
            vmBackdrop.libraryId = item.libraryFilePage;
            vmBackdrop.dataFormat = item.dataFormat;
        }
        // Do not switch to stage, just add the backdrop
        const stage = this.props.vm.runtime.getTargetForStage();
        this.props.vm.addBackdrop(item.md5ext, vmBackdrop).then(() => {
            if (stage) broadcastCostumeAdd(this.props.vm, stage.id);
        });
    }
    render () {
        return (
            <LibraryComponent
                browser={this.browser}
                extraTabs={[uploadTab({kind: 'backdrop', vm: this.props.vm, suggestedTags: backdropTags.map(t => t.tag).filter(t => t && t !== 'penguinmod')})]}
                data={getBackdropLibrary()}
                id="backdropLibrary"
                actor="CostumeLibrary"
                header={this.props.intl.formatMessage(messages.libraryHeader)}
                tags={backdropTags}
                title={this.props.intl.formatMessage(messages.libraryTitle)}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

BackdropLibrary.propTypes = {
    intl: intlShape.isRequired,
    onRequestClose: PropTypes.func,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default injectIntl(BackdropLibrary);
