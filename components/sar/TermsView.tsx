import type { SarCapabilitySetting } from "@/lib/db/schema";
import { CAPABILITIES } from "@/lib/sar/terms-rules";

// A terms version as users will read it: the services in the app's plain
// words, then the text exactly as written. Shared by the team's page and the
// staff review queue.
export function TermsView({ body, capabilities }: { body: string; capabilities: SarCapabilitySetting[] }) {
  const names = new Set(capabilities.map((c) => c.name));
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Services the team provides through AvAI</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {CAPABILITIES.filter((c) => names.has(c.name)).map((c) => (
            <li key={c.name}>{c.label}</li>
          ))}
        </ul>
      </div>
      <pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 font-sans text-sm whitespace-pre-wrap">{body}</pre>
    </div>
  );
}
