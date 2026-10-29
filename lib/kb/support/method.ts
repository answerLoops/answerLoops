/**
 * The version of the whole assessment method. A finding is only comparable
 * with another made under the same method, so anything that can change what a
 * judge says or what code keeps (the prompt, the schema, the rubric, the
 * similarity floor) belongs here, and changing any of them means a new version.
 * tests/unit/kb-support-judge-prompt.test.ts pins the prompt and schema so an
 * edit cannot slip in without bumping this.
 */
export const SUPPORT_METHOD = Object.freeze({
  /** A judge pass whose supports must also clear an independent similarity floor. */
  method: 'judge+similarity',
  version: 1,
  rubric: 1,
  /**
   * Cosine similarity between a claim and the passage a judge cited, below
   * which a supports is downgraded to inconclusive. PROVISIONAL: it is set from
   * the human-labeled dataset, and until `npm run support:eval` has been run on
   * the real embedding model and the labels reviewed, `floorCalibrated` stays
   * false and the shadow run (#446) must not treat precision as measured.
   */
  similarityFloor: 0.3,
  floorCalibrated: false,
})

/** The most one answer's assessment may cost, judge and embeddings together, in micro-dollars ($0.003). */
export const SUPPORT_COST_CEILING_MICROS = 3_000

/** How long one judge call may take before the assessment fails with a timeout. */
export const JUDGE_TIMEOUT_MS = 30_000
