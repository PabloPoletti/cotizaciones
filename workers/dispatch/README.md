# Cloudflare Worker — «Actualizar ahora» sin PAT en el navegador

Este Worker recibe `POST /dispatch` desde el panel (GitHub Pages), aplica rate limit (5 min) y dispara `workflow_dispatch` en GitHub usando un token guardado como secret.

## Configuración manual (una vez)

### 1. Cuenta Cloudflare

1. Creá cuenta gratis en https://dash.cloudflare.com/sign-up
2. No hace falta agregar un dominio propio para usar `*.workers.dev`

### 2. Namespace KV (rate limit)

1. Dashboard → **Workers & Pages** → **KV**
2. **Create a namespace** → nombre: `COTIZACIONES_RATE_LIMIT`
3. Copiá el **Namespace ID** y pegalo en `wrangler.toml` reemplazando `REPLACE_WITH_KV_NAMESPACE_ID`

### 3. Token de GitHub (solo servidor)

Creá un PAT dedicado con permiso **Actions: Read and write** en `PabloPoletti/cotizaciones` (fine-grained) o classic con scope `workflow`.

### 4. Wrangler en tu máquina

```bash
cd workers/dispatch
npm install -g wrangler
wrangler login
wrangler secret put GITHUB_TOKEN
# pegá el PAT cuando lo pida (no queda en el repo)
wrangler deploy
```

Anotá la URL que imprime Wrangler, por ejemplo:
`https://cotizaciones-dispatch.TU_SUBDOMINIO.workers.dev`

El endpoint del panel es esa URL + `/dispatch`:
`https://cotizaciones-dispatch.TU_SUBDOMINIO.workers.dev/dispatch`

### 5. Panel

Opción A — commit fijo (recomendado para todos los visitantes):

Editá `docs/js/config.js`:

```javascript
DISPATCH_WORKER_URL: "https://cotizaciones-dispatch.TU_SUBDOMINIO.workers.dev/dispatch",
```

Opción B — solo tu navegador: pegá la URL en el panel → «Guardar URL del Worker».

## Probar

```bash
curl -X POST "https://cotizaciones-dispatch.TU_SUBDOMINIO.workers.dev/dispatch"
```

Primera llamada: `200` con `"ok": true`. Segunda inmediata: `429` con `retry_after_seconds`.

## Variables

| Variable | Dónde | Valor |
|----------|--------|-------|
| `GITHUB_TOKEN` | Secret (Wrangler) | PAT con workflow |
| `GITHUB_OWNER` | wrangler.toml | PabloPoletti |
| `GITHUB_REPO` | wrangler.toml | cotizaciones |
| `GITHUB_WORKFLOW` | wrangler.toml | actualizar.yml |
| `RATE_LIMIT_SECONDS` | wrangler.toml | 300 |
| `RATE_LIMIT_KV` | KV binding | namespace rate limit |
