# Endpoint protection (SentinelOne)

Sagax installs the SentinelOne agent on a persistent local virtual machine
the first time that machine boots, when all of the following are true:

- The machine is persistent. The Computer tab recipe sets `persistent: true`.
  An ephemeral machine (`persistent: false`), including one created for a
  single task, is left alone.
- The organization has not turned the control off. The switch is
  `organization.sentinelOneVmAgent` (Settings > Organization). Absent means
  on. A solo server has no organization switch; the install still runs when
  the token below is set.
- `SAGAX_S1_SITE_TOKEN` is set in the server environment. A missing token
  does not install the agent and does not hold the machine: readiness stays
  whatever the desktop reported. This is so a server that has not been given
  a token keeps working.

The token is the site token for **Pulsatrix Technologies Inc.** The site
policy is detect-only. Sagax does not call the SentinelOne API; the token
associates the agent with that site.

The token stays in the server process. At install time it is written to a
root-only file in the guest (`/run/sagax-s1.token` on Linux,
`C:\Windows\Temp\sagax-s1.token` on Windows, `/private/tmp/sagax-s1.token` on
macOS). The installer reads that file. The file is removed before the
outcome is reported, including when the install fails. The token is not an
argument, a guest environment variable, a log line, an audit field, or an
API field. A guest that still shows the token after install is reported as
failed, and the file is removed again.

The machine is marked ready only after the agent reports online, and only
when install was required. The wait is bounded. On failure the status is
`failed` with a clear error, and an administrator can retry. Each install
attempt (success or failure) writes one `computer.sentinelone_install` row
to the admin activity log: operating system, the persistent flag, the
result, the site name, and the detect-only policy. The row does not contain
the token. A skip, and an agent that was already online, do not write a row.

Packages are files the operator provides (`SAGAX_S1_PACKAGE_DEB`,
`SAGAX_S1_PACKAGE_RPM`, `SAGAX_S1_PACKAGE_MSI`, `SAGAX_S1_PACKAGE_PKG`).
Sagax does not download them.

## Kubernetes

Kubernetes nodes that run Sagax get the SentinelOne agent **per node**, as a
DaemonSet. The agent is not installed inside each per-person sandbox or
container. A sandbox is a workload on a node that is already protected.
