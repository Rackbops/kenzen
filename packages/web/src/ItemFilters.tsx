import { Field, Label, Select } from "@rackbops/ui-react"
import type { ReportItem } from "./api.js"

/** Kenzen-specific filter controls over a ReportItem array (design.md section 6:
 * "repo/kind/role/status filters"). Not a give-back candidate -- it's ReportItem-shaped, not
 * generic -- unlike DataTable, which shipped to @rackbops/ui-react at K4-10. */

export interface ItemFilterState {
  repo?: string
  kind?: string
  role?: string
  status?: string
}

export type ItemFilterDimension = keyof ItemFilterState

const LABELS: Record<ItemFilterDimension, string> = {
  repo: "Repo",
  kind: "Kind",
  role: "Role",
  status: "Advisory status",
}

function distinctSorted(items: ReportItem[], pick: (item: ReportItem) => string | null): string[] {
  const values = new Set<string>()
  for (const item of items) {
    const value = pick(item)
    if (value !== null) {
      values.add(value)
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

function optionsFor(dimension: ItemFilterDimension, items: ReportItem[]): string[] {
  switch (dimension) {
    case "repo":
      return distinctSorted(items, (i) => i.repo)
    case "kind":
      return distinctSorted(items, (i) => i.kind)
    case "role":
      return distinctSorted(items, (i) => i.role)
    case "status":
      return distinctSorted(items, (i) => i.advisoryStatus)
  }
}

/** Filter options are computed from `items` as given (not re-narrowed by the other active
 * filters), so picking one filter never makes another filter's own options disappear out from
 * under the user. */
export function ItemFilters({
  items,
  value,
  onChange,
  dimensions,
}: {
  items: ReportItem[]
  value: ItemFilterState
  onChange: (next: ItemFilterState) => void
  dimensions: ItemFilterDimension[]
}) {
  return (
    <div className="kz-filters">
      {dimensions.map((dimension) => (
        <Field key={dimension}>
          <Label htmlFor={`filter-${dimension}`}>{LABELS[dimension]}</Label>
          <Select
            id={`filter-${dimension}`}
            value={value[dimension] ?? ""}
            onChange={(e) => onChange({ ...value, [dimension]: e.target.value || undefined })}
          >
            <option value="">All</option>
            {optionsFor(dimension, items).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </div>
  )
}

/** Pure: applies `filters` to `items`. An unset (undefined) dimension matches everything. */
export function applyItemFilters(items: ReportItem[], filters: ItemFilterState): ReportItem[] {
  return items.filter((item) => {
    if (filters.repo !== undefined && item.repo !== filters.repo) return false
    if (filters.kind !== undefined && item.kind !== filters.kind) return false
    if (filters.role !== undefined && item.role !== filters.role) return false
    if (filters.status !== undefined && item.advisoryStatus !== filters.status) return false
    return true
  })
}
