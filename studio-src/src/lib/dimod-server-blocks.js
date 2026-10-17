import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import {DimodGameClient, getDimodGameContext, installPseudoServer} from './dimod-server';
import {onCloudStateChange, isCloudProject, getSeeInsideId} from './dimod-project';
const OPCODES = {
    whenReceive: 'event_dimod_whenireceive',
    receivedData: 'event_dimod_receiveddata',
    send: 'event_dimod_sendtoserver',
    ask: 'event_dimod_asktheserver',
    ping: 'event_dimod_ping',
    whenConnected: 'event_dimod_whenconnected',
    connected: 'event_dimod_connected',
    players: 'event_dimod_playersonline',
    whenDisconnected: 'event_dimod_whendisconnected',
    myUsername: 'event_dimod_myusername',
    myPlayerId: 'event_dimod_myplayerid',
    isGuest: 'event_dimod_isguest',
    disconnect: 'event_dimod_disconnect',
    reconnect: 'event_dimod_reconnect',
    joinRoom: 'event_dimod_joinroom',
    currentRoom: 'event_dimod_currentroom',
    isPretend: 'event_dimod_ispretend'
};
const COLOURS$1 = {primary: '#5C5CE6', secondary: '#4A4AD1', tertiary: '#3D3DB8'};
const isClientOpcode = opcode => typeof opcode === 'string' && opcode.startsWith('event_dimod_');
const projectNeedsServer = vm => vm.runtime.hasCloudData() || vm.runtime.targets.some(target => {
    const blocks = target.blocks && target.blocks._blocks;
    if (!blocks) return false;
    for (const id in blocks) {
        if (isClientOpcode(blocks[id].opcode)) return true;
    }
    return false;
});
const installClientBlocksVM = vm => {
    if (vm.__dimodClientInstalled) return;
    vm.__dimodClientInstalled = true;
    const runtime = vm.runtime;
    installPseudoServer(vm);
    const context = getDimodGameContext();
    const client = context ? new DimodGameClient(vm, context) : null;
    vm.dimodGameClient = client;
    const use = () => {
        if (client) client.ensureConnected();
        return client;
    };
    runtime._primitives[OPCODES.whenReceive] = () => true;
    runtime._primitives[OPCODES.whenConnected] = () => true;
    runtime._primitives[OPCODES.whenDisconnected] = () => true;
    runtime._primitives[OPCODES.receivedData] = (args, util) => {
        if (util.thread && typeof util.thread.dimodReceivedData === 'string') return util.thread.dimodReceivedData;
        return client ? client.lastData : '';
    };
    runtime._primitives[OPCODES.send] = args => {
        const c = use();
        if (c) c.send(args.DATA);
    };
    runtime._primitives[OPCODES.disconnect] = () => {
        if (client) client.disconnect();
    };
    runtime._primitives[OPCODES.reconnect] = () => {
        if (client) client.reconnect();
    };
    runtime._primitives[OPCODES.joinRoom] = args => {
        const c = use();
        if (c) c.joinRoom(args.ROOM);
    };
    runtime._primitives[OPCODES.isPretend] = () => !!(client && client.pretend);
    runtime._primitives[OPCODES.currentRoom] = () => (client ? client.room : 'default');
    runtime._primitives[OPCODES.ask] = args => { const c = use(); return c ? c.ask(args.DATA) : ''; };
    runtime._primitives[OPCODES.ping] = () => { const c = use(); return c ? c.latency : 0; };
    runtime._primitives[OPCODES.connected] = () => { const c = use(); return !!(c && c.connected); };
    runtime._primitives[OPCODES.players] = () => { const c = use(); return c ? c.playerCount : 0; };
    runtime._primitives[OPCODES.myUsername] = () => { const c = use(); return c && c.player ? c.player.username : ''; };
    runtime._primitives[OPCODES.myPlayerId] = () => { const c = use(); return c && c.player ? c.player.id : ''; };
    runtime._primitives[OPCODES.isGuest] = () => { const c = use(); return c ? c.isGuest : true; };
    runtime._hats[OPCODES.whenReceive] = {restartExistingThreads: true};
    runtime._hats[OPCODES.whenConnected] = {restartExistingThreads: true};
    runtime._hats[OPCODES.whenDisconnected] = {restartExistingThreads: true};
    compatBlocks.statementBlocks.push(OPCODES.send, OPCODES.disconnect, OPCODES.reconnect, OPCODES.joinRoom);
    compatBlocks.outputBlocks.push(
        OPCODES.receivedData, OPCODES.ask, OPCODES.ping, OPCODES.connected, OPCODES.players,
        OPCODES.myUsername, OPCODES.myPlayerId, OPCODES.currentRoom, OPCODES.isGuest, OPCODES.isPretend
    );
    if (!client) return;
    client.onData = data => {
        const threads = runtime.startHats(OPCODES.whenReceive) || [];
        for (const thread of threads) thread.dimodReceivedData = data;
    };
    client.onConnected = () => { runtime.startHats(OPCODES.whenConnected); };
    client.onDisconnected = () => { runtime.startHats(OPCODES.whenDisconnected); };
    const maybeConnect = () => {
        client.userClosed = false;
        if (client.pretend || projectNeedsServer(vm)) client.ensureConnected();
    };
    vm.runtime.on('PROJECT_LOADED', maybeConnect);
    vm.on('PROJECT_START', maybeConnect);
    vm.on('HAS_CLOUD_DATA_UPDATE', has => {
        if (has) client.ensureConnected();
    });
    onCloudStateChange((state, changed) => {
        if (!changed || !state.isCloud) return;
        if (client.connection && client.connection.dimodPseudo) { client.requestCloseConnection(); client.player = null; }
        client.stopped = false;
        maybeConnect();
    });
};
const defineClientBlocks = ScratchBlocks => {
    const define = (opcode, json) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(Object.assign({
                    id: opcode,
                    colour: COLOURS$1.primary,
                    colourSecondary: COLOURS$1.secondary,
                    colourTertiary: COLOURS$1.tertiary
                }, json));
            }
        };
    };
    define(OPCODES.whenReceive, {
        message0: 'when I receive %1',
        args0: [{type: 'input_value', name: 'DATA'}],
        extensions: ['shape_hat']
    });
    define(OPCODES.receivedData, {
        message0: 'data',
        canDragDuplicate: true,
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
    });
    define(OPCODES.send, {
        message0: 'send %1 to the server',
        args0: [{type: 'input_value', name: 'DATA'}],
        extensions: ['shape_statement']
    });
    define(OPCODES.ask, {
        message0: 'ask the server %1',
        args0: [{type: 'input_value', name: 'DATA'}],
        extensions: ['output_string']
    });
    define(OPCODES.ping, {message0: 'ping', checkboxInFlyout: true, extensions: ['output_number']});
    define(OPCODES.whenConnected, {message0: 'when connected to the server', extensions: ['shape_hat']});
    define(OPCODES.whenDisconnected, {message0: 'when disconnected from the server', extensions: ['shape_hat']});
    define(OPCODES.disconnect, {
        message0: 'disconnect from the server',
        tooltip: 'Close the connection. It stays closed until "reconnect to the server" or the project restarts',
        extensions: ['shape_statement']
    });
    define(OPCODES.reconnect, {
        message0: 'reconnect to the server',
        tooltip: 'Open a fresh connection to the server',
        extensions: ['shape_statement']
    });
    define(OPCODES.joinRoom, {
        message0: 'join room %1',
        args0: [{type: 'input_value', name: 'ROOM'}],
        tooltip: 'Rooms split the players of this game up. Each one has its own players, ' +
            'data and cloud variables, and you stay in it until you join another one. ' +
            'A room is forgotten a little after the last player leaves.',
        extensions: ['shape_statement']
    });
    define(OPCODES.currentRoom, {
        message0: 'current room',
        checkboxInFlyout: true,
        tooltip: 'The room you are in... "default" unless the project joined another one',
        extensions: ['output_string']
    });
    define(OPCODES.myUsername, {
        message0: 'my username',
        checkboxInFlyout: true,
        tooltip: 'Your name on the server: your Dimod username, or "player" and a number for guests',
        extensions: ['output_string']
    });
    define(OPCODES.myPlayerId, {
        message0: 'my player id',
        checkboxInFlyout: true,
        tooltip: 'Your id on the server for this connection',
        extensions: ['output_string']
    });
    define(OPCODES.isGuest, {
        message0: "I'm a guest?",
        checkboxInFlyout: true,
        tooltip: 'True when you are playing without a Dimod account... your username and player id change every time',
        extensions: ['output_boolean']
    });
    define(OPCODES.connected, {message0: 'connected to the server?', checkboxInFlyout: true, extensions: ['output_boolean']});
    define(OPCODES.isPretend, {
        message0: 'on the pretend server?',
        checkboxInFlyout: true,
        tooltip: 'True in the editor until this is a cloud project: the server is pretend, it runs in this tab, and you are the only player',
        extensions: ['output_boolean']
    });
    define(OPCODES.players, {message0: 'players online', checkboxInFlyout: true, extensions: ['output_number']});
};
const text$1 = (name, value) => `<value name="${name}"><shadow type="text"><field name="TEXT">${value}</field></shadow></value>`;
const pretendHeaderXML = () => {
    if (isCloudProject()) return '';
    if (getSeeInsideId()) return `
        <label text="Runs on a pretend server in this tab"/>
        <sep gap="24"/>`;
    return `
        <button text="Make this a cloud project" callbackKey="DIMOD_ENABLE_CLOUD"/>
        <label text="Until then, these run on a pretend server in this tab"/>
        <sep gap="24"/>`;
};
const clientCategoryXML = () => `
    <category name="Client" id="dimodClient" colour="${COLOURS$1.primary}" secondaryColour="${COLOURS$1.secondary}">${pretendHeaderXML()}
        <block type="${OPCODES.whenReceive}">
            <value name="DATA"><shadow type="${OPCODES.receivedData}"/></value>
        </block>
        <block type="${OPCODES.send}">${text$1('DATA', 'hello')}</block>
        <block type="${OPCODES.ask}">${text$1('DATA', 'what\'s my score?')}</block>
        <block id="${OPCODES.ping}" type="${OPCODES.ping}"/>
        <sep gap="36"/>
        <label text="Rooms split this game's players up"/>
        <block type="${OPCODES.joinRoom}">${text$1('ROOM', 'default')}</block>
        <block id="${OPCODES.currentRoom}" type="${OPCODES.currentRoom}"/>
        <sep gap="36"/>
        <block type="${OPCODES.whenConnected}"/>
        <block type="${OPCODES.whenDisconnected}"/>
        <block type="${OPCODES.disconnect}"/>
        <block type="${OPCODES.reconnect}"/>
        <block id="${OPCODES.connected}" type="${OPCODES.connected}"/>
        <block id="${OPCODES.players}" type="${OPCODES.players}"/>
        <block id="${OPCODES.myUsername}" type="${OPCODES.myUsername}"/>
        <block id="${OPCODES.myPlayerId}" type="${OPCODES.myPlayerId}"/>
        <block id="${OPCODES.isGuest}" type="${OPCODES.isGuest}"/>
        <block id="${OPCODES.isPretend}" type="${OPCODES.isPretend}"/>
        <sep gap="36"/>
    </category>`;
const isDimodClientOpcode = isClientOpcode;
const COLOURS = {
    server: ['#FFBF00', '#E6AC00', '#CC9900'],
    players: ['#5C5CE6', '#4A4AD1', '#3D3DB8'],
    cloud: ['#FF8C1A', '#DB6E00', '#DB6E00'],
    database: ['#1E9AA8', '#18838F', '#136C75'],
    control: ['#FFAB19', '#EC9C13', '#CF8B17'],
    objects: ['#0FBD8C', '#0DA57A', '#0B8E69'],
    operators: ['#59C059', '#46B946', '#389438']
};
const FILL_INS = {
    dimodserver_player: 'player',
    dimodserver_data: 'data',
    dimodserver_question: 'question',
    dimodserver_value: 'value',
    dimodserver_item: 'item',
    dimodserver_index: 'index'
};
const input = name => ({type: 'input_value', name});
const substack = {type: 'input_statement', name: 'SUBSTACK'};
const dropdown = (name, options) => ({type: 'field_dropdown', name, options});
const BLOCKS = [
    ['dimodserver_whenstarts', 'server', {message0: 'when the server starts', extensions: ['shape_hat']}],
    ['dimodserver_whenconnects', 'server', {message0: 'when %1 connects', args0: [input('PLAYER')], extensions: ['shape_hat']}],
    ['dimodserver_whendisconnects', 'server', {message0: 'when %1 disconnects', args0: [input('PLAYER')], extensions: ['shape_hat']}],
    ['dimodserver_whensends', 'server', {message0: 'when %1 sends %2', args0: [input('PLAYER'), input('DATA')], extensions: ['shape_hat']}],
    ['dimodserver_whenasks', 'server', {message0: 'when %1 asks %2', args0: [input('PLAYER'), input('QUESTION')], extensions: ['shape_hat']}],
    ['dimodserver_respond', 'server', {message0: 'respond with %1', args0: [input('DATA')], extensions: ['shape_end']}],
    ['dimodserver_whencloud', 'server', {message0: 'when %1 changes cloud %2 to %3', args0: [input('PLAYER'), input('NAME'), input('VALUE')], extensions: ['shape_hat']}],
    ['dimodserver_reject', 'server', {message0: 'reject the change', extensions: ['shape_end']}],
    ['dimodserver_player', 'server', {message0: 'player', canDragDuplicate: true, extensions: ['output_string']}],
    ['dimodserver_data', 'server', {message0: 'data', canDragDuplicate: true, extensions: ['output_string']}],
    ['dimodserver_question', 'server', {message0: 'question', canDragDuplicate: true, extensions: ['output_string']}],
    ['dimodserver_value', 'server', {message0: 'value', canDragDuplicate: true, extensions: ['output_string']}],
    ['dimodserver_item', 'objects', {message0: 'item', canDragDuplicate: true, extensions: ['output_string']}],
    ['dimodserver_send', 'players', {message0: 'send %1 the data %2', args0: [input('PLAYER'), input('DATA')], extensions: ['shape_statement']}],
    ['dimodserver_sendall', 'players', {message0: 'send everyone the data %1', args0: [input('DATA')], extensions: ['shape_statement']}],
    ['dimodserver_sendallexcept', 'players', {message0: 'send everyone except %1 the data %2', args0: [input('PLAYER'), input('DATA')], extensions: ['shape_statement']}],
    ['dimodserver_disconnect', 'players', {message0: 'disconnect %1 because %2', args0: [input('PLAYER'), input('REASON')], extensions: ['shape_statement']}],
    ['dimodserver_players', 'players', {message0: 'list of players', extensions: ['output_string']}],
    ['dimodserver_playercount', 'players', {message0: 'number of players', extensions: ['output_number']}],
    ['dimodserver_playernamed', 'players', {message0: 'player named %1', args0: [input('NAME')], extensions: ['output_string']}],
    ['dimodserver_username', 'players', {message0: 'username of %1', args0: [input('PLAYER')], extensions: ['output_string']}],
    ['dimodserver_loggedin', 'players', {message0: '%1 is logged in?', args0: [input('PLAYER')], extensions: ['output_boolean']}],
    ['dimodserver_isguest', 'players', {message0: '%1 is a guest?', args0: [input('PLAYER')], tooltip: 'They have no Dimod account, so their username and id last only for this connection', extensions: ['output_boolean']}],
    ['dimodserver_playerid', 'players', {message0: 'id of %1', args0: [input('PLAYER')], extensions: ['output_string']}],
    ['dimodserver_isonline', 'players', {message0: '%1 is online?', args0: [input('PLAYER')], extensions: ['output_boolean']}],
    ['dimodserver_sameplayer', 'players', {message0: '%1 is the same player as %2?', args0: [input('PLAYER1'), input('PLAYER2')], tooltip: 'Compares players or usernames', extensions: ['output_boolean']}],
    ['dimodserver_host', 'players', {message0: 'host player', tooltip: 'The player who has been connected the longest', extensions: ['output_string']}],
    ['dimodserver_playernumber', 'players', {message0: 'player number %1', args0: [input('INDEX')], tooltip: 'Players in the order they joined, starting at 1', extensions: ['output_string']}],
    ['dimodserver_randomplayer', 'players', {message0: 'random player', extensions: ['output_string']}],
    ['dimodserver_room', 'players', {message0: 'this room', tooltip: 'The room this copy of your server code is running for. Every room has its own players, cloud variables and copy of this code; the database is shared by all of them', extensions: ['output_string']}],
    ['dimodserver_sendeach', 'players', {message0: 'send each player in %1 the data %2', args0: [input('LIST'), input('DATA')], tooltip: 'Send data to every player (or username) in a list, like a team', extensions: ['shape_statement']}],
    ['dimodserver_setcloud', 'cloud', {message0: 'set cloud %1 to %2', args0: [input('NAME'), input('VALUE')], extensions: ['shape_statement']}],
    ['dimodserver_changecloud', 'cloud', {message0: 'change cloud %1 by %2', args0: [input('NAME'), input('VALUE')], extensions: ['shape_statement']}],
    ['dimodserver_getcloud', 'cloud', {message0: 'cloud %1', args0: [input('NAME')], extensions: ['output_string']}],
    ['dimodserver_setplayercloud', 'cloud', {message0: 'set %1 \'s cloud %2 to %3', args0: [input('PLAYER'), input('NAME'), input('VALUE')], tooltip: 'A per-player cloud variable (☁ 👤): only that player sees it, and it is saved to their account', extensions: ['shape_statement']}],
    ['dimodserver_changeplayercloud', 'cloud', {message0: 'change %1 \'s cloud %2 by %3', args0: [input('PLAYER'), input('NAME'), input('VALUE')], extensions: ['shape_statement']}],
    ['dimodserver_getplayercloud', 'cloud', {message0: '%1 \'s cloud %2', args0: [input('PLAYER'), input('NAME')], tooltip: 'A player\'s own value of a per-player cloud variable (☁ 👤)', extensions: ['output_string']}],
    ['dimodserver_save', 'cloud', {message0: 'save %1 as %2', args0: [input('VALUE'), input('KEY')], extensions: ['shape_statement']}],
    ['dimodserver_saved', 'cloud', {message0: 'saved value %1', args0: [input('KEY')], extensions: ['output_string']}],
    ['dimodserver_deletesaved', 'cloud', {message0: 'delete saved value %1', args0: [input('KEY')], extensions: ['shape_statement']}],
    ['dimodserver_savednames', 'cloud', {message0: 'names of saved values', extensions: ['output_string']}],
    ['dimodserver_changesaved', 'cloud', {message0: 'change saved value %1 by %2', args0: [input('KEY'), input('VALUE')], extensions: ['shape_statement']}],
    ['dimodserver_savedor', 'cloud', {message0: 'saved value %1 or %2 if not saved', args0: [input('KEY'), input('DEFAULT')], extensions: ['output_string']}],
    ['dimodserver_hassaved', 'cloud', {message0: '%1 is saved?', args0: [input('KEY')], extensions: ['output_boolean']}],
    ['dimodserver_dbset', 'database', {message0: 'set database key %1 to %2', args0: [input('KEY'), input('VALUE')], tooltip: 'Saved until you change it, even when everyone leaves. Values can be text, numbers, lists or objects', extensions: ['shape_statement']}],
    ['dimodserver_dbchange', 'database', {message0: 'change database key %1 by %2', args0: [input('KEY'), input('VALUE')], extensions: ['shape_statement']}],
    ['dimodserver_dbdelete', 'database', {message0: 'delete database key %1', args0: [input('KEY')], extensions: ['shape_statement']}],
    ['dimodserver_dbget', 'database', {message0: 'database key %1', args0: [input('KEY')], extensions: ['output_string']}],
    ['dimodserver_dbgetor', 'database', {message0: 'database key %1 or %2 if missing', args0: [input('KEY'), input('DEFAULT')], extensions: ['output_string']}],
    ['dimodserver_dbhas', 'database', {message0: 'database has key %1?', args0: [input('KEY')], extensions: ['output_boolean']}],
    ['dimodserver_dbkeys', 'database', {message0: 'database keys starting with %1', args0: [input('PREFIX')], tooltip: 'A list of keys, e.g. every key starting with "player:"', extensions: ['output_string']}],
    ['dimodserver_dbsize', 'database', {message0: 'database MB used', tooltip: 'Out of 50 MB', extensions: ['output_number']}],
    ['dimodserver_log', 'cloud', {message0: 'log %1', args0: [input('VALUE')], extensions: ['shape_statement']}],
    ['dimodserver_every', 'control', {message0: 'every %1 seconds', args0: [input('SECONDS')], message1: '%1', args1: [substack], extensions: ['shape_statement']}],
    ['dimodserver_after', 'control', {message0: 'after %1 seconds', args0: [input('SECONDS')], message1: '%1', args1: [substack], extensions: ['shape_statement']}],
    ['dimodserver_foreach', 'control', {message0: 'for each %1 in %2', args0: [input('ITEM'), input('LIST')], message1: '%1', args1: [substack], extensions: ['shape_statement']}],
    ['dimodserver_count', 'control', {message0: 'for %1 from %2 to %3', args0: [input('INDEX'), input('FROM'), input('TO')], message1: '%1', args1: [substack], tooltip: 'Counts up (or down) one at a time, including both ends', extensions: ['shape_statement']}],
    ['dimodserver_index', 'control', {message0: 'index', canDragDuplicate: true, extensions: ['output_number']}],
    ['dimodserver_stoptimers', 'control', {message0: 'stop all timers', tooltip: 'Cancels every "every" and "after" that hasn\'t finished', extensions: ['shape_statement']}],
    ['dimodserver_break', 'control', {message0: 'stop this loop', extensions: ['shape_statement']}],
    ['dimodserver_stop', 'control', {message0: 'stop this script', extensions: ['shape_end']}],
    ['dimodserver_ifelse', 'operators', {message0: 'if %1 then %2 else %3', args0: [{type: 'input_value', name: 'CONDITION', check: 'Boolean'}, input('THEN'), input('ELSE')], extensions: ['output_string']}],
    ['dimodserver_min', 'operators', {message0: 'min of %1 and %2', args0: [input('NUM1'), input('NUM2')], extensions: ['output_number']}],
    ['dimodserver_max', 'operators', {message0: 'max of %1 and %2', args0: [input('NUM1'), input('NUM2')], extensions: ['output_number']}],
    ['dimodserver_split', 'operators', {message0: 'split %1 by %2', args0: [input('TEXT'), input('SEPARATOR')], extensions: ['output_string']}],
    ['dimodserver_joinlist', 'operators', {message0: 'join %1 with %2', args0: [input('LIST'), input('SEPARATOR')], extensions: ['output_string']}],
    ['dimodserver_replace', 'operators', {message0: 'replace %1 with %2 in %3', args0: [input('FIND'), input('REPLACE'), input('TEXT')], extensions: ['output_string']}],
    ['dimodserver_case', 'operators', {message0: '%1 in %2', args0: [input('TEXT'), {type: 'field_dropdown', name: 'CASE', options: [['UPPERCASE', 'upper'], ['lowercase', 'lower']]}], extensions: ['output_string']}],
    ['dimodserver_now', 'operators', {message0: 'current time in ms', extensions: ['output_number']}],
    ['dimodserver_currentdate', 'operators', {message0: 'current %1', args0: [{type: 'field_dropdown', name: 'PART', options: [['year', 'year'], ['month', 'month'], ['date', 'date'], ['day of week', 'day'], ['hour', 'hour'], ['minute', 'minute'], ['second', 'second']]}], extensions: ['output_number']}],
    ['dimodserver_secondssince', 'operators', {message0: 'seconds since %1', args0: [input('TIME')], tooltip: 'Use with "current time in ms" for cooldowns and round timers', extensions: ['output_number']}],
    ['dimodserver_roundto', 'operators', {message0: 'round %1 to %2 decimal places', args0: [input('NUM'), input('PLACES')], extensions: ['output_number']}],
    ['dimodserver_clamp', 'operators', {message0: 'limit %1 between %2 and %3', args0: [input('NUM'), input('MIN'), input('MAX')], extensions: ['output_number']}],
    ['dimodserver_distance', 'operators', {message0: 'distance from x: %1 y: %2 to x: %3 y: %4', args0: [input('X1'), input('Y1'), input('X2'), input('Y2')], extensions: ['output_number']}],
    ['dimodserver_startswith', 'operators', {message0: '%1 starts with %2?', args0: [input('TEXT'), input('PREFIX')], extensions: ['output_boolean']}],
    ['dimodserver_endswith', 'operators', {message0: '%1 ends with %2?', args0: [input('TEXT'), input('SUFFIX')], extensions: ['output_boolean']}],
    ['dimodserver_letters', 'operators', {message0: 'letters %1 to %2 of %3', args0: [input('FROM'), input('TO'), input('TEXT')], extensions: ['output_string']}],
    ['dimodserver_trim', 'operators', {message0: 'trim spaces from %1', args0: [input('TEXT')], extensions: ['output_string']}],
    ['dimodserver_uniqueid', 'operators', {message0: 'new unique id', tooltip: 'A random id, handy for matches and items', extensions: ['output_string']}],
    ['dimodserver_newobject', 'objects', {message0: 'new object', extensions: ['output_string']}],
    ['dimodserver_newlist', 'objects', {message0: 'new list', extensions: ['output_string']}],
    ['dimodserver_getitem', 'objects', {message0: 'item %1 of %2', args0: [input('KEY'), input('OBJECT')], extensions: ['output_string']}],
    ['dimodserver_setitem', 'objects', {message0: 'set item %1 of %2 to %3', args0: [input('KEY'), input('OBJECT'), input('VALUE')], extensions: ['shape_statement']}],
    ['dimodserver_removeitem', 'objects', {message0: 'remove item %1 of %2', args0: [input('KEY'), input('OBJECT')], extensions: ['shape_statement']}],
    ['dimodserver_additem', 'objects', {message0: 'add %1 to %2', args0: [input('VALUE'), input('LIST')], extensions: ['shape_statement']}],
    ['dimodserver_hasitem', 'objects', {message0: '%1 has item %2?', args0: [input('OBJECT'), input('KEY')], extensions: ['output_boolean']}],
    ['dimodserver_length', 'objects', {message0: 'length of %1', args0: [input('OBJECT')], extensions: ['output_number']}],
    ['dimodserver_names', 'objects', {message0: 'names in %1', args0: [input('OBJECT')], extensions: ['output_string']}],
    ['dimodserver_values', 'objects', {message0: 'values in %1', args0: [input('OBJECT')], extensions: ['output_string']}],
    ['dimodserver_contains', 'objects', {message0: '%1 contains %2?', args0: [input('LIST'), input('VALUE')], extensions: ['output_boolean']}],
    ['dimodserver_indexof', 'objects', {message0: 'position of %1 in %2', args0: [input('VALUE'), input('LIST')], extensions: ['output_number']}],
    ['dimodserver_randomitem', 'objects', {message0: 'random item of %1', args0: [input('LIST')], extensions: ['output_string']}],
    ['dimodserver_sort', 'objects', {message0: '%1 sorted %2', args0: [input('LIST'), {type: 'field_dropdown', name: 'ORDER', options: [['low to high', 'asc'], ['high to low', 'desc']]}], extensions: ['output_string']}],
    ['dimodserver_sortby', 'objects', {message0: '%1 sorted by item %2 %3', args0: [input('LIST'), input('KEY'), dropdown('ORDER', [['high to low', 'desc'], ['low to high', 'asc']])], tooltip: 'Sorts a list of objects, like a leaderboard sorted by score', extensions: ['output_string']}],
    ['dimodserver_slice', 'objects', {message0: 'items %1 to %2 of %3', args0: [input('FROM'), input('TO'), input('LIST')], tooltip: 'Part of a list, like the top 10', extensions: ['output_string']}],
    ['dimodserver_shuffle', 'objects', {message0: '%1 shuffled', args0: [input('LIST')], extensions: ['output_string']}],
    ['dimodserver_aggregate', 'objects', {message0: '%1 of %2', args0: [dropdown('OP', [['sum', 'sum'], ['average', 'average'], ['lowest', 'min'], ['highest', 'max']]), input('LIST')], extensions: ['output_number']}],
    ['dimodserver_insertitem', 'objects', {message0: 'insert %1 at %2 of %3', args0: [input('VALUE'), input('INDEX'), input('LIST')], extensions: ['shape_statement']}],
    ['dimodserver_copy', 'objects', {message0: 'copy of %1', args0: [input('VALUE')], extensions: ['output_string']}],
    ['dimodserver_readjson', 'objects', {message0: 'read JSON %1', args0: [input('TEXT')], extensions: ['output_string']}],
    ['dimodserver_tojson', 'objects', {message0: '%1 as JSON', args0: [input('VALUE')], extensions: ['output_string']}],
    ['dimodserver_typeof', 'objects', {message0: 'type of %1', args0: [input('VALUE')], extensions: ['output_string']}]
];
const SERVER_OPCODES = new Set(BLOCKS.map(([opcode]) => opcode));
const defineServerBlocks = ScratchBlocks => {
    for (const [opcode, category, json] of BLOCKS) {
        const [colour, colourSecondary, colourTertiary] = COLOURS[category];
        const shape = FILL_INS[opcode] ? {output: null, outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND, extensions: []} : {};
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(Object.assign({id: opcode, colour, colourSecondary, colourTertiary}, json, shape));
            }
        };
    }
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const text = (name, value = '') => `<value name="${name}"><shadow type="text"><field name="TEXT">${esc(value)}</field></shadow></value>`;
const num = (name, value) => `<value name="${name}"><shadow type="math_number"><field name="NUM">${value}</field></shadow></value>`;
const fill = (name, type) => `<value name="${name}"><shadow type="${type}"/></value>`;
const bool = name => `<value name="${name}"></value>`;
const sep = '<sep gap="36"/>';
const cat = (name, id, [colour, secondary], body, extra = '') =>
    `<category name="${name}" id="${id}" colour="${colour}" secondaryColour="${secondary}"${extra}>${body}</category>`;
const serverToolboxXML = () => `<xml style="display: none">
    ${cat('Server', 'dimodServerEvents', COLOURS.server, `
        <block type="dimodserver_whenstarts"/>
        <block type="dimodserver_whenconnects">${fill('PLAYER', 'dimodserver_player')}</block>
        <block type="dimodserver_whendisconnects">${fill('PLAYER', 'dimodserver_player')}</block>
        ${sep}
        <block type="dimodserver_whensends">${fill('PLAYER', 'dimodserver_player')}${fill('DATA', 'dimodserver_data')}</block>
        ${sep}
        <block type="dimodserver_whenasks">${fill('PLAYER', 'dimodserver_player')}${fill('QUESTION', 'dimodserver_question')}</block>
        <block type="dimodserver_respond">${text('DATA', '')}</block>
        ${sep}
        <block type="dimodserver_whencloud">${fill('PLAYER', 'dimodserver_player')}${text('NAME', 'score')}${fill('VALUE', 'dimodserver_value')}</block>
        <block type="dimodserver_reject"/>
    `)}
    ${cat('Players', 'dimodServerPlayers', COLOURS.players, `
        <block type="dimodserver_send">${text('PLAYER', '')}${text('DATA', 'hello')}</block>
        <block type="dimodserver_sendall">${text('DATA', 'hello')}</block>
        <block type="dimodserver_sendallexcept">${text('PLAYER', '')}${text('DATA', 'hello')}</block>
        <block type="dimodserver_disconnect">${text('PLAYER', '')}${text('REASON', 'cheating')}</block>
        ${sep}
        <block type="dimodserver_players"/>
        <block type="dimodserver_playercount"/>
        <block type="dimodserver_playernamed">${text('NAME', '')}</block>
        <block type="dimodserver_username">${text('PLAYER', '')}</block>
        <block type="dimodserver_loggedin">${text('PLAYER', '')}</block>
        <block type="dimodserver_isguest">${text('PLAYER', '')}</block>
        <block type="dimodserver_isonline">${text('PLAYER', '')}</block>
        <block type="dimodserver_playerid">${text('PLAYER', '')}</block>
        <block type="dimodserver_sameplayer">${text('PLAYER1', '')}${text('PLAYER2', '')}</block>
        ${sep}
        <block type="dimodserver_host"/>
        <block type="dimodserver_playernumber">${num('INDEX', 1)}</block>
        <block type="dimodserver_randomplayer"/>
        <block type="dimodserver_sendeach">${text('LIST', '')}${text('DATA', 'hello')}</block>
        ${sep}
        <label text="Players are split into rooms... this code runs once per room"/>
        <block type="dimodserver_room"/>
    `)}
    ${cat('Cloud', 'dimodServerCloud', COLOURS.cloud, `
        <block type="dimodserver_setcloud">${text('NAME', 'score')}${text('VALUE', '0')}</block>
        <block type="dimodserver_changecloud">${text('NAME', 'score')}${num('VALUE', 1)}</block>
        <block type="dimodserver_getcloud">${text('NAME', 'score')}</block>
        ${sep}
        <label text="Per-player (☁ 👤): each player has their own, saved to their account"/>
        <block type="dimodserver_setplayercloud">${text('PLAYER', '')}${text('NAME', 'coins')}${text('VALUE', '0')}</block>
        <block type="dimodserver_changeplayercloud">${text('PLAYER', '')}${text('NAME', 'coins')}${num('VALUE', 1)}</block>
        <block type="dimodserver_getplayercloud">${text('PLAYER', '')}${text('NAME', 'coins')}</block>
        ${sep}
        <block type="dimodserver_log">${text('VALUE', 'hello')}</block>
    `)}
    ${cat('Database', 'dimodServerDatabase', COLOURS.database, `
        <label text="Saved between sessions, 50 MB per game"/>
        <block type="dimodserver_dbset">${text('KEY', 'high score')}${text('VALUE', '0')}</block>
        <block type="dimodserver_dbchange">${text('KEY', 'games played')}${num('VALUE', 1)}</block>
        <block type="dimodserver_dbdelete">${text('KEY', 'high score')}</block>
        ${sep}
        <block type="dimodserver_dbget">${text('KEY', 'high score')}</block>
        <block type="dimodserver_dbgetor">${text('KEY', 'high score')}${text('DEFAULT', '0')}</block>
        <block type="dimodserver_dbhas">${text('KEY', 'high score')}</block>
        <block type="dimodserver_dbkeys">${text('PREFIX', 'player:')}</block>
        <block type="dimodserver_dbsize"/>
    `)}
    ${cat('Control', 'dimodServerControl', COLOURS.control, `
        <block type="dimodserver_every">${num('SECONDS', 1)}</block>
        <block type="dimodserver_after">${num('SECONDS', 3)}</block>
        ${sep}
        <block type="control_if">${bool('CONDITION')}</block>
        <block type="control_if_else">${bool('CONDITION')}</block>
        <block type="control_repeat">${num('TIMES', 10)}</block>
        <block type="control_repeat_until">${bool('CONDITION')}</block>
        <block type="control_while">${bool('CONDITION')}</block>
        <block type="dimodserver_foreach">${fill('ITEM', 'dimodserver_item')}${text('LIST', '')}</block>
        <block type="dimodserver_count">${fill('INDEX', 'dimodserver_index')}${num('FROM', 1)}${num('TO', 10)}</block>
        <block type="dimodserver_break"/>
        <block type="dimodserver_stop"/>
        ${sep}
        <block type="dimodserver_stoptimers"/>
    `)}
    ${cat('Operators', 'dimodServerOperators', COLOURS.operators, `
        <block type="operator_add">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="operator_subtract">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="operator_multiply">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="operator_divide">${num('NUM1', '')}${num('NUM2', '')}</block>
        ${sep}
        <block type="operator_random">${num('FROM', 1)}${num('TO', 10)}</block>
        ${sep}
        <block type="operator_gt">${text('OPERAND1', '')}${text('OPERAND2', '50')}</block>
        <block type="operator_lt">${text('OPERAND1', '')}${text('OPERAND2', '50')}</block>
        <block type="operator_equals">${text('OPERAND1', '')}${text('OPERAND2', '50')}</block>
        ${sep}
        <block type="operator_and"/>
        <block type="operator_or"/>
        <block type="operator_not"/>
        ${sep}
        <block type="operator_join">${text('STRING1', 'apple ')}${text('STRING2', 'banana')}</block>
        <block type="operator_letter_of">${num('LETTER', 1)}${text('STRING', 'apple')}</block>
        <block type="operator_length">${text('STRING', 'apple')}</block>
        <block type="operator_contains">${text('STRING1', 'apple')}${text('STRING2', 'a')}</block>
        ${sep}
        <block type="operator_mod">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="operator_round">${num('NUM', '')}</block>
        <block type="operator_mathop">${num('NUM', '')}</block>
        <block type="dimodserver_roundto">${num('NUM', 3.14159)}${num('PLACES', 2)}</block>
        <block type="dimodserver_min">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="dimodserver_max">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="dimodserver_clamp">${num('NUM', '')}${num('MIN', 0)}${num('MAX', 100)}</block>
        <block type="dimodserver_distance">${num('X1', 0)}${num('Y1', 0)}${num('X2', 30)}${num('Y2', 40)}</block>
        <block type="dimodserver_ifelse">${text('THEN', 'yes')}${text('ELSE', 'no')}</block>
        ${sep}
        <block type="dimodserver_split">${text('TEXT', 'a,b,c')}${text('SEPARATOR', ',')}</block>
        <block type="dimodserver_joinlist">${text('LIST', '')}${text('SEPARATOR', ', ')}</block>
        <block type="dimodserver_replace">${text('FIND', 'a')}${text('REPLACE', 'b')}${text('TEXT', 'banana')}</block>
        <block type="dimodserver_case">${text('TEXT', 'Hello')}</block>
        <block type="dimodserver_letters">${num('FROM', 1)}${num('TO', 3)}${text('TEXT', 'apple')}</block>
        <block type="dimodserver_trim">${text('TEXT', '  apple  ')}</block>
        <block type="dimodserver_startswith">${text('TEXT', 'apple')}${text('PREFIX', 'a')}</block>
        <block type="dimodserver_endswith">${text('TEXT', 'apple')}${text('SUFFIX', 'e')}</block>
        ${sep}
        <block type="dimodserver_now"/>
        <block type="dimodserver_secondssince">${num('TIME', '')}</block>
        <block type="dimodserver_currentdate"/>
        <block type="dimodserver_uniqueid"/>
    `)}
    ${cat('Objects', 'dimodServerObjects', COLOURS.objects, `
        <block type="dimodserver_newobject"/>
        <block type="dimodserver_newlist"/>
        ${sep}
        <block type="dimodserver_getitem">${text('KEY', 'x')}${text('OBJECT', '')}</block>
        <block type="dimodserver_setitem">${text('KEY', 'x')}${text('OBJECT', '')}${text('VALUE', '0')}</block>
        <block type="dimodserver_removeitem">${text('KEY', 'x')}${text('OBJECT', '')}</block>
        <block type="dimodserver_additem">${text('VALUE', 'thing')}${text('LIST', '')}</block>
        <block type="dimodserver_hasitem">${text('OBJECT', '')}${text('KEY', 'x')}</block>
        <block type="dimodserver_length">${text('OBJECT', '')}</block>
        <block type="dimodserver_names">${text('OBJECT', '')}</block>
        <block type="dimodserver_values">${text('OBJECT', '')}</block>
        ${sep}
        <block type="dimodserver_contains">${text('LIST', '')}${text('VALUE', 'thing')}</block>
        <block type="dimodserver_indexof">${text('VALUE', 'thing')}${text('LIST', '')}</block>
        <block type="dimodserver_randomitem">${text('LIST', '')}</block>
        <block type="dimodserver_insertitem">${text('VALUE', 'thing')}${num('INDEX', 1)}${text('LIST', '')}</block>
        ${sep}
        <block type="dimodserver_sort">${text('LIST', '')}</block>
        <block type="dimodserver_sortby">${text('LIST', '')}${text('KEY', 'score')}</block>
        <block type="dimodserver_slice">${num('FROM', 1)}${num('TO', 10)}${text('LIST', '')}</block>
        <block type="dimodserver_shuffle">${text('LIST', '')}</block>
        <block type="dimodserver_aggregate">${text('LIST', '')}</block>
        <block type="dimodserver_copy">${text('VALUE', '')}</block>
        ${sep}
        <block type="dimodserver_readjson">${text('TEXT', '{"x": 1}')}</block>
        <block type="dimodserver_tojson">${text('VALUE', '')}</block>
        <block type="dimodserver_typeof">${text('VALUE', '')}</block>
    `)}
    <category name="%{BKY_CATEGORY_VARIABLES}" id="variables" colour="#FF8C1A" secondaryColour="#DB6E00" custom="VARIABLE"></category>
    <category name="%{BKY_CATEGORY_MYBLOCKS}" id="myBlocks" colour="#FF6680" secondaryColour="#FF4D6A" custom="PROCEDURE"></category>
</xml>`;
export {FILL_INS, OPCODES, SERVER_OPCODES, clientCategoryXML, defineClientBlocks, defineServerBlocks, installClientBlocksVM, isDimodClientOpcode, serverToolboxXML};
