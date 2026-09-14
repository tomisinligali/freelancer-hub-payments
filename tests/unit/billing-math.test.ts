import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  remainingPeriodFraction,
  proratedUpgradeCharge,
} from "@/lib/payments/billing-math";

function at(iso: string): Date {
  return new Date(iso);
}

test("remainingPeriodFraction is 1 at the start of a period", () => {
  const now = at("2026-09-01T00:00:00.000Z");
  const start = at("2026-09-01T00:00:00.000Z");
  const end = at("2026-10-01T00:00:00.000Z");
  assert.equal(remainingPeriodFraction(now, start, end), 1);
});

test("remainingPeriodFraction is 0 once a period has ended", () => {
  const now = at("2026-10-02T00:00:00.000Z");
  const start = at("2026-09-01T00:00:00.000Z");
  const end = at("2026-10-01T00:00:00.000Z");
  assert.equal(remainingPeriodFraction(now, start, end), 0);
});

test("remainingPeriodFraction halves at the midpoint", () => {
  const now = at("2026-09-16T00:00:00.000Z");
  const start = at("2026-09-01T00:00:00.000Z");
  const end = at("2026-10-01T00:00:00.000Z");
  const fraction = remainingPeriodFraction(now, start, end);
  assert.ok(Math.abs(fraction - 0.5) < 0.001, `fraction ${fraction}`);
});

test("prorated upgrade charges the full yearly price in kobo at period end", () => {
  const now = at("2026-10-02T00:00:00.000Z");
  const start = at("2026-09-01T00:00:00.000Z");
  const end = at("2026-10-01T00:00:00.000Z");
  const charge = proratedUpgradeCharge(now, start, end);
  assert.equal(charge, 5_000_000); // ₦50,000
});

test("prorated upgrade charges the difference in kobo at the midpoint", () => {
  const now = at("2026-09-16T00:00:00.000Z");
  const start = at("2026-09-01T00:00:00.000Z");
  const end = at("2026-10-01T00:00:00.000Z");
  const charge = proratedUpgradeCharge(now, start, end);
  assert.ok(Math.abs(charge - 4_750_000) < 1, `charge ${charge}`); // ₦47,500
});

test("prorated upgrade never charges more than the yearly price", () => {
  const now = at("2026-09-02T00:00:00.000Z");
  const start = at("2026-09-01T00:00:00.000Z");
  const end = at("2026-10-01T00:00:00.000Z");
  const charge = proratedUpgradeCharge(now, start, end);
  assert.ok(charge <= 5_000_000, `charge ${charge}`);
  assert.ok(charge > 0, `charge ${charge}`);
});

test("prorated charges are whole-number kobo (no fractions)", () => {
  const now = at("2026-09-05T13:22:47.000Z");
  const start = at("2026-09-01T00:00:00.000Z");
  const end = at("2026-10-01T00:00:00.000Z");
  const charge = proratedUpgradeCharge(now, start, end);
  assert.ok(Number.isInteger(charge), `charge ${charge} must be whole kobo`);
});

test("addMonths rolls to the last day of the target month for month ends", () => {
  const result = addMonths(at("2026-01-31T00:00:00.000Z"), 1);
  assert.equal(result.toISOString(), "2026-02-28T00:00:00.000Z");
});

test("addMonths handles a full year", () => {
  const result = addMonths(at("2026-09-01T00:00:00.000Z"), 12);
  assert.equal(result.toISOString(), "2027-09-01T00:00:00.000Z");
});