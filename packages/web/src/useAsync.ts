import { useEffect, useState } from "react"

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T }

/** Shared fetch-state hook so each route doesn't repeat the same loading/error bookkeeping.
 * `load` is called once per `deps` change; a stale in-flight call that resolves after a newer
 * one started (or after unmount) is ignored via the `cancelled` flag. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })
    load().then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
    // deps is the caller's own dependency array; load is expected to be stable or itself
    // depend only on values already listed there.
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps is an opaque, caller-supplied array, not an inline literal Biome can statically check.
  }, deps)

  return state
}
