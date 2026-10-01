// An in-memory DockerApi for the sandbox provisioner tests: records every
// create body so the tests can assert what would reach a real daemon.
import type { ContainerSummary, DockerApi, ExecRequest, ExecResult } from "../sandboxd-docker.ts";

export class FakeDocker implements DockerApi {
  containers = new Map<string, { running: boolean; labels: Record<string, string>; spec: Record<string, unknown>; startedAt: number }>();
  networks = new Map<string, { labels: Record<string, string>; subnets: string[]; spec: Record<string, unknown> }>();
  volumes = new Map<string, { labels: Record<string, string> }>();
  images = new Set<string>(["sagax-sandbox:test"]);
  calls: string[] = [];
  execs: { name: string; exec: ExecRequest }[] = [];
  execResult: (exec: ExecRequest) => ExecResult = () => ({ exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0), truncated: false });
  helperOutput = { exitCode: 0, output: "sagax-egress-ok\n" };
  now: () => number = Date.now;

  async ping() { return true; }
  async imageExists(image: string) { return this.images.has(image); }
  async inspectContainer(name: string): Promise<ContainerSummary | null> {
    const found = this.containers.get(name);
    return found ? { name, running: found.running, labels: found.labels, startedAt: found.startedAt } : null;
  }
  async listContainers(labels: Record<string, string>) {
    return [...this.containers].filter(([, value]) => Object.entries(labels).every(([key, want]) => value.labels[key] === want))
      .map(([name, value]) => ({ name, running: value.running, labels: value.labels, startedAt: value.startedAt }));
  }
  async createContainer(name: string, spec: Record<string, unknown>) {
    this.calls.push(`create ${name}`);
    if (this.containers.has(name)) throw new Error("conflict");
    this.containers.set(name, { running: false, labels: (spec.Labels ?? {}) as Record<string, string>, spec, startedAt: 0 });
  }
  async startContainer(name: string) {
    this.calls.push(`start ${name}`);
    const found = this.containers.get(name);
    if (!found) throw new Error("no such container");
    found.running = true;
    found.startedAt = this.now();
  }
  async stopContainer(name: string) {
    this.calls.push(`stop ${name}`);
    const found = this.containers.get(name);
    if (found) found.running = false;
  }
  async removeContainer(name: string) { this.calls.push(`rm ${name}`); this.containers.delete(name); }
  async inspectNetwork(name: string) {
    const found = this.networks.get(name);
    return found ? { labels: found.labels, subnets: found.subnets } : null;
  }
  async listNetworks(labels: Record<string, string>) {
    return [...this.networks].filter(([, value]) => Object.entries(labels).every(([key, want]) => value.labels[key] === want))
      .map(([name, value]) => ({ name, subnets: value.subnets }));
  }
  async createNetwork(spec: Record<string, unknown>) {
    const name = String(spec.Name);
    this.calls.push(`net ${name}`);
    const subnets = ((spec.IPAM as { Config: { Subnet: string }[] }).Config).map((entry) => entry.Subnet);
    this.networks.set(name, { labels: (spec.Labels ?? {}) as Record<string, string>, subnets, spec });
  }
  async removeNetwork(name: string) { this.calls.push(`rmnet ${name}`); this.networks.delete(name); }
  async inspectVolume(name: string) { return this.volumes.get(name) ?? null; }
  async createVolume(spec: Record<string, unknown>) {
    this.calls.push(`vol ${String(spec.Name)}`);
    this.volumes.set(String(spec.Name), { labels: (spec.Labels ?? {}) as Record<string, string> });
  }
  async removeVolume(name: string) { this.calls.push(`rmvol ${name}`); this.volumes.delete(name); }
  async exec(name: string, exec: ExecRequest) {
    if (!this.containers.get(name)?.running) throw new Error("container not running");
    this.execs.push({ name, exec });
    return this.execResult(exec);
  }
  async runOnce(name: string) {
    this.calls.push(`helper ${name}`);
    return this.helperOutput;
  }
}
