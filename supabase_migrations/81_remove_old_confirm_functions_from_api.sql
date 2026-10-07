-- (Applied to production on 2026-10-07, after the app switched to the *_v2 confirm functions.)
-- The old confirm_* functions raise errors, which rolls back the failed-attempt counter.
revoke execute on function public.confirm_withdrawal(uuid, text, text), public.confirm_pin_change(uuid, text),
  public.confirm_phone_change(uuid, text) from authenticated;
