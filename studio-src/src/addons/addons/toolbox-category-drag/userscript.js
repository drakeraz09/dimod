// Toolbox Category Drag
// By: SharkPool
export default async function ({ addon }) {
    // wait for scratchblocks to be defined
    await addon.tab.traps.getBlockly();

    const COMMENT_TRAPPER_ID = "--Category_Order_ADDON-config";
    const soup = "!#%()*+,-./:;=?@[]^_`{|}~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    
    let categoryOrdering = undefined;
    
    const genUID = () => {
        const id = [];
        for (let i = 0; i < 20; i++) {
            id[i] = soup.charAt(Math.random() * soup.length);
        }
        return id.join("");
    }
    
    const createSep = () => {
        const sep = document.createElement("sep");
        sep.setAttribute("gap", "36");
        return sep;
    };
    
    const extractCategoryID = (classList) => {
        for (const text of classList) {
            if (text.startsWith("scratchCategoryId-")) return text.replace("scratchCategoryId-", "");
        }
        return undefined;
    }
    
    const ogPopulate = ScratchBlocks.Toolbox.CategoryMenu.prototype.populate;
    ScratchBlocks.Toolbox.CategoryMenu.prototype.populate = function (...args) {
        if (!categoryOrdering) {
            ogPopulate.call(this, ...args);
            return;
        }
        
        const toolboxXml = args[0];
        const children = Array.from(toolboxXml.children);
        const categories = children.filter(e => e.tagName === "category");
        
        /* sort categories based on categoryOrdering */
        categories.sort((a, b) => {
            const aIndex = categoryOrdering.indexOf(a.getAttribute("id"));
            const bIndex = categoryOrdering.indexOf(b.getAttribute("id"));
            return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        });
        
        while (toolboxXml.firstChild) toolboxXml.removeChild(toolboxXml.firstChild);
        
        /* <sep> + <category> + <sep> + ... + <category> + <sep> */
        toolboxXml.appendChild(createSep());
        categories.forEach((cat) => {
            toolboxXml.appendChild(cat);
            toolboxXml.appendChild(createSep());
        });
        
        ogPopulate.call(this, ...args);
    };
    
    const ogSaveJSON = vm.toJSON;
    vm.toJSON = function (...args) {
        if (categoryOrdering !== undefined) saveOrdering();
        return ogSaveJSON.call(this, ...args);
    }
    
    vm.runtime.on("PROJECT_LOADED", () => {
        const storedOrder = findOrderingComment(true);
        if (storedOrder) {
            try {
                categoryOrdering = JSON.parse(storedOrder);
                setTimeout(forceRefreshToolbox, 100);
            } catch {
                // Blockly might not be availiable, wait until it is
                vm.once("workspaceUpdate", () => {
                    try {
                        categoryOrdering = JSON.parse(storedOrder);
                        setTimeout(forceRefreshToolbox, 100);
                    } catch {}
                });
            }
        }
    });
    
    function findOrderingComment(optParse) {
        const stageTarget = vm.runtime.getTargetForStage();
        if (!stageTarget) return undefined;
        
        let configComment;
        const comments = Object.values(stageTarget.comments);
        for (const comment of comments) {
            if (comment.text.endsWith(COMMENT_TRAPPER_ID)) {
                configComment = comment.text;
                break;
            }
        }
        
        if (configComment) {
            if (!optParse) return true;

            const dataLine = configComment.split("\n").find(i => i.endsWith(COMMENT_TRAPPER_ID));
            if (!dataLine) return undefined;
            return dataLine.substr(0, dataLine.length - COMMENT_TRAPPER_ID.length);
        }
        return optParse ? undefined : false;
    }
    
    function saveOrdering() {
        if (findOrderingComment()) return;
        
        const stageTarget = vm.runtime.getTargetForStage();
        if (!stageTarget) return;
        
        const text = `Configuration for 'Category Ordering' Addon\nYou can move, resize, and minimize this comment, but don't edit it by hand. This comment can be deleted to remove the stored settings.\n${JSON.stringify(categoryOrdering)}${COMMENT_TRAPPER_ID}`;
        stageTarget.createComment(genUID(), null, text, 50, 50, 350, 170, false);
        vm.runtime.emitProjectChanged();
    }
    
    function compileNewOrder(htmlCategoryList) {
        const orderedIDs = [];
        for (const cat of htmlCategoryList) {
            const id = extractCategoryID(cat.firstChild.classList);
            if (id) orderedIDs.push(id);
        }
        categoryOrdering = orderedIDs;
    }
    
    function forceRefreshToolbox() {
        const workspace = ScratchBlocks.getMainWorkspace();
        const toolbox = workspace.getToolbox();
        if (!toolbox) return;
        const categoryMenu = toolbox.categoryMenu_;
        if (!categoryMenu) return;
        if (categoryMenu.secondTable) return;
        
        categoryMenu.dispose();
        categoryMenu.createDom();
        toolbox.populate_(workspace.options.languageTree);
        toolbox.position();
    }
    
    function initDragDroper(clickEvent, blocklyToolboxDiv) {
        const draggedCat = clickEvent.target.closest(`div[class="scratchCategoryMenuRow"]`);
        if (!draggedCat) return;

        const rows = Array.from(blocklyToolboxDiv.querySelectorAll(`div[class*="scratchCategoryMenuRow"]`));
        const others = rows.filter(r => r !== draggedCat);
        const from = rows.indexOf(draggedCat);
        const rect = draggedCat.getBoundingClientRect();
        const h = rect.height;
        const offsetX = clickEvent.clientX - rect.left;
        const offsetY = clickEvent.clientY - rect.top;

        const dragger = draggedCat.cloneNode(true);
        draggedCat.style.opacity = 0.35;
        dragger.setAttribute("style", `position: fixed; z-index: 99999; left: 0; top: 0; width: ${rect.width}px; pointer-events: none; will-change: transform; transform: translate3d(${rect.left}px, ${rect.top}px, 0) scale(1.06); transition: none;`);
        dragger.firstChild.setAttribute("style", `box-shadow: 0 6px 16px rgba(0,0,0,.35); border-radius: 8px;`);
        dragger.dataset.dragger = true;
        document.body.appendChild(dragger);
        for (const r of rows) if (r !== draggedCat) r.style.transition = "transform .14s cubic-bezier(.2,.8,.3,1)";

        let mx = clickEvent.clientX, my = clickEvent.clientY, ins = from, raf = 0;
        const centers = others.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 + blocklyToolboxDiv.scrollTop; });

        const frame = () => {
            raf = 0;
            const bounds = blocklyToolboxDiv.getBoundingClientRect();
            const zone = 48;
            let speed = 0;
            if (my < bounds.top + zone) speed = -Math.ceil((bounds.top + zone - my) / 4);
            else if (my > bounds.bottom - zone) speed = Math.ceil((my - (bounds.bottom - zone)) / 4);
            if (speed) blocklyToolboxDiv.scrollTop += Math.max(-18, Math.min(18, speed));
            dragger.style.transform = `translate3d(${mx - offsetX}px, ${my - offsetY}px, 0) scale(1.06)`;

            const y = my + blocklyToolboxDiv.scrollTop;
            let n = 0;
            while (n < centers.length && centers[n] < y) n++;
            if (n !== ins) {
                ins = n;
                const order = others.slice();
                order.splice(ins, 0, draggedCat);
                order.forEach((r, i) => {
                    if (r === draggedCat) return;
                    const old = rows.indexOf(r);
                    r.style.transform = old === i ? "" : `translateY(${(i - old) * h}px)`;
                });
            }
            if (speed) raf = requestAnimationFrame(frame);
        };
        const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };
        schedule();

        const onMouseMove = (e) => { mx = e.clientX; my = e.clientY; schedule(); };
        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            cancelAnimationFrame(raf);
            for (const r of rows) { r.style.transition = "none"; r.style.transform = ""; }
            draggedCat.style.opacity = "";
            dragger.remove();
            setTimeout(() => { for (const r of rows) r.style.transition = ""; }, 50);
            const eat = e => { e.stopPropagation(); e.preventDefault(); };
            window.addEventListener("click", eat, true);
            setTimeout(() => window.removeEventListener("click", eat, true), 80);

            if (ins !== from) {
                const id = extractCategoryID(draggedCat.firstChild.classList);
                if (ins >= others.length) others[others.length - 1].after(draggedCat);
                else draggedCat.parentNode.insertBefore(draggedCat, others[ins]);
                compileNewOrder(blocklyToolboxDiv.querySelectorAll(`div[class*="scratchCategoryMenuRow"]`));
                setTimeout(() => {
                    forceRefreshToolbox();
                    if (id) ScratchBlocks.mainWorkspace.toolbox_.setSelectedCategoryById(id);
                }, 60);
            }
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    function activateBlocklyListener() {
        const blocklyToolboxDiv = document.querySelector(`div[class*="blocklyToolboxDiv"`);
        if (!blocklyToolboxDiv) return;
        blocklyToolboxDiv.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            const sx = e.clientX, sy = e.clientY;
            let done = false;
            const start = () => { if (done) return; done = true; stop(); initDragDroper(e, blocklyToolboxDiv); };
            const timer = setTimeout(start, 300);
            const move = (m) => { if (Math.hypot(m.clientX - sx, m.clientY - sy) > 6) { clearTimeout(timer); start(); } };
            const stop = () => { clearTimeout(timer); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", stop); };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", stop);
        });
    }

    let wasInEditor, inEditor;
    ReduxStore.subscribe(() => {
        const state = ReduxStore.getState().scratchGui;

        wasInEditor = inEditor;
        inEditor = !state.mode.isPlayerOnly;
        if (inEditor && !wasInEditor) {
            wasInEditor = inEditor;
            queueMicrotask(activateBlocklyListener);
        }
    });
}
