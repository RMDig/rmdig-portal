import { describe, expect, it } from "vitest";

import { emptyRows, polygonFromRows, rowsFromPolygon } from "@/lib/map/vertex-rows";

// The corner-points table's conversions (plan 33 §6.3 step 4, step 9.6): a
// drawing becomes rows and rows become the same closed polygon; a bad row is
// an error on that field, numbered as the table shows it.

const square = {
  type: "Polygon" as const,
  coordinates: [[[-108, 37], [-107, 37], [-107, 38], [-108, 38], [-108, 37]]],
};
const rows = (...pts: Array<[string, string]>) => pts.map(([lat, lon]) => ({ lat, lon }));

describe("rowsFromPolygon", () => {
  it("lists the outer ring latitude first, without the closing point", () => {
    expect(rowsFromPolygon(square)).toEqual(rows(["37", "-108"], ["37", "-107"], ["38", "-107"], ["38", "-108"]));
  });

  it("rounds to the 6 decimals the sync keeps", () => {
    const drawn = { type: "Polygon" as const, coordinates: [[[-105.123456789, 39.987654321], [-105, 39], [-105.5, 39.5], [-105.123456789, 39.987654321]]] };
    expect(rowsFromPolygon(drawn)[0]).toEqual({ lat: "39.987654", lon: "-105.123457" });
  });
});

describe("polygonFromRows", () => {
  it("round-trips a drawing", () => {
    expect(polygonFromRows(rowsFromPolygon(square))).toEqual({ ok: true, polygon: square, points: 4 });
  });

  it("skips blank rows, ignores a typed closing point, and trims spaces", () => {
    const r = polygonFromRows(rows([" 37 ", "-108"], ["", ""], ["37", "-107"], ["38", "-107"], ["38", "-108"], ["37", "-108"]));
    expect(r).toEqual({ ok: true, polygon: square, points: 4 });
  });

  it("accepts a leading + and a bare decimal point", () => {
    const r = polygonFromRows(rows(["+37", "-108"], ["37.", "-107"], [".5", "-107"]));
    expect(r).toMatchObject({ ok: true, polygon: { coordinates: [[[-108, 37], [-107, 37], [-107, 0.5], [-108, 37]]] } });
  });

  it("marks each bad field by its table number", () => {
    const r = polygonFromRows(rows(["37", "-108"], ["91", "-107"], ["38", "abc"], ["38", ""]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([[1, "lat"], [2, "lon"], [3, "lon"]]);
    expect(r.errors[0]?.message).toMatch(/^Point 2: enter a latitude between -90 and 90/);
    expect(r.errors[1]?.message).toMatch(/^Point 3: enter a longitude between -180 and 180/);
  });

  it("refuses commas, degree signs, exponents and out-of-range longitudes", () => {
    for (const bad of ["37,5", "37°", "3e1", "0x10", "-"]) {
      expect(polygonFromRows(rows([bad, "-108"], ["37", "-107"], ["38", "-107"])).ok).toBe(false);
    }
    expect(polygonFromRows(rows(["37", "-181"], ["37", "-107"], ["38", "-107"])).ok).toBe(false);
  });

  it("needs three different points", () => {
    expect(polygonFromRows(emptyRows())).toEqual({ ok: false, message: "An area needs at least 3 different points.", errors: [] });
    expect(polygonFromRows(rows(["37", "-108"], ["37", "-108"], ["38", "-107"]))).toMatchObject({ ok: false, errors: [] });
  });
});
