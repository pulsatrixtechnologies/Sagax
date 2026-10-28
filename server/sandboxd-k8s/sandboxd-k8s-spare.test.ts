import { describe, expect, it } from "vitest";

import type { K8sClient, K8sResponse } from "./sandboxd-k8s-client.ts";
import { desiredSpare, SpareScaler, spareConfigFromEnv } from "./sandboxd-k8s-spare.ts";

describe("spare reserve that follows the people at work (2026-10-26)", () => {
  it("is none while nobody works, one while someone does, none once the most expected are there", () => {
    const config = { count: 1, maxActive: 4 };
    expect([0, 1, 2, 3, 4, 5].map((active) => desiredSpare(active, config))).toEqual([0, 1, 1, 1, 0, 0]);
    expect([0, 1, 2, 3].map((active) => desiredSpare(active, { count: 2, maxActive: 4 }))).toEqual([0, 2, 2, 1]);
  });

  it("reads its settings, off when the deployment is not named", () => {
    expect(spareConfigFromEnv({}, 4)).toBeNull();
    expect(spareConfigFromEnv({ SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT: "sagax-sandbox-system/sagax-sandbox-spare" }, 4))
      .toEqual({ namespace: "sagax-sandbox-system", deployment: "sagax-sandbox-spare", count: 1, maxActive: 4 });
    expect(spareConfigFromEnv({ SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT: "a/b", SAGAX_SANDBOX_K8S_SPARE_COUNT: "2", SAGAX_SANDBOX_K8S_SPARE_MAX_ACTIVE: "6" }, 4))
      .toMatchObject({ count: 2, maxActive: 6 });
    expect(() => spareConfigFromEnv({ SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT: "only-a-name" }, 4)).toThrow(/namespace/);
    expect(() => spareConfigFromEnv({ SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT: "a/b", SAGAX_SANDBOX_K8S_SPARE_COUNT: "-1" }, 4)).toThrow(/COUNT/);
  });

  it("counts the sandbox Pods and writes only the scale of its one Deployment, when it changes", async () => {
    let pods: { phase: string; deleting?: boolean }[] = [];
    let replicas = 0;
    const calls: string[] = [];
    const client = {
      async request(method: string, path: string, body?: unknown): Promise<K8sResponse> {
        calls.push(`${method} ${path.split("?")[0]}`);
        if (path.startsWith("/api/v1/namespaces/sandboxes/pods?")) {
          expect(decodeURIComponent(path)).toContain("labelSelector=com.pulsatrix.sagax.sandbox.user,com.pulsatrix.sagax.sandbox.instance=gx");
          return { status: 200, body: { items: pods.map((pod) => ({ metadata: pod.deleting ? { deletionTimestamp: "x" } : {}, status: { phase: pod.phase } })) } };
        }
        if (path === "/apis/apps/v1/namespaces/sys/deployments/spare/scale") {
          if (method === "GET") return { status: 200, body: { spec: { replicas } } };
          replicas = (body as { spec: { replicas: number } }).spec.replicas;
          return { status: 200, body: {} };
        }
        return { status: 404, body: {} };
      },
    } as unknown as K8sClient;
    const lines: string[] = [];
    const scaler = new SpareScaler(client, "sandboxes", "gx", { namespace: "sys", deployment: "spare", count: 1, maxActive: 4 }, (line) => lines.push(line));

    await scaler.reconcile();
    expect(replicas).toBe(0);
    expect(calls.filter((call) => call.startsWith("PATCH"))).toHaveLength(0);

    pods = [{ phase: "Pending" }];
    await scaler.reconcile();
    expect(replicas).toBe(1);

    pods = [{ phase: "Running" }, { phase: "Running" }, { phase: "Running" }, { phase: "Pending" }];
    await scaler.reconcile();
    expect(replicas).toBe(0);

    pods = [{ phase: "Running", deleting: true }, { phase: "Succeeded" }];
    replicas = 2; // a schedule changed it meanwhile: set back
    await scaler.reconcile();
    expect(replicas).toBe(0);
    expect(calls.every((call) => call.includes("/namespaces/sandboxes/pods") || call.endsWith("/deployments/spare/scale"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/[0-9a-f]{32}/);
  });

  it("never throws: a missing Deployment is logged and nothing else changes", async () => {
    const client = { request: async (): Promise<K8sResponse> => ({ status: 200, body: { items: [{ status: { phase: "Running" } }] } }) } as unknown as K8sClient;
    const missing = { request: async (_m: string, path: string): Promise<K8sResponse> => path.includes("/pods") ? { status: 200, body: { items: [] } } : { status: 404, body: {} } } as unknown as K8sClient;
    const lines: string[] = [];
    await new SpareScaler(missing, "sandboxes", "gx", { namespace: "sys", deployment: "spare", count: 1, maxActive: 4 }, (line) => lines.push(line)).reconcile();
    expect(lines[0]).toMatch(/not found/);
    await expect(new SpareScaler(client, "sandboxes", "gx", { namespace: "sys", deployment: "spare", count: 1, maxActive: 4 }, () => {}).reconcile()).resolves.toBeUndefined();
  });
});
