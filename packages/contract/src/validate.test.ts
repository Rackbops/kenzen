import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ErrorObject } from "ajv"
import { Ajv } from "ajv"
import { describe, expect, it } from "vitest"
import { firstErrorPath, validateInventory, validateReport } from "./validate.js"

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures")
const schemasDir = resolve(dirname(fileURLToPath(import.meta.url)), "../schemas")

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf-8"))
}

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(schemasDir, name), "utf-8"))
}

const inventoryFixture = loadFixture("software-inventory.sample.json")
const reportFixture = loadFixture("software-report.sample.json")

describe("contract ratchet: the real fixtures validate", () => {
  // These fixtures are taken verbatim (well, trimmed -- see fixtures/README.md) from Tooling's
  // real production output. If this ever fails, either the fixture or the schema has drifted
  // from what Tooling actually emits -- exactly the drift this ratchet exists to catch before
  // Tooling#477 vendors the schema back byte-identically.
  it("software-inventory.sample.json validates against software-inventory.schema.json", () => {
    const result = validateInventory(inventoryFixture)
    expect(result.errors).toBeNull()
    expect(result.valid).toBe(true)
  })

  it("software-report.sample.json validates against software-report.schema.json", () => {
    const result = validateReport(reportFixture)
    expect(result.errors).toBeNull()
    expect(result.valid).toBe(true)
  })
})

describe("contract ratchet: a renamed schema field fails the fixture", () => {
  // The mutation this ratchet exists for (kenzen#6's own acceptance ask): prove that if the
  // schema and the real data ever disagree on a field name, validation actually catches it --
  // not just that the happy path above passes. Mutates a FRESH copy of the schema (never the
  // committed file) and validates the REAL fixture against it with a separate ajv instance.
  it("renaming inventory items[].resolver breaks validation against the real fixture", () => {
    const mutated = loadSchema("software-inventory.schema.json") as {
      definitions: { item: { required: string[]; properties: Record<string, unknown> } }
    }
    const item = mutated.definitions.item
    item.required = item.required.map((f) => (f === "resolver" ? "resolverRenamed" : f))
    item.properties.resolverRenamed = item.properties.resolver
    delete item.properties.resolver

    const ajv = new Ajv({ allErrors: true })
    const validateMutated = ajv.compile(mutated)

    expect(validateMutated(inventoryFixture)).toBe(false)
    expect(
      validateMutated.errors?.some((e: ErrorObject) => e.message?.includes("resolverRenamed")),
    ).toBe(true)
  })

  it("renaming report items[].advisoryStatus breaks validation against the real fixture", () => {
    const mutated = loadSchema("software-report.schema.json") as {
      definitions: { reportItem: { required: string[]; properties: Record<string, unknown> } }
    }
    const item = mutated.definitions.reportItem
    item.required = item.required.map((f) => (f === "advisoryStatus" ? "advisoryStatusRenamed" : f))
    item.properties.advisoryStatusRenamed = item.properties.advisoryStatus
    delete item.properties.advisoryStatus

    const ajv = new Ajv({ allErrors: true })
    const validateMutated = ajv.compile(mutated)

    expect(validateMutated(reportFixture)).toBe(false)
  })
})

describe("validateInventory / validateReport error reporting", () => {
  it("names the failing path on a schema violation (backs the ingest 422 contract)", () => {
    const bad = { repos: [], readOnly: [], items: [{ repo: "x" }] }
    const result = validateInventory(bad)
    expect(result.valid).toBe(false)
    expect(result.errors).not.toBeNull()
    const path = firstErrorPath(result.errors)
    expect(path).toMatch(/items\/0/)
  })

  it("firstErrorPath returns an empty string when there are no errors", () => {
    expect(firstErrorPath(null)).toBe("")
  })

  it("rejects a document missing required top-level fields", () => {
    expect(validateInventory({}).valid).toBe(false)
    expect(validateReport({}).valid).toBe(false)
  })

  it("rejects an inventory item with an unknown kind", () => {
    const bad = {
      repos: [],
      readOnly: [],
      items: [
        {
          repo: "o/r",
          kind: "not-a-real-kind",
          name: "x",
          pinned: "1.0.0",
          pinStyle: "exact",
          role: "runtime",
          source: "f:1",
          resolver: "npm",
        },
      ],
    }
    expect(validateInventory(bad).valid).toBe(false)
  })
})
