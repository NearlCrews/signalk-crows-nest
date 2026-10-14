import { readdir, readFile } from 'node:fs/promises'
import { require as tsxRequire } from 'tsx/cjs/api'
import {
  concurrencyProblem,
  cronSchedules,
  expandCommands,
  jobEvents,
  jobsWithoutTimeout,
  playwrightInstallGaps,
  playwrightProjectsRun,
  runsDevTreeAudit,
  runsOnMonday,
  splitJobs,
  workflowTriggers
} from './workflow-guards.mjs'

const workflowDirectory = '.github/workflows'
const workflowNames = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
const workflows = new Map(await Promise.all(workflowNames.map(async (name) => [
  name,
  await readFile(`${workflowDirectory}/${name}`, 'utf8')
])))
const { scripts } = JSON.parse(await readFile('package.json', 'utf8'))
const failures = []

// This package is CommonJS, so the config's default export arrives one level
// down. An empty project list would pass every browser-install check, so it
// fails instead.
// tsx's CommonJS loader, not tsImport: on Node 22 tsImport appends a namespace query to
// @playwright/test's resolved path and the import fails with ERR_MODULE_NOT_FOUND.
const playwrightModule = tsxRequire('../playwright.config.ts', import.meta.url)
const playwrightProjects = (playwrightModule.default?.default ?? playwrightModule.default)?.projects ?? []
if (playwrightProjects.length === 0) {
  failures.push('playwright.config.ts declares no projects for the browser-install check to read.')
}

// Publishing must run to the end once it starts, so it keeps its run instead
// of being cancelled by a newer one.
const PUBLISH_WORKFLOW = 'npm-publish.yml'

for (const [name, workflow] of workflows) {
  const path = `${workflowDirectory}/${name}`
  for (const [index, line] of workflow.split('\n').entries()) {
    const action = /\buses:\s+([^\s#]+)@([^\s#]+)/.exec(line)
    if (action !== null && !/^[0-9a-f]{40}$/.test(action[2] ?? '')) {
      failures.push(`${path}:${index + 1} must pin ${action[1]} to a full commit SHA.`)
    }
  }

  const concurrency = concurrencyProblem(workflow, { mustFinish: name === PUBLISH_WORKFLOW })
  if (concurrency !== undefined) failures.push(`${path} ${concurrency}.`)

  for (const job of jobsWithoutTimeout(workflow)) {
    failures.push(`${path} job ${job} must set timeout-minutes.`)
  }

  // The development-tree audit reports weekly and gates a release; it never
  // blocks a push or a pull request.
  const triggers = workflowTriggers(workflow)
  for (const [job, body] of splitJobs(workflow)) {
    const events = jobEvents(body, triggers)
    if ((events.includes('push') || events.includes('pull_request')) && runsDevTreeAudit(body, scripts)) {
      failures.push(`${path} job ${job} runs the development-tree audit on a push or pull request.`)
    }
  }

  for (const { job, missing } of playwrightInstallGaps(workflow, scripts, playwrightProjects)) {
    failures.push(`${path} job ${job} runs Playwright without installing ${missing.join(', ')}.`)
  }
}

const ci = workflows.get('ci.yml') ?? ''
if (!ci.includes('node-version: [20, 22]') || !ci.includes('npm run verify')) {
  failures.push('ci.yml must retain Node 20 compatibility and a blocking full verification lane.')
}
// The git hooks never start a browser, so CI is where every push meets the
// whole cross-browser panel suite.
if (playwrightProjectsRun(splitJobs(ci).get('panel-browser') ?? '', scripts, playwrightProjects).size !== playwrightProjects.length) {
  failures.push('ci.yml panel-browser must run every Playwright project.')
}

// The Admin integration matrix starts at the oldest Admin the README promises
// the panel supports, so the documented floor and the tested floor cannot drift.
const readme = await readFile('README.md', 'utf8')
const panelFloor = /configuration panel needs Signal K admin UI (\d+\.\d+\.\d+) or newer/.exec(readme)?.[1]
const adminJob = splitJobs(ci).get('signalk-admin') ?? ''
if (panelFloor === undefined) {
  failures.push('README.md must state the oldest Signal K admin UI the configuration panel supports.')
} else if (!adminJob.includes(`signalk_server: ['${panelFloor}', 'latest']`)) {
  failures.push(`ci.yml signalk-admin must test Signal K ${panelFloor}, the README panel floor, and latest.`)
}
for (const expected of ['run pack:release', 'link-signalk-admin.mjs', 'npm run test:integration']) {
  if (!adminJob.includes(expected)) failures.push(`ci.yml signalk-admin must retain ${expected}.`)
}

const pluginCi = workflows.get('plugin-ci.yml') ?? ''
if (!pluginCi.includes('SignalK/signalk-server/.github/workflows/plugin-ci.yml@')) {
  failures.push('plugin-ci.yml must retain the official Signal K reusable workflow.')
}
for (const trigger of ['push', 'pull_request', 'workflow_dispatch']) {
  if (!workflowTriggers(pluginCi).includes(trigger)) failures.push(`plugin-ci.yml must trigger on ${trigger}.`)
}
// ci.yml already runs formatting and the coverage thresholds once, a release
// is tagged from a commit whose push run on main the registry credits, and the
// signalk-admin job supersedes the reusable integration job.
for (const [pattern, reason] of [
  [/^\s+tags:/m, 'a tags trigger'],
  [/format-check-command:/, 'a format-check-command input'],
  [/coverage-command:/, 'a coverage-command input'],
  [/enable-signalk-integration:\s*true/, 'the reusable integration job']
]) {
  if (pattern.test(pluginCi)) failures.push(`plugin-ci.yml must not carry ${reason}.`)
}

// The weekly development-tree audit rides in an already scheduled workflow
// rather than a file of its own, so it adds no run on the main HEAD. The
// registry reads only the newest 20 runs for a release commit, so every
// scheduled workflow is a fixed set, and plugin-ci runs weekly after all of
// them to keep a fresh run of its own in that window.
const SCHEDULED_WORKFLOWS = ['codeql.yml', 'plugin-ci.yml', 'workflow-security.yml']
const scheduled = [...workflows].filter(([, workflow]) => workflowTriggers(workflow).includes('schedule'))
const scheduledNames = scheduled.map(([name]) => name).sort()
if (scheduledNames.join() !== SCHEDULED_WORKFLOWS.join()) {
  failures.push(`Only ${SCHEDULED_WORKFLOWS.join(', ')} may run on a schedule; found ${scheduledNames.join(', ')}.`)
}
const workflowSecurityJobs = splitJobs(workflows.get('workflow-security.yml') ?? '')
const weeklyAudit = [...workflowSecurityJobs.values()].some((body) => {
  const events = jobEvents(body, workflowTriggers(workflows.get('workflow-security.yml') ?? ''))
  return events.includes('schedule') && !events.includes('push') && !events.includes('pull_request') &&
    runsDevTreeAudit(body, scripts)
})
if (!weeklyAudit) {
  failures.push('workflow-security.yml must run the development-tree audit in a job gated to its schedule.')
}
const pluginCiCrons = cronSchedules(pluginCi).filter(runsOnMonday)
const otherMondayCrons = scheduled
  .filter(([name]) => name !== 'plugin-ci.yml')
  .flatMap(([, workflow]) => cronSchedules(workflow))
  .filter(runsOnMonday)
const latestOther = Math.max(...otherMondayCrons.map((schedule) => schedule.minuteOfDay))
if (pluginCiCrons.length === 0 || pluginCiCrons.some((schedule) => schedule.minuteOfDay <= latestOther)) {
  failures.push('plugin-ci.yml must run on a weekly Monday schedule later than every other Monday schedule.')
}

const publish = workflows.get(PUBLISH_WORKFLOW) ?? ''
for (const expected of [
  'types: [published]',
  'if: github.event.release.prerelease == false',
  'git merge-base --is-ancestor HEAD origin/main',
  'npm@12.0.2',
  'run pack:release',
  'Verify registry source commit',
  'gitHead'
]) {
  if (!publish.includes(expected)) failures.push(`${PUBLISH_WORKFLOW} must retain ${expected}.`)
}

const workflowSecurity = workflows.get('workflow-security.yml') ?? ''
for (const expected of ['actionlint@v1.7.12', 'zizmor-action@']) {
  if (!workflowSecurity.includes(expected)) {
    failures.push(`workflow-security.yml must include ${expected}.`)
  }
}

// The local gates the git hooks run. verify (pre-push) and verify:commit
// (pre-commit) stay free of browser suites and the development-tree audit;
// verify:release adds both.
for (const gate of ['verify:commit', 'verify']) {
  const command = `npm run ${gate}`
  if (playwrightProjectsRun(command, scripts, playwrightProjects).size > 0) {
    failures.push(`${gate} must not run a browser suite; that belongs in verify:browser.`)
  }
  if (runsDevTreeAudit(command, scripts)) {
    failures.push(`${gate} must not run the development-tree audit; that belongs in verify:release.`)
  }
}
const release = 'npm run verify:release'
if (playwrightProjectsRun(release, scripts, playwrightProjects).size !== playwrightProjects.length) {
  failures.push('verify:release must run every Playwright project.')
}
if (!runsDevTreeAudit(release, scripts)) failures.push('verify:release must run the development-tree audit.')
if (!expandCommands(release, scripts).includes(scripts.verify)) failures.push('verify:release must run verify.')

if (scripts.hooks !== 'git config core.hooksPath .githooks') {
  failures.push('package.json must keep the opt-in hooks script: git config core.hooksPath .githooks.')
}
for (const [hook, gate] of [['pre-commit', 'verify:commit'], ['pre-push', 'verify']]) {
  const body = await readFile(`.githooks/${hook}`, 'utf8').catch(() => '')
  if (!new RegExp(`^npm run ${gate}$`, 'm').test(body)) {
    failures.push(`.githooks/${hook} must run npm run ${gate}.`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Workflow pins, concurrency, timeouts, gate placement, browser installs, and hooks checks passed.')
