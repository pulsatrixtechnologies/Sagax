// electron-builder Windows sign hook (win.signtoolOptions.sign), set by
// package-fork.mjs for every Windows release build. electron-builder calls it
// for each executable it signs: Sagax.exe, the helper .exe files it copies,
// the NSIS uninstaller and the setup, for x64 and arm64, before it hashes
// anything for latest.yml or the blockmaps. Signing is scripts/win-trusted-signing.mjs.
const path = require("node:path");

let signing;
const load = () => (signing ??= import(path.join(__dirname, "win-trusted-signing.mjs")));

exports.default = async function signWithTrustedSigning(configuration) {
  const file = configuration.path;
  // electron-builder calls once per hash (sha1, then a nested sha256). One
  // SHA-256 signature is what Windows 10/11 need: sign on the first call only.
  if (configuration.isNest) return;
  const { signFile, signingConfig, isVendorExecutable } = await load();
  if (isVendorExecutable(file)) {
    console.log(`  • trusted signing  skipped (vendor binary)  file=${path.basename(file)}`);
    return;
  }
  signFile(file, signingConfig());
  console.log(`  • trusted signing  signed  file=${path.basename(file)}`);
};
