import {app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, MenuItemConstructorOptions} from "electron";
import * as path from "path";
import * as isDev from "electron-is-dev";
import * as fs from "fs";
import { initCrucibleDb, prisma, setActiveProject, projectForFile } from "./crucibleDb";
import { registerCrucibleHandlers } from "./crucibleHandlers";
import { startAlloyApi, stopAlloyApi, waitForAlloyApi, postJson } from "./crucibleAPI";
import { syncProjectStructure } from "./crucibleImport";
/**
 * If move back to react, uncomment below for dev tools.
 */
// import installExtension, { REACT_DEVELOPER_TOOLS } from "electron-devtools-installer";

var prompt = require('electron-prompt');

/*
 * Hold onto the main window and a file string.
 */
let win: BrowserWindow | null = null;
let testWin: BrowserWindow | null = null;	// Crucible popped out into its own window
let file: string = "";
let quitting = false;	// set by before-quit, so the close prompt knows to finish quitting

/**
 * Before the editor is replaced: offer to save unsaved changes. false means the user cancelled.
 */
async function confirmUnsaved(): Promise<boolean> {
	if (!win || !file) return true;
	const dirty: boolean = await win.webContents.executeJavaScript("window.shakudoIsDirty?.() ?? false");
	if (!dirty) return true;
	const r = await dialog.showMessageBox(win, {
		type: "warning",
		buttons: ["Save", "Don't Save", "Cancel"],
		defaultId: 0,
		cancelId: 2,
		message: `Save changes to ${path.basename(file)}?`,
		detail: "Your changes will be lost if you don't save them.",
	});
	if (r.response === 2) return false;
	if (r.response === 0) fs.writeFileSync(file, await win.webContents.executeJavaScript("window.shakudoSaveText()"));
	return true;
}

/**
 * Make a project active and load its .als into the editor and Crucible.
 */
async function openProject(id: number) {
	if (!win) return;
	if (!(await confirmUnsaved())) return;
	await setActiveProject(id);
	const project = await prisma.project.findFirst({ where: { id } });
	if (!project?.sourcePath || !fs.existsSync(project.sourcePath)) {
		console.error("[crucible] project has no readable .als:", project?.sourcePath);
		return;
	}
	const filePath = project.sourcePath;
	file = filePath;
	try {
		const result = await syncProjectStructure(id, filePath, async () => {
			const r = await dialog.showMessageBox(win!, {
				type: "warning",
				buttons: ["Replace", "Cancel"],
				defaultId: 1,
				message: "This file's structure changed.",
				detail: "Atoms, relations or predicates differ. Existing Crucible tests will be deleted.",
			});
			return r.response === 0;
		});
		console.log("[crucible] structure sync:", result);
	} catch (e) {
		console.error("[crucible] import failed:", e);
	}
	// Saved editor state for this project: blocks per tab and the selected tab
	const workspaces = await prisma.shakPredicate.findMany({ where: { projectID: id } });
	BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("crucible:project-changed"));
	win.webContents.send("set", fs.readFileSync(filePath).toString("utf8"), {
		activeTab: project.activeShakPred,
		workspaces: workspaces.map((w) => ({ title: w.title, xml: w.workspaceXml, metaHash: w.metaHash })),
	});
	// with tests popped out, the main window keeps the code
	win.webContents.send(project.editorOpen || testWin ? "cmd-work" : "cmd-test");
	win.setTitle("Shakudo - " + path.basename(filePath));
	testWin?.setTitle("Shakudo Tests - " + path.basename(filePath));
}

const pageUrl = () => (isDev ? "http://localhost:3000" : `file://${__dirname}/../index.html`);

/**
 * Show the tests: focus their window when popped out, otherwise switch the main window to them.
 */
function showTests() {
	if (testWin) testWin.focus();
	else win?.webContents.send("cmd-test");
}

/**
 * Move Crucible into a window of its own, and the main window back to the code.
 * Closing that window puts the tests back in the main one.
 */
async function popOutTests() {
	if (testWin) return testWin.focus();
	testWin = new BrowserWindow({
		width: 1000,
		height: 720,
		minWidth: 640,
		minHeight: 480,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});
	testWin.on("closed", () => {
		testWin = null;
		if (win && !win.isDestroyed()) win.webContents.send("cmd-test");
	});
	win?.webContents.send("cmd-work");
	await testWin.loadURL(pageUrl() + "#tests");
	testWin.setTitle("Shakudo Tests" + (file ? " - " + path.basename(file) : ""));
}

ipcMain.handle("crucible:pop-out-tests", popOutTests);

/* Add Crucible IPC Handlers */
registerCrucibleHandlers(() => win, openProject);

/**
 * Called whenever a window needs to be created.
 */
async function createWindow() {

	/**
	 * A dimensions object to just to change them in one place.
	 */
	const dimensions = {
		width: 1280,
		height: 720
	};

	/**
	 * Create a window with initial and min dimensions and enable node and context.
	 */
	win = new BrowserWindow({
		width: dimensions.width,
		height: dimensions.height,
		minWidth: dimensions.width,
		minHeight: dimensions.height,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});

	/**
	 * All the menu items.
	 */
	const menuItems: Array<(MenuItemConstructorOptions) | (MenuItem)> = [
		{
			label: "Shakudo",
			submenu: [
				{role: "quit"}
			]
		},
		{
			label: "File",
			submenu: [
				{
					label: "Open",
					accelerator: "CmdOrCtrl+O",
					click: async () => {
						if (!win) return;
						const path: string[] | undefined = dialog.showOpenDialogSync({properties: ["openFile"], filters: [{
								name: "*",
								extensions: ["als"]
							}]});
						if (!path) return;
						const filePath: string = path[0];
						if (!filePath) return;
						if (!fs.existsSync(filePath)) return;
						await openProject(await projectForFile(filePath));
					}
				},
				{
					label: "Save",
					accelerator: "CmdOrCtrl+S",
					click: async () => {
						win?.webContents.send("get-save");
					}
				},
				{
					label: "Run",
					accelerator: "CmdOrCtrl+R",
					click: async () => {
						win?.webContents.send("get-run");
					}
				},
				{
					label: "Compile Current Tab",
					accelerator: "CmdOrCtrl+Shift+C",
					click: async () => {
						win?.webContents.send("cmd-compile");
					}
				},
				{
					label: "Work",
					accelerator: "CmdOrCtrl+Shift+W",
					click: async () => {
						win?.webContents.send("cmd-work");
					}
				},
				{
					label: "Test",
					accelerator: "CmdOrCtrl+Shift+T",
					click: showTests
				}
			]
		},
		// { role: "editMenu" }
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
			]
		},
		// { role: "windowMenu" }
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "togglefullscreen" },
				{ type: "separator" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ role: "resetZoom" }
			]
		},
		{
			role: "help",
			submenu: [
				{role: "forceReload"},
				{role: "toggleDevTools"},
				{
					label: "View Github",
					click: async () => {
						const { shell } = require("electron");
						await shell.openExternal("https://github.com/elijahjcobb/shakudo");
					}
				}
			]
		}
	];

	/**
	 * Create menu from menu items and set as main menu.
	 */
	const menu = Menu.buildFromTemplate(menuItems);
	Menu.setApplicationMenu(menu);

	/**
	 * Handle when the render process asks to save.
	 */
	ipcMain.handle("get-save", async (event, arg: string) => {
		fs.writeFileSync(file, arg);
	});

	/**
	 * Handle when the render process asks to run.
	 * Does NOT call save() automatically anymore.
	 */
	ipcMain.handle("get-run", async (event, arg: string) => {
		if (!win) return;
		//fs.writeFileSync(file, arg);
		var filename = file + "__samp";	//todo mktemp
		fs.writeFileSync(filename, arg);

		postJson("/shakudo", {
			path: filename
		}).catch((err) => {
			console.error("shakudo backend error", err);
		}).then(() => {

		});
	});


	ipcMain.handle("get-open-prompt", async (event, arg: any) => {
		let res = await prompt({
			title: arg.title || "",
			label: arg.label || "",
			value: arg.value || "",
			inputAttrs: arg.inputAttrs || {},
			type: 'input'
		}).catch(console.error);
		let result = await res;
		return result;
	});

	/**
	 * Either run the app or build the app.
	 */
	await win.loadURL(pageUrl());

	/**
	 * Set our reference to the window to null when it is closed, and take the tests window with it.
	 */
	win.on("closed", () => {
		win = null;
		testWin?.close();
	});

	/**
	 * Closing the window (or quitting) with unsaved edits: ask first. The close is cancelled
	 * while the prompt is up, then redone once the user picks Save or Don't Save.
	 */
	let closeConfirmed = false;
	win.on("close", (e) => {
		if (closeConfirmed) return;
		e.preventDefault();
		confirmUnsaved().then((ok) => {
			if (!ok) { quitting = false; return; }
			closeConfirmed = true;
			if (quitting) app.quit();
			else win?.close();
		});
	});

	/**
	 * Enable hot reloading.
	 */
	if (isDev) {
		require("electron-reload")(__dirname, {
			electron: path.join(__dirname,
				"..",
				"..",
				"node_modules",
				".bin",
				"electron" + (process.platform === "win32" ? ".cmd" : "")),
			forceHardReset: true,
			hardResetMethod: "exit"
		});
	}

	/**
	 * If move back to react, uncomment this to add dev tools.
	 */
	// installExtension(REACT_DEVELOPER_TOOLS)
	// 	.then((name) => console.log(`Added Extension:  ${name}`))
	// 	.catch((err) => console.log("An error occurred: ", err));

}

/**
 * Handle when electron is ready to create a window.
 */
app.on("ready", async () => {
	await initCrucibleDb();
	await startAlloyApi();
	waitForAlloyApi().then((up) => console.log("[asketch] api up:", up)); // don't block the window
	await createWindow();
});

/**
 * Handle when all windows are closed.
 */
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

/**
 * Handle when the app is clicked in toolbar.
 */
app.on("activate", () => {
	if (win === null) {
		createWindow().catch(console.error);
	}
});

// The window's close handler may still cancel a quit, so only note it here
app.on("before-quit", () => {
	quitting = true;
});

// Runs once the quit can no longer be cancelled
app.on("will-quit", () => {
	console.log("[asketch] will-quit fired, stopping...");
	stopAlloyApi();
	prisma?.$disconnect();
});
