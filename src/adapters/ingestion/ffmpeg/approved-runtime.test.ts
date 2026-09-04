import { describe, expect, it } from "vitest";
import { GYAN_FFMPEG_9_0_1_ESSENTIALS_PIN } from "./approved-runtime";

describe("approved FFmpeg runtime identity", () => {
  it("pins the reviewed binary hashes and complete version output", () => {
    expect(GYAN_FFMPEG_9_0_1_ESSENTIALS_PIN).toEqual({
      ffmpegSha256: "72a489eccd008c2ec2c0a5856c5c75bc3d8bbfa90166c4566865c246445e6aa3",
      ffprobeSha256: "19202b23c0043f15ad1b7bce2344f406fd52bd6efd8f995ce02e7392a1cec52f",
      ffmpegVersion:
        "ffmpeg version 9.0.1-essentials_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers",
      ffprobeVersion:
        "ffprobe version 9.0.1-essentials_build-www.gyan.dev Copyright (c) 2007-2026 the FFmpeg developers",
    });
  });
});
