import { changelogSource } from './source'

/**
 * Every release, newest first. Ordered by the publish timestamp rather than
 * by version string so it matches GitHub's releases page even when a patch
 * for an older line is published after a newer minor.
 */
export function getReleases() {
  return changelogSource
    .getPages()
    .sort((a, b) => b.data.datePublished.localeCompare(a.data.datePublished))
}

/** The newest release that is not a pre-release — what GitHub badges "Latest". */
export function getLatestTag(releases: ReturnType<typeof getReleases>): string | undefined {
  return releases.find((release) => !release.data.prerelease)?.data.tag
}

/** Formats a release timestamp as a calendar date in UTC, so it never shifts by reader timezone. */
export function formatReleaseDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
