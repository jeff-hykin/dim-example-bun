// dimos-app-server for the Bun example: serves the page (frontend/, no build) and this app's API on the unix socket
// Desktop gives, and talks zenoh itself with zenoh-bun (zenoh inside this process, loaded with bun:ffi).
//
// What Desktop passes: one env var, DIMOS_APP, a JSON object (Desktop's docs/apps.md, "dimos-app-server"):
//   { version, name, socket, url, path, dataDir, desktopUrl, zenohGatewayUrl, zenohGatewayToken, zenohConnect,
//     zenohNamespace, zenohPrefix, dimosDir, dimosPython, recordingsDir, machineId, secrets }
// Read the fields you use and ignore the rest. `secrets` is the app's own secrets (its zenohGatewayToken among them)
// and is never printed or passed on. Which of them this app needs is declared in its dimos.yaml,
// `uses: "@desktop-gateway": env:` (spec v1.5).
// Requests arrive with the app's path (/apps/<name>) already removed: "/api/hello", "/", "/index.html".
//
// Live data: every 250 ms the server publishes its own vitals on <zenohPrefix>/frontend/stats with zenoh-bun; the
// page hears them through Desktop's zenoh-gateway (dimos.yaml `zenoh:` lets it read exactly that).
//
// The API, as dimos.yaml declares it:
//   GET  /api/hello           public (provides:): who we are, how long we've been up, how many samples we've published
//   POST /api/internal/echo   private: the page sends text; the server publishes it back on <zenohPrefix>/frontend/echo
import { Config, open, type Session } from "zenoh-bun"
import { loadavg } from "node:os"
import { join, normalize } from "node:path"

const app = JSON.parse(process.env.DIMOS_APP ?? "{}") as {
    name?: string
    socket?: string
    zenohConnect?: string
    zenohPrefix?: string
}
const flag = (name: string) => {
    const index = process.argv.indexOf(`--${name}`)
    return index === -1 ? undefined : process.argv[index + 1]
}
const frontend = flag("frontend") ?? join(import.meta.dir, "../frontend")
const zenohPrefix = app.zenohPrefix ?? `dim-example-bun/apps/${app.name ?? "local"}`
const startedAt = Date.now()

// ── zenoh: a peer on the local network ("" = multicast scouting), or a client of zenohConnect ──
// 1.6.2: the zenoh version Desktop's zenoh-gateway runs. zenoh failing (no network to fetch its native library on a
// first run, say) leaves the rest of the app up.
let published = 0
const session: Promise<Session | null> = open(new Config(app.zenohConnect ?? ""), { zenohVersion: "1.6.2" })
    .then(async (session) => {
        const stats = await session.declarePublisher(`${zenohPrefix}/frontend/stats`)
        let counter = 0
        let lastCpu = process.cpuUsage()
        let lastAt = performance.now()
        setInterval(() => {
            const cpu = process.cpuUsage(lastCpu)
            const now = performance.now()
            const cpuPercent = ((cpu.user + cpu.system) / 1000 / (now - lastAt)) * 100
            lastCpu = process.cpuUsage()
            lastAt = now
            const memory = process.memoryUsage()
            const sample = {
                counter: counter++,
                time: Date.now(),
                uptimeS: (Date.now() - startedAt) / 1000,
                cpuPercent,
                rssMiB: memory.rss / 2 ** 20,
                heapMiB: memory.heapUsed / 2 ** 20,
                load1: loadavg()[0],
                wave: Math.sin(Date.now() / 1000),
            }
            stats.put(JSON.stringify(sample)).then(() => published++, () => {})
        }, 250)
        return session
    })
    .catch((error) => {
        console.error(`zenoh: ${error}`)
        return null
    })

// Desktop stops an app with SIGTERM to its process group (SIGKILL 5 s later): close the session so peers drop us at
// once, but give up after 2 s
for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => {
        const closed = session.then((open) => open?.close()).catch(() => {})
        await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))])
        process.exit(0)
    })
}

const json = (value: unknown, status = 200) => Response.json(value, { status })

async function api(request: Request, path: string): Promise<Response | null> {
    const route = `${request.method} ${path}`
    if (route === "GET /api/hello") {
        return json({
            shape: "Bun",
            app: app.name ?? "dim-example-bun (outside Desktop)",
            bun: Bun.version,
            uptimeS: Math.round((Date.now() - startedAt) / 1000),
            zenoh: (await session) ? "connected" : "unavailable",
            published,
            statsKey: `${zenohPrefix}/frontend/stats`,
        })
    }
    if (route === "POST /api/internal/echo") {
        const { text } = await request.json().catch(() => ({ text: "" }))
        if (typeof text !== "string" || !text.trim()) {
            return json({ error: "an echo needs `text`" }, 400)
        }
        const open = await session
        if (!open) {
            return json({ error: "zenoh is unavailable" }, 503)
        }
        await open.put(`${zenohPrefix}/frontend/echo`, JSON.stringify({ text: text.trim(), at: Date.now() }))
        return json({ ok: true })
    }
    return path.startsWith("/api/") ? json({ error: `no ${route}` }, 404) : null
}

// ── the page: static files from frontend/ ──
async function file(path: string): Promise<Response> {
    const clean = normalize(path).split("/").filter((part) => part && part !== "..").join("/") || "index.html"
    const found = Bun.file(join(frontend, clean))
    return (await found.exists()) ? new Response(found) : new Response("not found", { status: 404 })
}

async function fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    try {
        return (await api(request, path)) ?? (await file(path))
    } catch (error) {
        return json({ error: String(error) }, 500)
    }
}

if (app.socket) {
    try {
        await Bun.file(app.socket).delete()
    } catch {
        // not there
    }
    Bun.serve({ unix: app.socket, fetch })
    console.error(`listening on ${app.socket}`)
} else {
    // outside Desktop: `bun run serve` serves on a port (open http://localhost:8788/)
    const server = Bun.serve({ port: Number(flag("port") ?? 8788), fetch })
    console.error(`listening on ${server.url}`)
}
