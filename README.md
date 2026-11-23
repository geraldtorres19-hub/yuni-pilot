# PROJECT YUNI - Housekeeping & IPC Monitoring (PILOT, dummy data only)

Static web app (GitHub Pages) + Supabase backend (database functions, Auth, one Edge Function).
**Do not enter real patient or staff information.** Checklist wording is placeholder text and is not hospital approved.

- `index.html`, `app.js`, `supa.js`, `config.js`, `styles.css`, `sw.js`, `vendor/` - the web app
- `supabase/` - database migrations, demo seed and the `staff-admin` Edge Function source (for the record; already applied)
- `config.js` holds only the public project URL and publishable key. Never add a secret/service key to this repository.
