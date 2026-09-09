import { fireEvent, render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { AdvisoryList } from "./AdvisoryList.js"
import type { Advisory } from "./api.js"

function advisory(overrides: Partial<Advisory>): Advisory {
  return {
    id: "GHSA-xxxx-xxxx-xxxx",
    summary: "an example advisory",
    severity: "high",
    url: "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx",
    source: "ghsa",
    affected: true,
    ...overrides,
  }
}

test("renders nothing for an empty advisories list", () => {
  const { container } = render(<AdvisoryList advisories={[]} />)
  expect(container).toBeEmptyDOMElement()
})

test("renders a closed disclosure by default", () => {
  // kenzen#63: collapsed by default is the whole point -- an item with many advisories must
  // not inflate its row until a viewer asks to see the ids. jsdom doesn't implement a real
  // browser's UA-stylesheet hiding of a closed <details>'s non-summary content, so the `open`
  // attribute itself -- the thing a real browser keys that hiding off of -- is what's asserted.
  // Mutation guard: hardcoding `open` on the <details> makes this fail.
  render(<AdvisoryList advisories={[advisory({ id: "GHSA-7mjv-x3jf-545x" })]} />)
  expect(screen.getByText("show ids").closest("details")).not.toHaveAttribute("open")
})

test("clicking the summary opens the disclosure and reveals every advisory as its own link", () => {
  render(
    <AdvisoryList
      advisories={[
        advisory({
          id: "GHSA-aaaa-aaaa-aaaa",
          url: "https://github.com/advisories/GHSA-aaaa-aaaa-aaaa",
        }),
        advisory({
          id: "GHSA-bbbb-bbbb-bbbb",
          url: "https://osv.dev/vulnerability/GHSA-bbbb-bbbb-bbbb",
        }),
      ]}
    />,
  )
  fireEvent.click(screen.getByText("show ids"))
  expect(screen.getByText("show ids").closest("details")).toHaveAttribute("open")
  expect(screen.getByRole("link", { name: "GHSA-aaaa-aaaa-aaaa" })).toHaveAttribute(
    "href",
    "https://github.com/advisories/GHSA-aaaa-aaaa-aaaa",
  )
  expect(screen.getByRole("link", { name: "GHSA-bbbb-bbbb-bbbb" })).toHaveAttribute(
    "href",
    "https://osv.dev/vulnerability/GHSA-bbbb-bbbb-bbbb",
  )
})

test("each open advisory link is its own list item, not a comma-joined inline run", () => {
  // Mutation guard: dropping the <ul>/<li> wrapper (rendering the links as bare siblings
  // again) makes this fail -- there would be no listitem role at all.
  render(
    <AdvisoryList
      advisories={[
        advisory({ id: "GHSA-aaaa-aaaa-aaaa" }),
        advisory({ id: "GHSA-bbbb-bbbb-bbbb" }),
      ]}
    />,
  )
  fireEvent.click(screen.getByText("show ids"))
  const items = screen.getAllByRole("listitem")
  expect(items).toHaveLength(2)
  expect(items[0]).toContainElement(screen.getByRole("link", { name: "GHSA-aaaa-aaaa-aaaa" }))
  expect(items[1]).toContainElement(screen.getByRole("link", { name: "GHSA-bbbb-bbbb-bbbb" }))
})

test("an advisory's summary is available as its link's title", () => {
  render(<AdvisoryList advisories={[advisory({ summary: "Local Privilege Escalation" })]} />)
  fireEvent.click(screen.getByText("show ids"))
  expect(screen.getByRole("link")).toHaveAttribute("title", "Local Privilege Escalation")
})

test("each link opens in a new tab without granting it access to window.opener", () => {
  render(<AdvisoryList advisories={[advisory({})]} />)
  fireEvent.click(screen.getByText("show ids"))
  const link = screen.getByRole("link")
  expect(link).toHaveAttribute("target", "_blank")
  expect(link).toHaveAttribute("rel", "noreferrer")
})
