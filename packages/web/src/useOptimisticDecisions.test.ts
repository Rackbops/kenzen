import { act, renderHook, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { ReportItem } from "./api.js"
import * as api from "./api.js"
import { useOptimisticDecisions } from "./useOptimisticDecisions.js"

function item(overrides: Partial<ReportItem>): ReportItem {
  return {
    key: overrides.key ?? "k",
    repo: "Rackbops/Tooling",
    kind: "pip-dep",
    name: "requests",
    pinned: "2.31.0",
    pinStyle: "exact",
    role: "runtime",
    source: "requirements.txt:3",
    latest: "2.32.3",
    latestInMajor: "2.32.3",
    gap: "minor",
    advisoryStatus: "none",
    advisories: [],
    assumed: null,
    note: null,
    decision: null,
    ...overrides,
  }
}

const decision = {
  skippedVersion: "9.0.0",
  remindAt: null,
  approvedVersion: null,
  acknowledgedAdvisories: null,
  updatedAt: "2026-09-08T00:00:00Z",
  updatedBy: "roshne",
}

test("apply optimistically sets a decision immediately, before the PUT resolves", async () => {
  let resolvePut: (value: api.ItemDecision | null) => void = () => {}
  vi.spyOn(api, "putDecision").mockReturnValue(
    new Promise<api.ItemDecision | null>((resolve) => {
      resolvePut = resolve
    }),
  )

  // A fresh array literal every render, deliberately -- proves the hook doesn't depend on
  // items' array identity being stable across renders (see useOptimisticDecisions.ts's own
  // resetKey doc: keying a reset on array identity caused a real infinite-reset loop here
  // during development, since renderHook's callback recreates this literal every render).
  const { result } = renderHook(() => useOptimisticDecisions([item({ key: "a" })], 1))
  expect(result.current.items[0]?.decision).toBeNull()

  act(() => {
    void result.current.apply("a", { field: "skippedVersion", value: "9.0.0" })
  })

  // While the PUT is still in flight, the optimistic decision is live but carries no real
  // identity yet -- that's the only observable "still pending" signal (see
  // useOptimisticDecisions.ts's own doc for why there's no separate isPending accessor).
  await waitFor(() => expect(result.current.items[0]?.decision?.skippedVersion).toBe("9.0.0"))
  expect(result.current.items[0]?.decision?.updatedBy).toBeNull()

  await act(async () => {
    resolvePut(decision)
    await Promise.resolve()
  })

  await waitFor(() => expect(result.current.items[0]?.decision?.updatedBy).toBe("roshne"))
})

test("apply rolls back to no decision when the PUT rejects, and records the error", async () => {
  vi.spyOn(api, "putDecision").mockRejectedValue(new Error("unauthorized"))

  const { result } = renderHook(() => useOptimisticDecisions([item({ key: "a" })], 1))

  await act(async () => {
    await result.current.apply("a", { field: "skippedVersion", value: "9.0.0" })
  })

  expect(result.current.items[0]?.decision).toBeNull()
  expect(result.current.errorFor("a")).toBe("unauthorized")
})

test("a rollback on one item never affects another item's state", async () => {
  vi.spyOn(api, "putDecision").mockImplementation(async (key) => {
    if (key === "fails") throw new Error("boom")
    return { ...decision, skippedVersion: "1.0.0" }
  })

  const { result } = renderHook(() =>
    useOptimisticDecisions([item({ key: "fails" }), item({ key: "succeeds" })], 1),
  )

  await act(async () => {
    await Promise.all([
      result.current.apply("fails", { field: "skippedVersion", value: "1.0.0" }),
      result.current.apply("succeeds", { field: "skippedVersion", value: "1.0.0" }),
    ])
  })

  const byKey = new Map(result.current.items.map((i) => [i.key, i]))
  expect(byKey.get("fails")?.decision).toBeNull()
  expect(byKey.get("succeeds")?.decision?.skippedVersion).toBe("1.0.0")
})

test("a later action wins over an earlier one's response arriving after it, on the same key", async () => {
  // Round 1 review, MEDIUM, independently found by both reviewers: apply() used to commit
  // whichever PUT RESPONSE arrived last, not whichever ACTION the user fired last. Two real
  // HTTP requests for the same key can resolve out of order -- reproduced here by resolving
  // the FIRST call's (skip) promise AFTER the SECOND call's (remind).
  let resolveFirst: (value: api.ItemDecision | null) => void = () => {}
  let resolveSecond: (value: api.ItemDecision | null) => void = () => {}
  const putDecision = vi.spyOn(api, "putDecision")
  putDecision.mockReturnValueOnce(
    new Promise<api.ItemDecision | null>((resolve) => {
      resolveFirst = resolve
    }),
  )
  putDecision.mockReturnValueOnce(
    new Promise<api.ItemDecision | null>((resolve) => {
      resolveSecond = resolve
    }),
  )

  const { result } = renderHook(() => useOptimisticDecisions([item({ key: "a" })], 1))

  act(() => {
    void result.current.apply("a", { field: "skippedVersion", value: "1.0.0" })
  })
  act(() => {
    void result.current.apply("a", { field: "remindAt", value: "2027-01-01T00:00:00Z" })
  })

  // Second (remind) resolves FIRST -- its own response should stick.
  await act(async () => {
    resolveSecond({ ...decision, skippedVersion: null, remindAt: "2027-01-01T00:00:00Z" })
    await Promise.resolve()
  })
  await waitFor(() =>
    expect(result.current.items[0]?.decision?.remindAt).toBe("2027-01-01T00:00:00Z"),
  )

  // First (skip) resolves LAST -- a stale response for a superseded call; must NOT clobber
  // the remind that's already confirmed.
  await act(async () => {
    resolveFirst({ ...decision, skippedVersion: "1.0.0" })
    await Promise.resolve()
  })

  expect(result.current.items[0]?.decision?.remindAt).toBe("2027-01-01T00:00:00Z")
  expect(result.current.items[0]?.decision?.skippedVersion).toBeNull()
})

test("a stale rejection arriving after a newer action does not overwrite the newer state or set a stale error", async () => {
  let rejectFirst: (err: Error) => void = () => {}
  const putDecision = vi.spyOn(api, "putDecision")
  putDecision.mockReturnValueOnce(
    new Promise<api.ItemDecision | null>((_resolve, reject) => {
      rejectFirst = reject
    }),
  )
  putDecision.mockResolvedValueOnce({
    ...decision,
    remindAt: "2027-01-01T00:00:00Z",
    skippedVersion: null,
  })

  const { result } = renderHook(() => useOptimisticDecisions([item({ key: "a" })], 1))

  act(() => {
    void result.current.apply("a", { field: "skippedVersion", value: "1.0.0" })
  })
  await act(async () => {
    await result.current.apply("a", { field: "remindAt", value: "2027-01-01T00:00:00Z" })
  })
  expect(result.current.items[0]?.decision?.remindAt).toBe("2027-01-01T00:00:00Z")

  await act(async () => {
    rejectFirst(new Error("stale network error"))
    await Promise.resolve().then(() => Promise.resolve())
  })

  expect(result.current.items[0]?.decision?.remindAt).toBe("2027-01-01T00:00:00Z")
  expect(result.current.errorFor("a")).toBeUndefined()
})

test("a changed resetKey (a fresh snapshot fetch) clears prior overrides and errors", async () => {
  vi.spyOn(api, "putDecision").mockRejectedValue(new Error("boom"))

  const { result, rerender } = renderHook(
    ({ resetKey }) => useOptimisticDecisions([item({ key: "a" })], resetKey),
    { initialProps: { resetKey: 1 } },
  )

  await act(async () => {
    await result.current.apply("a", { field: "skippedVersion", value: "1.0.0" })
  })
  expect(result.current.errorFor("a")).toBe("boom")

  rerender({ resetKey: 2 })

  expect(result.current.errorFor("a")).toBeUndefined()
})

test("re-rendering with the SAME resetKey does not clear an in-progress error (guards the fix itself)", async () => {
  vi.spyOn(api, "putDecision").mockRejectedValue(new Error("boom"))

  const { result, rerender } = renderHook(
    ({ resetKey }) => useOptimisticDecisions([item({ key: "a" })], resetKey),
    { initialProps: { resetKey: 1 } },
  )

  await act(async () => {
    await result.current.apply("a", { field: "skippedVersion", value: "1.0.0" })
  })
  expect(result.current.errorFor("a")).toBe("boom")

  // Same resetKey, brand-new items array reference -- must NOT clear the error, unlike the
  // old array-identity-keyed design.
  rerender({ resetKey: 1 })

  expect(result.current.errorFor("a")).toBe("boom")
})
