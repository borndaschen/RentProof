import { execFile } from "node:child_process";

export type ProcessResult = Readonly<{ stdout: string; stderr: string }>;

export interface VideoProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    limits: Readonly<{ timeoutMs: number; maxOutputBytes: number }>,
  ): Promise<ProcessResult>;
}

export class NodeVideoProcessRunner implements VideoProcessRunner {
  async run(
    executable: string,
    args: readonly string[],
    limits: Readonly<{ timeoutMs: number; maxOutputBytes: number }>,
  ): Promise<ProcessResult> {
    return await new Promise((resolve, reject) => {
      execFile(
        executable,
        [...args],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: limits.timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: limits.maxOutputBytes,
          env: {
            NODE_ENV: process.env.NODE_ENV ?? "production",
            SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows",
          },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error("VIDEO_TOOL_PROCESS_FAILED", { cause: error }));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
  }
}
