# Supreme Maintenance Intelligence

Persisted maintenance work orders.

Implemented: authenticated registry, production import, synthetic process trends and role-controlled reporting, assignment, repair, engineering review and closure. Trusted backend role resolution is included as the authorization foundation for the next login/role-view milestone. Google sign-in and selectable role UX follow in the next commit.

## Local development

Requirements: Node 22.12–24, npm 11, PostgreSQL 16 and a Supabase Auth project.

Copy the root and frontend `.env.example` files to private local environment files and configure your database, frontend origin and public Supabase settings. Never commit credentials or company workbooks.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run db:grants
npm run dev
```

The frontend opens at http://localhost:3000; the NestJS API is at http://localhost:4000/api. Provision verified Auth UUIDs through the trusted owner CLI. Administrator has no engineering approval authority.

Run `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:web` and `npm run build` for relevant checks. Database workflow tests require a separate database ending in `_test`; never point tests at operational records. Browser checks use fixtures. Hosted persistence and deployment remain pending. See docs/VERIFICATION.md for acceptance boundaries.

This commit is a logical implementation checkpoint reconstructed from locally saved sources. Commit dates record this Git import, not original implementation times.
