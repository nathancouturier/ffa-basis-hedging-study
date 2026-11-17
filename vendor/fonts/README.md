# Fonts

Self-hosted so the site makes no request to another host at run time. Both faces are under the SIL Open
Font License 1.1; each folder holds the licence as published in the google/fonts repository. The woff2
files are Fontsource's Latin subsets of the Google Fonts releases (Fontsource 5.3.0), downloaded from
Fontsource's font-files repository on raw.githubusercontent.com on 17 November 2026.

| File | Face | Source | sha256 |
|---|---|---|---|
| `figtree/figtree-latin-wght-normal.woff2` | Figtree, variable weight 300 to 900, Latin | https://raw.githubusercontent.com/fontsource/font-files/main/fonts/variable/figtree/files/figtree-latin-wght-normal.woff2 | `4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd` |
| `figtree/OFL.txt` | Figtree licence (Copyright 2022 The Figtree Project Authors) | https://raw.githubusercontent.com/google/fonts/main/ofl/figtree/OFL.txt | `140d37233e7f3ce7313798befa9600893bcceaf41a55fa0fa5ad52f7f657a268` |
| `newsreader/newsreader-latin-500-normal.woff2` | Newsreader 500, Latin | https://raw.githubusercontent.com/fontsource/font-files/main/fonts/google/newsreader/files/newsreader-latin-500-normal.woff2 | `5613e2fc8377392c02e8ac9d55014689fb5320a5f2a7be55e8088a314728ac2c` |
| `newsreader/OFL.txt` | Newsreader licence (Copyright 2020 The Newsreader Project Authors) | https://raw.githubusercontent.com/google/fonts/main/ofl/newsreader/OFL.txt | `fdfad38143ec470553cae82a1e45320bdd1b9ec70415d37bd0171051d8a4ded8` |

Figtree (Erik Kennedy, https://github.com/erikdkennedy/figtree) sets all text and every number; its
`tnum` feature gives the tabular figures the site uses throughout. Newsreader (Production Type,
https://github.com/productiontype/Newsreader) sets only the takeaway sentence that opens each view.

To check a file: `sha256sum vendor/fonts/*/*`.
