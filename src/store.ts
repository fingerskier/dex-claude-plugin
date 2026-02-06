import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

export interface DexJob {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  createdAt: string;
  lastRun?: string;
  lastStatus?: "completed" | "failed";
  lastResult?: string;
}

const DEX_DIR = join(homedir(), ".dex");
const JOBS_FILE = join(DEX_DIR, "jobs.json");

function ensureDir(): void {
  if (!existsSync(DEX_DIR)) {
    mkdirSync(DEX_DIR, { recursive: true });
  }
}

export function loadJobs(): DexJob[] {
  ensureDir();
  if (!existsSync(JOBS_FILE)) {
    return [];
  }
  const data = readFileSync(JOBS_FILE, "utf-8");
  return JSON.parse(data);
}

export function saveJobs(jobs: DexJob[]): void {
  ensureDir();
  writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

export function addJob(name: string, cron: string, prompt: string): DexJob {
  const jobs = loadJobs();
  const job: DexJob = {
    id: randomUUID(),
    name,
    cron,
    prompt,
    createdAt: new Date().toISOString(),
  };
  jobs.push(job);
  saveJobs(jobs);
  return job;
}

export function removeJob(id: string): DexJob | null {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  const [removed] = jobs.splice(idx, 1);
  saveJobs(jobs);
  return removed;
}

export function updateJob(
  id: string,
  updates: Partial<DexJob>,
): DexJob | null {
  const jobs = loadJobs();
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
  Object.assign(job, updates);
  saveJobs(jobs);
  return job;
}

export function getJob(id: string): DexJob | null {
  const jobs = loadJobs();
  return jobs.find((j) => j.id === id) ?? null;
}
