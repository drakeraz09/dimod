
(function () {
    const IncrediboxMods = function (runtimeHost) {
        this.runtimeHost = runtimeHost;
    };

    IncrediboxMods.prototype.getInfo = function () {
        return {
            id: 'incrediboxMods',
            name: 'Incredibox Mods',
            color1: '#FF6680',

            blocks: [
                {
                    opcode: 'ready',
                    blockType: Scratch.BlockType.BOOLEAN,
                    text: 'mod loader ready?'
                }
            ],

            blockspace: {
                api: ({vm}) => ({
                    loadMod: async bytes => {
                        const runtime = vm.runtime;
                        const before = new Set(runtime.targets.map(t => t.id));
                        await vm.addSprite(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
                        const added = runtime.targets.find(t => !before.has(t.id) && !t.isStage);
                        if (!added) throw new Error('incrediboxMods.loadMod: no sprite target appeared after addSprite');
                        return {name: added.getName(), id: added.id};
                    },

                    unloadMod: id => {
                        const runtime = vm.runtime;
                        const target = runtime.targets.find(t => t.id === id || t.getName() === id);
                        if (!target) return false;
                        vm.deleteSprite(target.id);
                        return true;
                    },

                    animationNames: id => {
                        const runtime = vm.runtime;
                        const target = runtime.targets.find(t => t.id === id || t.getName() === id);
                        const anims = target && target.sprite && target.sprite.dimodAnimations;
                        if (!anims) return [];
                        return Array.isArray(anims) ? anims.map(a => a.name) : Object.keys(anims);
                    },

                    copyCostumeSkin: (sourceId, targetId, costumeIndex) => {
                        const runtime = vm.runtime;
                        const findTarget = ref => runtime.targets.find(t => t.id === ref || t.getName() === ref);
                        const source = findTarget(sourceId);
                        const dest = findTarget(targetId);
                        if (!source || !dest) throw new Error('incrediboxMods.copyCostumeSkin: source or target sprite not found');
                        const index = typeof costumeIndex === 'number' ? costumeIndex : source.currentCostume;
                        const costume = source.sprite.costumes_[index];
                        if (!costume) throw new Error('incrediboxMods.copyCostumeSkin: source has no costume at that index');
                        runtime.renderer.updateDrawableSkinId(dest.drawableID, costume.skinId);
                        return true;
                    }
                }),
                types: 'loadMod(bytes: Uint8Array | ArrayBuffer): Promise<{name: string; id: string}>;\n' +
                    '        unloadMod(id: string): boolean;\n' +
                    '        animationNames(id: string): string[];\n' +
                    '        copyCostumeSkin(sourceId: string, targetId: string, costumeIndex?: number): boolean;'
            }
        };
    };

    IncrediboxMods.prototype.ready = function () {
        return true;
    };

    Scratch.extensions.register(new IncrediboxMods());
})();
