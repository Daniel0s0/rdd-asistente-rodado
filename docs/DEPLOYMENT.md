# Deployment — RDD Asistente Rodado

Procedimiento de despliegue al VPS con PM2. Ver también [SETUP.md](SETUP.md) para el setup inicial.

---

## Requisitos en el VPS

- Node.js 18+ y npm
- PM2 global: `npm install -g pm2`
- Repo clonado (ej. `/home/deploy/rdd-asistente-rodado`)
- `.env` de producción presente en la raíz (nunca commiteado) — ver `.env.example`
- Carpeta de logs: `mkdir -p /home/deploy/logs` (PM2 escribe en `../logs/` relativo a `deployment/`)

## Deploy (cada release)

Automatizado con [scripts/deploy.sh](../scripts/deploy.sh), o manual:

```bash
cd /home/deploy/rdd-asistente-rodado
git pull origin main
npm ci
npm run test                 # la suite DEBE estar verde
npm run build
pm2 startOrReload deployment/pm2.config.js
curl -fsS http://localhost:3001/health/ready | jq .
```

**Criterio de éxito:** `/health/ready` responde 200 con `"status": "ok"` y todos los
servicios en `true`. Si responde 503, revisar `pm2 logs rdd --lines 50`.

## Rollback

```bash
cd /home/deploy/rdd-asistente-rodado
git log --oneline -5                  # identificar commit estable anterior
git checkout <commit-estable>
npm ci && npm run build
pm2 reload rdd
curl -fsS http://localhost:3001/health/ready
# Volver a main cuando el fix esté listo: git checkout main
```

## HTTPS (Nginx + Let's Encrypt)

El app escucha en `localhost:3001`; exponer solo vía reverse proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name rdd.tudominio.cl;
    ssl_certificate     /etc/letsencrypt/live/rdd.tudominio.cl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rdd.tudominio.cl/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        # Socket.io necesita upgrade de conexión
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Certificado: `sudo certbot --nginx -d rdd.tudominio.cl`

## Monitoreo post-deploy

- `pm2 status` — proceso `rdd` online, sin restarts en loop
- `pm2 logs rdd --lines 30` — sin errores al arranque
- `curl localhost:3001/health/ready` — 200 ok
- Webhook de prueba desde el SaaS (causa de test) → verificar fila en Sheets REGISTRO

## Notas operacionales

- **wait_ready:** PM2 espera el `process.send('ready')` del app (máx 10s) antes de marcar online.
- **Graceful shutdown:** `pm2 reload` envía SIGTERM; el app drena conexiones hasta 10s
  (kill_timeout PM2: 15s).
- **Crashes:** unhandledRejection/uncaughtException → log + exit(1) → PM2 reinicia automático.
- **CI:** todo push a main corre type-check + lint + tests + build en GitHub Actions
  ([.github/workflows/ci.yml](../.github/workflows/ci.yml)). No deployar si CI está rojo.
