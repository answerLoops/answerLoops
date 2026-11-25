/**
 * Decides whether the CI disclosure check should scan a PR's body.
 *
 * Dependabot fills every PR body with the upstream project's release notes and
 * changelog, copied verbatim. That is third-party public text this repository
 * did not write, and a vocabulary match against it says nothing about what our
 * code guarantees, so scanning it only produces failures nobody can fix: the
 * bot rewrites the body again on every rebase.
 *
 * The carve-out is deliberately narrow:
 *   - only a PR *authored* by the Dependabot app, identified by both its login
 *     and its account type, so an ordinary user cannot match it;
 *   - never for the title or the added lines, which are always scanned;
 *   - not when a person edits the body afterwards. The `edited` trigger exists
 *     because a body rewritten by hand never touches a commit, so a human edit
 *     of a bot PR is scanned like any other body.
 */

export const DEPENDABOT_LOGIN = 'dependabot[bot]'

export function shouldScanPrBody({ author, authorType, action, actor } = {}) {
  const botAuthored = author === DEPENDABOT_LOGIN && authorType === 'Bot'
  if (!botAuthored) return true
  // The bot's own edits are the generated release notes; a person's are not.
  if (action === 'edited' && actor !== DEPENDABOT_LOGIN) return true
  return false
}
