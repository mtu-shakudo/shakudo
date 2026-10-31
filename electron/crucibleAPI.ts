import { spawn, ChildProcess, execSync } from "child_process";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { app, dialog } from "electron";

export const API_PORT = 10121;
let proc: ChildProcess | null = null;

// swap with merged .jar file once done
const jarPath = () => app.isPackaged
	? path.join(process.resourcesPath, "java", "aSketch-API.jar")
	: path.join(app.getAppPath(), "java", "aSketch-API.jar");

const isWin = process.platform === "win32";

// the packaged app ships its own Java (scripts/make-jre.js); dev uses whatever java is on the PATH
const javaPath = () => {
	const bundled = path.join(process.resourcesPath, "jre", "bin", isWin ? "java.exe" : "java");
	return app.isPackaged && fs.existsSync(bundled) ? bundled : "java";
};

// ping the backend
function ping(): Promise<boolean> {
	return new Promise((resolve) => {
		const req = http.get(`http://localhost:${API_PORT}/pid`, (res) => {
			res.resume();
			resolve(!!res.statusCode && res.statusCode < 500);
		});
		req.on("error", () => resolve(false));
		req.setTimeout(2000, () => { req.destroy(); resolve(false); });
	});
}

// launch the .jar file
export async function startAlloyApi(): Promise<void> {
    //killPortHolder();
	if (proc) return;
    if (await ping()) {
		console.log("[asketch] already running on port", API_PORT, "- reusing it");
		return;
	}
	proc = spawn(javaPath(), ["-jar", jarPath(), "--server.address=127.0.0.1"]);
	proc.stdout?.on("data", (d) => console.log("[asketch]", d.toString().trim()));
	proc.stderr?.on("data", (d) => console.error("[asketch]", d.toString().trim()));
	proc.on("error", (err) => {
		console.error("[asketch] failed to start:", err.message);
		proc = null;
		dialog.showErrorBox("Backend failed to start", "Java was not found or could not run the backend.");
	});
	proc.on("close", (code) => {
		console.log("[asketch] exited with code", code);
		proc = null;
	});
    const killChild = () => { proc?.kill(); proc = null; };
    process.on("exit", stopAlloyApi);
    process.on("SIGINT", () => { killChild(); process.exit(0); });
    process.on("SIGTERM", () => { killChild(); process.exit(0); });
}

export function stopAlloyApi(): void {
	if (!proc) return;
	if (isWin && proc.pid) {
		try { execSync(`taskkill /PID ${proc.pid} /T /F`); } catch { /* already exited */ }
	} else {
		proc.kill("SIGTERM");
	}
	proc = null;
}

// Spring Boot takes a few seconds to start, so retry until it answers.
export async function waitForAlloyApi(timeoutMs = 30000): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await ping()) return true;
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

// Send a POST to the Spring boot server
export function postJson(pathname: string, body: unknown): Promise<{ status: number; text: string }> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = http.request(
			{
				host: "localhost", port: API_PORT, path: pathname, method: "POST",
				headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
			},
			(res) => {
				let text = "";
				res.on("data", (c) => (text += c));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
			}
		);
		req.on("error", reject);
		req.setTimeout(60000, () => req.destroy(new Error("aSketch API timed out")));
		req.write(data);
		req.end();
	});
}