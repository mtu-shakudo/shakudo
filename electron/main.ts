import {app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, MenuItemConstructorOptions} from "electron";
import * as path from "path";
import * as isDev from "electron-is-dev";
import * as fs from "fs";
import {AlloyIntegration} from "./alloy/AlloyIntegration";
import { initCrucibleDb, prisma, crucibleProjectID, crucibleAlloyPath } from "./crucibleDb";

/**
 * If move back to react, uncomment below for dev tools.
 */
// import installExtension, { REACT_DEVELOPER_TOOLS } from "electron-devtools-installer";

var prompt = require('electron-prompt');

/*
 * Hold onto the main window and a file string.
 */
let win: BrowserWindow | null = null;
let file: string = "";

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
						const data: Buffer | undefined = fs.readFileSync(filePath);
						if (!data) return;
						file = filePath;
						const str = data.toString("utf8");
						win.webContents.send("set", str);
						const parts: string[] = filePath.split("/");
						win.setTitle("Shakudo - " + parts[parts.length - 1]);
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
					click: async () => {
						win?.webContents.send("cmd-test");
					}
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
	 * Create an integration manager. (this is a handler that owns a process to talk with Java stuff).
	 */
	let integration: AlloyIntegration | undefined;

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

		if (integration) integration.stop();
		integration = new AlloyIntegration(filename, win);
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
	if (isDev) await win.loadURL("http://localhost:3000");
	else await win.loadURL(`file://${__dirname}/../index.html`);

	/**
	 * Set our reference to the window to null when it is closed.
	 */
	win.on("closed", () => win = null);

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

ipcMain.on("get-active-project", (event) => {
	event.sender.send("get-active-project-resp", crucibleProjectID);
});

/**
 * Handle when electron is ready to create a window.
 */
app.on("ready", async () => {
	await initCrucibleDb();
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

app.on("before-quit", () => {
	prisma?.$disconnect();
});

ipcMain.handle("crucible-sync", async (event, text: string) => {
	fs.writeFileSync(crucibleAlloyPath(), text);
});
