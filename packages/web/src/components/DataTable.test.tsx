import { fireEvent, render, screen, within } from "@testing-library/react"
import { expect, test } from "vitest"
import { DataTable, type DataTableColumn } from "./DataTable.js"

interface Row {
  id: string
  name: string
  group: string
  count: number
}

const ROWS: Row[] = [
  { id: "a", name: "Bravo", group: "runtime", count: 2 },
  { id: "b", name: "Alpha", group: "runtime", count: 5 },
  { id: "c", name: "Charlie", group: "build", count: 1 },
]

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name, sortValue: (r) => r.name },
  {
    key: "count",
    header: "Count",
    render: (r) => r.count,
    numeric: true,
    sortValue: (r) => r.count,
  },
]

test("renders every row and column", () => {
  render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />)
  expect(screen.getByText("Bravo")).toBeInTheDocument()
  expect(screen.getByText("Alpha")).toBeInTheDocument()
  expect(screen.getByText("Charlie")).toBeInTheDocument()
})

test("renders the empty message instead of a table when there are no rows", () => {
  render(
    <DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} emptyMessage="Nothing here." />,
  )
  expect(screen.getByText("Nothing here.")).toBeInTheDocument()
  expect(screen.queryByRole("table")).not.toBeInTheDocument()
})

test("clicking a sortable header sorts ascending, then descending on a second click", () => {
  render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />)

  const nameCells = () =>
    within(screen.getByRole("table")).getAllByRole("cell", { name: /^(Alpha|Bravo|Charlie)$/ })

  fireEvent.click(screen.getByRole("button", { name: /Name/ }))
  expect(nameCells().map((c) => c.textContent)).toEqual(["Alpha", "Bravo", "Charlie"])

  fireEvent.click(screen.getByRole("button", { name: /Name/ }))
  expect(nameCells().map((c) => c.textContent)).toEqual(["Charlie", "Bravo", "Alpha"])
})

test("a numeric column applies rb-num and sorts numerically, not lexicographically", () => {
  render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />)

  const countCell = screen.getByText("2").closest("td")
  expect(countCell).toHaveClass("rb-num")

  fireEvent.click(screen.getByRole("button", { name: /Count/ }))
  const rows = screen.getAllByRole("row").slice(1) // drop the header row
  expect(rows.map((r) => within(r).getAllByRole("cell")[1]?.textContent)).toEqual(["1", "2", "5"])
})

test("a column with no sortValue renders as plain text, not a button", () => {
  const unsortable: DataTableColumn<Row>[] = [
    { key: "name", header: "Name", render: (r) => r.name },
  ]
  render(<DataTable columns={unsortable} rows={ROWS} rowKey={(r) => r.id} />)
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

test("groupBy renders a labelled group row per distinct group, in groupOrder", () => {
  render(
    <DataTable
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.id}
      groupBy={(r) => r.group}
      groupOrder={["runtime", "build"]}
    />,
  )
  const groupLabels = screen.getAllByText(/^(runtime|build)$/).map((el) => el.textContent)
  expect(groupLabels).toEqual(["runtime", "build"])
})

test("a group not listed in groupOrder is appended after, alphabetically", () => {
  const rows: Row[] = [...ROWS, { id: "d", name: "Delta", group: "ci", count: 9 }]
  render(
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      groupBy={(r) => r.group}
      groupOrder={["runtime"]}
    />,
  )
  const groupLabels = screen.getAllByText(/^(runtime|build|ci)$/).map((el) => el.textContent)
  expect(groupLabels).toEqual(["runtime", "build", "ci"])
})

test("sorting within a grouped table sorts each group independently, not across groups", () => {
  render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} groupBy={(r) => r.group} />)
  fireEvent.click(screen.getByRole("button", { name: /Name/ }))
  // runtime group (Bravo, Alpha) sorts to Alpha, Bravo; build group (Charlie) is unaffected --
  // and critically, runtime's rows never mix with build's single row.
  const table = screen.getByRole("table")
  const dataRowTexts = within(table)
    .getAllByRole("row")
    .slice(1) // header
    .map((r) => r.textContent)
  expect(dataRowTexts).toEqual(["build", "Charlie1", "runtime", "Alpha5", "Bravo2"])
})

test("aria-sort is set on a sorted header when not grouped", () => {
  render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />)
  fireEvent.click(screen.getByRole("button", { name: /Name/ }))
  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  )
})

test("aria-sort is omitted on a sorted header when grouped -- sorting is per-group, not table-wide", () => {
  render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} groupBy={(r) => r.group} />)
  fireEvent.click(screen.getByRole("button", { name: /Name/ }))
  expect(screen.getByRole("columnheader", { name: /Name/ })).not.toHaveAttribute("aria-sort")
})

test("sticky wraps the table in rb-table-scroll", () => {
  const { container } = render(
    <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} sticky />,
  )
  expect(container.querySelector(".rb-table-scroll")).not.toBeNull()
  expect(container.querySelector(".rb-table-scroll > table.rb-table")).not.toBeNull()
})

test("not sticky renders the table with no scroll wrapper", () => {
  const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />)
  expect(container.querySelector(".rb-table-scroll")).toBeNull()
})
