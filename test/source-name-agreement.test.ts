/**
 * The panel's source names must agree with the plugin's.
 *
 * `src/panel/source-names.ts` declares a display name per source slug, and
 * every input module already declares its own `name`. That is two declarations
 * of the same fact, arbitrated at runtime by `sourceDisplayName`: the status
 * snapshot's reported name wins where there is a row, and the panel's map
 * answers where there is not. So the operator sees the plugin's name for a
 * healthy source and the panel's for one that failed before it registered,
 * and nothing makes the two agree.
 *
 * Unifying them means moving the naming into `src/shared/` beside
 * `source-ids.ts`, which touches every input module, the panel, and shared.
 * Until that happens this test is the cheap guard: a rename on either side is
 * invisible to `tsc`, because both sides satisfy their types perfectly well
 * while disagreeing about what a source is called.
 *
 * This lives in a node test rather than beside the panel's own unit tests
 * because only a node test can import the input modules, which reach node-only
 * code the browser bundle never loads.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { SOURCE_NAMES } from '../src/panel/source-names.js'
import { SOURCE_SLUGS } from '../src/shared/source-ids.js'
import type { InputModule } from '../src/inputs/poi-source.js'
import { activeCaptainInput } from '../src/inputs/active-captain/active-captain-input.js'
import { openSeaMapInput } from '../src/inputs/openseamap/openseamap-input.js'
import { uscgLightListInput } from '../src/inputs/uscg-light-list/uscg-light-list-input.js'
import { noaaEncInput } from '../src/inputs/noaa-enc/noaa-enc-input.js'
import { noaaCoopsInput } from '../src/inputs/noaa-coops/noaa-coops-input.js'
import { uscgLnmInput } from '../src/inputs/uscg-lnm/uscg-lnm-input.js'
import { wpiInput } from '../src/inputs/wpi/wpi-input.js'
import { usaceInput } from '../src/inputs/usace/usace-input.js'

/** Every registered input, in the order `src/index.ts` registers them. */
const INPUTS: readonly InputModule[] = [
  activeCaptainInput,
  openSeaMapInput,
  uscgLightListInput,
  noaaEncInput,
  noaaCoopsInput,
  uscgLnmInput,
  wpiInput,
  usaceInput
]

test('every panel source name starts with the input module\'s own name', () => {
  // The panel's name is the plugin's name plus an optional parenthetical
  // scope hint, so the prefix is the part that has to match. A rename on
  // either side breaks this rather than quietly showing the operator two
  // different names for one source depending on whether it is healthy.
  for (const input of INPUTS) {
    const panelName = (SOURCE_NAMES as Readonly<Record<string, string>>)[input.id]
    assert.notEqual(
      panelName,
      undefined,
      `the panel has no name for source "${input.id}"`
    )
    assert.ok(
      panelName.startsWith(input.name),
      `panel name ${JSON.stringify(panelName)} for "${input.id}" must start with the ` +
      `input module's own name ${JSON.stringify(input.name)}`
    )
  }
})

test('the panel names exactly the sources the plugin registers', () => {
  // Both directions: a source added to the plugin and not the panel falls back
  // to showing a raw wire slug, and a name left in the panel for a source that
  // no longer exists is dead weight nobody will notice.
  assert.deepEqual(
    INPUTS.map((input) => input.id).sort(),
    [...SOURCE_SLUGS].sort(),
    'the registered inputs and the shared slug list must describe the same sources'
  )
  assert.deepEqual(
    Object.keys(SOURCE_NAMES).sort(),
    [...SOURCE_SLUGS].sort(),
    'the panel must name every slug and no others'
  )
})
