import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Field methods — snowpack data collection | RMDig",
  description:
    "How the Rocky Mountain Snowpack dataset is collected: snowpit excavation, a novel mini-coring method, crystal-card observation, and magnified profile photography — and, in general terms, how the data feeds avalanche-risk research.",
  alternates: { canonical: "/methods" },
};

// Public research surface (doc 16 §6.2 scan applies). Deliberately GENERAL on
// the modeling side — enough for credibility, not enough to hand competitors
// the recipe (operator decision 2026-07-26). All photos in public/research/
// are EXIF/GPS-stripped copies; raw originals never ship (see .gitignore).
export default function MethodsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Field methods</h1>

      <div className="mt-6 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section className="space-y-4">
          <p>
            Every sample in the{" "}
            <Link href="/snowpack_dataset" className="font-medium underline">
              Rocky Mountain Snowpack dataset
            </Link>{" "}
            starts as fieldwork in the Colorado backcountry. The collection protocol is
            designed so that samples are comparable across sites and seasons: captured in
            chronological series, tied to site metadata, and relatable to weather and
            geographic conditions after the fact.
          </p>
        </section>

        <section>
          <h2>Snowpit excavation</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_240px] sm:items-start">
            <p>
              Collection begins with a standard snow-science pit: a vertical wall cut to
              expose the season&apos;s stratigraphy. The pit wall gives each session its
              structural context — layer boundaries, hardness transitions, and the depth
              ordering that the per-sample imagery hangs off of.
            </p>
            <figure>
              <Image
                src="/research/fieldwork-snowpit.jpg"
                alt="Excavated snowpit with skis, crystal card, and sampling kit"
                width={900}
                height={1200}
                className="rounded-lg border border-neutral-200 dark:border-neutral-800"
              />
              <figcaption className="text-muted-foreground mt-1 text-xs">
                A collection pit, kit staged on the wall.
              </figcaption>
            </figure>
          </div>
        </section>

        <section>
          <h2>The mini-coring method</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-[240px_1fr] sm:items-start">
            <figure>
              <Image
                src="/research/mini-coring-method.jpg"
                alt="Stainless mini-coring tool held over the snowpit wall beside a crystal card and magnifier"
                width={900}
                height={1200}
                className="rounded-lg border border-neutral-200 dark:border-neutral-800"
              />
              <figcaption className="text-muted-foreground mt-1 text-xs">
                The mini-corer, crystal card, and loupe.
              </figcaption>
            </figure>
            <p>
              Cores are extracted with a <strong>novel mini-coring method</strong> developed
              by our founder: a small-diameter corer drawn through the pit wall produces an
              intact cross-section of the layers it passes through, small enough to
              photograph in a controlled frame and fast enough to sample repeatedly down
              the wall. Mini-coring is what makes dense, chronologically ordered sampling
              practical in the field — the property that distinguishes this dataset.
            </p>
          </div>
        </section>

        <section>
          <h2>Crystal cards &amp; magnified profiles</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_240px] sm:items-start">
            <p>
              Extracted samples are staged on a gridded <strong>crystal card</strong> — the
              blue reference surface in these photos — which fixes scale and background so
              images are comparable across sessions. Each sample is photographed twice: the
              core cross-section in full, and the crystal structure under magnification
              through a field loupe. The two views become the dataset&apos;s two imaging
              modalities (core and magnified profile), each labeled with its sequence
              number and session metadata.
            </p>
            <figure>
              <Image
                src="/research/crystal-card.jpg"
                alt="Gridded crystal card with snow core samples and a handwritten sample number"
                width={863}
                height={1200}
                className="rounded-lg border border-neutral-200 dark:border-neutral-800"
              />
              <figcaption className="text-muted-foreground mt-1 text-xs">
                Samples staged on the crystal card, sequence-numbered.
              </figcaption>
            </figure>
          </div>
        </section>

        <section>
          <h2>From data to avalanche-risk research — in general terms</h2>
          <p className="mt-3">
            Our modeling approach builds up in stages. Generative models over each imaging
            modality (the open-source{" "}
            <Link href="/models" className="font-medium underline">
              snowGAN family
            </Link>
            ) force the networks to internalize real snowpack structure. On top of that
            representation work, our avalanche-risk research line (AvAI — Avalanche AI)
            studies how snowpack imagery relates to risk when combined with weather
            timeseries and site conditions. We keep the specifics general here on purpose
            while the research is competitive and unpublished; the models we do release are
            open source, and the dataset itself is open for anyone to explore. This work is
            research in progress — it is not part of the AvAI app today, and when it first
            ships it will be clearly labeled as a research preview.
          </p>
        </section>

        <section>
          <h2>Questions</h2>
          <p className="mt-3">
            Methodology questions, collaboration, or field-protocol details for research
            purposes:{" "}
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
