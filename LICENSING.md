# Licensing

Sagax is a modified distribution of the work originally published as
OpenMausBot. Both the original work and this distribution are under the
[Apache License 2.0](LICENSE).

Copyright 2026 Milind Soni and OpenMausBot contributors. Those notices stay
in [NOTICE](NOTICE). Apache 2.0 section 6 does not grant trademark rights.
The OpenMausBot name and mascot are trademarks of Milind Soni. This product
does not use them as its name. Naming the original project, to say where
the work came from, is the use the license allows.

## What changed in this distribution

- The product name is Sagax.
- The `enterprise/` directory was removed. That directory was not Apache
  2.0: its own license forbade redistribution. None of that source is
  included here, and its license check was not rewritten into this tree.
  `server/enterprise.ts` already starts the open-source edition when the
  directory is absent. The server then reports `{"edition":"oss"}`.
  A workspace configured for hosted sign-in still refuses remote access
  when that adapter is absent.

## What Apache 2.0 requires when you redistribute

1. Give recipients a copy of the Apache License 2.0 (`LICENSE`).
2. State that you changed the files. This file and [NOTICE](NOTICE) record
   the changes above. Add your own changes the same way.
3. Keep all copyright, patent, trademark, and attribution notices from
   the source, including `NOTICE` and [`third_party/`](third_party/).
4. If you ship a notice file with a binary or a source bundle, include a
   readable copy of the attribution notices from `NOTICE` (Apache 2.0
   section 4(d)).
5. Do not use the OpenMausBot name or mascot as the name of your product.

Contributions to this tree are under Apache 2.0. No DCO sign-off and no
CLA are required. Submit only code you wrote or have the right to
contribute. There is no `enterprise/` directory to contribute to.

## Third-party components

Bundled third-party software keeps its own licenses. Notices, license
texts, source locations, and the SBOM are listed in [NOTICE](NOTICE) and
[`third_party/`](third_party/).
