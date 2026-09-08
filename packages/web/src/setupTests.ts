import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Tooling docs/non-addon-repo-scaffold.md section 6: this workspace's Vitest config doesn't
// set globals: true, so the usual auto-cleanup import path doesn't apply -- without this
// explicit afterEach, tests fail with misleading errors (duplicate elements, wrong element
// found) that look like real component bugs but are actually leftover DOM from the previous
// test's un-unmounted render.
afterEach(() => cleanup())
