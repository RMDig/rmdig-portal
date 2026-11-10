"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyRows, polygonFromRows, rowsFromPolygon, type VertexPolygon, type VertexRow, type VertexRowError } from "@/lib/map/vertex-rows";

// The service area as a table of corner points: the keyboard path through the
// area editor (plan 33 §6.3 step 4, step 9.6; WCAG 2.1.1). A finished drawing
// fills the table; "Use these points" sends the table to the map and the form.
export function VertexTable({ polygon, onApply }: { polygon: VertexPolygon | null; onApply: (p: VertexPolygon) => void }) {
  const id = useId();
  const [rows, setRows] = useState<VertexRow[]>(() => (polygon ? rowsFromPolygon(polygon) : emptyRows()));
  const [errors, setErrors] = useState<VertexRowError[]>([]);
  const [message, setMessage] = useState<{ kind: "error" | "status"; text: string } | null>(null);
  // The row whose latitude takes focus after the next render (add, remove).
  const focusRow = useRef<number | null>(null);
  // The area this table last applied, so it isn't read back over what was typed.
  const [applied, setApplied] = useState<VertexPolygon | null>(null);

  // A new area from the map (or a cleared one) replaces what was typed.
  const [shown, setShown] = useState(polygon);
  if (polygon !== shown) {
    setShown(polygon);
    if (polygon !== applied) {
      setRows(polygon ? rowsFromPolygon(polygon) : emptyRows());
      setErrors([]);
      setMessage(null);
    }
  }

  useEffect(() => {
    if (focusRow.current === null) return;
    document.getElementById(`${id}-lat-${focusRow.current}`)?.focus();
    focusRow.current = null;
  });

  const edit = (i: number, field: keyof VertexRow, value: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const add = () => {
    setRows((rs) => [...rs, { lat: "", lon: "" }]);
    focusRow.current = rows.length;
  };
  const remove = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setErrors([]);
    focusRow.current = Math.max(0, Math.min(i, rows.length - 2));
  };
  const apply = () => {
    const result = polygonFromRows(rows);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage({ kind: "error", text: result.message });
      return;
    }
    setErrors([]);
    setMessage({ kind: "status", text: `Using these ${result.points} points.` });
    setApplied(result.polygon);
    onApply(result.polygon);
  };
  // Enter in a point applies the table instead of submitting the whole form.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    apply();
  };

  const errorFor = (row: number, field: "lat" | "lon") => errors.find((e) => e.row === row && e.field === field);

  return (
    <fieldset className="space-y-3" aria-describedby={`${id}-help`}>
      <legend className="text-sm font-medium">Corner points</legend>
      <p id={`${id}-help`} className="text-muted-foreground text-xs">
        Or type each corner in decimal degrees, in order around the area; the last point joins back to the first. A drawing on the map fills this in.
      </p>
      <table className="w-full text-sm">
        <caption className="sr-only">Corner points of the service area</caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="w-16 pb-1 font-medium">Point</th>
            <th scope="col" className="pb-1 font-medium">Latitude</th>
            <th scope="col" className="pb-1 font-medium">Longitude</th>
            <th scope="col" className="w-24 pb-1">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row" className="pr-2 font-normal">{i + 1}</th>
              {(["lat", "lon"] as const).map((field) => {
                const err = errorFor(i, field);
                return (
                  <td key={field} className="py-1 pr-2">
                    <Input
                      id={`${id}-${field}-${i}`}
                      aria-label={`Point ${i + 1} ${field === "lat" ? "latitude" : "longitude"}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={r[field]}
                      onChange={(e) => edit(i, field, e.target.value)}
                      onKeyDown={onKeyDown}
                      aria-invalid={!!err}
                      aria-describedby={err ? `${id}-err-${field}-${i}` : undefined}
                    />
                  </td>
                );
              })}
              <td className="py-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} disabled={rows.length <= 1} aria-label={`Remove point ${i + 1}`}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length > 0 ? (
        <ul className="space-y-1 text-sm text-red-700 dark:text-red-400">
          {errors.map((e) => (
            <li key={`${e.field}-${e.row}`} id={`${id}-err-${e.field}-${e.row}`}>
              {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p
        role={message?.kind === "error" ? "alert" : "status"}
        className={message?.kind === "error" ? "text-sm text-red-700 dark:text-red-400" : "text-muted-foreground text-sm"}
      >
        {message?.text}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add a point
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={apply}>
          Use these points
        </Button>
      </div>
    </fieldset>
  );
}
