// First import of every entry point (Electron main, the server, the CLI, the
// MCP script): SAGAX_* settings reach the code before any module reads the
// environment. See bridgeLegacyEnv in legacy-names.mjs.
import { bridgeLegacyEnv } from "./legacy-names.mjs";

bridgeLegacyEnv(process.env);
