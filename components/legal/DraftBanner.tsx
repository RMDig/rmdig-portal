// Required on every legal page until lawyer sign-off (CLAUDE_BOOTSTRAP §7).
// Remove only when counsel approves the page it sits on. Worded as an
// under-review notice rather than a "DRAFT" stamp: store and carrier (A2P)
// reviewers read the page, and a DRAFT headline invites "incomplete policy"
// rejections — while the honest content is the same: facts are current,
// operative clauses await counsel.
export default function DraftBanner() {
  return (
    <div className="mb-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 text-sm text-neutral-600 dark:text-neutral-300">
      <p className="font-semibold text-neutral-900 dark:text-neutral-50">
        Under review by counsel
      </p>
      <p className="mt-1">
        The descriptions of our data practices and how the service works are current and
        accurate. Sections marked <span className="font-mono">[LAWYER]</span> are
        placeholders where reviewed legal language will appear.
      </p>
    </div>
  );
}
