# Hermes V2 — Distributed Multi-Agent Operating System
## Production Deployment & Operations Guide

Hermes V2 is a goal-oriented, distributed multi-agent operating system engineered to scale across stateless node instances coordinated via PostgreSQL row-level locking on **Supabase**.

---

### 1. Prerequisites & Database Setup

1. **Supabase Project Initialization**:
   - Create a new project on [Supabase](https://supabase.com/).
   - Open the SQL Editor in your Supabase dashboard and execute the complete DDL script located at `src/database/schema.sql`.
   - This creates:
     - `tasks` table with indexes on `(status, priority, required_role)`
     - `task_outputs` table for artifacts (`research_report`, `code_diff`, `test_results`)
     - `agent_registry` and `agent_heartbeats` tables for telemetry
     - `system_logs` table for remote audit trails
     - `claim_next_task` stored procedure (`SELECT ... FOR UPDATE SKIP LOCKED`)

2. **Realtime Pub/Sub Configuration**:
   - In Supabase Dashboard -> **Database** -> **Replication**, enable `supabase_realtime` on the `tasks` table so `TaskEngine` and `TelegramService` receive instantaneous websocket triggers upon task creation.

---

### 2. Environment Variables (`.env`)

Every node instance requires the following environment variables:

| Variable | Required | Description | Default |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `development`, `production`, or `test` | `development` |
| `SUPABASE_URL` | Yes | Your Supabase Project HTTPS URL | - |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Secret Key | - |
| `TELEGRAM_BOT_TOKEN` | No | Bot API Token from `@BotFather` | `placeholder_token` |
| `TELEGRAM_ADMIN_CHAT_ID` | No | Numeric Admin Chat ID | - |
| `AGENT_ROLE` | Yes | Node role (`builder`, `research`, or `both`) | `both` |
| `AGENT_ID` | Optional | Custom unique node identifier | Auto-generated UUID |
| `ENABLE_SCHEDULER_SWEEP` | Optional | `true` on coordinator node, `false` on workers | `true` |
| `PORT` | Optional | HTTP Health Probe Port | `3000` |

---

### 3. Docker Containerization

To deploy Hermes V2 inside Docker or Kubernetes, create the following `Dockerfile` in the project root:

```dockerfile
FROM node:20-slim

# Install Chromium dependencies for Playwright automation
RUN apt-get update && apt-get install -y \
    wget gnupg libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci

# Install Playwright Chromium binary
RUN npx playwright install chromium

COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

---

### 4. Distributed Multi-Node Scaling Strategy

You can horizontally scale Hermes V2 across multiple cloud instances (e.g., Railway, AWS ECS, Google Cloud Run):

#### Node Group A: Builder Workers (High CPU/Memory for Playwright & Builds)
- Set `AGENT_ROLE=builder`
- Set `ENABLE_SCHEDULER_SWEEP=false`
- Deploy 2+ replicas. Thanks to `claim_next_task` atomic Postgres locks, multiple builder nodes will never claim the same task simultaneously.

#### Node Group B: Research Workers (Network Optimized for GitHub/Docs)
- Set `AGENT_ROLE=research`
- Set `ENABLE_SCHEDULER_SWEEP=false`
- Deploy 2+ replicas.

#### Node Group C: Coordinator & Telegram Gateway
- Set `AGENT_ROLE=both` (or stand up a dedicated light node)
- Set `ENABLE_SCHEDULER_SWEEP=true` (runs background crash recovery every 30 seconds)
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`

---

### 5. Health Probes & Monitoring

The built-in Express server exposes standard Kubernetes probes:
- **Liveness/Readiness Probe**: `GET /healthz` (returns `200 OK` when agents are booted and healthy, `503` during shutdown).
- **Cluster Status Summary**: `GET /status` (returns live agent registry metrics).
- **Runtime Metrics**: `GET /metrics` (returns JSON counters for task claims, failures, retries, and average latencies).

---

### 6. Graceful Shutdown & Crash Protection

Hermes V2 intercepts `SIGINT` and `SIGTERM` signals:
1. Immediately closes the HTTP server (`/healthz` returns `503`).
2. Unsubscribes from Supabase Realtime websocket channels cleanly.
3. Stops the heartbeat worker loop and marks the node status `offline` in `agent_registry`.
4. If a node crashes abruptly (e.g. out-of-memory kill), the active `SchedulerSweep` service on the coordinator node detects missed heartbeats (`>45 seconds`), increments the task `retry_count`, resets the task to `pending`, and reassigns it to another healthy node automatically.
