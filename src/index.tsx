/**
 * Elijah Cobb
 * elijah@elijahcobb.com
 * elijahcobb.com
 * github.com/elijahjcobb
 */

import "codemirror/lib/codemirror.css";
import "codemirror/theme/nord.css";
import CodeMirror from "codemirror";
import "./index.css";
import "./App.css";
import {BlockloyParser} from "./BlockloyParser";
import Blockly from "blockly";

const ipcRenderer = window.require("electron").ipcRenderer;
const fs = window.require("fs");

function hideAlert() {
	const alert = document.getElementById("alert");
	if (!alert) return;
	alert.style.display = "none";
}

function showAlert(message: string) {

	const alertContent = document.getElementById("alert-content");
	if (!alertContent) return;
	alertContent.innerHTML = message;

	const alert = document.getElementById("alert");
	if (!alert) return;
	alert.style.display = "flex";

}

function setupAlert() {
	const alertElement = document.getElementById("alert");
	if (!alertElement) return;
	alertElement.style.display = "none";
	alertElement.onclick = () => {
		hideAlert();
	};
}

function initBlocks(): void {
	Blockly.defineBlocksWithJsonArray([{
		"type": "all",
		"message0": "all %1 : %2 | %3",
		"args0": [
			{
				"type": "field_variable",
				"name": "NAME",
				"variable": "item"
			},
			{
				"type": "input_value",
				"name": "condition",
				"check": "Boolean"
			},
			{
				"type": "input_statement",
				"name": "statement",
				"check": "Boolean",
				"align": "RIGHT"
			}
		],
		"inputsInline": true,
		"previousStatement": null,
		"nextStatement": null,
		"colour": 230,
		"tooltip": "",
		"helpUrl": ""
	},
		{
			"type": "some",
			"message0": "some %1 : %2 | %3",
			"args0": [
				{
					"type": "field_variable",
					"name": "NAME",
					"variable": "item"
				},
				{
					"type": "input_value",
					"name": "condition",
					"check": "Boolean"
				},
				{
					"type": "input_statement",
					"name": "statement",
					"check": "Boolean",
					"align": "RIGHT"
				}
			],
			"inputsInline": true,
			"previousStatement": null,
			"nextStatement": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "no",
			"message0": "no %1 : %2 | %3",
			"args0": [
				{
					"type": "field_variable",
					"name": "NAME",
					"variable": "item"
				},
				{
					"type": "input_value",
					"name": "condition",
					"check": "Boolean"
				},
				{
					"type": "input_statement",
					"name": "statement",
					"check": "Boolean",
					"align": "RIGHT"
				}
			],
			"inputsInline": true,
			"previousStatement": null,
			"nextStatement": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "one",
			"message0": "one %1 : %2 | %3",
			"args0": [
				{
					"type": "field_variable",
					"name": "NAME",
					"variable": "item"
				},
				{
					"type": "input_value",
					"name": "condition",
					"check": "Boolean"
				},
				{
					"type": "input_statement",
					"name": "statement",
					"check": "Boolean",
					"align": "RIGHT"
				}
			],
			"inputsInline": true,
			"previousStatement": null,
			"nextStatement": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "lone",
			"message0": "lone %1 : %2 | %3",
			"args0": [
				{
					"type": "field_variable",
					"name": "NAME",
					"variable": "item"
				},
				{
					"type": "input_value",
					"name": "condition",
					"check": "Boolean"
				},
				{
					"type": "input_statement",
					"name": "statement",
					"check": "Boolean",
					"align": "RIGHT"
				}
			],
			"inputsInline": true,
			"previousStatement": null,
			"nextStatement": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "and",
			"message0": "and %1 %2 %3",
			"args0": [
				{
					"type": "input_dummy"
				},
				{
					"type": "input_value",
					"name": "val1",
					"check": "Boolean",
					"align": "RIGHT"
				},
				{
					"type": "input_value",
					"name": "val2",
					"check": "Boolean"
				}
			],
			"output": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "or",
			"message0": "or %1 %2 %3",
			"args0": [
				{
					"type": "input_dummy"
				},
				{
					"type": "input_value",
					"name": "val1",
					"check": "Boolean",
					"align": "RIGHT"
				},
				{
					"type": "input_value",
					"name": "val2",
					"check": "Boolean"
				}
			],
			"output": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "not",
			"message0": "not %1",
			"args0": [
				{
					"type": "input_value",
					"name": "NAME",
					"check": "Boolean"
				}
			],
			"inputsInline": false,
			"output": "Boolean",
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "implies",
			"message0": "implies %1 %2 %3",
			"args0": [
				{
					"type": "input_dummy"
				},
				{
					"type": "input_value",
					"name": "val1",
					"check": "Boolean",
					"align": "RIGHT"
				},
				{
					"type": "input_value",
					"name": "val2",
					"check": "Boolean"
				}
			],
			"output": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		},
		{
			"type": "iff",
			"message0": "iff %1 %2",
			"args0": [
				{
					"type": "input_value",
					"name": "a",
					"check": "Boolean"
				},
				{
					"type": "input_statement",
					"name": "b"
				}
			],
			"previousStatement": null,
			"nextStatement": null,
			"colour": 230,
			"tooltip": "",
			"helpUrl": ""
		}
	]);
}

function main() {

	const div = document.getElementById("editor");
	if (!div) return;

	const editor: CodeMirror.Editor = CodeMirror(div, {
		mode: {name: "javascript"},
		theme: "nord",
		lineNumbers: true,
		lineWrapping: true,
		spellcheck: true,
		smartIndent: true,
		indentUnit: 4,
		indentWithTabs: true,
		electricChars: true
	});

	let lastPosition: CodeMirror.Position = {ch: 0, line: 0};
	editor.on("cursorActivity", (editor) => {
		const position = editor.getCursor();
		const line: number = position.line;
		const locations = BlockloyParser.parse(editor.getValue());
		for (const location of locations) {
			if (line >= location.s && line <= location.e) {
				return editor.setCursor(lastPosition);
			}
		}
		lastPosition = position;
	});

	ipcRenderer.on("set", (event, message) => {
		editor.setValue(message);
		for (const location of BlockloyParser.parse(message)) editor.markText({ch: 0, line: location.s - 1}, {ch: 0, line: location.e + 2}, {css: "color: yellow;"});
	})

	ipcRenderer.on("get-save", () => {
		ipcRenderer.invoke("get-save", editor.getValue()).catch(console.error);
	});

	ipcRenderer.on("get-run", () => {
		ipcRenderer.invoke("get-run", editor.getValue()).catch(console.error);
	});

	ipcRenderer.on("handle-error-run", () => {
		alert("Source code incorrect. Failed to compile.")
	});

	ipcRenderer.on("handle-error-compile", (event, error: {msg: string, x1: number, x2: number, y1: number, y2: number}) => {
		editor.setCursor(error.y1-1, error.x1 -1, {scroll: true});
		showAlert(error.msg);
		editor.markText({ch: error.x1 - 1, line: error.y1-1}, {ch: error.x2, line: error.y1 -1}, {css: "background: red;"});
	});

	setupAlert();
	initBlocks();

	const toolbox = document.getElementById("toolbox");
	if (!toolbox) throw new Error("Toolbox undefined.");
	Blockly.inject("blocklyDiv", {
		toolbox: toolbox,
		theme: {
			componentStyles: {
				workspaceBackgroundColour: "#282C34",
				flyoutBackgroundColour: "#21252b",
				toolboxBackgroundColour: "#21252b"
			}
		}
	});

}



window.onload = main;
