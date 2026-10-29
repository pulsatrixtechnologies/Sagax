// The working line's step for a tool call that just started
// (shared/working-step.ts), with its detail passed through the server's
// secret redaction before it rides on the activity row: a detail is only a
// file, app, host or program name, but a token pasted where a file name
// should be must still never reach a client.
import { workingStepFor, type WorkingStep, type WorkingStepCall } from "../shared/working-step.ts";
import { redactSecretsInText } from "./redact.ts";

export function toolWorkingStep(call: WorkingStepCall): WorkingStep | undefined {
  const step = workingStepFor(call);
  if (!step) return undefined;
  if (step.detail === undefined) return step;
  const detail = redactSecretsInText(step.detail);
  // anything the redaction touched is dropped, not shown half masked
  return detail === step.detail ? step : { key: step.key };
}
