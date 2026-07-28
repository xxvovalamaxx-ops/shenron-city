# Animation library rights audit

## Decision

The historical FBX archive is a private authoring input, not a publishable
asset pack. None of its 2,393 files may be added to the public GitHub tree
until the source and acquisition rights of the individual file are proven.

This does not prevent Shenzhen City from using properly licensed animation.
The shipped service android carries 14 CC0 motion clips. The Kenney citizen
pipeline now adds three verified CC0 motions (`Idle`, `Jump`, and `Run`) and
six skins through a reproducible Blender export. Source URLs, archive hashes,
license text, conversion code, and runtime hashes are tracked under
`SourceAssets/Models/Characters/KenneyAnimatedCharacters/`.

Additional clips can be added from sources with explicit redistribution terms,
or from the historical archive after its ownership evidence is recovered.
The two Quaternius Universal Animation Library Standard archives are now
downloaded and hash-recorded. Their 86 source clips are cataloged, and 29
city-relevant motions are shipped on the exact matching 65-joint CC0 Male
Ranger outfit. The raw archives remain in ignored verified-source storage; combat,
weapon, death, magic, swimming, zombie, and duplicate bind-pose clips are not
promoted without implemented gameplay.

Reviewed replacement sources:

- <https://kenney.nl/assets/animated-characters-retro>
- <https://kenney.nl/assets/animated-characters-protagonists>
- <https://quaternius.com/packs/universalanimationlibrary.html>
- <https://quaternius.com/packs/universalanimationlibrary2.html>
- <https://quaternius.com/packs/modularcharacteroutfitsfantasy.html>

## Evidence read

- `SourceAssets/Catalogs/ANIMATION_CATALOG.csv` contains 2,393 data rows.
- Every row is marked `license-review-required`.
- The archive first entered repository history in commit
  `743dca8d30dc7c6a0ffcd0f21db212f740c4f5c8`, authored by contributor
  `pupikyafe`, with the message `animations`.
- That commit contains filenames and FBX data but no source URL, receipt,
  license, downloader identity, or acquisition date.
- The filenames resemble motions available from Mixamo, but resemblance is
  not provenance and does not establish who downloaded them under which
  account or terms.

Catalog families:

| Suggested family | Files |
| --- | ---: |
| Other / unclassified | 743 |
| Locomotion | 621 |
| Combat | 519 |
| Interaction | 166 |
| Idle | 125 |
| Dance | 85 |
| Social | 67 |
| Sports | 64 |
| Medical | 3 |

## Why raw publication is blocked

Adobe's official Mixamo FAQ permits royalty-free use of Mixamo characters and
animations in video games. Adobe's published licensing clarification also
states that raw character or animation files may not be redistributed to
customers or non-team members. A public Git repository is raw redistribution.
Even those terms cannot be applied to this archive until its Mixamo origin and
authorized acquisition are documented.

Primary references:

- <https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html>
- <https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400>

## Unblocking evidence

For any historical clip selected for the game, record:

1. The exact provider and source page.
2. The account holder or contributor who acquired it.
3. The acquisition date and terms that applied on that date.
4. Permission for the intended delivery form.
5. Its original SHA-256, target rig, duplicate group, and game use.

If raw redistribution remains prohibited, keep the source clip outside the
public repository and publish only a project output when the provider's terms
explicitly allow that delivery. A CC0 or project-authored replacement remains
the default when those facts cannot be recovered.
