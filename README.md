# dim-example-bun

```sh
dimos-desktop install github.com/jeff-hykin/dim-example-bun
```

(or Desktop → App Store → **Install From URL** → `github.com/jeff-hykin/dim-example-bun`)

[![Use this template](https://img.shields.io/badge/Use%20this%20template-2ea44f?style=for-the-badge&logo=github)](https://github.com/jeff-hykin/dim-example-bun/generate)

A [dimOS Desktop](https://github.com/jeff-hykin/dimos-desktop-mirror) app with a [Bun](https://bun.sh) server that
talks zenoh itself through [zenoh-bun](https://github.com/jeff-hykin/zenoh-bun) (zenoh inside the Bun process, via
`bun:ffi`), and a page built entirely from [dimos-react](https://github.com/jeff-hykin/dimos-react), with no build step.
How apps work: **[Making a dimOS app](https://github.com/jeff-hykin/dimos-desktop-mirror/blob/main/docs/create-apps/index.md)**.
Other examples: [plain HTML](https://github.com/jeff-hykin/dim-example-html) ·
[Deno + React](https://github.com/jeff-hykin/dim-example-deno) · [Rust](https://github.com/jeff-hykin/dim-example-rust).

## Server: live data over zenoh

Desktop starts `bin/dimos-app-server` with one env var, `DIMOS_APP` (JSON: the unix `socket` to serve on, the zenoh
endpoint `zenohConnect`, this install's own keys `zenohPrefix`, ...). The server opens a zenoh session with zenoh-bun and
publishes its vitals on `<zenohPrefix>/frontend/stats` four times a second:

```ts
import { Config, open } from "zenoh-bun"

const app = JSON.parse(process.env.DIMOS_APP ?? "{}")
const session = await open(new Config(app.zenohConnect ?? ""), { zenohVersion: "1.6.2" }) // Desktop's gateway runs 1.6.2
const stats = await session.declarePublisher(`${app.zenohPrefix}/frontend/stats`)
setInterval(() => stats.put(JSON.stringify({ counter: counter++, cpuPercent, rssMiB, wave: Math.sin(Date.now() / 1000) })), 250)

Bun.serve({ unix: app.socket, fetch }) // the page and api/..., with /apps/<name> already removed
```

## Page: dimos-react, by URL

One import map, no build: React and dimos-react from esm.sh at pinned versions.

```html
<script type="importmap">
    {
        "imports": {
            "react": "https://esm.sh/react@19.2.0",
            "react/": "https://esm.sh/react@19.2.0/",
            "react-dom": "https://esm.sh/react-dom@19.2.0",
            "react-dom/": "https://esm.sh/react-dom@19.2.0/",
            "dimos-react": "https://esm.sh/gh/jeff-hykin/dimos-react@v0.3.1/src/index.ts?external=react,react-dom,three"
        }
    }
</script>
```

`AppProvider` gives the page Desktop's skin (followed live) and its one zenoh-gateway connection; `useBackendEvents`
hears this app's frontend topics:

```js
import { createElement as h } from "react" // dimos-react v0.2 no longer re-exports it

useBackendEvents((sample) => setLatest(sample), { topic: "stats" }) // <zenohPrefix>/frontend/stats

h(Stat, { label: "cpu", value: latest.cpuPercent.toFixed(1), unit: "%" })
h(Sparkline, { values: history.wave, min: -1, max: 1 })
```

A round trip: the page `POST`s `api/internal/echo`, the server publishes the text on `<zenohPrefix>/frontend/echo`, and
every open page of the app hears it (a toast).

## `dimos.yaml` (spec v1.2): what it may do on zenoh

The page may only listen to its own server's frontend topics; everything else on zenoh is refused (zenoh's ACL shape:
`default_permission`, and rules with `id`, `messages`, `key_exprs`, `permission`). Installed under another name
(`--name`), change `dim-example-bun` in the key.

```yaml
spec-version: v1.4
uses:
    "@zenoh-gateway": ">=0.5 <0.6"
zenoh:
    default_permission: deny
    read:
        - id: own-frontend-topics
          messages: [declare_subscriber, put] # open the subscription, and receive its samples
          key_exprs: ["dimos-desktop/*/apps/dim-example-bun/frontend/**"]
          permission: allow
```

A Desktop that reads an older spec (v1.1) installs it anyway and ignores `zenoh:` (with a warning). Check it:
`dimos-desktop app check .`

## Develop

```sh
bun install
bun run serve        # http://localhost:8788/ (outside Desktop: no zenoh-gateway, so no live data on the page)
nix build .#dimosApp # what Desktop's install runs
```

## Files

- `server/main.ts`: the server (zenoh-bun session, the API, the static page)
- `frontend/index.html`: the whole page
- `flake.nix`: `dimosApp`, with zenoh-bun (pinned by tag) and its native library fetched by sha256, so it runs offline
- `dimos.yaml`: the contract with Desktop · `icon.svg`: its icon
