import { readFileSync } from "node:fs"
import type { ErrorObject, ValidateFunction } from "ajv"
import { Ajv } from "ajv"

/**
 * ajv validation for the two Tooling data-contract schemas (design.md section 4.2). Schemas
 * are authored here from the real files (Tooling#478 K4-4); they move to Rackbops/Tooling as
 * the source of truth in Tooling#477 and are vendored back byte-identically
 * (shared-helpers-manifest.json) -- the contract ratchet (validate.test.ts) exists so a
 * schema/fixture drift is caught locally before that handoff, not after.
 */

export interface ValidationResult {
  valid: boolean
  errors: ErrorObject[] | null
}

function loadSchema(name: string): object {
  const path = new URL(`../schemas/${name}`, import.meta.url)
  return JSON.parse(readFileSync(path, "utf-8"))
}

const ajv = new Ajv({ allErrors: true })

const inventoryValidator: ValidateFunction = ajv.compile(
  loadSchema("software-inventory.schema.json"),
)
const reportValidator: ValidateFunction = ajv.compile(loadSchema("software-report.schema.json"))

export function validateInventory(data: unknown): ValidationResult {
  const valid = inventoryValidator(data)
  return { valid, errors: valid ? null : (inventoryValidator.errors ?? null) }
}

export function validateReport(data: unknown): ValidationResult {
  const valid = reportValidator(data)
  return { valid, errors: valid ? null : (reportValidator.errors ?? null) }
}

/** The first failing error's JSON path, for a 422 response naming the failing field. */
export function firstErrorPath(errors: ErrorObject[] | null): string {
  const first = errors?.[0]
  if (!first) {
    return ""
  }
  return first.instancePath || first.schemaPath
}
