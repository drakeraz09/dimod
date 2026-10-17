import ScratchStorage from "scratch-storage";

import defaultProject from "./default-project";
import missingProject from "./tw-missing-project";

/**
 * Wrapper for ScratchStorage which adds default web sources.
 * @todo make this more configurable
 */
class Storage extends ScratchStorage {
    constructor() {
        super();
        this.cacheDefaultProject();
    }
    addOfficialScratchWebStores() {
        const die = () => {
            throw new Error("Cannot use this web store like that!!!");
        };

        this.addWebStore(
            [this.AssetType.Project],
            this.getProjectGetConfig.bind(this),
            die,
            die,
        );
        this.addWebStore(
            [
                this.AssetType.ImageVector,
                this.AssetType.ImageBitmap,
                this.AssetType.Sound,
                this.AssetType.Font,
            ],
            this.getAssetGetConfig.bind(this),
            // We set both the create and update configs to the same method because
            // storage assumes it should update if there is an assetId, but the
            // asset store uses the assetId as part of the create URI.
            die,
            die,
        );
        this.addWebStore(
            [
                this.AssetType.ImageVector,
                this.AssetType.ImageBitmap,
                this.AssetType.Sound,
            ],
            this.getScratchAssetGetConfig.bind(this),
            die,
            die,
        );
        this.addWebStore(
            [
                this.AssetType.ImageVector,
                this.AssetType.ImageBitmap,
                this.AssetType.Sound,
                this.AssetType.Font,
            ],
            this.getAssetBackupGetConfig.bind(this),
            die,
            die,
        );
    }
    setProjectHost(projectHost) {
        this.projectHost = projectHost;
    }
    setProjectToken(projectToken) {
        this.projectToken = projectToken;
    }
    setProjectID(projectId) {
        this.projectId = projectId;
    }
    getProjectGetConfig(projectAsset) {
        // projectHost ends in "projectID", so we add the equals
        return `${this.projectHost}=${projectAsset.assetId}`;
    }
    setAssetHost(assetHost) {
        this.assetHost = assetHost;
    }
    getAssetGetConfig(asset) {
        if (!this.projectId) {
            return `https://assets.scratch.mit.edu/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`;
        }

        return `${this.assetHost}/${this.projectId}_${asset.assetId}.${asset.dataFormat}`;
    }
    getAssetBackupGetConfig(asset) {
        if (!this.projectId) {
            return `https://assets.scratch.mit.edu/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`;
        }

        return `https://projects.penguinmod.com/api/v1/projects/backupassetget?asset_name=${this.projectId}_${asset.assetId}.${asset.dataFormat}`;
    }
    getScratchAssetGetConfig(asset) {
        return `https://assets.scratch.mit.edu/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`;
    }
    setTranslatorFunction(translator) {
        this.translator = translator;
        this.cacheDefaultProject();
    }
    cacheDefaultProject() {
        const defaultProjectAssets = defaultProject(this.translator);
        defaultProjectAssets.forEach((asset) =>
            this.builtinHelper._store(
                this.AssetType[asset.assetType],
                this.DataFormat[asset.dataFormat],
                asset.data,
                asset.id,
            ),
        );
        const missingProjectAssets = missingProject(this.translator);
        missingProjectAssets.forEach((asset) =>
            this.builtinHelper._store(
                this.AssetType[asset.assetType],
                this.DataFormat[asset.dataFormat],
                asset.data,
                asset.id,
            ),
        );
    }
}

const storage = new Storage();

export default storage;
