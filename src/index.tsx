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
import Blockly from "blockly";
import { mountCrucible } from "./crucible/mount";
import {setupBlocks, setupToolboxContents, setupToolboxWorkspace, Alloy, op_internal_translate,
					binding_blocks, set_op_blocks,  quant_list, un_op_list, bin_op_list, compare_op_list, set_bin_op_list} from "./alloy_generator"


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
	ipcRenderer.invoke("get-open-prompt", msg).catch(console.error).then((r) => {
		callback(r);
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
var listBlocklyWorkplaces: { div: HTMLElement, workspace: Blockly.WorkspaceSvg, block_index: number }[] = [];

window.onresize = () => {
	if(selected_index !== -1) {
		Blockly.svgResize(listBlocklyWorkplaces[selected_index].workspace);
	}
};

/**
 * This is called when the window is loaded.
 */
window.onload = () => {
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
		const toolbox = setupToolboxContents(currBlock);
		let workspace = Blockly.inject(wrk_div, {
			toolbox: toolbox,
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

		setupToolboxWorkspace(currBlock, workspace);

		listBlocklyWorkplaces.push({
			div: wrk_div,
			workspace: workspace,
			block_index: block_index
		});
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

			// this is a HORRIBLE hack and I'm not sure why it works or is needed,
			//   but various permutations of resize, render, etc all failed.
			// upon window size changes -- I'm not sure which but opening dev tools
			//  seemed to trigger it semi-consistently -- then switching tabs,
			//  the other workspace's blocks would all be invisible (though present in
			//  the html). Shifting window size sometimes fixed it, leading to this:
			let temp_wrk = listBlocklyWorkplaces[new_index].workspace;
			tab_wrk_div.style.width = '99%';  tab_wrk_div.style.height = '99%';
			Blockly.svgResize(temp_wrk);
			tab_wrk_div.style.width = '100%';  tab_wrk_div.style.height = '100%';
			Blockly.svgResize(temp_wrk);
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
		const tab_span = document.createElement("span");
		tab_span.textContent = tab_title;
		tab_div.appendChild(tab_span);
		tabs_div.appendChild(tab_div);

		tab_div.onclick = tab_onclick(tab_div);
	}

	// MUST be called before using getAllMarks()
	// ALSO MUST do a setCursor(getCursor()) to clear selection, which also counts for some reason
	let extra_mark_list = [];
	function clear_extra_marks() {
		const n = extra_mark_list.length;
		for(let i = n-1; i >= 0; i--) {
			extra_mark_list[i].clear();
		}
		extra_mark_list = [];
	}

	ipcRenderer.on("set", (event: any, message: any) => {
		currentParse = BlocklyParse.parse(message);
		editor.setValue(currentParse.dispLines.join("\n"));
		error_popup_hide();
		no_instance_popup_hide();
		blocklyDiv_container.innerHTML = "";
		listBlocklyWorkplaces = [];
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
			editor.markText({line: loc.s, ch: 0}, {line: loc.s + loc.l - 1, ch: editor.getLine(loc.s+loc.l-1).length}, options);

			if(loc.b.represented) {
				createTab(tabs_div, i, j, (loc.b.title ? loc.b.title : `Block ${j}`)  );
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
		}

	});


	/*   Save the editor's contents  */

	var get_save_callback = () => {
		editor.setCursor(editor.getCursor("from"));
		clear_extra_marks();
		let marks = editor.getAllMarks();
		let editorValue = editor.getValue().split("\n");
		for(let i = 0; i < marks.length; ++i) {
			let ffind = marks[i].find();
			let ffrom = ffind["from"]["line"]; let fto = ffind["to"]["line"];
			let iBlk = currentParse.locations[i].b;
			iBlk.textLines = Array(fto+1-ffrom).fill().map((_,i) => editorValue[ffrom + i]);
			iBlk.dirty = true;
		}
		currentParse.updateTextLines();
		ipcRenderer.invoke("get-save",  currentParse.fullLines.join("\n")   ).catch(console.error);
	};
	ipcRenderer.on("get-save", get_save_callback);



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
			return [[ get_fix_var_sig ]]; //ugh
		}
		if(binding_blocks.includes(block.type)) {	// quantifiers, atm
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
		if(compare_op_list.includes(block.type)) { // check types match for == or !=
			let type1 = descend_tree(parseBlock, block.getInputTargetBlock("left_value"), bound_names);
			let type2 = descend_tree(parseBlock, block.getInputTargetBlock("right_value"), bound_names);
			//if(type1 != type2)   throw new descend_tree_bounds__wrongTypeException(block);
			// this should be a warning, but isn't technically an error
			return;
		}
		if(un_op_list.includes(block.type)) {
			descend_tree(parseBlock, block.getInputTargetBlock("statement"), bound_names);
			return;
		}
		if(bin_op_list.includes(block.type)) {
			descend_tree(parseBlock, block.getInputTargetBlock("left_statement"), bound_names);
			descend_tree(parseBlock, block.getInputTargetBlock("right_statement"), bound_names);
			return;
		}
		if(set_bin_op_list.map(l => (typeof(l) == 'string') ? l : l[0]).includes(block.type)) {
			let type1 = descend_tree(parseBlock, block.getInputTargetBlock("left_value"), bound_names);
			let type2 = descend_tree(parseBlock, block.getInputTargetBlock("right_value"), bound_names);
			switch(block.type) {
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

	ipcRenderer.on("cmd-compile", () => {
		const tab_div = shak_tabs_div.children.item(selected_index);
		const tab_wrk = listBlocklyWorkplaces[selected_index].workspace;
		const source_index = parseInt(tab_div.dataset.block_index);
		const tab_block = currentParse.locations[source_index].b;
		let code = "";

		/*  Check for compilation error/etc  */
		// Check for too many root blocks
		if(tab_wrk.getTopBlocks().length > 1 && !tab_block.allow_multiple) {
			let other_block = tab_wrk.getTopBlocks()[1];
			show_error_on_target_block(other_block, "Only one root block allowed!");
			flashWindow("red");
			//Alloy.init(tab_wrk);
			//code = Alloy.blockToCode(tab_wrk.getTopBlocks()[0]);
			return;
		}
		// Check for incomplete block structure
		for(let block of tab_wrk.getTopBlocks()) {
			if(! block.allInputsFilled()) {
				show_error_on_target_block(block, "Missing inputs -- incomplete block!");
				flashWindow("red");
				return;
			}
		}
		// check for wrongly bound variables and wrong types
		let fixed_vals = tab_block.fixed_set_names;	// the predefined sigs, for now
		for(let block of tab_wrk.getTopBlocks()) {
			try {
				descend_tree(tab_block, block, {});
			} catch(e) {
				if(e instanceof descend_tree_bounds__unboundException || e instanceof descend_tree_bounds__wrongTypeException || e instanceof descend_tree_bounds__rebindException) {
					show_error_on_target_block(e.block, e.message);
					flashWindow("red");
					return;
				}
				throw e;
			}
		}

		//  Compile and update the editor
		editor.setCursor(editor.getCursor("from"));
		error_popup_hide();
		no_instance_popup_hide();
		flashWindow("green");
		code = Alloy.workspaceToCode(tab_wrk);
		let rendered_text = code.split("\n");

		tab_block.textLines = rendered_text;
		tab_block.dirty = true; tab_block.updateText();
		//currentParse.updateTextLines();
		clear_extra_marks();
		let marks = editor.getAllMarks();
		let place = marks[source_index].find();
		editor.replaceRange(tab_block.dispLines.join("\n"), place.from, place.to);
	});

	const crucible_div = document.getElementById("crucible");
	if (!crucible_div) throw new Error("Error: crucible div not found");
	else mountCrucible(crucible_div);

	const open_crucible = () => {
		(document.activeElement as HTMLElement | null)?.blur(); // stop typing into the hidden editor
		crucible_div.classList.add("show");
	}

	const open_editor = () => {
		crucible_div.classList.remove("show");
		editor.refresh();
		editor.focus();
	};

    ipcRenderer.on("cmd-test", open_crucible);
	ipcRenderer.on("cmd-work", open_editor);

	/* Misc */

	ipcRenderer.on("get-run", () => {
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
