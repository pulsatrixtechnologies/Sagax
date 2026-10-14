// The sandbox admission policy reads scanner.result.Summary.Critical and
// scanner.result.Summary.High on a cosign vulnerability predicate
// (https://cosign.sigstore.dev/attestation/vuln/v1). Trivy's cosign-vuln
// record does not include Summary, so the publish job adds those two counts
// from the scan before `cosign attest --type vuln`.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function severityCounts(predicate) {
  const results = predicate?.scanner?.result?.Results ?? [];
  if (!Array.isArray(results)) throw new Error("scanner.result.Results is not a list");
  let critical = 0;
  let high = 0;
  for (const result of results) {
    const vulnerabilities = result?.Vulnerabilities ?? [];
    if (!Array.isArray(vulnerabilities)) throw new Error("scanner.result.Results[].Vulnerabilities is not a list");
    for (const vulnerability of vulnerabilities) {
      if (vulnerability?.Severity === "CRITICAL") critical += 1;
      else if (vulnerability?.Severity === "HIGH") high += 1;
    }
  }
  return { Critical: critical, High: high };
}

// One predicate for the image index. Results from each platform scan are
// kept, and Summary is the count the admission policy compares with zero.
export function mergeVulnPredicates(predicates) {
  if (!Array.isArray(predicates) || predicates.length === 0) {
    throw new Error("expected at least one vulnerability predicate");
  }
  const base = structuredClone(predicates[0]);
  if (!base?.scanner || typeof base.scanner !== "object") {
    throw new Error("vulnerability predicate is missing scanner");
  }
  const results = [];
  for (const predicate of predicates) {
    const found = predicate?.scanner?.result?.Results ?? [];
    if (!Array.isArray(found)) throw new Error("scanner.result.Results is not a list");
    results.push(...found);
  }
  const current = base.scanner.result;
  const result = current && typeof current === "object" ? { ...current, Results: results } : { Results: results };
  result.Summary = severityCounts({ scanner: { result } });
  base.scanner = { ...base.scanner, result };
  return base;
}

function main() {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || inputs.length === 0) {
    console.error("usage: node scripts/vuln-attestation.mjs <out.json> <predicate.json>...");
    process.exit(2);
  }
  const predicates = inputs.map((path) => JSON.parse(readFileSync(path, "utf8")));
  const merged = mergeVulnPredicates(predicates);
  writeFileSync(out, `${JSON.stringify(merged)}\n`);
  const { Critical, High } = merged.scanner.result.Summary;
  console.log(`vulnerability attestation summary: critical=${Critical} high=${High}`);
  if (Critical > 0 || High > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
