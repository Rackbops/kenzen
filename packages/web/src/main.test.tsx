import { afterEach, beforeEach, expect, test, vi } from "vitest"

// K4-7b (kenzen#24): main.tsx now does `await bootTheme(...)` before mounting the React
// tree. theme.test.ts's own `bootTheme` tests prove resolve -> load -> apply happens in
// that order INSIDE bootTheme; this file exists to prove main.tsx's `await` is real --
// that main.tsx doesn't mount anything into #root until bootTheme's returned promise
// actually settles. Mocks theme.js (to control exactly when "loading" finishes) and App.js
// (a router/fetch-heavy tree unrelated to what this file tests) so the only thing under
// test is main.tsx's own ordering.

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
})

afterEach(() => {
  vi.doUnmock("./theme.js")
  vi.doUnmock("./App.js")
  vi.resetModules()
})

test("main.tsx does not mount the app until bootTheme's promise resolves", async () => {
  let resolveBoot: (theme: string) => void = () => {
    throw new Error("resolveBoot called before bootTheme was invoked")
  }
  const bootTheme = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveBoot = resolve
      }),
  )
  vi.doMock("./theme.js", () => ({ bootTheme }))
  vi.doMock("./App.js", () => ({ App: () => <div data-testid="app-marker">app</div> }))

  const importPromise = import("./main.js")

  // Wait (real time, not a fixed microtask count -- the dynamic import itself does async
  // module-graph/transform work first) until main.tsx has reached and called
  // `bootTheme(...)`, without letting bootTheme's own promise resolve yet. If main.tsx
  // mounted the tree BEFORE awaiting bootTheme (the order flip this test guards against),
  // #root would already be populated by the time bootTheme has been called.
  await vi.waitFor(() => expect(bootTheme).toHaveBeenCalledTimes(1))
  expect(document.getElementById("root")?.childElementCount).toBe(0)

  resolveBoot("arcane-obsidian")
  await importPromise

  // React 19's createRoot().render() commits asynchronously (scheduler-driven), so the DOM
  // update lands a tick or two after the module's own await resolves -- wait for it rather
  // than asserting on the same microtask.
  await vi.waitFor(() => {
    expect(document.getElementById("root")?.childElementCount).toBeGreaterThan(0)
  })
})
