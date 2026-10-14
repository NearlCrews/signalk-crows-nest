import assert from 'node:assert/strict'
import {
  concurrencyProblem,
  cronSchedules,
  jobEvents,
  jobsWithoutTimeout,
  playwrightInstallGaps,
  runsDevTreeAudit,
  runsOnMonday,
  splitJobs,
  workflowTriggers
} from './workflow-guards.mjs'

const workflow = (body) => `name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
${body}`

// The same shapes this repository's Playwright config and scripts use.
const projects = [
  { name: 'chromium', use: { defaultBrowserType: 'chromium' } },
  { name: 'firefox', use: { defaultBrowserType: 'firefox' } },
  { name: 'webkit', use: { defaultBrowserType: 'webkit' } },
  { name: 'mobile-chromium', use: { defaultBrowserType: 'chromium' } }
]
const scripts = {
  verify: 'npm run lint && npm run audit:runtime',
  'verify:browser': 'npm run verify && playwright test',
  'verify:release': 'npm run verify:browser && npm run audit:full',
  'test:browser': 'npm run build && playwright test --project=chromium',
  'audit:runtime': 'npm audit --omit=dev --audit-level=high',
  'audit:full': 'npm audit --audit-level=high',
  lint: 'eslint .',
  build: 'node build.mjs'
}

// Jobs and triggers.
const twoJobs = workflow(`  first:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: npm test

  # A comment line is never read as a job id.
  second:
    uses: owner/repo/.github/workflows/reusable.yml@0123456789abcdef0123456789abcdef01234567
`)
assert.deepEqual([...splitJobs(twoJobs).keys()], ['first', 'second'], 'jobs split on their two-space ids')
assert.deepEqual(workflowTriggers(twoJobs), ['push', 'pull_request'], 'triggers read from the on block')

// Timeouts.
assert.deepEqual(jobsWithoutTimeout(twoJobs), [], 'a reusable-workflow job is exempt from the timeout rule')
assert.deepEqual(
  jobsWithoutTimeout(workflow('  bare:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n')),
  ['bare'],
  'a job without timeout-minutes is reported'
)

// Concurrency.
const concurrency = (group, cancel) => `${twoJobs}\nconcurrency:\n  group: ${group}\n  cancel-in-progress: ${cancel}\n`
// A GitHub Actions expression, assembled so it never sits in a plain string
// literal that lint would read as a misplaced template.
const expression = (inner) => ['$', '{{ ', inner, ' }}'].join('')
const workflowRefGroup = `${expression('github.workflow')}-${expression('github.ref')}`
assert.equal(concurrencyProblem(twoJobs), 'declares no workflow-level concurrency')
assert.equal(concurrencyProblem(concurrency(workflowRefGroup, 'true')), undefined)
assert.match(concurrencyProblem(concurrency(workflowRefGroup, 'false')), /cancel-in-progress: true/)
assert.match(concurrencyProblem(concurrency('ci', 'true')), /must group runs/)
assert.equal(
  concurrencyProblem(concurrency(`publish-${expression('github.event.release.tag_name')}`, 'false'), { mustFinish: true }),
  undefined,
  'a publish keeps its run'
)
assert.match(
  concurrencyProblem(concurrency('publish', 'true'), { mustFinish: true }),
  /cancel-in-progress: false/,
  'a publish must never be cancelled part way through'
)

// Job-level event gating.
const triggers = ['push', 'pull_request', 'schedule', 'workflow_dispatch']
assert.deepEqual(jobEvents('    runs-on: ubuntu-latest\n', triggers), triggers, 'an ungated job runs on every trigger')
assert.deepEqual(
  jobEvents("    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'\n", triggers),
  ['schedule', 'workflow_dispatch'],
  'event_name comparisons narrow the triggers'
)
assert.deepEqual(
  jobEvents("    if: github.event_name == 'schedule' || github.ref == 'refs/heads/main'\n", triggers),
  triggers,
  'a condition the guard cannot read is treated as every trigger'
)

// Schedules.
const crons = cronSchedules("on:\n  schedule:\n    - cron: '17 6 * * 1'\n    - cron: \"5 23 * * 0,3\"\n")
assert.deepEqual(crons.map(({ minuteOfDay }) => minuteOfDay), [377, 1385], 'cron times read as minutes after midnight')
assert.deepEqual(crons.map(runsOnMonday), [true, false], 'Monday is matched by day-of-week')
assert.equal(runsOnMonday({ dayOfWeek: '*' }), true, 'a daily schedule runs on Monday')
assert.equal(runsOnMonday({ dayOfWeek: '0-2' }), true, 'a range holding Monday runs on Monday')
assert.equal(runsOnMonday({ dayOfWeek: '2-5' }), false, 'a range without Monday does not')

// Development-tree audit.
assert.equal(runsDevTreeAudit('npm run verify', scripts), false, 'the runtime audit is not a dev-tree audit')
assert.equal(runsDevTreeAudit('npx --yes npm@12.0.2 run verify:release', scripts), true, 'expanded through nested scripts')
assert.equal(runsDevTreeAudit('npm audit --audit-level=high', scripts), true, 'a direct full audit counts')
assert.equal(runsDevTreeAudit('# npm run audit:full\nnpm test', scripts), false, 'a comment never counts')

// Playwright browser installs.
const browserJob = (install, run) => workflow(`  browsers:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
${install === undefined ? '' : `      - run: ${install}\n`}      - run: ${run}
`)
assert.deepEqual(
  playwrightInstallGaps(
    browserJob('npx playwright install --with-deps chromium firefox webkit', 'npx --yes npm@12.0.2 run verify:release'),
    scripts,
    projects
  ),
  [],
  'every engine installed for the full suite'
)
assert.deepEqual(
  playwrightInstallGaps(browserJob('npx playwright install --with-deps chromium firefox', 'npm run verify:release'), scripts, projects),
  [{ job: 'browsers', missing: ['webkit'] }],
  'a missing engine is named'
)
assert.deepEqual(
  playwrightInstallGaps(browserJob(undefined, 'npm run verify:browser'), scripts, projects),
  [{ job: 'browsers', missing: ['chromium', 'firefox', 'webkit'] }],
  'a suite with no install step needs every engine'
)
assert.deepEqual(
  playwrightInstallGaps(browserJob('npx playwright install chromium', 'npm run test:browser'), scripts, projects),
  [],
  'a --project filter needs only the engines it selects'
)
assert.deepEqual(
  playwrightInstallGaps(browserJob('npx playwright install --with-deps', 'npx playwright test'), scripts, projects),
  [],
  'a bare install downloads the default engines'
)
assert.deepEqual(
  playwrightInstallGaps(browserJob('npx playwright install-deps chromium', 'npm run test:browser'), scripts, projects),
  [{ job: 'browsers', missing: ['chromium'] }],
  'install-deps installs system packages, not a browser'
)
assert.deepEqual(
  playwrightInstallGaps(browserJob(undefined, 'npm run verify'), scripts, projects),
  [],
  'a job without a browser suite needs no install'
)
assert.deepEqual(
  playwrightInstallGaps(
    browserJob('npx playwright install --with-deps chromium firefox webkit', 'npm run verify:release'),
    scripts,
    [...projects, { name: 'edge', use: { channel: 'msedge' } }]
  ),
  [{ job: 'browsers', missing: ['msedge'] }],
  'a project added on a new engine fails until the workflow installs it'
)
assert.deepEqual(
  playwrightInstallGaps(browserJob('npx playwright install chromium', 'npx playwright test --project=tablet'), scripts, projects),
  [{ job: 'browsers', missing: ['the unknown project tablet'] }],
  'a filter naming no configured project is reported'
)

process.stdout.write('Workflow guard tests passed.\n')
