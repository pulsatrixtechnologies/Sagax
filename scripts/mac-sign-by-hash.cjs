// electron-builder signs the app by identity *name*, which codesign rejects as
// ambiguous when the keychain holds two certificates with the same name (a
// renewed Developer ID). package-fork.mjs uses this hook when
// SAGAX_MAC_IDENTITY is a SHA-1 certificate hash, so codesign gets the hash.
const builder = require.resolve("electron-builder");
const { sign } = require(require.resolve("app-builder-lib/out/codeSign/macCodeSign", { paths: [builder] }));

exports.default = async function signByHash(opts) {
  const hash = process.env.SAGAX_MAC_IDENTITY;
  if (!/^[0-9A-F]{40}$/i.test(hash ?? "")) throw new Error("SAGAX_MAC_IDENTITY must be a certificate SHA-1 hash here");
  return sign({ ...opts, identity: hash });
};
