/**
 * Daily OpenRouter call-budget tracker for the route-draft module.
 *
 * Lifted from signalk-openrouter-companion and restyled to crows-nest
 * conventions (neostandard, no semicolons, node16 `.js` import specifiers,
 * string logging through an injected logger). It caps the number of OpenRouter
 * CALLS per UTC day, not dollars: a per-call dollar cap is not knowable before
 * the call, but a call count is, so the route-draft endpoint refuses with the
 * contract `budget` code before spending when `canSpend()` is false.
 *
 * The count rolls over at the UTC day boundary, persists to an injectable
 * `statePath` (the lead passes the plugin data-dir path), and degrades to a
 * fresh counter when the state file is missing or unreadable, logging only the
 * unexpected unreadable case. The increment in `recordCall()` is synchronous
 * and runs before the first await, so two drafts dispatched back to back cannot
 * both pass a `canSpend()` check and overshoot the cap.
 */

import { readFile, writeFile } from 'node:fs/promises'
import type { Logger } from '../shared/types.js'

/** Options for {@link BudgetTracker.load}. */
export interface BudgetOptions {
  /** Maximum OpenRouter calls allowed per UTC day. */
  maxPerDay: number
  /** Path the per-day call count is persisted to (the lead passes the data dir). */
  statePath: string
  /** Injectable clock for the day boundary; defaults to `() => new Date()`. */
  now?: () => Date
  /**
   * Optional sink for persistence faults. A failed load silently resets the
   * daily call cap and a failed write silently weakens it, so both are worth
   * surfacing even though neither rejects.
   */
  log?: Logger
}

interface PersistedState {
  day: string
  callsToday: number
}

type ResolvedBudgetOptions = BudgetOptions & { now: () => Date }

function utcDay (d: Date): string {
  return d.toISOString().slice(0, 10)
}

export class BudgetTracker {
  private constructor (
    private readonly opts: ResolvedBudgetOptions,
    private state: PersistedState
  ) {}

  static async load (opts: BudgetOptions): Promise<BudgetTracker> {
    const now = opts.now ?? (() => new Date())
    let state: PersistedState
    try {
      const raw = await readFile(opts.statePath, 'utf-8')
      const parsed = JSON.parse(raw) as PersistedState
      // callsToday gates the cap, so reject a NaN, fractional, or negative
      // count rather than letting it through to the comparison.
      if (
        typeof parsed.day !== 'string' ||
        !Number.isInteger(parsed.callsToday) ||
        parsed.callsToday < 0
      ) {
        throw new Error('invalid state shape')
      }
      state = { day: parsed.day, callsToday: parsed.callsToday }
    } catch (err) {
      // ENOENT is the expected first-run case. Anything else is a corrupt or
      // unreadable state file, which silently resets the daily cap, so it is
      // worth surfacing at error level.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        opts.log?.error(`budget state unreadable, resetting daily counter: ${String(err)}`)
      }
      state = { day: utcDay(now()), callsToday: 0 }
    }
    return new BudgetTracker({ ...opts, now }, state)
  }

  private rolloverIfNeeded (): void {
    const today = utcDay(this.opts.now())
    if (this.state.day !== today) {
      this.state = { day: today, callsToday: 0 }
    }
  }

  canSpend (): boolean {
    this.rolloverIfNeeded()
    return this.state.callsToday < this.opts.maxPerDay
  }

  callsToday (): number {
    this.rolloverIfNeeded()
    return this.state.callsToday
  }

  /**
   * Increment the day's call count and persist it. The increment is
   * synchronous and runs before the first await: a caller checks `canSpend()`
   * then `recordCall()` with no await between them, and that await-free gap is
   * what stops two concurrently dispatched drafts from both passing the check
   * and overshooting the cap. A read-modify-write of the state file before the
   * increment would reopen that race.
   */
  async recordCall (): Promise<void> {
    this.rolloverIfNeeded()
    this.state.callsToday += 1
    try {
      await writeFile(this.opts.statePath, JSON.stringify(this.state))
    } catch (err) {
      // Best-effort persist. The in-memory counter is already incremented, so
      // a failed write only loses the count across a server restart. It must
      // not reject: a rejection here would surface as a spurious draft failure
      // even though the LLM call has not been attempted yet. A persistently
      // failing write quietly weakens the cap, so log it.
      this.opts.log?.error(`budget state write failed: ${String(err)}`)
    }
  }
}
