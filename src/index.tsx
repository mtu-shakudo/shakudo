/**
 * Elijah Cobb
 * elijah@elijahcobb.com
 * elijahcobb.com
 * github.com/elijahjcobb
 */

/**
 * Imports
 */
import CodeMirror from "codemirror";
import {BlocklyParse} from "./BlocklyParser";
import {alloyToBlocksXml, AlloyParseError} from "./AlloyToBlocks";
import Blockly from "blockly";
import { mountCrucible } from "./crucible/mount";
import { mountProjectSwitcher } from "./projects/mount";
import {setupBlocks, setupToolboxContents, setupToolboxWorkspace, Alloy, op_internal_translate,
					binding_blocks, set_op_blocks,  quant_list, un_op_list, bin_op_list, compare_op_list, set_bin_op_list,
					readingOrder, generateTabCode} from "./alloy_generator"


/**
 * Importing Styles.
 */
import "./index.css";
import "codemirror/lib/codemirror.css";
import "codemirror/addon/selection/mark-selection.js"
import "codemirror/theme/nord.css";

// this isn't great practice, but Electron demands some replacement for prompt()
//    and it's actually recommended in the Blockly code to replace this
// this exists particularly for the sake of 'create variable' in alloy_generator
Blockly.prompt = function(msg, defaultValue, callback) {
	ipcRenderer.invoke("get-open-prompt", { title: "Shakudo", label: msg, value: defaultValue }).catch(console.error).then((r) => {
		callback(r ?? null);
	});
};



const ipcRenderer = window.require("electron").ipcRenderer;

/**
 * Hide the alert.
 */
function hideAlert() {
	const alert = document.getElementById("alert");
	if (!alert) return;
	alert.style.display = "none";
}
/**
 * Show an alert with a specific message.
 * @param message
 */
function showAlert(message: string) {

	const alertContent = document.getElementById("alert-content");
	if (!alertContent) return;
	alertContent.innerHTML = message;

	const alert = document.getElementById("alert");
	if (!alert) return;
	alert.style.display = "flex";
}
/**
 * Initialize the alert.
 */
function setupAlert() {
	const alertElement = document.getElementById("alert");
	if (!alertElement) return;
	alertElement.style.display = "none";
	alertElement.onclick = () => {
		hideAlert();
	};
}



var currentParse: BlocklyParse;
var selected_index: number = -1;
// base: fingerprint of the tab's Alloy when its blocks last matched it (loaded or compiled); saved with the blocks.
// warned: root blocks carrying the "Only one root block allowed!" warning.
type TabWorkspace = { div: HTMLElement, workspace: Blockly.WorkspaceSvg, block_index: number, title: string, base: string, warned: Blockly.Block[] };
var listBlocklyWorkplaces: TabWorkspace[] = [];
var dirty = false;	// editor has changes not yet saved to the .als

const tabTitle = (b, j: number) => (b.title ? b.title : `Block ${j}`);
// What a tab's toolbox offers; saved blocks are only restored into a tab whose toolbox still matches
const toolboxHidden = (b) => [...currentParse.fileHidden, ...b.hidden];
const toolboxHash = (b) => JSON.stringify([b.fixed_set_names, Object.entries(b.fixed_predicates), Object.entries(b.fixed_predicates_inline), b.allow_multiple, toolboxHidden(b),
	...(Object.keys(b.fixed_var_types).length ? [b.fixed_var_types] : [])]);

// Saved blocks carry the fingerprint of the text they last matched, ahead of the XML
const BASE_RE = /^<!--shakudo-base:([0-9a-z]*)-->/;
const hashText = (text: string) => {
	let h = 5381;
	for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
	return h.toString(36);
};
const regionBase = (lines: string[]) => hashText(BlocklyParse.codeKey(lines));

// The code some blocks write, on a throwaway workspace; null if they don't load
function codeOfXml(xml: string): string | null {
	const ws = new Blockly.Workspace();
	try {
		Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), ws);
		return BlocklyParse.codeKey(generateTabCode(ws).split("\n"));
	} catch (e) {
		return null;
	} finally {
		ws.dispose();
	}
}

/**
 * Which blocks a tab opens with. The text wins, but the saved blocks keep their layout when they mean the same thing,
 * and keep unsaved block work when the text hasn't changed since they last matched it.
 * A text that can't be built from blocks leaves the workspace empty.
 */
function chooseBlocks(w: TabWorkspace, saved: { xml: string } | undefined): string | null {
	const pb = currentParse.locations[w.block_index].b;
	const lines: string[] = pb.textLines;
	w.base = regionBase(lines);
	const m = saved ? saved.xml.match(BASE_RE) : null;
	const savedBase = m ? m[1] : null;
	const savedXml = saved ? saved.xml.replace(BASE_RE, "") : null;

	if (savedXml && savedBase === w.base) return savedXml;		// text unchanged since the blocks matched it
	if (BlocklyParse.codeKey(lines) === "") return savedXml;		// nothing written yet: keep uncompiled blocks
	let parsed: string | null = null;
	try {
		parsed = alloyToBlocksXml(lines, pb);
	} catch (e) {
		const where = e instanceof AlloyParseError ? `line ${e.line + 1}: ` : "";
		console.warn(`[shakudo] ${w.title} can't be built from blocks: ${where}${(e as Error).message}`);
		return savedXml && savedBase === null ? savedXml : null;	// saves from before this keep loading as they did
	}
	if (savedXml && parsed) {
		const a = codeOfXml(savedXml);
		if (a !== null && a === codeOfXml(parsed)) return savedXml;	// same meaning: keep the saved layout
	}
	return parsed;
}

window.onresize = () => {
	if(selected_index !== -1) {
		Blockly.svgResize(listBlocklyWorkplaces[selected_index].workspace);
	}
};

/**
 * This is called when the window is loaded.
 */
window.onload = () => {
	// The popped-out tests window loads this same page: Crucible only, no editor or blocks
	if (window.location.hash === "#tests") {
		document.body.classList.add("tests-window");
		document.getElementById("crucible")?.classList.add("show");
		hideAlert();
		mountCrucible(document.getElementById("crucible-root")!);
		return;
	}

	const editor_div = document.getElementById("editor");
	if (!editor_div) return;
	const editor: CodeMirror.Editor = CodeMirror(editor_div, {
		mode: {name: "javascript"},
		theme: "nord",
		lineNumbers: true,
		lineWrapping: true,
		spellcheck: true,
		smartIndent: true,
		indentUnit: 4,
		indentWithTabs: true,
		// readOnly: "nocursor",
		electricChars: true,

		styleSelectedText: true
	});


	/*   Construct the eeditor window, esp on loading a file */

	setupBlocks();
	currentParse = BlocklyParse.parse("");

	var blocklyDiv_container = document.getElementById("blocklyDiv_container");
	if(!blocklyDiv_container) {throw new Error("Error: blocklyDiv_container not found");}
	var shak_tabs_div = document.getElementById("shak_tabs");
	if(!shak_tabs_div) {throw new Error("Error: shak_tabs not found in doc");}

	function createWorkspace(block_index: number, workspace_index: number) {
		const wrk_div = document.createElement("div");
		wrk_div.id = "blocklyDiv_" + workspace_index;
		wrk_div.classList.add("blocklyDiv");
		wrk_div.hidden = true;
		blocklyDiv_container.appendChild(wrk_div);

		const currBlock = currentParse.locations[block_index].b;
		const toolbox = setupToolboxContents(currBlock, toolboxHidden(currBlock));
		let workspace = Blockly.inject(wrk_div, {
			toolbox: toolbox,
			toolboxPosition: "end",	// palette on the right, away from Crucible in Test view
			renderer: "custom_renderer",
			theme: {
				componentStyles: {
					workspaceBackgroundColour: "#282C34",
					flyoutBackgroundColour: "#21252b",
					toolboxBackgroundColour: "#21252b"
				}
			}
		});
		workspace.setResizesEnabled(false);
		(workspace as any).shakudoHidden = toolboxHidden(currBlock);	// read by the operator dropdowns

		setupToolboxWorkspace(currBlock, workspace);

		const title = tabTitle(currBlock, workspace_index);
		const entry: TabWorkspace = { div: wrk_div, workspace, block_index, title, base: "", warned: [] };
		// keep this tab's blocks in the project; UI events (select, scroll, zoom) don't change them
		workspace.addChangeListener((e) => {
			if (e.isUiEvent) return;
			saveWorkspace(entry);
			if (listBlocklyWorkplaces[selected_index] === entry) schedulePreview();
		});

		listBlocklyWorkplaces.push(entry);
	}

	function saveWorkspace(w: TabWorkspace) {
		const xml = `<!--shakudo-base:${w.base}-->` + Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(w.workspace));
		const metaHash = toolboxHash(currentParse.locations[w.block_index].b);
		ipcRenderer.invoke("crucible:save-workspace", { title: w.title, xml, metaHash }).catch(console.error);
	}

	// Fill each tab with blocks: built from its Alloy text, or its saved blocks (see chooseBlocks).
	// Saved blocks only count for a tab whose toolbox hasn't changed since they were saved.
	function loadWorkspaces(saved: { title: string, xml: string, metaHash: string }[]) {
		for (const w of listBlocklyWorkplaces) {
			const s = saved.find((x) => x.title === w.title && x.metaHash === toolboxHash(currentParse.locations[w.block_index].b));
			const xml = chooseBlocks(w, s);
			if (!xml) continue;
			// Blockly can't measure blocks in a hidden div, so show it while loading
			const wasHidden = w.div.hidden;
			w.div.hidden = false;
			Blockly.svgResize(w.workspace);
			Blockly.Events.disable();
			try {
				Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), w.workspace);
			} catch (e) {
				console.error(`[shakudo] ${w.title}: couldn't load blocks`, e);
				w.workspace.clear();
			} finally {
				Blockly.Events.enable();
				w.div.hidden = wasHidden;
			}
		}
	}

	// this is a HORRIBLE hack and I'm not sure why it works or is needed,
	//   but various permutations of resize, render, etc all failed.
	// upon window size changes -- I'm not sure which but opening dev tools
	//  seemed to trigger it semi-consistently -- then switching tabs,
	//  the other workspace's blocks would all be invisible (though present in
	//  the html). Shifting window size sometimes fixed it, leading to this:
	// (also needed after the blocks were folded away: Blockly keeps the hidden size)
	function forceResize(w: { div: HTMLElement, workspace: Blockly.WorkspaceSvg }) {
		w.div.style.width = '99%';  w.div.style.height = '99%';
		Blockly.svgResize(w.workspace);
		w.div.style.width = '100%';  w.div.style.height = '100%';
		Blockly.svgResize(w.workspace);
	}

	var _int_tab_onclick = function(tab_div) {
		let old_div = shak_tabs_div.children.item(selected_index);
		let new_index = parseInt(tab_div.dataset.workspace_index);
		let old_wrk_div = listBlocklyWorkplaces[selected_index].div;
		let tab_wrk_div = listBlocklyWorkplaces[new_index].div;

		console.assert(document.getElementsByClassName("tab active").length === 1, "Onclick Err: 1");
		console.assert(old_div === shak_tabs_div.getElementsByClassName("tab active")[0], "Onclick Err: 2");
		console.assert(parseInt(old_div.dataset.workspace_index) === selected_index, "Onclick Err: 3" );
		console.assert(selected_index === Array.prototype.indexOf.call(old_div.parentNode.children, old_div), "Onclick Err: 4");
		console.assert(new_index === Array.prototype.indexOf.call(tab_div.parentNode.children, tab_div), "Onclick Err: 5");
		console.assert(old_wrk_div.hidden === false, "Onclick Err: 6");
		if(new_index !== selected_index) {console.assert(tab_wrk_div.hidden === true, "Onclick Err: 7");}

		if(new_index !== selected_index) {
			old_div.classList.remove("active");
			tab_div.classList.add("active");
			old_wrk_div.hidden = true;
			tab_wrk_div.hidden = false;
			selected_index = new_index;
			ipcRenderer.invoke("crucible:set-active-pred", listBlocklyWorkplaces[new_index].title).catch(console.error);

			forceResize(listBlocklyWorkplaces[new_index]);
			schedulePreview();
		}

		const _bli = listBlocklyWorkplaces[selected_index].block_index;
		const _bls = currentParse.locations[_bli].s;
		editor.scrollIntoView({line: Math.max(0,_bls - 6), ch:0});
		editor.setCursor({line: _bls, ch:0});
	};
	function tab_onclick(tab_div) {
		return function() {
			_int_tab_onclick(tab_div);
		};
	}

	function createTab(tabs_div: HTMLElement, block_index: number, workspace_index: number, tab_title: string) {
		const tab_div = document.createElement("div");
		tab_div.className = "tab";
		tab_div.dataset.block_index = block_index;
		tab_div.dataset.workspace_index = workspace_index;	// this should just be n for the nth tab
		tab_div.title = tab_title;	// full name when a long title is cut off
		const tab_span = document.createElement("span");
		tab_span.textContent = tab_title;
		tab_div.appendChild(tab_span);
		tabs_div.appendChild(tab_div);

		tab_div.onclick = tab_onclick(tab_div);
	}

	// MUST be called before using getAllMarks()
	// ALSO MUST do a setCursor(getCursor()) to clear selection, which also counts for some reason
	let extra_mark_list = [];
	let blockMarks: CodeMirror.TextMarker[] = [];	// one per location, so a tab's text can be read without clearing other marks
	function clear_extra_marks() {
		const n = extra_mark_list.length;
		for(let i = n-1; i >= 0; i--) {
			extra_mark_list[i].clear();
		}
		extra_mark_list = [];
	}

	ipcRenderer.on("set", (event: any, message: any, saved?: { activeTab: string | null, workspaces: { title: string, xml: string, metaHash: string }[] }) => {
		currentParse = BlocklyParse.parse(message);
		main_div.classList.remove("blocks-collapsed");	// build the workspaces visible; Blockly can't measure inside a hidden pane
		editor.setValue(currentParse.dispLines.join("\n"));
		dirty = false;
		error_popup_hide();
		no_instance_popup_hide();
		blocklyDiv_container.innerHTML = "";
		listBlocklyWorkplaces = [];
		blockMarks = [];
		const tabs_div = document.createElement("div");

		let i = 0; let j = 0;
		for (const loc of currentParse.locations) {
			let options = { className: "shakudo-block",
											attributes: {
												"data-block-type": (loc.b.editable ? "edit" : "text"),
												"data-block-index": i
											},
											readOnly: !loc.b.editable,
											clearWhenEmpty: false,
											inclusiveLeft: true,
											inclusiveRight: true
										};
			blockMarks[i] = editor.markText({line: loc.s, ch: 0}, {line: loc.s + loc.l - 1, ch: editor.getLine(loc.s+loc.l-1).length}, options);

			if(loc.b.represented) {
				createTab(tabs_div, i, j, tabTitle(loc.b, j));
				createWorkspace(i, j); // should be the jth entry; other could add an index map or something
				++j;
			}

			++i;
		}
		shak_tabs_div.replaceWith(tabs_div);
		tabs_div.className = "tabs"; tabs_div.id = "shak_tabs";
		shak_tabs_div = tabs_div;

		if(j > 0) {
			tabs_div.firstChild.classList.add("active");
			listBlocklyWorkplaces[0].div.hidden = false;
			selected_index = 0;
			Blockly.svgResize(listBlocklyWorkplaces[0].workspace);

			const _bls = currentParse.locations[listBlocklyWorkplaces[0].block_index].s;
			// todo: base on screen size, and maybe use pixels to put roughly to middle of scrn?
			editor.scrollIntoView({line: Math.max(0, _bls - 20), ch:0});
			editor.setCursor({line: _bls, ch:0});

			loadWorkspaces(saved?.workspaces ?? []);
			const reopen = listBlocklyWorkplaces.findIndex((w) => w.title === saved?.activeTab);
			if (reopen > 0) _int_tab_onclick(tabs_div.children.item(reopen));
		}

		applyCollapsed();
		schedulePreview();
		ipcRenderer.invoke("crucible:sync-als", collect_alloy_text()).catch(console.error);
	});

	// A tab's current Alloy text, as it stands in the editor
	function regionLines(block_index: number): string[] {
		const place = blockMarks[block_index]?.find();
		if (!place) return currentParse.locations[block_index].b.textLines;
		return editor.getRange(place.from, place.to).split("\n");
	}

	var collect_alloy_text = (): string => {
		editor.setCursor(editor.getCursor("from"));
		clear_extra_marks();
		let marks = editor.getAllMarks();
		let editorValue = editor.getValue().split("\n");
		for(let i = 0; i < marks.length; ++i) {
			let ffind = marks[i].find();
			let ffrom = ffind["from"]["line"]; let fto = ffind["to"]["line"];
			let iBlk = currentParse.locations[i].b;
			iBlk.textLines = Array(fto+1-ffrom).fill(0).map((_,k) => editorValue[ffrom + k]);
			iBlk.dirty = true;
		}
		currentParse.updateTextLines();
		return currentParse.dispLines.join("\n");
	};

	/*   Save the editor's contents  */
	var get_save_callback = () => {
		collect_alloy_text();
		ipcRenderer.invoke("get-save", currentParse.fullLines.join("\n")).catch(console.error);
		dirty = false;
	};
	ipcRenderer.on("get-save", get_save_callback);

	// Lets main ask about unsaved changes before switching projects
	editor.on("change", (_cm, change) => {
		if (change.origin !== "setValue") dirty = true;
		schedulePreview();	// comments typed into a tab show up in its preview
	});
	(window as any).shakudoIsDirty = () => dirty;
	(window as any).shakudoSaveText = (): string => {
		collect_alloy_text();
		dirty = false;
		return currentParse.fullLines.join("\n");
	};

	// Lets the Crucible code ask for the current .als text
	(window as any).collectAlloyText = collect_alloy_text;

	/*   Compiling blocks -> alloy  */

	var error_popup = document.getElementById("compile_popup");
	var error_popup_content = error_popup.getElementsByClassName("compile_content")[0];
	function error_popup_show(left, top, message) {
		error_popup_content.innerHTML = message;
		error_popup.style.left = left + "px";
		error_popup.style.top = top + "px";
		error_popup.classList.add("show");
	};
	function error_popup_hide() {
		//if(last_error_select !== null) last_error_select.removeSelect();
		error_popup.classList.remove("show");
	};
	error_popup.getElementsByClassName("popup_button")[0].addEventListener("click", error_popup_hide);

	//var last_error_select = null;
	function show_error_on_target_block(block, message) {
		//last_error_select = block;
		block.select();
		let other_id = block.id;
		let block_dom = document.querySelectorAll(`[data-id="${other_id}"]`)[0];	// surely there's a better way...
		let position = block_dom.getBoundingClientRect();
		error_popup_show(position.right + 20, position.top - 20, message);
	};

	var overlay = document.getElementById("screenflash");
	var flash_palette = {"green": "#66ff00", "red": "red", "yellow": "#FFDB58"}
	function flashWindow(color) {
		let color_code = flash_palette[color];
		overlay.style.backgroundColor = color_code;
		overlay.style.animation = "";
		overlay.style.animation = "screenflash 0.2s ease-out";
		setTimeout( () => { overlay.style.animation = ""; }, 200);
  };

	/* used below, to check for incorrectly-bound variables */
 //	function descend_tree_bounds__foundItException(blk) {
 //		this.block = blk;
 //		this.name = 'FoundItException';
 //	}
	function descend_tree_bounds__unboundException(blk) {
		this.block = blk;
		this.name = 'UnboundVarException';
		this.message = "Block references a variable that isn't bound yet";
	}
	function descend_tree_bounds__wrongTypeException(blk) {
		this.block = blk;
		this.name = 'WrongTypeException';
		this.message = "Block received the wrong type of input";
	}
	function descend_tree_bounds__rebindException(blk) {
		this.block = blk;
		this.name = 'RebindException';
		this.message = "Rebinding the same name is discouraged";
	}
	function descend_tree(parseBlock, block, bound_names) {
		/*console.log("-------");
		console.log(" " + block + " ");
		console.log(block);
		console.log(bound_names);
		console.log(block.type);//*/
		// check if names are bound in get_ blocks, add bound vars in quants
		//let this_level = [];
		const op = block.getField("OP") ? block.getFieldValue("OP") : block.type;	// a palette dropdown block acts as its operator

		if(block.type.startsWith("get_")) {		// getter for user vars
			let get_var_id = block.getFieldValue('VAR');
			if( ! bound_names.hasOwnProperty(  get_var_id  )) {		// unbound variable
				throw new descend_tree_bounds__unboundException(block);
			}
			return bound_names[get_var_id];
		}
		if(block.type.startsWith("fixed_get_")) {	// getter for sigs
			// TODO: handle predefined variables.
			// for now, just sigs -- assume set type
			let get_fix_var_sig = block.getFieldValue('VAR');
			if(block.type === "fixed_get_predef_var") {	// a predicate parameter: its declared sig
				return [[ parseBlock.fixed_var_types[get_fix_var_sig] ?? get_fix_var_sig ]];
			}
			return [[ get_fix_var_sig ]]; //ugh
		}
		if(binding_blocks.includes(op)) {	// quantifiers, atm
			let bind_var = block.getFieldValue('NAME');
			let bind_var_type = descend_tree(parseBlock,  block.getInputTargetBlock('condition'), bound_names);

			if(bound_names.hasOwnProperty(bind_var)) throw new descend_tree_bounds__rebindException(block);
			bound_names[bind_var] = bind_var_type;
			//this_level.push(bind_var);

			descend_tree(parseBlock, block.getInputTargetBlock("statement"), bound_names);

			delete bound_names[bind_var];
			return; // vertical connections are fine and all boolean, unless something's gone terribly wrong somehow
		}
		if(block.type.startsWith("fixed_pred_")) {	// fixed predicates
			let pred_type = block.getFieldValue('VAR');
			let want_types = parseBlock.fixed_predicates[pred_type];   //JSON.parse(block.data);
			//console.log(want_types);
			for(let i = 0; i < want_types.length; ++i) {
				let child_block = block.getInputTargetBlock("param_" + i);
				//console.log(child_block);
				let child_type = descend_tree(parseBlock, child_block, bound_names);
				//if(child_type != want_types[i])   throw new descend_tree_bounds__wrongTypeException(child_block);
				let wtypes = [[ want_types[i] ]];  // TODO change, stopgap
				//console.log(child_type);
				//console.log(wtypes);
				// TODO: add 'sig type A is a subset of sig type B'
				// each of the child's OR'd clauses must be a superset (more fine) at least one of the wanted clauses
				loop_outty:
				for(const cs of child_type) {
					for(const ws of wtypes) {
						for(const wp of ws) {
							for(const cp of cs) {
								if(cp === wp) { continue loop_outty; }
							} // god should strike me down for this code
						}
					}
					throw new descend_tree_bounds__wrongTypeException(child_block);
				}

			}
			return;
		}
		if(compare_op_list.includes(op)) { // check types match for == or !=
			let type1 = descend_tree(parseBlock, block.getInputTargetBlock("left_value"), bound_names);
			let type2 = descend_tree(parseBlock, block.getInputTargetBlock("right_value"), bound_names);
			//if(type1 != type2)   throw new descend_tree_bounds__wrongTypeException(block);
			// this should be a warning, but isn't technically an error
			return;
		}
		if(un_op_list.includes(op)) {
			descend_tree(parseBlock, block.getInputTargetBlock("statement"), bound_names);
			return;
		}
		if(bin_op_list.includes(op)) {
			descend_tree(parseBlock, block.getInputTargetBlock("left_statement"), bound_names);
			descend_tree(parseBlock, block.getInputTargetBlock("right_statement"), bound_names);
			return;
		}
		if(set_bin_op_list.map(l => (typeof(l) == 'string') ? l : l[0]).includes(op)) {
			let type1 = descend_tree(parseBlock, block.getInputTargetBlock("left_value"), bound_names);
			let type2 = descend_tree(parseBlock, block.getInputTargetBlock("right_value"), bound_names);
			switch(op) {
				case "-": return type1;		// strictly speaking this is correct, but it'll break strict pred-type checking
				case "+": return Array.from(new Set( [...type1, ...type2] ));
				case "&":
				  let rtype = [];
					for(const ys of type2) {
						for(const xs of type1) {
							rtype.push(Array.from(new Set( [...xs, ...ys] )));
						}
					}
					return rtype;
			}
		}
		throw new Error("how did this happen");
	};

	/**
	 * What stops a tab compiling, checked in the order Compile Current Tab reports them; null when it would compile.
	 * blocks: where to point; note: the same in a few words, for the preview.
	 */
	type CompileError = { kind: "roots" | "inputs" | "names", blocks: Blockly.Block[], message: string, note: string };
	function compileError(ws: Blockly.WorkspaceSvg, tab_block): CompileError | null {
		const tops = readingOrder(ws.getTopBlocks(false));
		if(tops.length > 1 && !tab_block.allow_multiple) {
			return { kind: "roots", blocks: tops.slice(1), message: "Only one root block allowed!", note: `${tops.length} root blocks, only one allowed` };
		}
		for(let block of tops) {
			if(! block.allInputsFilled()) {
				return { kind: "inputs", blocks: [block], message: "Missing inputs -- incomplete block!", note: "a block has an empty socket" };
			}
		}
		for(let block of tops) {
			try {
				descend_tree(tab_block, block, {});
			} catch(e) {
				if(e instanceof descend_tree_bounds__unboundException || e instanceof descend_tree_bounds__wrongTypeException || e instanceof descend_tree_bounds__rebindException) {
					return { kind: "names", blocks: [e.block], message: e.message, note: e.message.charAt(0).toLowerCase() + e.message.slice(1) };
				}
				console.error(e);
				return null;
			}
		}
		return null;
	}

	/*   Live preview: what Compile Current Tab would write for the open tab, even while it's unfinished  */
	const preview_div = document.getElementById("preview_code") as HTMLElement;
	const preview_title = document.getElementById("preview_title") as HTMLElement;
	const preview_hint = document.getElementById("preview_hint") as HTMLElement;
	const isMac = navigator.platform.toUpperCase().includes("MAC");
	preview_hint.textContent = (isMac ? "⇧⌘A" : "Ctrl+Shift+A") + " shows the whole file";
	const previewCm: CodeMirror.Editor = CodeMirror(preview_div, {
		mode: {name: "javascript"},
		theme: "nord",
		lineNumbers: false,
		lineWrapping: true,
		readOnly: true,
	});

	// Extra root blocks get Blockly's warning icon, live
	function setRootWarnings(w: TabWorkspace, err: CompileError | null) {
		const warn = err && err.kind === "roots" ? err.blocks : [];
		Blockly.Events.disable();
		try {
			for(const b of w.warned) if(b.workspace && !warn.includes(b)) b.setWarningText(null);
			for(const b of warn) b.setWarningText(err!.message);
			w.warned = warn;
		} finally {
			Blockly.Events.enable();
		}
	}

	let previewQueued = false;
	function schedulePreview() {
		if(previewQueued) return;
		previewQueued = true;
		requestAnimationFrame(() => {
			previewQueued = false;
			updatePreview();
		});
	}
	function updatePreview() {
		if(selected_index === -1 || !listBlocklyWorkplaces[selected_index]) {
			preview_title.textContent = "Alloy preview";
			previewCm.setValue("-- This file has no block tabs.");
			return;
		}
		const w = listBlocklyWorkplaces[selected_index];
		const tab_block = currentParse.locations[w.block_index].b;
		const err = compileError(w.workspace, tab_block);
		setRootWarnings(w, err);
		let code: string;
		try {
			code = generateTabCode(w.workspace, true);
		} catch(e) {
			code = `-- couldn't write this tab's Alloy: ${(e as Error).message}`;
		}
		const lines = BlocklyParse.assembleRegion(regionLines(w.block_index), code);
		if(err) lines.unshift(`-- won't compile: ${err.note}`);
		preview_title.textContent = w.title;
		previewCm.setValue(lines.join("\n"));
		if(err) previewCm.markText({line: 0, ch: 0}, {line: 0, ch: lines[0].length}, {className: "preview_error"});
		lines.forEach((l, i) => {
			for(let j = l.indexOf("▢"); j >= 0; j = l.indexOf("▢", j + 1)) {
				previewCm.markText({line: i, ch: j}, {line: i, ch: j + 1}, {className: "preview_hole"});
			}
		});
	}

	ipcRenderer.on("cmd-compile", () => {
		if(selected_index === -1) return;
		const w = listBlocklyWorkplaces[selected_index];
		const tab_wrk = w.workspace;
		const source_index = w.block_index;
		const tab_block = currentParse.locations[source_index].b;

		/*  Check for compilation error/etc  */
		const err = compileError(tab_wrk, tab_block);
		if(err) {
			show_error_on_target_block(err.blocks[0], err.message);
			flashWindow("red");
			return;
		}

		//  Compile and update the editor: the tab's comments stay where they were, around the new code
		editor.setCursor(editor.getCursor("from"));
		error_popup_hide();
		no_instance_popup_hide();
		flashWindow("green");
		let rendered_text = BlocklyParse.assembleRegion(regionLines(source_index), generateTabCode(tab_wrk));

		tab_block.textLines = rendered_text;
		tab_block.dirty = true; tab_block.updateText();
		clear_extra_marks();
		let place = blockMarks[source_index].find();
		editor.replaceRange(tab_block.dispLines.join("\n"), place.from, place.to);
		// the blocks and the text match again
		w.base = regionBase(rendered_text);
		saveWorkspace(w);
		schedulePreview();
		// push the compiled alloy file to Crucible
		ipcRenderer
			.invoke("crucible:sync-als", collect_alloy_text())
			.catch(console.error);
	});

	const crucible_div = document.getElementById("crucible");
	const crucible_root = document.getElementById("crucible-root")
	if (!crucible_div || !crucible_root) throw new Error("Error: crucible div not found");
	else mountCrucible(crucible_root);

	const switcher_root = document.getElementById("project-switcher");
	if (switcher_root) mountProjectSwitcher(switcher_root);

	/*   Divider between the left pane (code or tests) and the blocks: drag to resize, double-click to reset.
	     Work and Test view each remember their own width. */
	const main_div = document.querySelector(".main") as HTMLElement;
	const divider = document.getElementById("divider") as HTMLElement;
	const leftWidths = { work: 40, test: 40, preview: 28 };	// preview: Work view with the file hidden
	try { Object.assign(leftWidths, JSON.parse(localStorage.getItem("shakudo-left-widths") || "{}")); } catch (e) {}
	let view: "work" | "test" = "work";
	// Work view shows the tab's live preview on the left; File > Show Alloy File swaps in the whole file
	let fileShown = false;
	try { fileShown = localStorage.getItem("shakudo-file-shown") === "1"; } catch (e) {}
	const widthKey = (): "work" | "test" | "preview" => (view === "work" && !fileShown ? "preview" : view);

	const setLeftWidth = (percent: number) => {
		main_div.style.setProperty("--left-width", `${percent}%`);
		window.dispatchEvent(new Event("resize"));	// Blockly and Crucible re-measure
		editor.refresh();
	};
	const saveLeftWidths = () => {
		try { localStorage.setItem("shakudo-left-widths", JSON.stringify(leftWidths)); } catch (e) {}
	};
	// The › button on the divider folds the blocks away, per view like the width
	const collapseBtn = document.getElementById("collapse-blocks") as HTMLElement;
	const blocksCollapsed = { work: false, test: false };
	try { Object.assign(blocksCollapsed, JSON.parse(localStorage.getItem("shakudo-blocks-collapsed") || "{}")); } catch (e) {}
	const applyCollapsed = () => {
		const collapsed = blocksCollapsed[view];
		const wasCollapsed = main_div.classList.contains("blocks-collapsed");
		main_div.classList.toggle("blocks-collapsed", collapsed);
		collapseBtn.textContent = collapsed ? "‹" : "›";
		collapseBtn.title = collapsed ? "Show blocks" : "Hide blocks";
		divider.title = collapsed ? "Show blocks" : "Drag to resize · double-click to reset";
		if (wasCollapsed && !collapsed && selected_index !== -1) forceResize(listBlocklyWorkplaces[selected_index]);
	};
	const setCollapsed = (collapsed: boolean) => {
		blocksCollapsed[view] = collapsed;
		try { localStorage.setItem("shakudo-blocks-collapsed", JSON.stringify(blocksCollapsed)); } catch (e) {}
		applyCollapsed();
		setLeftWidth(leftWidths[widthKey()]);	// re-measure Blockly when it comes back
	};

	const showView = (v: "work" | "test") => {
		view = v;
		applyCollapsed();
		setLeftWidth(leftWidths[widthKey()]);
	};

	const applyFileShown = () => {
		main_div.classList.toggle("file-hidden", !fileShown);
		setLeftWidth(leftWidths[widthKey()]);
		if(fileShown) editor.refresh(); else previewCm.refresh();
		ipcRenderer.invoke("editor:file-shown", fileShown).catch(console.error);
	};
	const setFileShown = (shown: boolean) => {
		fileShown = shown;
		try { localStorage.setItem("shakudo-file-shown", shown ? "1" : "0"); } catch (e) {}
		applyFileShown();
		if(shown && crucible_div.classList.contains("show")) open_editor();	// asking for the file means the Work view
		else if(shown) editor.focus();
	};
	ipcRenderer.on("cmd-show-file", (_e: any, shown: boolean) => setFileShown(shown));

	// A press anywhere on the divider, button included: moving a few pixels drags (unfolding the blocks first
	// if they're folded), releasing without moving is a click that folds/unfolds. Moves are tracked on the
	// window so a fast drag isn't lost when the pointer leaves the thin divider.
	let press: { x: number, onButton: boolean, moved: boolean } | null = null;
	divider.addEventListener("pointerdown", (e) => {
		press = { x: e.clientX, onButton: e.target === collapseBtn, moved: false };
		e.preventDefault();	// no text selection while dragging
	});
	window.addEventListener("pointermove", (e) => {
		if (!press) return;
		if (!press.moved && Math.abs(e.clientX - press.x) < 4) return;
		if (!press.moved) {
			press.moved = true;
			divider.classList.add("dragging");
			if (blocksCollapsed[view]) setCollapsed(false);
		}
		const box = main_div.getBoundingClientRect();
		leftWidths[widthKey()] = Math.round(Math.min(80, Math.max(15, ((e.clientX - box.left) / box.width) * 100)));
		setLeftWidth(leftWidths[widthKey()]);
	});
	window.addEventListener("pointerup", () => {
		if (!press) return;
		const { moved, onButton } = press;
		press = null;
		divider.classList.remove("dragging");
		if (moved) saveLeftWidths();
		else if (onButton || blocksCollapsed[view]) setCollapsed(!blocksCollapsed[view]);
	});
	divider.addEventListener("dblclick", (e) => {
		if (e.target === collapseBtn || blocksCollapsed[view]) return;	// double-clicking the button isn't a reset
		const key = widthKey();
		leftWidths[key] = key === "preview" ? 28 : 40;
		setLeftWidth(leftWidths[key]);
		saveLeftWidths();
	});
	showView("work");
	applyFileShown();

	const open_crucible = () => {
		(document.activeElement as HTMLElement | null)?.blur(); // stop typing into the hidden editor
		crucible_div.classList.add("show");
		showView("test");
		ipcRenderer.invoke("crucible:set-view", false).catch(console.error);
	}

	const open_editor = () => {
		crucible_div.classList.remove("show");
		showView("work");
		editor.refresh();
		previewCm.refresh();
		if (fileShown) editor.focus();	// a hidden editor would still take typing
		ipcRenderer.invoke("crucible:set-view", true).catch(console.error);
	};

    ipcRenderer.on("cmd-test", open_crucible);
	ipcRenderer.on("cmd-work", open_editor);

	/* Misc */

	ipcRenderer.on("get-run", () => {
		if(selected_index === -1) return;
		// this should actually only be done on pane switch, but meh
		const tab_div = shak_tabs_div.children.item(selected_index);
		const tab_wrk = listBlocklyWorkplaces[selected_index].workspace;
		const source_index = parseInt(tab_div.dataset.block_index);
		const tab_block = currentParse.locations[source_index].b;
		currentParse.dirty_runners(tab_block.title);
		/*let marks = editor.getAllMarks();
		for(const runner of currentParse.runners) {
			let place = marks[source_index].find();
			editor.replaceRange(runner.dispLines.join("\n"), place.from, place.to)
		}*/

		get_save_callback();	// calls update text lines, among other things
		//editor.getValue()
		const outcontent = currentParse.dispLines.join("\n");
		console.log(outcontent);
		ipcRenderer.invoke("get-run", outcontent).catch(console.error);
	});

	var compile_run_error_popup = document.getElementById("compile_run_error_popup");
	var crepi = compile_run_error_popup.getElementsByClassName("compile_run_error_popup_inner")[0];
	var curr_comp_run_err_popu = null;
	function compile_run_error_popup_show(msg) {
		crepi.innerHTML = msg;
		compile_run_error_popup.classList.add("show");
	};
	function compile_run_error_popup_hide() {
		crepi.innerHTML = "";
		compile_run_error_popup.classList.remove("show");
		if(curr_comp_run_err_popu) {
			const nnn = extra_mark_list.indexOf(curr_comp_run_err_popu);
			if(nnn != -1) {  extra_mark_list.splice(nnn, 1); }
			curr_comp_run_err_popu.clear();
		}
	};
	compile_run_error_popup.getElementsByClassName("popup_button")[0].addEventListener("click", compile_run_error_popup_hide);

	ipcRenderer.on("handle-error-run", (event: any, msg: string) => {
		if (!fileShown) setFileShown(true);	// the error points at a line of the file
		let mtch = msg.match(/Line ([0-9]+) column ([0-9]+)/);
		if(mtch !== null) {
			let error = {"y1": mtch[1],"x1": mtch[2],"y2": mtch[1],"x2": parseInt(mtch[2])+1 }; //todo change
			let lnln = parseInt(mtch[1]);

			let i=0;
			for(; i < currentParse.full_locations.length
							&& currentParse.full_locations[i].s < lnln; ++i) {}
			i-=1; let tbs = currentParse.full_locations[i];
			let offs = lnln - (tbs.s + (tbs.b.fullLines.length - tbs.b.textLines.length));
			let tln = currentParse.locations[tbs.lb].s + offs;
			try {
				editor.setCursor(tln, 0, {scroll: true});
				const mmsg = msg.slice(msg.indexOf("\n")+1);
				compile_run_error_popup_show(mmsg);
				curr_comp_run_err_popu =
					editor.markText(
						{ch: 0, line: tln}, {ch: 1, line: tln+1},
						{css: "background: red;"});
				extra_mark_list.push(curr_comp_run_err_popu);

				return;
			} catch(e) {
				console.log("ERROR:: " + e);
			}
		}
		flashWindow("red");
		alert("Source code error, failed to compile. \nReason for failure:\n" + msg);
	});

	ipcRenderer.on("handle-error-compile", (event: any, error: {msg: string, x1: number, x2: number, y1: number, y2: number}) => {
		if (!fileShown) setFileShown(true);
		editor.setCursor(error.y1-1, error.x1 -1, {scroll: true});
		showAlert(error.msg);
		extra_mark_list.push(
			editor.markText(
				{ch: error.x1 - 1, line: error.y1-1}, {ch: error.x2, line: error.y1 -1},
				{css: "background: red;"}));
	});

	var no_instance_popup = document.getElementById("no_instance_popup");
	function no_instance_popup_show() {  no_instance_popup.classList.add("show");     };
	function no_instance_popup_hide() {  no_instance_popup.classList.remove("show");	};
	no_instance_popup.getElementsByClassName("popup_button")[0].addEventListener("click", no_instance_popup_hide);
	ipcRenderer.on("handle-no-instance", () => {
		flashWindow("yellow");
		no_instance_popup_show();
	});

	setupAlert();
};
