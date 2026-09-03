import type { z } from "zod";
import { JsonCaseStateRepository, WindowsJsonStateFilesystem } from "@/adapters/storage/json-state";
import {
  cleanupStoppedFormalRun,
  cleanupWindowsRuntime,
  createWindowsRuntimeRun,
  NodeWindowsRuntimePlatformProbe,
  preflightWindowsRuntimePath,
  type RuntimeLifecycleOptions,
} from "@/adapters/storage/windows-runtime";

export interface WindowsJsonRuntimeCompositionInput<TState> extends Omit<
  RuntimeLifecycleOptions,
  "runtime" | "probe"
> {
  explicitRuntimeDir?: string | undefined;
  localAppData?: string | undefined;
  runKind: "development" | "formal_demo";
  stateSchema: z.ZodType<TState>;
}

/** Server composition root for the single-process P0 JSON repository. */
export async function composeWindowsJsonRuntime<TState>(
  input: WindowsJsonRuntimeCompositionInput<TState>,
) {
  const probe = new NodeWindowsRuntimePlatformProbe();
  const runtime = await preflightWindowsRuntimePath(
    {
      explicitRuntimeDir: input.explicitRuntimeDir,
      localAppData: input.localAppData,
      repositoryRoot: input.repositoryRoot,
      demoRoot: input.demoRoot,
      publicRoot: input.publicRoot,
      userProfile: input.userProfile,
      ...(input.documentsRoots === undefined ? {} : { documentsRoots: input.documentsRoots }),
      ...(input.oneDriveRoots === undefined ? {} : { oneDriveRoots: input.oneDriveRoots }),
    },
    probe,
  );
  const lifecycle: RuntimeLifecycleOptions = {
    runtime,
    probe,
    repositoryRoot: input.repositoryRoot,
    demoRoot: input.demoRoot,
    publicRoot: input.publicRoot,
    userProfile: input.userProfile,
    ...(input.documentsRoots === undefined ? {} : { documentsRoots: input.documentsRoots }),
    ...(input.oneDriveRoots === undefined ? {} : { oneDriveRoots: input.oneDriveRoots }),
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.processId === undefined ? {} : { processId: input.processId }),
    ...(input.isProcessAlive === undefined ? {} : { isProcessAlive: input.isProcessAlive }),
  };

  await cleanupWindowsRuntime(lifecycle, "development_expired_and_abandoned_formal");
  const handle = await createWindowsRuntimeRun(lifecycle, input.runKind);
  const filesystem = new WindowsJsonStateFilesystem({
    run: handle.run,
    probe,
    onSuccessfulWrite: (writtenAt) => handle.touch(writtenAt),
  });
  const repository = new JsonCaseStateRepository(filesystem, input.stateSchema);

  return {
    repository,
    run: handle.run,
    async stop(): Promise<void> {
      if (input.runKind === "formal_demo") {
        await cleanupStoppedFormalRun(lifecycle, handle);
      } else {
        await handle.stop();
      }
    },
  };
}
