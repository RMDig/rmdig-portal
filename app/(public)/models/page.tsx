import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Open-source snowpack models — snowGAN | RMDig",
  description:
    "RMDig's open-source generative models for snowpack imagery — snowGAN (magnified profile and core variants) on Hugging Face — plus experimental avalanche-research models in the snowGradient repo.",
  alternates: { canonical: "/models" },
};

// Public research surface (doc 16 §6.2 scan applies). Same claim-ladder rule
// as /snowpack_dataset: these are research artifacts described as research —
// never as shipped app capability.
export default function ModelsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Open-source models</h1>

      <div className="mt-6 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section className="space-y-4">
          <p>
            Alongside the{" "}
            <Link href="/snowpack_dataset" className="font-medium underline">
              Rocky Mountain Snowpack dataset
            </Link>
            , we publish open-source models trained on it. They&apos;re research artifacts
            for the snow-science and machine-learning communities — explore them, break
            them, build on them.
          </p>
        </section>

        <section>
          <h2>snowGAN</h2>
          <p className="mt-3">
            Our generative family over snowpack imagery, published on Hugging Face under
            the{" "}
            <a href="https://huggingface.co/RMDig" className="font-medium underline" rel="noopener">
              RMDig
            </a>{" "}
            organization in two variants, one per imaging modality:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <a
                href="https://huggingface.co/RMDig/snowGAN-magnified-profile"
                className="font-medium underline"
                rel="noopener"
              >
                snowGAN-magnified-profile
              </a>{" "}
              — image-to-image model over magnified snowpack <em>profile</em> imagery
              (stratigraphy from pit walls).
            </li>
            <li>
              <a
                href="https://huggingface.co/RMDig/snowGAN-core"
                className="font-medium underline"
                rel="noopener"
              >
                snowGAN-core
              </a>{" "}
              — image-to-image model over extracted snow <em>core</em> cross-sections.
            </li>
          </ul>
          <p className="mt-3">
            Learning to generate realistic snowpack imagery forces the models to internalize
            the structure of real snowpack — layering, grain texture, density transitions —
            which is what makes the generative work a stepping stone for the analysis
            models that follow.
          </p>
        </section>

        <section>
          <h2>snowGradient — experimental</h2>
          <p className="mt-3">
            Current model experiments live in the open{" "}
            <a
              href="https://github.com/dennys246/snowGradient"
              className="font-medium underline"
              rel="noopener"
            >
              snowGradient
            </a>{" "}
            repository — the testing ground for candidate architectures in our
            avalanche-risk research line (AvAI — Avalanche AI). This work is research in
            progress: it is not part of the AvAI app today, and when it first ships it will
            be clearly labeled as a research preview.
          </p>
        </section>

        <section>
          <h2>License &amp; contact</h2>
          <p className="mt-3">
            See each model card for license and usage details; the underlying dataset is
            CC-BY-4.0. Questions or collaboration:{" "}
            <a href="mailto:support@rmdig.ai" className="font-medium underline">
              support@rmdig.ai
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
