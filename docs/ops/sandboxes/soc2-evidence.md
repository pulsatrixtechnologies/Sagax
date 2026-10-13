# SOC 2 evidence for the sandbox pool

The controls are the AICPA Trust Services Criteria (2017) points of
focus that a SOC 2 examination tests. Each row is the artifact that an
auditor can be handed. An artifact shows the control was **designed**.
It is evidence the control **operated** only after the record named in
the last column is filled in. This change does not fill those records
and does not deploy.

| Piece | Artifact | Criteria | Operating evidence |
|---|---|---|---|
| Change review | `change-management.md`: pull request, second reviewer, CI | CC8.1, CC5.2, CC2.2 | The merged pull request and its review |
| Deploy history | `templates/change-record.md` filled at each apply | CC8.1, CC5.2 | The dated records (SHA, digest, approver, applier) |
| Emergency rollback | `cutover-rollback.md` (`SAGAX_SANDBOX_ROUTE=docker`) and the emergency paragraph in `change-management.md` | CC8.1, CC7.5, A1.2 | The incident timeline plus the following pull request |
| Capacity | cluster-autoscaler **or** Karpenter, min 0, reviewed max | A1.1 | The change record that set the max, and `SagaxSandboxPoolSaturated` history |
| Pending demand | `autoscaling/keda-pending-buffer.yaml` or `keda-queue.yaml` | A1.1 | The scale-up drill in the cutover, step 3 |
| Daytime warm node | `base/keda.yaml` (America/Toronto, weekdays 07:30–19:00) | A1.1, A1.2 | `SagaxSandboxWarmNotReady` not firing through a weekday |
| Health checks | Provisioner probes `GET /healthz:8791` in `base/sandboxd.yaml` | CC7.1, A1.2 | Ready status recorded after each cutover step |
| Monitoring and alerts | `base/prometheus-rules.yaml` | CC7.1, CC7.2, CC4.1 | Alert routing shown once, and the incident notes when one fires |
| Incident response | `incident-response.md`, one section per alert | CC7.2, CC7.3, CC7.4, CC7.5 | A closed incident's timeline, or a tabletop that used a real alert name |
| Backup | `base/velero-schedule.yaml` and the Azure Blob location | A1.2, CC9.1 | One successful backup older than the schedule |
| Restore drill | `backup-restore.md` and `templates/drill-record.md` | A1.3, CC7.5 | A filled drill record whose restore matched the RTO target or revised it |
| Cutover and rollback | `cutover-rollback.md`, with an estimate per step | A1.2, CC7.5, CC8.1 | The change record for the canary, including the rollback command that was ready |
| Access review | `access-review.md` and `base/rbac.yaml` | CC6.1, CC6.2, CC6.3 | A filled quarterly checklist |
| Network boundary | `base/networkpolicy.yaml` (private ranges and the Azure WireServer denied) and `networkpolicy-gox.yaml` | CC6.6, CC6.7, C1.1 | The review confirming the GOX subnet replaced `192.0.2.10/32` and the load balancer is internal |
| Isolation of the provisioner | Role limited to the namespace; sandbox pods do not mount a service account token | CC6.1, CC6.6 | The access-review diff against `rbac.yaml` |

Criteria in short:

- **CC2.2** information is communicated so people can carry out their responsibilities (the runbooks).
- **CC4.1** controls are monitored (alerts tied to a written response).
- **CC5.2** technology controls are applied (review before apply).
- **CC6.1** logical access. **CC6.2** access is authorized first. **CC6.3** access is removed. **CC6.6** outside traffic is limited. **CC6.7** movement of data is restricted.
- **CC7.1** detection. **CC7.2** anomalies are monitored. **CC7.3** events are evaluated. **CC7.4** incidents are answered. **CC7.5** recovery is carried out.
- **CC8.1** changes are authorized, tested, approved, and implemented.
- **CC9.1** risk is mitigated (off-site backups).
- **A1.1** capacity. **A1.2** backup and recovery infrastructure. **A1.3** recovery is tested.
- **C1.1** confidential data (workspaces) is protected at the boundary.
