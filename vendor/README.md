# vendor/appkit.bundle.js

Self-hosted **Reown AppKit (WalletConnect)** bundle for Solana, consumed by
`index.html` (exposes `window.__AppKit = { createAppKit, SolanaAdapter, solana }`).

We bundle it ourselves instead of loading `@reown/appkit` from a runtime CDN
(esm.sh) because the CDN's split `export *` chain left `SolanaAdapter` undefined
("not a constructor"), and bundling each package separately would duplicate the
shared AppKit controller singletons and break the modal. A single esbuild bundle
shares deps and resolves all exports at build time.

## Rebuild

```bash
mkdir appkit-build && cd appkit-build
npm init -y && npm pkg set type=module
npm install @reown/appkit@1.8.6 @reown/appkit-adapter-solana@1.8.6 react@18 react-dom@18
npm install -D esbuild esbuild-plugin-polyfill-node
```

`entry.js`:
```js
import { createAppKit } from "@reown/appkit";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { solana } from "@reown/appkit/networks";
window.__AppKit = { createAppKit, SolanaAdapter, solana };
```

`build.js`:
```js
import { build } from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
await build({
  entryPoints: ["entry.js"], bundle: true, format: "iife",
  outfile: "appkit.bundle.js", minify: true, target: ["es2020"],
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [ polyfillNode({ polyfills: { crypto:true, buffer:true, process:true, events:true, stream:true } }) ],
});
```

```bash
node build.js   # → appkit.bundle.js  (~2.5 MB)
```

Copy `appkit.bundle.js` here and bump the `?v=` query in `index.html`'s
`<script src="vendor/appkit.bundle.js?v=N">` so browsers fetch the new copy.
`react`/`react-dom` are only needed so valtio's optional React binding resolves
at build time; no React executes at runtime.
