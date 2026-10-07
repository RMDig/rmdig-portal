import { describe, expect, it } from "vitest";

import { submittedValues } from "@/components/forms/use-submitted-values";

// React 19 resets uncontrolled fields after a form action; the forms feed
// back what was submitted as defaultValues, so a rejected submit keeps it.

const form = (fields: Array<[string, string]>) => {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  return fd;
};

describe("submittedValues", () => {
  it("keeps the submitted text and lists, only for the keys it was given (never a password)", () => {
    const next = submittedValues(
      { name: "", audiences: ["everyone"] as string[] },
      form([["name", "Summit SAR"], ["audiences", "sar_admins"], ["audiences", "staff"], ["currentPassword", "secret"]]),
    );
    expect(next).toEqual({ name: "Summit SAR", audiences: ["sar_admins", "staff"] });
  });

  it("keeps the previous value for a field that wasn't in the form, and an emptied list as empty", () => {
    expect(submittedValues({ name: "Saved", regionName: "Summit County" }, form([["name", "Edited"]]))).toEqual({
      name: "Edited",
      regionName: "Summit County",
    });
    expect(submittedValues({ audiences: ["everyone"] as string[] }, form([]))).toEqual({ audiences: [] });
  });
});
