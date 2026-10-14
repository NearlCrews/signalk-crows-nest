/**
 * Link targets the Signal K App Store can resolve from a rendered README.
 *
 * The App Store renders the npm README and rewrites relative IMAGE paths
 * against the package root, but leaves every other link target untouched, so a
 * relative link to CHANGELOG.md, LICENSE, docs/, or .github/ is dead there.
 * Only absolute web links, mail links, and in-page anchors survive.
 */
const RESOLVABLE_TARGET = /^(?:https?:|mailto:|#)/i

/** Fenced code blocks, HTML comments, and inline code spans carry no links. */
function stripNonProse (markdown) {
  return markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`\n]+`/g, '')
}

/**
 * Every link target in `markdown` the App Store cannot resolve, from inline
 * links `[text](target)`, reference definitions `[id]: target`, and HTML
 * anchors `<a href="target">`. Images (`![alt](path)` and `<img>`)
 * are exempt because the App Store rewrites their paths, and so is an image
 * nested inside a link, although the link around it is still checked.
 */
export function findRelativeLinkTargets (markdown) {
  const prose = stripNonProse(markdown)
  const targets = []
  // The link text admits one level of nested brackets, which is what a badge
  // (`[![alt](image)](link)`) needs.
  for (const [, bang, target] of prose.matchAll(
    /(!?)\[(?:[^[\]]|\[[^[\]]*\])*\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
  )) {
    if (bang === '' && !RESOLVABLE_TARGET.test(target)) targets.push(target)
  }
  // Footnote definitions ([^1]:) carry prose rather than a target.
  for (const [, target] of prose.matchAll(/^ {0,3}\[[^\]^][^\]]*\]:\s*<?([^\s>]+)>?/gm)) {
    if (!RESOLVABLE_TARGET.test(target)) targets.push(target)
  }
  for (const [, , target] of prose.matchAll(/<a\s[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    if (!RESOLVABLE_TARGET.test(target)) targets.push(target)
  }
  return targets
}
