/**
 * Failures a sync can hit that the workspace owner can act on. The message is
 * written for the person reading the KB page and is the only error text that
 * is stored on a job row; any other error is logged server-side and shown as
 * a generic failure.
 */
export class KbSyncUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KbSyncUserError'
  }
}

/** The worker no longer owns the job (it was reclaimed or finished elsewhere), so it stops. */
export class KbSyncLeaseLostError extends Error {
  constructor(jobId: number) {
    super(`kb sync job ${jobId} is no longer owned by this worker`)
    this.name = 'KbSyncLeaseLostError'
  }
}

export const KB_SYNC_GENERIC_FAILURE = 'Sync failed — check the integration and try again.'
