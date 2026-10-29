// Source support: the deterministic layer. It splits text into addressable
// pieces, checks everything a judge returns against them, and derives states
// and counts. It has no database and no model; nothing a judge says reaches
// storage or the dashboard without passing through it.
export * from './limits'
export * from './segment'
export * from './snapshot'
export * from './validate'
export * from './summary'
export * from './state'
export * from './reconcile'
export * from './method'
export * from './prompt'
export * from './similarity'
export * from './assess'
export * from './eval'
export * from './eval-report'
