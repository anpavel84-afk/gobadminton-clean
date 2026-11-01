import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("DEV worker binds accepted registry manifest ref, not Docker config ID", () => {
    expect(() => execFileSync("python3", [path.resolve(__dirname, "../../../../scripts/mail/test_dev_worker.py")], { stdio: "pipe" })).not.toThrow();
});
