// The Local VM on this computer in server mode (electron/local-vm.mjs), with
// a fake container CLI: which runtime is found, the stale container a test
// once left on a developer's Mac, its repair, and the server recipe check.
import assert from "node:assert/strict";
import test from "node:test";

import { createLocalVm, detectRuntime, judgeContainer, productFromEndpoint, startRuntimeArgv, validLocalVmSpec } from "./local-vm.mjs";

const HOME = "/Users/ada";
const DATA = `${HOME}/.openmausbot`;
const WORKSPACE = `${DATA}/vm-home`;
const STALE = "/private/var/folders/5f/x/T/omb-org-mcp-Em133z/.openmausbot/vm-home";
const IMAGE = "localhost/openmausbot/cua-local-vm:driver-0.20.0-v5";
const BASE = `docker.io/trycua/xfce-cua@sha256:${"a".repeat(64)}`;
const ok = stdout => ({ code: 0, stdout, stderr: "" });
const no = stderr => ({ code: 1, stdout: "", stderr });

function spec() {
  const run = runtime => ["run", "-d", "--name", "openmausbot-computer", ...(runtime === "podman" ? ["--userns", "keep-id:uid=1000,gid=1000"] : []),
    "--label", "com.openmausbot.local-vm=1", "--label", "com.openmausbot.workspace-path=__SAGAX_WORKSPACE__",
    "--cap-drop", "ALL", "--cap-add", "SETUID", "--mount", "type=bind,source=__SAGAX_WORKSPACE__,target=/home/cua/workspace",
    "-e", "VNC_PW=__SAGAX_VNC_PW__", "-p", "127.0.0.1:6080:6901", IMAGE];
  return { version: 1, container: "openmausbot-computer", image: IMAGE, baseImage: BASE, imageLabels: { "com.openmausbot.local-vm": "1", "com.openmausbot.cua-driver": "0.20.0" }, dockerfile: `FROM ${BASE}\nUSER root\n`, run: { docker: run("docker"), podman: run("podman") } };
}

function container({ source = WORKSPACE, label = WORKSPACE, running = false, labels = {} } = {}) {
  return { Name: "/openmausbot-computer", State: { Running: running, Status: running ? "running" : "exited" }, Config: { Image: IMAGE, Labels: { "com.openmausbot.local-vm": "1", ...(label ? { "com.openmausbot.workspace-path": label } : {}), ...labels } }, Mounts: [{ Type: "bind", Source: source, Destination: "/home/cua/workspace" }] };
}

/** A fake Docker Desktop with one container, recording every call. */
function fakeDocker({ existing, imageReady = true, daemonUp = true } = {}) {
  const calls = [];
  let current = existing;
  const exec = async argv => {
    calls.push(argv.join(" "));
    const [, verb, ...rest] = argv;
    if (verb === "version") return ok("27.3.1\n");
    if (verb === "info") return daemonUp ? ok("Docker Desktop\n") : no("Cannot connect to the Docker daemon");
    if (verb === "context") return ok(`unix://${HOME}/.docker/run/docker.sock\n`);
    if (verb === "ps") return ok(current ? `openmausbot-computer\t${current.State.Running ? "running" : "exited"}\n` : "");
    if (verb === "inspect") return current && rest[0] === "openmausbot-computer" ? ok(JSON.stringify([current])) : no("No such object");
    if (verb === "image") return imageReady ? ok(JSON.stringify([{ Config: { Labels: spec().imageLabels } }])) : no("No such image");
    if (verb === "rm") { current = undefined; return ok(""); }
    if (verb === "run") {
      const mount = rest[rest.indexOf("--mount") + 1];
      const source = /source=([^,]+)/.exec(mount)[1];
      current = container({ source, label: source });
      return ok("abc\n");
    }
    if (verb === "start") { current.State.Running = true; return ok(""); }
    return ok("");
  };
  return { exec, calls, get current() { return current; } };
}

const exists = extra => file => [WORKSPACE, `${HOME}/.docker/run/docker.sock`, "/Applications/Docker.app", ...extra].includes(file);
const settle = async vm => { for (let i = 0; i < 50; i++) { const status = JSON.parse((await vm.status()).content[0].text); if (status.setup?.state !== "running") return status; await new Promise(r => setTimeout(r, 5)); } throw new Error("setup never finished"); };

test("detection names the runtime it found, even with a bare PATH", async () => {
  const docker = fakeDocker();
  const found = await detectRuntime({ exec: docker.exec, home: HOME, platform: "darwin", env: { PATH: "/usr/bin:/bin" }, exists: exists([]) });
  assert.equal(found.runtime, "docker");
  assert.equal(found.product, "Docker Desktop");
  assert.equal(found.daemonUp, true);
  assert.deepEqual(found.installed, ["Docker Desktop"]);
  // A stopped engine is still "found": the product is installed.
  const stopped = await detectRuntime({ exec: fakeDocker({ daemonUp: false }).exec, home: HOME, platform: "darwin", env: {}, exists: exists([]) });
  assert.equal(stopped.daemonUp, false);
  assert.equal(stopped.product, "Docker Desktop");
  // Nothing at all.
  const none = await detectRuntime({ exec: async () => no("ENOENT"), home: HOME, platform: "darwin", env: {}, exists: () => false });
  assert.deepEqual({ found: none.found, runtime: none.runtime }, { found: false, runtime: null });
});

test("detection matrix: each product from its endpoint", () => {
  assert.equal(productFromEndpoint(`unix://${HOME}/.orbstack/run/docker.sock`), "OrbStack");
  assert.equal(productFromEndpoint(`unix://${HOME}/.colima/default/docker.sock`), "Colima");
  assert.equal(productFromEndpoint(`unix://${HOME}/.rd/docker.sock`), "Rancher Desktop");
  assert.equal(productFromEndpoint(`unix://${HOME}/.docker/run/docker.sock`), "Docker Desktop");
  assert.equal(productFromEndpoint("npipe:////./pipe/docker_engine"), "Docker Desktop");
  assert.equal(productFromEndpoint("unix:///run/user/501/podman/podman.sock"), "Podman");
  assert.equal(productFromEndpoint("unix:///var/run/docker.sock", "OrbStack"), "OrbStack");
  assert.equal(productFromEndpoint("unix:///var/run/docker.sock", "Ubuntu 24.04"), "Docker");
  assert.equal(productFromEndpoint(""), null);
  assert.deepEqual(startRuntimeArgv("OrbStack", { platform: "darwin" }), ["open", "-a", "OrbStack"]);
  assert.deepEqual(startRuntimeArgv("Colima", { platform: "darwin" }), ["colima", "start"]);
});

test("a container bound to a deleted temp folder is stale, never started as is", async () => {
  const judged = judgeContainer(container({ source: STALE, label: null }), { workspace: WORKSPACE, platform: "darwin", exists: exists([]) });
  assert.equal(judged.stale, "missing_folder");
  assert.equal(judgeContainer(container({ source: "/host_mnt/Users/ada/.openmausbot/vm-home" }), { workspace: WORKSPACE, platform: "darwin", exists: exists([]) }).stale, null);
  assert.equal(judgeContainer(container({ source: "/Users/bob/vm-home", label: "/Users/bob/vm-home" }), { workspace: WORKSPACE, platform: "darwin", exists: () => true }).stale, "other_folder");
  assert.equal(judgeContainer(container({ labels: { "com.openmausbot.test-run": "t1" } }), { workspace: WORKSPACE, platform: "darwin", exists: exists([]) }).stale, "test_container");
  const foreign = container(); delete foreign.Config.Labels["com.openmausbot.local-vm"];
  assert.equal(judgeContainer(foreign, { workspace: WORKSPACE, platform: "darwin", exists: exists([]) }).stale, "foreign");

  const docker = fakeDocker({ existing: container({ source: STALE, label: null }) });
  const vm = createLocalVm({ exec: docker.exec, dataDir: DATA, home: HOME, platform: "darwin", env: {}, exists: exists([]) });
  await assert.rejects(vm.start(), /another folder.*no longer exists.*Repair/);
  assert.ok(!docker.calls.some(call => call.includes(" start ")));
  const status = JSON.parse((await vm.status()).content[0].text);
  assert.equal(status.vm.stale, "missing_folder");
  assert.equal(status.runtime.product, "Docker Desktop");
});

test("setup repairs the stale container on this app's folder, in steps", async () => {
  const docker = fakeDocker({ existing: container({ source: STALE, label: null }) });
  const made = [];
  const vm = createLocalVm({ exec: docker.exec, dataDir: DATA, home: HOME, platform: "darwin", env: {}, exists: exists([]), mkdir: async dir => { made.push(dir); } });
  const first = JSON.parse((await vm.setup(spec())).content[0].text);
  assert.equal(first.setup.state, "running");
  const status = await settle(vm);
  assert.equal(status.setup.state, "done", JSON.stringify(status.setup));
  assert.deepEqual(status.setup.steps.map(step => [step.id, step.state]), [["runtime", "done"], ["image", "done"], ["container", "done"], ["start", "done"]]);
  assert.ok(docker.calls.includes("docker rm -f openmausbot-computer"));
  const run = docker.calls.find(call => call.startsWith("docker run "));
  assert.match(run, new RegExp(`source=${WORKSPACE},`));
  assert.match(run, new RegExp(`com.openmausbot.workspace-path=${WORKSPACE}`));
  assert.doesNotMatch(run, /__SAGAX_/);
  assert.deepEqual(made, [WORKSPACE]);
  assert.equal(docker.current.State.Running, true);
  // Idempotent: a healthy running VM is left alone.
  const before = docker.calls.length;
  await vm.setup(spec());
  await settle(vm);
  assert.ok(!docker.calls.slice(before).some(call => / (rm|run) /.test(call)));
});

test("setup keeps a real folder it was bound to and prepares a missing image", async () => {
  const other = "/Users/ada/old-data/vm-home";
  const docker = fakeDocker({ existing: container({ source: other, label: other }), imageReady: false });
  const vm = createLocalVm({ exec: docker.exec, dataDir: DATA, home: HOME, platform: "darwin", env: {}, exists: file => file === other || exists([])(file), mkdir: async () => {}, makeTemp: async () => "/tmp/ctx", writeFile: async () => {}, removeDir: async () => {} });
  await vm.setup(spec());
  const status = await settle(vm);
  assert.equal(status.setup.state, "done");
  assert.equal(status.setup.previousFolder, other);
  assert.ok(docker.calls.includes(`docker pull ${BASE}`));
  assert.ok(docker.calls.includes(`docker build -t ${IMAGE} /tmp/ctx`));
});

test("setup never touches a container Sagax did not create", async () => {
  const foreign = container(); delete foreign.Config.Labels["com.openmausbot.local-vm"];
  const docker = fakeDocker({ existing: foreign });
  const vm = createLocalVm({ exec: docker.exec, dataDir: DATA, home: HOME, platform: "darwin", env: {}, exists: exists([]) });
  await vm.setup(spec());
  const status = await settle(vm);
  assert.equal(status.setup.state, "error");
  assert.equal(status.setup.code, "foreign_container");
  assert.ok(!docker.calls.some(call => / (rm|run) /.test(call)));
});

test("setup without any runtime says so (the UI then offers an install)", async () => {
  const vm = createLocalVm({ exec: async () => no("ENOENT"), dataDir: DATA, home: HOME, platform: "darwin", env: {}, exists: () => false });
  await vm.setup(spec());
  const status = await settle(vm);
  assert.equal(status.setup.code, "no_runtime");
});

test("the server's recipe is checked before anything runs from it", () => {
  assert.equal(validLocalVmSpec(spec()), true);
  const tamper = change => { const value = spec(); change(value); return validLocalVmSpec(value); };
  assert.equal(tamper(value => value.run.docker.splice(1, 0, "--privileged")), false);
  assert.equal(tamper(value => value.run.docker.splice(1, 0, "-v", "/:/host")), false);
  assert.equal(tamper(value => { value.run.docker[value.run.docker.indexOf("-p") + 1] = "0.0.0.0:6080:6901"; }), false);
  assert.equal(tamper(value => value.run.docker.splice(1, 0, "--network", "host")), false);
  assert.equal(tamper(value => { value.run.docker[value.run.docker.indexOf("--name") + 1] = "other"; }), false);
  assert.equal(tamper(value => { value.image = "docker.io/evil/image:1"; }), false);
  assert.equal(tamper(value => value.run.podman.splice(1, 0, "-e", "LD_PRELOAD=/x")), false);
  assert.equal(tamper(value => value.run.docker.splice(1, 0, "--cap-add", "SYS_ADMIN")), false);
});

test("install asks the person first and only opens the vendor's page", async () => {
  const opened = [];
  const refuse = createLocalVm({ exec: async () => no(""), confirm: async () => false, openExternal: async url => opened.push(url), exists: () => false });
  await assert.rejects(refuse.install("orbstack-download"), /cancelled/);
  assert.deepEqual(opened, []);
  const accept = createLocalVm({ exec: async () => no(""), confirm: async () => true, openExternal: async url => opened.push(url), exists: () => false });
  await accept.install("orbstack-download");
  assert.deepEqual(opened, ["https://orbstack.dev/download"]);
  await assert.rejects(accept.install("rm -rf"), /Unknown/);
  await assert.rejects(accept.install("orbstack-brew"), /Homebrew is not installed/);
});

test("pause, resume and stop act on the person's VM only", async () => {
  const docker = fakeDocker({ existing: container({ running: true }) });
  const vm = createLocalVm({ exec: docker.exec, dataDir: DATA, home: HOME, platform: "darwin", env: {}, exists: exists([]) });
  await vm.power("pause");
  assert.ok(docker.calls.includes("docker pause openmausbot-computer"));
  await vm.power("stop");
  assert.ok(docker.calls.includes("docker stop openmausbot-computer"));
});
