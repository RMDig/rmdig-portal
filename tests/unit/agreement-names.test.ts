import { describe, expect, it } from "vitest";

import { codePointLength, normalizeName, passesAlertNameRule } from "@/lib/agreement/names";

// Vectors from AvServ contract account_agreement.md rev 2 §3.2 and its
// validDisplayName. Invisible and look-alike characters are built from code
// points so the source shows exactly which one is under test.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const NBSP = cp(0xa0);
const NEL = cp(0x85);
const EM_SPACE = cp(0x2003);
const RIGHT_QUOTE = cp(0x2019);

describe("normalizeName", () => {
  it("collapses every whitespace run (NBSP and NEL included) and trims", () => {
    expect(normalizeName(`  Jane${NBSP}${NBSP}Q.${EM_SPACE}Public${NEL} `)).toBe("Jane Q. Public");
  });

  it("NFC-normalizes, so a decomposed name equals the composed one", () => {
    expect(normalizeName("Jose" + cp(0x301))).toBe("Jos" + cp(0xe9));
  });

  it("does not treat U+FEFF as whitespace (Go's unicode.IsSpace doesn't)", () => {
    expect(normalizeName(`Jane${cp(0xfeff)}`)).toBe(`Jane${cp(0xfeff)}`);
  });
});

describe("codePointLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(codePointLength(cp(0x1f600))).toBe(1);
    expect("😀".length).toBe(2);
  });
});

describe("passesAlertNameRule (AvServ displayName twin)", () => {
  it.each([
    "Jane",
    "Mary-Jane O'Neil",
    `D${RIGHT_QUOTE}Angelo`,
    "Jos" + cp(0xe9),
    "Zo" + cp(0xeb) + " " + cp(0x141) + "ukasz",
    "a".repeat(40),
  ])("accepts %j", (name) => {
    expect(passesAlertNameRule(name)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["spaces only", "   "],
    ["too long", "a".repeat(41)],
    ["digits", "Jane2"],
    ["a dot", "Dr. Smith"],
    ["an at sign", "jane@x"],
    ["a colon", "a:b"],
    ["a slash", "a/b"],
    ["multiplication sign", "A" + cp(0xd7) + "B"],
    ["division sign", "A" + cp(0xf7) + "B"],
    ["click letter", "A" + cp(0x1c3)],
    ["Cyrillic look-alike", cp(0x417) + "ane"],
    ["Lisu look-alike dot", "evil" + cp(0xa4f8) + "com"],
    ["modifier-letter colon", "a" + cp(0x2d0) + "b"],
    ["no letters", "-'-"],
  ])("refuses %s", (_label, name) => {
    expect(passesAlertNameRule(name)).toBe(false);
  });
});
