import JSZip from 'jszip';

const CLIENT_BLOCK_PREFIX = 'event_dimod_';

const readProjectJSON = async (buffer) => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file('project.json');
    if (!file) return null;
    return JSON.parse(await file.async('string'));
  }
  if (bytes[0] === 0x7b) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return null;
};

export const inspectProject = async (buffer) => {
  const result = {cloud: false, reasons: [], notes: []};
  let json;
  try {
    json = await readProjectJSON(buffer);
  } catch (e) {
    return result;
  }
  if (!json || typeof json !== 'object') return result;

  if (json.dimodServer && typeof json.dimodServer === 'object') {
    result.reasons.push('It has server code (the Server tab).');
  }

  let clientBlocks = 0;
  let usesWorldServer = false;
  for (const target of json.targets || []) {
    for (const id of Object.keys(target.blocks || {})) {
      const block = target.blocks[id];
      if (block && typeof block.opcode === 'string' && block.opcode.startsWith(CLIENT_BLOCK_PREFIX)) clientBlocks++;
    }
    if (target.extensionData && JSON.stringify(target.extensionData).includes('world.server')) usesWorldServer = true;
  }
  if (clientBlocks) {
    result.reasons.push(`It has ${clientBlocks} Client block${clientBlocks === 1 ? '' : 's'} (they talk to the game server).`);
  }
  if (json.extensionData && JSON.stringify(json.extensionData).includes('world.server')) usesWorldServer = true;
  if (usesWorldServer) {
    result.notes.push('Some complex sprite code uses world.server. There is no game server outside Dimod, so it will be offline: connected is false, send() does nothing and ask() answers null.');
  }

  result.cloud = result.reasons.length > 0;
  return result;
};

export const CLOUD_MESSAGE = 'This is a cloud project, and cloud projects can\'t be packaged: their server code and database run on Dimod\'s game server, which a packaged project can\'t reach.';
