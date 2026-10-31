// Dev: compile the main process in watch mode and start Electron once the first build is done.
// Starting Electron alongside a separate compile let the watcher's first build trigger
// electron-reload's restart, which left extra copies of the app open.
const { spawn } = require("child_process");
const electron = require("electron");

const tsc = spawn(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "electron", "-w", "--preserveWatchOutput"]);
let started = false;
tsc.stdout.on("data", (d) => {
	process.stdout.write(d);
	if (started || !/Watching for file changes/.test(d.toString())) return;
	started = true;
	spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit" });
});
tsc.stderr.pipe(process.stderr);
