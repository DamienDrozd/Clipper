import { spawn } from "node:child_process";

/** Échec d'un processus externe, avec la fin de sa sortie d'erreur. */
export class ProcessError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    const lastLine = stderr.trim().split(/\r?\n/).at(-1) ?? "";
    super(`${command} a échoué (code ${exitCode}) : ${lastLine}`);
    this.name = "ProcessError";
  }
}

/** Binaire introuvable (ENOENT). */
export class MissingBinaryError extends Error {
  constructor(readonly command: string) {
    super(`Programme introuvable : ${command}`);
    this.name = "MissingBinaryError";
  }
}

const STDERR_TAIL_LINES = 40;

/**
 * Lance un programme sans shell. Les lignes de stdout et stderr sont transmises aux callbacks ;
 * le processus est tué si `signal` est annulé (l'erreur rejetée est alors `signal.reason`).
 */
export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
  } = {},
): Promise<void> {
  const { cwd, signal, onStdoutLine, onStderrLine } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);

    const child = spawn(command, args, { cwd, signal, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stderrTail: string[] = [];

    const lines = (onLine: (line: string) => void) => {
      let buffer = "";
      return (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const parts = buffer.split(/\r\n|\r|\n/);
        buffer = parts.pop() ?? "";
        for (const line of parts) if (line) onLine(line);
      };
    };

    child.stdout.on("data", lines((line) => onStdoutLine?.(line)));
    child.stderr.on(
      "data",
      lines((line) => {
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        onStderrLine?.(line);
      }),
    );

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (signal?.aborted) return reject(signal.reason);
      reject(error.code === "ENOENT" ? new MissingBinaryError(command) : error);
    });
    child.on("close", (code) => {
      if (signal?.aborted) return reject(signal.reason);
      if (code === 0) resolve();
      else reject(new ProcessError(command, code, stderrTail.join("\n")));
    });
  });
}
