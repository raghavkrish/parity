import { describe, expect, it } from "vitest";
import { RunTimeoutError, runWithBrowserTimeout } from "../src/jobs.js";

describe("runWithBrowserTimeout", () => {
  it(
    "closes Chromium and throws when the timer fires",
    async () => {
      let closed = false;
      await expect(
        runWithBrowserTimeout(80, async (browser) => {
          browser.on("disconnected", () => {
            closed = true;
          });
          await new Promise((resolve) => setTimeout(resolve, 8_000));
          return "done";
        }),
      ).rejects.toBeInstanceOf(RunTimeoutError);
      expect(closed).toBe(true);
    },
    20_000,
  );
});
