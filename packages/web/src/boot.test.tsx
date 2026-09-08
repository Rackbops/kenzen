import { afterEach, beforeEach, expect, test, vi } from "vitest"

// K4-7 round 2 (HIGH, live-reproduced): a rejected loadTheme() used to throw out of the
// entry module before React ever mounted, blanking the whole app. boot() now catches that
// and still mounts -- these tests prove the catch, not just that it exists in source.

const { loadThemeMock, applyThemeMock, renderMock, createRootMock } = vi.hoisted(() => ({
  loadThemeMock: vi.fn(),
  applyThemeMock: vi.fn(),
  renderMock: vi.fn(),
  createRootMock: vi.fn(),
}))

vi.mock("react-dom/client", () => ({
  createRoot: (...args: unknown[]) => {
    createRootMock(...args)
    return { render: renderMock }
  },
}))

vi.mock("./theme.js", () => ({
  resolveTheme: () => "arcane-obsidian",
  loadTheme: loadThemeMock,
  applyTheme: applyThemeMock,
}))

const { boot } = await import("./boot.js")

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
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
