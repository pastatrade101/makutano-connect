# The edge

Caddy terminates TLS for every Makutano site from one shared Caddyfile at
`~/app/config/Caddyfile` on the host. It is not in any repository — this file
records the parts that belong to Connect and Journeys so a change is not
invisible the next time somebody reads the deployment.

Reload after editing, never restart: twenty other sites share the process.

```bash
docker run --rm -v ~/app/config/Caddyfile:/etc/caddy/Caddyfile:ro caddy:latest \
  caddy validate --config /etc/caddy/Caddyfile
docker exec makutano-digital-caddy caddy reload --config /etc/caddy/Caddyfile
```

## Compression

`encode` was absent, and its absence was invisible: SvelteKit's node adapter
precompresses the files it BUILDS, so stylesheets and scripts arrived as brotli
and looked fine. Everything rendered per request did not. The homepage was 267
KB of HTML on the wire, and every public API response went out raw — 70 KB for
the destination list alone.

Measured on the marketplace homepage, mobile Lighthouse, median of three runs:
first contentful paint 5.0s to 3.6s, largest contentful paint 6.3s to 4.8s. The
document itself went from 267 KB to 43 KB.

```caddyfile
connect.makutano.co.tz {
    # Proxied responses are not compressed by anything upstream: the Node adapter
    # only pre-compresses the files it built, so every API payload and every
    # server-rendered page went out raw.
    encode zstd gzip
    reverse_proxy makutano-connect:3000
}```

```caddyfile
journeys.makutano.co.tz {
    # The home page is 267 KB of HTML uncompressed, which on a throttled phone is
    # over a second of transfer before anything can paint. Static assets already
    # arrive as brotli because SvelteKit precompresses them at build time; this is
    # for everything rendered per request.
    encode zstd gzip
    reverse_proxy makutano-journeys:3000
}```
