# Health scan

A separate process reads the local logs and databases and writes a report.
It does not modify those files. It does not call a model. It does not open
a ticket. If the app is not running, the scan still reads whatever files
are on disk.

```
node --experimental-strip-types server/health-scan.ts --data <data directory>
```

Or `pnpm health-scan` with `SAGAX_DATA_DIR` set. The report is
`health-reports/latest.md` inside that directory. Message text is not
copied. Failures are grouped by a short code.

```
GET /api/me/health-report
```

The answer is `{ report: null }` until a scan has written one, then the
markdown. Any signed-in person can read it. No admin right.
