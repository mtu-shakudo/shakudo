/**
 * Elijah Cobb
 * elijah@elijahcobb.com
 * elijahcobb.com
 * github.com/elijahjcobb
 */

import * as ChildProcess from "child_process";
import * as Path from "path";
import * as FS from "fs";
import {BrowserWindow, app} from "electron";

/**
 * This class handles half of the integration with Alloy. The rest can be found from the shakudo-integration repo.
 * The .jar found in this directory is just a build of that project.
 */
export class AlloyIntegration {

	private readonly _process: ChildProcess.ChildProcessWithoutNullStreams;
	private readonly _window: BrowserWindow;
	private readonly _cache: string[];


	/**
	 * Create a new alloy integration for a specific file.
	 * @param path The path to the alloy file.
	 * @param window The current browser window.
	 */
	public constructor(path: string, window: BrowserWindow) {
		this._window = window;
		this._cache = [];

		// Candidate locations: next to this file, in an alloy/ subfolder, or in packaged resources
		const candidates = [
			Path.join(__dirname, "blockly-alloy-integration.jar"),
			Path.join(__dirname, "alloy", "blockly-alloy-integration.jar"),
			Path.join(process.resourcesPath || "", "alloy", "blockly-alloy-integration.jar"),
		];
		const jar = candidates.find(p => FS.existsSync(p));

		console.log("__dirname:", __dirname);
		console.log("jar candidates:", candidates, "chosen:", jar);

		if (!jar) {
			throw new Error("Could not find blockly-alloy-integration.jar. Looked in:\n" + candidates.join("\n"));
		}

		this._process = ChildProcess.spawn("java", ["-jar", jar, path]);
		this._process.on("error", this.onSpawnError.bind(this));
		this._process.stderr.on("data", this.onStdErr.bind(this));
		this._process.stdout.on("data", this.onStdOut.bind(this));
		this._process.on("close", this.onClose.bind(this));
	}

	// on error when trying to open jar file
	private onSpawnError(err: Error): void {
		// Fires if `java` isn't on PATH, among other things
		console.error("Failed to start java:", err);
		this._window.webContents.send("handle-error-run", String(err));
	}

	/**
	 * Handle when the child process is closed.
	 * @param code
	 * @private
	 */
	private onClose(code: number): void {
		if(code === 2) { // compile error
			const raw = this._cache.join("");
			console.log(raw);
			const obj = JSON.parse(raw);
			console.error(obj);
			this._window.webContents.send("handle-error-compile", obj);
			this._cache.splice(0, this._cache.length);
		} else if(code === 7) {
      this._window.webContents.send("handle-no-instance");
    }
	}

	/**
	 * This is called when any data is written to standard error.
	 * @param data
	 * @private
	 */
	private onStdErr(data: any): void {
		const msg = data.toString();
		console.error(msg);
		this._window.webContents.send("handle-error-run", msg);
	}

	/**
	 * This is called when data is written to standard out.
	 * @param data
	 * @private
	 */
	private onStdOut(data: any): void {
		console.log(data.toString());
		this._cache.push(data.toString());
	}

	/**
	 * This can be called to kill the child.
	 */
	public stop(): void {
		this._process.kill();
	}

	/**
	 * Write data to the child process's stdin.
	 * @param data
	 */
	public write(data: Buffer | string): void {
		this._process.stdin.write(data);
	}

}
