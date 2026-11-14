import { describe, expect, it } from "vitest"
import { fmtDuration, fmtMetric, fmtScore, fmtTokens } from "./format"

describe("fmtScore", () => {
  it("writes three decimals", () => {
    expect(fmtScore(1)).toBe("1.000")
    expect(fmtScore(0.5)).toBe("0.500")
    expect(fmtScore(0.52349)).toBe("0.523")
    expect(fmtScore(0)).toBe("0.000")
  })
  it("writes a dash when there is no score", () => {
    expect(fmtScore(undefined)).toBe("–")
    expect(fmtScore(Number.NaN)).toBe("–")
  })
})

describe("fmtTokens", () => {
  it("separates thousands and rounds to a whole number", () => {
    expect(fmtTokens(0)).toBe("0")
    expect(fmtTokens(999)).toBe("999")
    expect(fmtTokens(1_234_567)).toBe("1,234,567")
    expect(fmtTokens(500_000_000)).toBe("500,000,000")
    expect(fmtTokens(1234.6)).toBe("1,235")
  })
  it("writes a dash when there is no count", () => {
    expect(fmtTokens(undefined)).toBe("–")
    expect(fmtTokens(Number.NaN)).toBe("–")
  })
})

describe("fmtDuration", () => {
  it("writes m:ss below one hour", () => {
    expect(fmtDuration(0)).toBe("0:00")
    expect(fmtDuration(17_000)).toBe("0:17")
    expect(fmtDuration(100_000)).toBe("1:40")
    expect(fmtDuration(1_800_000)).toBe("30:00")
    expect(fmtDuration(3_599_000)).toBe("59:59")
  })
  it("writes h:mm:ss from one hour up", () => {
    expect(fmtDuration(3_600_000)).toBe("1:00:00")
    expect(fmtDuration(14_400_000)).toBe("4:00:00")
    expect(fmtDuration(86_400_000)).toBe("24:00:00")
    expect(fmtDuration(3_725_000)).toBe("1:02:05")
  })
  it("rounds to the nearest second", () => {
    expect(fmtDuration(1_499)).toBe("0:01")
    expect(fmtDuration(59_600)).toBe("1:00")
  })
  it("writes a dash for a missing or negative duration", () => {
    expect(fmtDuration(undefined)).toBe("–")
    expect(fmtDuration(-5)).toBe("–")
    expect(fmtDuration(Number.NaN)).toBe("–")
  })
})

describe("fmtMetric", () => {
  it("keeps whole numbers whole and gives others two decimals", () => {
    expect(fmtMetric(3)).toBe("3")
    expect(fmtMetric(0.456)).toBe("0.46")
    expect(fmtMetric(undefined)).toBe("—")
  })
})
