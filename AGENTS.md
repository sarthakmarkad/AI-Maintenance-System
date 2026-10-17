# Maintenance project

Work in the repository root. Read README.md and docs/DECISIONS.md before changes.

- Keep Maintenance_Handoff and synced reference files read-only and out of Git.
- Keep company workbooks, credentials, local databases and test artifacts private.
- Preserve Next.js/React/TypeScript, NestJS REST, Prisma/PostgreSQL and Supabase Auth.
- Verify identities through Supabase and derive roles/org/machine scope from trusted records.
- Administrator is not an engineering approver. Never introduce an application identity bypass.
- WH-C is the only pilot; do not invent equipment model, engineering limits or operating data.
- Use the built-in in-app browser for UI work.
- Test changes, regenerate API contracts, and update verification evidence.
- No deployment without an explicit user request.
