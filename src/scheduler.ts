import parser from "cron-parser";
import type { DexJob } from "./store.js";

export interface ScheduleInfo {
  job: DexJob;
  nextRun: Date;
  isDue: boolean;
}

export function getNextRun(cronExpr: string): Date {
  const interval = parser.parseExpression(cronExpr);
  return interval.next().toDate();
}

export function getPrevRun(cronExpr: string): Date {
  const interval = parser.parseExpression(cronExpr);
  return interval.prev().toDate();
}

/**
 * A job is due if the most recent scheduled time is after the job's last run.
 * Jobs that have never run are always due.
 */
export function isJobDue(job: DexJob): boolean {
  if (!job.lastRun) return true;
  try {
    const prevScheduled = getPrevRun(job.cron);
    return prevScheduled > new Date(job.lastRun);
  } catch {
    return false;
  }
}

export function getSchedule(jobs: DexJob[]): ScheduleInfo[] {
  return jobs
    .map((job) => {
      try {
        return {
          job,
          nextRun: getNextRun(job.cron),
          isDue: isJobDue(job),
        };
      } catch {
        return null;
      }
    })
    .filter((s): s is ScheduleInfo => s !== null)
    .sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);

  if (absDiff < 60_000) return "less than a minute";
  if (absDiff < 3_600_000) {
    const mins = Math.round(absDiff / 60_000);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  if (absDiff < 86_400_000) {
    const hours = Math.round(absDiff / 3_600_000);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(absDiff / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function validateCron(cronExpr: string): string | null {
  try {
    parser.parseExpression(cronExpr);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid cron expression";
  }
}
