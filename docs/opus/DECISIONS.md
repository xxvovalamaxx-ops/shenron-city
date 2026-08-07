# Decisions — Opus takeover

Each entry records what was decided, what it rules out, and what would reverse
it. A decision with no reversal condition is a preference, not a decision.

---

## D-001 — The low-FPS statistic is mean-of-slowest, not a percentile

**Decided:** `fps.low1` / `fps.low01` are the *mean frame time of the slowest
1% / 0.1%* of frames. The nearest-rank 99th/99.9th percentile is published
alongside as `fps.low1P99` / `fps.low01P999` but is secondary.

**Why:** mean-of-slowest always contains the worst frame, so it obeys the
invariant `low <= average` on every distribution — which makes it testable, and
the test is what would have caught the original inversion. Nearest-rank p99 on
exactly 100 samples excludes the single worst frame by construction and can
legitimately read *above* the average; that is correct percentile behaviour and
useless as a stutter metric, though it is the better choice for a pass/fail
gate because one catastrophic outlier cannot move it.

**Rules out:** quoting a single "1% low" without saying which convention
produced it. Every emitted summary carries `lows.method`.

**Reversed if:** the project adopts an external comparison target that
publishes only percentiles, in which case the primary flips and the invariant
test must be relaxed to the percentile-specific one already written.

---

## D-002 — Invalidated statistics are renamed, never corrected in place

**Decided:** when a published number turns out to mean something other than its
label, the field is renamed (`fpsP1` → `RETIRED_fpsP1_INVALID`) and the raw
value is kept. It is not deleted, and it is not silently recomputed under the
old name.

**Why:** a consumer reading `fps.p1` after an in-place fix gets a number whose
meaning changed without warning. A consumer reading a name that no longer
exists breaks loudly. Deleting the values instead would destroy the record of
what was actually claimed, which is the only way to audit a past decision.

**Rules out:** regenerating a baseline file over the top of an invalid one
without a preserved INVALIDATED block naming the mechanism and the evidence.

**Reversed if:** never, for published measurements. Internal intermediates may
be corrected in place.

---

## D-003 — External texture dependencies are embedded, not co-located

**Decided:** a model shipped into `public/` carries its textures inside the
GLB. It does not rely on a sibling `Textures/` directory.

**Why:** the immediate bug was five 404s. The trap was the fix: Kenney's car
kit and mini-characters kit use *different* atlases under the *same* relative
name, so shipping one file into a shared directory gives one of the two the
wrong palette — a defect that renders instead of erroring, and therefore one
that would have survived every automated check and most human ones. Embedding
removes the class rather than the instance, and leaves runtime URLs, the
manifest and the loader untouched.

**Rules out:** copying kit models into `public/` by hand. The path is
`scripts/assets/embed-glb-textures.mjs`.

**Reversed if:** a texture is genuinely shared by many models and duplication
costs more than the risk — at which point it gets an explicit, uniquely-named
shared directory, never a relative `Textures/`.

---

## D-004 — Verifiers walk the tree, they do not read a list

**Decided:** asset verification enumerates `public/` itself.

**Why:** the manifest *did* cover the five broken models. It checked provenance
and that the `.glb` existed. Nothing checked what the `.glb` asked for next, and
a list-driven verifier cannot fail on the dependency nobody listed. The failure
mode of a list is silence.

**Rules out:** adding a runtime asset directory without it being scanned.

**Reversed if:** never. A list may *supplement* the walk (for provenance and
licensing, which cannot be derived from the file) but may not replace it.
