import type { Metadata } from "next";
import Link from "next/link";

import { GITHUB_URL, HUGGING_FACE_URL } from "@/components/public/BrandIcons";
import { pageMetadata } from "@/lib/seo";

const PERSONAL_SITE_URL = "https://www.dennyschaedig.com";

export const metadata: Metadata = pageMetadata({
  title: "Founder — Denny Schaedig | RMDig",
  description:
    "Denny Schaedig founded Rocky Mountain Digerati to build open snowpack data and AI for avalanche research, a project that began in his master's program in AI and machine learning.",
  path: "/founder",
});

// Facts here come from the founder's own published bio (personal site
// story/experience pages); keep them in step with it rather than adding new
// claims. Copy discipline (doc 16 §6.2 scan) applies: AvAI is a beta, and the
// avalanche-risk model is in-development research.
export default function FounderPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Denny Schaedig, founder</h1>

      <div className="mt-6 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section className="space-y-4">
          <p>
            Denny Schaedig is a machine learning engineer and the founder of Rocky Mountain
            Digerati, the small Colorado company behind the open snowpack dataset and AvAI.
            He&apos;s a Colorado native based in Summit County, and a PSIA-certified ski
            instructor. More about him and his other work is on{" "}
            <a href={PERSONAL_SITE_URL} rel="noopener" className="font-medium underline">
              his personal website
            </a>
            .
          </p>
          <p>
            He came to machine learning through neuroscience. While earning a B.A. in
            Neuroscience at the University of Colorado Boulder, he studied how the brain
            learns and forms memories, and coursework in computer science and models of
            cognition drew him toward AI. He went on to apply deep learning to brain-imaging
            data and works as a NeuroImaging Engineer at Washington University in St. Louis.
          </p>
        </section>

        <section>
          <h2>Where the project started</h2>
          <p className="mt-3">
            The snowpack work began as his capstone for an M.S. in Artificial Intelligence and
            Machine Learning at Colorado State University Global, completed in 2025. The
            question was whether generative AI could help with avalanche-risk prediction.
            There was no open imagery of the snowpack to learn from, so he dug the snowpits
            himself. Over two winters he collected 4,040 image samples from seven snowpits,
            using a mini-coring method he developed.
          </p>
          <p className="mt-3">
            That collection became the{" "}
            <Link href="/snowpack_dataset" className="font-medium underline">
              Rocky Mountain Snowpack dataset
            </Link>
            , published openly on Hugging Face. The generative models trained on it,{" "}
            <Link href="/research/models" className="font-medium underline">
              snowGAN
            </Link>
            , became the starting point for the avalanche-risk research that continues
            today.
          </p>
        </section>

        <section>
          <h2>What it grew into</h2>
          <p className="mt-3">
            Rocky Mountain Digerati grew out of the capstone as an independent applied-ML lab.
            Alongside the dataset and models, it builds AvAI, a beta backcountry safety
            companion app whose check-out/check-in feature alerts your emergency contact if
            you don&apos;t check in on time. The avalanche-risk model is still research, not
            something the app provides yet.
          </p>
          <p className="mt-3">
            The dataset grows through fieldwork, and you can help:{" "}
            <Link href="/collection_signup" className="font-medium underline">
              sign up to collect snowpack data
            </Link>
            .
          </p>
        </section>

        <section>
          <h2>Get in touch</h2>
          <p className="mt-3">
            Email{" "}
            <a href="mailto:dennys@rmdig.ai" className="font-medium underline">
              dennys@rmdig.ai
            </a>
            , visit{" "}
            <a href={PERSONAL_SITE_URL} rel="noopener" className="font-medium underline">
              dennyschaedig.com
            </a>
            , or find the open-source work on{" "}
            <a href={GITHUB_URL} rel="noopener" className="font-medium underline">
              GitHub
            </a>{" "}
            and{" "}
            <a href={HUGGING_FACE_URL} rel="noopener" className="font-medium underline">
              Hugging Face
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
