import { describe, expect, it } from "vitest";
import { NodeVideoProcessRunner } from "./node-process-runner";

describe("NodeVideoProcessRunner", () => {
  it("captures bounded output from an absolute executable", async () => {
    await expect(
      new NodeVideoProcessRunner().run(process.execPath, ["-e", 'process.stdout.write("ok")'], {
        timeoutMs: 2_000,
        maxOutputBytes: 64,
      }),
    ).resolves.toEqual({ stdout: "ok", stderr: "" });
  });

  it("terminates a process at the configured timeout", async () => {
    await expect(
      new NodeVideoProcessRunner().run(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
        timeoutMs: 50,
        maxOutputBytes: 64,
      }),
    ).rejects.toThrow("VIDEO_TOOL_PROCESS_FAILED");
  });

  it("rejects output beyond the configured buffer", async () => {
    await expect(
      new NodeVideoProcessRunner().run(
        process.execPath,
        ["-e", 'process.stdout.write("x".repeat(1024))'],
        { timeoutMs: 2_000, maxOutputBytes: 64 },
      ),
    ).rejects.toThrow("VIDEO_TOOL_PROCESS_FAILED");
  });
});
