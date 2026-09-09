/**
 * Whether a Node.js version can run the configuration panel's build toolchain.
 *
 * Babel 8 declares `node: ^22.18.0 || >=24.11.0`, so webpack with
 * `babel-loader` cannot bundle the panel on the Node 20 the plugin still
 * advertises at runtime. The plugin itself never builds the panel on such a
 * machine: `public/` ships prebuilt inside the npm tarball. `build-panel.mjs`
 * consults this predicate so `npm run build` on a Node 20 lane compiles the
 * plugin, prints a notice, and skips the panel rather than failing.
 *
 * The floors are spelled out here rather than parsed from Babel's `engines`
 * string, so the rule stays readable and testable; bump them when Babel does.
 */

/** Lowest Node 22 release the panel toolchain supports. */
const NODE_22_FLOOR = [22, 18, 0]
/** Lowest Node 24 release the panel toolchain supports; every later major qualifies. */
const NODE_24_FLOOR = [24, 11, 0]

function atLeast ([major, minor, patch], [floorMajor, floorMinor, floorPatch]) {
  if (major !== floorMajor) return major > floorMajor
  if (minor !== floorMinor) return minor > floorMinor
  return patch >= floorPatch
}

/**
 * True when `version` (a `process.versions.node` string such as `22.18.0`)
 * satisfies Babel 8's engine range. Node 23 is unsupported by that range.
 */
export function supportsPanelToolchain (version) {
  const parts = version.split('.').map(Number)
  if (parts.length < 3 || parts.some((part) => !Number.isInteger(part))) return false
  const [major] = parts
  if (major === 22) return atLeast(parts, NODE_22_FLOOR)
  if (major >= 24) return atLeast(parts, NODE_24_FLOOR)
  return false
}

/** The human-readable floor the notice names. */
export const PANEL_TOOLCHAIN_FLOOR_TEXT = 'Node 22.18 or newer (or 24.11 or newer)'
