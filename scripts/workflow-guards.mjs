/**
 * Pure checks over workflow text and package scripts, applied by
 * `scripts/check-workflows.mjs` and tested by `scripts/test-workflow-guards.mjs`.
 * They read the YAML as text: every shape they pin is line-oriented, and the
 * repository carries no YAML parser.
 */

/** Browsers a bare `playwright install` downloads. */
const DEFAULT_PLAYWRIGHT_ENGINES = ['chromium', 'firefox', 'webkit']

/** `npm run <script>`, including `npx npm@x.y.z run` and flags on either side of `run`. */
const NPM_RUN = /\bnpm(?:@\S+)?(?:\s+--?[\w-]+(?:=\S+)?)*\s+run(?:-script)?(?:\s+--?[\w-]+(?:=\S+)?)*\s+([\w:.-]+)/g

/** A Playwright suite run, with its arguments up to the next shell separator. */
const PLAYWRIGHT_TEST = /\bplaywright\s+test\b([^&|;\n]*)/g

/** An `npm audit` that covers development dependencies, which is any without `--omit=dev`. */
const DEV_TREE_AUDIT = /\bnpm(?:@\S+)?\s+audit\b(?![^&|;\n]*--omit[= ]dev)/

/** Drops comment-only lines, so prose about a command never counts as running it. */
function withoutComments (text) {
  return text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
}

/** Splits a workflow into its jobs, keyed by job id, each mapped to its body text. */
export function splitJobs (workflow) {
  const jobs = new Map()
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (start === -1) return jobs
  let current
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break
    const id = /^ {2}([\w-]+):\s*$/.exec(line)
    if (id !== null) {
      current = id[1]
      jobs.set(current, [])
    } else if (current !== undefined) {
      jobs.get(current).push(line)
    }
  }
  return new Map([...jobs].map(([id, body]) => [id, body.join('\n')]))
}

/** The event names under the workflow's top-level `on:` key. */
export function workflowTriggers (workflow) {
  const block = /^on:[ \t]*\n((?:(?:[ \t].*)?\n)+)/m.exec(workflow)?.[1] ?? ''
  return [...block.matchAll(/^ {2}([\w-]+):/gm)].map((match) => match[1])
}

/**
 * The events a job actually runs on. A job-level `if:` made only of
 * `github.event_name == '<event>'` comparisons joined by `||` narrows the
 * workflow's triggers to those events; any other job runs on every trigger.
 */
export function jobEvents (jobBody, triggers) {
  const condition = /^ {4}if:\s*(.+)$/m.exec(jobBody)?.[1].trim()
  if (condition === undefined) return triggers
  const terms = condition.split('||').map((term) => /^github\.event_name\s*==\s*'([\w-]+)'$/.exec(term.trim())?.[1])
  return terms.every((event) => event !== undefined) ? triggers.filter((event) => terms.includes(event)) : triggers
}

/** Every schedule in the workflow as minutes after midnight UTC, with its day-of-week field. */
export function cronSchedules (workflow) {
  return [...workflow.matchAll(/^\s+- cron:\s*['"]([^'"]+)['"]/gm)].map(([, cron]) => {
    const [minute, hour, , , dayOfWeek] = cron.trim().split(/\s+/)
    return { cron, minuteOfDay: Number(hour) * 60 + Number(minute), dayOfWeek }
  })
}

/** Whether a cron day-of-week field includes Monday (1, a list or range holding it, or every day). */
export function runsOnMonday ({ dayOfWeek }) {
  return dayOfWeek === '*' || dayOfWeek.split(',').some((part) => {
    const range = /^(\d)-(\d)$/.exec(part)
    return part === '1' || (range !== null && Number(range[1]) <= 1 && Number(range[2]) >= 1)
  })
}

/**
 * Why the workflow-level concurrency block is wrong, or undefined when it is
 * right. Runs are grouped by workflow and ref and superseded runs cancelled,
 * except in a workflow whose run must finish, such as a publish.
 */
export function concurrencyProblem (workflow, { mustFinish = false } = {}) {
  const block = /^concurrency:[ \t]*\n((?: {2}.*\n?)+)/m.exec(workflow)?.[1]
  if (block === undefined) return 'declares no workflow-level concurrency'
  const cancel = /^ {2}cancel-in-progress:\s*(true|false)\s*$/m.exec(block)?.[1]
  if (mustFinish) return cancel === 'false' ? undefined : 'must set cancel-in-progress: false'
  if (!/^ {2}group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s*$/m.test(block)) {
    return 'must group runs by github.workflow and github.ref'
  }
  return cancel === 'true' ? undefined : 'must set cancel-in-progress: true'
}

/** Jobs with no `timeout-minutes`. A job that calls a reusable workflow cannot set one. */
export function jobsWithoutTimeout (workflow) {
  return [...splitJobs(workflow)]
    .filter(([, body]) => !/^ {4}uses:/m.test(body) && !/^ {4}timeout-minutes:\s*\d+\s*$/m.test(body))
    .map(([id]) => id)
}

/**
 * The command plus the body of every package script it runs, transitively,
 * including the `pre` and `post` scripts npm runs around each one.
 */
export function expandCommands (command, scripts) {
  const bodies = [command]
  const seen = new Set()
  for (let index = 0; index < bodies.length; index++) {
    for (const [, name] of bodies[index].matchAll(NPM_RUN)) {
      for (const script of [`pre${name}`, name, `post${name}`]) {
        if (typeof scripts[script] !== 'string' || seen.has(script)) continue
        seen.add(script)
        bodies.push(scripts[script])
      }
    }
  }
  return bodies
}

/** Whether the command, through any script it runs, audits development dependencies. */
export function runsDevTreeAudit (command, scripts) {
  return expandCommands(withoutComments(command), scripts).some((body) => DEV_TREE_AUDIT.test(body))
}

/**
 * The Playwright project names every suite the command runs selects: a
 * `--project` filter names its projects, and a run without one selects them all.
 */
export function playwrightProjectsRun (command, scripts, projects) {
  const selected = new Set()
  for (const body of expandCommands(withoutComments(command), scripts)) {
    for (const [, args] of body.matchAll(PLAYWRIGHT_TEST)) {
      const filters = [...args.matchAll(/--project(?:=|\s+)(\S+)/g)].map((match) => match[1])
      for (const name of filters.length > 0 ? filters : projects.map((project) => project.name)) {
        selected.add(name)
      }
    }
  }
  return selected
}

/** The browser a Playwright project launches, spelled the way `playwright install` takes it. */
export function projectEngine (project) {
  const use = project.use ?? {}
  return use.channel ?? use.browserName ?? use.defaultBrowserType ?? 'chromium'
}

/**
 * Jobs that run a Playwright suite without installing every browser its
 * projects launch. The engines come from the Playwright config's own project
 * list, so adding a project on a new engine fails here until each workflow
 * that runs it installs that engine too.
 */
export function playwrightInstallGaps (workflow, scripts, projects) {
  const engineOf = new Map(projects.map((project) => [project.name, projectEngine(project)]))
  const gaps = []
  for (const [job, rawBody] of splitJobs(workflow)) {
    const body = withoutComments(rawBody)
    const needed = new Set()
    for (const name of playwrightProjectsRun(body, scripts, projects)) {
      needed.add(engineOf.get(name) ?? `the unknown project ${name}`)
    }
    if (needed.size === 0) continue
    const installed = new Set()
    for (const [, args] of body.matchAll(/\bplaywright\s+install(?=\s|$)([^\n]*)/g)) {
      const named = args.split(/\s+/).filter((token) => token !== '' && !token.startsWith('-'))
      for (const engine of named.length > 0 ? named : DEFAULT_PLAYWRIGHT_ENGINES) installed.add(engine)
    }
    const missing = [...needed].filter((engine) => !installed.has(engine))
    if (missing.length > 0) gaps.push({ job, missing })
  }
  return gaps
}
