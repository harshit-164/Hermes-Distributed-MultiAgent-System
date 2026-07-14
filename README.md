# HERMES V2 — DISTRIBUTED MULTI-AGENT OPERATING SYSTEM

Hermes V2 is a distributed AI operating system engineered with a Goal-Oriented, Spec-Driven Development workflow. Specialized, stateless AI agents collaborate asynchronously via a shared **Supabase** database and Realtime pub/sub layer.

## Core Architectural Principles
- **Single Codebase**: All agent nodes execute from the exact same repository (`node src/index.js --role=<role>`).
- **Role-Driven & Configuration-Driven**: Behavior and capabilities dynamically adapt based on `--role=builder` or `--role=research`.
- **Shared Supabase Backend**: Supabase PostgreSQL tables (`tasks`, `task_outputs`, `agent_registry`, `agent_heartbeats`, `system_logs`) serve as the single source of truth.
- **Stateless Agents**: Agents store zero persistent local memory between runs; every transition and artifact is synchronized to Supabase.
- **Atomic Concurrency Control**: Task claiming uses Postgres row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED`) via the `claim_next_task` RPC function.

## Current Roles
1. **Hermes Builder (`builder`)**:
   - Coding, file editing, project implementation, Playwright browser automation, testing.
2. **Hermes Research (`research`)**:
   - Documentation exploration, GitHub search, technology exploration, best practices synthesis.

## Quickstart & Setup
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and configure your Supabase project keys:
   ```bash
   cp .env.example .env
   ```
3. Execute the initial SQL schema in Supabase (`src/database/schema.sql`).
4. Start an agent runner:
   ```bash
   # Start as Builder Agent
   npm run start:builder

   # Start as Research Agent
   npm run start:research
   ```

## Development & Testing
Run the automated unit and verification test suite:
```bash
npm test
```

Run code style and quality linter:
```bash
npm run lint
```
