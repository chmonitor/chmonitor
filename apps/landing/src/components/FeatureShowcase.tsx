import { Check } from 'lucide-react'

import { ScreenshotZoom } from '@/components/ScreenshotZoom'
import { FEATURE_SECTIONS } from '@/data/feature-showcase'
import '@/styles/globals.css'

function FeatureBlock({
  section,
}: {
  section: (typeof FEATURE_SECTIONS)[number]
}) {
  const Icon = section.icon

  return (
    <article
      id={section.id}
      className="scroll-mt-20 grid items-center gap-10 min-[881px]:grid-cols-2 min-[881px]:gap-16"
    >
      <div
        className={
          section.reverse ? 'min-[881px]:order-2' : 'min-[881px]:order-1'
        }
      >
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <p className="mt-4 font-medium text-primary text-sm">
          {section.eyebrow}
        </p>
        <h3 className="mt-2 text-balance font-semibold text-2xl tracking-tight sm:text-3xl">
          {section.title}
        </h3>
        <p className="mt-3 max-w-[46ch] text-pretty text-muted-foreground text-sm leading-relaxed sm:text-base">
          {section.description}
        </p>
        <ul className="mt-6 flex list-none flex-col gap-2.5">
          {section.bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex gap-2.5 text-foreground text-sm leading-snug"
            >
              <Check
                className="mt-0.5 size-4 shrink-0 text-emerald-500"
                strokeWidth={2.4}
              />
              {bullet}
            </li>
          ))}
        </ul>
      </div>

      <div
        className={
          section.reverse ? 'min-[881px]:order-1' : 'min-[881px]:order-2'
        }
      >
        <ScreenshotZoom
          id={section.id}
          src={section.screenshot.src}
          alt={section.screenshot.alt}
        />
      </div>
    </article>
  )
}

export default function FeatureShowcase() {
  return (
    <section
      id="features"
      className="border-border/60 border-t bg-muted/20 py-20 sm:py-28"
      data-feature-sections={FEATURE_SECTIONS.length}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-medium text-primary text-sm">What you get</p>
          <h2 className="mt-3 text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
            Everything about your cluster, in one place
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground text-sm sm:text-base">
            Purpose-built views over ClickHouse system tables — queries,
            replication, storage, and health. No exporters, no extra storage.
          </p>
        </div>

        <div className="mt-20 flex flex-col gap-24 sm:gap-28">
          {FEATURE_SECTIONS.map((section) => (
            <FeatureBlock key={section.id} section={section} />
          ))}
        </div>
      </div>
    </section>
  )
}
