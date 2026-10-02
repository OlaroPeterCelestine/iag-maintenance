-- Read-only audit of roles.page_permissions.
--
-- The page ACL treats a non-empty matrix as an allowlist
-- (backend/internal/httpapi/page_acl.go), so a role with a partial matrix loses
-- every page it does not list. Run this after changing role permissions to see
-- what each role can still reach.
--
--   psql "$DATABASE_URL" -f scripts/audit-role-page-matrix.sql

\pset format aligned
\pset border 2

-- Blank CRUD flags are treated as "No" (flagsToCrud / yesFlag). Anything listed
-- here would silently lose access, so it should be empty.
\echo '== roles or users with blank CRUD flags (should be none) =='

SELECT 'role' AS kind, name AS who, can_view, can_create, can_edit, can_delete
FROM roles
WHERE COALESCE(NULLIF(trim(can_view), ''), '') = ''
   OR COALESCE(NULLIF(trim(can_create), ''), '') = ''
   OR COALESCE(NULLIF(trim(can_edit), ''), '') = ''
   OR COALESCE(NULLIF(trim(can_delete), ''), '') = ''
UNION ALL
SELECT 'user', COALESCE(NULLIF(full_name, ''), email), can_view, can_create, can_edit, can_delete
FROM users
WHERE COALESCE(NULLIF(trim(can_view), ''), '') = ''
   OR COALESCE(NULLIF(trim(can_create), ''), '') = ''
   OR COALESCE(NULLIF(trim(can_edit), ''), '') = ''
   OR COALESCE(NULLIF(trim(can_delete), ''), '') = ''
ORDER BY 1, 2;

\echo ''
\echo '== role page matrix =='

WITH flags AS (
  SELECT
    r.name AS role,
    COALESCE(r.can_view, '')   AS can_view,
    COALESCE(r.can_create, '') AS can_create,
    COALESCE(r.can_edit, '')   AS can_edit,
    COALESCE(r.can_delete, '') AS can_delete,
    p.key AS page,
    lower(COALESCE(p.value ->> 'canView', ''))   IN ('yes','true','1','y') AS v,
    lower(COALESCE(p.value ->> 'canCreate', '')) IN ('yes','true','1','y') AS c,
    lower(COALESCE(p.value ->> 'canEdit', ''))   IN ('yes','true','1','y') AS e,
    lower(COALESCE(p.value ->> 'canDelete', '')) IN ('yes','true','1','y') AS d
  FROM roles r
  LEFT JOIN LATERAL jsonb_each(COALESCE(r.page_permissions, '{}'::jsonb)) AS p(key, value) ON TRUE
)
SELECT
  role,
  count(page)                                          AS matrix_keys,
  count(*) FILTER (WHERE v OR c OR e OR d)             AS reachable_pages,
  count(*) FILTER (WHERE page IS NOT NULL
                     AND NOT (v OR c OR e OR d))       AS denied_pages,
  CASE
    WHEN count(page) = 0 THEN 'no matrix - workspace CRUD only'
    ELSE COALESCE(
      string_agg(page, ', ' ORDER BY page) FILTER (WHERE v OR c OR e OR d),
      'NOTHING'
    )
  END                                                  AS reachable
FROM flags
GROUP BY role, can_view, can_create, can_edit, can_delete
ORDER BY role;
