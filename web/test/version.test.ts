import assert from "node:assert/strict";
import { test } from "node:test";
import { isVersionOlder } from "../server/service.ts";

test("isVersionOlder compares semver-ish tags", () => {
  assert.equal(isVersionOlder("0.1.0", "0.1.1"), true);
  assert.equal(isVersionOlder("0.1.1", "0.1.0"), false);
  assert.equal(isVersionOlder("0.1.0", "0.1.0"), false);
  assert.equal(isVersionOlder("web-v0.1.0", "0.2.0"), true);
  assert.equal(isVersionOlder("v1.0.0", "web-v1.0.1"), true);
  assert.equal(isVersionOlder("1.0.0-beta", "1.0.0"), false);
});
