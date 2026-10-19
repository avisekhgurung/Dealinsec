/**
 * The DealInSec background worker: a separate, always-on process (a Render Background Worker) that runs the durable
 * jobs the web service records in Postgres, so they don't depend on a browser, a request or a web instance that sleeps.
 *
 *   AI League tasks and schedules (server/ai-league/runtime.ts): coworker tasks, research campaigns, deliveries
 *   AI Outbound prospect runs (server/outbound/runner.ts): the searches Nibo's tasks start
 *
 * Every job is a Postgres row claimed with a lease (FOR UPDATE SKIP LOCKED) and checkpointed after each step, so a
 * restart, a deploy or a crash resumes from the last checkpoint; two workers never hold one job. Set
 * BACKGROUND_WORKER=external on BOTH services so the web service stops working jobs itself (it keeps recording them).
 *
 *   npm run build && npm run worker          (production bundle)
 *   npm run dev:worker                        (development, with .env)
 */
process.env.DEALINSEC_PROCESS = "worker";

const SAFETY_KICK_MS = 30_000;
const HEARTBEAT_MS = 60_000;
const DRAIN_MS = 25_000;
const log = (kind: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ kind, at: new Date().toISOString(), ...fields }));

async function main() {
  if (!process.env.DATABASE_URL) { log("worker_config_error", { missing: "DATABASE_URL" }); process.exit(1); }
  const league = await import("./ai-league/runtime");
  const { outboundRunner } = await import("./outbound/runner");
  await league.wireHandlers();

  const kickAll = () => { league.leagueRunner.kick(); league.scheduleRunner.kick(); outboundRunner.kick(); };
  kickAll();
  // The runners wake themselves for parked jobs; this is the safety net for anything a missed wake would leave behind.
  const kicker = setInterval(kickAll, SAFETY_KICK_MS);
  const started = Date.now();
  const heartbeat = setInterval(() => log("worker_heartbeat", {
    uptimeS: Math.round((Date.now() - started) / 1000),
    busy: { league: league.leagueRunner.busy, schedules: league.scheduleRunner.busy, outbound: outboundRunner.busy },
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  }), HEARTBEAT_MS);
  // The database host (never the credentials), so the logs show which database this worker is working on.
  const dbHost = (() => { try { return new URL(process.env.DATABASE_URL!).host; } catch { return "unknown"; } })();
  log("worker_started", { pid: process.pid, node: process.version, dbHost });

  // Render sends SIGTERM before replacing the worker (a deploy): stop claiming, let in-flight steps finish briefly.
  // Anything still running keeps its lease until it expires; the next worker resumes it from its checkpoint.
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(kicker); clearInterval(heartbeat);
    log("worker_stopping", { signal });
    await Promise.race([
      Promise.all([league.leagueRunner.idle(), league.scheduleRunner.idle(), outboundRunner.idle()]),
      new Promise((r) => setTimeout(r, DRAIN_MS)),
    ]);
    log("worker_stopped", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("unhandledRejection", (e) => log("worker_unhandled_rejection", { errorType: (e as Error)?.name ?? typeof e }));
}

main().catch((e) => { log("worker_crashed", { errorType: (e as Error)?.name ?? "Error" }); process.exit(1); });
