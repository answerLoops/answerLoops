import { log, fail } from "./util.js";

/** Polls a URL until it responds ok, or a timeout elapses. */
export async function waitForHealth(url: string, timeoutSeconds = 120): Promise<void> {
  const intervalMs = 3000;
  const deadline = Date.now() + timeoutSeconds * 1000;

  log(`Waiting for ${url} to become healthy (timeout ${timeoutSeconds}s)...`);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        log(`✓ healthy`);
        return;
      }
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  fail(
    `${url} still unhealthy after ${timeoutSeconds}s. Check logs: docker compose -f docker-compose.ghcr.yml logs app -f`,
  );
}
