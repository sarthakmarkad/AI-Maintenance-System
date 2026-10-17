# Maintenance project

Work in this repository root. Read README.md and docs/DECISIONS.md before changes.

- Use Codex's built-in desktop/in-app browser for UI work. Do not automate the user's personal Chrome browser unless they explicitly request it.
- Maintenance_Handoff/ is read-only local reference; never edit or commit it.
- Company workbooks and credentials must stay outside Git and public assets.
- Preserve Next.js / React / TypeScript + NestJS REST + Prisma/PostgreSQL + Supabase Auth.
- Never add a development identity bypass to the application. Test doubles belong in tests only.
- Roles and organization scope come from trusted application records. Administrator is not an engineering approver.
- WH-C is the only pilot. Model unknown. WH-B is reference-only.
- SRS v1.0 is baseline; its full text was not supplied. Do not invent authoritative requirements.
- Synthetic process data cannot establish causes of authentic production losses.
- No deployment/publication without an explicit user request.
- Read docs/PRODUCTION-IMPORT.md before import/schema changes. Preserve job grain, source references and separate daily controls; never guess flagged dates or combine authentic and synthetic totals.
- Run checks relevant to changes and update docs/VERIFICATION.md with actual evidence and limits.
- Read docs/PROCESS-READINGS.md before reading import/analysis changes. Keep all observations synthetic, retain IST/UTC conversion and separate receipt times, and exclude event labels/formula flags from review calculations.
- Read docs/WORK-ORDERS.md before workflow changes. Preserve trusted operational roles, immutable report/history evidence, independent restoration/review/closure times, atomic version checks and audit. Keep test incidents in the isolated test database.

- Read docs/TEAM-ACCESS.md before auth/role changes. A requested active role must match trusted grants; never combine roles or infer authority from Google/email metadata. Read docs/GOOGLE-SIGN-IN-SETUP.md before provider changes; no client secrets in frontend config.
- Read docs/CALENDAR.md before calendar/scheduler changes. Keep fixed IST anchors, immutable occurrence snapshots, duplicate-safe generation/reminders, explicit head release, and planned completion distinct from breakdown RCA/restoration. Never seed invented company schedules into operational data.
