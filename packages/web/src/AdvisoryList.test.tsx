import { render, screen } from "@testing-library/react"
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

test("renders each advisory's id as a link to its real url", () => {
  render(
    <AdvisoryList
      advisories={[
        advisory({
          id: "GHSA-7mjv-x3jf-545x",
          url: "https://github.com/advisories/GHSA-7mjv-x3jf-545x",
        }),
      ]}
    />,
  )
  const link = screen.getByRole("link", { name: "GHSA-7mjv-x3jf-545x" })
  expect(link).toHaveAttribute("href", "https://github.com/advisories/GHSA-7mjv-x3jf-545x")
})

test("renders multiple advisories comma-separated, each its own link", () => {
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
  expect(screen.getByRole("link", { name: "GHSA-aaaa-aaaa-aaaa" })).toHaveAttribute(
    "href",
    "https://github.com/advisories/GHSA-aaaa-aaaa-aaaa",
  )
  expect(screen.getByRole("link", { name: "GHSA-bbbb-bbbb-bbbb" })).toHaveAttribute(
    "href",
    "https://osv.dev/vulnerability/GHSA-bbbb-bbbb-bbbb",
  )
})

test("an advisory's summary is available as the link's title", () => {
  render(<AdvisoryList advisories={[advisory({ summary: "Local Privilege Escalation" })]} />)
  expect(screen.getByRole("link")).toHaveAttribute("title", "Local Privilege Escalation")
})
