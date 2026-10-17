import {installTileMapsVM} from './dimod-tilemaps.js';
import {installBasicParticlesVM} from './dimod-particles.js';
import {
    patchParseProjectOptionsGuard,
    patchMonitorsBeforeTargets,
    patchSpriteLookup,
    patchExtensionStorageRoundTrip,
    patchMissingStage,
    patchSafeStop,
    patchBlockGraphIntegrity,
    patchExtensionProxy
} from './dimod-vm';
import {installExtraBlocksVM, installMediaEffectsVM} from './dimod-block-defs';
import {installAnimationVM} from './dimod-animation/runtime';
import {installBlockSpaceBlocksVM, installBlockspaceRuntime} from './block-space/runtime';
import {installScenesVM} from './dimod-scenes';
export const installDimodPlayerRuntime = vm => {
    patchMissingStage(vm);
    patchSafeStop(vm);
    patchParseProjectOptionsGuard(vm);
    patchMonitorsBeforeTargets(vm);
    patchSpriteLookup(vm);
    patchExtensionStorageRoundTrip(vm);
    patchBlockGraphIntegrity(vm);
    patchExtensionProxy(vm);
    installExtraBlocksVM(vm);
    installMediaEffectsVM(vm);
    installAnimationVM(vm);
    installBasicParticlesVM(vm);
    installTileMapsVM(vm);
    installBlockSpaceBlocksVM(vm);
    installBlockspaceRuntime(vm);
    installScenesVM(vm, {flagToMain: true});
};
export default installDimodPlayerRuntime;
