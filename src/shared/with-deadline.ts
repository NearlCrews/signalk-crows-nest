/** Race a promise against a deadline, resolving to `onTimeout()` if the deadline wins. */
export async function withDeadline<T> (work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms))
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    // The Promise executor runs synchronously, so timer is always set by here;
    // clearTimeout also tolerates undefined, so the call needs no guard.
    clearTimeout(timer)
  }
}
