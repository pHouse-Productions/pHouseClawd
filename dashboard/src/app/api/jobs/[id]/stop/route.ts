import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

function getProjectRoot(): string {
  return path.resolve(process.cwd(), "..");
}

const JOBS_DIR = path.join(getProjectRoot(), "logs", "jobs");

interface JobFile {
  id: string;
  status: "running" | "completed" | "error" | "stopped";
  pid?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;

  try {
    // Read the job file to get the PID
    const jobPath = path.join(JOBS_DIR, `${jobId}.json`);

    let jobFile: JobFile;
    try {
      const content = await fs.readFile(jobPath, "utf-8");
      jobFile = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check if job is already stopped/completed
    if (jobFile.status !== "running") {
      return NextResponse.json(
        { error: `Job is already ${jobFile.status}` },
        { status: 400 }
      );
    }

    // Try to kill by PID
    if (!jobFile.pid) {
      return NextResponse.json(
        { error: "Job has no PID recorded" },
        { status: 400 }
      );
    }

    try {
      process.kill(jobFile.pid, "SIGTERM");

      // Update job file to stopped status
      const fullJobContent = await fs.readFile(jobPath, "utf-8");
      const fullJob = JSON.parse(fullJobContent);
      fullJob.status = "stopped";
      fullJob.endTime = new Date().toISOString();
      await fs.writeFile(jobPath, JSON.stringify(fullJob, null, 2));

      return NextResponse.json({ success: true, message: `Job ${jobId} stopped` });
    } catch (killError: any) {
      // ESRCH means process doesn't exist (already finished)
      if (killError.code === "ESRCH") {
        return NextResponse.json(
          { error: "Process not found (may have already finished)" },
          { status: 400 }
        );
      }
      // EPERM means we don't have permission
      if (killError.code === "EPERM") {
        return NextResponse.json(
          { error: "Permission denied to kill process" },
          { status: 403 }
        );
      }
      throw killError;
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to stop job", details: String(err) },
      { status: 500 }
    );
  }
}
