# Threat Intel Platform — Agent Skills

Project-local skills live under `.agents/skills/*/SKILL.md`.

## Skills in this repo

- `threat-intel-platform`: Repo orientation + local dev workflows.
- `threat-intel-web`: Next.js app conventions (UI + API routes).
- `threat-intel-agents`: Agent runners, schedules, and on-demand runs.
- `threat-intel-db`: Drizzle/Neon schema + migration workflow.
- `threat-intel-deploy`: Cloudflare Pages + AWS Serverless deploy notes.
- `threat-intel-mcp`: Python MCP server development + API key scopes.

## Adding a new skill

1. Create a folder: `.agents/skills/<skill-name>/`
2. Add: `.agents/skills/<skill-name>/SKILL.md`
3. Keep it short:
   - **When to use** (trigger phrases)
   - **Where things live** (paths)
   - **Golden path commands** (copy/pasteable)
   - **Common pitfalls** (project-specific)
