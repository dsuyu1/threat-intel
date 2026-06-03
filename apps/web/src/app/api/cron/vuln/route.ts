/**
 * POST /api/cron/vuln
 *
 * Called by Cloudflare Cron Triggers (or any cron scheduler).
 * Protected by CRON_SECRET header.
 *
 * Cloudflare Cron setup in wrangler.toml:
 *   [triggers]
 *   crons = ["0 *\/6 * * *"]   ← every 6 hours
 */

import { NextRequest, NextResponse } from "next/server";
import { runVulnAgent } from "../../../../../agents/vuln-runner";

export const runtime = "nodejs"; // agents need Node APIs

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env["CRON_SECRET"]) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runVulnAgent();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cron/vuln] error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
