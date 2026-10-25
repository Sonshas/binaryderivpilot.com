# Migration manifest

**Only file:** `migrations/20260920111952_smartbasebinary_host_schema.sql`

`supabase/migrations` is a junction to that folder. Do not keep separate incremental `.sql` files on disk - fold new DDL into the host schema under a `-- from: <timestamp>_name.sql` marker, then delete the individual file.

Current through: `20261014120000_superadmin_panel.sql`