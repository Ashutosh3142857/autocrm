# AutoCRM — GitHub-Ready (Manual Pull + docker-compose)
HubSpot-style starter with CRM + email automation + simple workflows + landing page.

## Monorepo Structure
```
autocrm/
 ├─ backend/        # Express API + Mongo multi-tenant + email workflows
 ├─ frontend/       # React (Vite) UI
 ├─ landing/        # Static landing page (public lead capture)
 ├─ docker-compose.yml
 ├─ Caddyfile       # Reverse proxy (HTTP/HTTPS)
 ├─ .env.example    # Copy to .env and fill values
 ├─ install.sh      # Optional helper to install Docker & start
 └─ README.md
```

## Local Dev (optional)
```bash
cp .env.example .env
docker-compose up -d --build
# Open http://localhost/
# Login: admin@autocrm.cloud / admin123
```

## Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit: AutoCRM"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/<YOUR_REPO>.git
git push -u origin main
```

## Deploy on Your Server (manual pull)
On your VPS (DigitalOcean/Hostinger/etc):
```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/<YOUR_USER>/<YOUR_REPO>.git autocrm
cd autocrm
cp .env.example .env
nano .env   # set SMTP_*, JWT_SECRET, domains, etc.
bash install.sh
# or: docker-compose up -d --build
```

### HTTPS with your domains
Edit `Caddyfile` and replace `:80` with your real domains:
```
autocrm.cloud, demo.autocrm.cloud {
  encode gzip
  handle_path /landing/* { root * /srv/landing; file_server }
  handle_path /api/* { reverse_proxy api:4000 }
  handle { reverse_proxy web:5173 }
}
```
Then:
```bash
docker-compose up -d --build
```

## Default Admin (change in .env)
`admin@autocrm.cloud / admin123`

## Public Lead Intake
- Landing page at `/landing/`
- Public endpoint: `POST /api/public/lead` with `{ firstName, email, tenantId? }`
- Triggers the "Welcome new lead" email workflow (requires SMTP config)

## Security Checklist
- Change `JWT_SECRET` and demo admin password
- Configure SMTP and use a sending domain (SPF/DKIM)
- Add reCAPTCHA to `/api/public/lead` before production
- Restrict SSH and set up a firewall (UFW) on the server
