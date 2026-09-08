import { afterEach, beforeEach, expect, test, vi } from "vitest"

// K4-7 round 2 (HIGH, live-reproduced): a rejected loadTheme() used to throw out of the
// entry module before React ever mounted, blanking the whole app. boot() now catches that
// and still mounts -- these tests prove the catch, not just that it exists in source.

const { resolveThemeMock, loadThemeMock, applyThemeMock, renderMock, createRootMock } = vi.hoisted(
  () => ({
    resolveThemeMock: vi.fn(),
    loadThemeMock: vi.fn(),
    applyThemeMock: vi.fn(),
    renderMock: vi.fn(),
    createRootMock: vi.fn(),
  }),
)

vi.mock("react-dom/client", () => ({
  createRoot: (...args: unknown[]) => {
    createRootMock(...args)
    return { render: renderMock }
  },
}))

vi.mock("./theme.js", () => ({
  resolveTheme: resolveThemeMock,
  loadTheme: loadThemeMock,
  applyTheme: applyThemeMock,
}))

const { boot } = await import("./boot.js")

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  resolveThemeMock.mockReset().mockReturnValue("arcane-obsidian")
  loadThemeMock.mockReset()
  applyThemeMock.mockReset()
  renderMock.mockReset()
  createRootMock.mockReset()
})
afterEach(() => {
  errorSpy.mockRestore()
})

test("boot still mounts the app when loadTheme rejects", async () => {
  loadThemeMock.mockRejectedValueOnce(new Error("network blip fetching theme CSS"))
  const root = document.createElement("div")

  await expect(boot(root)).resolves.toBeUndefined()

  expect(applyThemeMock).toHaveBeenCalledWith("arcane-obsidian", document.documentElement)
  expect(createRootMock).toHaveBeenCalledWith(root)
  expect(renderMock).toHaveBeenCalledTimes(1)
  expect(errorSpy).toHaveBeenCalled()
})

test("boot mounts normally when loadTheme resolves, with no error logged", async () => {
  loadThemeMock.mockResolvedValueOnce(undefined)
  const root = document.createElement("div")

  await boot(root)

  expect(renderMock).toHaveBeenCalledTimes(1)
  expect(errorSpy).not.toHaveBeenCalled()
})

test("boot does nothing when root is missing from the document", async () => {
  loadThemeMock.mockResolvedValueOnce(undefined)

  await boot(null)

  expect(createRootMock).not.toHaveBeenCalled()
  expect(renderMock).not.toHaveBeenCalled()
})

// K4-7 round 3: the other tests here all leave resolveTheme's mocked return value at the
// beforeEach default ("arcane-obsidian"), which also happens to be what a correct boot()
// would load/apply -- so none of them actually prove loadTheme/applyTheme are called with
// resolveTheme's OWN return value, as opposed to some other hardcoded/disconnected theme
// name. Mutation-proven gap: swapping boot.tsx's `await loadTheme(theme)` for a literal
// unrelated string left every other test in this file green. This test uses a resolveTheme
// return value distinct from the default specifically so that mutation can't hide.
test("boot loads and applies whichever theme resolveTheme actually returns", async () => {
  resolveThemeMock.mockReturnValue("rackbops-noir")
  loadThemeMock.mockResolvedValueOnce(undefined)
  const root = document.createElement("div")

  await boot(root)

  expect(loadThemeMock).toHaveBeenCalledWith("rackbops-noir")
  expect(applyThemeMock).toHaveBeenCalledWith("rackbops-noir", document.documentElement)
})
