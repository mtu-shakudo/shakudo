// electron-builder afterPack: re-sign the macOS app ad hoc. Packaging changes files inside the bundle,
// which breaks Electron's own signature, and macOS then calls a downloaded copy "damaged" instead of
// offering Open Anyway. We have no Apple Developer certificate, so ad hoc is as far as this goes.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
	if (context.electronPlatformName !== "darwin") return;
	const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app");
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
