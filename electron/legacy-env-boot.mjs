// First import of every entry point (Electron main, the server, the CLI, the
// MCP script): settings set under their old names reach the code, which
// reads SAGAX_*, before any module reads the environment. See bridgeLegacyEnv in legacy-names.mjs.
import { bridgeLegacyEnv } from "./legacy-names.mjs";

bridgeLegacyEnv(process.env);
