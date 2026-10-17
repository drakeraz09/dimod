

const CHARACTER_ROLES = Object.freeze({idle: 'character.idle', hover: 'character.hover'});
const CHROME_ROLES = Object.freeze([
    'chrome.timer', 'chrome.bar',
    'chrome.tray.button.idle', 'chrome.tray.button.hover',
    'chrome.polo.empty.idle', 'chrome.polo.empty.hover',
    'chrome.icon.idle', 'chrome.icon.hover',
    'chrome.titleMenu', 'chrome.settingsMenu'
]);


const QUADRANTS = Object.freeze({
    beat: {dir: -1, bar: 'top'},
    effect: {dir: 1, bar: 'top'},
    melody: {dir: -1, bar: 'bottom'},
    voice: {dir: 1, bar: 'bottom'}
});

class Layout {
    constructor ({centerX = 0, topY = 60, bottomY = -60, startGap = 60, step = 90} = {}) {
        this.centerX = centerX;
        this.topY = topY;
        this.bottomY = bottomY;
        this.startGap = startGap;
        this.step = step;
    }

    place (polos) {
        const byQuadrant = new Map();
        for (const polo of polos) {
            const list = byQuadrant.get(polo.category) || [];
            list.push(polo);
            byQuadrant.set(polo.category, list);
        }
        const positions = new Map();
        for (const [category, list] of byQuadrant) {
            const q = QUADRANTS[category];
            if (!q) throw new Error(`Layout: unknown category "${category}"`);
            list.sort((a, b) => a.order - b.order);
            const y = q.bar === 'top' ? this.topY : this.bottomY;
            list.forEach((polo, i) => {
                const distance = this.startGap + i * this.step;
                positions.set(polo, {x: this.centerX + q.dir * distance, y});
            });
        }
        return positions;
    }
}


class Theme {
    constructor (world) {
        this.world = world;
        this._stacks = new Map();
        for (const role of [...CHROME_ROLES]) this._stacks.set(role, []);
    }

    push (role, modId, targetName) {
        if (!this._stacks.has(role)) this._stacks.set(role, []);
        this._stacks.get(role).push({modId, targetName});
    }

    remove (modId) {
        for (const stack of this._stacks.values()) {
            const idx = stack.findIndex(e => e.modId === modId);
            if (idx !== -1) stack.splice(idx, 1);
        }
    }

    current (role) {
        const stack = this._stacks.get(role);
        return stack && stack.length ? stack[stack.length - 1].targetName : null;
    }

    play (ownTarget, role, ownAnimName, opts) {
        const providerName = this.current(role);
        const anim = providerName ?
            this.world.animation(`${providerName}/${role}`) :
            this.world.animation(`${ownTarget.name}/${ownAnimName}`);
        if (!anim) return null;
        return anim;
    }
}


class Character {
    constructor ({modId, target, category, order, icon}) {
        this.modId = modId;
        this.target = target;
        this.category = category;
        this.order = order;
        this.icon = icon;
        this.polo = null;
    }

    async playIdle () {
        const anim = this.target.animation(CHARACTER_ROLES.idle);
        if (anim) await this.target.animator.play(anim, {mode: 'loop'});
    }

    async playHover () {
        const anim = this.target.animation(CHARACTER_ROLES.hover);
        if (anim) await this.target.animator.crossfade(anim, 0.15);
    }
}


class Polo {
    constructor ({category, order, sprite, theme}) {
        this.category = category;
        this.order = order;
        this.sprite = sprite;
        this.theme = theme;
        this.occupant = null;
        this.queuedReplacement = null;
        this.position = {x: 0, y: 0};
    }

    setPosition ({x, y}) {
        this.position = {x, y};
        this.sprite.x = x;
        this.sprite.y = y;
        if (this.occupant) {
            this.occupant.target.x = x;
            this.occupant.target.y = y;
        }
    }

    async showEmpty () {
        this.sprite.visible = true;
        const anim = this.theme.play(this.sprite, 'chrome.polo.empty.idle', 'idle');
        if (anim) await this.sprite.animator.play(anim, {mode: 'loop'});
    }

    async assign (character) {
        this.occupant = character;
        character.polo = this;
        this.sprite.visible = false;
        character.target.visible = true;
        character.target.x = this.position.x;
        character.target.y = this.position.y;
        await character.playIdle();
    }

    async unassign () {
        if (!this.occupant) return;
        const outgoing = this.occupant;
        outgoing.polo = null;
        this.occupant = null;
        outgoing.target.visible = false;
        await this.showEmpty();
    }

    async queueReplacement (character) {
        if (this.occupant) await this.unassign();
        await this.assign(character);
    }
}


class ModLoader {
    constructor ({world, mods, theme, onCharacterLoaded}) {
        this.world = world;
        this.mods = mods;
        this.theme = theme;
        this.onCharacterLoaded = onCharacterLoaded;
        this._byModId = new Map();
    }

    async load (bytes, meta = {}) {
        const {id, name} = await this.mods.loadMod(bytes);
        const names = await this.mods.animationNames(id);
        const roles = names.filter(n => CHROME_ROLES.includes(n) ||
            n === CHARACTER_ROLES.idle || n === CHARACTER_ROLES.hover);

        for (const role of roles) {
            if (role === CHARACTER_ROLES.idle || role === CHARACTER_ROLES.hover) continue;
            this.theme.push(role, id, name);
        }

        let character = null;
        if (roles.includes(CHARACTER_ROLES.idle)) {
            if (!meta.category || !QUADRANTS[meta.category]) {
                throw new Error(`ModLoader: "${name}" declares character.idle but no valid category was given`);
            }
            const target = this.world.getTarget(name);
            const icon = await this._makeIcon(name);
            character = new Character({
                modId: id, target, category: meta.category, order: meta.order || 1, icon
            });
            if (this.onCharacterLoaded) await this.onCharacterLoaded(character);
        }

        this._byModId.set(id, {roles, character});
        return {id, name, roles, character};
    }

    async unload (modId, {onCharacterRemoved} = {}) {
        const entry = this._byModId.get(modId);
        if (!entry) return false;
        this.theme.remove(modId);
        if (entry.character) {
            if (entry.character.polo) await entry.character.polo.unassign();
            if (entry.character.icon) entry.character.icon.delete();
            if (onCharacterRemoved) await onCharacterRemoved(entry.character);
        }
        await this.mods.unloadMod(modId);
        this._byModId.delete(modId);
        return true;
    }

    async _makeIcon (characterName) {
        const template = this.world.getTarget('IconTemplate');
        const clone = template.clone();
        if (!clone) throw new Error('ModLoader: hit the clone limit making an icon');
        await this.mods.copyCostumeSkin(characterName, clone.id);
        return clone;
    }
}


class IconBar {
    constructor ({world, y = -150, startX = -200, step = 60}) {
        this.world = world;
        this.y = y;
        this.startX = startX;
        this.step = step;
        this.icons = [];
    }

    add (character) {
        this.icons.push(character);
        this._relayout();
    }

    remove (character) {
        const i = this.icons.indexOf(character);
        if (i !== -1) this.icons.splice(i, 1);
        this._relayout();
    }

    _relayout () {
        const order = ['beat', 'effect', 'melody', 'voice'];
        const sorted = [...this.icons].sort((a, b) =>
            order.indexOf(a.category) - order.indexOf(b.category) || a.order - b.order);
        sorted.forEach((character, i) => {
            character.icon.x = this.startX + i * this.step;
            character.icon.y = this.y;
        });
    }
}


class DragController {
    constructor ({world, polos}) {
        this.world = world;
        this.polos = polos;
        this._dragging = null;
        this._dragStart = null;
    }

    async run () {
        for await (const _ of frames()) { // eslint-disable-line no-unused-vars
            const down = this.world.mouse.down;
            if (!this._dragging && down) {
                const hit = this._iconUnderMouse();
                if (hit) {
                    this._dragging = hit;
                    this._dragStart = {x: hit.icon.x, y: hit.icon.y};
                }
            } else if (this._dragging && down) {
                this._dragging.icon.x = this.world.mouse.x;
                this._dragging.icon.y = this.world.mouse.y;
            } else if (this._dragging && !down) {
                await this._drop(this._dragging);
                this._dragging = null;
                this._dragStart = null;
            }
        }
    }

    _iconUnderMouse () {
        for (const character of this._allCharacters()) {
            if (character.icon.touching('mouse')) return character;
        }
        return null;
    }

    _allCharacters () {
        return this.polos.map(p => p.occupant).filter(Boolean)
            .concat(this._draggableUnassigned || []);
    }

    async _drop (character) {
        const target = this.polos.find(p => p.sprite.touching('mouse') ||
            (p.occupant && p.occupant.target.touching('mouse')));
        if (target && target.category === character.category) {
            await target.queueReplacement(character);
        } else {
            character.icon.x = this._dragStart.x;
            character.icon.y = this._dragStart.y;
        }
    }
}


(async () => {
    const theme = new Theme(world);
    const layout = new Layout();
    const iconBar = new IconBar({world});

    const polos = [];
    for (const [category, order] of [
        ['beat', 1], ['beat', 2],
        ['effect', 1], ['effect', 2],
        ['melody', 1], ['melody', 2],
        ['voice', 1]
    ]) {
        const sprite = world.getTarget('PoloTemplate').clone();
        polos.push(new Polo({category, order, sprite, theme}));
    }
    const positions = layout.place(polos);
    for (const polo of polos) {
        polo.setPosition(positions.get(polo));
        await polo.showEmpty();
    }

    const mods = world.extensions.incrediboxMods;
    const loader = new ModLoader({
        world,
        mods,
        theme,
        onCharacterLoaded: async character => {
            iconBar.add(character);
            character.icon.visible = true;
            const anim = theme.play(character.icon, 'chrome.icon.idle', 'idle');
            if (anim) await character.icon.animator.play(anim, {mode: 'loop'});
        }
    });

    world.hold({incrediboxLoader: loader, incrediboxPolos: polos, incrediboxTheme: theme});

    const drag = new DragController({world, polos});
    await drag.run();
})();
