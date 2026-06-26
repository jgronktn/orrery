# Deploying Orrery to the Droplet

> Replace `<your-domain>` throughout with the host you serve Orrery from.

Production runs the same stack as dev but via **`docker-compose.prod.yml`** (standalone):
no `--reload`, no source bind mounts, only the backend published (host-local on
`127.0.0.1:8000`), running as the dedicated `orrery` user, behind the box's **host nginx**
+ **certbot** TLS. The frontend is built to static files served by nginx.

Architecture: browser → nginx (`:443`, TLS) → static SPA from `/srv/orrery/frontend` +
`/api` proxied to `127.0.0.1:8000` (backend) → engineering/corporate agents → LiteLLM
gateway → Anthropic, with Postgres + Qdrant + the git-versioned file store at
`/var/lib/orrery/files`. gateway/qdrant/postgres/agents are **not** published to the host.

## One-time server prep

```bash
# 1. Docker access for the orrery user (run as root/sudo)
sudo groupadd docker            # if the group is missing
sudo usermod -aG docker orrery
sudo systemctl restart docker
# log out/in as orrery, then verify:
docker ps

# 2. The static dir nginx serves (root)
sudo mkdir -p /srv/orrery/frontend
sudo chown -R orrery:orrery /srv/orrery
sudo chmod 755 /srv /srv/orrery /srv/orrery/frontend

# 3. File store (should already exist from earlier prep; ensure ownership + git)
sudo mkdir -p /var/lib/orrery/files
sudo chown -R orrery:orrery /var/lib/orrery
sudo -u orrery git -C /var/lib/orrery/files rev-parse --is-inside-work-tree \
  || sudo -u orrery git -C /var/lib/orrery/files init -b main

# 4. Clone the repo (as orrery)
sudo -iu orrery
git clone https://github.com/jgronktn/orrery.git ~/orrery
cd ~/orrery
```

## Secrets — `.env` (in the repo root, as orrery)

Create `~/orrery/.env`. The session secret + Postgres password are generated for you
(below); paste your real `ANTHROPIC_API_KEY`. Never commit this file.

```dotenv
# required
ANTHROPIC_API_KEY=sk-ant-...
ORRERY_SESSION_SECRET=<generated>
POSTGRES_PASSWORD=<generated>
ORRERY_UID=<id -u orrery>
ORRERY_GID=<id -g orrery>
ORRERY_CORS_ORIGINS=["https://<your-domain>"]

# optional (leave blank to disable)
LOGFIRE_TOKEN=
EXA_API_KEY=
SLACK_BOT_TOKEN=
SLACK_APPROVAL_CHANNEL=
```

Set the UID/GID:

```bash
echo "ORRERY_UID=$(id -u orrery)" >> .env
echo "ORRERY_GID=$(id -g orrery)" >> .env
```

Copy the Google service-account key to the repo root (from your machine):

```bash
scp service-account.json orrery@<droplet>:~/orrery/service-account.json
```

## Build + run (as orrery, in `~/orrery`)

```bash
docker compose -f docker-compose.prod.yml build          # 3 Python images (slow first time)
docker compose -f docker-compose.prod.yml --profile build run --rm frontend-builder
docker compose -f docker-compose.prod.yml up -d          # backend auto-runs `alembic upgrade head`
docker compose -f docker-compose.prod.yml ps             # all services healthy
```

## nginx + TLS (root)

```bash
sudo apt install -y certbot python3-certbot-nginx        # if not already present
sudo cp infra/nginx/orrery.conf /etc/nginx/sites-available/
# edit /etc/nginx/sites-available/orrery.conf — set server_name to <your-domain>
sudo ln -s /etc/nginx/sites-available/orrery.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <your-domain>                    # adds 443 + 80->443 redirect
```

## Firewall

Allow inbound **22, 80, 443 only** (DigitalOcean Cloud Firewall and/or `ufw`). The
internal services bind to the Docker network (and the backend to `127.0.0.1`), so they
are not reachable from the internet regardless.

## First user

The prod database starts empty. Register the first account at
`https://<your-domain>`.

## Verify

1. `curl -I https://<your-domain>` → `200`, valid Let's Encrypt cert, 80→443 redirect.
2. From the public internet, `nc -vz <droplet> 4000` (and 8000/5432/6333/8001/8002) → refused.
3. Register + log in; the session cookie is `Secure`+`HttpOnly`.
4. Upload a file >1 MB in a project → lands in `/var/lib/orrery/files/...`, git-committed;
   ask an agent → a response returns and the gateway logs the call.
5. `docker compose -f docker-compose.prod.yml logs backend` → migrations ran, no errors.
6. Reboot the droplet → everything comes back (`restart: unless-stopped`).

## Updates

```bash
cd ~/orrery && git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml --profile build run --rm frontend-builder
```

## Backups

- Postgres: nightly `pg_dump` (cron), e.g.
  `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U orrery orrery | gzip > ~/backups/orrery-$(date +%F).sql.gz`.
- File store: it's a git repo at `/var/lib/orrery/files` — add a private remote and push
  for off-box history.

## Notes

- The LiteLLM gateway has no master key, but port 4000 is **not** published in prod (the
  config's warning is satisfied — it's reachable only on the Docker network).
- Frontend fonts (Space Grotesk / Space Mono) load from Google Fonts at runtime; if the
  CDN is blocked the UI falls back to system fonts (cosmetic only).
