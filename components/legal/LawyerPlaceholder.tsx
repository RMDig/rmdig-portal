// A visibly-marked placeholder for operative legal text that only counsel may
// author (live lawyer engagement, AvApp doc 17). Building the page structure
// now and dropping reviewed language in later is deliberate — never replace
// one of these with model-drafted binding language.
export default function LawyerPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-500">
      <p className="font-mono text-xs font-semibold text-neutral-400">[LAWYER]</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
