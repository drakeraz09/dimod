export default async function ({addon}) {
  const set = on => addon.tab.redux.dispatch({type: "scratch-paint/dimod-view/SET_VIEW_OPTION", key: "gridAddon", value: on});
  set(true);
  addon.self.addEventListener("disabled", () => set(false));
  addon.self.addEventListener("reenabled", () => set(true));
}
