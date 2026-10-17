import VM from 'scratch-vm';
import Sprite from 'scratch-vm/src/sprites/sprite';
import sb3 from 'scratch-vm/src/serialization/sb3';
import {installBlockspaceRuntime, chainAt, liveValue} from '../../../src/lib/block-space/runtime';
import {
    projectTypes,
    installConsoleStore,
    logFor,
    unseenErrors,
    markSeen,
    blockspaceCategoryXML,
    valuesCategoryXML,
    setToolboxBlockspace
} from '../../../src/lib/block-space/editor';


const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const makeTarget = (runtime, name, isStage) => {
    const sprite = new Sprite(null, runtime);
    sprite.name = name;
    const target = sprite.createClone();
    target.isStage = Boolean(isStage);
    runtime.addTarget(target);
    return target;
};

const fakeClient = () => {
    const listeners = {relay: new Set(), join: new Set(), leave: new Set()};
    const client = {
        listeners,
        sent: [],
        connected: true,
        userClosed: false,
        player: {id: 'me', username: 'Me', loggedIn: true},
        roster: new Map([['me', {id: 'me', username: 'Me', loggedIn: true}]]),
        listen: (event, fn) => {
            listeners[event].add(fn);
            return () => listeners[event].delete(fn);
        },
        ensureConnected: () => {},
        relay: (channel, data, to) => {
            client.sent.push({channel, data: typeof data === 'string' ? JSON.parse(data) : data, to});
            return true;
        },
        arrive: (id, username) => {
            const player = {id, username, loggedIn: true};
            client.roster.set(id, player);
            listeners.join.forEach(fn => fn(player));
        },
        leave: id => {
            const player = client.roster.get(id);
            client.roster.delete(id);
            listeners.leave.forEach(fn => fn(player));
        },
        say: (from, channel, packet) => listeners.relay.forEach(fn => fn(channel, JSON.stringify(packet), from))
    };
    return client;
};

const setup = prepare => {
    const vm = new VM();
    if (prepare) prepare(vm);
    const host = installBlockspaceRuntime(vm);
    const stage = makeTarget(vm.runtime, 'Stage', true);
    const player = makeTarget(vm.runtime, 'Player', false);
    const logs = [];
    vm.on('DIMOD_BLOCKSPACE_LOG', entry => logs.push(entry));
    let now = 0;
    global.performance.now = () => now;
    const step = async (n = 1) => {
        for (let i = 0; i < n; i++) {
            now += 1000 / 30;
            vm.runtime._step();
            await flush();
        }
    };
    return {vm, host, stage, player, logs, step};
};

describe('Blockspace runtime', () => {
    test('complex sprite runs its code, `me` moves it, flag handlers fire', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            me.x = 10;
            world.on("flag", () => { me.y = 5; log("flag", me.name); });
        `);
        expect(player.x).toBe(10);
        vm.runtime.greenFlag();
        await step();
        expect(player.y).toBe(5);
        expect(logs.map(l => l.text)).toContain('flag Player');
    });

    test('wait() resumes on the frame clock; the stop sign cancels it silently', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", async () => {
                await wait(0.5);
                me.x = 100;
                await wait(10);
                me.x = 999;
            });
        `);
        vm.runtime.greenFlag();
        await step(5);
        expect(player.x).toBe(0);
        await step(12);
        expect(player.x).toBe(100);
        vm.runtime.stopAll();
        await step(3);
        expect(player.x).toBe(100);
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
    });

    test('frames() and world.forever() stop with the stop sign; world.on("tick") keeps going', async () => {
        const {vm, host, player, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            const state = me.hold({frames: 0, ticks: 0, loop: 0}, {reset: "never"});
            world.on("tick", () => state.ticks++);
            world.on("flag", async () => {
                world.forever(() => state.loop++);
                for await (const dt of frames()) state.frames++;
            });
        `);
        const held = host.holdStoreFor(player).values;
        vm.runtime.greenFlag();
        await step(4);
        expect(held.frames).toBeGreaterThanOrEqual(3);
        expect(held.loop).toBeGreaterThanOrEqual(3);
        vm.runtime.stopAll();
        const frozen = {frames: held.frames, loop: held.loop, ticks: held.ticks};
        await step(4);
        expect(held.frames).toBe(frozen.frames);
        expect(held.loop).toBe(frozen.loop);
        expect(held.ticks).toBeGreaterThan(frozen.ticks);
    });

    test('each clone runs its own copy with me = the clone; holds copy to clones', async () => {
        const {host, player, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            const state = me.hold({hp: 3});
            if (me.isClone) {
                me.x = 50;
                state.hp = 1;
            } else {
                state.hp = 7;
                me.clone();
            }
        `);
        await step();
        const clone = player.sprite.clones[1];
        expect(clone).toBeTruthy();
        expect(clone.x).toBe(50);
        expect(player.x).toBe(0);
        expect(host.parentOf(clone)).toBe(player);
        expect(host.holdStoreFor(player).values.hp).toBe(7);
        expect(host.holdStoreFor(clone).values.hp).toBe(1);
        expect(host.instances.get(clone).alive).toBe(true);
    });

    test('hot reload re-runs the code but keeps held values', async () => {
        const {host, player} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'const s = me.hold({n: 0}); s.n++;');
        host.setSource(player, 'const s = me.hold({n: 0}); s.n += 10;');
        expect(host.holdStoreFor(player).values.n).toBe(11);
    });

    test('reloading disposes the old copy: its handlers and waits are gone', async () => {
        const {vm, host, player, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'world.on("flag", () => { me.x += 1; });');
        host.setSource(player, 'world.on("flag", () => { me.x += 100; });');
        vm.runtime.greenFlag();
        await step();
        expect(player.x).toBe(100);
    });

    test('broadcasts reach JS with data; emit() is JS-only between sprites', async () => {
        const {vm, host, stage, player, step} = setup();
        const enemy = makeTarget(vm.runtime, 'Enemy', false);
        host.setComplex(enemy, true);
        host.setSource(enemy, `
            world.on("broadcast", "hit", amount => { me.x = amount; });
            world.on("hiii", n => { me.y = n; });
        `);
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", () => {
                world.broadcast("HIT", 42);
                world.emit("hiii", 123);
            });
        `);
        vm.runtime.greenFlag();
        await step();
        expect(enemy.x).toBe(42);
        expect(enemy.y).toBe(123);
        expect(stage).toBeTruthy();
    });

    test('variables and lists read and write through to Scratch', async () => {
        const {host, stage, player} = setup();
        stage.createVariable('v1', 'score', '');
        stage.createVariable('l1', 'items', 'list');
        host.setComplex(player, true);
        host.setSource(player, `
            world.vars.score = 5;
            me.vars.score += 1;
            me.lists.items.push("key");
            me.vars.declare("hp", 3);
        `);
        expect(stage.variables.v1.value).toBe(6);
        expect(stage.variables.l1.value).toEqual(['key']);
        expect(player.lookupVariableByNameAndType('hp', '', true).value).toBe(3);
    });

    test('errors report the user\'s line; making the sprite blocks stops the code', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'world.on("flag", () => { me.x = 1; });\n\nnope();\n');
        await flush();
        const error = logs.find(l => l.level === 'error');
        expect(error.text).toMatch(/nope/);
        expect(error.line).toBe(3);
        host.setComplex(player, false);
        vm.runtime.greenFlag();
        await step();
        expect(player.x).toBe(0);
        expect(host.getSource(player)).toMatch(/nope/);
    });

    test('complex state and code round-trip through project.json', () => {
        const {vm, host, player} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'me.x = 3;');
        const json = sb3.serialize(vm.runtime);
        const saved = json.targets.find(t => t.name === 'Player');
        expect(saved.extensionData.dimodBlockspace).toEqual({complex: true, source: 'me.x = 3;', owners: null});
        const single = sb3.serialize(vm.runtime, player.id);
        expect(single.extensionData.dimodBlockspace.source).toBe('me.x = 3;');
    });

    test('a saved complex sprite starts running when its project loads', async () => {
        const {vm, host} = setup();
        const sprite = new Sprite(null, vm.runtime);
        sprite.name = 'Loaded';
        const target = sprite.createClone();
        target.extensionData = {dimodBlockspace: {complex: true, source: 'me.x = world.getTarget("Player").name.length;'}};
        vm.runtime.addTarget(target);
        await flush();
        expect(host.isComplex(target)).toBe(true);
        expect(target.x).toBe(6);
    });

    test('clones deleted by the stop sign dispose their copy and fire "delete"', async () => {
        const {vm, host, player, stage, step} = setup();
        stage.createVariable('v1', 'deleted', '');
        host.setComplex(player, true);
        host.setSource(player, `
            if (me.isClone) me.on("delete", () => { world.vars.deleted += 1; });
            else world.on("flag", () => { me.clone(); me.clone(); });
        `);
        stage.variables.v1.value = 0;
        vm.runtime.greenFlag();
        await step();
        const clones = player.sprite.clones.slice(1);
        expect(clones.length).toBe(2);
        vm.runtime.stopAll();
        expect(stage.variables.v1.value).toBe(2);
        expect(clones.every(c => !host.instances.has(c))).toBe(true);
        expect(host.instances.get(player).alive).toBe(true);
    });

    test('a click fires me.on("click") once', () => {
        const {vm, host, player} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'me.on("click", () => { me.x += 1; });');
        vm.runtime.startHats('event_whenthisspriteclicked', null, player);
        vm.runtime.startHats('event_whenstageclicked', null, player);
        expect(player.x).toBe(1);
    });


    let builderCount = 0;
    const builder = container => {
        let n = 0;
        const prefix = `k${builderCount++}`;
        const make = (opcode, {inputs = {}, fields = {}, topLevel = false, shadow = false, mutation} = {}) => {
            const id = `${prefix}b${n++}_${opcode}`;
            const block = {id, opcode, next: null, parent: null, inputs: {}, fields: {}, shadow, topLevel, x: 0, y: 0};
            if (mutation) block.mutation = mutation;
            for (const name in fields) block.fields[name] = {name, value: fields[name]};
            container.createBlock(block);
            for (const name in inputs) {
                const child = inputs[name];
                container._blocks[child].parent = id;
                block.inputs[name] = {name, block: child, shadow: container._blocks[child].shadow ? child : null};
            }
            return id;
        };
        const num = value => make('math_number', {fields: {NUM: value}, shadow: true});
        const text = value => make('text', {fields: {TEXT: value}, shadow: true});
        const stack = (...ids) => {
            for (let i = 1; i < ids.length; i++) {
                container._blocks[ids[i - 1]].next = ids[i];
                container._blocks[ids[i]].parent = ids[i - 1];
            }
            container.resetCache();
            return ids[0];
        };
        return {make, num, text, stack};
    };

    const OP = {
        hat: 'event_dimod_blockspace_whencalled',
        arg: 'event_dimod_blockspace_argument',
        ret: 'event_dimod_blockspace_return',
        yld: 'event_dimod_blockspace_yield'
    };

    const spriteWithScripts = ({vm, player}) => {
        const {make, num, stack} = builder(player.blocks);
        const flag = stack(
            make('event_whenflagclicked', {topLevel: true}),
            make('motion_changexby', {inputs: {DX: num(7)}})
        );
        const sum = make('operator_add', {inputs: {
            NUM1: make(OP.arg, {fields: {NAME: 'a'}}),
            NUM2: make(OP.arg, {fields: {NAME: 'b'}})
        }});
        const addHat = stack(make(OP.hat, {topLevel: true}), make(OP.ret, {inputs: {VALUE: sum}}));
        player.sprite.dimod = {
            complex: false,
            source: 'const add = new Blockspace("add", {"params":["a","b"]});\n',
            owners: {[addHat]: 'add'}
        };
        vm.emitTargetsUpdate(false);
        return {flag, addHat};
    };

    for (const compiled of [true, false]) {
        const mode = compiled ? 'compiled' : 'interpreted';

        test(`making a sprite complex moves its scripts into blockspaces; they still run (${mode})`, async () => {
            const env = setup();
            const {vm, host, player, step} = env;
            vm.setCompilerOptions({enabled: compiled});
            spriteWithScripts(env);
            host.setComplex(player, true);
            const source = host.getSource(player);
            expect(source).toMatch(/new Blockspace\("main", \{/);
            expect(source).toMatch(/new Blockspace\("add", \{"params":\["a","b"\],"blocks":\{/);
            expect(host.spaces.entries(player.sprite).map(e => e.id).sort()).toEqual(['add', 'main']);
            vm.runtime.greenFlag();
            await step(2);
            expect(player.x).toBe(7);
        });

        test(`me.run passes parameters and resolves with return (${mode})`, async () => {
            const env = setup();
            const {vm, host, player, logs, step} = env;
            vm.setCompilerOptions({enabled: compiled});
            spriteWithScripts(env);
            host.setComplex(player, true);
            host.setSource(player, `${host.getSource(player)}
                world.on("flag", async () => {
                    const sum = await fromCast(me.run(add, 2, 3));
                    log("sum", sum);
                    const run = me.run(add, "4", 1);
                    const result = await run.done;
                    log(result.status, result.value);
                });`);
            vm.runtime.greenFlag();
            await step(4);
            expect(logs.filter(l => l.level === 'error')).toEqual([]);
            expect(logs.map(l => l.text)).toEqual(expect.arrayContaining(['sum 5', 'returned 5']));
        });
    }

    test('yield streams values; stop() ends a forever blockspace; running as another sprite', async () => {
        const env = setup();
        const {vm, host, player, logs, step} = env;
        const enemy = makeTarget(vm.runtime, 'Enemy', false);
        const {make, num, stack} = builder(player.blocks);
        const body = stack(
            make('motion_changexby', {inputs: {DX: num(10)}}),
            make(OP.yld, {inputs: {VALUE: make('motion_xposition')}}),
            make('control_wait', {inputs: {DURATION: num(0)}})
        );
        const forever = make('control_forever', {inputs: {SUBSTACK: body}});
        const hat = stack(make(OP.hat, {topLevel: true}), forever);
        player.sprite.dimod = {complex: false, source: 'const walk = new Blockspace("walk", {});\n', owners: {[hat]: 'walk'}};
        host.setComplex(player, true);
        host.setSource(player, `${host.getSource(player)}
            world.on("flag", async () => {
                const run = world.getTarget("Enemy").run(walk);
                const seen = [];
                for await (const x of run) {
                    seen.push(x);
                    if (seen.length === 3) run.stop();
                }
                log("seen", seen.join(","), (await run.done).status);
            });`);
        vm.runtime.greenFlag();
        await step(8);
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
        expect(logs.map(l => l.text)).toContain('seen 10,20,30 stopped');
        expect(player.x).toBe(0);
        expect(enemy.x).toBe(30);
    });

    test('the stop sign ends runs; awaiting one then rejects with Stopped, silently', async () => {
        const env = setup();
        const {vm, host, player, logs, step} = env;
        const {make, stack} = builder(player.blocks);
        const hat = stack(make(OP.hat, {topLevel: true}), make('control_forever', {inputs: {}}));
        player.sprite.dimod = {complex: false, source: 'const spin = new Blockspace("spin", {});\n', owners: {[hat]: 'spin'}};
        host.setComplex(player, true);
        host.setSource(player, `${host.getSource(player)}
            world.on("flag", async () => {
                const run = me.run(spin);
                run.done.then(r => log("done", r.status));
                await run;
                log("not reached");
            });`);
        vm.runtime.greenFlag();
        await step(3);
        vm.runtime.stopAll();
        await step(2);
        expect(logs.map(l => l.text)).toEqual(['done stopped']);
    });

    test('removing a blockspace from the code removes its blocks', async () => {
        const env = setup();
        const {vm, host, player, step} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        const withoutMain = host.getSource(player).split('\n')
            .filter(line => !line.startsWith('new Blockspace("main"'))
            .join('\n');
        host.setSource(player, withoutMain);
        expect(host.spaces.entries(player.sprite).map(e => e.id)).toEqual(['add']);
        vm.runtime.greenFlag();
        await step(2);
        expect(player.x).toBe(0);
        host.setSource(player, `throw new Error("oops");\n${withoutMain}`);
        expect(host.spaces.entries(player.sprite).map(e => e.id)).toEqual(['add']);
    });

    test('blocks -> complex -> blocks -> complex keeps every script where it was', async () => {
        const env = setup();
        const {vm, host, player, step} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        host.setComplex(player, false);
        const scriptCount = player.blocks.getScripts().length;
        const blockCount = Object.keys(player.blocks._blocks).length;
        host.setComplex(player, true);
        host.setComplex(player, false);
        expect(player.blocks.getScripts().length).toBe(scriptCount);
        expect(Object.keys(player.blocks._blocks).length).toBe(blockCount);
        vm.runtime.greenFlag();
        await step(2);
        expect(player.x).toBe(7);
        const {make, stack} = builder(player.blocks);
        stack(make('event_whenflagclicked', {topLevel: true}), make('motion_setx', {inputs: {X: make('math_number', {fields: {NUM: 100}, shadow: true})}}));
        host.setComplex(player, true);
        const main = host.spaces.entry(player.sprite, 'main');
        const add = host.spaces.entry(player.sprite, 'add');
        expect(main.topIds.length).toBe(2);
        expect(add.topIds.length).toBe(1);
        expect(add.params).toEqual(['a', 'b']);
    });

    test('blockspace blocks are saved in the code, not twice; a saved copy loads and runs', async () => {
        const env = setup();
        const {vm, host, player} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        const json = sb3.serialize(vm.runtime);
        const saved = json.targets.find(t => t.name === 'Player');
        expect(Object.keys(saved.blocks)).toEqual([]);

        const env2 = setup();
        const sprite = new Sprite(null, env2.vm.runtime);
        sprite.name = 'Copy';
        const target = sprite.createClone();
        target.extensionData = {dimodBlockspace: saved.extensionData.dimodBlockspace};
        env2.vm.runtime.addTarget(target);
        await flush();
        expect(env2.host.spaces.entries(sprite).map(e => e.id).sort()).toEqual(['add', 'main']);
        env2.vm.runtime.greenFlag();
        await env2.step(2);
        expect(target.x).toBe(7);
    });


    test('focused: the workspace shows only that blockspace; edits land in its payload', () => {
        const env = setup();
        const {vm, host, player} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        vm.editingTarget = player;
        const add = host.spaces.entry(player.sprite, 'add');
        const main = host.spaces.entry(player.sprite, 'main');

        let xml = null;
        vm.on('workspaceUpdate', data => {
            xml = data.xml;
        });
        expect(host.setFocus(player.id, 'add')).toBe(true);
        vm.emitWorkspaceUpdate();
        expect(xml).toContain(add.hatId);
        expect(xml).not.toContain(main.topIds[0]);

        const {make, num, stack} = builder(player.blocks);
        const extra = stack(make('event_whenkeypressed', {topLevel: true, fields: {KEY_OPTION: 'space'}}),
            make('motion_changeyby', {inputs: {DY: num(1)}}));
        host.flushFocus();
        expect(add.topIds).toContain(extra);
        expect(main.topIds).not.toContain(extra);
        const source = host.getSource(player);
        expect(source).toContain('event_whenkeypressed');

        const before = player.blocks._blocks[extra];
        host.setSource(player, source);
        expect(player.blocks._blocks[extra]).toBe(before);

        const saved = sb3.serialize(vm.runtime).targets.find(t => t.name === 'Player');
        expect(Object.keys(saved.blocks)).toEqual([]);
    });

    test('editing parameters rewrites the payload and relabels the hat', () => {
        const env = setup();
        const {vm, host, player} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        vm.editingTarget = player;
        host.setFocus(player.id, 'add');
        host.setFocusedParams(['a', ' b ', 'c', 'a', '']);
        const add = host.spaces.entry(player.sprite, 'add');
        expect(add.params).toEqual(['a', 'b', 'c']);
        const hat = player.blocks._blocks[add.hatId];
        expect(JSON.parse(hat.mutation.params)).toEqual(['a', 'b', 'c']);
        expect(['ARG0', 'ARG1', 'ARG2'].map(name => player.blocks._blocks[hat.inputs[name].shadow].fields.NAME.value))
            .toEqual(['a', 'b', 'c']);
        expect(hat.inputs.ARG3).toBe(undefined);
        expect(host.getSource(player)).toMatch(/new Blockspace\("add", \{"params":\["a","b","c"\]/);
    });

    test('making the sprite blocks while a blockspace is open closes it', () => {
        const env = setup();
        const {host, player} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        host.setFocus(player.id, 'main');
        host.setComplex(player, false);
        expect(host.focus).toBe(null);
    });


    test('me.block runs a command block as me; me.reporter resolves with a value', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", async () => {
                await me.block("motion_changexby", {DX: 25});
                const x = await me.reporter("motion_xposition");
                const sum = await fromCast(me.reporter("operator_add", {NUM1: 2, NUM2: "3"}));
                log("x", x, "sum", sum);
            });`);
        vm.runtime.greenFlag();
        await step(4);
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
        expect(player.x).toBe(25);
        expect(logs.map(l => l.text)).toContain('x 25 sum 5');
        expect(Object.keys(host.spaces._oneOffBlocks._blocks)).toEqual([]);
    });

    test('extension-only APIs explain what to add when the extension is missing', async () => {
        const {host, player, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'me.pen.down();');
        await flush();
        host.setSource(player, 'world.camera.x = 5;');
        await flush();
        host.setSource(player, 'me.ext("nope").thing();');
        await flush();
        const errors = logs.filter(l => l.level === 'error').map(l => l.text);
        expect(errors[0]).toMatch(/Pen extension/);
        expect(errors[1]).toMatch(/Camera extension/);
        expect(errors[2]).toMatch(/Extension "nope" isn't in this project/);
    });

    test('scripts dragged onto a complex sprite join "main"', async () => {
        const env = setup();
        const {vm, host, player} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        const main = host.spaces.entry(player.sprite, 'main');
        const before = main.topIds.length;
        const {make, num, stack} = builder(player.blocks);
        const dropped = stack(make('event_whenkeypressed', {topLevel: true, fields: {KEY_OPTION: 'a'}}),
            make('motion_changeyby', {inputs: {DY: num(3)}}));
        host.adoptLooseScripts(player);
        expect(main.topIds).toContain(dropped);
        expect(main.topIds.length).toBe(before + 1);
        expect(host.getSource(player)).toContain('event_whenkeypressed');
        expect(vm).toBeTruthy();
    });

    test('a collaborator\'s code is applied without being echoed back', async () => {
        const env = setup();
        const {vm, host, player} = env;
        const changes = [];
        vm.on('DIMOD_BLOCKSPACE_CHANGED', c => changes.push(c));
        host.applyRemote(player, {complex: true, source: 'me.x = 42;\n', owners: null});
        expect(host.isComplex(player)).toBe(true);
        expect(player.x).toBe(0);
        vm.runtime.greenFlag();
        expect(player.x).toBe(42);
        expect(changes).toEqual([]);
        spriteWithScripts(env);
        const env2 = setup();
        spriteWithScripts(env2);
        env2.host.setComplex(env2.player, true);
        const theirCode = env2.host.getSource(env2.player);
        host.applyRemote(player, {complex: false, source: 'x', owners: null});
        host.applyRemote(player, {complex: true, source: theirCode, owners: null});
        expect(host.spaces.entries(player.sprite).map(e => e.id).sort()).toEqual(['add', 'main']);
        expect(player.blocks.getScripts().length).toBe(env2.player.blocks.getScripts().length);
        expect(changes).toEqual([]);
    });

    test('a local change announces itself once, for the collaborators', () => {
        const {vm, host, player} = setup();
        const changes = [];
        vm.on('DIMOD_BLOCKSPACE_CHANGED', c => changes.push(c.targetId));
        host.setComplex(player, true);
        host.setSource(player, 'me.x = 1;');
        expect(changes).toEqual([player.id, player.id]);
    });


    test('edited code waits until the green flag (or applySource) to run', async () => {
        const {vm, host, player, step} = setup();
        const pending = [];
        vm.on('DIMOD_BLOCKSPACE_PENDING', e => pending.push(e.pending));
        host.setComplex(player, true);
        host.setSource(player, 'me.x = 1;');
        expect(player.x).toBe(1);
        host.setSource(player, 'me.x = 2;', {apply: false, typed: true});
        expect(player.x).toBe(1);
        expect(host.isPending(player)).toBe(true);
        vm.runtime.greenFlag();
        await step();
        expect(player.x).toBe(2);
        expect(host.isPending(player)).toBe(false);
        host.setSource(player, 'me.x = 3;', {apply: false});
        host.applySource(player);
        expect(player.x).toBe(3);
        expect(pending).toEqual([true, false, true, false, true, false]);
    });

    test('a collaborator\'s code edit also waits for the green flag', () => {
        const {host, player} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'me.x = 1;');
        host.applyRemote(player, {complex: true, source: 'me.x = 9;', owners: null});
        expect(player.x).toBe(1);
        expect(host.isPending(player)).toBe(true);
    });

    test('editing updates blockspaces\' blocks straight away without running any code', () => {
        const env = setup();
        const {host, player} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        const code = host.getSource(player);
        const ran = [];
        env.vm.on('DIMOD_BLOCKSPACE_LOG', e => ran.push(e.text));
        host.setSource(player, `${code.replace(/new Blockspace\("add"[^\n]*\n/, '')}log("ran");\nnew Blockspace("fresh");\n`,
            {apply: false, typed: true});
        expect(host.spaces.entries(player.sprite).map(e => e.id).sort()).toEqual(['fresh', 'main']);
        expect(ran).toEqual([]);
        const mainTops = host.spaces.entry(player.sprite, 'main').topIds.slice();
        host.setSource(player, host.getSource(player).replace(/new Blockspace\("main", \{/, 'new Blockspace("main", {oops '),
            {apply: false, typed: true});
        expect(host.spaces.entry(player.sprite, 'main').topIds).toEqual(mainTops);
    });


    test('the stage can be complex: its scripts move into code, its code runs, clones are refused', async () => {
        const {vm, host, stage, logs, step} = setup();
        const {make, num, stack} = builder(stage.blocks);
        stage.createVariable('v1', 'score', '');
        const change = make('data_changevariableby', {inputs: {VALUE: num(5)}});
        stage.blocks._blocks[change].fields.VARIABLE = {name: 'VARIABLE', id: 'v1', value: 'score'};
        stack(make('event_whenflagclicked', {topLevel: true}), change);
        host.setComplex(stage, true);
        expect(host.getSource(stage)).toMatch(/The stage is complex/);
        expect(host.spaces.entry(stage.sprite, 'main').topIds.length).toBe(1);
        host.setSource(stage, `${host.getSource(stage)}
            world.on("flag", () => { me.vars.score += 100; log(me.isStage, me.name); me.clone(); });`);
        stage.variables.v1.value = 0;
        vm.runtime.greenFlag();
        await step(2);
        expect(logs.map(l => l.text)).toContain('true Stage');
        expect(logs.find(l => l.level === 'error').text).toMatch(/stage can't be cloned/);
        expect(stage.variables.v1.value).toBe(105);
    });


    test('hover chains: what\'s under the mouse, not calls', () => {
        const word = (line, text) => {
            const start = line.indexOf(text);
            return {word: text, startColumn: start + 1, endColumn: start + text.length + 1};
        };
        expect(chainAt('  me.vars.hp -= 1;', word('  me.vars.hp -= 1;', 'hp')).parts).toEqual(['me', 'vars', 'hp']);
        expect(chainAt('x = me . x', word('x = me . x', 'x')).parts).toEqual(['x']);
        expect(chainAt('me.say("hi")', word('me.say("hi")', 'say'))).toBe(null);
        expect(chainAt('foo().bar', word('foo().bar', 'bar'))).toBe(null);
    });

    test('live values come from the running code without running anything', async () => {
        const env = setup();
        const {vm, host, player, stage, step} = env;
        stage.createVariable('v1', 'score', '');
        const code = `const state = me.hold({combo: 3, items: ["a", "b"]});
const jump = new Blockspace("jump");
me.x = 12;
world.vars.score = 7;
`;
        host.setComplex(player, true);
        const value = parts => liveValue(host, player, code, parts);
        expect(value(['me', 'x'])).toMatch(/not running yet/);
        host.setSource(player, code);
        expect(value(['me', 'x'])).toBe('`12`');
        expect(value(['world', 'vars', 'score'])).toBe('`7`');
        expect(value(['state', 'combo'])).toBe('`3`');
        expect(value(['state', 'items'])).toBe('`2 items: ["a","b"]`');
        expect(value(['me'])).toBe('`sprite "Player" at (12, 0)`');
        expect(value(['jump'])).toBe('blockspace "jump" · 1 block · 0 running');
        expect(value(['me', 'say'])).toBe(null);
        expect(value(['somethingLocal'])).toBe(null);
        expect(vm && step).toBeTruthy();
    });


    test('world values are shared by all complex code and rebuilt on each green flag', async () => {
        const {vm, host, player, logs, step} = setup();
        const enemy = makeTarget(vm.runtime, 'Enemy', false);
        host.setComplex(player, true);
        host.setSource(player, `
            world.gravity = 9.8;
            world.on("flag", () => { world.flags = (world.flags || 0) + 1; world.temp = "set on the flag"; });
        `);
        host.setComplex(enemy, true);
        host.setSource(enemy, `
            world.on("flag", () => log("enemy sees", world.gravity, world.flags));
            world.on("key", "space", () => { world.temp = "changed"; });
        `);
        vm.runtime.greenFlag();
        await step();
        expect(logs.map(l => l.text)).toContain('enemy sees 9.8 1');
        expect(host.worldValues.temp).toBe('set on the flag');
        vm.runtime.emit('KEY_PRESSED', 'space');
        expect(host.worldValues.temp).toBe('changed');
        vm.runtime.greenFlag();
        await step();
        expect(host.worldValues.flags).toBe(1);
        expect(host.worldValues.temp).toBe('set on the flag');
        expect(host.worldValues.gravity).toBe(9.8);
    });

    test('world\'s built-in names can\'t be replaced; its setters still work', async () => {
        const {host, player, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'world.on = 5;');
        await flush();
        expect(logs.find(l => l.level === 'error').text).toMatch(/world.on is built in/);
        host.setSource(player, 'world.score = 1; log("score" in world, Object.keys(world).join(","));');
        expect(logs.map(l => l.text)).toContain('true score');
    });

    test('the green flag reruns every complex sprite\'s top level, after its stop-all', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            log("top level ran");
            world.forever(() => { world.ticks = (world.ticks || 0) + 1; });
        `);
        vm.runtime.greenFlag();
        await step(3);
        expect(logs.filter(l => l.text === 'top level ran').length).toBe(2);
        expect(host.worldValues.ticks).toBeGreaterThanOrEqual(3);
    });

    test('world.on("stop") runs for the stop sign, not for the green flag', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `world.on("stop", () => log("stopped"));`);
        vm.runtime.greenFlag();
        await step();
        expect(logs.filter(l => l.text === 'stopped').length).toBe(0);
        vm.runtime.stopAll();
        await step();
        expect(logs.filter(l => l.text === 'stopped').length).toBe(1);
    });

    test('a broadcast handler can broadcast again, and broadcastAndWait still waits for both', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("broadcast", "a", () => world.broadcast("b"));
            world.on("broadcast", "b", async () => { await wait(0.2); log("b done"); });
            world.on("flag", async () => { await world.broadcastAndWait("a"); log("a done"); });
        `);
        vm.runtime.greenFlag();
        await step(12);
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
        expect(logs.map(l => l.text)).toEqual(expect.arrayContaining(['b done', 'a done']));
    });

    test('the top level can await, and can use the globals\' names for its own', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            const repeat = 3;
            await wait(0.1);
            me.x = repeat;
        `);
        vm.runtime.greenFlag();
        await step(6);
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
        expect(player.x).toBe(3);
    });

    test('an error thrown after a top-level await still points at its line', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, 'await nextFrame();\n\nthrow new Error("boom");\n');
        vm.runtime.greenFlag();
        await step(2);
        const error = logs.find(l => l.level === 'error');
        expect(error.text).toBe('Error: boom');
        expect(error.line).toBe(3);
    });

    test('a world.every callback that throws is reported once and stops', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `world.every(0, () => { throw new Error("tick"); });`);
        vm.runtime.greenFlag();
        await step(5);
        expect(logs.filter(l => l.level === 'error').length).toBe(1);
    });

    test('say for seconds doesn\'t clear what was said after it', async () => {
        const {vm, host, player, step} = setup();
        const said = [];
        vm.runtime.on('SAY', (target, type, text) => said.push(text));
        host.setComplex(player, true);
        host.setSource(player, `world.on("flag", () => { me.say("hi", 0.1); me.say("bye"); });`);
        vm.runtime.greenFlag();
        await step(6);
        expect(said).toEqual(['hi', 'bye']);
    });

    test('a list kept in a variable follows the list after blocks replace its array', async () => {
        const {vm, host, player, step} = setup();
        player.createVariable('l1', 'items', 'list');
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", async () => {
                const items = me.lists.items;
                items.push({a: 1});
                await nextFrame();
                items.push(2);
                world.seen = items.length;
            });
        `);
        vm.runtime.greenFlag();
        await flush();
        const variable = player.lookupVariableById('l1');
        expect(variable.value).toEqual(['{"a":1}']);
        variable.value = [];
        await step(2);
        expect(variable.value).toEqual([2]);
        expect(host.worldValues.seen).toBe(1);
    });

    test('pausing stops time for code: waits, loops and events wait for the resume', async () => {
        const {vm, host, player, step} = setup();
        vm.runtime.audioEngine = {audioContext: {suspend: () => null, resume: () => null}};
        host.setComplex(player, true);
        host.setSource(player, `
            world.forever(() => { world.frames = (world.frames || 0) + 1; });
            world.on("flag", async () => { await wait(0.2); me.x = 50; });
            world.on("broadcast", "go", () => { me.y = 7; });
        `);
        vm.runtime.greenFlag();
        await step(2);
        vm.runtime.pause();
        const frames = host.worldValues.frames;
        host.broadcast('go');
        await step(20);
        expect(host.worldValues.frames).toBe(frames);
        expect(player.x).toBe(0);
        expect(player.y).toBe(0);
        vm.runtime.play();
        await step(10);
        expect(player.y).toBe(7);
        expect(player.x).toBe(50);
        expect(host.worldValues.frames).toBeGreaterThan(frames);
    });

    test('sprites hold values of their own: me.hp, shared by every view of that sprite', async () => {
        const {vm, host, stage, player, logs} = setup();
        host.setComplex(player, true);
        host.setComplex(stage, true);
        host.setSource(player, `
            me.hp = 3;
            me.x = 20; // built-in setters still work
            log(me.hp, "hp" in me, Object.keys(me).join(","));
        `);
        host.setSource(stage, `world.on("flag", () => { world.getTarget("Player").hp -= 1; });`);
        vm.runtime.greenFlag();
        await flush();
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
        expect(player.x).toBe(20);
        expect(logs.map(l => l.text)).toContain('3 true hp');
        expect(host.targetValues(player).hp).toBe(2);
        host.setSource(player, 'me.name = "x";');
        await flush();
        expect(logs.find(l => l.level === 'error').text).toMatch(/me.name is built in/);
    });

    test('a clone starts with a copy of its parent\'s values; the flag empties them', async () => {
        const {vm, host, player, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            if (!me.isClone) {
                me.items = [1];
                const c = me.clone();
                c.items.push(2);
                log(me.items.length, c.items.length);
            }
        `);
        vm.runtime.greenFlag();
        await flush();
        expect(logs.map(l => l.text)).toContain('1 2');
        host.targetValues(player).extra = 1;
        vm.runtime.greenFlag();
        await flush();
        expect(host.targetValues(player).extra).toBeUndefined();
    });

    test('"change" handlers run when a world or sprite value changes, from code or blocks', async () => {
        const {vm, host, player, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("change", "score", (now, was) => log("score", was, "->", now));
            me.on("change", "hp", now => log("hp", now));
            world.on("flag", () => { world.score = 1; world.score = 1; me.hp = 5; });
        `);
        vm.runtime.greenFlag();
        await flush();
        const prims = vm.runtime._primitives;
        prims.event_dimod_world_changevalue({NAME: 'score', VALUE: 2}, {target: player});
        prims.event_dimod_my_setvalue({NAME: 'hp', VALUE: '9'}, {target: player});
        expect(prims.event_dimod_world_value({NAME: 'score'}, {target: player})).toBe(3);
        expect(prims.event_dimod_my_value({NAME: 'hp'}, {target: player})).toBe('9');
        expect(prims.event_dimod_my_value({NAME: 'nothing'}, {target: player})).toBe('');
        expect(logs.map(l => l.text)).toEqual(['score  -> 1', 'hp 5', 'score 1 -> 3', 'hp 9']);
    });

    test('a block that throws inside a run ends that run and points at the me.run() line', async () => {
        const {vm, host, player, logs, step} = setup();
        vm.runtime._primitives.test_explode = () => {
            throw new Error('kaboom');
        };
        host.setComplex(player, true);
        host.setSource(player, 'world.on("flag", async () => {\n    await me.block("test_explode");\n});\n');
        vm.runtime.greenFlag();
        await step(3);
        const error = logs.find(l => l.level === 'error');
        expect(error.text).toMatch(/kaboom/);
        expect(error.line).toBe(2);
        expect(host.spaces.runs.size).toBe(0);
    });

    test('the editor\'s types list world and sprite values set in code or by blocks', () => {
        const {vm, host, player} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.score = 0;
            me.hp += 1;
            const boss = world.getTarget("Boss");
            boss.rage = 2;
            me.x = 3; // built in: not a value
            if (me.hp == 2) {}
        `);
        const types = projectTypes(vm.runtime, player);
        expect(types).toMatch(/interface WorldValueNames \{\s*"score": 1;\s*\}/);
        expect(types).toMatch(/interface SpriteValueNames \{\s*"hp": 1;\s*"rage": 1;\s*\}/);
        expect(types).toMatch(/interface TargetApi \{\s*hp: any;\s*rage: any;\s*\}/);
    });

    test('each sprite keeps its console; repeats count up; unseen errors are counted', async () => {
        const {vm, host, player, step} = setup();
        installConsoleStore(vm);
        host.setComplex(player, true);
        host.setSource(player, `
            for (let i = 0; i < 3; i++) log("same");
            world.on("flag", () => { throw new Error("oops"); });
        `);
        vm.runtime.greenFlag();
        await step();
        const log = logFor(player.id);
        expect(log.find(l => l.text === 'same').count).toBe(6);
        expect(unseenErrors(player.id)).toBe(1);
        markSeen(player.id);
        expect(unseenErrors(player.id)).toBe(0);
    });

    test('me.tween moves any property along an easing and resolves at the end', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", async () => {
                me.hp = 10;
                const t = me.tween({x: 100, "effects.ghost": 50, hp: 0, size: "+=50"}, 1, "easeOutQuad");
                world.t = t;
                await t;
                log("done", t.status);
            });
        `);
        vm.runtime.greenFlag();
        await step(16);
        const t = host.worldValues.t;
        expect(t.progress).toBeGreaterThan(0.4);
        expect(t.progress).toBeLessThan(0.6);
        expect(player.x).toBeCloseTo(100 * (1 - Math.pow(1 - t.progress, 2)), 5);
        expect(player.x).toBeGreaterThan(100 * t.progress);
        await step(20);
        expect(player.x).toBe(100);
        expect(player.effects.ghost).toBe(50);
        expect(player.size).toBe(150);
        expect(host.targetValues(player).hp).toBe(0);
        expect(logs.map(l => l.text)).toContain('done finished');
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
    });

    test('tween() takes any object, colours, arrays and from; tweening nothing hands onStep a value', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", async () => {
                const thing = {tint: "#000000", pos: [0, 10], deep: {n: 5}};
                world.thing = thing;
                world.seen = [];
                const a = tween(thing, {tint: "#ff8000", pos: [10, 0], "deep.n": 7}, 0.5, "ease in out cubic");
                const onStep = (v, p) => world.seen.push([v, p]);
                const b = tween(0.5, {from: 10, to: 20, easing: "OutBounce", onStep});
                const c = tween({n: 0}, {n: 1}, 0.5, {from: {n: 50}});
                world.c = c;
                await Promise.all([a, b, c]);
                log("all done");
            });
        `);
        vm.runtime.greenFlag();
        await step();
        const c = host.worldValues.c;
        await step(20);
        const thing = host.worldValues.thing;
        expect(thing.tint).toBe('#ff8000');
        expect(thing.pos).toEqual([10, 0]);
        expect(thing.deep.n).toBe(7);
        const seen = host.worldValues.seen;
        expect(seen.length).toBeGreaterThan(5);
        expect(seen[seen.length - 1]).toEqual([20, 1]);
        seen.forEach(([v]) => expect(v).toBeGreaterThanOrEqual(10));
        expect(c.value).toBe(1);
        expect(logs.map(l => l.text)).toContain('all done');
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
    });

    test('a tween with no time applies straight away; bad easings and values explain themselves', async () => {
        const {host, player, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            const t = me.tween({x: 42}, 0);
            log("now", me.x, t.status);
            for (const bad of [
                () => me.tween({x: 1}, 1, "easeSideways"),
                () => me.tween({x: {}}, 1),
                () => tween(me, {"nope.x": 1}, 1),
                () => tween(null, {x: 1}, 1)
            ]) {
                try { bad(); } catch (e) { log(e.message); }
            }
        `);
        await flush();
        const texts = logs.map(l => l.text);
        expect(texts).toContain('now 42 finished');
        expect(texts.some(t => /No easing called "easeSideways", try one of: linear, easeInSine/.test(t))).toBe(true);
        expect(texts.some(t => /Can't tween "x" to \{\}/.test(t))).toBe(true);
        expect(texts.some(t => /Can't tween "nope.x": nope is undefined/.test(t))).toBe(true);
        expect(texts.some(t => /tween\(\) needs something to tween/.test(t))).toBe(true);
    });

    test('the stop sign stops tweens (awaits end silently); pause, resume, finish and stop work', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", async () => {
                const t = me.tween({x: 300}, 10);
                world.t = t;
                await t;
                log("never");
            });
        `);
        vm.runtime.greenFlag();
        await step(3);
        const t = host.worldValues.t;
        t.pause();
        const x = player.x;
        await step(5);
        expect(player.x).toBe(x);
        t.resume();
        await step(2);
        expect(player.x).toBeGreaterThan(x);
        vm.runtime.stopAll();
        await step(2);
        expect(t.status).toBe('stopped');
        const stoppedAt = player.x;
        await step(3);
        expect(player.x).toBe(stoppedAt);
        expect(logs.map(l => l.text)).not.toContain('never');
        expect(logs.filter(l => l.level === 'error')).toEqual([]);

        host.setSource(player, `
            world.f = me.tween({y: 80}, 5);
            world.f.finish();
            world.s = me.tween({size: 10}, 5);
        `);
        expect(player.y).toBe(80);
        expect(host.worldValues.f.status).toBe('finished');
        host.worldValues.s.stop();
        expect(host.worldValues.s.status).toBe('stopped');
    });

    test('an onStep that throws is reported once and stops its tween', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", () => {
                world.t = tween(1, () => { throw new Error("step boom"); });
            });
        `);
        vm.runtime.greenFlag();
        await step(5);
        expect(logs.filter(l => /step boom/.test(l.text)).length).toBe(1);
        expect(host.worldValues.t.status).toBe('stopped');
    });


    test('"call JS" reporter calls exposed functions: this target\'s first, then world\'s', async () => {
        const {vm, host, player, stage, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            me.expose("double", (n, caller) => n * 2 + (caller === me ? 0 : 1000));
            world.expose("double", n => -1);
            world.expose("hello", (name, caller) => "hi " + name + " from " + caller.name);
            world.expose("async", async n => { await wait(0); return {n}; });
            world.expose("oops", () => { throw new Error("exposed boom"); });
        `);
        const call = vm.runtime._primitives.event_dimod_calljs_reporter;
        expect(call({NAME: 'double', ARG: '21'}, {target: player})).toBe(42);
        expect(call({NAME: 'double', ARG: '21'}, {target: stage})).toBe(-1);
        expect(call({NAME: 'hello', ARG: 'bob'}, {target: stage})).toBe('hi bob from Stage');
        const pending = call({NAME: 'async', ARG: '3'}, {target: player});
        expect(typeof pending.then).toBe('function');
        vm.runtime._step();
        expect(await pending).toBe('{"n":3}');
        expect(call({NAME: 'oops', ARG: ''}, {target: player})).toBe('');
        expect(call({NAME: 'missing', ARG: ''}, {target: player})).toBe('');
        const errors = logs.filter(l => l.level === 'error').map(l => l.text);
        expect(errors.some(t => /exposed boom/.test(t))).toBe(true);
        expect(errors.some(t => /No JS function "missing"/.test(t))).toBe(true);
        host.setSource(player, '');
        expect(call({NAME: 'hello', ARG: 'x'}, {target: stage})).toBe('');
    });

    for (const compiled of [true, false]) {
        const mode = compiled ? 'compiled' : 'interpreted';
        test(`"call JS" blocks wait for async functions in a script (${mode})`, async () => {
            const {vm, host, player, stage, logs, step} = setup();
            vm.setCompilerOptions({enabled: compiled});
            const enemy = makeTarget(vm.runtime, 'Enemy', false);
            const {make, text, stack} = builder(enemy.blocks);
            stack(
                make('event_whenflagclicked', {topLevel: true}),
                make('event_dimod_calljs', {inputs: {NAME: text('slow'), ARG: text('5')}}),
                make('motion_setx', {inputs: {X: make('event_dimod_calljs_reporter', {
                    inputs: {NAME: text('slow'), ARG: text('20')}
                })}})
            );
            host.setComplex(stage, true);
            host.setSource(stage, `
                world.expose("slow", async n => {
                    await wait(n / 30);
                    log("slow", n);
                    return n + 1;
                });
            `);
            vm.runtime.greenFlag();
            await step(3);
            expect(enemy.x).toBe(0);
            await step(12);
            expect(logs.map(l => l.text)).toEqual(expect.arrayContaining(['slow 5']));
            await step(30);
            expect(enemy.x).toBe(21);
            expect(logs.filter(l => l.level === 'error')).toEqual([]);
            expect(player.x).toBe(0);
        });
    }


    test('me.on("change", name) only runs for that value; change filters are case-sensitive', async () => {
        const {host, player, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            me.on("change", "hp", now => log("hp", now));
            me.on("change", (now, was, name) => log("any", name));
            world.on("change", "Score", () => log("Score"));
            world.on("change", "score", () => log("score"));
            me.mana = 3;
            me.hp = 1;
            world.score = 1;
        `);
        await flush();
        expect(logs.map(l => l.text)).toEqual(['any mana', 'hp 1', 'any hp', 'score']);
    });

    test('a stopped Loop isn\'t running; world.cameras hands back one camera per name', async () => {
        const {vm, host, player, logs} = setup();
        vm.extensionManager.isExtensionLoaded = () => true;
        host.setComplex(player, true);
        host.setSource(player, `
            const loop = world.forever(() => {});
            log("before", loop.running);
            loop.pause();
            log("paused", loop.running);
            loop.resume();
            loop.stop();
            log("after", loop.running);
            log("same", world.cameras.get("a") === world.cameras.get("a"),
                world.cameras.get("default") === world.camera);
        `);
        await flush();
        expect(logs.map(l => l.text)).toEqual(['before true', 'paused false', 'after false', 'same true true']);
    });

    test('toolbox: the Blockspace category has everything, Values has values and call JS; gaps, no labels', () => {
        const parse = xml => new DOMParser().parseFromString(`<xml>${xml}</xml>`, 'text/xml');
        const types = doc => [...doc.querySelectorAll('category > block')].map(b => b.getAttribute('type'));

        setToolboxBlockspace({targetId: 't1', id: 'jump', params: ['height']});
        expect(blockspaceCategoryXML('other')).toBe('');
        const space = parse(blockspaceCategoryXML('t1'));
        expect(space.querySelector('parsererror')).toBe(null);
        expect(types(space)).toEqual([
            'event_dimod_blockspace_whencalled', 'event_dimod_blockspace_argument',
            'event_dimod_blockspace_return', 'event_dimod_blockspace_yield',
            'event_dimod_calljs', 'event_dimod_calljs_reporter',
            'event_dimod_callblockspace', 'event_dimod_callblockspace_reporter',
            'event_dimod_tween',
            'event_dimod_world_value', 'event_dimod_world_setvalue', 'event_dimod_world_changevalue',
            'event_dimod_my_value', 'event_dimod_my_setvalue', 'event_dimod_my_changevalue'
        ]);
        expect(space.querySelectorAll('sep').length).toBe(4);
        const callJS = space.querySelector('block[type="event_dimod_calljs"]');
        expect(callJS.querySelector('mutation').getAttribute('argcount')).toBe('1');
        expect(callJS.querySelector('value[name="NAME"] > shadow').getAttribute('type'))
            .toBe('event_dimod_calljs_menu');
        expect(space.querySelector('block[type="event_dimod_callblockspace"] value[name="ID"] field').textContent)
            .toBe('jump');
        expect(space.querySelectorAll('label').length).toBe(0);
        setToolboxBlockspace(null);

        const values = parse(valuesCategoryXML());
        expect(values.querySelector('parsererror')).toBe(null);
        expect(types(values)).toEqual([
            'event_dimod_world_value', 'event_dimod_world_setvalue', 'event_dimod_world_changevalue',
            'event_dimod_my_value', 'event_dimod_my_setvalue', 'event_dimod_my_changevalue',
            'event_dimod_calljs', 'event_dimod_calljs_reporter',
            'event_dimod_callblockspace', 'event_dimod_callblockspace_reporter',
            'event_dimod_tween'
        ]);
        expect(values.querySelectorAll('sep').length).toBe(3);
        expect(values.querySelectorAll('label').length).toBe(0);
    });


    test('preflag runs after every sprite\'s code restarts and before any flag handler or script', async () => {
        const {vm, host, player, stage, logs, step} = setup();
        host.setComplex(stage, true);
        host.setComplex(player, true);
        host.setSource(stage, `
            world.on("preflag", () => { world.ready = true; log("stage preflag"); });
        `);
        host.setSource(player, `
            log("player top", world.ready);
            world.on("preflag", () => log("player preflag", world.ready));
            world.on("flag", () => log("player flag", world.ready));
        `);
        logs.length = 0;
        vm.runtime.greenFlag();
        await step();
        const texts = logs.map(l => l.text);
        expect(texts.indexOf('stage preflag')).toBeGreaterThan(-1);
        expect(texts.indexOf('player flag true')).toBeGreaterThan(texts.indexOf('stage preflag'));
        expect(texts.indexOf('player top')).toBeLessThan(texts.indexOf('stage preflag'));
        host.setSource(player, `try { world.emit("preflag"); } catch (e) { log(e.message); }`);
        await flush();
        expect(logs.some(l => /"preflag" is a built-in event/.test(l.text))).toBe(true);
    });

    test('me.on("clone") runs in a new clone\'s copy; me.on("cloned") in its parent\'s, with the clone', async () => {
        const {host, player, logs} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            me.on("clone", () => log("i am a clone", me.isClone, me.x));
            me.on("cloned", clone => { log("made", clone.isClone); clone.x = 42; });
            if (!me.isClone) world.first = me.clone();
        `);
        await flush();
        const texts = logs.map(l => l.text);
        expect(texts).toContain('made true');
        expect(texts).toContain('i am a clone true 0');
        expect(texts.indexOf('i am a clone true 0')).toBeLessThan(texts.indexOf('made true'));
        const clone = player.sprite.clones[1];
        expect(clone.x).toBe(42);
        logs.length = 0;
        host.applySource(player);
        await flush();
        expect(player.sprite.clones.length).toBe(3);
        expect(logs.map(l => l.text).filter(t => /i am a clone/.test(t)).length).toBe(1);
    });

    test('costume, say, resize and cloud events', async () => {
        const {vm, host, player, stage, logs} = setup();
        player.sprite.costumes_ = [{name: 'a'}, {name: 'b'}];
        host.setComplex(player, true);
        host.setSource(player, `
            me.on("costume", (name, index) => log("costume", name, index));
            me.on("say", (text, type) => log("say", text, type));
            world.on("resize", (w, h) => log("resize", w, h));
            world.on("cloud", "best", (value, name) => log("cloud", name, value));
            world.on("cloud", "Best", () => log("wrong case"));
            me.setCostume("b");
            me.setCostume("b");
            me.think("hmm");
        `);
        await flush();
        vm.runtime.setStageSize(640, 360);
        stage.createVariable('c1', '☁ best', '', true);
        vm.runtime.ioDevices.cloud.setStage(stage);
        vm.runtime.ioDevices.cloud.postData({varUpdate: {name: '☁ best', value: 7}});
        await flush();
        expect(logs.map(l => l.text)).toEqual(['costume b 1', 'say hmm think', 'resize 640 360', 'cloud best 7']);
    });

    test('world.cloud: JS values, declare on write, enumerate, delete, listen', async () => {
        const {vm, host, player, stage, logs} = setup();
        vm.runtime.ioDevices.cloud.setStage(stage);
        vm.editingTarget = player;
        const sent = [];
        vm.runtime.ioDevices.cloud.provider = {
            createVariable: (name, value) => sent.push(['create', name, value]),
            updateVariable: (name, value) => sent.push(['update', name, value]),
            renameVariable: () => {},
            deleteVariable: name => sent.push(['delete', name])
        };
        host.setComplex(player, true);
        host.setSource(player, `
            world.cloud.board = [{name: "a", score: 3}];
            world.cloud.set("plain", 5);
            log("get", JSON.stringify(world.cloud.get("board")), typeof world.cloud.board);
            log("missing", world.cloud.get("nope", "fallback"), world.cloud.has("nope"), "plain" in world.cloud);
            log("keys", Object.keys(world.cloud).join(), world.cloud.names().join());
            log("all", JSON.stringify(world.cloud.all()));
            world.cloud.on("board", (value, name) => log("on", name, JSON.stringify(value)));
            world.cloud.on((value, name) => log("any", name));
            log("delete", world.cloud.delete("plain"), world.cloud.delete("plain"), world.cloud.has("plain"));
            try { world.cloud.get = 1; } catch (e) { log("method", e.message); }
            try { world.cloud.set("big", "x".repeat(1024 * 1024 + 1)); } catch (e) { log("big", e.name); }
        `);
        await flush();
        vm.runtime.ioDevices.cloud.postData({varUpdate: {name: '☁ board', value: '[{"name":"b"}]'}});
        await flush();
        expect(logs.map(l => l.text)).toEqual([
            'get [{"name":"a","score":3}] string',
            'missing fallback false true',
            'keys board,plain board,plain',
            'all {"board":[{"name":"a","score":3}],"plain":5}',
            'delete true false false',
            expect.stringMatching(/^method world\.cloud\.get is a method/),
            'big RangeError',
            'on board [{"name":"b"}]',
            'any board'
        ]);
        expect(sent.map(([kind, name]) => `${kind} ${name}`)).toEqual([
            'create ☁ board', 'update ☁ board', 'create ☁ plain', 'update ☁ plain', 'delete ☁ plain'
        ]);
        expect(sent[1][2]).toBe('[{"name":"a","score":3}]');
    });

    test('touching a colour asks the renderer about that colour', () => {
        const {host, player} = setup();
        host.setComplex(player, true);
        host.setSource(player, '');
        const seen = [];
        player.isTouchingColor = color => {
            seen.push(color);
            return true;
        };
        const me = host.instances.get(player).me;
        expect(me.touching('#ff0000')).toBe(true);
        expect(me.touching([0, 255, 0])).toBe(true);
        expect(seen).toEqual([[255, 0, 0], [0, 255, 0]]);
    });

    test('world.watch fires on falsy -> truthy, or on any change; survives the stop sign', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.n = 0;
            world.watch(() => world.n >= 2, v => log("reached", v));
            world.watch(() => world.n, (now, was) => log("n", was, "->", now), {on: "change"});
        `);
        await step();
        host.worldValues.n = 1;
        await step();
        host.worldValues.n = 2;
        await step();
        vm.runtime.stopAll();
        host.worldValues.n = 0;
        await step();
        host.worldValues.n = 5;
        await step();
        expect(logs.map(l => l.text)).toEqual([
            'n 0 -> 1', 'reached true', 'n 1 -> 2', 'n 2 -> 0', 'reached true', 'n 0 -> 5'
        ]);
    });


    test('world.server talks to the game client with JS values, and hears it', async () => {
        const {vm, host, player, logs} = setup();
        const sent = [];
        const client = {
            connected: true,
            latency: 12,
            playerCount: 3,
            room: 'lobby',
            player: {username: 'kit', id: 'p1'},
            isGuest: false,
            lastData: '',
            ensureConnected: () => sent.push('connect'),
            ping: () => {},
            send: data => sent.push(data),
            ask: data => Promise.resolve(data === 'score' ? '{"best":9}' : ''),
            joinRoom: room => sent.push(`join ${room}`)
        };
        vm.dimodGameClient = client;
        host.setComplex(player, true);
        host.setSource(player, `
            world.server.on("data", data => log("data", typeof data, JSON.stringify(data)));
            world.server.on("connect", () => log("connected"));
            world.server.send({hi: 1});
            world.server.send("plain");
            world.server.join("room2");
            log(world.server.available, world.server.connected, world.server.players, world.server.room,
                world.server.me.username);
            world.on("flag", async () => {
                log("ask", JSON.stringify(await world.server.ask("score")), await world.server.ask("nothing"));
            });
        `);
        client.lastData = '{"x":1}';
        vm.runtime.startHats('event_dimod_whenireceive');
        client.lastData = 'hello';
        vm.runtime.startHats('event_dimod_whenireceive');
        vm.runtime.startHats('event_dimod_whenconnected');
        vm.runtime.greenFlag();
        await flush();
        expect(sent).toEqual(expect.arrayContaining(['{"hi":1}', 'plain', 'join room2']));
        expect(logs.map(l => l.text)).toEqual(expect.arrayContaining([
            'true true 3 lobby kit', 'data object {"x":1}', 'data string "hello"', 'connected',
            'ask {"best":9} null'
        ]));

        vm.dimodGameClient = null;
        logs.length = 0;
        host.setSource(player, `
            world.server.send("x");
            log(world.server.available, world.server.connected, world.server.me);
            world.server.ask("y").then(a => log("answer", a));
        `);
        await flush();
        expect(logs.map(l => l.text)).toEqual(['false false null', 'answer null']);
    });


    test('tweens can wait, repeat and yoyo; glide takes an easing', async () => {
        const {vm, host, player, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("flag", () => {
                world.a = me.tween({size: 130}, 0.5, {delay: 0.5});
                world.b = tween({n: 0}, {n: 10}, 0.5, {repeat: 1, yoyo: true});
                world.c = tween(0.2, {repeat: Infinity});
                world.g = me.glide(1, 0, 90, "easeInQuad");
            });
        `);
        vm.runtime.greenFlag();
        await step(10);
        expect(player.size).toBe(100);
        expect(player.y).toBeLessThan(90 * 0.33 * 0.5);
        const b = host.worldValues.b;
        await step(8);
        expect(b.iteration).toBe(1);
        await step(15);
        expect(player.size).toBe(130);
        expect(b.status).toBe('finished');
        expect(b.value).toBe(0);
        expect(player.y).toBe(90);
        const c = host.worldValues.c;
        expect(c.running).toBe(true);
        expect(c.iteration).toBeGreaterThan(3);
        vm.runtime.stopAll();
        expect(c.status).toBe('stopped');
    });


    test('held values with reset "save" go into the project file and come back from it', async () => {
        const {vm, host, player, stage} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            const mine = me.hold({best: 0, tmp: 1}, {reset: "save"});
            const shared = world.hold({level: 1}, {reset: "save"});
            me.hold({notSaved: 5});
            mine.best = 12;
            mine.tmp = () => 1; // can't be saved: left out
            shared.level = 4;
            world.on("flag", () => {});
        `);
        vm.runtime.greenFlag();
        await flush();
        expect(host.holdStoreFor(player).values.best).toBe(12);
        const json = sb3.serialize(vm.runtime);
        const saved = json.targets.find(t => t.name === 'Player').extensionData;
        expect(saved.dimodBlockspaceSaved).toEqual({best: 12});
        expect(json.targets.find(t => t.isStage).extensionData.dimodWorldSaved).toEqual({level: 4});

        const next = setup();
        next.player.extensionData = {dimodBlockspaceSaved: {best: 12}};
        next.stage.extensionData = {dimodWorldSaved: {level: 4}};
        next.host._loadSavedHolds(next.player);
        next.host._loadSavedHolds(next.stage);
        next.host.setComplex(next.player, true);
        next.host.setSource(next.player, `
            const mine = me.hold({best: 0}, {reset: "save"});
            const shared = world.hold({level: 1}, {reset: "save"});
            log(mine.best, shared.level);
        `);
        await flush();
        expect(next.logs.map(l => l.text)).toContain('12 4');
        expect(stage).toBeTruthy();
    });


    test('any sprite\'s blockspace, from code (blockspace(id)) and from blocks (call blockspace)', async () => {
        const env = setup();
        const {vm, host, player, logs, step} = env;
        spriteWithScripts(env);
        host.setComplex(player, true);
        const enemy = makeTarget(vm.runtime, 'Enemy', false);
        const {make, text, stack} = builder(enemy.blocks);
        stack(
            make('event_whenflagclicked', {topLevel: true}),
            make('motion_setx', {inputs: {X: make('event_dimod_callblockspace_reporter', {
                mutation: {tagName: 'mutation', children: [], argcount: '2'},
                inputs: {
                    ID: make('event_dimod_blockspace_menu', {fields: {ID: 'add'}, shadow: true}),
                    SPRITE: make('event_dimod_sprite_menu', {fields: {SPRITE: 'Player'}, shadow: true}),
                    ARG: text('2'),
                    ARG1: text('3')
                }
            })}}),
            make('motion_sety', {inputs: {Y: make('event_dimod_callblockspace_reporter', {
                inputs: {
                    ID: make('event_dimod_blockspace_menu', {fields: {ID: 'nope'}, shadow: true}),
                    SPRITE: make('event_dimod_sprite_menu', {fields: {SPRITE: 'Player'}, shadow: true})
                }
            })}})
        );
        host.setSource(player, `${host.getSource(player)}
            world.on("flag", async () => {
                const enemy = world.getTarget("Enemy");
                log("js", await fromCast(enemy.run(me.blockspace("add"), 10, 5)));
                try { me.blockspace("nope"); } catch (e) { log(e.message); }
            });`);
        vm.runtime.greenFlag();
        await step(6);
        expect(enemy.x).toBe(5);
        expect(logs.map(l => l.text)).toEqual(expect.arrayContaining([
            'js 15', 'Player has no blockspace "nope"'
        ]));
        expect(logs.some(l => /call blockspace: Player has no blockspace "nope"/.test(l.text))).toBe(true);
    });

    test('call JS passes every argument, then the caller; a smaller argcount drops extra inputs', () => {
        const {vm, host, player, stage} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.expose("join", (...args) => args.slice(0, -1).join("+") + " by " + args[args.length - 1].name);
        `);
        const call = vm.runtime._primitives.event_dimod_calljs_reporter;
        expect(call({NAME: 'join', ARG: '1', ARG1: 'b', ARG2: 'c'}, {target: stage})).toBe('1+b+c by Stage');
        expect(call({NAME: 'join'}, {target: stage})).toBe(' by Stage');

        const {make, text} = builder(player.blocks);
        const block = make('event_dimod_calljs', {
            topLevel: true,
            mutation: {tagName: 'mutation', children: [], argcount: '3'},
            inputs: {NAME: text('join'), ARG: text('a'), ARG1: text('b'), ARG2: text('c')}
        });
        const dropped = player.blocks._blocks[block].inputs.ARG1.block;
        player.blocks.blocklyListen({
            type: 'change', element: 'mutation', blockId: block, newValue: '<mutation argcount="1"></mutation>'
        });
        const after = player.blocks._blocks[block];
        expect(Object.keys(after.inputs).sort()).toEqual(['ARG', 'NAME']);
        expect(player.blocks._blocks[dropped]).toBeUndefined();
    });

    test('the tween block tweens a property by its friendly name (or any path) and waits', async () => {
        const {vm, player, step, logs} = setup();
        installBlockspaceRuntime(vm);
        const {make, text, num, stack} = builder(player.blocks);
        const tweenBlock = (prop, value, secs) => make('event_dimod_tween', {inputs: {
            PROP: make('event_dimod_tweenprop_menu', {fields: {PROP: prop}, shadow: true}),
            VALUE: text(value),
            SECS: num(secs),
            EASING: make('event_dimod_easing_menu', {fields: {EASING: 'ease out quad'}, shadow: true})
        }});
        stack(
            make('event_whenflagclicked', {topLevel: true}),
            tweenBlock('ghost', '50', 0.5),
            tweenBlock('hp', '+=5', 0),
            make('motion_setx', {inputs: {X: num(99)}})
        );
        vm.runtime.greenFlag();
        await step(5);
        expect(player.effects.ghost).toBeGreaterThan(0);
        expect(player.effects.ghost).toBeLessThan(50);
        expect(player.x).toBe(0);
        await step(15);
        expect(player.effects.ghost).toBe(50);
        expect(vm.runtime.dimodBlockspace.targetValues(player).hp).toBe(5);
        expect(player.x).toBe(99);
        expect(logs.filter(l => l.level === 'error')).toEqual([]);
    });

    test('the inspector lists what each copy has going, and stops it', async () => {
        const {vm, host, player, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.on("key", "space", () => {});
            me.on("touch", "edge", () => {});
            world.every(1, () => {});
            world.expose("f", () => 1);
            me.hold({hp: 3});
            world.on("flag", () => {
                world.t = me.tween({x: 10}, 5);
                wait(10);
            });
        `);
        vm.runtime.greenFlag();
        await step();
        const [copy] = host.inspect(player.id);
        expect(copy.running).toBe(true);
        expect(copy.handlers.map(h => `${h.on}:${h.event}:${h.filter}`)).toEqual(
            expect.arrayContaining(['world:key:space', 'world:flag:null']));
        expect(copy.loops.map(l => l.kind).sort()).toEqual(['touch', 'tween']);
        expect(copy.timers.length).toBe(1);
        expect(copy.waits).toBe(1);
        expect(copy.exposed).toEqual([{on: 'world', name: 'f'}]);
        expect(copy.holds).toEqual({hp: 3});
        copy.loops.find(l => l.kind === 'tween').stop();
        expect(host.worldValues.t.status).toBe('stopped');
        copy.timers[0].stop();
        expect(host.inspect(player.id)[0].timers).toEqual([]);
    });

    test('once waits for the next event, with a timeout, and ends with the code', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            log("key", await world.once("key", "space"));
            await me.once("click");
            log("clicked");
            try { await world.once("broadcast", "never", {timeout: 0.1}); } catch (e) { log(e.name); }
            world.once("flag").catch(e => log("ended", e.name));
            await wait(100);
        `, {apply: false});
        vm.runtime.greenFlag();
        await step();
        vm.runtime.emit('KEY_PRESSED', 'space');
        await step();
        host.dispatchTarget(player, 'click', null, []);
        await step(8);
        expect(logs.map(l => l.text)).toEqual(['key space', 'clicked', 'TimeoutError']);
        host.setSource(player, '');
        await step();
        expect(logs.map(l => l.text)).toEqual(['key space', 'clicked', 'TimeoutError', 'ended Stopped']);
        expect([...host.handlers].filter(h => h.event === 'flag').length).toBe(0);
    });

    test('input actions: down, pressed, released, axis, events, capture', async () => {
        const {vm, host, player, logs, step} = setup();
        const keyboard = vm.runtime.ioDevices.keyboard;
        host.setComplex(player, true);
        host.setSource(player, `
            world.input.actions({jump: ["space", "w"], left: "a", right: ["d", "pad:lx+"]});
            world.input.on("jump", () => log("jump!"));
            world.input.on("jump", "release", () => log("let go"));
            world.forever(() => {
                if (world.input.pressed("jump")) log("pressed");
                if (world.input.released("jump")) log("released");
            });
            world.axis = () => world.input.axis("left", "right");
            world.bound = world.input.bindings("right").join();
            try { world.input.bind("x", "pad:nope"); } catch (e) { log(e.message.slice(0, 20)); }
            try { world.input.down("nothing"); } catch (e) { log(e.name); }
            world.input.capture().then(b => log("captured", b));
        `, {apply: false});
        vm.runtime.greenFlag();
        await step();
        expect(host.worldValues.bound).toBe('d,pad:lx+');
        keyboard.postData({key: 'w', isDown: true});
        await step();
        await step();
        keyboard.postData({key: 'w', isDown: false});
        await step();
        keyboard.postData({key: 'd', isDown: true});
        await step();
        expect(host.worldValues.axis()).toBe(1);
        keyboard.postData({key: 'a', isDown: true});
        await step();
        expect(host.worldValues.axis()).toBe(0);
        keyboard.postData({key: 'a', isDown: false});
        keyboard.postData({key: 'd', isDown: false});
        await step(2);
        expect(logs.map(l => l.text)).toEqual(
            ['Unknown gamepad inpu', 'ReferenceError', 'jump!', 'pressed', 'captured w', 'let go', 'released']);
    });

    test('tests: register, run in order with hooks, report failures with lines', async () => {
        const {vm, host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            world.n = 0;
            beforeEach(() => { world.n += 1; });
            test("passes", () => { expect(1 + 1).toBe(2); expect({a: [1]}).toEqual({a: [1]}); });
            describe("group", () => {
                test("async waits", async () => { await wait(0.05); expect(world.n).toBe(2); });
                test("fails", () => { expect(3).toBeGreaterThan(5); });
            });
            test.skip("skipped", () => { throw new Error("no"); });
            test("throws ok", () => { expect(() => { throw new RangeError("boom"); }).toThrow("boom"); });
            test("negated", () => { expect(1).not.toBe(2); expect("abc").toContain("b"); });
            test("stays out of the way when playing", () => log("ran", world.testing));
        `);
        let ticking = true;
        (async () => {
            while (ticking) await step();
        })();
        let results;
        try {
            results = await host.runTests(player);
        } finally {
            ticking = false;
        }
        expect(results.map(r => `${r.name}=${r.status}`)).toEqual([
            'passes=pass', 'group › async waits=pass', 'group › fails=fail', 'skipped=skip', 'throws ok=pass',
            'negated=pass', 'stays out of the way when playing=pass'
        ]);
        const failed = results.find(r => r.status === 'fail');
        expect(failed.message).toBe('expected 3 to be greater than 5');
        expect(failed.line).toBe(7);
        expect(logs.filter(l => l.level === 'fail').map(l => l.text)).toEqual([
            'group › fails: expected 3 to be greater than 5', '5 passed, 1 failed, 1 skipped'
        ]);
        expect(host.testing).toBe(0);
        expect(host.testRun(player).running).toBe(false);
        expect(logs.some(l => l.text === 'ran true')).toBe(true);
    });

    test('the console evaluates as the sprite, keeps what it declares, and resets', async () => {
        const {host, player, step} = setup();
        let ticking = true;
        (async () => {
            while (ticking) await step();
        })();
        host.setComplex(player, true);
        host.setSource(player, 'world.base = 10;');
        await step();
        expect((await host.evaluate(player, 'me.x = 5; me.x * 2')).text).toBe('10');
        expect((await host.evaluate(player, 'me.x')).value).toBe(5);
        expect((await host.evaluate(player, 'const n = 4')).hasValue).toBe(true);
        expect((await host.evaluate(player, 'n + world.base')).value).toBe(14);
        expect((await host.evaluate(player, 'await wait(0.05); "done"')).value).toBe('done');
        expect((await host.evaluate(player, 'let z = 1\nz + n')).value).toBe(5);
        await host.evaluate(player, 'nothingHere').then(() => {
            throw new Error('should have thrown');
        }, e => expect(e.message).toBe('nothingHere is not defined'));
        expect((await host.evaluate(player, 'Math.max(1, _)')).value).toBe(5);
        await host.evaluate(player, 'world.on("key", "q", () => log("q!"))');
        expect(host.inspect(player.id).find(c => c.isConsole).handlers.length).toBe(1);
        host.resetRepl(player);
        expect(host.inspect(player.id).find(c => c.isConsole)).toBeUndefined();
        await host.evaluate(player, 'n').then(() => {
            throw new Error('should have thrown');
        }, e => expect(e.message).toBe('n is not defined'));
        ticking = false;
    });

    test('hot reload: the code sees `reloaded`, held values stay', async () => {
        const {host, player, logs, step} = setup();
        host.setComplex(player, true);
        const code = `
            const state = me.hold({count: 0});
            state.count += 1;
            log("run", reloaded, state.count);
        `;
        host.setSource(player, code);
        await step();
        host.applySource(player, {hot: true});
        await step();
        host.applySource(player);
        expect(logs.map(l => l.text)).toEqual(['run false 1', 'run true 2', 'run false 3']);
        expect(host.checkSyntax('let a = ;')).toBeInstanceOf(SyntaxError);
        expect(host.checkSyntax('await 1; const log = 2;')).toBe(null);
    });

    test('errors and logs know their line and column, and the profiler times callbacks', async () => {
        const {host, player, logs, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `log("hi");
world.on("key", "x", () => {
    const a = 1;
    a.b.c();
});
world.forever(() => { for (let i = 0; i < 2000; i++) Math.sqrt(i); });
`);
        await step(3);
        expect(logs[0]).toMatchObject({text: 'hi', line: 1});
        host.dispatchWorld('key', 'x', []);
        const error = logs.find(l => l.level === 'error');
        expect(error).toMatchObject({line: 4, column: 9});
        const rows = host.profileSprite(player);
        expect(rows.rows.map(r => r.label)).toEqual(expect.arrayContaining(['top level', 'forever', 'on key']));
        expect(rows.copies).toBe(1);
        expect(host.profileProject()[0].target).toBe(player);
    });

    test('world.server: relay, roster, join and leave', async () => {
        const client = fakeClient();
        const {host, player, logs, step} = setup(vm => {
            vm.dimodGameClient = client;
        });
        host.setComplex(player, true);
        host.setSource(player, `
            world.server.on("relay", "hello", (data, from, channel) => log("got", JSON.stringify(data), from.username, channel));
            world.server.on("join", p => log("join", p.username));
            world.server.on("leave", p => log("leave", p.username));
            world.relayed = world.server.relay("chat", {hi: 1});
            try { world.server.relay("", 1); } catch (e) { log(e.name); }
        `);
        await step();
        client.arrive('p2', 'Ann');
        client.say('p2', 'hello', {a: [1, 2]});
        client.say('p2', 'other', 1);
        expect(logs.map(l => l.text)).toEqual(['TypeError', 'join Ann', 'got {"a":[1,2]} Ann hello']);
        expect(client.sent).toEqual([{channel: 'chat', data: {hi: 1}, to: null}]);
        host.setSource(player, 'world.a = world.server.roster.map(p => p.username).join(); world.server.on("leave", p => log("leave", p.username));');
        await step();
        expect(host.worldValues.a).toBe('Ann');
        client.leave('p2');
        expect(logs[logs.length - 1].text).toBe('leave Ann');
    });

    test('me.sync sends what changed, and makes a ghost that follows another player', async () => {
        const client = fakeClient();
        const {host, player, step} = setup(vm => {
            vm.dimodGameClient = client;
        });
        host.setComplex(player, true);
        host.setSource(player, `
            world.handle = me.sync(["x", "y"], {rate: 30, interpolate: false, heartbeat: 0, ghost: {"effects.ghost": 40}});
        `);
        await step();
        client.arrive('p2', 'Ann');
        player.setXY(10, 0);
        await step(3);
        expect(client.sent[0].data).toEqual({s: {x: 10, y: 0}, f: 1});
        player.setXY(12, 0);
        await step(3);
        expect(client.sent[1].data).toEqual({s: {x: 12}, f: 0});
        expect(client.sent.length).toBe(2);
        client.say('p2', 'sync:Player', {s: {x: 50, y: -5}, f: 1, x: {team: 'red'}});
        const ghosts = player.sprite.clones.filter(c => c !== player);
        expect(ghosts.length).toBe(1);
        expect([ghosts[0].x, ghosts[0].y, ghosts[0].effects.ghost]).toEqual([50, -5, 40]);
        const api = host.instances.get(player).world.handle;
        expect(api.ghosts.size).toBe(1);
        expect(api.players.map(p => p.username)).toEqual(['Ann']);
        expect(host.instances.get(ghosts[0])).toBeUndefined();
        client.say('p2', 'sync:Player', {s: {x: 60}, f: 0});
        expect(ghosts[0].x).toBe(60);
        client.say('p2', 'sync:Player', {s: {size: 500}, f: 0});
        expect(ghosts[0].size).toBe(100);
        client.leave('p2');
        expect(ghosts[0].isDisposed).toBe(true);
        expect(player.sprite.clones.length).toBe(1);
    });

    test('me.sync smooths numbers, and snaps over a distance; shared mode drives the sprite itself', async () => {
        const client = fakeClient();
        const {host, player, step} = setup(vm => {
            vm.dimodGameClient = client;
        });
        client.arrive('p2', 'Ann');
        host.setComplex(player, true);
        host.setSource(player, 'me.sync(["x"], {interpolate: {delay: 100}, snap: 500, timeout: 0});');
        await step();
        client.say('p2', 'sync:Player', {s: {x: 0}, f: 1});
        const ghost = player.sprite.clones[1];
        await step(3);
        client.say('p2', 'sync:Player', {s: {x: 90}, f: 0});
        await step(2);
        expect(ghost.x).toBeGreaterThan(0);
        expect(ghost.x).toBeLessThan(90);
        client.say('p2', 'sync:Player', {s: {x: 1000}, f: 0});
        await step(12);
        expect(ghost.x).toBe(1000);

        host.setSource(player, 'me.sync(["x"], {mode: "shared", interpolate: false, id: "s"});');
        await step();
        client.say('p2', 'sync:Player:s', {s: {x: 77}, f: 1});
        expect(player.x).toBe(77);
        const before = client.sent.length;
        await step(4);
        expect(client.sent.length).toBe(before);
    });

    test('me.sync does nothing for clones, without a game server, and stops with the code', async () => {
        const {host, player, step} = setup();
        host.setComplex(player, true);
        host.setSource(player, `
            const s = me.sync("motion");
            world.info = [s.available, s.active, s.ghosts.size, me.remote];
            me.on("clone", () => { world.cloneSync = me.sync(["x"]).available; });
            me.clone();
        `);
        await step();
        expect(host.worldValues.info).toEqual([false, false, 0, null]);
        expect(host.worldValues.cloneSync).toBe(false);
    });
});
