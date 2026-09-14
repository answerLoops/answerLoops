/**
 * Progress reporting shared by the KB sync entry points (Notion workspace,
 * GitHub repo, GitHub discussions). The run route (app/api/kb/sync-jobs/run)
 * passes an `onProgress` that writes to the job row, throttled; every other
 * caller passes nothing.
 */
export interface KbSyncProgressOpts {
  /**
   * Called as documents are processed. `done` and `total` are item counts;
   * `item` is the title of the doc/page currently being embedded, when the
   * caller has one available (Notion does, from its sync loop; GitHub syncs
   * don't pass one).
   */
  onProgress?: (done: number, total: number, item?: string) => void
}

/**
 * Wrap a raw progress sink so it only fires every `step` items (and always on
 * the final item). Keeps a per-document callback from turning into a write per
 * document on a 2000-page workspace.
 */
export function throttleProgress(
  sink: (done: number, total: number, item?: string) => void,
  step = 5,
): (done: number, total: number, item?: string) => void {
  let last = -1
  let fired = false
  return (done, total, item) => {
    if (!fired || done === total || done - last >= step || done < last) {
      fired = true
      last = done
      sink(done, total, item)
    }
  }
}
