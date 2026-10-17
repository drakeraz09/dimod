# Blockspace: Complex Sprites API Reference

> **Status:** on for everyone. It used to be behind a `?livetest` URL flag; that flag and
> `src/lib/dimod-livetest.js` are gone, and the runtime, blocks, collab sync, console and Code tab
> are installed by `src/lib/dimod-vm-patches.js` in every build (editor, player, embed). See §22.4
> for what was left open when it graduated.

A **complex sprite** is a sprite (or the stage) that runs a **JavaScript module** alongside
its block scripts. Its block scripts don't go away. They live inside the code as
**blockspaces**: named groups of scripts stored in the source text that run exactly like
ordinary scripts and can also be called from JS like functions.

This document covers everything a complex sprite's code can use, how that code runs, and
how the editor, storage and multiplayer layers behave around it.

> **User docs** live on the site at `/docs/blockspace` (frontend/src/views/BlockspaceDocsView.vue). The guide
> half is frontend/src/data/blockspaceGuide.js; the reference half is generated from `apiTypes`, `CATALOG` and
> `EXAMPLES` in src/lib/block-space/editor.js. After changing those, run `node docs/gen-blockspace-reference.js`
> from studio-src and commit frontend/src/data/blockspaceReference.json.

---

## Table of contents

1. [Mental model](#1-mental-model)
2. [Making a sprite complex and back](#2-making-a-sprite-complex-and-back)
3. [How code runs (lifecycle)](#3-how-code-runs-lifecycle)
4. [Globals](#4-globals)
5. [`me` / `TargetApi`: a sprite, clone or the stage](#5-me--targetapi)
6. [`world` / `WorldApi`: the whole project](#6-world--worldapi)
7. [Events](#7-events)
8. [Time, waits and loops (the frame clock)](#8-time-waits-and-loops)
   - [Tweens](#tweens)
9. [State: variables, lists, own values, `hold()`](#9-state)
10. [Blockspaces](#10-blockspaces)
11. [Running any block from JS](#11-running-any-block-from-js)
12. [Sound, pen, camera, input](#12-sound-pen-camera-input)
13. [Blocks added by Blockspace](#13-blocks-added-by-blockspace)
14. [Value conversion (`toCast` / `fromCast`)](#14-value-conversion)
15. [Errors, `Stopped` and the console](#15-errors-stopped-and-the-console)
16. [The Code tab (editor features)](#16-the-code-tab)
17. [Storage format](#17-storage-format)
18. [Multiplayer / collaboration sync](#18-multiplayer--collaboration-sync)
19. [VM events emitted](#19-vm-events-emitted)
20. [Internals map](#20-internals-map)
21. [Known quirks](#21-known-quirks)
22. [Ideas / future directions](#22-ideas--future-directions)
23. [Input actions: `world.input`](#23-input-actions-worldinput)
24. [Multiplayer sprites: `me.sync`, `relay`](#24-multiplayer-sprites-mesync-relay)
25. [Tests](#25-tests)
26. [Waiting for events: `once`](#26-waiting-for-events-once)
27. [Code tab tools: console, profiler, hot reload, errors](#27-code-tab-tools-console-profiler-hot-reload-errors)
28. [The library](#28-the-library)
29. [Second-player test windows](#29-second-player-test-windows)
30. [Animations: `me.animator`, `Animation`](#30-animations-meanimator-animation)
31. [`Position`](#31-position)
32. [Extensions as JS: `me.extensions`](#32-extensions-as-js-meextensions)
33. [Skins ("Turbo Skins"): `Skin`, `me.skin`](#33-skins-turbo-skins-skin-meskin)
34. [Iris Text: `me.iris`, `Iris`](#34-iris-text-meiris-iris)
35. [Widgets and suggestions for your own things: `editor`](#35-widgets-and-suggestions-for-your-own-things-editor)

---

## 1. Mental model

```
Sprite (complex)
├── sprite.dimod = { complex: true, source: "<JS text>", owners }
├── JS module ──── runs once per target: the original + one copy per clone
│                   each copy gets its own `me`; all copies share `world`
└── Blockspaces ── declared in the source: new Blockspace("id", {payload})
                    payload = the blocks (compact sb3 JSON) and is the saved copy
                    "materialized" into the sprite's real block container, where
                    they run like any script (hats included)
```

The main rules:

- **The source text is the source of truth.** Which blockspaces exist, and what blocks they
  contain, is read from the text (`source-scan.js`). No code has to run for that.
- **Editing never runs anything.** Typed code is saved to the sprite after a pause, and the
  blockspaces' blocks update straight away, but the JS only runs again on the **green flag**,
  on **Ctrl/Cmd+Enter** ("rerun"), or when the project loads.
- **Everything JS registers has an owner.** Handlers, loops, waits, timers and runs belong
  to one module instance. Disposing it (hot reload, clone deleted, sprite made blocks)
  cleans them all up.
- **JS resumes between frames.** After an `await`, JS continues in the microtask queue after the
  frame's synchronous work, so whatever it changes is drawn next frame, the same as a block
  thread's change.

---

## 2. Making a sprite complex and back

Right-click a sprite tile → **make complex** / **make blocks**. Both ask
for confirmation (`confirmSetComplex` in `focus.js`). Neither direction loses anything.

### Blocks → complex (`BlockspaceRuntime#setComplex(target, true)`)

1. Every top-level script is grouped by the blockspace it belonged to **last time the
   sprite was complex** (`sprite.dimod.owners`, `topBlockId → blockspaceId`). Scripts with
   no recorded owner go into **`"main"`**.
2. Workspace comments that aren't attached to a block also go into `"main"`.
3. If the old source still has a `new Blockspace("x", …)` for a group, its payload is
   rewritten in place. Blockspaces whose scripts were all deleted while the sprite was
   blocks get an empty payload.
4. New groups get a fresh `new Blockspace("id", {…});` line, inserted **after the leading
   comment lines** of the source.
5. Running threads for the moved scripts are stopped, and the blocks and comments are removed
   from the sprite. They immediately come back as materialized blockspaces
   (`_syncBlocks`).
6. The sprite is marked **pending**: its JS first runs on the next green flag.

A never-complex sprite starts from this default source:

```js
// This sprite is complex.

world.on("flag", async () => {

});
```

(The stage's reads `// The stage is complex.`)

### Complex → blocks (`setComplex(target, false)`)

- Every blockspace's blocks **stay in the sprite as ordinary scripts**.
- Which blockspace each top script came from is saved in `sprite.dimod.owners`, so the
  way back puts them where they were.
- The JS stops (every instance disposed). The source is **kept** on the sprite.
- `"when called"` scripts won't run any more (nothing calls them without the code).
- If a blockspace was open in the Blocks editor, it's flushed and closed.

### Stage

The stage can be complex. Its scripts move into code the same way. `me` is the stage, and
`me.clone()` throws (`The stage can't be cloned`).

### Other operations that respect complex sprites

| Operation | Behaviour |
|---|---|
| Duplicate sprite | Copies `dimod`. For a complex sprite the copy's materialized blocks are deleted, since its own code re-materializes them. |
| Drag scripts onto a complex sprite / backpack drop | `adoptLooseScripts`: loose scripts join `"main"` (created if missing). |
| Export sprite (`.sprite3`) | `extensionData.dimodBlockspace` is written for that one target. |
| Delete sprite | Instance disposed, `"delete"` handlers fire, holds dropped. |

---

## 3. How code runs (lifecycle)

### Evaluation

Each source is compiled once per target as the **body of an `async` function**:

```js
"use strict";{<your source>
}
//# sourceURL=blockspace/<SpriteName>.js
```

Consequences:

- **Top-level `await` works.**
- **Strict mode** always.
- Your code sits in its own block, so it can **shadow globals** (`const log = …` is fine).
- **Line numbers are preserved.** Errors are mapped back to your line via the
  `sourceURL` and a measured engine offset.
- Each copy (original and each clone) has **its own closure**. Plain `let`/`const` at the
  top level are per-copy and are **not** shared between clones.

### When code (re)starts

| Trigger | What happens |
|---|---|
| Project load | Originals start once *all* targets being added are in (microtask batch, `_queueStart`), so `world.getTarget("Other")` at the top level works. |
| Clone created | The clone's copy starts synchronously in `runtime.addTarget`. By the time `me.clone()` returns, the clone's top level has already run. |
| **Green flag** | `restartForFlag()`: world values emptied, sprite values emptied, holds with `reset:"flag"` reset, then **every complex original's code runs from the top again** (edited or not). This happens *after* the flag's stop-all and *before* any flag hats or `world.on("flag")` handlers. |
| Ctrl/Cmd+Enter in the editor | `applySource`: this sprite and all its clones stop and restart with the current source. World values are **not** cleared. |
| Code edited | Nothing runs. The sprite is marked **pending** (`DIMOD_BLOCKSPACE_PENDING`), and blockspaces re-materialize immediately. |
| Collaborator edits code | Same as your edit: pending until the green flag. |

### When code stops (instance disposed)

- Target deleted (clone deleted, sprite deleted, project closed).
- Hot reload (rerun / green flag).
- Sprite made blocks again.

Disposing an instance: all `world.on`/`me.on` handlers removed, all its waits rejected with
`Stopped('disposed')`, its loops and timers removed, its blockspace/block runs stopped,
and its wrapped `TargetApi`s forgotten.

### Stop sign vs. disposal

The **stop sign** (`PROJECT_STOP_ALL`, not from the flag):

- Rejects **every** pending wait with `Stopped('stop sign')` (silently).
- Ends `world.forever()` loops and `camera.follow()`, but **not** `world.on("tick")` or
  touch watchers (these are like hats: they keep being registered).
- Clears all `every`/`after` timers.
- Ends all blockspace runs (`status: "stopped"`).
- Resets holds with `reset: "stop"`.
- Dispatches `world.on("stop")`.
- Leaves event handlers registered, the same way the stop sign stops scripts but not their hats.

The green flag's internal stop-all does the same **except** it doesn't fire
`world.on("stop")`. (Holds with `reset:"stop"` *are* reset by it, since it is a stop-all.)

### Pause

While the project is paused (pause button), time stops for code too: no wait finishes,
no loop/timer/tick runs, `dt` is 0. Events that arrive while paused (keys, broadcasts,
changes) are **queued** and delivered on resume. The exception is `"delete"`, which is
delivered immediately.

---

## 4. Globals

Available at the top level of every complex sprite's code:

| Name | Type | Description |
|---|---|---|
| `me` | `MeApi` | This sprite, or this clone in a clone's copy. |
| `world` | `WorldApi` | The whole project. |
| `wait(seconds)` | `Promise<void>` | Waits on the project clock. Rejects with `Stopped` on stop sign/dispose. Non-finite → 0. |
| `waitUntil(fn)` | `Promise<void>` | Polls `fn()` once per frame (at step start). If `fn` throws, the promise rejects with that error. |
| `nextFrame()` | `Promise<number>` | Resolves next frame with that frame's `dt` (seconds, capped at 0.1). |
| `frames()` | `AsyncGenerator<number>` | Infinite: `for await (const dt of frames()) {…}`. Ends via `Stopped` on stop sign. |
| `repeat(n, fn)` | `Promise<void>` | Calls `await fn(i)` then waits a frame, `n` times (rounded, ≥0). |
| `tween(object, to, seconds, options?)` | `Tween` | Tweens any properties of any object along an easing. See [Tweens](#tweens). |
| `tween(seconds, options?)` | `Tween` | Tweens nothing: `onStep` gets an eased value every frame. |
| `fromCast(v)` | `any` | Scratch value → JS. Accepts a promise. |
| `toCast(v)` | `string\|number\|boolean` | JS value → Scratch. Accepts a promise. |
| `log(...values)` | `void` | Writes to this sprite's console (strings as-is, others `JSON.stringify`ed). |
| `Stopped` | class | The error cancelled tasks reject with. |
| `Blockspace` | class | `new Blockspace("id", payload?)`, see §10. |
| `Position` | class | A sprite's placement as one value: `new Position(x, y, direction, size, stretchX, stretchY)`, see §31. |
| `Skin` | class | What `me.skin` draws instead of a sprite's own costumes: `Skin.fromURL(url)`, `Skin.fromSVG(text)`, see §33. |
| `editor` | `EditorApi` | Tells the Code tab about your own things: `editor.props(...)`, `editor.value(...)`, `editor.args(...)`, `editor.snippet(...)`. Read from the text; does nothing when the code runs. See §35. |

---

## 5. `me` / `TargetApi`

`me` is a `TargetApi` for the running copy's target. `world.getTarget()`, `world.stage`,
`world.sprites`, `me.clone()`, `me.parent`, `me.clones`, `touchingAll()` and
`RunHandle.target` all hand back `TargetApi`s too. Every `TargetApi` belongs to the module
instance that made it: events registered through it (`enemy.on("click", …)`) are that
instance's.

Most setters throw `Stopped('target deleted')` if the target is gone, and `Stopped('disposed')`
if the calling instance was disposed. Most methods return `this` for chaining:

```js
me.goTo(0, 0).turn(15).move(10).setCostume("jump");
```

### Identity

| Member | Type | Notes |
|---|---|---|
| `name` | `string` | Sprite name (clones share it). |
| `id` | `string` | VM target id. |
| `isStage` | `boolean` | |
| `isClone` | `boolean` | `true` in a clone's copy. |
| `exists` | `boolean` | `false` once deleted. |
| `original` | `TargetApi` | The non-clone sprite (itself if not a clone). |
| `parent` | `TargetApi \| null` | Target this clone was cloned from (can be another clone). |
| `clones` | `TargetApi[]` | This sprite's clones (not the original). |

### Motion

| Member | Notes |
|---|---|
| `x`, `y` | get/set; set goes through `setXY` (fencing applies). |
| `angle` | Direction in degrees (90 = right, 0 = up). |
| `rotationStyle` | `'all around' \| 'left-right' \| "don't rotate" \| 'look at'` |
| `draggable` | boolean |
| `goTo(x, y)` / `goTo(place)` | `place`: `TargetApi`, sprite name, `{x, y}`, `"mouse"`, `"random"`. |
| `move(steps)` | Along `angle`. |
| `turn(degrees)` | Clockwise. |
| `pointAt(x, y)` / `pointAt(place)` | Sets direction toward a point. |
| `glide(seconds, x, y, easing?)` / `glide(seconds, place, easing?)` | `Promise`. Runs on the frame clock and is cancelled by the stop sign or deletion. `easing` is any tween easing (default linear). The target point is resolved **once** at the start. |
| `distanceTo(x, y)` / `distanceTo(place)` | Euclidean distance. |

An unknown sprite name throws `ReferenceError: No sprite named "X"`.

### Looks

| Member | Notes |
|---|---|
| `size` | percent |
| `stretchX`, `stretchY` | Dimod stretch (`target.stretch`). |
| `position` | `Position` (get/set): x, y, direction, size and stretch at once, see §31. Setting it on the stage throws. |
| `visible` | boolean |
| `layer` | Layer order. Setting moves forward/backward by the difference. |
| `costume` | get: name. set: name or 0-based index. |
| `costumeIndex` | 0-based. Set wraps around. |
| `costumes` | `string[]` of names. |
| `setCostume(nameOrIndex)` | Unknown name **throws** (unlike the block, which ignores it). Numbers wrap. |
| `nextCostume()` | |
| `effects` | Proxy: `me.effects.ghost = 50`, `me.effects.color`, `me.effects.clear()`. Any effect name the renderer knows works, including Dimod's `mosaic_x` / `mosaic_y` (scroll the costume inside its bounds, wrapping; 100 = one tile), `mosaic_width` / `mosaic_height` (copies across / down) and `invert` (0–100). |
| `tint` | The "tint color" effect: reads `"#rrggbb"` (`"#ffffff"` = none), takes `"#f00"`, `"#ff0000"`, `0xff0000` or `[255, 0, 0]`; `null` clears it. A bad colour string **throws**. `me.tween({tint: "#00f"}, 1)` fades it. |
| `say(msg?, seconds?)` / `think(…)` | Emits the same `SAY` event as the looks blocks. With `seconds` it resolves when the bubble is cleared, and only clears it if nothing else said something in between (same as "say for secs"). |
| `skin` | get/set: a `Skin` this sprite is drawn as instead of its own costumes, or `null` for its own costumes. See §33. |
| `skinFromCostume(name)` | A `Skin` showing exactly one of this sprite's costumes, for another sprite to borrow. See §33. |

### Sound, pen, camera

`me.sound`, `me.pen`, and `me.camera` (see §12).

### Animations

| Member | Notes |
|---|---|
| `animations` | This sprite's animations (its ANIMATIONS tab) as `Animation[]`. |
| `animation(thing)` | One animation: `"walk"` (this sprite's), `"Hero/walk"`, an animation value, JSON. Throws if there's none. |
| `animator` | What this sprite/clone is playing: `play`, `crossfade`, `stop`, `speed`, `time`, `part(name)`... Throws on the stage. |

See §30.

### Sensing

| Member | Notes |
|---|---|
| `touching(thing)` | `TargetApi` (exact drawable), sprite name (**any** of its clones), `"edge"`, `"mouse"`, or a colour (`"#ff0000"`, `"#f00"`, `[255, 0, 0]`, same as `touchingColor`). |
| `touchingAtAll(thing)` | `touching()`, but hidden sprites count too (this one, the other, or both). `TargetApi`, sprite name, `"edge"` or `"mouse"`; no colours. Same as the `<touching ( ) at all?>` block. |
| `touchingAll(spriteName)` | Every target of that sprite (original + clones) being touched, as `TargetApi[]`. |
| `touchingColor(colour)` | `"#rrggbb"` or `[r, g, b]`. |
| `colorTouching(colour, other)` | "color is touching color". |
| `ask(question)` | `Promise<string>`, same as "ask and wait" (speech bubble for sprites). |

### Blockspaces and blocks

| Member | Notes |
|---|---|
| `run(bs, ...args)` | Runs blockspace `bs`'s "when called" script **as this target** → `RunHandle`. |
| `blockspace(id)` | This sprite's blockspace by id, as a `BlockspaceRef`, so other code can run it: `enemy.run(enemy.blockspace("hurt"), 5)` (as enemy) or `me.run(enemy.blockspace("hurt"))` (enemy's blocks, as me). Throws if there's no such blockspace. |
| `runWith(bs, {restart}, ...args)` | `restart: true` stops this blockspace's other runs on this target first. |
| `block(opcode, args?)` | Runs any one command block as this target → `RunHandle`. |
| `reporter(opcode, args?)` | Runs any one reporter → `RunHandle` resolving to its value. |
| `ext(extensionId)` | Proxy of an extension's blocks by opcode: `me.ext("pen").penDown()`. |
| `extensions` | Every extension in the project as plain functions, run as this target straight away: `me.extensions.jwArray.get(1, list)`, see §32. |

See §10 and §11.

### Clones

| Member | Notes |
|---|---|
| `clone()` | **Synchronous.** Returns the clone's `TargetApi` (its code's top level has already run), placed behind this one. `null` at the clone limit. Throws on the stage. |
| `delete()` | Deletes this clone. Throws on an original. No-op if already deleted. |

A clone starts with a **copy** of its parent's own values (`me.hp`) and hold store, the way
Scratch copies sprite-local variables.

### State

`vars`, `lists`, `hold()`, and own values like `me.hp`. See §9.

### Tweens and functions for blocks

| Member | Notes |
|---|---|
| `tween(to, seconds, options?)` | Same as `tween(me, to, seconds, options)`: any of this target's properties, own values included. See [Tweens](#tweens). |
| `expose(name, fn)` | Makes `fn(arg, caller)` callable from the **call JS** blocks while they run as this target. Returns an unexpose function. See §13. |

### Events

`on("click" | "delete" | "touch" | "untouch" | "change", …)`. See §7.

---

## 6. `world` / `WorldApi`

One `WorldApi` per module instance (so handlers registered through it are that instance's),
all backed by the same project.

### Targets

| Member | Notes |
|---|---|
| `getTarget(name)` | Original sprite by name, or `null`. |
| `stage` | The stage's `TargetApi`. |
| `sprites` | Every original sprite (no clones, no stage). |

### Animations

| Member | Notes |
|---|---|
| `animation(thing)` | An animation by `"Sprite/name"`, value or JSON. |
| `animations` | Every sprite's animations. |
| `animationSmoothing` | get/set: anti-aliasing for animations that don't set their own. |
| `animationDetail` | get/set: `"low"`, `"medium"` or `"high"` for animations that don't set their own. |

See §30.

### Backdrop

| Member | Notes |
|---|---|
| `backdrop` | get: current name. set: name, `"next backdrop"`, `"previous backdrop"`, `"random backdrop"`. Setting starts "when backdrop switches to" hats (calls the real block). |
| `backdrops` | `string[]` |

### Messaging

| Member | Notes |
|---|---|
| `broadcast(name, data?)` | A **real** Scratch broadcast: starts "when I receive" hats and `world.on("broadcast", name)` handlers, which receive `data`. |
| `broadcastAndWait(name, data?)` | Resolves when every hat thread it started **and** every JS handler's promise has finished. Handles nested broadcasts. |
| `emit(event, ...args)` | **JS-only** event to every complex sprite's `world.on(event)`. Throws for reserved names (`flag`, `stop`, `tick`, `key`, `keyup`, `mousedown`, `mouseup`, `broadcast`, `backdrop`, `change`, `animation`, `animationend`). |
| `runAll(bs, targets, ...args)` | Runs a blockspace on every target at once. Resolves with their return values in order. Rejects if any run is stopped. |

### Extensions

| Member | Notes |
|---|---|
| `useExtension(id)` | Loads a **built-in** extension synchronously if not loaded (`"pen"`, `"pmCamera"`, …). Throws for non-built-ins. |
| `ext(id)` | Like `me.ext` but run **as the stage**: `world.ext("pen").clear()`. |
| `extensions` | Like `me.extensions` but run as the stage, see §32. |
| `camera` | Main camera (`"default"`). Needs `pmCamera`. |
| `cameras.get(name)` | A named camera. The same name always gives the same object, so `follow()`/`unfollow()` on it meet up. |
| `pen.clear()` | Clears the pen layer. |
| `pen.of(target)` | `PenApi` for any target. |

### State

`vars`, `lists`, `cloud`, `hold()`, and own values like `world.score`. See §9.

### Tweens and functions for blocks

| Member | Notes |
|---|---|
| `tween(to, seconds, options?)` | Tweens world's own values and properties, e.g. `world.tween({score: 100, "camera.zoom": 2}, 1)`. |
| `expose(name, fn)` | Makes `fn(arg, caller)` callable from the **call JS** blocks in **any** sprite (a target's own `me.expose` of the same name wins). Returns an unexpose function. |

### Input

| Member | Notes |
|---|---|
| `mouse.x`, `mouse.y`, `mouse.down` | Live, Scratch coordinates. |
| `keys.isDown(key)` | Scratch key names (`"space"`, `"a"`, `"up arrow"`, `"any"`). |
| `keys.down` | `Set<string>` of currently held keys, lower-cased (a fresh Set each read). |
| `ask(question)` | The stage prompt → `Promise<string>`. |
| `gamepad(index = 0)` | `{id, buttons: boolean[], axes: number[], button(i), axis(i)}` or `null`. A **snapshot** read straight from `navigator.getGamepads()`. |
| `stageWidth`, `stageHeight` | The stage size (see `world.on("resize")`). |
| `server` | The Dimod game server, see [§12](#worldserver-the-game-server). |
| `watch(expr, fn, {on}?)` | A hat for any condition, see [§7](#worldwatchexpr-fn-options). |

### Time

| Member | Notes |
|---|---|
| `timer` | Scratch project timer (seconds). |
| `resetTimer()` | |
| `now` | `new Date()`. |
| `forever(fn)` | `fn(dt)` every frame (at `BEFORE_EXECUTE`). Ends with the stop sign. Returns `Loop`. |
| `every(seconds, fn)` | Repeating timer (min interval 1 ms). Returns `{stop()}`. |
| `after(seconds, fn)` | One-shot timer. Returns `{stop()}`. |

---

## 7. Events

All `on()` calls return an **unsubscribe function**. Handlers may be `async`. Rejections are
reported to the console (except `Stopped`).

### `world.on(event, [filter], fn)`

| Event | Filter | Handler args | Fires when |
|---|---|---|---|
| `"preflag"` | none | `()` | Green flag: after every complex sprite's code has restarted, **before** any "when flag clicked" script or `"flag"` handler anywhere. A setup phase every sprite's flag code can count on. Runs synchronously (a promise it returns isn't waited for). |
| `"flag"` | none | `()` | Green flag, after all complex code has restarted and all `"preflag"` handlers have run. |
| `"stop"` | none | `()` | Stop sign (**not** the flag's internal stop). |
| `"tick"` | none | `(dt)` | Every frame. Survives the stop sign. Internally a clock loop. |
| `"key"` | key name or `"any"` (optional) | `(key)` lower-cased | Key pressed (`KEY_PRESSED`). |
| `"keyup"` | key name or `"any"` (optional) | `(key)` | Key released. |
| `"mousedown"` / `"mouseup"` | none | `()` | Mouse state changed. |
| `"broadcast"` | message name (optional) | `(data)` | Any broadcast, from blocks or `world.broadcast`. `data` is `null` from blocks. |
| `"backdrop"` | backdrop name (optional) | `()` | Backdrop switched (via hat dispatch). |
| `"change"` | value name (optional, **case-sensitive**) | `(now, was, name)` | A **world value** (`world.score`) set to something new (`Object.is` compare), from code or blocks. |
| `"cloud"` | variable name without `☁ ` (optional, case-sensitive) | `(value, name)` | A cloud variable was changed by **someone else** (another player, the server). This project's own sets don't fire it. |
| `"resize"` | none | `(width, height)` | The stage size changed. |
| `"animation"` | event name (optional) | `(event, sprite, animation, time)` | Any sprite's animation fired a timeline event (§30). |
| `"animationend"` | none | `(sprite, animation)` | A "once" play on any sprite reached its end. |
| any other string | none | `(...args)` | `world.emit(event, ...args)`. |

The game server's events are on `world.server.on(…)` (see [§12](#worldserver-the-game-server)).

Filters are **case-insensitive** (both sides lower-cased), except `"change"` and `"cloud"`
filters, which are value / variable names and so case-sensitive. Filter `"any"` matches everything.
Passing a filter to an event that doesn't take one throws (on `world` and on targets).
Using a sprite event (`click`, `delete`, `touch`, `clone`…) on `world` throws with a hint to
use `me.on`. Reserved names can't be `world.emit()`ted.

### `target.on(event, [filter], fn)` (`me.on`, `enemy.on`, …)

| Event | Filter | Handler args | Fires when |
|---|---|---|---|
| `"click"` | none | `()` | This sprite (or the stage) is clicked. De-duplicated: fires once per click. |
| `"delete"` | none | `()` | The target leaves the project (clone deleted, stop sign deleting clones, sprite deleted). Delivered even while paused. |
| `"touch"` | **required**: `TargetApi`, sprite name, `"edge"`, `"mouse"`, or a colour (`"#ff0000"`, `[255, 0, 0]`) | `()` | Edge-triggered: contact **starts**. Polled once per frame, survives the stop sign. The first frame only primes the state. |
| `"untouch"` | required | `()` | Contact **ends**. |
| `"change"` | value name (optional, case-sensitive) | `(now, was, name)` | One of **this target's own values** (`me.hp`) is set to something new. With a name, only that value. |
| `"clone"` | none | `()` | In a **clone's** copy of the code: it has just started as a clone (like "when I start as a clone"). Fires once, right after the clone's top level, so register it at the top level before any `await`. A rerun (Ctrl+Enter / flag) doesn't fire it again. |
| `"cloned"` | none | `(clone)` | This target just made a clone. Fires after the clone's own code (and its `"clone"`) has run, with the clone's `TargetApi`, so you can set it up. |
| `"costume"` | none | `(name, index)` | The costume switched, however it happened (blocks, code, next costume). |
| `"say"` | none | `(text, type)` | It said or thought something (`type` is `"say"` or `"think"`); `text` is `""` when a bubble goes away. |
| `"animation"` | event name (optional, case-insensitive) | `(event, animation, time)` | What this target is playing fired a timeline event (§30). |
| `"animationend"` | none | `(animation)` | A "once" play on this target reached its end. |

Handlers registered on *another* target (`enemy.on("click")`) belong to *your* instance
and go when your instance is disposed. They're also removed when that target is forgotten.

### Ordering on the green flag

1. VM stop-all (clones deleted → their `"delete"` handlers run, their instances disposed).
2. `restartForFlag()`: values emptied, `flag` holds reset, every complex original's top
   level runs again.
3. `world.on("preflag")` handlers run, in every sprite.
4. Scratch "when flag clicked" hats start.
5. `world.on("flag")` handlers run.

### `world.watch(expr, fn, options?)`

A hat for any condition. `expr` is called once per frame, with the per-frame loops.

```js
world.watch(() => world.score >= 10, () => world.broadcast("win"));          // becomes true
world.watch(() => me.costume, (now, was) => log(was, "->", now), {on: "change"});
```

| `on` | Fires |
|---|---|
| `"true"` (default) | `fn(value)` each time `expr()` goes from falsy to truthy. Truthy on the very first check counts, like Scratch's `when [timer] > (10)`. |
| `"change"` | `fn(now, was)` each time the value changes (`Object.is`). The first check only records where it starts. |

It keeps going after the stop sign (like a hat) and returns a function that removes it.
If `expr` throws, the error is reported once and the watch is removed.

---

## 8. Time, waits and loops

All timing is on one **frame clock** (`runtime/clock.js`), per VM frame:

```
RUNTIME_STEP_START   waits / nextFrame / waitUntil settle; every/after timers fire;
                     paused-event queue flushes; blockspace runs are checked
BEFORE_EXECUTE       world.forever() and world.on("tick") callbacks (synchronous)
block threads        the sequencer steps Scratch threads
draw
(microtasks)         JS continuations after `await` run here
```

- `clock.now` advances by real elapsed time per frame (so `wait(1)` ≈ 1 second, like the
  Scratch "wait" block).
- `dt` passed to per-frame callbacks is **capped at 0.1 s** so a backgrounded tab doesn't
  teleport things.
- A per-frame callback (`forever`, `tick`, touch watcher, timer) that **throws
  synchronously** is reported **once** and removed, so it doesn't spam every frame.

### `Loop` handle (from `world.forever`, `camera.follow`)

```ts
interface Loop { stop(): void; pause(): void; resume(): void; readonly running: boolean; }
```

`running` is `false` while paused **and** after `stop()` (or after the stop sign ended it).

### Idioms

```js
// forever, frame-rate independent
for await (const dt of frames()) {
    me.x += 120 * dt;
}

// fire-and-forget loop that the stop sign ends
const spin = world.forever(dt => me.turn(90 * dt));
spin.pause(); spin.resume(); spin.stop();

// wait for a condition
await waitUntil(() => me.touching("edge"));

// HUD tick that keeps going after the stop sign
world.on("tick", dt => { world.vars.fps = Math.round(1 / Math.max(dt, 1e-6)); });
```

### Tweens

Tweens move **any number of properties on any object** from where they are now to where you
say, over some seconds, along an [easings.net](https://easings.net) easing. They can also
move **nothing** and just hand you an eased value every frame. Implemented in
`runtime/tween.js`.

```js
// a sprite: any property, dotted paths, own values
await me.tween({x: 100, size: "+=50", "effects.ghost": 50, hp: 0}, 1, "easeOutBack");

// any object at all
tween(world.camera, {zoom: 2, angle: 15}, 1.5, "easeInOutSine");
tween(me.sound, {volume: 0}, 2);                       // fade out
tween(settings, {tint: "#ff8000", pos: [10, 0]}, 0.5);  // colours and number arrays

// nothing: just a value per frame
await tween(2, {from: 0, to: 360, easing: "easeInOutCubic", onStep: a => { me.angle = a; }});
tween(1, (v, progress) => log(v));                      // a function alone is onStep

// options
const t = me.tween({y: 0}, 3, {
    easing: "easeOutBounce",                  // name, or your own t => eased t
    from: {y: 200},                           // start values, set straight away
    onStep: (eased, progress, tween) => {}    // every frame, after the properties are set
});
```

#### Signatures

| Form | Meaning |
|---|---|
| `tween(object, to, seconds, options?)` | Tween `object`'s properties to `to`. |
| `me.tween(to, seconds, options?)` / `enemy.tween(…)` | Same with that target as the object. Called on the `me` proxy, so own values (`hp`) work. |
| `world.tween(to, seconds, options?)` | Same with `world` (own values, `"camera.zoom"`…). |
| `tween(seconds, options?)` | Tween nothing. A number as the first argument selects this form. |

`options` can be an **easing name**, an **easing function**, or an object:

| Option | Property tweens | Tweening nothing |
|---|---|---|
| `easing` | name or `t => eased` (default `"linear"`) | same |
| `onStep(value, progress, tween)` | `value` = eased progress (0–1, can overshoot for Back/Elastic) | `value` = `from + (to − from) × eased` |
| `from` | `{path: startValue}`, written immediately | number, default `0` |
| `to` | (not used, `to` is the second argument) | number, default `1` |
| `delay` | seconds before it starts (values are read when it's made) | same |
| `repeat` | how many **more** times it plays after the first; `Infinity` or `true` = forever (needs seconds > 0) | same |
| `yoyo` | every other play runs backwards (a yoyo with an odd `repeat` ends back at the start) | same |

When tweening nothing, a bare function as `options` is `onStep`. For property tweens a bare
function is the easing.

#### What `to` values can be

| Value | Tweens as |
|---|---|
| number / numeric string | number. A missing or non-numeric current value starts at `0`. |
| `"+=n"` / `"-=n"` | relative to the current value |
| `"#rrggbb"` / `"#rgb"` | colour, per channel, written back as `"#rrggbb"`. The current value may be hex or `[r, g, b]`. |
| `[n, n, …]` | element-wise, written back as a new array |

Anything else throws: `Can't tween "x" to {}: tweens take numbers, "+=n" / "-=n", "#rrggbb" colours or arrays of numbers`.

**Paths**: keys are property paths split on `.`, e.g. `"effects.ghost"`, `"sound.volume"`,
`"pen.color"`, `"camera.zoom"`, `"deep.nested.n"`. Everything before the last part is resolved
**once**, when the tween starts. A missing link throws (`Can't tween "nope.x": nope is undefined`).
Every frame the value is written with a plain assignment, so setters (`me.x`), own values
(`me.hp`, which fire `"change"`) and proxies (`effects`) all behave as if you'd assigned them.

#### Easings

`linear`, and `easeIn` / `easeOut` / `easeInOut` of `Sine`, `Quad`, `Cubic`, `Quart`, `Quint`,
`Expo`, `Circ`, `Back`, `Elastic`, `Bounce`, as on easings.net. Names are forgiving:
`"easeOutQuad"`, `"ease out quad"`, `"ease-out-quad"`, `"outQuad"` and `"OUTQUAD"` are all the
same. An unknown name throws and lists them all. Your own function gets linear progress 0–1
and should return 1 at the end.

#### `Tween` handle

```ts
interface Tween extends PromiseLike<void> {
    readonly status: 'running' | 'finished' | 'stopped';
    readonly running: boolean;
    readonly paused: boolean;
    readonly duration: number;
    readonly progress: number;   // 0-1, linear in time
    readonly value: number;      // what onStep last got
    readonly delay: number;
    readonly repeat: number;     // Infinity for forever
    readonly yoyo: boolean;
    readonly iteration: number;  // which play it's on, from 0
    readonly done: Promise<{status: 'finished' | 'stopped'}>;   // never rejects
    stop(): void;
    finish(): void;              // jump to the end values, then finished
    pause(): this;
    resume(): this;
}
```

`await tween` resolves when it finishes, and **rejects with `Stopped`** if it's stopped. Like
`wait()`, that ends an awaiting handler silently.

#### Timing and lifetime

- Steps with the per-frame loops (`BEFORE_EXECUTE`) and uses the clock's real elapsed time,
  so a 1 s tween takes 1 s (like `glide`, not capped like `dt`). It freezes while the project
  is paused, and `tween.pause()` freezes just that one.
- `seconds` of 0 (or negative / not a number) applies the end values **immediately**, and
  the tween is already `finished` when returned.
- Stopped by: the **stop sign**, `.stop()`, the code that made it being disposed (rerun, green
  flag, clone deleted), or the thing it writes to being deleted.
- An `onStep` or a write that throws is reported **once** and stops the tween.

---

## 9. State

There are four kinds of state. They differ in scope, lifetime, and whether blocks can see them.

| Kind | Syntax | Blocks see it? | Lifetime | Clones |
|---|---|---|---|---|
| Scratch variables/lists | `me.vars.x`, `world.lists.items` | Yes, real variables | Saved in project | Sprite-local vars copied (Scratch rules) |
| **Own values** | `world.score`, `me.hp` | Yes, via the **Values** blocks | Emptied on green flag. Not saved. | Copy of parent's |
| **Held values** | `me.hold({...})`, `world.hold({...})` | No | Survive hot reload. Reset per `reset` option. | Copy of parent's store |
| JS locals | `let n = 0` | No | One module instance (lost on reload) | Per copy |

### Scratch variables: `vars`

```js
me.vars.speed          // sprite-local first, then global (like a block)
me.vars.speed = 10     // toCast()'d; marks monitor stale
world.vars.score       // stage (global) variables only
me.vars.declare("hp", 3)                       // create sprite-local if missing
me.vars.declare("best", 0, {scope: "global"})  // on the stage
me.vars.declare("hi", 0, {scope: "cloud"})     // creates "☁ hi" on the stage
me.vars.has("hp")
Object.keys(me.vars)   // all visible scalar variable names
```

- Setting a variable that doesn't exist **throws** `ReferenceError` with a hint to
  `.declare()` it.
- Setting a **cloud** variable also calls `ioDevices.cloud.requestUpdateVariable`.
- `declare` returns the current value (or the list view) and never overwrites an existing
  variable. It triggers a palette refresh when it creates one.

### Lists: `lists`

```js
const items = me.lists.inventory;   // a *live* 0-based array view
items.push("sword");                 // writes go into the VM list (toCast'd), monitor refreshes
items[0];                            // reads
items.length;
me.lists.inventory = ["a", "b"];     // replace (any iterable)
me.lists.declare("queue", [], {scope: "global"});
```

The view always reads the list's **current** array. If a block like "delete all of" swaps the
underlying array, a view kept in a variable still follows it.

### Cloud: `world.cloud`

The project's cloud variables, on the same connection as the Client blocks and
`world.server`. Dimod's cloud variables aren't Scratch's numbers-only ones: a value is any
text up to **1 MB**, a room holds up to **128** variables, names go up to 256 characters.
`world.cloud` adds JS values on top: objects and arrays are stored as JSON and read back
parsed.

```js
world.cloud.best = 100;                         // same as world.vars["☁ best"] = 100
world.cloud.board = [{name: "a", score: 3}];    // stored as JSON; makes the variable if it isn't there
world.cloud.set("board", rows);                 // the same, and returns the value

world.cloud.best;                               // what the variable holds, as is ("[{...}]" is a string)
world.cloud.get("board");                       // parsed if it's JSON -> [{name: "a", score: 3}]
world.cloud.get("nope", []);                    // the fallback when there's no such variable
world.cloud.raw("board");                       // unparsed, same as world.cloud.board

world.cloud.has("board");  "board" in world.cloud;
world.cloud.names();       Object.keys(world.cloud);    // no ☁ in them
world.cloud.all();                              // {board: [...], best: 100}
world.cloud.delete("board");                    // for everyone in the room; true if it existed
delete world.cloud.board;

const off = world.cloud.on("board", (value, name) => redraw(value));   // someone else changed it
world.cloud.on((value, name) => log(name, value));                     // any variable
```

- **Parsing.** `get()`, `all()` and `on()` parse text that is JSON (`"7"` → `7`, `"[1,2]"` →
  `[1, 2]`, `"hi"` stays `"hi"`), the same way `world.server` reads incoming data. Plain
  `world.cloud.x` reads never parse.
- **Writing makes the variable.** Unlike `world.vars`, `world.cloud.x = v` doesn't need it made in
  the palette first, so a typo makes a new variable rather than throwing.
- **Method names win.** `get`, `set`, `has`, `delete`, `names`, `all`, `on`, `raw`, `available`,
  `connected` and `limits` are methods; a variable with one of those names is reached with
  `world.cloud.get("get")`. Assigning `world.cloud.get = 1` throws and says so.
- **Limits.** Too big a value, too long a name or too many variables throws a `RangeError`
  (`world.cloud.limits` has the numbers). The server enforces the same limits.
- **Rooms.** Every room has its own cloud variables (`world.server.join(room)`); only the default
  room of a published game keeps its values between sessions.
- **Your writes don't fire `on`.** Only changes from the server or other players do, including
  the server putting back a value its own logic rejected.
- **Rate.** Writes are coalesced (the latest value per variable goes out every 50 ms), and the
  server drops a player who sends over ~60 messages a second, so setting a variable every frame
  is fine.
- `world.cloud.available` / `.connected`: whether there's a game server to carry them at all (a
  project that isn't a cloud project, or an unsaved editor, has none: writes stay local).
- It's not atomic: two players writing the same variable at once, the last one wins. For a counter
  or a leaderboard, send the change to the server (`world.server.send`) and let its logic apply it.

### Own values: `world.score`, `me.hp`

Any property that isn't a built-in member becomes an **own value**:

```js
world.gravity = 9.8;         // shared by all complex code
me.hp = 3;                   // this target's
const enemy = world.getTarget("Enemy");
enemy.hp -= 1;               // another sprite's own value
Object.keys(world);          // just your own values (built-ins are non-enumerable)
delete me.hp;
"hp" in me;
```

- Any JS value (objects, functions, targets). Blocks read them `toCast()`'d.
- Assigning to a **built-in name** throws: `world.stage is built in, pick another name for
  your value`. Built-ins with setters (`me.x = 10`) still work.
- Setting to a new value (`!Object.is`) fires `"change"` handlers.
- **Emptied on every green flag**, before code reruns, so your top level sets them up
  afresh. Rerun (Ctrl+Enter) doesn't clear them.
- Not saved in the project.
- The editor autocompletes names assigned anywhere in the project's complex code
  (`world.x =`, `me.x =`, `someVar.x =` where `someVar` came from `world.getTarget(`,
  `world.stage`, `me.clone(`, `me.original`, `me.parent`) or in Values blocks. Reading a
  name set nowhere is flagged as a type error.

### Held values: `hold()`

```js
const state = me.hold({combo: 0, best: 0});
const g = world.hold({level: 1}, {reset: "never"});
state.combo++;
```

- Returns the **same live object** every call. Keys already held keep their current value,
  so the object **survives hot reloads**. New keys get their defaults.
- `reset`: `"flag"` (default) resets to defaults on green flag; `"stop"` on stop sign
  (and on the flag's internal stop); `"never"` never; **`"save"`** never, and the values
  are **kept in the project file** (see below). The mode is per key and the last `hold()`
  call wins.
- Defaults and copies use `structuredClone` (falls back to sharing uncloneable values).
- Clones get a deep copy of their parent's store when they start.
- Not visible to blocks. Only `reset: "save"` keys are saved in the project.

**Saved holds** (`reset: "save"`):

```js
const progress = me.hold({bestTime: null, unlocked: 1}, {reset: "save"});
const settings = world.hold({volume: 80}, {reset: "save"});
```

- Written into the project file whenever the project is saved: the sprite's under
  `extensionData.dimodBlockspaceSaved`, world's on the stage under
  `extensionData.dimodWorldSaved`. Only the original sprite's values are saved, not clones'.
- When the project opens, those values are used **instead of the defaults** the first
  time `hold()` asks for them.
- Values go through JSON: functions, targets and anything else JSON can't hold are left
  out. Changing a saved value doesn't mark the project as changed by itself.
- This is **editor-time** persistence (level tuning, designer settings): a published game's
  players don't save the project. For per-player saves, use cloud variables or the game
  server.

---

## 10. Blockspaces

A **blockspace** is a named set of block scripts that belongs to the code.

```js
const jump = new Blockspace("jump", {"params":["height"],"blocks":{…},"comments":{},"ext":[]});
```

The editor normally **hides the payload**, so you see and type:

```js
const jump = new Blockspace("jump");
```

and a **blocks · 7 · (height)** button at the end of the line opens it in the Blocks
editor.

### Declaration rules (enforced by `source-scan.js`)

- The id must be a **string literal** (`"…"` or `'…'`). Anything else is flagged in the
  editor (`new Blockspace() needs a plain string id`).
- The payload must be an **object literal of plain JSON**.
- Ids must be unique per sprite. Duplicates are flagged in the editor, and throw at runtime
  (`Two blockspaces are called "x"`).
- `new Blockspace(` inside comments, strings, template literals or regexes doesn't count.
- A call with **no payload** creates a fresh blockspace containing only its "when called" hat.
- A payload that is present but **doesn't parse** (half-typed) leaves the existing blocks
  alone instead of wiping them.
- **Removing the line removes the blocks** (they're unmaterialized, and running threads stopped).

What exists is decided by the **text**, not by execution. A `new Blockspace` inside an `if`
that never runs still materializes. The runtime value is a shared per-sprite
`BlockspaceRef`.

### Payload format

```jsonc
{
  "params":   ["height", "label"],   // "when called" parameter names, in order
  "blocks":   { /* compact sb3 block map (sb3.serializeBlocks) */ },
  "comments": { "<id>": {blockId, text, x, y, width, height, minimized} },
  "ext":      ["pen"]                // extensions the blocks need; built-ins auto-load
}
```

On materialize, block ids are kept unless they collide with **another** blockspace's blocks
in the same sprite (e.g. copy-paste), and then the whole payload gets fresh ids. Materializing
never marks the project changed.

### `BlockspaceRef`

| Member | Notes |
|---|---|
| `id` | string |
| `params` | current parameter names (copy) |
| `exists` | `false` once its line is gone from the code |
| `toString()` | `"Blockspace(jump)"` |

### What runs inside a blockspace

- **Event hats** (green flag, key pressed, when I receive, clone start…) run like any
  sprite script. Making a sprite complex keeps its behaviour identical.
- The **"when called"** hat never starts on its own. It is started by `me.run(bs, …)`.
  Multiple concurrent runs on one target are allowed (`restartExistingThreads: false`).

### Running: `target.run(bs, ...args)` → `RunHandle`

```js
const add = new Blockspace("add");                 // when add called (a) (b): return (a + b)
const sum = await fromCast(me.run(add, 2, 3));     // 5
```

- Args fill params **in order** (`toCast`'d). Missing args are `""`. Extra args are ignored.
- It can run **as any target**: `enemy.run(jump, 50)` runs *this sprite's* `jump` script with
  `enemy` as the target (the thread's `targetBlockLocation` is this sprite's blocks).
- Throws `TypeError` if not given a blockspace, `ReferenceError` if it's gone from the code,
  `Error` if it has no "when called" hat, and `Stopped` if the target is deleted.
- The editor types `me.run(jump, …)` parameters per blockspace id (`BlockspaceParams`).

### `RunHandle`

```ts
interface RunHandle extends PromiseLike<any>, AsyncIterable<any> {
  readonly blockspace: BlockspaceRef | null;  // null for me.block()/reporter()
  readonly target: TargetApi;
  readonly running: boolean;
  readonly status: 'running' | 'returned' | 'finished' | 'stopped';
  readonly value: any;                          // last returned value
  readonly done: Promise<{status, value}>;      // never rejects
  stop(): void;
  then / catch / finally
}
```

| Status | Meaning |
|---|---|
| `returned` | A `return ()` block ran. `value` is its (Scratch) value. |
| `finished` | The script ended without `return` (fell off, "stop this script", killed by another script's non-stop). `await` → `null`. |
| `stopped` | `.stop()`, stop sign, target deleted, blockspace removed, owner disposed, or a block threw. `await` **rejects with `Stopped`**. |

**Streaming with `yield`:**

```js
for await (const step of me.run(pathfinder, targetX, targetY)) {
    log("step", step);
}
```

Yields buffer until read. After `stop()` any unread yields are dropped and the loop ends.

**Restarting:** `me.runWith(bs, {restart: true}, …args)` stops this blockspace's other runs
**on this target** first.

**All at once:** `await world.runAll(bs, world.getTarget("Enemy").clones, dmg)`.

### Editing a blockspace as blocks

Click **blocks** (or use the **Add blockspace** plus in the toolbar to create one below the caret and open it).
The Blocks editor then shows **only that blockspace's scripts and comments**, with a
focus bar on top. While it's focused:

- A **Blockspace** toolbox category appears with an **Edit parameters** button (prompt, comma
  separated), the "when called" hat, one reporter per parameter, `return ()`, `yield ()`,
  then the call JS blocks, the world value blocks and the my value blocks. Groups are
  separated by gaps (a `<sep gap="36"/>`, what an extension's `"---"` becomes), not labels.
- Every edit is written back into the payload in the code **250 ms** after edits settle
  (`Blockspaces#sync`). The code is **not** re-run.
- Anything on the sprite not owned by another blockspace belongs to the focused one, so
  new scripts made there join it.
- The workspace cache is disabled while focused.
- Switching sprites, clicking back, or making the sprite blocks closes the focus.

---

## 11. Running any block from JS

```js
await me.block("motion_glidesecstoxy", {SECS: 1, X: 0, Y: 0});
const answer = await me.reporter("sensing_answer");
await me.ext("pen").penDown();
const vol = await fromCast(me.ext("music").getTempo());
await world.ext("pen").clear();
```

- The block runs as a **real thread** on the target, so blocks that wait (glide, say for
  secs, play until done) behave normally.
- Each arg is given as **both** an input (a `text` shadow) **and** a field of the same name,
  so it reaches the block either way. Values are `toCast`'d.
- Reporters are wrapped in a `return` block; the handle resolves with the value.
- These one-off scripts live in a private block container, are **interpreted, not compiled**,
  and are deleted when done.
- Unknown opcode → `ReferenceError` with a hint about `me.ext()`.
- `ext(id)` throws if the extension isn't loaded. Unknown block name → `ReferenceError`.
  Reporter vs command is taken from the extension's own `blockType`.
- An exception inside the block ends the run and is logged **at the line that started it**.

---

## 12. Sound, pen, camera, input

### `me.sound`: `SoundApi`

| Member | Notes |
|---|---|
| `names` | this target's sound names |
| `play(name)` | `Promise` resolving when finished. Unknown name throws. |
| `start(name)` | fire and forget |
| `stopAll()` | |
| `volume` | 0–100 |
| `pitch`, `pan` | pan -100 (left) … 100 (right) |
| `echo`, `reverb`, `lowpass`, `highpass`, `distortion` | 0 (off) … 100 |
| `clearEffects()` | |
| `overlap(name, on = true)` | playing that sound while it plays starts another copy instead of starting over; `stopAll()` still stops every copy. Not saved with the project. |
| `overlaps(name)` | |

Parallax background, scrolling forever inside its own bounds:

```js
for await (const dt of frames()) me.effects.mosaic_x += 20 * dt;   // 20% of the width per second
```

### `me.pen`, `world.pen.of(t)`: `PenApi` (needs Pen)

Chainable `down()`, `up()`, `stamp()`. Props: `isDown` (ro), `color` (`"#rrggbb"`
get; set hex / Scratch colour / `[r,g,b]`), `size`, `transparency` (0–100).
`world.pen.clear()` clears the canvas.

Accessing `me.pen` without the extension throws:
`Pen needs the Pen extension, add it from the extension library or call world.useExtension("pen") first`.

### Camera: `CameraApi` (needs `pmCamera`)

| Member | Notes |
|---|---|
| `name` | camera name |
| `x`, `y`, `angle` (deg, 0 upright), `zoom` (1 = normal, min 0.0001) | get/set |
| `goTo(x, y)` / `goTo({x, y})` | chainable |
| `move(dx, dy)` | chainable |
| `glide(seconds, x, y, easing?)` | frame-clock tween, any tween easing |
| `follow(target, {smoothing})` | Every frame, centres on `target`. `smoothing` 0 (snap) … 0.99 (lags a lot). Returns `Loop`. Ends with the stop sign. |
| `unfollow()` | |

`me.camera`: get the bound camera name. Set a name / `CameraApi` to bind, or `null` to unbind
(draws straight to the stage, e.g. a HUD).

### Input

See `world.mouse`, `world.keys`, `world.gamepad()`, `world.ask()`, `me.ask()` in §6/§5.

### `world.server`: the game server

The same connection, rooms and data as the **Client** blocks (`dimod-client-blocks.js`,
`dimod-game-client.js`), from JS (`runtime/server-api.js`). Anything that isn't a string is
sent as JSON, and data that parses as JSON comes back parsed.

```js
world.server.on("data", data => {             // parsed if it's JSON
    if (data.type === "move") world.getTarget("Ghost").goTo(data.x, data.y);
});
world.server.on("connect", () => log("online as", world.server.me.username));
world.server.send({type: "move", x: me.x, y: me.y});
const best = await world.server.ask({type: "best"});  // null if no answer within 10 s
world.server.join("level-2");
```

| Member | Notes |
|---|---|
| `available` | `false` where there's no game server (see below). |
| `connected` | Connected and welcomed. |
| `ping` | Round trip in ms, as of the last ping (reading it sends a new one). |
| `players` | Players in this room. |
| `room` | The room it's in (`"default"` at first). |
| `me` | `{username, id, isGuest}`, or `null` before connecting. |
| `send(data)` | Same as "send () to the server". |
| `ask(data)` | `Promise`: the server's answer (parsed), or `null` with no answer in 10 s. |
| `join(room)` | Same as "join room ()". |
| `connect()` / `disconnect()` / `reconnect()` | Same as the blocks; `disconnect` stays closed until `reconnect` or a restart. |
| `on("data", fn(data))` | When the server sends data, alongside "when I receive (data)". |
| `on("connect", fn)` / `on("disconnect", fn)` | Alongside "when connected / disconnected". |
| `roster` | The other players in this room: `[{id, username, isGuest}]`. |
| `relay(channel, data, {to}?)` | Straight to the room's other players (or one), **without** server logic: your game's code talking to itself. Up to 16 KB, only sent while connected. See §24. |
| `on("relay", [channel], fn(data, from, channel))` | What another player relayed (parsed if JSON; `from` is `{id, username, isGuest}`). |
| `on("join", fn(player))` / `on("leave", fn(player))` | A player arrived in / left this room. |

- Every method and `on()` **connects** if needed, so a JS-only project connects as soon as its
  code uses `world.server`.
- `on()` returns the off function, and handlers go when the code is disposed, like any
  `world.on`.
- The game client only exists where there's a game to connect to: a **saved** project's
  editor (`/editor?p=…`, test mode) or a **published game** (`?dimod_id=…`). Anywhere else
  it's quietly offline: `available`/`connected` are `false`, `send` does nothing, `ask`
  resolves with `null`, and handlers never fire.
- Cloud variables (`world.cloud`, see §9) go through the same server. For changes made by other
  players use `world.cloud.on(name, fn)` (or the raw `world.on("cloud", name, fn)` event, which gives
  the unparsed text).

---

## 13. Blocks added by Blockspace

All opcodes use the core `event_` prefix so they save/load like built-ins, and are
registered with the compiler's compat layer (they work compiled and interpreted).

### Blockspace category (only while a blockspace is open), colour `#3AB5A4`

| Block | Opcode | Behaviour |
|---|---|---|
| `when <id> called (a) (b)…` | `event_dimod_blockspace_whencalled` | Hat, started only by `run()`. Params come from the payload / mutation `params` JSON. |
| `(a)` | `event_dimod_blockspace_argument` | The current run's arg by NAME, or `""` outside a run. Drag copies out of the hat. |
| `return ()` | `event_dimod_blockspace_return` | Cap block. Ends the run with a value, stops this script. |
| `yield ()` | `event_dimod_blockspace_yield` | Sends a value to `for await` without ending. |

Below those it has every Values-category block too (call JS, call blockspace, tween, world
values, my values), separated by gaps.

### Values category, colour `#E0922E`

| Block | Opcode | JS equivalent |
|---|---|---|
| `(world value [score])` | `event_dimod_world_value` | `world.score` (`""` if unset) |
| `set world value [score] to ()` | `event_dimod_world_setvalue` | `world.score = v` |
| `change world value [score] by ()` | `event_dimod_world_changevalue` | `world.score = +world.score + n` |
| `(my value [hp])` | `event_dimod_my_value` | `me.hp` |
| `set my value [hp] to ()` | `event_dimod_my_setvalue` | `me.hp = v` |
| `change my value [hp] by ()` | `event_dimod_my_changevalue` | `me.hp = +me.hp + n` |

Blocks write the raw Scratch value (a string like `"9"` stays a string). Blocks setting
values fire JS `"change"` handlers too.

The Values category (world values, my values, the call blocks, the tween block, separated
by gaps) is there for every sprite. While a blockspace is open, all of these blocks are
also in its Blockspace category.

#### Typeable menus

The `[name]`, `[id]`, `[sprite]`, `[property]` and `[easing]` slots are dropdowns **you can
also type into** (a `field_textdropdown` in a round white shadow, like an extension's
typeable menu). Whatever you type is used as-is. The choices are worked out each time the
menu opens:

| Menu | Opcode | Choices |
|---|---|---|
| call JS name | `event_dimod_calljs_menu` | Functions exposed right now, plus every `.expose("name"` in the project's complex code (so they show before the code has run). |
| blockspace id | `event_dimod_blockspace_menu` | The blockspaces of the sprite named in the same block's `[sprite]` slot. |
| sprite | `event_dimod_sprite_menu` | `myself`, every sprite, `Stage`. |
| tween property | `event_dimod_tweenprop_menu` | `x`, `y`, `direction`, `size`, `stretch x/y`, `ghost`, `color`, `brightness`, `fisheye`, `whirl`, `pixelate`, `mosaic`, `volume`, `pitch`, `pan`. |
| easing | `event_dimod_easing_menu` | All easings.net names. |

The menus have no primitive: they're one-field shadows, which the compiler and interpreter
both read as their value.

#### Blocks with any number of arguments

`call JS` and `call blockspace` take **any number of arguments**. **Right-click** the block →
**Add an input** / **Remove an input**. The count is the block's mutation
(`<mutation argcount="2">`) and the inputs are `ARG`, `ARG1`, `ARG2`… With 0 arguments the
"with" goes away. When the count goes down, the VM drops the extra inputs and their blocks.
Blocks saved before this existed have no mutation and count as 1 argument.

#### Calling code

| Block | Opcode | Behaviour |
|---|---|---|
| `call JS [name] with () ()…` | `event_dimod_calljs` | Command. Calls the function and waits if it returns a promise. |
| `(call JS [name] with () ()…)` | `event_dimod_calljs_reporter` | Reporter. Its value is what the function returned (`toCast`'d), after waiting for a promise. |

```js
// in any complex sprite's code
me.expose("heal", (amount, caller) => { me.hp += amount; return me.hp; });
world.expose("fetchScore", async name => (await loadScore(name)).best);
```

- The function is called as `fn(...args, caller)`: each "with" value `fromCast`'d
  (`"5"` → `5`), in order, then the target running the block as a `TargetApi`. With the
  usual one argument that's `fn(arg, caller)`.
- Lookup: the **running target's** own `me.expose` function first, then `world.expose`'s.
  Blocks in **any** sprite (complex or not) can call `world` functions.
- `me.expose` in a clone's copy registers for that clone, so each clone can have its own.
- Registering a name again replaces it. `expose()` returns a function that removes it. The
  code being disposed (rerun, flag, clone deleted, sprite made blocks) removes it too.
- No such function → `""` and a console error on the calling sprite
  (`No JS function "x" for the call JS block, expose one with …`).
- The function throws or rejects → `""` and the error is reported at its own line.
- Both blocks work compiled and interpreted.

#### Calling blockspaces

| Block | Opcode | Behaviour |
|---|---|---|
| `call blockspace [id] of [sprite] with () ()…` | `event_dimod_callblockspace` | Command. Runs that blockspace's "when called" script and waits for it to end. |
| `(call blockspace [id] of [sprite] with () ()…)` | `event_dimod_callblockspace_reporter` | Reporter. What it returned (`""` if it just ended). |

- `[sprite]` = `myself`: the running sprite's own blockspace, **run as itself** (clones
  included). Another sprite's name, or `Stage`: that one's blockspace, run as it (the
  original).
- Arguments fill the "when called" parameters in order.
- Works from any sprite, complex or not (the target sprite must be complex to have
  blockspaces).
- No such sprite or blockspace → `""` and a console error on the calling sprite.

The JS side of the same thing is `target.blockspace(id)` (§5).

#### Tween block

| Block | Opcode | Behaviour |
|---|---|---|
| `tween [x] to () in () secs [easeOutQuad]` | `event_dimod_tween` | Tweens one property of the sprite running it and waits until it's done. |

- `[property]` is a friendly name from the menu (`direction` → `angle`, `ghost` →
  `effects.ghost`, `volume` → `sound.volume`…) or **any path you type**, same as
  `me.tween`, so own values work too (`hp`).
- The value can be a number, `"+=n"` / `"-=n"`, or a `"#rrggbb"` colour.
- It stops when its script is stopped (like glide), with the stop sign, or when the sprite
  is deleted. Errors (a bad easing name, say) go to the sprite's console.
- Tweens and runs that blocks start belong to a per-target **block owner**
  (`runtime/block-owner.js`) rather than to a copy of the code, so they work in any sprite.

---

## 14. Value conversion

| Function | Behaviour |
|---|---|
| `toCast(v)` | `null`/`undefined` → `""`; number/string/boolean unchanged; an `Animation` → the animation value (what `(animation [ ])` reports), and an animation value stays one; a `Position` → its JSON text (which the Positions extension's blocks read); anything else with a `[Symbol.for("dimod.toCast")]()` method → what that returns; else `JSON.stringify` (fallback `String`). Promises → promise of the cast. |
| `fromCast(v)` | Strings: `"true"`/`"false"` → booleans; finite numeric (after trim, non-empty) → number; else unchanged. Non-strings unchanged. Promises → promise. |

Where conversion happens automatically:

- `toCast`: writing vars/list items, run args, `me.block` args, `say` text, `ask` question.
- **Not** automatic: `await me.run(...)` returns the raw Scratch value, so wrap it in
  `fromCast(...)`.

---

## 15. Errors, `Stopped` and the console

### `Stopped`

`class Stopped extends Error`, message `Blockspace task stopped (<reason>)`. Reasons:
`stop sign`, `disposed`, `target deleted`, `run stopped`.

- Never reported as an error, whether from handlers, the top level, or unhandled rejections
  (a global `unhandledrejection` listener swallows it).
- Catch it to clean up:

```js
try { for await (const dt of frames()) { … } }
catch (e) { if (!(e instanceof Stopped)) throw e; }
finally { me.effects.clear(); }
```

### Error reporting

- Sync throws and async rejections in the top level, handlers, loops and timers go to the
  sprite's console as `Name: message`, with the **user's line number** when the stack
  contains it.
- A block throwing inside a `run()` ends that run and logs
  `In blockspace "jump" (run as Enemy): TypeError: …` at the **`me.run()` line**.
- The newest error with a line is **marked in the editor**.

### Console (`console-store.js`)

- Per sprite (clones log into the original's console, tagged as clone).
- Max 200 lines. Identical consecutive lines collapse into a counter (`×12`).
- Sprite tiles show a **badge** for unseen errors. Opening the console marks them seen.
- Cleared on new project.

---

## 16. The Code tab

When the selected sprite is complex, the GUI mounts `BlockSpacePanel` (Monaco) instead of
Blocks.

| Feature | Details |
|---|---|
| **Types / IntelliSense** | `api-types.js` (static) + `project-types.js` (per project: sprite, costume, sound, backdrop, broadcast, variable, list names, blockspace params, own-value names). Refreshed 1 s after project changes. Unknown strings are still allowed (`AnyName`). Top-level `await` is allowed by the TS config. Also read from the code itself: the **input actions** it makes (`world.input.actions({jump: ...})`, `bind("jump", ...)`) complete in `down` / `pressed` / `axis` / `on`, **relay channels** (`world.server.relay("chat", ...)`) in `relay` / `on("relay", ...)`, and **cloud variables** (☁ variables and `world.cloud.set("best", ...)`) in `world.cloud` calls. Own values get the type of what's assigned to them when every assignment is a literal (`me.hp = 3` makes `hp` a `number`, `world.name = "x"` a `string`), and stay `any` otherwise. |
| **Suggestions** | They open as you type (60 ms), inside strings too (`world.on("key", "sp…` offers key names, `me.costume = "…` the costumes), without words-from-the-file noise. Parameter hints cycle with ↑/↓ and hovers stay open so they can be scrolled. |
| **Code lint** | `source-lint.js` marks what TypeScript can't see, as you type: a loop that never awaits (`while (true) { … }`, an **error**: it would freeze the game) and `wait()` / `waitUntil()` / `nextFrame()` / `repeat()` / `glide()` / `broadcastAndWait()` called without `await` (a warning). Comments and strings are ignored. |
| **Event names** | Inside `on("...")` / `once("...")` the editor lists every event that receiver has, each with what it means, what its function gets, its optional or needed second argument and an example (`events-catalog.js`, `event-completions.js`). It works for `world`, `me` or any sprite variable, `world.server` and a sync handle - found by asking the language service what the receiver is - and picking one writes the whole call, filter and function included: `world.on("key` becomes `world.on("key", key => { ... })`. The functions' arguments are typed per event, `touch` / `untouch` are an error without what they touch, and your own `world.emit` events work as before. |
| **Examples** | The toolbar's Examples button opens a list of short scripts with plain labels (Moving, Looks and sound, Clones, Game, Messages and timing, Multiplayer, Other - `examples.js`). Each is shown coloured exactly as the editor colours code; **Put in** adds it at the cursor (below the current line, or on an empty one), and double-clicking does the same. Typing `ex` in the code also suggests them as `example: ...`. |
| **Autosave** | 700 ms after typing stops, writes the source to the sprite (doesn't run it). |
| **Save** | Toolbar button (the download-tray icon): writes the source to the sprite **now** (doesn't run it), and the icon becomes a green tick briefly. **Ctrl/Cmd+S** in the editor does the same, then carries on to the normal project save, so the save includes every keystroke. |
| **Pending indicator** | Shows when edited code hasn't run yet. |
| **Rerun** | Toolbar button or Ctrl/Cmd+Enter: saves, then restarts this sprite's code now. |
| **Find** | Ctrl/Cmd+F inside the editor opens Monaco's own find (the project find bar leaves editor keys alone). |
| **Payload hiding** | The editor shows a *view* without payloads (`source-view.js`). **Show block data** toggles the raw text. |
| **blocks buttons** | Content widgets at the end of each `new Blockspace` line: block count, params, pulse while runs are going, and a **hover preview** of the scripts (350 ms delay). |
| **+ Blockspace** | Inserts a new empty blockspace under the caret and opens it. |
| **Rename carries blocks** | If exactly one id vanished and one unknown id appeared, it's treated as a rename. |
| **Undo restores blocks** | Payloads seen this session are remembered, so deleting a line and undoing brings the blocks back. |
| **Copy/paste carries blocks** | Copy puts the full text (with payloads) on the clipboard. Paste pulls payloads back out, and a colliding id is renamed `jump` → `jump2`. Works across sprites. |
| **Snippets** | `flag`, `key`, `broadcast`, `click`, `touch`, `forever`, `repeat`, `clone`, `hold`, `blockspace`, `run`, `stop`, `tween`, `tweennothing`, `expose`, `preflag`, `startasclone`, `watch`, `server`, `cloud`, `once`, `input`, `test`, `sync`, `relay`, `hot`, `move`, `glide`, `say`, `touching`, `spawn`, `every`, `after`, `try`, `ask`, `roster`, `syncevents`, `cloudset`, `join` (not offered after a `.`; each shows the code it writes beside the list). |
| **Property widgets** | Values the project describes with `editor.props()` / `editor.value()` / `editor.args()` get a chip in front of them: drag a number, tick a toggle, pick from a list, turn a dial, or use the colour picker. The properties not written yet, the choices inside quotes and the project's own `editor.snippet()`s are suggested. An `editor.*()` call that can't be read from the text is underlined. See §35. |
| **Colour picker** | Any string that is nothing but a colour (`"#f80"`, `"#ff8800cc"`, `"rgb(255, 136, 0)"`, `"hsla(32, 100%, 50%, 0.5)"`) has a swatch in front of it, and hovering it opens the colour picker, as in VS Code. Clicking the picker's header switches between hex, rgb and hsl; the way it was written comes first. Nothing has to be described for this. |
| **Id diagnostics** | Duplicate / non-literal blockspace ids are underlined as you type (150 ms). |
| **Live values on hover** | Hovering `me.x`, `world.vars.score`, `enemy` (a const bound to a target), a hold (`state.combo`) or a blockspace shows the **current** value from the running copy. It only reads properties and never calls anything. Blockspaces show block count, params and running count. |
| **Console / Values / Inspector tabs** | Console: logs and errors. Values: world's and this sprite's own values, refreshed every 300 ms. **Inspector**: for the sprite and each clone (first 20), everything its code has going (handlers, loops, tweens with their progress, `touch` watchers, `watch`es, timers, blockspace runs, pending waits, exposed functions, held values), refreshed every 300 ms, with a **✕** to stop each handler, loop, tween, timer or run. |
| **Console prompt** | Under the Console tab, a small Monaco editor (with completion for `me.` and `world.`): **Enter** runs it as this sprite, **Shift+Enter** is a new line, **↑/↓** walk through history. See §27. |
| **Toolbar icons** | The toolbar is icon buttons, all reused from the editor itself (`components/block-space/icons.js`; hover one for its name and what it does): the warning triangle with a count goes to the next error; the lightning bolt is **Hot reload** (§27, highlighted while on); the purple puzzle piece is **Library** (§28); the green tick is **Run tests** (§25); the tray with an arrow is **Save**; the circular arrow is **Rerun**; the plus is **Add blockspace**; the eye is **Show / Hide block data**; the red block is **Make sprite blocks** (red because it stops the sprite's code running; it asks first). Single-colour icons take the colour of the theme. Every question the editor asks (making a sprite complex or blocks, deleting a library entry or a save, the cloud purchase, save with missing files, the framerate, load errors) is a dialog in the Scratch modal style (`lib/dimod-dialogs.js`, `containers/dimod-dialogs.jsx`: `askConfirm`, `askAlert`, `askPrompt`; a red OK for what can't be undone), not the browser's `confirm()`. The log's tabs carry icons too, and the Console's Reset (undo arrow), Clear (bin) and the Tests tab's Run again (circular arrow) are icon buttons. |
| **Profiler / Tests tabs** | §27 and §25. |
| **Per-sprite models** | Each sprite keeps its own Monaco model (undo history, cursor) for the session. |
| **Remote carets** | Collaborators' carets and selections are drawn (`remote-carets.js`). |
| **Theme** | Follows the editor's light/dark theme. |
| **Make blocks** | Toolbar button, same as the sprite context menu. |

---

## 17. Storage format

Per target in `project.json`:

```jsonc
{
  "name": "Player",
  "blocks": { /* ONLY blocks not owned by a blockspace */ },
  "comments": { /* ditto */ },
  "extensionData": {
    "dimodBlockspace": {
      "complex": true,
      "source": "// code…\nconst jump = new Blockspace(\"jump\", {…});\n…",
      "owners": null            // or {topBlockId: blockspaceId} while the sprite is blocks
    }
  }
}
```

- Blockspace blocks are left out of `blocks`/`comments` during `sb3.serialize` (via a flag
  read in `RenderedTarget#toJSON`). The payloads in `source` are the only copy.
- On load, `extensionData.dimodBlockspace` → `sprite.dimod`, blockspaces are materialized
  immediately, and the code starts once every target has been added.
- `sprite.dimod` is the live copy. The duplicate swept into `extensionStorage` is deleted.
- A blocks sprite with a `dimod` (complex before) keeps its source and `owners` in the save.
- Held values with `reset: "save"`: a target's under `extensionData.dimodBlockspaceSaved`,
  world's on the stage under `extensionData.dimodWorldSaved` (see §9).
- **Not saved:** own values (`world.x`, `me.x`), other held values, console, pending flag.

---

## 18. Multiplayer / collaboration sync

`collab.js` rides on `window.dimodCollab` (the studio relay, `backend/src/ws/studio.js`).

| Message | Sent when | Effect on receive |
|---|---|---|
| `blockspace-delta` | Each local keystroke batch (view text) | Merged by text anchoring: replaced text + 12 chars of context, placed at the nearest match. Doesn't fit → dropped (fixed by hash check). Goes into the open Monaco model (keeps caret/undo). Code becomes pending. |
| `blockspace-payload` | A blockspace's blocks edited | Payload written into the code, blocks re-materialized. Doesn't restart code. |
| `blockspace-state` | Made complex/blocks, non-typing source changes, join replies, repair | Full `{complex, source, owners}` applied (`applyRemote`). Join replies don't overwrite sprites edited locally this session. |
| `blockspace-state-request` | On joining / reattach | Everyone replies with every sprite's state. |
| `blockspace-hash` | 1.5 s after edits settle | If hashes differ, the **higher session id** sends its state and the other adopts it. |
| `blockspace-caret` | Caret moves | Remote carets drawn. |

Targets are matched by id, falling back to sprite name. Remote changes are never echoed back
(`_applyingRemote`). Remote code, like local code, waits for the green flag to run.

---

## 19. VM events emitted

| Event | Payload | Used by |
|---|---|---|
| `DIMOD_BLOCKSPACE_CHANGED` | `{targetId, kind: 'complex'\|'source'\|'typed'\|'payload', id?, payload?}` | collab |
| `DIMOD_BLOCKSPACE_SOURCE_CHANGED` | `{spriteName, remote?}` | code editor refresh |
| `DIMOD_BLOCKSPACE_PENDING` | `{targetId, pending}` | pending indicator |
| `DIMOD_BLOCKSPACE_LOG` | `{targetId, spriteName, isClone, level: 'log'\|'error', text, line}` | console store |

The host is reachable as `vm.runtime.dimodBlockspace` (`BlockspaceRuntime`). Its public-ish
methods: `isComplex`, `setComplex`, `getSource`, `setSource(t, src, {apply, remote, typed})`,
`applySource`, `isPending`, `setFocus`, `flushFocus`, `setFocusedParams`, `focusedParams`,
`adoptLooseScripts`, `applyRemote`, `applyRemotePayload`, `targetValues`, `setWorldValue`,
`setTargetValue`, `worldValues`, `parentOf`, `holdStoreFor`, `worldHold`, `instances`,
`spaces`, `clock`.

---

## 20. Internals map

| File | Role |
|---|---|
| `src/lib/block-space/runtime/index.js` | `BlockspaceRuntime` host, VM patches (storage, addTarget, makeClone, toJSON, duplicate, emitWorkspaceUpdate, startHats, stepThread, keyboard/mouse). |
| `runtime/module.js` | `ModuleInstance`: compiling/running one copy, globals, `onWorld`/`onTarget`, error line mapping. |
| `runtime/target-api.js` | `TargetApi`, variable/list proxies, own-value proxy. |
| `runtime/world-api.js` | `WorldApi`. |
| `runtime/blockspaces.js` | Materialize/unmaterialize, sync, payloads, `RunHandle`, `run`, `runBlock`. |
| `runtime/clock.js` | Frame clock, `Stopped`. |
| `runtime/values.js` | `toCast`/`fromCast`, `HoldStore`, `withValues` proxy. |
| `runtime/extras.js` | Sound, pen, camera, `ext()` proxy, gamepad, ask. |
| `runtime/tween.js` | Easings, `Tween`, `startTween`. |
| `runtime/server-api.js` | `world.server`. |
| `runtime/block-owner.js` | What owns the tweens and runs that blocks start. |
| `block-space-blocks.js` | VM primitives for the new blocks. |
| `editor-blocks.js` | scratch-blocks definitions and toolbox XML. |
| `source-scan.js` | Hand-written scanner for `new Blockspace(…)` calls. |
| `source-view.js` | Payload-hiding view ↔ real code. |
| `project-types.js`, `api-types.js` | Monaco type declarations. |
| `live-values.js` | Hover value resolution. |
| `collab.js` | Multiplayer sync. |
| `console-store.js` | Per-sprite console. |
| `focus.js` | Open/close a blockspace in the Blocks editor. |
| `editor-hints.js` | Reads `editor.*()` calls and the values they describe from the text; the run-time `editor` (does nothing). |
| `src/components/block-space/property-editors.js` | The chips, popups, colour picker and suggestions for those values. |
| `src/components/block-space/*` | Code tab UI, focus bar, inline buttons, previews, carets. |
| `test/unit/util/blockspace-runtime.test.js` | 76 runtime tests; the best executable spec. |

---

## 21. Known quirks

Things that behave in ways worth knowing:

1. **`setCostume` throws on unknown names**, while the equivalent block silently does nothing.
   This is intentional but a porting gotcha.
2. **`me.glide` to a moving target** resolves the destination once, at the start (so do
   tween paths).
3. **`hold(..., {reset: "stop"})` values also reset on the green flag**, because the flag
   performs a stop-all first.
4. **`world.gamepad()` is a snapshot**. Poll it each frame.
5. **Blockspace existence is textual**, so a `new Blockspace` in dead code still exists.
   Conversely, a computed id (`new Blockspace(name)`) never materializes.

Fixed (each with a test): `me.on("change", name)` ignoring its name, `Loop.running` staying
`true` after `stop()`, `world.cameras.get()` making a new camera object each time, and
`"change"` filters matching value names case-insensitively.

---

## 22. Ideas / future directions

Done so far: blocks → JS calls (call JS, any number of arguments, typeable name menu),
cross-sprite blockspace calls (`target.blockspace(id)` and the call blockspace blocks),
saved holds, the inspector, `world.watch`, more events (`preflag`, `clone`, `cloned`,
`costume`, `say`, `resize`, `cloud`, colour `touch`), tweens with `delay` / `repeat` / `yoyo`,
the tween block, glide easings, and `world.server`.

Still open, as design notes. Each has a proposed API, how it would fit what's already
here, and the questions to settle first. The security item under graduation (22.4) comes
before anything else.

### 22.1 Structured values from `return` and `yield`

**Problem.** What a blockspace returns or yields is a Scratch value: numbers come back as
strings (`"5"`), lists and objects as JSON text. Code ends up writing
`await fromCast(me.run(bs))`, and a block script can't hand back a list at all.

**Proposal.**

```js
const sum  = await me.call(add, 2, 3);   // 5, a number: run() + fromCast + JSON.parse if it's JSON
const path = await me.call(findPath, x, y);   // an array, from "return list [path]"
for await (const step of me.run(walk).values()) { … }   // yields, cast the same way
```

- `target.call(bs, ...args)`: `run()`, awaited, with the value converted: `fromCast`, then
  `JSON.parse` for text that looks like JSON (`[`, `{`). `run()` stays raw, for anyone
  who needs the exact Scratch value.
- `RunHandle.values()`: an async iterator over yields, converted the same way.
- New blocks: **`return list [list ▾]`** and **`yield list [list ▾]`**. They hand over
  the list's items as a real array (the VM value is `thread.dimodRun._return(array)`, so
  it never becomes a string). `RunHandle.value` can then be an array.

**Fits in:** `RunHandle._return` / `_yield` (`runtime/blockspaces.js`) already take any value.
Only the blocks and `toCast` on the way in make it a string. The list blocks read
`target.lookupVariableById(...)` like `data_itemoflist` does.

**Questions:** should `call()` also exist on `world` for `runAll` (`world.callAll`)? Should
the call blockspace *reporter* block show arrays as `a b c` (Scratch list style) or as JSON?

### 22.2 Breakpoints and stepping

**What already works:** the code runs as a real script named `blockspace/<Sprite>.js` (its
`//# sourceURL`). So with the browser's devtools open, a `debugger;` statement or a
breakpoint in that file stops there, with locals, the call stack and stepping. Nobody
knows that yet, so it belongs in the Code tab's help.

**Proposal: `await breakpoint(info?)`.**

```js
for await (const dt of frames()) {
    if (me.touching("edge")) await breakpoint({x: me.x, y: me.y});
}
```

- Pauses the **project** (`runtime.pause()`: block threads, audio and the frame clock all
  stop, and JS time with them, see §3 *Pause*) and resolves when it's resumed.
- The Code tab shows where it stopped: the line (from the stack, the same way errors get
  theirs), the sprite/clone, and `info` rendered like the Values tab, plus a **Continue**
  button (`runtime.play()`).
- Stepping "one frame at a time" comes almost for free: **Step** = play for one frame, then
  pause again (`RUNTIME_STEP_START` → pause on the next one).

**Later: gutter breakpoints.** Clicking Monaco's gutter adds a marker. On the next run the
code is compiled with `await breakpoint()` inserted at those lines, but only where `await`
is allowed (top level or inside an `async` function). That needs a real parser to find the
enclosing function. `source-scan.js` deliberately isn't one, so this waits until one is
in the bundle.

**Questions:** should a breakpoint in a clone pause everything (simplest, like a real
debugger) or only that copy? Should breakpoints be ignored in published games? (Yes by
default: `breakpoint()` would do nothing outside the editor.)

### 22.3 Sharing code between sprites (modules)

**Problem.** Helpers written once (math, pathfinding, a state machine) can only be shared by
putting functions on `world` values (`world.util = {...}`). Those are emptied by the green
flag, have no types, and depend on which sprite's code ran first.

**Proposal.**

```js
// Stage code
world.export("geo", {
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n))
});

// any sprite
const geo = await world.import("geo");
me.x = geo.clamp(me.x, -200, 200);
```

- `world.export(name, value)`: one exporter per name (a second one is an error that names
  both sprites).
- `world.import(name)`: resolves as soon as it's exported. Originals start in one batch
  (`_queueStart`), so an import at the top level resolves in the same frame whatever
  order the sprites load in. It's a **live proxy**: when the exporter's code reruns and
  exports again, importers see the new functions without rerunning themselves.
- Missing after the batch has started → the promise stays pending, and the Inspector
  shows "waiting for import geo" (instead of an error, since the exporter may be mid-edit).
- **Types:** `project-types.js` already scans every complex sprite's source. It can find
  `world.export("geo", {…})` object literals and declare `geo`'s members (names only,
  typed `any`), so `geo.` autocompletes.

**Questions:** export from any sprite, or only the stage (clearer ownership)? Should
exports survive the green flag (they're code, not state), unlike world values?

### 22.4 Graduating from `?livetest` (done)

Blockspace used to run only with `?livetest` in the URL. It now runs for everyone. This is the list that was
weighed first, kept because item 1's *Still exposed* part is still true:

**1. Security.** A complex sprite's code runs in the page itself (`new AsyncFunction(...)`
in `runtime/module.js`), with full access to it. So does a custom extension's. The site's
login token is in `localStorage` (`lib/dimod-auth.js`).

*Done: published games play on their own origin* (`play.dimod.org`). Uploaded HTML games
already get this from `lol.dimod.org`. Now Scratch games get it too, so a game's code can't
read the site's login. `localStorage` belongs to one origin, and the game origin serves
nothing but the player. Who's playing still reaches the game server:

```
dimod.org game page                      play.dimod.org/studio/embed.html (iframe)
  usePlayTokenBridge  <-- "who's playing?" (postMessage, dimodId) --  dimod-play-token.js
  POST /api/auth/game-token {dimodId}
                      --  game token, to play.dimod.org only  -->     /ws/game?token=...
```

- A **game token** (`backend/src/utils/gameToken.js`) is signed with a secret *derived*
  from `JWT_SECRET`, so every other check on the backend (REST, chat, DMs and the other
  sockets) rejects it. It's valid for **one game** (its `dimod_id`), in **play** mode only
  (never for test or console sessions), for **12 hours**. A game that reads it can only act
  as the player in that same game.
- The site page answers only messages from the play origin, only from its own game
  iframe, only for the game that iframe shows, and sends the answer to that origin only.
  The player only takes an answer from the site origin (`DIMOD_SITE_ORIGIN`, baked at
  build time) and from its own parent window. Signed out, or no answer within 3 s, the
  game plays as a guest.
- The game origin serves only `/studio/embed(.html)` and the static files under
  `/studio/`. It has no site, no editor and no API proxy, and it isn't in the API's CORS
  list.
- Everything is off until configured: backend `PLAY_URL`, frontend `PLAY_HOST` (serve.cjs)
  and `VITE_PLAY_ORIGIN`. `backend/scripts/move-warp-games-to-play-origin.js` moves
  already-published games over, with a dry run first and `--revert` to move them back.

*Still exposed:* the **editor**. Opening someone else's project there (or joining a
collab session) runs their complex code, and their custom extensions, on `dimod.org`,
where the login token is readable. Options, from strongest:

- **Run the code in a sandbox** (a cross-origin iframe or worker, with `me` / `world` as
  RPC proxies over a per-frame state snapshot). It's the real fix and the biggest job.
- **Gate other people's code:** don't run it until "Run this project's code" is clicked.
- **Move the token out of reach:** an `HttpOnly` cookie instead of `localStorage`. This
  stops it being stolen, but page code can still act as you while the page is open.

**2. Projects opened without Blockspace.** Today a complex sprite's blockspace blocks exist
only inside its code (§17), so a client without the runtime shows the sprite with **no
scripts** and runs nothing. The data is kept (`extensionData` survives the round trip), but
nothing runs. Before graduating, either ship the runtime everywhere the project can be
opened (editor, player, embed, published-game page), or save a fallback copy of the blocks
as ordinary scripts that the runtime removes on load (bigger files, and only the blocks
would run).

**3. Everything else:**

| Area | To check |
|---|---|
| Player / embed builds | The runtime is installed from `dimod-vm-patches.js` (`vm-manager-hoc.jsx`). Confirm every page that runs projects goes through it. |
| Performance | The per-frame work is the clock loops, touch watchers, `watch`es and the inspector's refresh. Measure with 300 clones each running a `touch` watcher. |
| Collab relay | `backend/src/ws/studio.js` only passes on the `blockspace-*` message types it knows. They must be deployed together. |
| Undo | Code edits and blockspace block edits have separate undo histories (Monaco vs Blockly). Decide whether that's acceptable. |
| Docs & onboarding | This document is the reference. A short "first complex sprite" tutorial in the Code tab would do more for adoption. |
| The flag itself | *Done.* Removed `isLiveTestEnabled()` checks (`dimod-vm-patches.js`, `make-toolbox-xml.js`, `gui.jsx`, `sprite-selector-item.jsx`) and `lib/dimod-livetest.js`. |

### 22.5 Async `preflag`

**Problem.** `preflag` handlers run synchronously, and flag scripts don't wait for a promise
they return. Loading something first (a level from `world.server.ask`, a saved
setting) and having every flag script see it isn't possible yet.

**Proposal.**

```js
world.on("preflag", async () => {
    world.level = await world.server.ask({type: "level"});
}, {wait: true});
```

- With `{wait: true}`, the green flag waits for that handler's promise (and any other
  waiting ones) before starting "when flag clicked" scripts and `"flag"` handlers.
- Where: the `startHats` wrapper in `runtime/index.js`. For the flag it would collect the
  `preflag` promises (`dispatchWorld` already returns them via `invokeForResult`) and, if
  any are waiting, start the flag hats and `"flag"` handlers when they settle, instead of
  straight away.
- **Guards:**
  - a time limit (5 s, then start anyway, with a console warning naming the slow sprite);
  - the stop sign or another green flag while waiting cancels the pending start;
  - a rejected handler is reported and doesn't block.
- The project shows as running (the flag highlighted) while it waits.

**Questions:** is `{wait: true}` the right opt-in, or should any `async` preflag handler be
waited for? Waiting by default is friendlier, but it silently changes timing for code that
awaits something slow for another reason.

---

## 23. Input actions: `world.input`

Named actions over keys, the mouse and gamepads (`runtime/input-api.js`), so a game asks "is
*jump* pressed?" instead of "is space or W or pad A down?", and players can rebind them.

```js
world.input.actions({
    jump:  ["space", "w", "pad:a"],
    left:  ["a", "left arrow", "pad:lx-"],
    right: ["d", "right arrow", "pad:lx+"],
    fire:  "mouse",
});
world.forever(dt => {
    me.x += 200 * dt * world.input.axis("left", "right");
    if (world.input.pressed("jump")) me.y += 30;
});
world.input.on("fire", () => me.say("pew"));
world.input.on("fire", "release", () => me.say(""));
```

**Bindings** are strings: a Scratch key name (`"space"`, `"a"`, `"up arrow"`), `"mouse"`, or a
gamepad's: `"pad:a"` (buttons `a b x y lb rb lt rt back start ls rs up down left right`, or a
number), `"pad:lx+"` / `"pad:ly-"` / `rx` / `ry` (a stick's direction, with a 0.2 dead zone),
`"pad2:a"` for the second pad. An action can have any number of them.

| Member | Notes |
|---|---|
| `bind(action, ...bindings)` | Adds (makes the action). Returns the API, to chain. |
| `rebind(action, ...bindings)` / `unbind(action, ...bindings?)` | Replaces / removes (all, with none given). |
| `actions({name: binding \| [bindings]})` | Several `bind`s. |
| `bindings(action)` / `names` | What's bound / every action. |
| `down(a)` / `pressed(a)` / `released(a)` | Held now / went down this frame / went up this frame. |
| `value(a)` | 0 to 1; a trigger or stick is in between. |
| `axis(negative, positive)` | -1 to 1. |
| `vector(left, right, up, down)` | `{x, y}`, never longer than 1 (no fast diagonals). |
| `on(a, ["press" \| "release"], fn)` | Returns the off. Handlers go with the code. |
| `press(a)` / `release(a)` | Holds an action down from code (as if a binding were held) until released. For on-screen buttons, replays, bots. Seen on the next frame. |
| `tap(a)` | Down for exactly one frame: `pressed()` and `on("press")` see it once. |
| `capture({skip, timeout})` | `Promise` of the next input the player uses, as a binding string. `const b = await world.input.capture(); world.input.rebind("jump", b);` |

On-screen button (a sprite) for touch screens:

```js
me.on("click", () => world.input.press("jump"));
world.forever(() => { if (!world.mouse.down) world.input.release("jump"); });
```

Scratch's mouse is one pointer, so two sprite buttons can't be held at the same time on a touch
screen.

Actions belong to the project, not a sprite, and are read once per frame before any loop runs, so
every sprite sees the same frame. The green flag clears them (the code binds them again when it
runs). An unknown action throws a `ReferenceError` that says how to make it.

---

## 24. Multiplayer sprites: `me.sync`, `relay`

`me.sync()` keeps a sprite's properties the same for everyone in the room, over the game server's
**relay** - no server logic needed (`runtime/sync.js`).

```js
me.sync(["x", "y", "direction", "costume"]);                    // everyone else gets a copy of me
me.sync("motion", {rate: 20, interpolate: {delay: 80}, ghost: {label: true}});
me.sync({x: {precision: 0}, y: {precision: 0}, hp: {interpolate: false}}, {mode: "shared"});
```

**Props** are property names (anything `me.tween` takes: `x`, `effects.ghost`, your own values like
`hp`), a preset name (`"position"`, `"motion"`, `"appearance"`, `"everything"`), a list of those, or
`{name: options | true}`.

**Modes**
- `"ghost"` (default): you play your sprite; every *other* player gets a copy of it (a **ghost**,
  a clone) that follows what that player's sprite is doing. Ghosts are puppets: the sprite's code
  doesn't run on them (`ghost: {run: true}` to change that; `me.remote` tells them apart). They go
  away when the player leaves or stops being heard from.
- `"shared"`: one sprite that everyone has; whoever moves it, it moves for everyone. What just came
  in isn't sent back.

**Options** (all optional)

| Option | Default | Meaning |
|---|---|---|
| `mode` | `"ghost"` | see above |
| `rate` | 15 | updates per second at most (up to 30) |
| `interpolate` | `true` | smooth numbers (snapshot interpolation, `delay` ms behind: 100); `false` applies them as they come; also per property |
| `precision` | 2 | decimals kept when sending; per property |
| `threshold` | 0 | changes smaller than this aren't sent; per property |
| `snap` | none | a jump bigger than this arrives at once instead of gliding; per property |
| `heartbeat` | 2 | seconds between sending *everything* even if nothing changed (so late arrivals catch up); 0 = never |
| `timeout` / `onTimeout` | 10 / `"remove"` | seconds without hearing from a player, then `"remove"` (delete the ghost), `"hide"` or `"keep"` it (0 = never) |
| `authority` | `"anyone"` | shared mode, who may change it: `"anyone"`, `"host"` (whoever's been in the room longest) or `(me, others) => boolean` |
| `id` / `channel` | | name this sync (a sprite can have several); the channel is `sync:<sprite>[:id]` |
| `send` / `receive` | `true` | `send: false` to only receive; `send` can be a function that says whether to send *now* |
| `filter(player)` | | only these players' updates count (and get ghosts) |
| `transform(state, player)` | | change what came in before it's applied |
| `encode(state)` | | change what's about to be sent |
| `ghost` | `{}` | ghosts: values to set when one is made (`{"effects.ghost": 40, size: 80}`), plus `run` (let the sprite's code run on it), `show` (visible, default true) and `label` (`true` or `player => text`: the ghost says the player's name) |
| `onSpawn(ghost, player)` / `onRemove(ghost, player, reason)` / `onUpdate(sprite, state, player)` | | hooks (also `sync.on(...)`) |

**The handle** `me.sync()` returns: `ghosts` (player id → sprite), `players`, `ghostOf(id)`, `stats`
(`sent`, `received`, `bytes`, `ghosts`), `extra` (anything JSON, sent along; ghosts see it as
`me.remote.extra`), `pause()` / `resume()` / `stop()`, `flush()` (send everything now), `on("spawn" |
"remove" | "update", fn)`, `available`, `active`, `mode`, `channel`.

**On a ghost** `me.remote` is `{player, extra, ago, sync}`; it's `null` everywhere else.

Notes
- Only the original sprite syncs; on a clone (or a ghost that runs the code) `me.sync()` returns a
  handle that does nothing. Without a game server (see `world.server.available`) it does nothing too.
- A sync is stopped with the code that made it (hot reload, sprite deleted), and its ghosts go.
- **Trust.** It's the players' own game clients talking to each other, so each trusts the other.
  For a game that must not be cheated, have server logic decide and `send` the result.
- The server's flood control (60 messages a second per player, across everything) applies: a sync
  at 15/s leaves room for a few more.

### The relay

`world.server.relay(channel, data, {to}?)` and `world.server.on("relay", channel?, fn)` are the
plain building blocks under `me.sync` (server: `gameserver/room.js`, message `relay`; the room also
sends `roster`, `player-joined` and `player-left`, which is what `world.server.roster` and the
`join` / `leave` events are made of). A relayed message is at most 16 KB, goes to the room's other
players (or the one in `to`), and is never seen by the server logic.

---

## 25. Tests

Tests are written in the sprite's code and run from the Code tab (`runtime/testing.js`).

```js
beforeEach(() => { world.score = 0; });
test("scoring adds up", () => {
    world.score += 5;
    expect(world.score).toBe(5);
});
describe("jumping", () => {
    test("goes up", async () => {
        me.y = 0;
        me.jump();
        await wait(0.2);
        expect(me.y).toBeGreaterThan(0);
    });
});
test.skip("later", () => {});
test.only("just this one", () => {});
test("slow one", async () => { /* ... */ }, {timeout: 20});
```

- `test(name, fn, {timeout}?)` **registers**; it does nothing while the project plays. `it` is an
  alias. `describe(name, fn)` groups (names join with " › "); `beforeEach` / `afterEach` apply to the
  tests after them (inside a `describe`, only to its own). `test.skip`, `test.only`.
- **Run tests** (toolbar button, or the Tests tab's "Run again"): the sprite's code runs again from
  the top (a clean start), then each test runs one after another, awaited, as that sprite. A test
  passes if it finishes without throwing; it fails on a throw or after `timeout` seconds (5).
  `world.testing` is `true` while they run.
- Results show in the **Tests tab** (click one to jump to its line) and as ✓ / ✗ lines in the
  console, with a summary. `host.runTests(target, {filter})` does the same from code.
- `expect(x)`: `toBe`, `toEqual` (deep), `toBeCloseTo(n, digits = 2)`, `toBeGreaterThan(OrEqual)`,
  `toBeLessThan(OrEqual)`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`,
  `toContain`, `toHaveLength`, `toMatch`, `toBeInstanceOf`, `toThrow(message | regexp | class)`,
  and `.not` in front of any. `assert(condition, message)`.
- Waiting inside a test uses the project clock, so it needs the project running (not paused).

---

## 26. Waiting for events: `once`

```js
const key = await world.once("key", "space");               // resolves with the event's first value
await me.once("click");
await world.once("broadcast", "go", {timeout: 10});          // rejects with a TimeoutError after 10 s
const [a, b] = await Promise.all([world.once("flag"), me.once("click")]);
```

`world.once(event, [filter], [options])` and `me.once(...)` take the same events and filters as
`on()`. Like a `wait`, a pending `once` ends with the stop sign and with the code being replaced
(it rejects with `Stopped`, which isn't reported). `me.after(seconds, fn)` and `me.every(seconds, fn)`
are `world.after` / `world.every` for a sprite.

---

## 27. Code tab tools: console, profiler, hot reload, errors

**Console prompt.** Under the Console tab: type code, **Enter** runs it *as this sprite* (`me`, `world`,
`wait`, `tween`, `log`, `test`... are there; **Shift+Enter** for a new line, **↑/↓** for history; it
completes like the code editor). What it evaluates:
- an expression's value is printed (`← 10`), awaited if it's a promise; several statements print the
  value of the last expression: `me.x = 5; me.x * 2`;
- `const x = 4` / `let` / `var` at the start of a line **stays** for the next lines typed (`_` is the
  last result);
- the code's own top-level names (`const state = me.hold(...)`) are *not* reachable - they live inside
  the running code - but everything on `me` / `world`, own values and held values (`me.hold({...})`
  again gives the same store) are;
- what the console starts (handlers, loops, tweens) belongs to a **console instance** shown in the
  Inspector as "the console of Player"; **Reset** stops it and forgets its variables, and so does
  the sprite's code running again.
Clicking a line you typed puts it back in the prompt.

**Errors.** An error's line **and column** are found from the stack, so the marker in the code
covers the exact spot, and the console line shows the call chain (`← line 12`) as buttons. `log()`
lines say which line logged them. Clicking any console line with a place in the code goes there.
Coming to a sprite that has an error nobody's seen (its tile has a badge) jumps to it. The toolbar's
**⚠ N** button cycles through the sprites that have errors.

**Profiler tab.** Every call the runtime makes into your code (top level, handlers, loops, timers,
watchers, tweens' `onStep`, the console) is timed. The tab shows, for this sprite (all its
clones added together), the last second: calls, milliseconds *per frame*, and a bar for the share of
the frame, biggest first (red from 4 ms a frame), plus the slowest sprites in the project. Code that
continues after an `await` runs in the browser's microtasks and isn't timed; the calls that start it are.

**Hot reload.** Toolbar toggle (kept per browser). On: saving (Ctrl+S), or stopping typing for a
moment, runs the code again *now* if it compiles - clones included - without restarting the project.
Held values and world values stay; everything the old code registered is cleaned up and set up
again. In the code, the global `reloaded` is `true` for such a run, so set-up that would reset the
game can be skipped:

```js
if (!reloaded) me.goTo(0, 0);
const state = me.hold({lives: 3});     // stays across reloads
```

---

## 28. The library

Code shared between complex sprites' authors: a tween helper, a save system, a set of blocks. Toolbar
**Library** (the purple puzzle piece; `components/block-space/library-modal.jsx`, `lib/block-space/library.js`; backend
`controllers/blockspaceLibrary.js`, routes under `/api/blockspace-library`).

- **Browse** search (name, description, author), sort newest / most used, read the code and any
  version's notes, **Insert into <sprite>** - at the caret (after the entry you're inside of, if you're
  in one).
- **In this sprite** lists what was inserted and whether a newer version is out, with **Update**.
- **Mine** your entries: visibility (public: listed; unlisted: anyone with the id; private), new
  version, delete (code already inserted keeps working).
- **Publish** all of the sprite's code or the selection, as a new entry or a new version of one of
  yours. Names, descriptions and tags are checked for profanity; 200 KB of code, 100 entries each.

An entry sits in the code between two comment lines, which is how it's found again:

```js
// @library qk9v_xSG v2 Save system by ann
...its code (new Blockspace lines and all)...
// @end library qk9v_xSG
```

`Update` replaces what's between them (edits made there are lost - the dialog says so). Blockspaces
whose id the sprite already uses are given a new one on the way in (`jump` → `jump2`), and the
entry's own references follow. Nothing here runs code: an entry is text, shown before it's used, and
runs like the rest of your code once the sprite does (**read it first**).

The window's **All of the library** link opens the site's Library page (`/library`, hidden: nothing on
the site links to it), which holds this code beside everyone's costumes, backdrops, sounds and sprites:
see §28.1.

API: `GET /` (`q`, `tag`, `sort=new|popular`, `mine=1`, `page`), `GET /:id[?version=N]`,
`GET /:id/versions`, `POST /latest {ids}`, `POST /`, `POST /:id/versions`, `PATCH /:id`,
`DELETE /:id`, `POST /:id/use`. Tables: `blockspace_library`, `blockspace_library_versions`.

### 28.1 The Library page

`/library` on the site (hidden: no menu links to it) is one place for everything shared: **costumes,
backdrops, sounds, sprites and code** (the code is the entries above, from `/api/blockspace-library`; the
rest are `library_assets`, `/api/library-assets`). The old admin "Asset library" manager moved here.

- **Browse** by kind, search names / tags / people, sort by newest / most used / name, filter to what's
  **In the editor**. Sounds play in the grid. Opening one (`/library/<id>`) shows it big, who made it, its
  tags and description, and Download, Copy link, and for its owner Edit, Delete and the editor-library
  button. Everyone's / Mine / Review tabs sit at the top right.
- **Add to the library** (`/library/new`) is a wizard: type, file (or code), details (name, description,
  tags with suggestions, and for a costume or backdrop a click-to-set rotation centre), who can see it
  (public or unlisted; code can also be private) and whether to also ask for it to be in **Studio's own
  library**, then a review step. **Edit** (`/library/<id>/edit`) is the same wizard on the details, with
  an optional file replacement.
- **Studio's library (the "warp library").** Only *costumes, backdrops and sounds* can be asked for; staff
  put sprites there themselves (a sprite is scripts as well as art). An ask is *pending* until a curator
  (site admins, and expression wizards) approves it, which notifies the owner (`library_reviewed`); a
  rejection can carry a note and the owner can ask again. Only approved items are served to Studio's
  pickers (`GET /api/library-assets`). What the pickers show of an approved item (name, tags, rotation
  centre, resolution) can only be changed by its owner through a curator's approval (`pending_edit`),
  and its file can't change at all, since projects use it by link. Staff adding things are approved at
  once. Deleting one only removes it from the picker; projects that used it keep their copy.
- **Safety.** Uploads are checked (an image must decode, at most 8192 px; a sound must start like its
  format; a `.sprite3` must be a zip with a `sprite.json`; an SVG with scripts is refused), names,
  descriptions and tags go through the profanity filter, and there are per-hour upload limits. Anything
  public can be taken down by its owner, staff and moderators.

API (`/api/library-assets`): `GET /` (Studio's approved list, grouped by kind), `GET /browse`
(`kind`, `q`, `tag`, `sort`, `mine=1`, `status`, `warp=1`, `review=1`, `page`), `GET /tags`, `GET /summary`,
`GET /:id`, `POST /` (multipart `file`, `kind`, `name`, `description`, `tags`, `visibility`,
`request_warp`, `rotation_center_x/y`, `bitmap_resolution`), `POST /:id/file`, `PATCH /:id`,
`POST /:id/submit`, `POST /:id/withdraw`, `POST /:id/review {approve, note}`, `POST /:id/use`,
`DELETE /:id`.

---

## 29. Second-player test windows

In the editor of a project with multiplayer, the button next to the green flag (same style as
pause / stop) opens **another player's window** (`lib/dimod-test-windows.js`), up to seven of
them:

- it's the game's own player (`embed.html?p=<project>&test_seat=N`) loaded with the editor's project
  **as it is right now**, unsaved edits included - it asks the editor that opened it, and gets the
  project file over `postMessage`;
- it joins the editors' **test session** on the game server (the draft server logic) as
  "<you> (2)", "<you> (3)"... - each seat is its own player, so one account can be several
  (`seat=` on `/ws/game`, test mode only);
- **shift+click** the button once windows are open to send every one of them the project again
  (they restart with it); the badge on the button counts players (you included);
- it only shows in the editor of a saved cloud project.

---

## 30. Animations: `me.animator`, `Animation`

Everything the Animation blocks do, from code (`runtime/animation-api.js`). Animations are made in
a sprite's **ANIMATIONS** tab and belong to that sprite, like costumes. Code and blocks drive the
same animations through the same host (`runtime.dimodAnimations`, `dimod-animation/vm.js`), so
they mix freely: a script can `play` what code set up, code can read data a block set, and an
`Animation` put in a variable is the same first-class value the `(animation [walk])` block reports.

```js
const walk = me.animation("walk");
walk.data.speed = 2;                          // "set data [speed] to (2) in (walk)"
walk.part("Arm").set("rotation", 30);         // "set [rotation] of part [Arm] in (walk) to (30)"
me.animator.play(walk);                       // "play (walk) [looping]"
await me.animator.playUntilDone("jump");      // "play (jump) until done"
me.on("animation", "step", () => me.sound.start("tap"));   // "when (walk) fires [step]", roughly
```

### Naming an animation (`AnimationLike`)

Anywhere an animation is taken (`me.animation()`, `animator.play()`, `show()`...):

| Given | Means |
|---|---|
| an `Animation` | itself |
| `"walk"` | **this** sprite's `walk` (from `me`/a `TargetApi`: that target's sprite) |
| `"Hero/walk"` | `Hero`'s `walk`, from anywhere. Sprite names with `/` in them work (every split is tried). |
| an animation value | what a variable holds after `(animation [walk])` or `me.vars.x = walk` |
| JSON text / an object | an animation document (a KS4/KS5 export). Played as it is, not added to any tab. |

A name that doesn't resolve throws `ReferenceError: Hero has no animation "x"`. `world.animation()`
has no sprite of its own, so it needs `"Sprite/name"` (or a value).

Another sprite's animation plays on this sprite with its **"this sprite" parts drawn from the
owner's costumes**, exactly as the owner's tab shows it.

### Finding animations

| Member | Returns | Notes |
|---|---|---|
| `me.animations` | `Animation[]` | This sprite's tab, in order. On any `TargetApi` (`enemy.animations`); clones share their sprite's. |
| `me.animation(thing)` | `Animation` | See the table above. |
| `world.animations` | `Animation[]` | Every sprite's, sprite by sprite. |
| `world.animation(thing)` | `Animation` | `"Sprite/name"`, a value, JSON. |

### `Animation`

A handle on one animation. A tab animation is looked up by **id** every time it's used, so it
follows later edits (renames too, and collaborators' edits) and never goes stale; once the
animation is deleted from its tab, using it throws `ReferenceError: The animation "walk" was
deleted from Hero` (`exists` turns `false`).

**Identity**

| Member | Type | Notes |
|---|---|---|
| `name` | `string` | Its name in the tab. |
| `id` | `string` | Stable across renames and edits. |
| `ref` | `string` | `"Hero/walk"`, what variables and blocks show; a copy's is its JSON. Also `toString()` / `toJSON()`. |
| `exists` | `boolean` | `false` once deleted from its tab. Always `true` for a copy. |
| `sprite` | `TargetApi \| null` | Whose tab it's in (the original sprite). `null` for a copy. |
| `isCopy` | `boolean` | Made by `copy()` or from JSON. |
| `is(other)` | `boolean` | Same animation (by id): `me.animator.current?.is(walk)`. |

**What it's made of** (read-only, from the document)

| Member | Type | Notes |
|---|---|---|
| `duration` | `number` | Seconds. `Infinity` for an animation set to play forever. |
| `infinite` | `boolean` | |
| `fps` | `number` | 1-240. |
| `frames` | `number` | `round(duration × fps)`. |
| `parts` | `string[]` | Part names, as the parts list orders them. |
| `events` | `{name, time}[]` | Its timeline events, in time order. |
| `dataNames` | `string[]` | Its data tracks. |
| `lastEvent` | `string` | The last event it fired, on any sprite (like "last event of"). |

**Data.** `anim.data` is live: `anim.data.speed = 2` is "set data", `anim.data.speed` reads it back,
`Object.keys(anim.data)` lists what's been set, `delete anim.data.speed` clears one. Setting
`anim.data = {speed: 2, mood: "happy"}` sets several. Numbers and strings are kept as they are;
anything else goes through `Cast.toNumber`. Data belongs to the **animation**, so every sprite
playing it sees the change (expressions read it as `data.speed`).

**Parts.** `anim.part(name)` → `AnimationPart` (throws `ReferenceError` listing the parts if
there's no such part). `anim.resetParts()` clears every override on every part.

**Time mode** (what "show at", `mapTime`, `progress` and `loopCount` do past the end):

| Member | Notes |
|---|---|
| `timeMode` | `"clamp"` (default), `"loop"`, `"pingpong"`, `"reverse"`, `"reverseloop"`. Setting also accepts `"ping-pong"`, `"reverse loop"`. Anything else throws. |
| `mapTime(seconds)` | Where `seconds` lands under the time mode (rounded to ms). |
| `progress(seconds)` | 0-1. `0` for a zero-length animation. |
| `loopCount(seconds)` | Whole play-throughs by then. |

**Quality**

| Member | Notes |
|---|---|
| `smoothing` | Anti-aliasing. Until set, `world.animationSmoothing`. |
| `detail` | `"low"` (half resolution), `"medium"`, `"high"` (double). Until set, `world.animationDetail`. Anything else throws. |

**Other**

| Member | Notes |
|---|---|
| `copy()` | A new `Animation` with its own id (so its own data and overrides), not in any tab. Like "copy of". |
| `on([event], fn)` | `fn(event, sprite, time)` whenever **this** animation fires an event (or that one event), on any sprite playing it. Belongs to your code instance; returns the remove. |

Put one in a variable and it becomes the animation value (`toCast` knows it, §14):
`me.vars.current = walk` → blocks see `(animation [walk])`.

### `AnimationPart`

Overrides replace what a part's keyframes say, for **every sprite playing that animation**, until
reset. They're the blocks' "set [ ] of part", and are kept per animation id, so they survive the
tab saving a new version.

| Member | Notes |
|---|---|
| `animation`, `name` | |
| `set(property, value)` / `set({property: value, ...})` | Chainable. Numbers for numeric properties (booleans are 1/0), a costume name or index for `costume`, `"#rrggbb"` or a number for `tint`. A non-number where one is needed throws `TypeError`. |
| `reset(property?)` | One property, or all of this part's. |
| `get(property)` | The override, or `undefined` when the keyframes decide. |
| `value(property, seconds?)` | `([rotation] of part [Arm] in (walk))`: what the animation gives this part (keyframes, expressions and overrides, before parenting) `seconds` into it, or at this sprite's time in it (0 when it isn't playing it). Any track works ("glowStrength", "blendMode"...). Colours are `"#rrggbb"`, on/off ones (`visible`) booleans, `costume` the name or index, `relativeTo`/`maskSource` a part name. |
| `overrides` | `{rotation: 30, fxGhost: 50}`: every override on the part. |

Property names are the track names or the block menu's words:

| Track | Block words | | Track | Block words |
|---|---|---|---|---|
| `x`, `y` | x, y | | `fxPixelate` | pixelate effect |
| `rotation` | rotation | | `fxMosaic` | mosaic effect |
| `scaleX`, `scaleY` | scale x, scale y | | `fxWhirl` | whirl effect |
| `alpha` | alpha | | `fxFisheye` | fisheye effect |
| `skewX`, `skewY` | skew x, skew y | | `glowSize` | glow size |
| `fxColor` | color effect | | `outlineWidth` | outline width |
| `fxBrightness` | brightness effect | | `tint` | tint |
| `fxGhost` | ghost effect | | `visible` | visible |
| `zIndex` | z-order | | `costume` | costume |

An unknown one throws, listing the valid names.

### `me.animator`: `Animator`

What **one** sprite or clone is playing: each clone has its own. Sprites only (`world.stage.animator`
throws). Setters and methods throw `Stopped('disposed')` if your code was replaced, and an error if
the sprite was deleted; they return the animator, so they chain.

**Playing**

| Member | Notes |
|---|---|
| `play(anim, options?)` | Plays it in place of the costume. `options`: a mode (`"loop"` default, `"once"`, `"pingpong"`), `true` / `false` (loop or play once: `play(anim, false)`), or `{mode, loop, speed, from, crossfade}` (`loop: false` is `"once"`; a `mode` wins over `loop`); an unknown option throws. Starts from `from` (0). Speed carries over from what was playing unless given. |
| `playUntilDone(anim, options?)` | Plays once; `Promise` resolving at its end - or as soon as something else is played, it's stopped, or the sprite is deleted (like the block). A wait on the frame clock: the stop sign rejects it with `Stopped`. |
| `crossfade(anim, seconds, options?)` | Blends into it. Two animations with the same parts blend **pose by pose** (limbs move smoothly); otherwise they fade through each other. |
| `finished()` | `Promise` for the end of what's playing now (resolved straight away when nothing is, or it's done). |
| `show(anim, seconds)` | Holds one frame, like "show (anim) at (secs) secs". Stops any play. Clamped to the duration unless it plays forever. |
| `stop()` | Stops and shows the costume again. |
| `pause()` / `resume()` | Holds the current frame / carries on. `resume()` does nothing after a finished "once". |

**State**

| Member | Type | Notes |
|---|---|---|
| `playing` | `boolean` | Playing and not paused or finished (the "animation playing?" block). |
| `paused` | `boolean` | |
| `done` | `boolean` | A "once" play got to its end (and is holding the last frame). |
| `mode` | `string \| null` | What's playing's mode. |
| `speed` | `number` | get/set. 1 is normal. Setting while nothing plays does nothing (same as the block). |
| `time` | `number` | Seconds into what's playing, after looping (the "animation time" block). **Setting it seeks**, and un-finishes a finished "once". |
| `current` | `Animation \| null` | What's drawn on the sprite: playing, or held by `show()`. |
| `lastEvent` | `string` | The last event of what's drawn. |
| `parts` | `string[]` | The parts of what's drawn. |
| `part(name)` | `LivePart` | See below. Never throws: a part that isn't shown reads `shown: false`. |

### `LivePart`: a part on the stage

Where a part of what this sprite shows **is right now**, in stage coordinates: the sprite's
position, direction, size and the part's own animation all included.

| Member | Notes |
|---|---|
| `shown` | `false` when the sprite isn't showing an animation with this part. |
| `x`, `y`, `rotation` | Stage coordinates / degrees (0 = as drawn). `0` when not shown. |
| `scaleX`, `scaleY` | Size on the stage in percent: the part's scale (parents included) times the sprite's size. `0` when not shown. |
| `visible` | The part's visibility at this frame. |
| `touching(x, y)` / `touching({x, y})` / `touching("mouse")` | An **opaque pixel** of the part is there (pixel-exact, like the "part touching" blocks). |
| `set(...)`, `reset(...)` | Overrides on the animation being shown (`AnimationPart`). Throws if nothing is shown. |

```js
// a sword that hurts whatever sprite its blade is over
const blade = me.animator.part("Blade");
world.forever(() => {
    for (const e of world.getTarget("Enemy").clones) {
        if (blade.shown && blade.touching(e.x, e.y)) e.hp -= 1;
    }
});
```

### Events

| Event | On | Filter | Handler gets | Fires when |
|---|---|---|---|---|
| `"animation"` | `me.on` / `target.on` | event name (optional, case-insensitive) | `(event, animation, time)` | What **this target** plays fires a timeline event. `time` is where the event sits in the animation. |
| `"animationend"` | `me.on` / `target.on` | none | `(animation)` | A `"once"` play on this target reaches its end (blocks' plays too). |
| `"animation"` | `world.on` | event name (optional) | `(event, sprite, animation, time)` | Any sprite's. |
| `"animationend"` | `world.on` | none | `(sprite, animation)` | |
| `anim.on([event], fn)` | an `Animation` | event name (optional) | `(event, sprite, time)` | That animation only, on any sprite. |

`await me.once("animation", "land")` resolves with the event's name; `await me.once("animationend")`
with the `Animation`. Events fire from any play - blocks, code, crossfades, `show()` scrubbing
forwards - and at the same moment as the blocks' hats. They also still start "when I receive"
scripts of the same name (a KS4 habit), so name events accordingly.

Both names are reserved: `world.emit("animation")` throws.

### The blocks, in code

| Block | Code |
|---|---|
| `(animation [walk])` | `me.animation("walk")` |
| `(copy of ( ))` | `anim.copy()` |
| `(name of ( ))` | `anim.name` |
| `([duration v] of ( ))` | `anim.duration`, `.frames`, `.fps`, `.parts`, `.events`, `.dataNames`, `.timeMode`, `.sprite`, `.infinite` |
| `(last event of ( ))` | `anim.lastEvent` |
| `play ( ) [looping v]` | `me.animator.play(anim, "loop")` |
| `play ( ) until done` | `await me.animator.playUntilDone(anim)` |
| `crossfade to ( ) [ ] over ( ) secs` | `me.animator.crossfade(anim, secs, mode)` |
| `stop animation` | `me.animator.stop()` |
| `[pause v] animation` | `me.animator.pause()` / `.resume()` |
| `set animation speed to ( )` | `me.animator.speed = n` |
| `(animation time)` / `<animation playing?>` | `me.animator.time` / `me.animator.playing` |
| `when ( ) fires [step v]` | `me.on("animation", "step", fn)`, or `anim.on("step", fn)` for one animation on any sprite |
| `show ( ) at ( ) secs` | `me.animator.show(anim, secs)` |
| `([x] of part [ ] in ( ))` | `anim.part(name).value("x")`: the animation's own value for a part, every property in the menu |
| `([x] of part [ ] on stage)` | `me.animator.part(name).x` (also `y`, `rotation`, `scaleX`, `scaleY`, `visible`): where the part is on the stage right now |
| `<part [ ] touching mouse-pointer?>` | `me.animator.part(name).touching("mouse")` |
| `<part [ ] touching x: ( ) y: ( )?>` | `me.animator.part(name).touching(x, y)` |
| `set data [ ] to ( ) in ( )` | `anim.data.key = value` |
| hidden: `set [ ] of part`, `reset [ ] of part` | `anim.part(p).set(...)` / `.reset(...)` |
| hidden: time mode, map time, progress, loop count | `anim.timeMode`, `anim.mapTime(s)`, `anim.progress(s)`, `anim.loopCount(s)` |
| hidden: smoothing, render detail (empty animation = all) | `anim.smoothing`, `anim.detail`; `world.animationSmoothing`, `world.animationDetail` |

### Types

The Code tab autocompletes this sprite's animation names in `me.animation("…")` and `play("…")`,
every `"Sprite/name"`, and the project's event names in `on("animation", "…")`
(`project-types.js` fills `MyAnimations`, `AnimationRefs` and `AnimationEventNames`).

---

## 31. `Position`

A sprite's placement as one value: where it is, which way it points, how big it is and how it's
stretched. A global class, the same idea as the Positions extension; the two read each other's
values. Every method returns a **new** Position (they're values, like numbers).

```js
const home = me.position;                       // x, y, direction, size, stretchX, stretchY
const hand = new Position(30, 10);              // 30 right and 10 up, in someone's frame
friend.position = hand.relativeTo(me.position); // follows me: turned, scaled, moved with me
me.position = home.lerp(target, 0.1);           // a tenth of the way there each frame
me.vars.spot = me.position;                     // a variable gets its JSON text
```

| | |
|---|---|
| `new Position(x?, y?, direction?, size?, stretchX?, stretchY?)` | Defaults `0, 0, 90, 100, 100, 100`. Also `new Position({x, y, ...})`. |
| `Position.from(value)` | From a Position, a sprite (`me`, `world.getTarget("x")`), the Positions extension's value or its JSON text, or `{x, y, ...}`. |
| `x`, `y`, `direction`, `size`, `stretchX`, `stretchY` | Plain numbers. Direction is Scratch's: 90 is right, 0 is up. |
| `clone()`, `with({...})` | A copy; `with` changes some fields: `pos.with({direction: 0})`. |
| `add(o)`, `subtract(o)`, `multiply(o)`, `divide(o)` | Field by field. `o` is a Position or a number (for every field). Dividing by 0 gives 0, as the extension does. |
| `relativeTo(parent)` | This position given in `parent`'s frame, placed in the world: turned by the parent's direction, scaled by its size and stretch, then moved to it. The extension's `[this] relative to [parent]`. |
| `localTo(parent)` | The opposite: where this world position is in `parent`'s frame. `p.relativeTo(q).localTo(q)` is `p`. |
| `distanceTo(o)`, `angleTo(o)` | Between the x/y points; `angleTo` is the direction to face (90 is right). |
| `lerp(o, amount)` | Part of the way to `o` (every field): 0 is here, 1 is there. |
| `equals(o)` | Every field the same. |
| `toJSON()`, `toString()` | `{x, y, ...}`; the JSON text. |

`me.position` (get/set) reads and sets all six at once. Into a variable or a block a Position
becomes its JSON text, which the Positions extension's blocks take, and `Position.from()` reads
what those blocks report.

---

## 32. Extensions as JS: `me.extensions`

Every extension in the project, as plain functions made from its `getInfo()`:

```js
const J = me.extensions.jwArray;
const list = J.split("a,b,c", ",");       // "split [STRING] by [DIVIDER]"
log(J.get(2, list));                       // "item [INDEX] of [ARRAY]" -> "b"
log(J.get({INDEX: 3, ARRAY: list}));       // or by argument name
me.extensions.pen.penDown();               // commands too
world.extensions.pen.clear();              // world.extensions runs as the stage
```

- **Arguments** go in the order the block shows them, or as one object by argument name. A
  left-out argument gets the block's default.
- **The call runs the block's code straight away** as this sprite (the stage for
  `world.extensions`) and returns what it reports: the value, or a promise when the block waits.
  Reporters, booleans and commands are there; hats, C blocks, buttons and labels aren't.
- A block that has to run as a real script (it waits frame by frame, or starts a branch) throws
  `... has to run as a script: use await me.ext("id").opcode({...})`. `me.ext()` (§11) runs
  any block as a thread.
- **Values:** numbers, strings and booleans as they are; JS arrays and plain objects go as they
  are (Arrays and Objects take them); a `Position` or `Animation` becomes what it is in blocks.
  What comes back is what the extension reports (an Arrays value is its own type, with `.array`).
- `Object.keys(me.extensions)` lists them; an extension not in the project throws a
  `ReferenceError` that says how to add it (`world.useExtension(id)` for built-in ones).
- The Code tab types every extension's functions from its blocks (argument types from
  `getInfo()`), and refreshes them when an extension is added.

### Giving an extension an API for code (`getInfo().blockspace`)

An extension can add its own members for code, next to its blocks, in `getInfo()`:

```js
getInfo () {
    return {
        id: 'positionLibrary',
        name: 'Position',
        blocks: [/* ... */],
        blockspace: {
            // merged over the block functions (same names win). A function is called once per
            // sprite with {target, runtime, vm, extension}; a plain object is shared.
            api: ({target}) => ({
                Position,
                here: () => new Position(target.x, target.y)
            }),
            // TypeScript for the Code tab: the members of me.extensions.positionLibrary...
            types: 'Position: typeof Position; here(): Position;',
            // ...and anything they refer to, declared at the top level
            declarations: 'declare class Position { x: number; y: number; }'
        }
    };
}
```

```js
const P = me.extensions.positionLibrary;
const spot = P.here();
```

Only extensions whose object lives on the page get this part: built-in ones and unsandboxed
ones. A sandboxed extension's code runs in a worker, so code gets its blocks only.

---

## 33. Skins ("Turbo Skins"): `Skin`, `me.skin`

Draws a sprite as an SVG, a fetched image, or a straight copy of another sprite's costume,
instead of its own costumes - what SharkPool's **Turbo Skins** extension does, built into
Blockspace so it doesn't need adding. A `Skin` is a real JS object, not a name in a table: share
one between sprites the normal way (a variable, `me.hold()`, a world value) instead of naming it.

```js
const heart = await Skin.fromURL("https://example.com/heart.png");
me.skin = heart;              // this sprite (and any clone that runs this line) draws it
log(heart.width, heart.height);
me.skin = null;               // back to its own costumes
```

| | |
|---|---|
| `Skin.fromURL(url, name?)` | `Promise<Skin>`. Fetches `url` and makes a Skin from it: an SVG (by its `Content-Type` or, failing that, its content) or a bitmap. `name` is just a label (`skin.name`, shown in errors and `toString()`). |
| `Skin.fromSVG(svgText, name?)` | A Skin from SVG source, synchronously. |
| `target.skinFromCostume(name)` | A Skin that shows exactly what one of `target`'s costumes shows, without copying it - if that costume's asset changes later, this follows it. Throws if there's no costume by that name. Works on any `TargetApi`, so `enemy.skin = hero.skinFromCostume("idle")` borrows another sprite's look. |
| `me.skin` / `enemy.skin` | get/set on any `TargetApi`. A `Skin`, or `null` to go back to the sprite's own costumes. Setting it to a disposed Skin throws. |
| `skin.name` | Mutable label, for your own use. |
| `skin.type` | `"svg"`, `"bitmap"` or `"costume"`. |
| `skin.source` | The SVG text or the URL it was made from; `null` for a `.skinFromCostume()` skin. |
| `skin.loaded` | `false` while an SVG's own embedded `<image>`s are still decoding; always `true` for bitmap and costume skins. |
| `skin.width`, `skin.height` | The skin's native size in pixels. |
| `skin.rotationCenter` | `{x, y}`, read-only - use `setRotationCenter`. |
| `skin.setRotationCenter(x, y)` | Where the sprite's `x`/`y` and rotation are measured from, in the skin's own pixels. Returns `this`. |
| `skin.hitbox` | get/set: another `Skin` whose **shape** `touching()`/colour detection use while this one is shown - itself by default. Set to `null` to go back to using its own shape. |
| `skin.users` | Every sprite/clone (as its `me`) currently showing this Skin. |
| `skin.exists` | `false` once `dispose()`'d. |
| `skin.dispose()` | Frees the renderer resource; every sprite showing it falls back to its own costumes. Not needed for a `.skinFromCostume()` skin - it owns nothing of its own. Skins are also freed when the project is torn down (a new project loads). |

### The hitbox swap

What's actually drawn each frame is always `skin` itself; while blocks run, the drawable is
switched to `skin.hitbox` instead (`BEFORE_EXECUTE`/`AFTER_EXECUTE`, wired in
`runtime/index.js`), the same trick the extension used - so a script's `touching()` or "touching
colour" sees the hitbox shape without it ever reaching the screen:

```js
const full = await Skin.fromSVG(bigDecorativeSvg);
const box = await Skin.fromSVG(simpleHitboxSvg);
full.hitbox = box;    // drawn as `full`; touching() uses `box`'s shape
me.skin = full;
```

### Lifecycle

- **The green flag reverts every currently-shown skin** (sprites go back to their own costumes,
  like `world`/own values resetting - see §3's "When code (re)starts"); a sprite's own top level
  puts back what it still wants. The `Skin` objects themselves aren't disposed - only what's
  showing them is cleared.
- A skin isn't reset by the stop sign (only the flag) - code keeps running, so it keeps its skin,
  the same as it keeps its own values.
- A target being forgotten (clone deleted, sprite deleted) drops its entry with no other effect.

### Errors

`Skin.fromURL()` rejects if the fetch fails or the response isn't ok; `Skin.fromSVG()`,
`skinFromCostume()`, `me.skin = …` and every `Skin` method throw/reject synchronously for bad
input (an unknown costume name, a disposed skin, a non-`Skin` hitbox). Errors surface the normal
way (§15): an `await`ed rejection is your `try/catch`'s; a synchronous throw goes to the console
if nothing catches it.

---

## 34. Iris Text: `me.iris`, `Iris`

Gen1x's **Iris Text** extension, as an API. It needs the extension in the project (add it from the
extension library); without it, touching `me.iris` throws saying so. Character indexes count
**from 0** here (the blocks count from 1).

```js
me.iris.size = 40;
me.iris.font = "Sans Serif";
me.iris.shadow = {enabled: true, blur: 4, offsetY: 3};
await me.iris.type(`Hello ${Iris.color("world", "#ff4466")}!`);
await me.iris.char(0).animate("y", 20, 0.3, "back");
me.iris.on("type", (char, index) => me.sound.start("blip"));
```

| Member | Block / notes |
|---|---|
| `show(text)` | `show text`. Resolves after any `<wait>` markup in it. |
| `type(text)` / `typeLine(text)` | `type` / `type new line`. Resolve when it's all typed (or `skip()` / `stop()`). |
| `addLine(text)`, `hide()`, `skip()`, `stop()`, `refresh()` | `add line`, `show sprite (hide text)`, `skip typing`, `stop typing`, `refresh text`. |
| `text` | The text with markup, `""` while hidden. Setting it is `show()` without waiting. |
| `plainText`, `length`, `width`, `height`, `visible`, `typing` | read only. |
| `color`, `size`, `font`, `align`, `bold`, `italic`, `underline`, `strikethrough` | the base style. |
| `letterSpacing`, `lineHeight`, `maxWidth`, `maxHeight` (`null` = no limit), `smoothing`, `emoji` (`"colored"`/`"native"`), `growDownwardOnly` | layout. |
| `shadow`, `background`, `backgroundBorder`, `border` | Objects. Setting one changes only the fields given (`me.iris.border = {size: 3}`); `true`/`false` switches it. An unknown field **throws**. Reading gives a copy. |
| `typingSpeed` | Seconds per character. A number sets every group; or `{default, symbols, punctuation, numbers, custom: {"…": 0.2}}`. |
| `settings` | Everything as one object (`export settings as JSON`). Setting it (object or JSON) changes what it names. |
| `char(i)`, `chars`, `resetChars()` | One character: `.char`, `.x`, `.y`, `.width`, `.height`, `.hasMask`, `.set({x, y, rotation, scale, opacity, color})`, `.move(dx, dy)`, `.turn(deg)`, `.reset()`, `await .animate(prop, to, secs, easing?, direction?)`, `.stop()`, `.style` (`null` resets). |
| `on("type", (char, index) => …)`, `on("done", fn)`, `on("charanimationdone", fn)` | The extension's hats. Also `me.on("iris:type", …)` and friends. |

`Iris` builds markup: `Iris.color(text, color)`, `.gradient(text, colors, type?, angle?)`,
`.shadow(text, {color, opacity, blur, x, y})`, `.border(text, {color, opacity, size})`,
`.style(text, "bold")`, `.size(text, n)`, `.blur(text, pct)`, `.font(text, name)`,
`.tag(text, tag)`, `.wait(secs)`.

Everything goes through the extension's own block code, so it validates and repaints exactly like
the blocks. Anything else it has (masks, `repeat for each character`…) is still there as
`me.extensions.g1nxIrisText.…` (§32), or `me.ext("g1nxIrisText")` for blocks that wait.

---

## 35. Widgets and suggestions for your own things: `editor`

A project's code can tell the Code tab what its own things are made of, so their values are
edited with a slider, a colour picker, a tick box or a list right where they're written,
and so the editor can fill them in for you:

```js
// once, anywhere (a "library" sprite is a good place: it works in every sprite's code)
editor.props("spawnEnemy", {
    hp:     {type: "slider", min: 1, max: 20, label: "Hit points"},
    speed:  {type: "number", step: 10},
    tint:   "color",
    kind:   ["slime", "bat", "ghost"],        // a list of choices
    flying: "toggle",
    skin:   "costume"                          // one of this sprite's costumes
});

// ...and then wherever it's used
spawnEnemy({hp: 3, speed: 120, tint: "#ff0000", kind: "bat", flying: false, skin: "idle"});
```

Each of those values now has a small teal **chip** in front of it (colours get a swatch), and
typing inside `spawnEnemy({ })` suggests the properties that aren't there yet, each written
with a sensible starting value.

**It is read from the text, not run.** Like `new Blockspace(...)`, the Code tab finds
`editor.*()` calls by scanning every complex sprite's code as it's typed. Editing never runs
code, so:

- what you give `editor.*()` has to be **written out**: strings, numbers, `true` / `false`,
  lists and objects of those. A variable or a calculation in there gets a warning underline and
  the call is ignored.
- a call counts wherever it is in the code (inside an `if`, in a function nobody calls), and
  the latest one for a name wins. Calls in comments and strings don't count.
- when the code runs, `editor.props(...)` and the rest do nothing at all (in the player and in
  packaged projects too), so they cost nothing and can sit at the top of a sprite's code.

### The four calls

| Call | What it describes |
|---|---|
| `editor.props(name, fields)` | The properties of the object given to `name(...)`, `x.name(...)` or `new name(...)`, or written as `name = {...}` / `const name = {...}` / `name: {...}`. A list of such objects (`const enemies = [{...}, {...}]`) works the same. `fields` is `{property: widget}`. |
| `editor.value(name, widget)` | One value: `const name = 900`, `me.name = 900`, `name: 900`, and a list of them (`const COLORS = ["#f00", "#0f0"]`). |
| `editor.args(name, [widget, ...])` | The arguments of `name(...)`, in order. `null` skips one; an object of fields describes an object argument. |
| `editor.snippet(prefix, code, description?)` | A snippet of your own: typing `prefix` offers `code`. `${1:hp}` marks a place to fill in (Tab goes to the next), as in the built-in snippets. Write `code` in ordinary quotes: in backticks, `${...}` would be JavaScript's. |

```js
editor.value("GRAVITY", {min: 0, max: 2000, step: 50});
const GRAVITY = 900;

editor.args("shake", [{min: 0, max: 50}, "easing"]);
shake(12, "easeOutQuad");

editor.snippet("enemy", 'spawnEnemy({hp: ${1:3}, kind: "${2:slime}"});', "spawn an enemy");
```

`name` is the plain name as it's written at the place of use (`"spawnEnemy"` also matches
`world.spawnEnemy(...)`), so it has to be an identifier. A widget only appears on a value that
is written out and of the right kind: `hp: 3` gets its slider, `hp: base * 2` and `hp: "3"`
are left alone.

### Widgets

A widget is a name, or an object with a `type` and settings:

| `type` | For | In the code |
|---|---|---|
| `"number"` | a number | Drag the `↔` chip left and right. **Shift** moves ten steps at a time, **Alt** a tenth of one. `min`, `max` and `step` are optional; without `step`, a step is the last digit written (`0.5` moves by `0.1`). |
| `"slider"` | a number between `min` and `max` (0 to 100 unless said) | Drag the chip (the whole range is one long drag), or click it for a slider. |
| `"angle"` | a direction (-180 to 180 unless said; 0 is up, 90 is right) | Drag the chip, or click it for a dial. **Shift** snaps to 15°. |
| `"color"` | a `"#rrggbb"` string (`#rgb`, and alpha as `#rrggbbaa`, too) | A swatch; hover the value for the colour picker. Every colour string in the code has this anyway (§16); describing one adds its suggestion and starting value. |
| `"toggle"` | `true` / `false` | A tick box: click to flip. |
| `"select"` | one of `options` (strings or numbers) | Click the `▾` chip for the list. Inside the quotes, the choices are suggested as you type. |
| `"sprite"`, `"costume"`, `"sound"`, `"backdrop"`, `"broadcast"`, `"variable"`, `"list"`, `"animation"` | a name from the project | The same list, filled from the project as it is now (costumes, sounds and animations are this sprite's; variables and lists are the stage's and this sprite's). |
| `"key"`, `"easing"` | a key name, an easing name | The same list, with a search box. |

Every widget also takes `label` (shown on its popup and beside its suggestion) and `default`
(what the property starts as when the editor writes it for you).

Short forms:

| Written | Means |
|---|---|
| `"color"` | `{type: "color"}` |
| `["slime", "bat"]` | `{type: "select", options: ["slime", "bat"]}` |
| `{min: 0, max: 10}` | a slider (both ends given) |
| `{step: 5}`, `{min: 0}` | a number |
| `{fields: {w: "number", h: "number"}}`, or just `{w: "number", h: "number"}` | an object inside the object, with its own widgets. Use the `fields` form when a property is itself called `type`, `min`, `max`, `step` or `options`. |

### What a widget does to the code

Exactly what typing would: it replaces the value's text. So a change can be undone (one drag
or one visit to a popup is one undo step), it autosaves, it reaches collaborators, and with
**Hot reload** on (§27) the running project picks it up a moment after you let go, which makes
the widgets a way of tuning a game while it plays. A string keeps the quotes it had.

The editor only offers a widget for what the project described. Nothing here runs project
code in the editor, so a widget can't draw its own interface: the set above is what there is.

### Types

`EditorApi`, `EditorWidget`, `EditorWidgetName`, `EditorSpec` and `EditorFields` in
`api-types.js`. The scanner and everything that turns a widget's value back into code is in
`lib/block-space/editor-hints.js` (tests: `test/unit/util/blockspace-editor-hints.test.js`);
the chips, popups and suggestions are in `components/block-space/property-editors.js`.
