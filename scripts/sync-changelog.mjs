#!/usr/bin/env node
/**
 * Mirrors the GitHub releases page into content/changelog/, one markdown file
 * per published release, which app/changelog/page.tsx renders at /changelog.
 *
 *   pnpm changelog:sync          write/refresh/remove files so they match GitHub
 *   pnpm changelog:check         exit 1 if any file differs from GitHub (writes nothing)
 *
 * The files are generated: never hand-edit them. Edit the release on GitHub
 * (`gh release edit`) and run the sync again. Idempotent, so it is also the
 * way to pick up an edited or deleted release.
 *
 * Reads the public GitHub API. Set GITHUB_TOKEN (or GH_TOKEN) to avoid the
 * unauthenticated rate limit; CHANGELOG_REPO overrides the repository.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'content', 'changelog')
const DEFAULT_REPO = 'answerLoops/answerLoops'

/** A tag as a safe file name. Release tags are normally `vX.Y.Z`; this only guards odd ones. */
export function fileNameForTag(tag) {
  return `${tag.replace(/[^A-Za-z0-9._-]+/g, '-')}.md`
}

/**
 * Splits a line into the segments that must be left alone (inline code,
 * markdown links, bare URLs) and the plain text between them, and applies
 * `transform` to the plain text only.
 */
function mapPlainText(line, transform) {
  const protectedSpan = /`[^`]*`|\[[^\]]*\]\([^)]*\)|<[^>]+>|https?:\/\/[^\s)>]+/g
  let out = ''
  let last = 0
  for (const match of line.matchAll(protectedSpan)) {
    out += transform(line.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return out + transform(line.slice(last))
}

/** Turns `#123` and `@handle` into the links GitHub itself would render. */
function linkReferences(text, repo) {
  return text
    .replace(/(?<![\w/&#])#(\d+)\b/g, (_, n) => `[#${n}](https://github.com/${repo}/issues/${n})`)
    .replace(
      /(?<![\w@/`])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![\w/-])/g,
      (_, handle) => `[@${handle}](https://github.com/${handle})`,
    )
}

/**
 * Adapts a release body for the page:
 * - drops the leading `## <release name>` heading, which the page prints itself;
 * - demotes remaining `#`/`##` headings to `###`, because the page owns h1/h2;
 * - links PR/issue numbers and @mentions the way GitHub does.
 * Fenced code blocks pass through untouched.
 */
export function formatBody(body, { name, tag, repo }) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').trim().split('\n')

  const first = lines[0]?.match(/^#{1,2}\s+(.+?)\s*$/)
  if (first && [name, tag].some((t) => t && first[1].trim() === t.trim())) {
    lines.shift()
    while (lines.length && lines[0].trim() === '') lines.shift()
  }

  let inFence = false
  const out = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    const heading = line.match(/^(#{1,2})\s+(.*)$/)
    if (heading) return `### ${mapPlainText(heading[2], (t) => linkReferences(t, repo))}`
    return mapPlainText(line, (t) => linkReferences(t, repo))
  })
  return out.join('\n').trim()
}

/** First prose paragraph of the notes as plain text, for the meta description. */
export function summarize(markdownBody, tag) {
  const paragraph = markdownBody
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => block && !/^(#|[-*+]\s|\d+\.\s|\||```|~~~|\*\*Full Changelog)/.test(block))
  if (!paragraph) return `Release notes for answerLoops ${tag}.`
  const plain = paragraph
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 300 ? `${plain.slice(0, 297).trimEnd()}...` : plain
}

/** The full file for one release: YAML frontmatter, then the adapted notes. */
export function renderRelease(release, repo) {
  const name = release.name?.trim() || release.tag_name
  const body = formatBody(release.body, { name, tag: release.tag_name, repo })
  const frontmatter = [
    '---',
    // JSON strings are valid YAML scalars, which sidesteps every quoting edge case.
    `title: ${JSON.stringify(name)}`,
    `tag: ${JSON.stringify(release.tag_name)}`,
    `datePublished: ${JSON.stringify(release.published_at ?? release.created_at)}`,
    `url: ${JSON.stringify(release.html_url)}`,
    `prerelease: ${release.prerelease ? 'true' : 'false'}`,
    `summary: ${JSON.stringify(summarize(body, release.tag_name))}`,
    '---',
  ].join('\n')
  return `${frontmatter}\n\n${body || `Release ${release.tag_name}.`}\n`
}

async function fetchReleases(repo) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'answerloops-changelog-sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const all = []
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers })
    if (!res.ok) throw new Error(`GitHub releases request failed: ${res.status} ${res.statusText}`)
    const batch = await res.json()
    all.push(...batch)
    if (batch.length < 100) break
  }
  // A draft is not public on GitHub, so it must not be public here either.
  return all.filter((release) => !release.draft)
}

async function main() {
  const check = process.argv.includes('--check')
  const repo = process.env.CHANGELOG_REPO || DEFAULT_REPO
  const releases = await fetchReleases(repo)

  const expected = new Map(releases.map((r) => [fileNameForTag(r.tag_name), renderRelease(r, repo)]))
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const existing = new Set(fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.md')))

  const added = []
  const updated = []
  const removed = []
  for (const [file, content] of expected) {
    const target = path.join(OUT_DIR, file)
    if (!existing.has(file)) added.push(file)
    else if (fs.readFileSync(target, 'utf8') !== content) updated.push(file)
    else continue
    if (!check) fs.writeFileSync(target, content)
  }
  for (const file of existing) {
    if (expected.has(file)) continue
    removed.push(file)
    if (!check) fs.unlinkSync(path.join(OUT_DIR, file))
  }

  const drift = added.length + updated.length + removed.length
  const report = (label, files) => files.length && console.log(`${label}: ${files.join(', ')}`)
  report(check ? 'missing' : 'added', added)
  report(check ? 'stale' : 'updated', updated)
  report(check ? 'orphaned' : 'removed', removed)
  console.log(
    drift === 0
      ? `content/changelog is in sync with ${releases.length} GitHub releases.`
      : check
        ? 'content/changelog is out of date. Run `pnpm changelog:sync`.'
        : `Synced ${releases.length} releases.`,
  )
  if (check && drift > 0) process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
