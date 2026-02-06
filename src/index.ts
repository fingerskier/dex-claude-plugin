#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { addJob, getJob, loadJobs, removeJob, updateJob } from "./store.js";
import {
  formatRelativeTime,
  getNextRun,
  getSchedule,
  isJobDue,
  validateCron,
} from "./scheduler.js";
import { completeDudeTask, createDudeTask, hasDude } from "./dude.js";

const server = new Server(
  { name: "dex-claude-plugin", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "add_dex_job",
      description:
        "Add a new scheduled dex job. A job has a name, a cron schedule, and a prompt that will be executed by Claude when the job is due.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Human-readable name for the job",
          },
          cron: {
            type: "string",
            description:
              'Cron expression for scheduling (e.g. "0 */2 * * *" for every 2 hours, "0 9 * * 1-5" for weekdays at 9am)',
          },
          prompt: {
            type: "string",
            description:
              "The prompt/instruction that Claude should execute when this job runs",
          },
        },
        required: ["name", "cron", "prompt"],
      },
    },
    {
      name: "remove_dex_job",
      description: "Remove a scheduled dex job by its ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          job_id: {
            type: "string",
            description: "The ID of the job to remove",
          },
        },
        required: ["job_id"],
      },
    },
    {
      name: "list_dex_jobs",
      description:
        "List all scheduled dex jobs with their cron schedules, next run times, and last run status.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "run_dex_jobs",
      description:
        "Check for due dex jobs and return them for execution. Returns due jobs with their prompts, or shows when the next job is scheduled. For each due job returned, execute its prompt, then call complete_dex_job with the results. After completing all due jobs, call run_dex_jobs again to wait for the next scheduled job.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "complete_dex_job",
      description:
        "Mark a dex job run as completed or failed. Call this after executing a job's prompt to record the outcome. If dude is installed, this also updates the dude task record.",
      inputSchema: {
        type: "object" as const,
        properties: {
          job_id: {
            type: "string",
            description: "The ID of the job that was run",
          },
          status: {
            type: "string",
            enum: ["completed", "failed"],
            description: "Whether the job completed successfully or failed",
          },
          result: {
            type: "string",
            description: "Brief summary of the job's outcome",
          },
        },
        required: ["job_id", "status", "result"],
      },
    },
  ],
}));

// Track dude task IDs for running jobs
const dudeTaskIds = new Map<string, string>();

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "add_dex_job": {
      const { name: jobName, cron, prompt } = args as {
        name: string;
        cron: string;
        prompt: string;
      };

      const cronError = validateCron(cron);
      if (cronError) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid cron expression "${cron}": ${cronError}`,
            },
          ],
          isError: true,
        };
      }

      const job = addJob(jobName, cron, prompt);
      const nextRun = getNextRun(cron);

      return {
        content: [
          {
            type: "text",
            text: [
              `Job added successfully.`,
              `  ID: ${job.id}`,
              `  Name: ${job.name}`,
              `  Schedule: ${job.cron}`,
              `  Next run: ${nextRun.toISOString()} (in ${formatRelativeTime(nextRun)})`,
            ].join("\n"),
          },
        ],
      };
    }

    case "remove_dex_job": {
      const { job_id } = args as { job_id: string };
      const removed = removeJob(job_id);

      if (!removed) {
        return {
          content: [{ type: "text", text: `No job found with ID: ${job_id}` }],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text", text: `Job "${removed.name}" (${job_id}) removed.` },
        ],
      };
    }

    case "list_dex_jobs": {
      const jobs = loadJobs();

      if (jobs.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No dex jobs configured. Use add_dex_job to create one.",
            },
          ],
        };
      }

      const schedule = getSchedule(jobs);
      const dudeStatus = hasDude() ? "installed" : "not found";

      const lines = [
        `Dex Jobs (${jobs.length} total, dude: ${dudeStatus})`,
        "",
      ];

      for (const { job, nextRun, isDue } of schedule) {
        const status = isDue ? "DUE" : `next: ${nextRun.toISOString()}`;
        const lastInfo = job.lastRun
          ? `last: ${job.lastStatus ?? "unknown"} at ${job.lastRun}`
          : "never run";

        lines.push(`  ${job.name} [${status}]`);
        lines.push(`    ID: ${job.id}`);
        lines.push(`    Cron: ${job.cron}`);
        lines.push(`    ${lastInfo}`);
        lines.push(`    Prompt: ${job.prompt.slice(0, 100)}${job.prompt.length > 100 ? "..." : ""}`);
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "run_dex_jobs": {
      const jobs = loadJobs();

      if (jobs.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No dex jobs configured. Use add_dex_job to create one.",
            },
          ],
        };
      }

      const schedule = getSchedule(jobs);
      const dueJobs = schedule.filter((s) => s.isDue);

      if (dueJobs.length === 0) {
        const next = schedule[0];
        return {
          content: [
            {
              type: "text",
              text: [
                "No jobs are currently due.",
                "",
                `Next scheduled: "${next.job.name}"`,
                `  At: ${next.nextRun.toISOString()}`,
                `  In: ${formatRelativeTime(next.nextRun)}`,
              ].join("\n"),
            },
          ],
        };
      }

      const lines = [
        `${dueJobs.length} job${dueJobs.length === 1 ? "" : "s"} due:`,
        "",
      ];

      for (const { job } of dueJobs) {
        // Create dude record if available
        let dudeInfo = "";
        if (hasDude()) {
          const taskId = createDudeTask(`dex: ${job.name}`);
          if (taskId) {
            dudeTaskIds.set(job.id, taskId);
            dudeInfo = ` (dude task #${taskId})`;
          }
        }

        lines.push(`--- Job: ${job.name}${dudeInfo} ---`);
        lines.push(`ID: ${job.id}`);
        lines.push(`Prompt: ${job.prompt}`);
        lines.push("");
      }

      lines.push(
        "Execute each job's prompt above, then call complete_dex_job for each with the job_id, status, and a brief result summary.",
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "complete_dex_job": {
      const { job_id, status, result } = args as {
        job_id: string;
        status: "completed" | "failed";
        result: string;
      };

      const job = getJob(job_id);
      if (!job) {
        return {
          content: [
            { type: "text", text: `No job found with ID: ${job_id}` },
          ],
          isError: true,
        };
      }

      // Update job record
      updateJob(job_id, {
        lastRun: new Date().toISOString(),
        lastStatus: status,
        lastResult: result,
      });

      // Update dude task if we have one
      let dudeInfo = "";
      const dudeTaskId = dudeTaskIds.get(job_id);
      if (dudeTaskId) {
        const updated = completeDudeTask(dudeTaskId, status);
        dudeInfo = updated
          ? ` Dude task #${dudeTaskId} marked as ${status}.`
          : ` (failed to update dude task #${dudeTaskId})`;
        dudeTaskIds.delete(job_id);
      }

      return {
        content: [
          {
            type: "text",
            text: `Job "${job.name}" marked as ${status}.${dudeInfo}\nResult: ${result}`,
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run if this is the main module (for dev mode)
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
