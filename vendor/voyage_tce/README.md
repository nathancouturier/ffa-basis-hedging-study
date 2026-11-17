# Vendored: voyage-tce-model

These files are copied byte for byte from
https://github.com/nathancouturier/voyage-tce-model at commit
`0be3b7eb0c1bfda63135ce717b5cb4b335426532`, from these addresses:

```
https://raw.githubusercontent.com/nathancouturier/voyage-tce-model/0be3b7eb0c1bfda63135ce717b5cb4b335426532/<path>
```

| Path here | Upstream path | Why it is here |
|---|---|---|
| `src/voyage/engine.py` | `src/voyage/engine.py` | The voyage estimate and TCE: this study prices every weekly C3 and C5 voyage with it |
| `src/voyage/baltic.py` | `src/voyage/baltic.py` | The Baltic's route and vessel definitions (GMB v8.8, with pages) the voyages are built from |
| `src/engine.js` | `src/engine.js` | The browser mirror of the voyage engine, held to the Python engine upstream |
| `data/engine.json` | `data/engine.json` | The constants `src/engine.js` is configured with |
| `data/paper.json` | `data/paper.json` | The Paper view's voyages: the anchors this study reproduces to 1e-9 |
| `LICENSE` | `LICENSE` | MIT, Copyright (c) 2026 Nathan Couturier |

They are not edited. `SHA256SUMS` holds their hashes, and
`tests/test_vendor.py` fails if any byte changes. The study wraps them in
`src/ffabasis/voyage.py`.
