import { render, screen, waitFor } from "@testing-library/react"
import { expect, test } from "vitest"
import { useAsync } from "./useAsync.js"

function Probe({ load }: { load: () => Promise<string> }) {
  const state = useAsync(load, [])
  if (state.status === "loading") return <p>loading</p>
  if (state.status === "error") return <p>error: {state.error.message}</p>
  return <p>ready: {state.data}</p>
}

test("starts in loading state, then resolves to ready with the data", async () => {
  render(<Probe load={() => Promise.resolve("hello")} />)
  expect(screen.getByText("loading")).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText("ready: hello")).toBeInTheDocument())
})

test("resolves to error state when the loader rejects", async () => {
  render(<Probe load={() => Promise.reject(new Error("boom"))} />)
  await waitFor(() => expect(screen.getByText("error: boom")).toBeInTheDocument())
})
