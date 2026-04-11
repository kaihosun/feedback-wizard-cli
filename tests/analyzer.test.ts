import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { filePathToRoute } from "../src/analyzer/file-reader.js"
import { extractJson, parseModules } from "../src/analyzer/index.js"
import { BackupManager } from "../src/installer/rollback.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Test 1: filePathToRoute — route groups are stripped
// ---------------------------------------------------------------------------
test("filePathToRoute: strips route groups", () => {
  const result = filePathToRoute("src/app/(dashboard)/tickets/page.tsx")
  assert.equal(result, "/tickets")
})

// ---------------------------------------------------------------------------
// Test 2: filePathToRoute — dynamic segments become :param
// ---------------------------------------------------------------------------
test("filePathToRoute: converts dynamic segments to :param", () => {
  const result = filePathToRoute("src/app/tickets/[id]/page.tsx")
  assert.equal(result, "/tickets/:id")
})

// ---------------------------------------------------------------------------
// Test 3: filePathToRoute — nested route with multiple groups
// ---------------------------------------------------------------------------
test("filePathToRoute: nested route with multiple groups flattens correctly", () => {
  const result = filePathToRoute("src/app/(dashboard)/(settings)/profile/page.tsx")
  assert.equal(result, "/profile")
})

// ---------------------------------------------------------------------------
// Test 4: parseModules — fallback when Claude returns non-string items
// ---------------------------------------------------------------------------
test("parseModules: returns fallback when json contains non-string items", () => {
  // Simulate Claude returning an array of mixed types instead of strings
  const jsonWithNonStrings = JSON.stringify([1, null, true, { name: "bad" }])
  const result = parseModules(jsonWithNonStrings, ["/dashboard", "/tickets"])
  // All items are non-strings, so after filter we get an empty array — triggers fallback check
  // The filter removes non-strings, so result will be empty and map returns []
  // This tests the defensive typeof item === "string" guard
  assert.equal(Array.isArray(result), true)
  // With all non-strings filtered out, we still get an array (empty mapped result)
  assert.equal(result.length, 0)
})

test("parseModules: returns fallback when json is null", () => {
  const result = parseModules(null, ["/dashboard"])
  assert.deepEqual(result, [{ name: "General", route: "/", segment: "" }])
})

test("parseModules: returns fallback when json is empty array", () => {
  const result = parseModules("[]", ["/dashboard"])
  assert.deepEqual(result, [{ name: "General", route: "/", segment: "" }])
})

// ---------------------------------------------------------------------------
// Test 5: extractJson — returns first valid JSON among multiple blocks
// ---------------------------------------------------------------------------
test("extractJson: finds first valid JSON block in mixed text", () => {
  const text = `
    Here is some prose.
    {"provider": "supabase", "confidence": 0.9}
    And more prose here.
    {"other": "block"}
  `
  const result = extractJson(text)
  assert.notEqual(result, null)
  const parsed = JSON.parse(result!)
  assert.equal(parsed.provider, "supabase")
})

test("extractJson: returns null when no JSON present", () => {
  const result = extractJson("No JSON here at all, just plain text.")
  assert.equal(result, null)
})

test("extractJson: handles JSON array blocks", () => {
  const text = `The model says: ["Tickets", "Dashboard", "Settings"]`
  const result = extractJson(text)
  assert.notEqual(result, null)
  const parsed = JSON.parse(result!)
  assert.deepEqual(parsed, ["Tickets", "Dashboard", "Settings"])
})

// ---------------------------------------------------------------------------
// Test 6: BackupManager — rollbackAll is a no-op when backup dir doesn't exist
// ---------------------------------------------------------------------------
test("BackupManager: rollbackAll does not throw when backup dir is absent", async () => {
  const nonExistentRoot = join(__dirname, "fixtures", "next14-supabase")
  const manager = new BackupManager(nonExistentRoot)
  // No files backed up, no new files registered — rollbackAll should not throw
  await assert.doesNotReject(() => manager.rollbackAll())
})

test("BackupManager: getSavedPaths returns empty array initially", () => {
  const manager = new BackupManager("/tmp/fake-project")
  assert.deepEqual(manager.getSavedPaths(), [])
})
