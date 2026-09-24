import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupProfilesByDisplayName,
  profileGroupsTesting,
  readInternalProfileDisplayNames,
} from "../src/profile-groups.js";

test("accepts only a bounded unique JSON array of internal display names", () => {
  assert.deepEqual(
    readInternalProfileDisplayNames('["  運営A  ","運営B"]'),
    ["運営A", "運営B"],
  );
  assert.throws(() => readInternalProfileDisplayNames(""), TypeError);
  assert.throws(() => readInternalProfileDisplayNames("{}"), TypeError);
  assert.throws(() => readInternalProfileDisplayNames("[]"), TypeError);
  assert.throws(() => readInternalProfileDisplayNames('["運営A"," 運営A "]'), TypeError);
  assert.throws(() => readInternalProfileDisplayNames('["（表示名なし）"]'), TypeError);
  assert.throws(
    () => readInternalProfileDisplayNames(JSON.stringify(
      Array.from({ length: profileGroupsTesting.MAX_INTERNAL_DISPLAY_NAMES + 1 }, (_, index) => `運営${index}`),
    )),
    TypeError,
  );
});

test("groups by normalized display name while keeping every profile row separate", () => {
  const first = Object.freeze({ displayName: "運営A", activeDays: 1 });
  const second = Object.freeze({ displayName: " 運営A ", activeDays: 2 });
  const third = Object.freeze({ displayName: "利用者A", activeDays: 3 });
  const grouped = groupProfilesByDisplayName(
    [first, second, third],
    ["運営A", "運営B"],
  );

  assert.equal(grouped.internalGroups.length, 1);
  assert.equal(grouped.externalGroups.length, 1);
  assert.equal(grouped.internalGroups[0].displayName, "運営A");
  assert.deepEqual(grouped.internalGroups[0].profiles, [first, second]);
  assert.equal(grouped.externalGroups[0].displayName, "利用者A");
  assert.deepEqual(grouped.externalGroups[0].profiles, [third]);
  assert.equal(Object.isFrozen(grouped.internalGroups[0].profiles), true);
});
