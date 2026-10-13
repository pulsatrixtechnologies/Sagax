# Security agent on persistent local VMs

Long-lived local virtual machines can run an endpoint security agent of the
operator's choice. Sagax does not ship or name any product: it runs a hook the
operator configures. Ephemeral machines are skipped.

Module: `electron/vm-protection-hook.mjs` (`runProtectionHook`).

| Variable | Meaning |
| --- | --- |
| `SAGAX_VM_AGENT_INSTALL_SCRIPT` | Host path of the install script. Unset = feature off. |
| `SAGAX_VM_AGENT_PACKAGE` | Optional installer package copied into the guest (`$AGENT_PACKAGE`). |
| `SAGAX_VM_AGENT_PACKAGE_SHA256` | Required with a package. A mismatch stops before install. |
| `SAGAX_VM_AGENT_HEALTH_SCRIPT` | Polled until exit 0 or the time limit. |
| `SAGAX_VM_AGENT_ROLLBACK_SCRIPT` | Run when install, health or secret cleanup fails. |
| `SAGAX_VM_AGENT_SECRET` | Optional enrollment secret: written to a root-only file (`$AGENT_SECRET_FILE`), removed after install, never in a command line, redacted from results. |
| `SAGAX_VM_AGENT_TIMEOUT_MS` | Health wait limit (default 60000). |

Flow: verify checksum → copy package → write secret file → install → wipe and
verify the secret is gone → health poll → on any failure, rollback.

Result: `{ status: "skipped" | "healthy" | "rolled-back" | "failed", step, detail }`.

Tests: `node --test electron/vm-protection-hook.node-test.mjs`.
