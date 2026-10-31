// Builds the small Java runtime that ships inside the app (jre/), so users don't need Java installed.
// Uses the JDK in JAVA_HOME, or the one `java` on the PATH belongs to. The jar needs Java 18+, so build with JDK 21.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const exe = process.platform === "win32" ? ".exe" : "";
const out = path.join(__dirname, "..", "jre");

function javaHome() {
	if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
	const props = execFileSync("java", ["-XshowSettings:properties", "-version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const m = /java\.home = (.+)/.exec(props) || [];
	return m[1] ? m[1].trim() : "";
}

// what Spring Boot and Alloy use; trimming further saves little and risks a missing class at run time
const modules = [
	"java.base", "java.compiler", "java.desktop", "java.instrument", "java.logging", "java.management",
	"java.naming", "java.net.http", "java.prefs", "java.rmi", "java.scripting", "java.security.jgss",
	"java.security.sasl", "java.sql", "java.xml", "jdk.crypto.ec", "jdk.management", "jdk.unsupported", "jdk.zipfs",
];

const jlink = path.join(javaHome(), "bin", "jlink" + exe);
if (!fs.existsSync(jlink)) {
	console.error("jlink not found at " + jlink + ". Point JAVA_HOME at a JDK 21.");
	process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
execFileSync(jlink, [
	"--add-modules", modules.join(","),
	"--strip-debug", "--no-header-files", "--no-man-pages", "--compress=zip-6",
	"--output", out,
], { stdio: "inherit" });
console.log("Java runtime written to " + out);
