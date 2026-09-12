-- Phase 55: Security fix — the cover_requests update policy had an
-- "OR auth.role() = 'authenticated'" clause, which makes the whole
-- policy meaningless: it let any logged-in user update ANY field on
-- ANY cover request, not just claim ones that are actually open. The
-- app's own code happened to behave correctly, but nothing stopped a
-- direct API call from tampering with someone else's request, or an
-- already-claimed one. Tightened to: you can always update your own
-- request, or touch one that's currently open (to claim it) — never
-- someone else's already-resolved request.
-- Run after 61_sanitize_profile_name.sql.

drop policy "requester or claimant updates cover request" on cover_requests;

create policy "requester or claimant updates cover request" on cover_requests for update using (
  exists (select 1 from members m where m.id = requester_id and m.profile_id = auth.uid())
  or status = 'open'
);
