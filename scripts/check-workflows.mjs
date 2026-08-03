import { readdir, readFile } from 'node:fs/promises'

const workflowDirectory = '.github/workflows'
const workflowPaths = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => `${workflowDirectory}/${name}`)
const failures = []

for (const path of workflowPaths) {
  const workflow = await readFile(path, 'utf8')
  for (const [index, line] of workflow.split('\n').entries()) {
    const action = /\buses:\s+([^\s#]+)@([^\s#]+)/.exec(line)
    if (action !== null && !/^[0-9a-f]{40}$/.test(action[2] ?? '')) {
      failures.push(`${path}:${index + 1} must pin ${action[1]} to a full commit SHA.`)
    }
  }
}

const ci = await readFile('.github/workflows/ci.yml', 'utf8')
if (!ci.includes('node-version: [20, 22]') || !ci.includes('npm run verify')) {
  failures.push('ci.yml must retain Node 20 compatibility and a blocking full verification lane.')
}

const pluginCi = await readFile('.github/workflows/plugin-ci.yml', 'utf8')
if (!pluginCi.includes('SignalK/signalk-server/.github/workflows/plugin-ci.yml@')) {
  failures.push('plugin-ci.yml must retain the official Signal K reusable workflow.')
}

const workflowSecurity = await readFile('.github/workflows/workflow-security.yml', 'utf8')
for (const expected of ['actionlint@v1.7.12', 'zizmor-action@']) {
  if (!workflowSecurity.includes(expected)) {
    failures.push(`workflow-security.yml must include ${expected}.`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Workflow pins, compatibility lanes, and workflow security checks passed.')
