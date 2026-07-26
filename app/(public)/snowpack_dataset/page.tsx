import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Rocky Mountain Snowpack Dataset — open avalanche & snow science data | RMDig",
  description:
    "An open, CC-BY-4.0 dataset of Rocky Mountain snowpack profile and core imagery with site metadata, hosted on Hugging Face — the research foundation for AvAI (Avalanche AI).",
  alternates: { canonical: "/snowpack_dataset" },
};

// schema.org/Dataset markup — what makes the corpus eligible for Google
// Dataset Search (name + description required; license/creator/sameAs
// recommended). Kept in step with the Hugging Face dataset card.
const DATASET_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "Rocky Mountain Snowpack",
  description:
    "Open dataset of Rocky Mountain snowpack imagery: cross-sectional photos of extracted snow cores and magnified snowpack profile images from pit walls, captured in chronological series with site metadata for snow-science and machine-learning research.",
  url: "https://rmdig.ai/snowpack_dataset",
  sameAs: "https://huggingface.co/datasets/RMDig/rocky_mountain_snowpack",
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true,
  keywords: ["snowpack", "avalanche", "snow science", "machine learning", "Colorado"],
  creator: {
    "@type": "Organization",
    name: "Rocky Mountain Digerati LLC",
    url: "https://rmdig.ai",
  },
};

// Lives at the EXACT path the pre-cutover marketing site used — this URL is
// Google's strongest-ranking page for the brand ("Rocky Mountain Digerati |
// Avalanche Risk AI") and appears in press coverage, so it must keep
// resolving. Copy discipline (doc 16 §6.2 scan) applies; note the research
// framing — the AvAI model is described as in-development research, never as
// a shipped app capability (doc 22's claim ladder).
export default function SnowpackDatasetPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        The Rocky Mountain Snowpack dataset
      </h1>

      <div className="mt-6 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section className="space-y-4">
          <p>
            Rocky Mountain Digerati publishes an open dataset of snowpack imagery collected
            in the Colorado backcountry: cross-sectional photos of extracted snow cores and
            snowpack profile images from pit walls, captured in chronological series so
            samples can be related to weather, geographic, and site conditions.
          </p>
          <p>
            The dataset is public under a <strong>CC-BY-4.0</strong> license and hosted on
            Hugging Face as{" "}
            <a
              href="https://huggingface.co/datasets/rmdig/rocky_mountain_snowpack"
              className="font-medium underline"
              rel="noopener"
            >
              rmdig/rocky_mountain_snowpack
            </a>
            . You can pull it directly with the <code>huggingface_hub</code> Python library
            and use it for machine-learning research, snow-science coursework, or anything
            else the license permits.
          </p>
        </section>

        <section>
          <h2>The research it feeds</h2>
          <p className="mt-3">
            This corpus is the foundation for our avalanche-safety research line: the{" "}
            <Link href="/models" className="font-medium underline">
              open-source snowGAN models
            </Link>{" "}
            over the two imaging modalities (magnified profile imagery and core samples)
            and, building on those,{" "}
            <strong>AvAI — Avalanche AI</strong> — a model in development that studies
            avalanche-risk signals in snowpack imagery alongside weather timeseries. This
            work is research in progress: it is not part of the AvAI app today, and when it
            first ships it will be clearly labeled as a research preview.
          </p>
        </section>

        <section>
          <h2>Contributing</h2>
          <p className="mt-3">
            The dataset grows through fieldwork. The{" "}
            <Link href="/" className="font-medium underline">
              AvAI app
            </Link>{" "}
            — our beta backcountry safety companion — includes field capture of snowpack
            profile and core photos; at this stage of the beta those photos stay on your
            device, and a future opt-in contribution flow will let users add their captures
            to this public dataset with explicit consent.
          </p>
        </section>

        <section>
          <h2>Citation &amp; contact</h2>
          <p className="mt-3">
            Cite the dataset via its Hugging Face card, which carries the canonical
            citation text and revision history. Questions, collaboration, or corrections:{" "}
            <a href="mailto:support@rmdig.ai" className="font-medium underline">
              support@rmdig.ai
            </a>
            .
          </p>
        </section>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(DATASET_JSONLD) }}
      />
    </article>
  );
}
