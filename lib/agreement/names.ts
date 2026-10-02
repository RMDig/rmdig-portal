// Name normalization shared with AvServ (contract account_agreement.md §3.2).
//
// AvServ is authoritative for every name rule; the portal never refuses a name
// AvServ would take. This module exists for two narrow uses:
//  - normalizeName: length checks in code points, as AvServ counts them;
//  - passesAlertNameRule: deciding whether the portal display name may PREFILL
//    the "Name on your alerts" field (plan 31 D1). A name that fails here is
//    simply not prefilled — the user types one and AvServ judges it.
// It is a twin of AvServ internal/api/agreement.go validDisplayName; if they
// drift, the only effect is a missed or offered prefill, never a wrong save.

// Go's strings.Fields splits on unicode.IsSpace: ASCII whitespace, U+0085,
// U+00A0 and the Z categories. JS \s differs (it adds U+FEFF, drops U+0085), so
// the set is spelled out.
const SPACE_RUN = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

/** NFC, every whitespace run collapsed to one space, trimmed. (Not
 *  String#trim: it also strips U+FEFF, which AvServ keeps and then refuses.) */
export function normalizeName(raw: string): string {
  return raw.normalize("NFC").replace(SPACE_RUN, " ").replace(/^ | $/g, "");
}

/** Length in Unicode code points (AvServ counts runes, not UTF-16 units). */
export function codePointLength(s: string): number {
  return [...s].length;
}

export const LEGAL_NAME_MAX = 100;
export const ALERT_NAME_MAX = 40;

// Latin letters only: Basic Latin, Latin-1 Supplement and Latin Extended-A/B,
// minus × ÷ and the click letters ǀ ǁ ǂ ǃ (they read as bars and "!").
function isAlertNameLetter(cp: number): boolean {
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return true;
  if (cp === 0xd7 || cp === 0xf7 || (cp >= 0x1c0 && cp <= 0x1c3)) return false;
  return cp >= 0xc0 && cp <= 0x24f;
}

/** True when AvServ would accept `raw` as a displayName (the alert name). */
export function passesAlertNameRule(raw: string): boolean {
  const s = normalizeName(raw).replace(/\u2019/g, "'");
  const n = codePointLength(s);
  if (n === 0 || n > ALERT_NAME_MAX) return false;
  let letters = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isAlertNameLetter(cp)) letters++;
    else if (ch !== " " && ch !== "-" && ch !== "'") return false;
  }
  return letters > 0;
}
