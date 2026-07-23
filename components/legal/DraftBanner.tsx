// Required on every legal page until lawyer sign-off (CLAUDE_BOOTSTRAP §7:
// "Until reviewed, ship with placeholder text + a 'DRAFT — pending legal
// review' banner"). Remove only when counsel approves the page it sits on.
export default function DraftBanner() {
  return (
    <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">DRAFT — pending legal review</p>
      <p className="mt-1">
        This document is under review by our counsel. The factual descriptions of what data
        we collect and how the service works are accurate today; sections marked{" "}
        <span className="font-mono">[LAWYER]</span> are placeholders for reviewed legal
        language.
      </p>
    </div>
  );
}
