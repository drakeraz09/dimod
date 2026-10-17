const DIMOD_ADDON_DEFAULTS = {'editor-theme3': {text: 'black'}, 'onion-skinning': {default: false}};
const DIMOD_ADDONS_ENABLED_BY_DEFAULT = ['editor-theme3', 'remove-sprite-confirm'];
const applyDimodAddonDefaults = manifests => {
    for (const [addonId, overrides] of Object.entries(DIMOD_ADDON_DEFAULTS)) {
        const manifest = manifests[addonId];
        if (!manifest || !manifest.settings) { continue; }
        for (const setting of manifest.settings) {
            if (Object.prototype.hasOwnProperty.call(overrides, setting.id)) { setting.default = overrides[setting.id]; }
        }
    }
    for (const addonId of DIMOD_ADDONS_ENABLED_BY_DEFAULT) {
        const manifest = manifests[addonId];
        if (!manifest) continue;
        manifest.enabledByDefault = true;
    }
    return manifests;
};
export {DIMOD_ADDON_DEFAULTS, DIMOD_ADDONS_ENABLED_BY_DEFAULT, applyDimodAddonDefaults as default};
