import { execSync } from "child_process";

let dudeAvailable: boolean | null = null;

export function hasDude(): boolean {
  if (dudeAvailable !== null) return dudeAvailable;
  try {
    execSync("which dude", { stdio: "pipe" });
    dudeAvailable = true;
  } catch {
    dudeAvailable = false;
  }
  return dudeAvailable;
}

/**
 * Create a dude task record for a starting job.
 * Returns the task ID if successful, null otherwise.
 */
export function createDudeTask(description: string): string | null {
  if (!hasDude()) return null;
  try {
    const result = execSync(`dude add "${description.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    const match = result.match(/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Update a dude task with completion status.
 */
export function completeDudeTask(
  taskId: string,
  status: "completed" | "failed",
): boolean {
  if (!hasDude()) return false;
  try {
    const cmd = status === "completed" ? "done" : "remove";
    execSync(`dude ${cmd} ${taskId}`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}
