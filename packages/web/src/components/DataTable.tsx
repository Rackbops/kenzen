import { cx } from "@rackbops/ui-react"
import { type ReactNode, useState } from "react"
import "./DataTable.css"

export interface DataTableColumn<T> {
  /** Unique among this table's columns; also the sort key passed back via onSort/defaultSortKey. */
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** Right-aligns the cell (rb-num, matching the design system's existing numeric-column class). */
  numeric?: boolean
  /** Omit to make the column unsortable. Returning a number sorts numerically; a string sorts
   * lexicographically (case-insensitive). */
  sortValue?: (row: T) => string | number
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Groups rows under a labelled header row instead of one flat body. Sorting (if active)
   * applies within each group, not across the whole table. */
  groupBy?: (row: T) => string
  /** Known group labels in display order; any group present in the data but not listed here
   * is appended after, sorted alphabetically. Ignored when groupBy is omitted. */
  groupOrder?: string[]
  defaultSortKey?: string
  defaultSortDirection?: "asc" | "desc"
  /** Sticky header within a scrolling wrapper -- for a table taller than its container. */
  sticky?: boolean
  emptyMessage?: ReactNode
}

type SortState = { key: string; direction: "asc" | "desc" } | null

function compareBy<T>(column: DataTableColumn<T>, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1
  return (a: T, b: T): number => {
    const av = column.sortValue?.(a) ?? ""
    const bv = column.sortValue?.(b) ?? ""
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * sign
    }
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * sign
  }
}

function sortRows<T>(rows: T[], columns: DataTableColumn<T>[], sort: SortState): T[] {
  if (!sort) {
    return rows
  }
  const column = columns.find((c) => c.key === sort.key)
  if (!column?.sortValue) {
    return rows
  }
  return [...rows].sort(compareBy(column, sort.direction))
}

/** Orders group labels: those in `groupOrder` first (in that order, skipping ones with no
 * rows), then any remaining present-in-data label sorted alphabetically. */
function orderGroups(present: string[], groupOrder: string[] | undefined): string[] {
  if (!groupOrder) {
    return [...present].sort((a, b) => a.localeCompare(b))
  }
  const presentSet = new Set(present)
  const known = groupOrder.filter((g) => presentSet.has(g))
  const knownSet = new Set(known)
  const rest = present.filter((g) => !knownSet.has(g)).sort((a, b) => a.localeCompare(b))
  return [...known, ...rest]
}

/**
 * A sortable, optionally-grouped data table on the `rb-table` contract already shipped by
 * `@rackbops/styles` (used elsewhere; there was no React component wrapping it yet). Generic
 * over the row type and driven entirely by the `columns`/`rows` props -- no Kenzen-specific
 * knowledge (K4-8a, design.md section 9: a give-back candidate for `rackbops-ui-ux-std-lib`,
 * filed as K4-10 once it's proven against real use here).
 *
 * `.rb-table`/`th`/`td`/`.rb-num` are the existing theme contract, used as-is. The group-row,
 * sort-indicator and sticky-scroll styling (`.rb-table__group-row`, `.rb-table__sort`,
 * `.rb-table-scroll`) are new `rb-*`-prefixed classes this component adds in `DataTable.css`,
 * following the same naming convention -- they exist only in Kenzen for now and move into the
 * design system's own per-theme CSS alongside the component itself at K4-10.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  groupBy,
  groupOrder,
  defaultSortKey,
  defaultSortDirection = "asc",
  sticky,
  emptyMessage,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(
    defaultSortKey ? { key: defaultSortKey, direction: defaultSortDirection } : null,
  )

  if (rows.length === 0) {
    return <p>{emptyMessage ?? "No data."}</p>
  }

  function onHeaderClick(column: DataTableColumn<T>) {
    if (!column.sortValue) {
      return
    }
    setSort((current) => {
      if (current?.key !== column.key) {
        return { key: column.key, direction: "asc" }
      }
      return { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
    })
  }

  const groups: Array<{ label: string | null; rows: T[] }> = groupBy
    ? (() => {
        const byGroup = new Map<string, T[]>()
        for (const row of rows) {
          const label = groupBy(row)
          const bucket = byGroup.get(label)
          if (bucket) {
            bucket.push(row)
          } else {
            byGroup.set(label, [row])
          }
        }
        return orderGroups([...byGroup.keys()], groupOrder).map((label) => {
          // Safe: label came from byGroup's own keys.
          const groupRows = byGroup.get(label)
          if (!groupRows) {
            throw new Error(`unreachable: no rows for group ${label}`)
          }
          return { label, rows: sortRows(groupRows, columns, sort) }
        })
      })()
    : [{ label: null, rows: sortRows(rows, columns, sort) }]

  const table = (
    <table className="rb-table">
      <thead>
        <tr>
          {columns.map((column) => {
            const isSorted = sort?.key === column.key
            // `aria-sort` claims a table-wide order; grouping only sorts within each group, so
            // asserting it there would tell a screen-reader user something false (K4-8a review
            // round 1, LOW).
            const ariaSort =
              isSorted && !groupBy
                ? sort.direction === "asc"
                  ? "ascending"
                  : "descending"
                : undefined
            return (
              <th key={column.key} scope="col" aria-sort={ariaSort}>
                {column.sortValue ? (
                  <button
                    type="button"
                    className="rb-table__sort"
                    onClick={() => onHeaderClick(column)}
                  >
                    {column.header}
                    {isSorted && (
                      <span aria-hidden="true">{sort.direction === "asc" ? " ▲" : " ▼"}</span>
                    )}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <GroupRows
            key={group.label ?? "__ungrouped__"}
            group={group}
            columns={columns}
            rowKey={rowKey}
          />
        ))}
      </tbody>
    </table>
  )

  return sticky ? <div className="rb-table-scroll">{table}</div> : table
}

function GroupRows<T>({
  group,
  columns,
  rowKey,
}: {
  group: { label: string | null; rows: T[] }
  columns: DataTableColumn<T>[]
  rowKey: (row: T) => string
}) {
  return (
    <>
      {group.label !== null && (
        <tr className="rb-table__group-row">
          <td colSpan={columns.length}>{group.label}</td>
        </tr>
      )}
      {group.rows.map((row) => (
        <tr key={rowKey(row)}>
          {columns.map((column) => (
            <td key={column.key} className={cx(column.numeric && "rb-num")}>
              {column.render(row)}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
