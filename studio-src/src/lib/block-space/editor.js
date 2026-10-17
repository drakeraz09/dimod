import {findBlockspaces, applyEdits, OPCODES, TWEEN_PROPERTIES, argInputName, EASING_NAMES, WORLD_BUILT_IN_NAMES, TARGET_BUILT_IN_NAMES, extensionTypes, TargetApi, WorldApi, commonExports, transformModule} from './runtime';
import {askConfirm} from '../dimod-ui';
import {getDimodToken} from '../dimod-project';
import Variable from 'scratch-vm/src/engine/variable';
import {animationsOf} from '../dimod-animation/runtime';
const apiTypes = `
// ---- names from this project (filled in by project-types.js via interface merging).
// \`AnyName\` keeps any other string allowed while the project's own names autocomplete.
interface SpriteNames {}
interface MyCostumes {}
interface MySounds {}
interface BackdropNames {}
interface BroadcastNames {}
interface ProjectVars {}
interface ProjectLists {}
interface MyVars {}
interface MyLists {}
/** each blockspace's parameters, by id: {"jump": [height?: any]} */
interface BlockspaceParams {}
/** names of world's own values, and of sprites' own values, in this project */
interface WorldValueNames {}
interface SpriteValueNames {}
interface InputActionNames {}
interface RelayChannels {}
interface CloudNames {}
/** this sprite's animations (its ANIMATIONS tab) */
interface MyAnimations {}
/** every sprite's animations as "Sprite/name" */
interface AnimationRefs {}
/** event names used in this project's animations */
interface AnimationEventNames {}
/**
 * The extensions in this project, as plain functions (me.extensions / world.extensions).
 * Filled in from each extension's getInfo(): its blocks, plus what it adds for code.
 */
interface ExtensionApis {}
type ActionName = keyof InputActionNames | AnyName;
type CloudName = keyof CloudNames | AnyName;
type RelayChannel = keyof RelayChannels | AnyName;
type AnyName = string & {};
type ParamsOf<Id> = Id extends keyof BlockspaceParams ? BlockspaceParams[Id] : any[];

type SpriteName = keyof SpriteNames | AnyName;
type Point = {x: number, y: number};
/** A sprite (by object or name), a point, or "mouse"/"random" where it makes sense. */
type Place = TargetApi | SpriteName | Point | 'mouse' | 'random';
type KeyName = 'space' | 'up arrow' | 'down arrow' | 'left arrow' | 'right arrow' | 'enter' | 'any' |
    'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' |
    'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z' |
    '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type EffectName = 'color' | 'fisheye' | 'whirl' | 'pixelate' | 'mosaic' | 'brightness' | 'ghost' |
    'mosaic_x' | 'mosaic_y' | 'mosaic_width' | 'mosaic_height' | 'invert' |
    'glow' | 'outline' | 'shadow' | 'blur' | 'motion_blur' | 'contrast';
/** "#rrggbb", or [r, g, b] with 0-255 values */
type Colour = string | [number, number, number];

type EventArgs<M, E> = E extends keyof M ? M[E] : any[];
type EventFilter<M, E> = E extends keyof M ? M[E] : never;
type ForbidsFilter<E, Then> = E extends 'touch' | 'untouch' ? never : Then;

/** What each world event hands to its function. */
interface WorldEventArgs {
    preflag: [];
    flag: [];
    stop: [];
    tick: [dt: number];
    key: [key: string];
    keyup: [key: string];
    mousedown: [];
    mouseup: [];
    broadcast: [data: any];
    backdrop: [];
    change: [now: any, was: any, name: string];
    cloud: [value: any, name: string];
    resize: [width: number, height: number];
    animation: [event: string, sprite: TargetApi, animation: Animation, time: number];
    animationend: [sprite: TargetApi, animation: Animation];
    scene: [scene: SceneApi];
}
/** The optional second argument of world.on for the events that take one. */
interface WorldEventFilters {
    key: KeyName | AnyName;
    keyup: KeyName | AnyName;
    broadcast: keyof BroadcastNames | AnyName;
    backdrop: keyof BackdropNames | AnyName;
    change: keyof WorldValueNames | AnyName;
    cloud: CloudName;
    animation: keyof AnimationEventNames | AnyName;
    scene: SceneName | AnyName;
}
interface TargetEventArgs {
    click: [];
    delete: [];
    touch: [];
    untouch: [];
    clone: [];
    cloned: [clone: TargetApi];
    costume: [name: string, index: number];
    say: [text: string, type: 'say' | 'think'];
    change: [now: any, was: any, name: string];
    animation: [event: string, animation: Animation, time: number];
    animationend: [animation: Animation];
    /** Iris Text typed a character (me.iris.on("type") is the same) */
    'iris:type': [char: string, index: number];
    'iris:done': [];
    'iris:charanimationdone': [];
}
interface TargetEventFilters {
    touch: TargetApi | 'edge' | 'mouse' | SpriteName | Colour;
    untouch: TargetApi | 'edge' | 'mouse' | SpriteName | Colour;
    change: keyof SpriteValueNames | AnyName;
    animation: keyof AnimationEventNames | AnyName;
}
interface ServerEventArgs {
    data: [data: any];
    connect: [];
    disconnect: [];
    relay: [data: any, from: Player, channel: string];
    join: [player: Player];
    leave: [player: Player];
}
interface ServerEventFilters {
    relay: RelayChannel;
}
interface SyncEventArgs {
    spawn: [ghost: TargetApi, player: Player];
    remove: [ghost: TargetApi, player: Player, reason: string];
    update: [sprite: TargetApi, state: {[path: string]: any}, player: Player];
}

interface Loop {
    stop(): void;
    pause(): void;
    resume(): void;
    readonly running: boolean;
}
interface Timer { stop(): void; }

/** easings.net's easings. Also accepted: "ease out quad", "out-quad", "OutQuad"... */
type EasingName = 'linear' |
    'easeInSine' | 'easeOutSine' | 'easeInOutSine' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad' |
    'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic' | 'easeInQuart' | 'easeOutQuart' | 'easeInOutQuart' |
    'easeInQuint' | 'easeOutQuint' | 'easeInOutQuint' | 'easeInExpo' | 'easeOutExpo' | 'easeInOutExpo' |
    'easeInCirc' | 'easeOutCirc' | 'easeInOutCirc' | 'easeInBack' | 'easeOutBack' | 'easeInOutBack' |
    'easeInElastic' | 'easeOutElastic' | 'easeInOutElastic' | 'easeInBounce' | 'easeOutBounce' | 'easeInOutBounce';
/** an easing by name, or your own: progress 0-1 -> eased value (1 at the end) */
type Easing = EasingName | AnyName | ((t: number) => number);
/** a number, "+=n" / "-=n" (from where it is now), a "#rrggbb" colour, or an array of numbers */
type TweenValue = number | string | number[];
/** property paths to end values: {x: 100, "effects.ghost": 50, "camera.zoom": 2} */
type TweenTo = {[path: string]: TweenValue};
type SpriteTweenTo = {
    x?: TweenValue; y?: TweenValue; angle?: TweenValue; size?: TweenValue;
    stretchX?: TweenValue; stretchY?: TweenValue; layer?: TweenValue; costumeIndex?: TweenValue;
    'effects.color'?: TweenValue; 'effects.fisheye'?: TweenValue; 'effects.whirl'?: TweenValue;
    'effects.pixelate'?: TweenValue; 'effects.mosaic'?: TweenValue; 'effects.brightness'?: TweenValue;
    'effects.ghost'?: TweenValue; 'sound.volume'?: TweenValue; 'sound.pitch'?: TweenValue;
    'sound.pan'?: TweenValue; 'pen.size'?: TweenValue; 'pen.color'?: TweenValue;
    'pen.transparency'?: TweenValue;
} & TweenTo;
interface TweenOptions {
    /** default "linear" */
    easing?: Easing;
    /** every frame, after the properties are set: value is the eased progress (0-1) */
    onStep?: (value: number, progress: number, tween: Tween) => any;
    /** start values, set straight away, instead of where things are now */
    from?: TweenTo;
    /** seconds to wait before starting */
    delay?: number;
    /** how many more times to play after the first; Infinity (or true) for forever */
    repeat?: number | boolean;
    /** every other play runs backwards */
    yoyo?: boolean;
}
interface NothingTweenOptions {
    /** default "linear" */
    easing?: Easing;
    /** every frame: value goes from \`from\` to \`to\` along the easing; progress 0-1, linear */
    onStep?: (value: number, progress: number, tween: Tween) => any;
    /** default 0 */
    from?: number;
    /** default 1 */
    to?: number;
    delay?: number;
    repeat?: number | boolean;
    yoyo?: boolean;
}
/**
 * A running tween. \`await\` it to wait for the end (rejects with Stopped if it's stopped,
 * e.g. by the stop sign).
 */
interface Tween extends PromiseLike<void> {
    readonly status: 'running' | 'finished' | 'stopped';
    readonly running: boolean;
    readonly paused: boolean;
    readonly duration: number;
    readonly delay: number;
    readonly repeat: number;
    readonly yoyo: boolean;
    /** which play it's on, from 0 */
    readonly iteration: number;
    /** 0-1, linear in time (within this play, backwards on a yoyo's way back) */
    readonly progress: number;
    /** the eased progress - or, tweening nothing, the value between from and to */
    readonly value: number;
    readonly done: Promise<{status: 'finished' | 'stopped'}>;
    stop(): void;
    /** jumps to the end */
    finish(): void;
    pause(): this;
    resume(): this;
    catch(onRejected: (error: any) => any): Promise<any>;
    finally(fn: () => void): Promise<any>;
}
/**
 * What a "call JS" block calls: its "with" values (as JS, as many as the block has), then
 * the sprite running it.
 */
type ExposedFunction = (...argsThenCaller: any[]) => any;

/** The Dimod game server - the Client blocks' connection, rooms and data. */
interface ServerApi {
    /** false where there's no game server (an unsaved project's editor, say) - then it all does nothing */
    readonly available: boolean;
    readonly connected: boolean;
    /** round trip in ms */
    readonly ping: number;
    /** players in this room */
    readonly players: number;
    readonly room: string;
    /** null until connected */
    readonly me: {username: string, id: string, isGuest: boolean} | null;
    /** Anything that isn't a string goes as JSON. */
    send(data: any): void;
    /** The server's answer (JSON is parsed), or null if there's none within 10 seconds. */
    ask(data: any): Promise<any>;
    join(room: string): void;
    connect(): void;
    disconnect(): void;
    reconnect(): void;
    /** The other players in this room (not you). */
    readonly roster: Player[];
    /**
     * To the room's other players (or one: {to: player id}) whatever the server logic does: your own
     * game's code talking to itself. Up to 16 KB; dropped when not connected. They hear it with
     * on("relay", channel, fn). @example world.server.relay("chat", {text: "hi"})
     */
    relay(channel: RelayChannel, data: any, options?: {to?: string}): boolean;
    /**
     * data (what the server sent, JSON parsed), connect, disconnect, relay (something another player relayed;
     * filter it to one channel with on("relay", "chat", fn)), join / leave (a player arrived in, or left, this
     * room). Listening connects.
     */
    on<E extends string>(event: E, fn: (...args: EventArgs<ServerEventArgs, E>) => any): () => void;
    on<E extends string>(event: E, filter: EventFilter<ServerEventFilters, E>,
        fn: (...args: EventArgs<ServerEventArgs, E>) => any): () => void;
}

/** Another player in the room. */
interface Player {
    id: string;
    username: string;
    isGuest: boolean;
}

/** Named actions over keys, the mouse and gamepads. Bindings: "space", "a", "mouse", "pad:a", "pad:lx+"... */
interface InputApi {
    /** Adds bindings to an action (making it). @example world.input.bind("jump", "space", "w", "pad:a") */
    bind(action: ActionName, ...bindings: (KeyName | AnyName | string[])[]): InputApi;
    /** Replaces an action's bindings. */
    rebind(action: ActionName, ...bindings: (KeyName | AnyName | string[])[]): InputApi;
    unbind(action: ActionName, ...bindings: string[]): InputApi;
    /** @example world.input.actions({left: ["a", "left arrow", "pad:lx-"], fire: "mouse"}) */
    actions(map: {[action: string]: string | string[]}): InputApi;
    bindings(action: ActionName): string[];
    readonly names: string[];
    down(action: ActionName): boolean;
    /** Went down this frame. */
    pressed(action: ActionName): boolean;
    released(action: ActionName): boolean;
    /** 0 (up) to 1 (down); triggers and sticks are in between. */
    value(action: ActionName): number;
    /** -1 to 1. @example me.x += 200 * dt * world.input.axis("left", "right") */
    axis(negative: ActionName, positive: ActionName): number;
    /** {x, y}, never longer than 1. */
    vector(left: ActionName, right: ActionName, up: ActionName, down: ActionName): {x: number, y: number};
    on(action: ActionName, fn: (value: number) => any): () => void;
    on(action: ActionName, event: 'press' | 'release', fn: (value: number) => any): () => void;
    /** Resolves with the next input the player uses, as a binding: await it, then rebind(). */
    capture(options?: {skip?: string[], timeout?: number}): Promise<string>;
    /** Holds an action down from code until release(): on-screen buttons, replays, bots. */
    press(action: ActionName): this;
    release(action: ActionName): this;
    /** Down for exactly one frame. */
    tap(action: ActionName): this;
}

interface SyncPropertyOptions {
    /** decimals kept when sending (default 2) */
    precision?: number;
    /** smaller changes than this aren't sent */
    threshold?: number;
    /** false: arrives as it is, without smoothing */
    interpolate?: boolean | {delay?: number};
    /** a jump bigger than this arrives at once instead of gliding */
    snap?: number;
}

interface SyncOptions {
    /**
     * "ghost" (default): everyone else gets a copy of your sprite that follows you.
     * "shared": one sprite everyone moves.
     */
    mode?: 'ghost' | 'shared';
    /** at most this many updates a second (default 15, up to 30) */
    rate?: number;
    /** smooth what arrives (default true), or {delay: ms behind}; false to apply it as it comes */
    interpolate?: boolean | {delay?: number};
    precision?: number;
    threshold?: number;
    snap?: number;
    /** seconds between sending everything even if nothing changed (default 2; 0 = never) */
    heartbeat?: number;
    /** seconds without hearing from a player before their ghost goes (default 10; 0 = never) */
    timeout?: number;
    onTimeout?: 'remove' | 'hide' | 'keep';
    /** shared mode: who may change it - "anyone" (default), "host" (whoever's been here longest) or a function */
    authority?: 'anyone' | 'host' | ((me: any, others: any[]) => boolean);
    /** name this sync (to have more than one on a sprite) */
    id?: string;
    channel?: string;
    /** false to only receive; or a function that says whether to send right now */
    send?: boolean | (() => boolean);
    receive?: boolean;
    /** only these players' updates count */
    filter?: (player: Player) => boolean;
    /** change what came in before it's applied */
    transform?: (state: {[path: string]: any}, player: Player) => {[path: string]: any} | void;
    /** change what's about to be sent */
    encode?: (state: {[path: string]: any}) => {[path: string]: any} | void;
    /** ghosts: values to set when a ghost is made, plus run (let the sprite's code run on it), show, label */
    ghost?: {run?: boolean, show?: boolean, label?: boolean | ((player: Player) => string), [path: string]: any};
    onSpawn?: (ghost: TargetApi, player: Player) => any;
    onRemove?: (ghost: TargetApi, player: Player, reason: string) => any;
    onUpdate?: (sprite: TargetApi, state: {[path: string]: any}, player: Player) => any;
}

/** What me.sync() gives back. */
interface SyncHandle {
    /** false with no game server (or on a clone) - then it does nothing */
    readonly available: boolean;
    readonly active: boolean;
    readonly channel: string;
    readonly mode: 'ghost' | 'shared';
    /** the other players' copies of this sprite (ghost mode): player id -> sprite */
    readonly ghosts: Map<string, TargetApi>;
    /** the players it's heard from */
    readonly players: Player[];
    readonly stats: {sent: number, received: number, bytes: number, ghosts: number};
    /** anything JSON, sent along; ghosts see it as me.remote.extra */
    extra: any;
    ghostOf(playerId: string): TargetApi | null;
    pause(): void;
    resume(): void;
    stop(): void;
    /** sends everything now */
    flush(): void;
    /** spawn (a ghost was made), remove (one went), update (something new came in for a sprite). */
    on<E extends string>(event: E, fn: (...args: EventArgs<SyncEventArgs, E>) => any): () => void;
}

/** On a ghost: which player's it is. */
interface RemoteInfo {
    player: Player;
    extra: any;
    /** seconds since the last update */
    readonly ago: number;
    sync: SyncHandle;
}

/** An event to await. TimeoutError when {timeout} runs out. */
interface OnceOptions {
    timeout?: number;
}

/**
 * Block scripts owned by this code, edited with the ▶ blocks button on its line. Run its
 * "when called" script with \`me.run(blockspace, ...args)\`; its other scripts (green
 * flag, key presses...) run like any sprite's.
 * @example const jump = new Blockspace("jump");
 */
declare class Blockspace<Id extends string = string> {
    constructor(id: Id, payload?: object);
    readonly id: Id;
    /** the "when called" hat's parameter names, in order */
    readonly params: string[];
    /** false once its \`new Blockspace\` line is gone from the code */
    readonly exists: boolean;
}

interface RunResult {
    /** returned: a return block ran · finished: the script ended · stopped: stopped */
    status: 'returned' | 'finished' | 'stopped';
    value: any;
}
/**
 * One run of a blockspace (or of a single block). \`await\` it for the returned value
 * (rejects with Stopped if it was stopped), \`for await\` it for each yield, or read
 * .done for how it ended.
 */
interface RunHandle extends PromiseLike<any>, AsyncIterable<any> {
    readonly blockspace: Blockspace<any> | null;
    readonly target: TargetApi;
    readonly running: boolean;
    readonly status: 'running' | 'returned' | 'finished' | 'stopped';
    readonly value: any;
    readonly done: Promise<RunResult>;
    /** Stops it; a \`for await\` over it ends. */
    stop(): void;
    catch(onRejected: (error: any) => any): Promise<any>;
    finally(fn: () => void): Promise<any>;
}

interface VariableBag {
    [name: string]: any;
    /** Makes the variable if it doesn't exist yet. scope: "sprite" (default), "global" or "cloud". */
    declare(name: string, value?: any, options?: {scope?: 'sprite' | 'global' | 'cloud'}): any;
    has(name: string): boolean;
}
interface ListBag {
    [name: string]: any[] | any;
    /** Makes the list if it doesn't exist yet. Lists are 0-based arrays here. */
    declare(name: string, value?: any[], options?: {scope?: 'sprite' | 'global'}): any[];
    has(name: string): boolean;
}
interface HoldOptions {
    /**
     * When held values go back to their defaults. Default "flag". "save": never, and
     * they're kept in the project file (saved with it), so they're there next time it opens.
     */
    reset?: 'flag' | 'stop' | 'never' | 'save';
}

/** A sprite's sounds. */
interface SoundApi {
    /** this sprite's sound names */
    readonly names: string[];
    /** Plays a sound; resolves when it has finished. */
    play(name: keyof MySounds | AnyName): Promise<void>;
    /** Starts a sound without waiting for it. */
    start(name: keyof MySounds | AnyName): void;
    /** Stops that sound if this sprite is playing it; a play() waiting on it resolves. */
    stop(name: keyof MySounds | AnyName): void;
    /** Stops every sound, in every sprite. */
    stopAll(): void;
    /** 0-100 */
    volume: number;
    pitch: number;
    /** -100 (left) to 100 (right) */
    pan: number;
    /** 0 (off) to 100 */
    echo: number;
    /** 0 (off) to 100 */
    reverb: number;
    /** 0 (off) to 100: muffled */
    lowpass: number;
    /** 0 (off) to 100: tinny */
    highpass: number;
    /** 0 (off) to 100 */
    distortion: number;
    clearEffects(): void;
    /** overlap("laser"): playing it while it plays starts another copy instead of starting over. overlap("laser", false) undoes it. */
    overlap(name: keyof MySounds | AnyName, on?: boolean): void;
    overlaps(name: keyof MySounds | AnyName): boolean;
}

/** A sprite's pen (needs the Pen extension). Moving while it's down draws. */
interface PenApi {
    down(): this;
    up(): this;
    readonly isDown: boolean;
    stamp(): this;
    color: Colour;
    size: number;
    /** 0 (solid) to 100 (invisible) */
    transparency: number;
}

/** A camera (needs the Camera extension). */
interface CameraApi {
    readonly name: string;
    x: number;
    y: number;
    /** degrees; 0 is upright */
    angle: number;
    /** 1 is normal; 2 is twice as close */
    zoom: number;
    goTo(x: number, y: number): this;
    goTo(point: Point): this;
    move(dx: number, dy: number): this;
    glide(seconds: number, x: number, y: number, easing?: Easing): Promise<void>;
    /** Keeps a sprite centred, every frame, until unfollow() or the stop sign. smoothing 0-1 trails behind. */
    follow(target: TargetApi, options?: {smoothing?: number}): Loop;
    unfollow(): void;
}


/** world.cloud: the project's cloud variables, carried by the game server (see world.server) */
interface CloudApi {
    /** The value, parsed if it's JSON, or the fallback if there's no such variable. */
    get(name: CloudName, fallback?: any): any;
    /** What the variable holds, unparsed (same as world.cloud.name). */
    raw(name: CloudName): any;
    /** Sets it, making the variable if it doesn't exist. Objects and arrays are stored as JSON. */
    set<T>(name: CloudName, value: T): T;
    has(name: CloudName): boolean;
    /** Deletes it for everyone in the room. true if there was one. */
    delete(name: CloudName): boolean;
    /** Names without the ☁. */
    names(): string[];
    /** Every cloud variable as {name: value}, parsed like get(). */
    all(): {[name: string]: any};
    /** Someone else changed a cloud variable (own writes don't fire it). Value parsed like get(). */
    on(fn: (value: any, name: string) => any): () => void;
    on(name: CloudName, fn: (value: any, name: string) => any): () => void;
    /** false where there's no game server to carry them */
    readonly available: boolean;
    readonly connected: boolean;
    /** The server's limits: 1 MB a value, 256 characters a name, 128 variables a room. */
    readonly limits: {readonly valueBytes: number; readonly nameLength: number; readonly variables: number};
}
interface Gamepad {
    readonly id: string;
    readonly buttons: boolean[];
    readonly axes: number[];
    button(index: number): boolean;
    axis(index: number): number;
}

// ---- animations (the ANIMATIONS tab; docs §30)
/**
 * An animation: an Animation, a name ("walk" is this sprite's), "Sprite/walk", an animation value
 * from a variable, JSON text or an animation object.
 */
type AnimationLike = Animation | keyof MyAnimations | keyof AnimationRefs | AnyName | object;
/** loop: over and over. once: to the end, then holds the last frame. pingpong: forwards, backwards, forwards... */
type PlayMode = 'loop' | 'once' | 'pingpong';
/** How times past the end map back into the animation (mapTime, progress, and "show at"). */
type TimeMode = 'clamp' | 'loop' | 'pingpong' | 'reverse' | 'reverseloop';
/** A part property: the track name, or the block menu's words ("ghost effect"). */
type PartProperty = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'alpha' | 'skewX' | 'skewY' | 'fxColor' |
    'fxBrightness' | 'fxGhost' | 'fxPixelate' | 'fxMosaic' | 'fxWhirl' | 'fxFisheye' | 'glowSize' | 'outlineWidth' |
    'tint' | 'visible' | 'zIndex' | 'costume' | 'scale x' | 'scale y' | 'skew x' | 'skew y' | 'color effect' |
    'brightness effect' | 'ghost effect' | 'pixelate effect' | 'mosaic effect' | 'whirl effect' | 'fisheye effect' |
    'glow size' | 'outline width' | 'z-order';
interface PlayOptions {
    /** default "loop" */
    mode?: PlayMode;
    /** false plays it once, true loops (a \`mode\` wins over this) */
    loop?: boolean;
    /** 1 is normal, 2 twice as fast. Kept by later plays while something is playing. */
    speed?: number;
    /** start this many seconds in */
    from?: number;
    /** seconds to blend from what was playing (limbs blend smoothly when both have the same parts) */
    crossfade?: number;
}

/**
 * One animation from a sprite's ANIMATIONS tab (or a copy of one). It follows later edits in
 * the tab. Put it in a variable (\`me.vars.anim = walk\`) and blocks get the animation value.
 * @example const walk = me.animation("walk"); me.animator.play(walk);
 */
interface Animation {
    readonly name: string;
    readonly id: string;
    /** "Sprite/name" - what the blocks and variables see (a copy's is its JSON) */
    readonly ref: string;
    /** false once it's been deleted from its tab */
    readonly exists: boolean;
    /** the sprite whose tab it's in; null for a copy */
    readonly sprite: TargetApi | null;
    /** made with copy() (or from JSON): not in any tab */
    readonly isCopy: boolean;
    /** the same animation (by id) */
    is(other: Animation): boolean;

    /** seconds; Infinity when it plays forever */
    readonly duration: number;
    readonly infinite: boolean;
    readonly fps: number;
    /** duration × fps */
    readonly frames: number;
    /** part names, top to bottom */
    readonly parts: string[];
    /** its events in time order */
    readonly events: {name: string, time: number}[];
    /** its data tracks' names */
    readonly dataNames: string[];
    /** the last event it fired, on any sprite */
    readonly lastEvent: string;

    /**
     * Data its expressions can read (\`data.speed\`), for every sprite playing it.
     * @example walk.data.speed = 2
     */
    data: {[name: string]: number | string};
    /** A part, to override its properties. Throws if there's no such part. */
    part(name: string): AnimationPart;
    /** Clears every part's overrides. */
    resetParts(): this;

    /** Used by "show at", mapTime, progress and loopCount. Default "clamp". */
    timeMode: TimeMode | 'ping-pong' | 'reverse loop';
    /** Where \`seconds\` lands in the animation under its time mode. */
    mapTime(seconds: number): number;
    /** 0-1: how far through it \`seconds\` is. */
    progress(seconds: number): number;
    /** How many times it has played through by \`seconds\`. */
    loopCount(seconds: number): number;

    /** anti-aliasing (world.animationSmoothing until set) */
    smoothing: boolean;
    /** render resolution (world.animationDetail until set) */
    detail: 'low' | 'medium' | 'high';

    /** A copy with its own data and overrides, not in any tab. */
    copy(): Animation;
    /**
     * fn(event, sprite, time) when it fires an event, on any sprite playing it. Returns the remove.
     * @example walk.on("step", (event, who) => who.sound.start("tap"))
     */
    on(fn: (event: string, sprite: TargetApi, time: number) => any): () => void;
    on(event: keyof AnimationEventNames | AnyName,
        fn: (event: string, sprite: TargetApi, time: number) => any): () => void;
}

/** A part of an animation. Overrides replace what its keyframes say, for every sprite playing it. */
interface AnimationPart {
    readonly animation: Animation;
    readonly name: string;
    /** @example walk.part("Arm").set("rotation", 30).set({"ghost effect": 50}) */
    set(property: PartProperty, value: number | string | boolean): this;
    set(values: {[property in PartProperty]?: number | string | boolean}): this;
    /** One override, or every override on this part when no property is given. */
    reset(property?: PartProperty): this;
    /** The override on a property, or undefined when the keyframes decide. */
    get(property: PartProperty): number | string | undefined;
    /**
     * "[property] of part [name] in (animation)": what the animation gives this part (keyframes,
     * expressions and overrides, before parenting) \`seconds\` into it. Without \`seconds\` it's this
     * sprite's time in the animation, or 0 when it isn't playing it. Any track works, not only the
     * settable ones ("glowStrength", "shadowBlur", "blendMode"...). Colours are "#rrggbb", on/off
     * properties like "visible" are booleans.
     * @example walk.part("Arm").value("rotation"); walk.part("Arm").value("alpha", 0.5)
     */
    value(property: PartProperty | (string & {}), seconds?: number): number | string | boolean;
    /** every override on this part */
    readonly overrides: {[property: string]: number | string};
}

/** Where a part of what a sprite is showing is, on the stage, right now. */
interface LivePart {
    readonly name: string;
    /** false when the sprite isn't showing an animation with this part */
    readonly shown: boolean;
    readonly x: number;
    readonly y: number;
    /** degrees, the sprite's own turn included (0 = as drawn) */
    readonly rotation: number;
    /** size on the stage in percent: the part's scale and its parents' times the sprite's size */
    readonly scaleX: number;
    readonly scaleY: number;
    readonly visible: boolean;
    /** An opaque pixel of this part is at that point. @example arm.touching("mouse") */
    touching(x: number, y: number): boolean;
    touching(place: Point | 'mouse'): boolean;
    /** Overrides on the animation being shown (see AnimationPart). */
    set(property: PartProperty, value: number | string | boolean): this;
    set(values: {[property in PartProperty]?: number | string | boolean}): this;
    reset(property?: PartProperty): this;
}

/** What one sprite or clone is playing (me.animator). Sprites only, not the stage. */
interface Animator {
    /**
     * Plays an animation on this sprite in place of its costume.
     * @example me.animator.play("walk")
     * @example me.animator.play("jump", {mode: "once", speed: 1.5})
     * @example me.animator.play("jump", false) // once, no loop
     */
    play(animation: AnimationLike, options?: PlayMode | boolean | PlayOptions): this;
    /** Plays it once; resolves at its end, or when something else is played or it's stopped. */
    playUntilDone(animation: AnimationLike,
        options?: {speed?: number, from?: number, crossfade?: number}): Promise<void>;
    /** Blends into it over \`seconds\`. */
    crossfade(animation: AnimationLike, seconds: number, options?: PlayMode | boolean | PlayOptions): this;
    /** Resolves when what's playing now ends (straight away if nothing is). */
    finished(): Promise<void>;
    /** Holds one frame, like "show (animation) at (secs) secs". Stops what was playing. */
    show(animation: AnimationLike, seconds: number): this;
    /** Stops, and shows the costume again. */
    stop(): this;
    pause(): this;
    resume(): this;

    readonly playing: boolean;
    readonly paused: boolean;
    /** a "once" play got to its end */
    readonly done: boolean;
    /** what's playing's mode, or null */
    readonly mode: PlayMode | null;
    /** 1 is normal. No effect while nothing is playing. */
    speed: number;
    /** seconds into what's playing (after looping); set it to jump */
    time: number;
    /** what's drawn on this sprite (playing or shown), or null */
    readonly current: Animation | null;
    readonly lastEvent: string;
    /** the parts of what's drawn */
    readonly parts: string[];
    /**
     * A part of what's drawn, as it is on the stage now.
     * @example if (me.animator.part("Sword").touching("mouse")) me.say("ow")
     */
    part(name: string): LivePart;
}

/**
 * A sprite, a clone or the stage. Also holds values of its own: \`me.hp = 3\`, and
 * \`enemy.hp -= 1\` from anywhere. They're emptied by the green flag; a clone starts
 * with a copy of its parent's. Blocks see them as (my value [hp]).
 */
interface SceneNames {}
type SceneName = keyof SceneNames;

/** A scene: a room with its own sprites and backdrop. Sprites outside the current scene are hidden and don't run. */
declare class SceneApi {
    readonly id: string;
    name: string;
    readonly index: number;
    readonly isCurrent: boolean;
    /** the scene the project starts in */
    readonly isStart: boolean;
    /** the backdrop (name) shown in this scene, or "" to leave it */
    backdrop: string;
    readonly sprites: TargetApi[];
    /** Switches to this scene; its "when scene starts" scripts and world.on("scene") handlers run. */
    go(): void;
    makeStart(): void;
    has(sprite: TargetApi): boolean;
    add(sprite: TargetApi): void;
    remove(sprite: TargetApi): void;
    delete(): boolean;
}

/** A file in the project's Assets tab. */
declare class AssetApi {
    name: string;
    readonly kind: 'image' | 'sound' | 'font' | 'text' | 'data';
    /** the file extension */
    readonly format: string;
    readonly size: number;
    /** a URL the page can load it from (img src, fetch...) */
    readonly url: string;
    readonly bytes: Uint8Array;
    text(): string;
    json(): any;
    /** Replaces its contents (objects are saved as JSON). */
    write(value: string | object): void;
    delete(): void;
}

interface AssetsApi {
    get(name: string): AssetApi | null;
    has(name: string): boolean;
    list(kind?: 'image' | 'sound' | 'font' | 'text' | 'data' | 'any'): AssetApi[];
    text(name: string): string;
    json(name: string): any;
    /** Writes a text asset, making it if it isn't there. @example world.assets.write("save", {level: 3}) */
    write(name: string, value: string | object): AssetApi;
}

declare class TargetApi {
    readonly name: string;
    readonly id: string;
    readonly isStage: boolean;
    /** true in a clone's copy of the code */
    readonly isClone: boolean;
    /** false once this sprite/clone has been deleted */
    readonly exists: boolean;
    /** the non-clone sprite (itself if this isn't a clone) */
    readonly original: TargetApi;
    /** the target this clone was made from, or null */
    readonly parent: TargetApi | null;
    /** this sprite's clones */
    readonly clones: TargetApi[];

    // ---- scenes
    /** The scenes this sprite appears in. Set it to scenes (or names), or "all". Nothing of it shows or runs outside them. */
    get scenes(): SceneApi[];
    set scenes(value: (SceneApi | SceneName | AnyName)[] | SceneApi | SceneName | 'all');
    inScene(scene: SceneApi | SceneName | AnyName): boolean;
    addToScene(scene: SceneApi | SceneName | AnyName): void;
    removeFromScene(scene: SceneApi | SceneName | AnyName): void;

    // ---- motion
    x: number;
    y: number;
    /** direction in degrees; 90 = right, 0 = up */
    angle: number;
    rotationStyle: 'all around' | 'left-right' | "don't rotate" | 'look at';
    draggable: boolean;
    goTo(x: number, y: number): this;
    goTo(place: Place): this;
    move(steps: number): this;
    turn(degrees: number): this;
    pointAt(x: number, y: number): this;
    pointAt(place: TargetApi | SpriteName | Point | 'mouse'): this;
    /** @example await me.glide(1, 0, 0) */
    glide(seconds: number, x: number, y: number, easing?: Easing): Promise<void>;
    glide(seconds: number, place: Place, easing?: Easing): Promise<void>;
    distanceTo(x: number, y: number): number;
    distanceTo(place: TargetApi | SpriteName | Point | 'mouse'): number;

    /**
     * Where it is, which way it points, its size and stretch, as one value. Setting it moves,
     * turns, sizes and stretches the sprite at once.
     * @example const home = me.position; ... me.position = home;
     */
    position: Position;

    // ---- looks
    size: number;
    stretchX: number;
    stretchY: number;
    visible: boolean;
    /**
     * Tint colour, read back as "#rrggbb" ("#ffffff" = none). Set it to "#f00", "#ff0000",
     * 0xff0000 or [255, 0, 0]; null clears it.
     * @example me.tint = "#ff0000"
     */
    get tint(): string;
    set tint(value: string | number | [number, number, number] | null);
    layer: number;
    /** costume name - set it with a name, or a 0-based index */
    get costume(): keyof MyCostumes | AnyName;
    set costume(value: keyof MyCostumes | AnyName | number);
    costumeIndex: number;
    readonly costumes: string[];
    setCostume(nameOrIndex: keyof MyCostumes | AnyName | number): this;
    nextCostume(): this;
    /**
     * Draws this sprite with a Skin instead of its own costumes; null (or setCostume/costume)
     * goes back to normal. Built-in "Turbo Skins" (see Skin).
     * @example me.skin = await Skin.fromURL("https://example.com/heart.png");
     */
    skin: Skin | null;
    /** A Skin that shows exactly this sprite's costume \`name\`, for another sprite to borrow. */
    skinFromCostume(name: keyof MyCostumes | AnyName): Skin;
    /** me.effects.ghost = 50; me.effects.clear() */
    effects: {[effect in EffectName]: number} & {[effect: string]: number} & {clear(): void};
    /** With seconds, resolves when the bubble goes away. */
    say(message?: any, seconds?: number): Promise<void>;
    think(message?: any, seconds?: number): Promise<void>;

    // ---- sound, pen, camera
    readonly sound: SoundApi;
    /** Needs the Pen extension. */
    readonly pen: PenApi;
    /** The camera this sprite is seen through, by name; null for none (Camera extension). */
    camera: string | CameraApi | null;

    // ---- animations
    /** this sprite's animations (its ANIMATIONS tab) */
    readonly animations: Animation[];
    /**
     * An animation by name ("walk" is this sprite's, "Hero/walk" another's), or from a value.
     * Throws if there's no such animation.
     */
    animation(animation: AnimationLike): Animation;
    /** What this sprite is playing: play, stop, speed, parts on the stage... Not on the stage. */
    readonly animator: Animator;

    // ---- sensing
    /** a sprite, "edge", "mouse" - or a colour ("#ff0000" / [255, 0, 0]) */
    touching(thing: TargetApi | 'edge' | 'mouse' | SpriteName | Colour): boolean;
    /**
     * touching(), but hidden sprites count too: this one, the other one, or both.
     * @example if (me.touchingAtAll("Trigger")) world.broadcast("entered")
     */
    touchingAtAll(thing: TargetApi | 'edge' | 'mouse' | SpriteName): boolean;
    /** every one of that sprite's clones (and the original) this is touching */
    touchingAll(spriteName: SpriteName): TargetApi[];
    touchingColor(color: Colour): boolean;
    colorTouching(color: Colour, otherColor: Colour): boolean;
    /** Asks like "ask and wait" (a speech bubble) and resolves with the answer. */
    ask(question: any): Promise<string>;

    // ---- blockspaces and blocks
    /**
     * Runs a blockspace's "when called" script as this target; args fill its parameters
     * in order.
     * @example const sum = await fromCast(me.run(add, 2, 3));
     */
    run<Id extends string>(blockspace: Blockspace<Id>, ...args: ParamsOf<Id>): RunHandle;
    /** restart: stop this blockspace's other runs on this target first. */
    runWith<Id extends string>(
        blockspace: Blockspace<Id>, options: {restart?: boolean}, ...args: ParamsOf<Id>
    ): RunHandle;
    /**
     * Runs any one command block as this target; resolves when it's done.
     * @example await me.block("motion_glidesecstoxy", {SECS: 1, X: 0, Y: 0})
     */
    block(opcode: string, args?: {[input: string]: any}): RunHandle;
    /**
     * Runs any one reporter block as this target; resolves with its value.
     * @example const answer = await me.reporter("sensing_answer")
     */
    reporter(opcode: string, args?: {[input: string]: any}): RunHandle;
    /**
     * An extension's blocks, by name, run as this target.
     * @example await me.ext("pen").penDown()
     */
    ext(extensionId: string): {[opcode: string]: (args?: {[input: string]: any}) => RunHandle};
    /**
     * Every extension in the project as plain functions, run as this sprite straight away:
     * arguments in the order the block shows them (or by name), returning what the block
     * reports (a promise if it waits). Extensions can add their own members for code.
     * @example const list = me.extensions.jwArray.blank(); me.extensions.jwArray.get(1, list)
     */
    readonly extensions: ExtensionApis;
    /**
     * Iris Text on this sprite (needs the Iris Text extension).
     * @example await me.iris.type("Hello <color #f00>world</color>!")
     */
    readonly iris: IrisApi;
    /**
     * This sprite's blockspace by id, to run its blocks from other code.
     * @example enemy.run(enemy.blockspace("hurt"), 5)   // as enemy
     * @example me.run(enemy.blockspace("hurt"), 5)      // enemy's blocks, as me
     */
    blockspace(id: string): Blockspace<any>;

    // ---- clones
    /** Makes a clone right away (its code has already run when this returns). null at the clone limit. */
    clone(): TargetApi | null;
    /** Deletes this clone. */
    delete(): void;

    // ---- state
    vars: VariableBag;
    lists: ListBag;
    /**
     * Values that survive code edits; clones get a copy of their parent's.
     * @example const state = me.hold({score: 0});
     */
    hold<T extends object>(defaults: T, options?: HoldOptions): T;

    /**
     * Tweens any of this sprite's properties (own values and paths like "effects.ghost" too).
     * @example await me.tween({x: 100, size: "+=50"}, 1, "easeOutBack")
     */
    tween(to: SpriteTweenTo, seconds: number, options?: Easing | TweenOptions): Tween;
    /**
     * A function the "call JS [name] with ()" blocks can call while running as this
     * sprite. It can return a value (or a promise, which the block waits for).
     * Returns a function that removes it.
     * @example me.expose("heal", n => { me.hp += n; return me.hp; })
     */
    expose(name: string, fn: ExposedFunction): () => void;

    // ---- events (each returns a function that removes the handler)
    /**
     * click, delete, touch / untouch (with what it touches), clone, cloned, costume, say, change (own values),
     * animation (an event in what it's playing; name one to hear only it), animationend (a "once" play ended).
     * Each returns a function that removes the handler.
     * @example me.on("click", () => me.say("ouch", 1))
     */
    on<E extends string>(event: E, fn: ForbidsFilter<E, (...args: EventArgs<TargetEventArgs, E>) => any>): () => void;
    on<E extends string>(event: E, filter: EventFilter<TargetEventFilters, E>,
        fn: (...args: EventArgs<TargetEventArgs, E>) => any): () => void;
    /** The next time it happens, as a promise (of the event's first value). @example await me.once("click") */
    once<E extends string>(event: E, options?: OnceOptions): Promise<any>;
    once<E extends string>(event: E, filter: EventFilter<TargetEventFilters, E>, options?: OnceOptions): Promise<any>;
    /** Runs fn after some seconds; ends with this code. */
    after(seconds: number, fn: () => any): Timer;
    every(seconds: number, fn: () => any): Timer;
    /**
     * Keeps this sprite the same for everyone in the room, over the game server. Everyone else gets a
     * copy of it (a "ghost") that follows the player; \`mode: "shared"\` makes it one sprite instead.
     * @example me.sync(["x", "y", "direction"])
     * @example me.sync("motion", {rate: 20, interpolate: {delay: 80}, ghost: {label: true}})
     */
    sync(props: string | (string | {[path: string]: SyncPropertyOptions | boolean})[] |
        {[path: string]: SyncPropertyOptions | boolean}, options?: SyncOptions): SyncHandle;
    /** On another player's ghost: whose it is. null on any other sprite. */
    readonly remote: RemoteInfo | null;
}

/**
 * The whole project. Also holds values of your own, shared by all complex code:
 * \`world.score = 5\` in one sprite, \`world.score\` in any other. They're emptied by the
 * green flag, when all complex code runs again from the top and sets them up afresh.
 */
declare class WorldApi {
    // ---- events (each returns a function that removes the handler)
    /**
     * flag, preflag, stop, tick, key, keyup, mousedown, mouseup, broadcast, backdrop, change, cloud, resize,
     * animation, animationend, scene - or
     * your own, sent with world.emit. Some take a second argument to say which one (on("key", "space", fn)).
     * Each returns a function that removes the handler.
     * @example world.on("flag", () => me.goTo(0, 0))
     */
    on<E extends string>(event: E, fn: (...args: EventArgs<WorldEventArgs, E>) => any): () => void;
    on<E extends string>(event: E, filter: EventFilter<WorldEventFilters, E>,
        fn: (...args: EventArgs<WorldEventArgs, E>) => any): () => void;
    /** A JS-only event for complex sprites' world.on(event, ...). */
    emit(event: string, ...args: any[]): void;
    /** A real Scratch broadcast: "when I receive" scripts and world.on("broadcast") handlers. */
    broadcast(message: keyof BroadcastNames | AnyName, data?: any): void;
    broadcastAndWait(message: keyof BroadcastNames | AnyName, data?: any): Promise<void>;

    /** Runs a blockspace on every target at once; resolves with their returned values in order. */
    runAll<Id extends string>(
        blockspace: Blockspace<Id>, targets: Iterable<TargetApi>, ...args: ParamsOf<Id>
    ): Promise<any[]>;

    // ---- targets
    getTarget(name: SpriteName): TargetApi | null;
    readonly stage: TargetApi;
    /** every original sprite (not clones, not the stage) */
    readonly sprites: TargetApi[];

    // ---- backdrop
    /**
     * Setting it starts "when backdrop switches to" scripts. Also takes "next backdrop",
     * "previous backdrop" and "random backdrop".
     */
    get backdrop(): keyof BackdropNames | AnyName;
    set backdrop(name: keyof BackdropNames | AnyName | 'next backdrop' | 'previous backdrop' | 'random backdrop');
    readonly backdrops: string[];

    // ---- scenes
    /** The scene the project is in. Set it to a scene or its name to switch. @example world.scene = "Level 2" */
    get scene(): SceneApi;
    set scene(scene: SceneApi | SceneName | AnyName);
    readonly scenes: SceneApi[];
    getScene(name: SceneName | AnyName): SceneApi | null;
    addScene(name?: string): SceneApi;
    nextScene(): void;
    previousScene(): void;

    // ---- assets
    /** The project's files (the Assets tab). */
    readonly assets: AssetsApi;

    // ---- animations
    /** An animation from a value or "Sprite/name" (world has none of its own). */
    animation(animation: AnimationLike): Animation;
    /** every sprite's animations */
    readonly animations: Animation[];
    /** anti-aliasing for every animation that doesn't set its own */
    animationSmoothing: boolean;
    /** render resolution for every animation that doesn't set its own */
    animationDetail: 'low' | 'medium' | 'high';

    // ---- camera and pen (need their extensions)
    /** The main camera (Camera extension). */
    readonly camera: CameraApi;
    readonly cameras: {get(name: string): CameraApi};
    readonly pen: {clear(): void; of(target: TargetApi): PenApi};
    /** Adds a built-in extension if the project doesn't have it yet. */
    useExtension(id: 'pen' | 'pmCamera' | AnyName): void;
    /** An extension's blocks by name, run as the stage. @example world.ext("pen").clear() */
    ext(extensionId: string): {[opcode: string]: (args?: {[input: string]: any}) => RunHandle};
    /** Every extension in the project as plain functions, run as the stage (see me.extensions). */
    readonly extensions: ExtensionApis;

    // ---- state
    vars: VariableBag & ProjectVars;
    lists: ListBag & ProjectLists;
    /** The cloud variables. world.cloud.best is "☁ best"; objects and arrays are stored as JSON. */
    cloud: CloudApi & {[name: string]: any};
    hold<T extends object>(defaults: T, options?: HoldOptions): T;
    /** Tweens world's own values and properties ("camera.zoom" too). @example world.tween({score: 100}, 2) */
    tween(to: TweenTo, seconds: number, options?: Easing | TweenOptions): Tween;
    /** A function the "call JS [name] with ()" blocks can call from any sprite. */
    expose(name: string, fn: ExposedFunction): () => void;
    /**
     * A hat for any condition, checked every frame. on "true" (default): fn(value) each time
     * it goes from falsy to truthy. on "change": fn(now, was) each time the value changes.
     * Keeps going after the stop sign, like a hat. Returns a function that removes it.
     * @example world.watch(() => world.score >= 10, () => world.broadcast("win"))
     */
    watch<T>(expr: () => T, fn: (now: T, was?: T) => any, options?: {on?: 'true' | 'change'}): () => void;
    /** The Dimod game server (the Client blocks' connection). */
    readonly server: ServerApi;
    readonly stageWidth: number;
    readonly stageHeight: number;

    // ---- input
    /** pressed / released are true for the one frame the button went down / came up. */
    readonly mouse: {readonly x: number; readonly y: number; readonly down: boolean; readonly pressed: boolean; readonly released: boolean};
    readonly keys: {isDown(key: KeyName | AnyName): boolean; readonly down: Set<string>};
    /** The prompt at the bottom of the stage; resolves with the answer. */
    ask(question: any): Promise<string>;
    /** A connected gamepad (0 = the first one), or null. */
    gamepad(index?: number): Gamepad | null;

    // ---- time
    readonly timer: number;
    resetTimer(): void;
    readonly now: Date;
    /** fn(dt) every frame until the stop sign or loop.stop(). */
    forever(fn: (dt: number) => any): Loop;
    every(seconds: number, fn: () => any): Timer;
    after(seconds: number, fn: () => any): Timer;
    /** Named actions over keys, the mouse and gamepads. */
    readonly input: InputApi;
    /** true while "Run tests" is running the tests */
    readonly testing: boolean;
    /** The next time it happens, as a promise. @example const key = await world.once("key", "space") */
    once<E extends string>(event: E, options?: OnceOptions): Promise<any>;
    once<E extends string>(event: E, filter: EventFilter<WorldEventFilters, E> | string, options?: OnceOptions): Promise<any>;
}

interface MeApi extends TargetApi {
    vars: VariableBag & ProjectVars & MyVars;
    lists: ListBag & ProjectLists & MyLists;
}
/** This sprite - or this clone, in a clone's copy of the code. */
/**
 * A sprite's placement as one value: where it is, which way it points, how big it is and how
 * it's stretched. Every method gives a new Position. The Positions extension's blocks read it,
 * and Position.from() reads theirs.
 * @example const hand = new Position(30, 10); friend.position = hand.relativeTo(me.position);
 */
declare class Position {
    /** each optional: 0, 0, 90 (right), 100 (%), 100, 100 */
    constructor(x?: number, y?: number, direction?: number, size?: number, stretchX?: number, stretchY?: number);
    constructor(fields: Partial<PositionFields>);
    /**
     * a Position from a Position, a sprite (me), the Positions extension's value or its JSON,
     * or {x, y, ...}
     */
    static from(value: Position | TargetApi | Partial<PositionFields> | string): Position;
    x: number;
    y: number;
    /** Scratch direction: 90 is right, 0 is up */
    direction: number;
    /** % */
    size: number;
    stretchX: number;
    stretchY: number;
    clone(): Position;
    /** a copy with some fields changed @example pos.with({direction: 0}) */
    with(changes: Partial<PositionFields>): Position;
    /** field by field; a number applies to every field */
    add(other: Position | PositionFields | number): Position;
    subtract(other: Position | PositionFields | number): Position;
    multiply(other: Position | PositionFields | number): Position;
    /** (dividing by 0 gives 0) */
    divide(other: Position | PositionFields | number): Position;
    /**
     * This position given in \`parent\`'s frame, placed in the world: turned by the parent's
     * direction, scaled by its size and stretch, then moved to it.
     * @example new Position(30, 10).relativeTo(me.position) // 30 in front of me, 10 to my left
     */
    relativeTo(parent: Position | TargetApi): Position;
    /** the opposite of relativeTo: this world position in \`parent\`'s frame */
    localTo(parent: Position | TargetApi): Position;
    distanceTo(other: Position | TargetApi): number;
    /** the direction to face to point at it (90 is right) */
    angleTo(other: Position | TargetApi): number;
    /** part of the way there: 0 is here, 1 is there */
    lerp(other: Position | TargetApi, amount: number): Position;
    equals(other: Position | TargetApi): boolean;
    toJSON(): PositionFields;
    /** JSON text (what a variable gets) */
    toString(): string;
}
interface PositionFields {
    x: number; y: number; direction: number; size: number; stretchX: number; stretchY: number;
}

/**
 * Something a sprite can be drawn as instead of its own costumes: built-in "Turbo Skins"
 * (the same idea as SharkPool's extension, without needing it). Made with Skin.fromURL(),
 * Skin.fromSVG(), or a sprite's .skinFromCostume() - never \`new Skin()\`. Share one between
 * sprites the normal way (a variable, me.hold(), a world value) instead of naming it.
 * @example const heart = await Skin.fromURL("https://example.com/heart.png"); me.skin = heart;
 */
declare class Skin {
    private constructor();
    /** Fetches \`url\` and makes a Skin from it - an SVG (by its Content-Type/content) or a bitmap. */
    static fromURL(url: string, name?: string): Promise<Skin>;
    static fromSVG(svgText: string, name?: string): Skin;
    /** A label, for your own use (also shown in Skin(...)'s toString()). */
    name: string;
    readonly type: 'svg' | 'bitmap' | 'costume';
    /** The SVG text or the URL it was made from; null for a .skinFromCostume() skin. */
    readonly source: string | null;
    /** False while an SVG's own embedded images are still decoding. */
    readonly loaded: boolean;
    readonly width: number;
    readonly height: number;
    readonly rotationCenter: Point;
    setRotationCenter(x: number, y: number): this;
    /**
     * The Skin whose shape touching()/colour detection use while this one is shown - itself
     * unless set to something else (a smaller or simpler Skin, say); null resets it to itself.
     */
    hitbox: Skin | null;
    /** Every sprite/clone currently showing this Skin, as its \`me\`. */
    readonly users: TargetApi[];
    /** False once dispose() has been called. */
    readonly exists: boolean;
    /**
     * Frees the renderer resource; anyone showing it goes back to their own costumes. Not
     * needed for a .skinFromCostume() skin - there's nothing of its own to free.
     */
    dispose(): void;
    toString(): string;
}

// ---- Iris Text (the Iris Text extension; docs §34)
/** Iris Text drawn on a sprite: me.iris. Character indexes count from 0. */
declare class IrisApi {
    /** Shows it straight away (markup and all); resolves after any <wait> markup in it. */
    show(text: any): Promise<void>;
    /** Types it out character by character; resolves when it's all there. */
    type(text: any): Promise<void>;
    /** type() on a new line after what's there */
    typeLine(text: any): Promise<void>;
    addLine(text: any): this;
    /** Back to the sprite's costume. */
    hide(): this;
    /** Finish typing now / stop typing where it is. */
    skip(): this;
    stop(): this;
    refresh(): Promise<void>;
    /** The text with markup ("" while hidden). Setting it is show() without waiting. */
    text: string;
    /** What's on screen now, without markup */
    readonly plainText: string;
    readonly visible: boolean;
    readonly typing: boolean;
    readonly length: number;
    readonly width: number;
    readonly height: number;
    char(index: number): IrisChar;
    readonly chars: IrisChar[];
    resetChars(): this;
    color: string;
    size: number;
    font: string;
    align: 'left' | 'center' | 'right' | 'justify';
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    letterSpacing: number;
    lineHeight: number;
    /** null for no limit */
    maxWidth: number | null;
    maxHeight: number | null;
    smoothing: boolean;
    emoji: 'colored' | 'native';
    growDownwardOnly: boolean;
    /** Setting one changes only the fields given; true / false switches it. */
    get shadow(): IrisShadow;
    set shadow(value: Partial<IrisShadow> | boolean);
    get background(): IrisBackground;
    set background(value: Partial<IrisBackground> | boolean);
    get backgroundBorder(): {color: string; size: number; roundness: number};
    set backgroundBorder(value: Partial<{color: string; size: number; roundness: number}>);
    /** The outline around the letters */
    get border(): IrisBorder;
    set border(value: Partial<IrisBorder> | boolean);
    /** Seconds per character. A number sets every group. */
    get typingSpeed(): IrisTypingSpeeds & {custom: {[chars: string]: number}};
    set typingSpeed(value: number | Partial<IrisTypingSpeeds & {custom: {[chars: string]: number}}>);
    /** Every setting as one object ("export settings"); setting it changes what it names. */
    settings: {[key: string]: any};
    on(event: 'type', fn: (char: string, index: number) => any): () => void;
    on(event: 'done' | 'charanimationdone', fn: () => any): () => void;
}
interface IrisShadow { enabled: boolean; color: string; opacity: number; blur: number; offsetX: number; offsetY: number; }
interface IrisBackground { enabled: boolean; color: string; opacity: number; radius: number; padding: number; }
interface IrisBorder { enabled: boolean; color: string; opacity: number; size: number; }
interface IrisTypingSpeeds { default: number; symbols: number; punctuation: number; numbers: number; }
type IrisEasing = 'linear' | 'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';
/** One character of me.iris */
declare class IrisChar {
    readonly index: number;
    readonly char: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly hasMask: boolean;
    /** Offsets from where it would be; scale and opacity in %; color null clears it. */
    set(props: Partial<{x: number; y: number; rotation: number; scale: number; opacity: number; color: string | null}>): this;
    move(dx: number, dy: number): this;
    turn(degrees: number): this;
    reset(): this;
    /** @example await me.iris.char(0).animate("y", 20, 0.3, "back") */
    animate(prop: 'x' | 'y' | 'rotation' | 'opacity' | 'scale', to: number, seconds: number,
        easing?: IrisEasing, direction?: 'in' | 'out' | 'in out'): Promise<void>;
    stop(): this;
    /** Just this character's style; null resets it. */
    style: {color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
        size?: number; font?: string; tags?: string[]} | null;
}
/** Iris Text markup for me.iris.show() / type(). */
declare const Iris: {
    color(text: string, color: string): string;
    gradient(text: string, colors: string[] | string, type?: 'linear' | 'radial' | 'conic', angle?: number): string;
    shadow(text: string, options?: {color?: string; opacity?: number; blur?: number; x?: number; y?: number}): string;
    border(text: string, options?: {color?: string; opacity?: number; size?: number}): string;
    style(text: string, style: 'bold' | 'italic' | 'underline' | 'strikethrough'): string;
    size(text: string, size: number): string;
    blur(text: string, percent: number): string;
    font(text: string, font: string): string;
    tag(text: string, tag: string): string;
    wait(seconds: number): string;
};

declare const me: MeApi;
/** The whole project. */
declare const world: WorldApi;
/** Waits on the project clock. Ends (silently) with the stop sign. */
declare function wait(seconds: number): Promise<void>;
/** @example await waitUntil(() => me.touching("edge")) */
declare function waitUntil(condition: () => any): Promise<void>;
/** Resolves on the next frame with that frame's dt in seconds. */
declare function nextFrame(): Promise<number>;
/** One iteration per frame; ends with the stop sign. @example for await (const dt of frames()) { me.x += 60 * dt; } */
declare function frames(): AsyncGenerator<number, never, void>;
/** Runs fn once per frame, n times. */
declare function repeat(times: number, fn: (i: number) => any): Promise<void>;
/**
 * Tweens any properties of any object, over \`seconds\`, along an easing from easings.net.
 * @example tween(me, {x: 100, "effects.ghost": 50}, 1, "easeOutQuad")
 * @example tween(world.camera, {zoom: 2}, 1, {easing: "easeInOutSine", onStep: v => log(v)})
 */
declare function tween(object: object, to: TweenTo, seconds: number, options?: Easing | TweenOptions): Tween;
/**
 * Tweens nothing: onStep gets a value going from \`from\` (0) to \`to\` (1) every frame.
 * @example tween(2, {from: 0, to: 360, easing: "easeInOutCubic", onStep: a => me.angle = a})
 */
declare function tween(seconds: number, options?: EasingName | AnyName | NothingTweenOptions |
    ((value: number, progress: number, tween: Tween) => any)): Tween;
/** Scratch value -> JS ("12" -> 12, "true" -> true). Accepts a promise. */
declare function fromCast<T>(value: T): any;
/** JS value -> something a variable or block input can hold. */
declare function toCast(value: any): string | number | boolean;
/** Prints to this sprite's console under the code editor. */
declare function log(...values: any[]): void;
/** What a cancelled wait rejects with (stop sign, clone deleted, code edited). */
declare class Stopped extends Error {}

// ---- sharing code between complex sprites: \`export\` / \`import ... from "SpriteName"\`, or CommonJS
/**
 * Another complex sprite's exports, by its name ("Stage" for the stage). Gives what it set
 * \`module.exports\` to, or its live exports when it uses \`export\`. \`require("asset:name")\` reads an asset
 * (JSON parsed, text as a string, anything else as an AssetApi).
 * @example const {jump} = require("Player");
 */
declare function require(name: string): any;
/** What other sprites get from \`require\` / \`import\` of this one. @example module.exports = {jump}; */
declare var module: {exports: any};
/** Shorthand for \`module.exports\`. @example exports.jump = height => me.y += height; */
declare var exports: any;
declare module "asset:*" {
    const value: any;
    export default value;
}
/**
 * true when this run of the code is a hot reload (the Code tab's "Hot reload"): skip the set-up
 * that would reset the game.
 */
declare const reloaded: boolean;

// ---- the Code tab itself: widgets and suggestions for this project's own things
/**
 * A widget for a value written in the code:
 * - \`"number"\`: drag its chip left and right (Shift: ten steps, Alt: tenths)
 * - \`"slider"\`: a number between \`min\` and \`max\` (0 to 100 unless said)
 * - \`"angle"\`: a direction, with a dial
 * - \`"color"\`: a "#rrggbb" string, with a colour picker
 * - \`"toggle"\`: true / false, with a tick box
 * - \`"select"\`: one of \`options\`
 * - \`"sprite"\`, \`"costume"\`, \`"sound"\`, \`"backdrop"\`, \`"broadcast"\`, \`"variable"\`, \`"list"\`,
 *   \`"animation"\`, \`"key"\`, \`"easing"\`: one of the project's (or the editor's) names
 */
type EditorWidgetName = 'number' | 'slider' | 'angle' | 'color' | 'toggle' | 'select' |
    'sprite' | 'costume' | 'sound' | 'backdrop' | 'broadcast' | 'variable' | 'list' | 'animation' | 'key' | 'easing';
interface EditorWidget {
    type?: EditorWidgetName;
    /** numbers: the lowest and highest value (giving both, without a type, makes a slider) */
    min?: number;
    max?: number;
    /** numbers: how much one step is. Left out, it's the last digit written (0.5 steps by 0.1). */
    step?: number;
    /** "select": the choices */
    options?: (string | number)[];
    /** what the property starts as when the editor writes it for you */
    default?: string | number | boolean;
    /** shown on the widget and in the suggestions */
    label?: string;
    /** a thing inside the thing: widgets for its properties */
    fields?: EditorFields;
}
/** A widget by name, a list of choices (\`["slime", "bat"]\`), or a widget with its settings. */
type EditorSpec = EditorWidgetName | (string | number)[] | EditorWidget;
type EditorFields = {[property: string]: EditorSpec | EditorFields};
interface EditorApi {
    /**
     * Describes the properties of the object given to \`name(...)\` (or \`x.name(...)\`,
     * \`new name(...)\`), or written as \`name = {...}\` / \`name: {...}\`, lists of them included.
     * Each property that's written out gets its widget in the code, and the properties not
     * written yet are suggested.
     *
     * Read from the text by the Code tab (in every sprite's code), so write the values out:
     * no variables or calculations. Does nothing when the code runs.
     * @example
     * editor.props("spawnEnemy", {
     *     hp: {type: "slider", min: 1, max: 20},
     *     tint: "color",
     *     kind: ["slime", "bat", "ghost"],
     *     flying: "toggle"
     * });
     * spawnEnemy({hp: 3, tint: "#ff0000", kind: "bat", flying: false});
     */
    props(name: string, fields: EditorFields): void;
    /**
     * A widget for a single value: \`const name = 900\`, \`me.name = 900\`, \`name: 900\`.
     * @example
     * editor.value("GRAVITY", {min: 0, max: 2000, step: 50});
     * const GRAVITY = 900;
     */
    value(name: string, widget: EditorSpec): void;
    /**
     * Widgets for a function's arguments, in order (\`null\` for one that has none).
     * @example
     * editor.args("shake", [{min: 0, max: 50}, "easing"]);
     * shake(12, "easeOutQuad");
     */
    args(name: string, widgets: (EditorSpec | EditorFields | null)[]): void;
    /**
     * A snippet of your own: typing \`prefix\` offers \`code\`. \`\${1:hp}\` marks a place to fill
     * in (Tab moves to the next); write the code in ordinary quotes, not backticks.
     * @example
     * editor.snippet("enemy", 'spawnEnemy({hp: \${1:3}, kind: "\${2:slime}"});', "spawn an enemy");
     */
    snippet(prefix: string, code: string, description?: string): void;
}
/**
 * Tells the Code tab about this project's own things, so their values can be edited with
 * sliders, pickers and lists right in the code. Read from the text, in every sprite's code.
 */
declare const editor: EditorApi;

// ---- tests: written in the code, run by the Code tab's "Run tests"
/**
 * Registers a test. Nothing runs until "Run tests".
 * @example test("jump goes up", async () => { me.jump(); await wait(0.2); expect(me.y).toBeGreaterThan(0); })
 */
declare function test(name: string, fn: () => any, options?: {timeout?: number}): void;
declare namespace test {
    function skip(name: string, fn: () => any, options?: {timeout?: number}): void;
    /** With any .only, only those run. */
    function only(name: string, fn: () => any, options?: {timeout?: number}): void;
}
declare const it: typeof test;
declare function describe(name: string, fn: () => void): void;
declare function beforeEach(fn: () => any): void;
declare function afterEach(fn: () => any): void;
declare function assert(condition: any, message?: string): void;
interface Matchers {
    toBe(expected: any): void;
    toEqual(expected: any): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toContain(item: any): void;
    toHaveLength(n: number): void;
    toMatch(pattern: RegExp | string): void;
    toBeInstanceOf(type: Function): void;
    toThrow(expected?: string | RegExp | Function): void;
}
declare function expect(actual: any): Matchers & {not: Matchers};
`;
const payloadsOf = code => {
    const payloads = new Map();
    for (const call of findBlockspaces(code)) {
        if (call.id && call.payloadStart >= 0) payloads.set(call.id, code.slice(call.payloadStart, call.payloadEnd));
    }
    return payloads;
};
const viewOf = code => applyEdits(code, findBlockspaces(code)
    .filter(call => call.id && call.payloadStart >= 0)
    .map(call => ({start: call.idEnd, end: call.payloadEnd, text: ''})));
const codeOf = (view, code, remembered = new Map()) => {
    const current = payloadsOf(code);
    current.forEach((text, id) => remembered.set(id, text));
    const calls = findBlockspaces(view);
    const viewIds = new Set(calls.map(call => call.id));
    const missing = [...current.keys()].filter(id => !viewIds.has(id));
    const unknown = calls.filter(call => call.id && call.payloadStart < 0 && !remembered.has(call.id));
    const renamedFrom = unknown.length === 1 && missing.length === 1 ? missing[0] : null;
    const edits = [];
    for (const call of calls) {
        if (!call.id || call.payloadStart >= 0) continue;
        let text = remembered.get(call.id);
        if (!text && renamedFrom && call === unknown[0]) { text = current.get(renamedFrom); remembered.set(call.id, text); }
        if (text) edits.push({start: call.idEnd, end: call.idEnd, text: `, ${text}`});
    }
    return applyEdits(view, edits);
};
const HASH_DELAY_MS = 1500;
const ATTACH_INTERVAL_MS = 2000;
const CONTEXT = 12;
const hash = text => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return `${h.toString(36)}:${text.length}`;
};
const locate = (text, change) => {
    const {offset, removed, before, after} = change;
    if (text.slice(offset, offset + removed.length) === removed &&
        text.slice(Math.max(0, offset - before.length), offset) === before) return offset;
    const needle = before + removed + after;
    if (!needle) return Math.min(offset, text.length);
    let best = -1;
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
        const at = i + before.length;
        if (best < 0 || Math.abs(at - offset) < Math.abs(best - offset)) best = at;
    }
    return best;
};
let editorModels = null;
let applyingRemote = false;
const setEditorModels = access => { editorModels = access; };
const isApplyingRemote = () => applyingRemote;
let localEdit = null;
const subscribers = new Set();
const subscribeCollab = fn => { subscribers.add(fn); return () => subscribers.delete(fn); };
const sendCollab = (type, data) => {
    const c = typeof window === 'undefined' ? null : window.dimodCollab;
    if (c) c.send(type, data);
};
const sendViewEdit = (targetId, changes, previous) => {
    if (localEdit) localEdit(targetId, changes, previous);
};
const installBlockspaceCollab = vm => {
    if (vm.__dimodBlockspaceCollab) return;
    vm.__dimodBlockspaceCollab = true;
    const host = vm.runtime.dimodBlockspace;
    if (!host || typeof window === 'undefined') return;
    const session = Math.random().toString(36)
        .slice(2);
    const edited = new Set();
    const hashTimers = new Map();
    let attached = null;
    let off = null;
    const collab = () => window.dimodCollab || null;
    const send = (type, data) => {
        const c = collab();
        if (c) c.send(type, {...data, author: session});
    };
    const targetFor = msg => {
        const target = vm.runtime.getTargetById(msg.targetId) ||
            (typeof msg.name === 'string' ? vm.runtime.getSpriteTargetByName(msg.name) : null);
        return target && target.isOriginal ? target : null;
    };
    const stateOf = target => {
        const dimod = target.sprite.dimod;
        return dimod ? {complex: Boolean(dimod.complex), source: dimod.source, owners: dimod.owners || null} : null;
    };
    const sendState = (target, reason) => {
        const dimod = stateOf(target);
        if (dimod) send('blockspace-state', {targetId: target.id, name: target.getName(), dimod, reason});
    };
    const hashSoon = targetId => {
        clearTimeout(hashTimers.get(targetId));
        hashTimers.set(targetId, setTimeout(() => {
            hashTimers.delete(targetId);
            const target = vm.runtime.getTargetById(targetId);
            if (target && target.sprite.dimod) {
                send('blockspace-hash', {targetId, name: target.getName(), hash: hash(target.sprite.dimod.source)});
            }
        }, HASH_DELAY_MS));
    };
    localEdit = (targetId, changes, previous) => {
        if (applyingRemote) return;
        edited.add(targetId);
        const target = vm.runtime.getTargetById(targetId);
        const out = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset).map(change => {
            const offset = change.rangeOffset;
            const end = offset + change.rangeLength;
            return {
                offset,
                removed: previous.slice(offset, end),
                inserted: change.text,
                before: previous.slice(Math.max(0, offset - CONTEXT), offset),
                after: previous.slice(end, end + CONTEXT)
            };
        });
        send('blockspace-delta', {targetId, name: target ? target.getName() : '', changes: out});
        hashSoon(targetId);
    };
    vm.on('DIMOD_BLOCKSPACE_CHANGED', ({targetId, kind, id, payload}) => {
        const target = vm.runtime.getTargetById(targetId);
        if (!target) return;
        edited.add(targetId);
        if (kind === 'payload') {
            send('blockspace-payload', {targetId, name: target.getName(), id, payload});
        } else if (kind !== 'typed') { sendState(target, kind); }
        hashSoon(targetId);
    });
    const onDelta = msg => {
        const target = targetFor(msg);
        if (!target || !target.sprite.dimod || !Array.isArray(msg.changes)) return;
        const model = editorModels && editorModels.get(target.id);
        let view = model ? model.getValue() : viewOf(target.sprite.dimod.source);
        const edits = [];
        for (const change of msg.changes) {
            if (!change || typeof change.removed !== 'string' || typeof change.inserted !== 'string') continue;
            const at = locate(view, {
                offset: Number(change.offset) || 0,
                removed: change.removed,
                before: String(change.before || ''),
                after: String(change.after || '')
            });
            if (at < 0) continue;
            edits.push({at, removed: change.removed, inserted: change.inserted});
            view = view.slice(0, at) + change.inserted + view.slice(at + change.removed.length);
        }
        if (!edits.length) return;
        if (model) {
            applyingRemote = true;
            try {
                for (const edit of edits) {
                    const start = model.getPositionAt(edit.at);
                    const end = model.getPositionAt(edit.at + edit.removed.length);
                    model.pushEditOperations([], [{
                        range: {
                            startLineNumber: start.lineNumber,
                            startColumn: start.column,
                            endLineNumber: end.lineNumber,
                            endColumn: end.column
                        },
                        text: edit.inserted
                    }], () => null);
                }
            } finally { applyingRemote = false; }
            view = model.getValue();
        }
        host.setSource(target, codeOf(view, target.sprite.dimod.source), {apply: false, remote: true});
        vm.emit('DIMOD_BLOCKSPACE_SOURCE_CHANGED', {spriteName: target.getName(), remote: true});
        hashSoon(target.id);
    };
    const onState = msg => {
        const target = targetFor(msg);
        if (!target || !msg.dimod || typeof msg.dimod.source !== 'string') return;
        const mine = stateOf(target);
        if (mine && mine.complex === Boolean(msg.dimod.complex) && mine.source === msg.dimod.source) return;
        if (msg.reason === 'join' && edited.has(target.id)) return;
        host.applyRemote(target, msg.dimod);
        hashSoon(target.id);
    };
    const onHash = msg => {
        const target = targetFor(msg);
        if (!target || !target.sprite.dimod || hashTimers.has(target.id)) return;
        if (msg.hash === hash(target.sprite.dimod.source)) return;
        if (session > String(msg.author)) sendState(target, 'repair');
    };
    const onMessage = msg => {
        subscribers.forEach(fn => {
            try { fn(msg); } catch (e) {
            }
        });
        switch (msg.type) {
        case 'joined':
            collab().send('blockspace-state-request', {author: session});
            break;
        case 'blockspace-state-request':
            vm.runtime.targets.forEach(target => {
                if (target.isOriginal && target.sprite.dimod) sendState(target, 'join');
            });
            break;
        case 'blockspace-state':
            onState(msg);
            break;
        case 'blockspace-delta':
            onDelta(msg);
            break;
        case 'blockspace-payload': {
            const target = targetFor(msg);
            if (target && typeof msg.id === 'string') {
                host.applyRemotePayload(target, msg.id, msg.payload);
                hashSoon(target.id);
            }
            break;
        }
        case 'blockspace-hash':
            onHash(msg);
            break;
        default:
        }
    };
    const attach = () => {
        const c = collab();
        if (!c || c === attached) return;
        if (off) off();
        attached = c;
        off = c.addMessageListener(onMessage);
        c.send('blockspace-state-request', {author: session});
    };
    attach();
    setInterval(attach, ATTACH_INTERVAL_MS);
};
const MAX_LINES = 200;
const logs = new Map();
const unseen = new Map();
const listeners = new Set();
const notify = targetId => listeners.forEach(fn => {
    try { fn(targetId); } catch (e) {
    }
});
const ALWAYS_NEW = ['input', 'result'];
const same = (a, b) => a && !ALWAYS_NEW.includes(b.level) && a.level === b.level && a.text === b.text &&
    a.line === b.line && a.isClone === b.isClone;
const add = entry => {
    const list = logs.get(entry.targetId) || [];
    const last = list[list.length - 1];
    let next;
    if (same(last, entry)) { next = [...list.slice(0, -1), {...last, count: (last.count || 1) + 1}]; } else { next = [...list, {...entry, count: 1}].slice(-MAX_LINES); }
    logs.set(entry.targetId, next);
    if (entry.level === 'error') unseen.set(entry.targetId, (unseen.get(entry.targetId) || 0) + 1);
    notify(entry.targetId);
};
const logFor = targetId => logs.get(targetId) || [];
const errorSpots = () => {
    const spots = [];
    for (const [targetId, list] of logs) {
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].level === 'error') { spots.push({targetId, entry: list[i]}); break; }
        }
    }
    return spots;
};
const unseenErrors = targetId => unseen.get(targetId) || 0;
const clearLog = targetId => { logs.delete(targetId); unseen.delete(targetId); notify(targetId); };
const markSeen = targetId => {
    if (!unseen.has(targetId)) return;
    unseen.delete(targetId);
    notify(targetId);
};
const subscribeConsole = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const installConsoleStore = vm => {
    if (vm.__dimodConsoleStore) return;
    vm.__dimodConsoleStore = true;
    vm.on('DIMOD_BLOCKSPACE_LOG', add);
    const originalDispose = vm.runtime.dispose.bind(vm.runtime);
    vm.runtime.dispose = (...args) => {
        const ids = [...logs.keys()];
        logs.clear();
        unseen.clear();
        ids.forEach(notify);
        return originalDispose(...args);
    };
};
const COLOURS = {primary: '#3AB5A4', secondary: '#2F9A8B', tertiary: '#278477'};
const escapeXML = text => String(text).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;'
}[c]));
let focused = null;
const setToolboxBlockspace = value => {
    focused = value ? {targetId: value.targetId, id: value.id, params: value.params.slice()} : null;
};
let menuVM = null;
const setMenuVM = vm => { menuVM = vm; };
const menuHost = () => (menuVM && menuVM.runtime.dimodBlockspace) || null;
const asOptions = list => (list.length ? list.map(text => [String(text), String(text)]) : [['', '']]);
const EXPOSE_CALL = /\.expose\s*\(\s*(["'])((?:(?!\1).)+)\1/g;
const exposedNames = () => {
    const host = menuHost();
    if (!host) return [];
    const names = new Set();
    for (const scope of host._exposed.values()) {
        for (const name of scope.keys()) names.add(name);
    }
    for (const target of menuVM.runtime.targets) {
        const dimod = target.isOriginal && target.sprite.dimod;
        if (!dimod || !dimod.complex || typeof dimod.source !== 'string') continue;
        EXPOSE_CALL.lastIndex = 0;
        for (let m = EXPOSE_CALL.exec(dimod.source); m; m = EXPOSE_CALL.exec(dimod.source)) names.add(m[2]);
    }
    return [...names].sort();
};
const spriteChoices = () => {
    const sprites = menuVM ?
        menuVM.runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => t.getName()) :
        [];
    return ['myself', ...sprites, 'Stage'];
};
const blockspaceIds$1 = spriteName => {
    const host = menuHost();
    if (!host) return [];
    const name = String(spriteName || 'myself');
    let target = null;
    if (name.toLowerCase() === 'myself') target = menuVM.editingTarget;
    else if (name.toLowerCase() === 'stage') target = menuVM.runtime.getTargetForStage();
    else target = menuVM.runtime.getSpriteTargetByName(name);
    return target ? host.spaces.entries(target.sprite).map(entry => entry.id) : [];
};
const SEPARATOR = '<sep gap="36"/>';
const textInput = (input, value) =>
    `<value name="${input}"><shadow type="text"><field name="TEXT">${escapeXML(value)}</field></shadow></value>`;
const numberInput = (input, value) =>
    `<value name="${input}"><shadow type="math_number"><field name="NUM">${value}</field></shadow></value>`;
const menuInput = (input, opcode, field, value) => `<value name="${input}"><shadow type="${opcode}">` +
    `<field name="${field}">${escapeXML(value)}</field></shadow></value>`;
const worldValueBlocks = () => `
        <block type="${OPCODES.worldValue}">${textInput('NAME', 'score')}</block>
        <block type="${OPCODES.setWorldValue}">${textInput('NAME', 'score')}${textInput('VALUE', '0')}</block>
        <block type="${OPCODES.changeWorldValue}">${textInput('NAME', 'score')}${numberInput('VALUE', 1)}</block>`;
const myValueBlocks = () => `
        <block type="${OPCODES.myValue}">${textInput('NAME', 'hp')}</block>
        <block type="${OPCODES.setMyValue}">${textInput('NAME', 'hp')}${textInput('VALUE', '0')}</block>
        <block type="${OPCODES.changeMyValue}">${textInput('NAME', 'hp')}${numberInput('VALUE', 1)}</block>`;
const callBlocks = blockspaceId => {
    const args = `<mutation argcount="1"></mutation>${textInput('ARG', '')}`;
    const js = menuInput('NAME', OPCODES.callJSMenu, 'NAME', 'myFunction');
    const space = menuInput('ID', OPCODES.blockspaceMenu, 'ID', blockspaceId || '') +
        menuInput('SPRITE', OPCODES.spriteMenu, 'SPRITE', 'myself');
    return `
        <block type="${OPCODES.callJS}">${js}${args}</block>
        <block type="${OPCODES.callJSReporter}">${js}${args}</block>
        <block type="${OPCODES.callBlockspace}">${space}${args}</block>
        <block type="${OPCODES.callBlockspaceReporter}">${space}${args}</block>`;
};
const tweenBlock = () => `
        <block type="${OPCODES.tween}">${menuInput('PROP', OPCODES.tweenPropMenu, 'PROP', 'x')}${
    textInput('VALUE', '100')}${numberInput('SECS', 1)}${
    menuInput('EASING', OPCODES.easingMenu, 'EASING', 'easeOutQuad')}</block>`;
const blockspaceCategoryXML = targetId => {
    if (!focused || focused.targetId !== targetId) return '';
    const {id, params} = focused;
    return `
    <category name="Blockspace" id="dimodBlockspace" colour="${COLOURS.primary}" secondaryColour="${COLOURS.secondary}">
        <button text="Edit parameters" callbackKey="DIMOD_BLOCKSPACE_PARAMS"></button>
        <block type="${OPCODES.whenCalled}">
            <mutation params="${escapeXML(JSON.stringify(params))}"></mutation>
            <field name="ID">${escapeXML(id)}</field>
            ${params.map((name, i) => `<value name="ARG${i}"><shadow type="${OPCODES.argument}">` +
                `<field name="NAME">${escapeXML(name)}</field></shadow></value>`).join('')}
        </block>
        ${params.map(name => `<block type="${OPCODES.argument}"><field name="NAME">${escapeXML(name)}</field></block>`)
        .join('')}
        <block type="${OPCODES.returnValue}">${textInput('VALUE', '')}</block>
        <block type="${OPCODES.yieldValue}">${textInput('VALUE', '')}</block>
        ${SEPARATOR}${callBlocks(id)}
        ${SEPARATOR}${tweenBlock()}
        ${SEPARATOR}${worldValueBlocks()}
        ${SEPARATOR}${myValueBlocks()}
    </category>`;
};
const VALUE_COLOURS = {primary: '#E0922E', secondary: '#C77F24', tertiary: '#AD6D1D'};
const defineBlockspaceBlocks = ScratchBlocks => {
    const define = (opcode, json) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(Object.assign({
                    id: opcode,
                    colour: COLOURS.primary,
                    colourSecondary: COLOURS.secondary,
                    colourTertiary: COLOURS.tertiary
                }, json));
            }
        };
    };
    const hatJSON = {
        id: OPCODES.whenCalled,
        message0: 'when %1 called',
        args0: [{type: 'field_label_serializable', name: 'ID', text: ''}],
        colour: COLOURS.primary,
        colourSecondary: COLOURS.secondary,
        colourTertiary: COLOURS.tertiary,
        extensions: ['shape_hat']
    };
    ScratchBlocks.Blocks[OPCODES.whenCalled] = {
        init: function () { this.jsonInit(hatJSON); this.params_ = []; },
        mutationToDom: function () {
            const mutation = document.createElement('mutation');
            mutation.setAttribute('params', JSON.stringify(this.params_));
            return mutation;
        },
        domToMutation: function (xml) {
            let params = [];
            try { params = JSON.parse(xml.getAttribute('params') || '[]'); } catch (e) { params = []; }
            this.setParams_(Array.isArray(params) ? params.map(String) : []);
        },
        setParams_: function (params) {
            for (let i = 0; this.getInput(`ARG${i}`); i++) this.removeInput(`ARG${i}`);
            this.params_ = params;
            params.forEach((param, i) => this.appendValueInput(`ARG${i}`));
        }
    };
    define(OPCODES.argument, {
        message0: '%1',
        args0: [{type: 'field_label_serializable', name: 'NAME', text: ''}],
        canDragDuplicate: true,
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
    });
    define(OPCODES.returnValue, {
        message0: 'return %1',
        args0: [{type: 'input_value', name: 'VALUE'}],
        extensions: ['shape_end']
    });
    const defineValue = (opcode, json) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(Object.assign({
                    id: opcode,
                    colour: VALUE_COLOURS.primary,
                    colourSecondary: VALUE_COLOURS.secondary,
                    colourTertiary: VALUE_COLOURS.tertiary
                }, json));
            }
        };
    };
    const reporter = message => ({
        message0: message,
        args0: [{type: 'input_value', name: 'NAME'}],
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
    });
    const command = message => ({
        message0: message,
        args0: [{type: 'input_value', name: 'NAME'}, {type: 'input_value', name: 'VALUE'}],
        extensions: ['shape_statement']
    });
    defineValue(OPCODES.worldValue, reporter('world value %1'));
    defineValue(OPCODES.setWorldValue, command('set world value %1 to %2'));
    defineValue(OPCODES.changeWorldValue, command('change world value %1 by %2'));
    defineValue(OPCODES.myValue, reporter('my value %1'));
    defineValue(OPCODES.setMyValue, command('set my value %1 to %2'));
    defineValue(OPCODES.changeMyValue, command('change my value %1 by %2'));
    const defineMenu = (opcode, field, options) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: '%1',
                    args0: [{type: 'field_textdropdown', name: field, text: '', options}],
                    output: 'String',
                    outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                    colour: '#FFFFFF',
                    colourSecondary: '#FFFFFF',
                    colourTertiary: '#FFFFFF'
                });
            }
        };
    };
    defineMenu(OPCODES.callJSMenu, 'NAME', () => asOptions(exposedNames()));
    defineMenu(OPCODES.spriteMenu, 'SPRITE', () => asOptions(spriteChoices()));
    defineMenu(OPCODES.blockspaceMenu, 'ID', function () {
        const field = this;
        const parent = field.sourceBlock_ && field.sourceBlock_.getParent();
        const spriteBlock = parent && parent.getInputTargetBlock('SPRITE');
        return asOptions(blockspaceIds$1(spriteBlock ? spriteBlock.getFieldValue('SPRITE') : 'myself'));
    });
    defineMenu(OPCODES.tweenPropMenu, 'PROP', () => asOptions(Object.keys(TWEEN_PROPERTIES)));
    defineMenu(OPCODES.easingMenu, 'EASING', () => asOptions(EASING_NAMES));
    const defineArgBlock = (opcode, message, args, isReporter) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(Object.assign({
                    id: opcode,
                    message0: message,
                    args0: args,
                    inputsInline: true,
                    colour: VALUE_COLOURS.primary,
                    colourSecondary: VALUE_COLOURS.secondary,
                    colourTertiary: VALUE_COLOURS.tertiary
                }, isReporter ?
                    {output: null, outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND} :
                    {extensions: ['shape_statement']}));
                this.argCount_ = 0;
                this.updateShape_(1);
            },
            mutationToDom: function () {
                const mutation = document.createElement('mutation');
                mutation.setAttribute('argcount', String(this.argCount_));
                return mutation;
            },
            domToMutation: function (xml) {
                const n = Number(xml.getAttribute('argcount'));
                this.updateShape_(Number.isInteger(n) && n >= 0 ? n : 1);
            },
            updateShape_: function (n) {
                for (let i = this.argCount_ - 1; i >= n; i--) this.removeInput(argInputName(i));
                for (let i = this.argCount_; i < n; i++) {
                    const input = this.appendValueInput(argInputName(i));
                    if (i === 0) input.appendField('with');
                }
                this.argCount_ = n;
            },
            setArgCount_: function (n) {
                const Events = ScratchBlocks.Events;
                const before = ScratchBlocks.Xml.domToText(this.mutationToDom());
                const from = this.argCount_;
                Events.setGroup(true);
                try {
                    this.updateShape_(n);
                    for (let i = from; i < n; i++) {
                        Events.disable();
                        let shadow;
                        try {
                            shadow = this.workspace.newBlock('text');
                            shadow.setShadow(true);
                            shadow.setFieldValue('', 'TEXT');
                            if (this.rendered) { shadow.initSvg(); shadow.render(false); }
                        } finally { Events.enable(); }
                        Events.fire(new Events.BlockCreate(shadow));
                        this.getInput(argInputName(i)).connection.connect(shadow.outputConnection);
                    }
                    const after = ScratchBlocks.Xml.domToText(this.mutationToDom());
                    Events.fire(new Events.BlockChange(this, 'mutation', null, before, after));
                } finally { Events.setGroup(false); }
                if (this.rendered) this.render();
            },
            customContextMenu: function (options) {
                if (this.isInFlyout) return;
                options.push({text: 'Add an input', enabled: true, callback: () => this.setArgCount_(this.argCount_ + 1)});
                options.push({
                    text: 'Remove an input',
                    enabled: this.argCount_ > 0,
                    callback: () => this.setArgCount_(this.argCount_ - 1)
                });
            }
        };
    };
    const callJS = [{type: 'input_value', name: 'NAME'}];
    defineArgBlock(OPCODES.callJS, 'call JS %1', callJS, false);
    defineArgBlock(OPCODES.callJSReporter, 'call JS %1', callJS, true);
    const callSpace = [{type: 'input_value', name: 'ID'}, {type: 'input_value', name: 'SPRITE'}];
    defineArgBlock(OPCODES.callBlockspace, 'call blockspace %1 of %2', callSpace, false);
    defineArgBlock(OPCODES.callBlockspaceReporter, 'call blockspace %1 of %2', callSpace, true);
    defineValue(OPCODES.tween, {
        message0: 'tween %1 to %2 in %3 secs %4',
        args0: [
            {type: 'input_value', name: 'PROP'},
            {type: 'input_value', name: 'VALUE'},
            {type: 'input_value', name: 'SECS'},
            {type: 'input_value', name: 'EASING'}
        ],
        extensions: ['shape_statement']
    });
    define(OPCODES.yieldValue, {
        message0: 'yield %1',
        args0: [{type: 'input_value', name: 'VALUE'}],
        extensions: ['shape_statement']
    });
};
const event = (name, summary, {params = [], filter = null, notes = '', example}) => ({
    name, summary, params, filter, notes, example
});
const param = (name, type, note) => ({name, type, note});
const optional = (label, sample) => ({required: false, label, sample});
const required = (label, sample) => ({required: true, label, sample});
const WORLD_EVENTS = [
    event('flag', 'The green flag was clicked.', {
        notes: 'Runs after every complex sprite has restarted and every "preflag" handler has run.',
        example: 'world.on("flag", () => {\n    me.goTo(0, 0);\n});'
    }),
    event('key', 'A key was pressed.', {
        params: [param('key', 'string', 'the key, lower-cased')],
        filter: optional('a key name, or "any"', 'space'),
        example: 'world.on("key", "space", () => {\n    me.say("jump!", 1);\n});'
    }),
    event('tick', 'Every frame.', {
        params: [param('dt', 'number', 'seconds since the last frame')],
        notes: 'Keeps going after the stop sign.',
        example: 'world.on("tick", dt => {\n    me.turn(90 * dt);\n});'
    }),
    event('broadcast', 'A message was broadcast (by blocks or world.broadcast).', {
        params: [param('data', 'any', 'what was sent with it (null from blocks)')],
        filter: optional('the message name', 'go'),
        example: 'world.on("broadcast", "go", () => {\n    me.show();\n});'
    }),
    event('stop', 'The stop sign was clicked.', {example: 'world.on("stop", () => {\n    log("stopped");\n});'}),
    event('keyup', 'A key was let go.', {
        params: [param('key', 'string', 'the key, lower-cased')],
        filter: optional('a key name, or "any"', 'space'),
        example: 'world.on("keyup", "space", () => {\n    me.say("");\n});'
    }),
    event('mousedown', 'The mouse button went down.', {
        example: 'world.on("mousedown", () => {\n    me.goTo(world.mouse.x, world.mouse.y);\n});'
    }),
    event('mouseup', 'The mouse button came up.', {example: 'world.on("mouseup", () => {\n    me.say("");\n});'}),
    event('change', 'One of the world values (world.score...) was set to something new.', {
        params: [param('now', 'any', 'the new value'), param('was', 'any', 'the old one'),
            param('name', 'string', 'which value')],
        filter: optional('the value name', 'score'),
        example: 'world.on("change", "score", now => {\n    me.say(now);\n});'
    }),
    event('preflag', 'The green flag, before anything else reacts to it.', {
        notes: 'After every sprite\'s code has restarted, but before any "flag" handler or "when flag clicked" ' +
            'script. Good for setting up values everything else reads. Runs right away, not waited for.',
        example: 'world.on("preflag", () => {\n    world.score = 0;\n});'
    }),
    event('cloud', 'Someone else changed a cloud variable.', {
        params: [param('value', 'any', 'the new value'), param('name', 'string', 'the variable, without the cloud sign')],
        filter: optional('the variable name', 'best'),
        notes: 'Your own changes don\'t fire it.',
        example: 'world.on("cloud", "best", value => {\n    log("new best", value);\n});'
    }),
    event('backdrop', 'The backdrop changed.', {
        filter: optional('the backdrop name', 'night'),
        example: 'world.on("backdrop", "night", () => {\n    me.effects.brightness = -30;\n});'
    }),
    event('scene', 'The project switched to a scene, or started in it.', {
        params: [param('scene', 'SceneApi', 'the scene')],
        filter: optional('the scene name', 'Level 2'),
        example: 'world.on("scene", "Level 2", scene => {\n    log("now in", scene.name);\n});'
    }),
    event('resize', 'The stage size changed.', {
        params: [param('width', 'number', ''), param('height', 'number', '')],
        example: 'world.on("resize", (width, height) => {\n    log(width, height);\n});'
    }),
    event('animation', 'An animation playing on any sprite fired an event.', {
        params: [param('event', 'string', 'the event\'s name'), param('sprite', 'TargetApi', 'the sprite playing it'),
            param('animation', 'Animation', 'which animation'),
            param('time', 'number', 'where the event is, in seconds')],
        filter: optional('the event name', 'hit'),
        example: 'world.on("animation", "hit", (event, sprite) => {\n    log(sprite.name, "hit");\n});'
    }),
    event('animationend', 'An animation played once on any sprite got to its end.', {
        params: [param('sprite', 'TargetApi', 'the sprite playing it'), param('animation', 'Animation', 'which animation')],
        example: 'world.on("animationend", (sprite, animation) => {\n    log(sprite.name, animation.name);\n});'
    })
];
const TARGET_EVENTS = [
    event('click', 'This sprite was clicked.', {example: 'me.on("click", () => {\n    me.say("ouch", 1);\n});'}),
    event('touch', 'This sprite just started touching something.', {
        filter: required('what it touches: "edge", "mouse", a sprite name, or a colour', 'edge'),
        notes: 'Fires once, when contact starts.',
        example: 'me.on("touch", "edge", () => {\n    me.turn(180);\n});'
    }),
    event('untouch', 'This sprite just stopped touching something.', {
        filter: required('what it touched: "edge", "mouse", a sprite name, or a colour', 'edge'),
        example: 'me.on("untouch", "edge", () => {\n    me.say("free!", 1);\n});'
    }),
    event('change', 'One of this sprite\'s own values (me.hp...) was set to something new.', {
        params: [param('now', 'any', 'the new value'), param('was', 'any', 'the old one'),
            param('name', 'string', 'which value')],
        filter: optional('the value name', 'hp'),
        example: 'me.on("change", "hp", now => {\n    if (now <= 0) me.delete();\n});'
    }),
    event('clone', 'This copy of the code just started as a clone.', {
        notes: 'Like "when I start as a clone". Register it at the top of the code, before any await.',
        example: 'me.on("clone", () => {\n    me.visible = true;\n});'
    }),
    event('cloned', 'This sprite just made a clone.', {
        params: [param('clone', 'TargetApi', 'the new clone')],
        example: 'me.on("cloned", clone => {\n    clone.goTo(me.x, me.y);\n});'
    }),
    event('costume', 'The costume changed.', {
        params: [param('name', 'string', 'the new costume'), param('index', 'number', 'its number')],
        example: 'me.on("costume", name => {\n    log(name);\n});'
    }),
    event('say', 'This sprite said or thought something.', {
        params: [param('text', 'string', 'what it said ("" when the bubble goes away)'), param('type', '"say" | "think"', '')],
        example: 'me.on("say", text => {\n    log(text);\n});'
    }),
    event('animation', 'What this sprite is playing fired an event.', {
        params: [param('event', 'string', 'the event\'s name'), param('animation', 'Animation', 'which animation'),
            param('time', 'number', 'where the event is, in seconds')],
        filter: optional('the event name', 'step'),
        notes: 'Events are added on the timeline in the ANIMATIONS tab.',
        example: 'me.on("animation", "step", () => {\n    me.sound.start("tap");\n});'
    }),
    event('animationend', 'An animation this sprite played once got to its end.', {
        params: [param('animation', 'Animation', 'which animation')],
        example: 'me.on("animationend", () => {\n    me.animator.play("idle");\n});'
    }),
    event('delete', 'This sprite is going away (a clone was deleted, or the project stopped).', {
        example: 'me.on("delete", () => {\n    log("bye");\n});'
    })
];
const SERVER_EVENTS = [
    event('data', 'The game server sent something.', {
        params: [param('data', 'any', 'what it sent (JSON is already parsed)')],
        notes: 'Listening for it connects to the server.',
        example: 'world.server.on("data", data => {\n    log(data);\n});'
    }),
    event('relay', 'Another player sent something with world.server.relay.', {
        params: [param('data', 'any', 'what they sent'), param('from', 'Player', 'who sent it'),
            param('channel', 'string', 'the channel it came on')],
        filter: optional('one channel', 'chat'),
        example: 'world.server.on("relay", "chat", (data, from) => {\n    log(from.username, data.text);\n});'
    }),
    event('join', 'A player came into this room.', {
        params: [param('player', 'Player', '')],
        example: 'world.server.on("join", player => {\n    log(player.username, "joined");\n});'
    }),
    event('leave', 'A player left this room.', {
        params: [param('player', 'Player', '')],
        example: 'world.server.on("leave", player => {\n    log(player.username, "left");\n});'
    }),
    event('connect', 'Connected to the game server.', {example: 'world.server.on("connect", () => {\n    log("online");\n});'}),
    event('disconnect', 'Lost the game server.', {example: 'world.server.on("disconnect", () => {\n    log("offline");\n});'})
];
const SYNC_EVENTS = [
    event('spawn', 'A copy of another player\'s sprite was made (a ghost).', {
        params: [param('ghost', 'TargetApi', 'the copy'), param('player', 'Player', 'whose it is')],
        example: 'sync.on("spawn", (ghost, player) => {\n    ghost.say(player.username);\n});'
    }),
    event('remove', 'A copy of another player\'s sprite went away.', {
        params: [param('ghost', 'TargetApi', 'the copy'), param('player', 'Player', 'whose it was'),
            param('reason', 'string', 'why: left, timeout or stopped')],
        example: 'sync.on("remove", (ghost, player) => {\n    log(player.username, "is gone");\n});'
    }),
    event('update', 'A sprite got new information from another player.', {
        params: [param('sprite', 'TargetApi', 'the sprite it is for'), param('state', 'object', 'what changed'),
            param('player', 'Player', 'who it came from')],
        example: 'sync.on("update", (sprite, state) => {\n    log(state);\n});'
    })
];
const WORLD_ONCE_EXTRA = [
    event('server:data', 'The game server sent something.', {
        notes: 'Resolves with the data.',
        example: 'const data = await world.once("server:data");'
    }),
    event('server:connect', 'Connected to the game server.', {example: 'await world.once("server:connect");'}),
    event('server:disconnect', 'Lost the game server.', {example: 'await world.once("server:disconnect");'})
];
const CATALOG = {world: WORLD_EVENTS, target: TARGET_EVENTS, server: SERVER_EVENTS, sync: SYNC_EVENTS};
const handlerText = params => `(${params.map(p => `${p.name}: ${p.type}`).join(', ')}) => …`;
const documentationFor = ev => {
    const lines = [`**${ev.name}**... ${ev.summary}`];
    if (ev.notes) lines.push('', ev.notes);
    lines.push('', `Function gets: \`${ev.params.length ? handlerText(ev.params) : '() => …'}\``);
    for (const p of ev.params) if (p.note) lines.push(`- \`${p.name}\`: ${p.note}`);
    if (ev.filter) { lines.push('', `${ev.filter.required ? 'Needs' : 'Can take'} a second argument: ${ev.filter.label}`); }
    lines.push('', '```js', ev.example, '```');
    return lines.join('\n');
};
const insertTextFor = (ev, {once = false} = {}) => {
    const filter = ev.filter && ev.filter.required ? `, "\${1:${ev.filter.sample}}"` : '';
    if (once) return `${ev.name}"${filter}`;
    const args = ev.params.map(p => p.name);
    const head = args.length === 1 ? args[0] : `(${args.join(', ')})`;
    return `${ev.name}"${filter}, ${head} => {\n\t$0\n}`;
};
const example = (group, label, code) => ({group, label, code: code.replace(/^\n/, '')});
const GROUPS = ['Moving', 'Looks and sound', 'Clones', 'Game', 'Messages and timing', 'Multiplayer', 'Other'];
const EXAMPLES = [
    example('Moving', 'Walk around with the arrow keys', `
world.input.actions({
    left: ["left arrow", "a"],
    right: ["right arrow", "d"],
    up: ["up arrow", "w"],
    down: ["down arrow", "s"]
});

for await (const dt of frames()) {
    me.x += world.input.axis("left", "right") * 200 * dt;
    me.y += world.input.axis("down", "up") * 200 * dt;
}
`),
    example('Moving', 'Chase the mouse', `
for await (const dt of frames()) {
    me.pointAt("mouse");
    if (me.distanceTo("mouse") > 5) me.move(150 * dt);
}
`),
    example('Moving', 'Jump (and fall back down)', `
world.input.actions({
    left: ["left arrow", "a"],
    right: ["right arrow", "d"],
    jump: ["space", "up arrow", "w"]
});

me.vy = 0;
for await (const dt of frames()) {
    me.x += world.input.axis("left", "right") * 180 * dt;
    me.vy -= 900 * dt;
    me.y += me.vy * dt;
    if (me.y < -140) {
        me.y = -140;
        me.vy = 0;
        if (world.input.pressed("jump")) me.vy = 420;
    }
}
`),
    example('Moving', 'Bounce off the edges like a DVD logo', `
let dx = 120;
let dy = 90;
for await (const dt of frames()) {
    me.x += dx * dt;
    me.y += dy * dt;
    if (me.x > 240 || me.x < -240) dx = -dx;
    if (me.y > 180 || me.y < -180) dy = -dy;
}
`),
    example('Moving', 'Glide wherever you click', `
world.on("mousedown", async () => {
    await me.glide(0.5, world.mouse.x, world.mouse.y);
});
`),
    example('Moving', 'Pace back and forth', `
for (;;) {
    await me.glide(1, 100, me.y, "easeInOutSine");
    await me.glide(1, -100, me.y, "easeInOutSine");
}
`),
    example('Moving', 'Spin forever', `
for await (const dt of frames()) {
    me.turn(180 * dt);
}
`),
    example('Looks and sound', 'Say something when clicked', `
me.on("click", () => {
    me.say("hello!", 2);
});
`),
    example('Looks and sound', 'Flip through costumes to animate', `
for (;;) {
    me.nextCostume();
    await wait(0.15);
}
`),
    example('Looks and sound', 'Walk and idle animations (make "walk" and "idle" in the Animations tab first)', `
world.input.actions({left: ["left arrow", "a"], right: ["right arrow", "d"]});

for await (const dt of frames()) {
    const move = world.input.axis("left", "right");
    me.x += move * 150 * dt;
    const wanted = move ? "walk" : "idle";
    const now = me.animator.current;
    if (!now || now.name !== wanted) me.animator.crossfade(wanted, 0.2);
    me.animator.speed = move ? Math.abs(move) : 1;
}
`),
    example('Looks and sound', 'Fade in', `
me.effects.ghost = 100;
await me.tween({"effects.ghost": 0}, 1);
`),
    example('Looks and sound', 'Slide in and grow', `
await me.tween({x: 100, size: 150}, 1, "easeOutQuad");
await me.tween({x: 0, size: 100}, 1, "easeInOutSine");
`),
    example('Looks and sound', 'Get bigger when the mouse is on it', `
for await (const dt of frames()) {
    const goal = me.touching("mouse") ? 150 : 100;
    me.size += (goal - me.size) * Math.min(1, dt * 10);
}
`),
    example('Looks and sound', 'Play a sound when clicked', `
me.on("click", () => {
    me.sound.start("pop");
});
`),
    example('Clones', 'Shoot bullets with space', `
if (!me.isClone) {
    me.visible = false;
    world.on("key", "space", () => {
        const bullet = me.clone();
        if (bullet) bullet.goTo(world.mouse.x, world.mouse.y);
    });
} else {
    me.visible = true;
    for await (const dt of frames()) {
        me.y += 300 * dt;
        if (me.y > 180) me.delete();
    }
}
`),
    example('Clones', 'Enemies falling from the sky', `
if (!me.isClone) {
    me.visible = false;
    world.every(1, () => {
        const enemy = me.clone();
        if (enemy) enemy.goTo(Math.random() * 400 - 200, 180);
    });
} else {
    me.visible = true;
    for await (const dt of frames()) {
        me.y -= 80 * dt;
        if (me.y < -180) me.delete();
    }
}
`),
    example('Game', 'Grab coins (you need a sprite called Player)', `
world.on("preflag", () => {
    world.score = 0;
});

for await (const dt of frames()) {
    if (me.touching("Player")) {
        world.score++;
        me.goTo(Math.random() * 400 - 200, Math.random() * 300 - 150);
    }
}
`),
    example('Game', 'Show the score', `
world.on("change", "score", now => {
    me.say("Score: " + now);
});
`),
    example('Game', 'Lives and game over (you need a sprite called Enemy)', `
world.on("preflag", () => {
    world.lives = 3;
});

me.on("touch", "Enemy", () => {
    world.lives--;
    if (world.lives <= 0) {
        me.say("game over");
        world.broadcast("game over");
    }
});
`),
    example('Game', 'Roll a dice', `
me.on("click", () => {
    const roll = Math.floor(Math.random() * 6) + 1;
    me.say("you rolled a " + roll, 2);
});
`),
    example('Game', 'A timer that counts up', `
world.resetTimer();
world.every(1, () => {
    me.say(Math.floor(world.timer));
});
`),
    example('Game', 'Ask the player something', `
const name = await me.ask("What's your name?");
me.say("Hello " + name);
`),
    example('Messages and timing', 'When the green flag is clicked', `
world.on("flag", () => {
    me.goTo(0, 0);
    me.say("go!", 1);
});
`),
    example('Messages and timing', 'Do something every second', `
world.every(1, () => {
    me.turn(15);
});
`),
    example('Messages and timing', 'Wait a bit, then do something', `
await wait(2);
me.say("two seconds later");
`),
    example('Messages and timing', 'Send a message', `
me.on("click", () => {
    world.broadcast("go");
});
`),
    example('Messages and timing', 'Get a message', `
world.on("broadcast", "go", () => {
    me.say("got it", 1);
});
`),
    example('Multiplayer', 'Show the other players', `
me.sync(["x", "y", "direction"], {ghost: {label: true}});
`),
    example('Multiplayer', 'Send stuff to the other players', `
world.on("key", "space", () => {
    world.server.relay("hello", {text: "hi!"});
});

world.server.on("relay", "hello", (data, from) => {
    me.say(from.username + ": " + data.text, 2);
});
`),
    example('Multiplayer', 'See who joins and leaves', `
world.server.on("join", player => {
    log(player.username + " joined");
});
world.server.on("leave", player => {
    log(player.username + " left");
});
`),
    example('Multiplayer', 'Hop to another room', `
world.on("key", "1", () => {
    world.server.join("room-1");
});
`),
    example('Multiplayer', 'A click counter everyone shares', `
world.on("mousedown", () => {
    world.cloud.set("clicks", world.cloud.get("clicks", 0) + 1);
});

world.on("cloud", "clicks", value => {
    me.say(value);
});
`),
    example('Multiplayer', 'Ask the game server something', `
const answer = await world.server.ask({type: "hello"});
log(answer);
`),
    example('Other', 'Controls with names (keys, mouse, gamepad)', `
world.input.actions({
    jump: ["space", "w"],
    fire: ["mouse"]
});

world.input.on("jump", "press", () => {
    me.say("jump!", 0.5);
});
`),
    example('Other', 'Keep values while you edit', `
const state = me.hold({clicks: 0});

me.on("click", () => {
    state.clicks++;
    me.say(state.clicks);
});
`),
    example('Other', 'Run blocks from code', `
const hop = new Blockspace("hop");

me.on("click", () => {
    me.run(hop);
});
`),
    example('Other', 'Write a test', `
test("moves right", async () => {
    me.goTo(0, 0);
    me.x += 10;
    expect(me.x).toBe(10);
});
`),
    example('Other', 'Share code with other sprites (export)', `
// In this sprite: export what others can use
export const speed = 200;
export function hop(sprite, height = 60) {
    tween(sprite, {y: sprite.y + height}, 0.25, "easeOutQuad");
}

// In another complex sprite (use this sprite's name):
// import {hop, speed} from "Player";
`),
    example('Other', 'Use another sprite\'s code (import)', `
import {hop} from "Player";

me.on("click", () => hop(me));
`),
    example('Other', 'Load an asset as data', `
import levels from "asset:levels.json";

log("there are", levels.length, "levels");
`),
    example('Other', 'Share code the CommonJS way (require)', `
module.exports = {
    hop: sprite => tween(sprite, {y: sprite.y + 60}, 0.25)
};

// elsewhere: const {hop} = require("Player");
`)
];
let savedCacheFlag = null;
const openBlockspace = (vm, targetId, id) => {
    const host = vm.runtime.dimodBlockspace;
    if (!host || !host.setFocus(targetId, id)) return false;
    setToolboxBlockspace({targetId, id, params: host.focusedParams()});
    if (savedCacheFlag === null) savedCacheFlag = Boolean(window.__dimodNoWsCache);
    window.__dimodNoWsCache = true;
    return true;
};
const closeBlockspace = vm => {
    const host = vm.runtime.dimodBlockspace;
    if (host) host.setFocus(null);
    setToolboxBlockspace(null);
    if (savedCacheFlag !== null) { window.__dimodNoWsCache = savedCacheFlag; savedCacheFlag = null; }
};
const setOpenBlockspaceParams = (vm, params) => {
    const host = vm.runtime.dimodBlockspace;
    if (!host || !host.focus) return;
    host.setFocusedParams(params);
    setToolboxBlockspace({targetId: host.focus.targetId, id: host.focus.id, params: host.focusedParams()});
    vm.emitWorkspaceUpdate();
};
const confirmSetComplex = (name, complex) => (complex ?
    askConfirm(
        'Its scripts move into code, as the "main" blockspace, and keep running exactly as they do now. ' +
        'You can make it blocks again at any time without losing anything.',
        {title: `Make "${name}" complex?`, ok: 'Make it complex'}
    ) :
    askConfirm(
        'Its code stops running (it\'s kept, and comes back if you make it complex again). Blockspace ' +
        'scripts become normal scripts; "when called" scripts won\'t run without the code.',
        {title: `Make "${name}" blocks again?`, ok: 'Make it blocks', danger: true}
    ));
const API_BASE = process.env.DIMOD_API_BASE;
const HEADER = /^([ \t]*)\/\/ @library ([A-Za-z0-9_-]{6,16}) v(\d+)(?:[ \t]+(.*))?$/;
const FOOTER = /^[ \t]*\/\/ @end library ([A-Za-z0-9_-]{6,16})[ \t]*$/;
const findImports = text => {
    const found = [];
    let open = null;
    let offset = 0;
    for (const line of text.split('\n')) {
        const lineEnd = offset + line.length;
        const header = open ? null : HEADER.exec(line);
        if (header) {
            open = {id: header[2], version: Number(header[3]), label: header[4] || '', start: offset, innerStart: lineEnd + 1};
        } else if (open) {
            const footer = FOOTER.exec(line);
            if (footer && footer[1] === open.id) {
                found.push({...open, innerEnd: offset, end: Math.min(text.length, lineEnd)});
                open = null;
            }
        }
        offset = lineEnd + 1;
    }
    return found;
};
const wrapImport = ({id, version, name, author}, code) => {
    const label = [name, author ? `by ${author}` : ''].filter(Boolean).join(' ')
        .replace(/[\r\n]+/g, ' ');
    const title = label ? ` ${label}` : '';
    return `// @library ${id} v${version}${title}\n${code.replace(/\s+$/, '')}\n// @end library ${id}`;
};
const renameCollisions = (code, taken) => {
    const used = new Set(taken);
    const edits = [];
    const renamed = [];
    for (const call of findBlockspaces(code)) {
        if (!call.id) continue;
        let id = call.id;
        if (used.has(id)) {
            const base = id.replace(/\d+$/, '');
            let n = 2;
            while (used.has(`${base}${n}`)) n++;
            id = `${base}${n}`;
            edits.push({start: call.idStart, end: call.idEnd, text: JSON.stringify(id)});
            renamed.push([call.id, id]);
        }
        used.add(id);
    }
    let out = applyEdits(code, edits);
    for (const [from, to] of renamed) {
        out = out.split(JSON.stringify(from)).join(JSON.stringify(to))
            .split(`'${from}'`)
            .join(`'${to}'`);
    }
    return {code: out, renamed};
};
const blockspaceIds = (text, except = null) => {
    const ids = new Set();
    for (const call of findBlockspaces(text)) {
        if (!call.id) continue;
        if (except && call.idStart >= except.start && call.idStart < except.end) continue;
        ids.add(call.id);
    }
    return ids;
};
const insertImport = (text, offset, entry, code) => {
    let at = offset;
    const inside = findImports(text).find(imp => at > imp.start && at < imp.end);
    if (inside) at = inside.end;
    const {code: unique, renamed} = renameCollisions(code, blockspaceIds(text));
    const before = text.slice(0, at);
    const lead = before.length === 0 || before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
    const block = wrapImport(entry, unique);
    const tail = text.slice(at).startsWith('\n') ? '' : '\n';
    return {
        text: `${before}${lead}${block}${tail}${text.slice(at)}`,
        start: at + lead.length,
        end: at + lead.length + block.length,
        renamed,
        edit: {from: at, to: at, text: `${lead}${block}${tail}`}
    };
};
const updateImport = (text, imp, entry, code) => {
    const {code: unique, renamed} = renameCollisions(code, blockspaceIds(text, {start: imp.start, end: imp.end}));
    const block = wrapImport(entry, unique);
    return {
        text: text.slice(0, imp.start) + block + text.slice(imp.end),
        start: imp.start,
        end: imp.start + block.length,
        renamed,
        edit: {from: imp.start, to: imp.end, text: block}
    };
};
const request = async (method, path, body) => {
    const token = getDimodToken();
    const res = await fetch(`${API_BASE}/blockspace-library${path}`, {
        method,
        headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body ? JSON.stringify(body) : void 0
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {status: res.status});
    return data;
};
const libraryApi = {
    list: ({q = '', tag = '', sort = 'new', mine = false, page = 0} = {}) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (tag) params.set('tag', tag);
        if (sort !== 'new') params.set('sort', sort);
        if (mine) params.set('mine', '1');
        if (page) params.set('page', String(page));
        const query = params.toString();
        return request('GET', query ? `?${query}` : '');
    },
    get: (id, version) => request('GET', `/${id}${version ? `?version=${version}` : ''}`),
    versions: id => request('GET', `/${id}/versions`),
    latest: ids => request('POST', '/latest', {ids}),
    create: entry => request('POST', '', entry),
    addVersion: (id, code, notes) => request('POST', `/${id}/versions`, {code, notes}),
    update: (id, changes) => request('PATCH', `/${id}`, changes),
    remove: id => request('DELETE', `/${id}`),
    used: id => request('POST', `/${id}/use`).catch(() => null)
};
const key = name => JSON.stringify(String(name));
const names = (iface, list, type = '1') =>
    `interface ${iface} {${[...new Set(list)].map(name => `\n    ${key(name)}: ${type};`).join('')}\n}\n`;
const label = (name, used) => {
    let id = String(name).replace(/[^A-Za-z0-9_$]/g, '_');
    if (!/^[A-Za-z_$]/.test(id)) id = `_${id}`;
    let unique = id;
    for (let n = 2; used.has(unique); n++) unique = `${id}${n}`;
    used.add(unique);
    return unique;
};
const blockspaceParams = (runtime, target) => {
    const host = runtime.dimodBlockspace;
    const entries = host && target ? host.spaces.entries(target.sprite) : [];
    const lines = entries.map(entry => {
        const used = new Set();
        const params = entry.params.map(name => `${label(name, used)}?: any`).join(', ');
        return `\n    ${key(entry.id)}: [${params}];`;
    });
    return `interface BlockspaceParams {${lines.join('')}\n}\n`;
};
const ASSIGN = '\\s*(?:\\*\\*|<<|>>>|>>|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?!=)';
const SPRITE_SOURCES = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?' +
    '(?:world\\s*\\.\\s*(?:getTarget\\s*\\(|stage\\b)|me\\s*\\.\\s*(?:clone\\s*\\(|original\\b|parent\\b))', 'g');
const literalKind = (op, rhs) => {
    const text = rhs.trim();
    if (op === '=') {
        if (/^-?(?:\d|\.\d|Infinity\b|NaN\b)/.test(text)) return 'number';
        if (/^(?:true|false)\b/.test(text)) return 'boolean';
        if (/^["'`]/.test(text)) return 'string';
        if (text.startsWith('[')) return 'any[]';
        return 'any';
    }
    return /^(?:-|\*|\/|%|\*\*)=$/.test(op) ? 'number' : 'any';
};
const assignedOn = (source, owner) => {
    const re = new RegExp(`\\b${owner}\\s*\\.\\s*([A-Za-z_$][\\w$]*)(${ASSIGN})([^;\\n]*)`, 'g');
    const found = [];
    for (let m = re.exec(source); m; m = re.exec(source)) { found.push({name: m[1], kind: literalKind(m[2].trim(), m[3])}); }
    return found;
};
const noteKind = (kinds, name, kind) => {
    const known = kinds.get(name);
    kinds.set(name, known === void 0 || known === kind ? kind : 'any');
};
const VALUE_BLOCKS = {
    world: [OPCODES.setWorldValue, OPCODES.changeWorldValue],
    sprite: [OPCODES.setMyValue, OPCODES.changeMyValue]
};
const namesInBlocks = (target, opcodes) => {
    const blocks = target.blocks._blocks;
    const found = [];
    for (const id in blocks) {
        const block = blocks[id];
        if (!opcodes.includes(block.opcode)) continue;
        const input = block.inputs.NAME;
        const shadow = input && blocks[input.block];
        const field = shadow && shadow.fields && shadow.fields.TEXT;
        if (field && /^[A-Za-z_$][\w$]*$/.test(String(field.value))) found.push(String(field.value));
    }
    return found;
};
const ownValues = runtime => {
    const world = new Map();
    const sprite = new Map();
    const anyFrom = (kinds, list) => list.forEach(name => kinds.set(name, 'any'));
    for (const target of runtime.targets) {
        if (!target.isOriginal) continue;
        anyFrom(world, namesInBlocks(target, VALUE_BLOCKS.world));
        anyFrom(sprite, namesInBlocks(target, VALUE_BLOCKS.sprite));
    }
    for (const target of runtime.targets) {
        if (!target.isOriginal) continue;
        const dimod = target.sprite.dimod;
        if (!dimod || !dimod.complex || typeof dimod.source !== 'string') continue;
        const source = dimod.source;
        assignedOn(source, 'world').forEach(({name, kind}) => noteKind(world, name, kind));
        const owners = new Set(['me']);
        SPRITE_SOURCES.lastIndex = 0;
        for (let m = SPRITE_SOURCES.exec(source); m; m = SPRITE_SOURCES.exec(source)) owners.add(m[1]);
        owners.forEach(owner => assignedOn(source, owner).forEach(({name, kind}) => noteKind(sprite, name, kind)));
    }
    const worldBuiltIn = new Set(WORLD_BUILT_IN_NAMES);
    const spriteBuiltIn = new Set(TARGET_BUILT_IN_NAMES);
    return {
        world: [...world].filter(([name]) => !worldBuiltIn.has(name)),
        sprite: [...sprite].filter(([name]) => !spriteBuiltIn.has(name))
    };
};
const valueTypes = runtime => {
    const {world, sprite} = ownValues(runtime);
    const members = list => list.map(([name, kind]) => `\n    ${name}: ${kind};`).join('');
    const nameList = list => list.map(([name]) => name);
    return [
        names('WorldValueNames', nameList(world)),
        names('SpriteValueNames', nameList(sprite)),
        '/** your own values on world... set anywhere, shared by all code, emptied by the green flag */',
        `interface WorldApi {${members(world)}\n}`,
        '/** a sprite\'s own values... emptied by the green flag; clones start with a copy */',
        `interface TargetApi {${members(sprite)}\n}\n`
    ].join('\n');
};
const stringArgs = (source, call) => {
    const re = new RegExp(`\\b${call}\\s*\\(\\s*(["'])([^"'\\n]{1,64})\\1`, 'g');
    const found = [];
    for (let m = re.exec(source); m; m = re.exec(source)) found.push(m[2]);
    return found;
};
const objectKeys = (source, open) => {
    const keys = [];
    let depth = 0;
    let expectKey = false;
    for (let i = open; i < source.length; i++) {
        const c = source[i];
        if (c === '{' || c === '[' || c === '(') {
            depth++;
            expectKey = depth === 1 && c === '{';
        } else if (c === '}' || c === ']' || c === ')') {
            if (--depth <= 0) break;
        } else if (c === ',' && depth === 1) { expectKey = true; } else if (c === '"' || c === '\'' || c === '`') {
            const end = source.indexOf(c, i + 1);
            if (end < 0) break;
            if (expectKey && depth === 1 && /^\s*:/.test(source.slice(end + 1, end + 8))) { keys.push(source.slice(i + 1, end)); }
            expectKey = false;
            i = end;
        } else if (expectKey && depth === 1 && /[A-Za-z_$]/.test(c)) {
            const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(source.slice(i, i + 80));
            if (m) keys.push(m[1]);
            expectKey = false;
        }
    }
    return keys;
};
const actionsIn = source => {
    const found = [...stringArgs(source, 'bind'), ...stringArgs(source, 'rebind')];
    const re = /\.\s*actions\s*\(\s*\{/g;
    for (let m = re.exec(source); m; m = re.exec(source)) { found.push(...objectKeys(source, m.index + m[0].length - 1)); }
    return found;
};
const moduleExportsOf = runtime => {
    const out = [];
    for (const target of runtime.targets) {
        const dimod = target.isOriginal && target.sprite.dimod;
        if (!dimod || !dimod.complex || typeof dimod.source !== 'string') continue;
        let found = [];
        try { found = [...transformModule(dimod.source).exports, ...commonExports(dimod.source)]; } catch (e) { found = []; }
        const list = [...new Set(found)].filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));
        const names = target.isStage ? [...new Set(['Stage', target.getName()])] : [target.getName()];
        out.push({targetId: target.id, names, exports: list, hasDefault: found.includes('default')});
    }
    return out;
};
const moduleTypes = runtime => moduleExportsOf(runtime).map(({names, exports: list}) => {
    const vars = list.map((n, i) => `_${i}: any`).join(', ');
    const named = list.map((n, i) => `_${i} as ${n}`).join(', ');
    const body = list.length ? `    const ${vars};\n    export {${named}};\n` : '';
    const decl = `${body}    const _default: any;\n    export default _default;\n}\n`;
    return names.map(name => `declare module ${key(name)} {\n${decl}`).join('');
})
    .join('');
const GLOBAL_NAMES = ['me', 'world', 'wait', 'waitUntil', 'nextFrame', 'frames', 'tween', 'repeat', 'fromCast',
    'toCast', 'log', 'Stopped', 'Position', 'Skin', 'Iris', 'reloaded', 'editor', 'Blockspace', 'module', 'exports',
    'require', 'test', 'it', 'describe', 'expect', 'assert', 'beforeEach', 'afterEach'];
const memberNames = (cls, functionsOnly) => {
    const names = new Set();
    for (let p = cls.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        for (const n of Object.getOwnPropertyNames(p)) {
            const d = Object.getOwnPropertyDescriptor(p, n);
            if (n.startsWith('_') || n === 'constructor' || (functionsOnly && typeof d.value !== 'function')) continue;
            names.add(n);
        }
    }
    return [...names];
};
const editDistance = (x, y) => {
    const a = x.toLowerCase();
    const b = y.toLowerCase();
    const d = Array.from({length: a.length + 1}, (v, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
};
const closest = (word, candidates) => {
    let best = null;
    let score = Math.max(2, Math.floor(word.length / 3)) + 1;
    for (const c of candidates) {
        if (c === word) continue;
        const d = editDistance(word, c);
        if (d < score) { best = c; score = d; }
    }
    return best;
};
const sourceNames = source => [...new Set((source || '').match(/[A-Za-z_$][\w$]*/g) || [])];
const explainError = (text, source = '') => {
    const msg = String(text || '').replace(/^\w*Error: /, '');
    let m = /^([\w$.]+?)\.([\w$]+) is not a function/.exec(msg);
    if (m) {
        const [, owner, name] = m;
        const pool = owner === 'world' ? memberNames(WorldApi, true) : (/^[\w$]+$/.test(owner) ? memberNames(TargetApi, true) : []);
        const guess = closest(name, pool);
        return {
            title: `${owner} doesn't know how to ${name}`,
            hint: guess ? `Did you mean ${owner}.${guess}(...)?` : 'Typo maybe? The docs have the full list.'
        };
    }
    m = /^([\w$]+) is not defined/.exec(msg);
    if (m) {
        const guess = closest(m[1], [...GLOBAL_NAMES, ...sourceNames(source)]);
        return {
            title: `"${m[1]}" doesn't exist here`,
            hint: guess ? `Did you mean ${guess}?` : 'Make it first with const or let... or it\'s a typo.'
        };
    }
    m = /Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '([^']*)'\))?/.exec(msg);
    if (m) {
        return {
            title: m[2] ? `Tried to get .${m[2]} from nothing (${m[1]})` : `Tried to use nothing (${m[1]})`,
            hint: 'Whatever is before the dot isn\'t there. world.getTarget() gives null if the sprite doesn\'t exist, and values are undefined until something sets them.'
        };
    }
    if (/Cannot set propert(?:y|ies) of (undefined|null)/.test(msg)) {
        return {title: 'Tried to set something on nothing', hint: 'Whatever is before the dot isn\'t there.'};
    }
    if (/Assignment to constant variable/.test(msg)) {
        return {title: 'Can\'t change a const', hint: 'Use let instead of const if it needs to change.'};
    }
    if (/await is only valid in async function|Unexpected reserved word/.test(msg)) {
        return {title: 'await only works in async functions', hint: 'Stick async in front: async () => { ... }'};
    }
    if (/is not iterable/.test(msg)) {
        return {title: 'Can\'t loop over that', hint: 'for...of wants a list. To do something n times, use repeat(n, i => ...) or a normal for loop.'};
    }
    if (/^Unexpected (token|end of input|identifier)|missing \) after|Invalid or unexpected token/.test(msg)) {
        return {title: 'Typo somewhere around here', hint: 'Usually a missing ) or }, a missing comma, or a string that never ends.'};
    }
    if (/Maximum call stack/.test(msg)) {
        return {title: 'A function keeps calling itself forever', hint: 'Something has to stop it... like an if around the call.'};
    }
    return null;
};
const codeNames = runtime => {
    const actions = new Set();
    const channels = new Set();
    const cloud = new Set();
    for (const target of runtime.targets) {
        if (!target.isOriginal) continue;
        const dimod = target.sprite.dimod;
        if (!dimod || !dimod.complex || typeof dimod.source !== 'string') continue;
        const source = dimod.source;
        actionsIn(source).forEach(name => actions.add(name));
        stringArgs(source, 'relay').forEach(name => channels.add(name));
        stringArgs(source, 'cloud\\s*\\.\\s*set').forEach(name => cloud.add(name));
    }
    const stage = runtime.getTargetForStage();
    if (stage) {
        for (const v of Object.values(stage.variables)) {
            if (v.isCloud) cloud.add(String(v.name).replace(/^☁\s*/, ''));
        }
    }
    return [
        names('InputActionNames', [...actions]),
        names('RelayChannels', [...channels]),
        names('CloudNames', [...cloud])
    ].join('\n');
};
const variablesOf = (target, type) => Object.values(target.variables)
    .filter(v => v.type === type)
    .map(v => v.name);
const animationTypes = (runtime, target) => {
    const own = target && !target.isStage ? animationsOf(target.sprite).map(d => d.name) : [];
    const refs = [];
    const events = [];
    for (const t of runtime.targets) {
        if (!t.isOriginal || t.isStage) continue;
        for (const doc of animationsOf(t.sprite)) {
            refs.push(`${t.getName()}/${doc.name}`);
            (doc.events || []).forEach(ev => events.push(String(ev.value)));
        }
    }
    return [names('MyAnimations', own), names('AnimationRefs', refs), names('AnimationEventNames', events)].join('\n');
};
const projectTypes = (runtime, target) => {
    const stage = runtime.getTargetForStage();
    const sprites = runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => t.getName());
    const broadcasts = stage ? variablesOf(stage, Variable.BROADCAST_MESSAGE_TYPE) : [];
    const own = target && !target.isStage ? target : null;
    return [
        names('SpriteNames', sprites),
        names('MyCostumes', target ? target.getCostumes().map(c => c.name) : []),
        names('MySounds', target ? target.getSounds().map(s => s.name) : []),
        names('BackdropNames', stage ? stage.getCostumes().map(c => c.name) : []),
        names('BroadcastNames', broadcasts),
        names('SceneNames', runtime.dimodScenes ? runtime.dimodScenes.names : []),
        names('ProjectVars', stage ? variablesOf(stage, Variable.SCALAR_TYPE) : [], 'any'),
        names('ProjectLists', stage ? variablesOf(stage, Variable.LIST_TYPE) : [], 'any[]'),
        names('MyVars', own ? variablesOf(own, Variable.SCALAR_TYPE) : [], 'any'),
        names('MyLists', own ? variablesOf(own, Variable.LIST_TYPE) : [], 'any[]'),
        blockspaceParams(runtime, target),
        animationTypes(runtime, target),
        valueTypes(runtime),
        codeNames(runtime),
        moduleTypes(runtime),
        extensionTypes(runtime)
    ].join('\n');
};
export {explainError, moduleExportsOf, CATALOG, COLOURS, EXAMPLES, GROUPS, SERVER_EVENTS, SYNC_EVENTS, TARGET_EVENTS, WORLD_EVENTS, WORLD_ONCE_EXTRA, apiTypes, blockspaceCategoryXML, blockspaceIds, clearLog, closeBlockspace, codeOf, confirmSetComplex, defineBlockspaceBlocks, documentationFor, errorSpots, EXAMPLES as examplesDefault, findImports, insertImport, insertTextFor, installBlockspaceCollab, installConsoleStore, isApplyingRemote, libraryApi, locate, logFor, markSeen, openBlockspace, payloadsOf, projectTypes, renameCollisions, sendCollab, sendViewEdit, setEditorModels, setMenuVM, setOpenBlockspaceParams, setToolboxBlockspace, subscribeCollab, subscribeConsole, unseenErrors, updateImport, viewOf, wrapImport};
