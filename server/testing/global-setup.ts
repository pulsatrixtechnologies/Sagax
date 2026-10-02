// Vitest global setup: one Local VM namespace for the whole run (see
// local-vm-namespace.ts), inherited by every worker, and its containers
// removed when the run ends.
import { newLocalVmTestNamespace, removeTestLocalVms } from "./local-vm-namespace.ts";

export default function setup() {
  const namespace = process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE || newLocalVmTestNamespace();
  process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE = namespace;
  return async () => { await removeTestLocalVms(namespace); };
}
