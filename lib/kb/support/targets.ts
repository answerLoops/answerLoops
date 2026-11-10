import { SUPPORT_COST_CEILING_MICROS } from './method'

/**
 * The go/no-go targets for source support (#446), agreed with the owner before
 * the shadow run started. This is the single place they live: the shadow
 * report, its verdict and the docs all read them from here, so a change is one
 * reviewed edit and never two numbers that disagree.
 *
 * Nothing is shown to a customer until a shadow run meets every one of them on
 * human labels. Until then the similarity floor stays provisional
 * (`SUPPORT_METHOD.floorCalibrated` is false).
 */
export const SHADOW_TARGETS = Object.freeze({
  /**
   * The least precision of the "supporting" state measured against human
   * labels: of the findings the judge kept as `supports`, and of the articles
   * and answers that are `supporting` because of them, the share a person also
   * says are supported.
   */
  supportingPrecision: 0.9,
  /** The fewest human-labeled pairs before any go decision. */
  minLabeledPairs: 200,
  /**
   * The largest tolerated false-negative rate: of the pairs a person says are
   * supported, the share the judge did not keep as `supports`. An unsure judge
   * may read as inconclusive, which costs recall, never precision.
   */
  maxFalseNegativeRate: 0.3,
  /** The most one answer's assessment may cost, in micro-dollars. */
  costCeilingMicros: SUPPORT_COST_CEILING_MICROS,
})

/**
 * How abstention is treated: `inconclusive` and `not_assessed` are never
 * counted as supporting, and are reported on their own.
 */
export const SHADOW_ABSTENTION_RULE = 'inconclusive and not_assessed are never counted as supporting and are reported separately'

/**
 * Who may label real customer excerpts. The CLI cannot check an identity, so
 * each labels file names its reviewer and role, and any other role is refused.
 */
export const SHADOW_LABELER_ROLES = ['workspace_owner', 'approved_maintainer'] as const
export type ShadowLabelerRole = (typeof SHADOW_LABELER_ROLES)[number]
