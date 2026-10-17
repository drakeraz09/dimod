import { isSelectTool, updateSelectTool } from "./updateSelectTool.js";
import { enable, disable, loadSettings, setGuideColor, toggle } from "./state.js";
import { initUI } from "./ui.js";
import { updateScaleTool } from "./updateScaleTool.js";

const SELECT_TOOL_POLL_MS = 500;

/** @type {(api: import("../../addon-api/content-script/typedef").UserscriptUtilities) => Promise<void>} */
export default async function (api) {
  const { addon } = api;
  addon.self.addEventListener("disabled", disable);
  addon.self.addEventListener("reenabled", enable);
  loadSettings(addon);
  const paper = await addon.tab.traps.getPaper();

  toggle(addon.settings.get("enable-default"));
  setGuideColor(addon.settings.get("guide-color"));
  addon.settings.addEventListener("change", () => setGuideColor(addon.settings.get("guide-color")));

  let patched = false;
  const patchSelectTool = () => {
    if (patched) return true;
    const tool = paper.tools.find(isSelectTool);
    if (!tool) return false;
    patched = true;
    updateSelectTool(paper, tool);
    updateScaleTool(paper, tool);
    return true;
  };

  const foundImmediately = patchSelectTool();
  initUI(api);
  if (!foundImmediately) {
    const poll = setInterval(() => {
      if (patchSelectTool()) clearInterval(poll);
    }, SELECT_TOOL_POLL_MS);
    addon.self.addEventListener("disabled", () => clearInterval(poll));
  }
}
