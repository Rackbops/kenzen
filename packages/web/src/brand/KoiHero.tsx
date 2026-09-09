/**
 * kenzen#109: the koi banner as a hero band, always visible. #92 put this same asset only in
 * the Needs-a-decision positive empty state, which never renders while anything is queued --
 * in normal, steady-state use (something always queued) the banner was effectively invisible.
 * Repos.tsx is the landing/overview view -- browse every ingested repo regardless of decision
 * state -- so the hero lives there, above the repo list in every one of its states (loading,
 * error, ready), rather than gated behind an empty state that may never occur.
 *
 * Purely decorative (`alt=""`) -- no heading here; the header already carries the wordmark, and
 * the empty state keeps its own kanji heading independently. This is the one brand asset that
 * does not recolour with the theme -- see `brand/README.md`'s "Deriving the empty-state banner"
 * section for why (a fixed-colour photographic composition, not a `--rb-*`-tokenised graphic).
 */
export function KoiHero() {
  return (
    <section className="kz-hero">
      <img src="/brand/koi-banner.webp" alt="" className="kz-hero__banner" />
    </section>
  )
}
