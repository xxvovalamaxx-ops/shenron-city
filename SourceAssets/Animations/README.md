# Animation library

`Raw/Unverified/` contains the locally restored FBX archive. The files are
intentionally ignored by Git because their provenance and redistribution terms
have not been established.

Workflow:

1. Keep original filenames unchanged in `Raw/Unverified/`.
2. Use `Catalogs/ANIMATION_CATALOG.csv` to filter by suggested motion family.
3. Verify source, license, skeleton, root motion, frame range, and duplicates.
4. Retarget a selected clip in Blender and place the working source in
   `Reviewed/<rig>/<motion>/`.
5. Export only approved, compressed clips to the runtime model that uses them.

Do not load all clips into one Blender file. A `.blend` should link only the
reviewed motions needed by its character or gameplay feature.
