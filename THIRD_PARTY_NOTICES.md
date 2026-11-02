# Third-party verification tooling

- PGlite (`@electric-sql/pglite`) 0.5.14 — Apache-2.0.
- Source: https://github.com/electric-sql/pglite ; package metadata checked with npm at adoption.
- Use: devDependency for offline PostgreSQL/WASM schema, FK, transaction and RLS rehearsal only. No app runtime dependency, hosted database, Auth integration or network access in the rehearsal.
- Upstream code is unmodified; no fork. Package version and lockfile pinned.
- This verification tool runs existing database contracts; it does not prove production Supabase compatibility or Google login success.
