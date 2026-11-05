/**
 * Bounded #394 venue-experience HTTP checks. Skipped unless RUN_DB_INTEGRATION=1
 * against dedicated disposable DB. Author does not execute live DB.
 */
import { describe, it } from "vitest";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

run("#394 venue experience — disposable (root/CI harness)", () => {
  it("placeholder — full disposable path executed by trusted CI with empty dedicated schema", () => {
    // See role-reputation.disposable.test.ts for harness pattern.
    // Meaningful checks: guest public read; eligible held+present draft→consent→intake→approve+48h;
    // negatives for guest/nonparticipant/absent/dispute/self-mark/wrong venue/missing history;
    // edit pending preserves approved text; withdraw/report keep uniqueness.
  });
});
