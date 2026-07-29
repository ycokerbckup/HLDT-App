"""
Sends birthday reminder emails (7 days before, 1 day before, day-of) to
Welfare/Operations/Admin-unit admins, via Resend's email API (free tier:
3,000 emails/month, no cost). Mirrors the in-app reminder logic that
already runs inside Supabase via pg_cron — this is the email half of it.

If RESEND_API_KEY isn't set, this exits quietly. In-app reminders keep
working either way; email is additive, not a dependency.
"""
import datetime
import json
import os
import urllib.error
import urllib.request

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SERVICE_ROLE_KEY"]
RESEND_KEY = os.environ.get("RESEND_API_KEY")
FROM_ADDRESS = os.environ.get("RESEND_FROM", "Display Team Ops <onboarding@resend.dev>")
APP_URL = os.environ.get("APP_URL", "").rstrip("/")


def cta_button():
    if not APP_URL:
        return ""
    return (
        f'<p><a href="{APP_URL}/?tab=dashboard" '
        f'style="display:inline-block;padding:10px 16px;background:#E8A33D;'
        f'color:#14171C;text-decoration:none;border-radius:6px;font-weight:600;">'
        f'Open in app</a></p>'
    )


def api_get(path):
    req = urllib.request.Request(
        SUPABASE_URL + path,
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read().decode()
        return json.loads(body) if body else []


def send_email(to_list, subject, html):
    if not to_list:
        return
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        method="POST",
        headers={"Authorization": f"Bearer {RESEND_KEY}", "Content-Type": "application/json"},
        data=json.dumps({"from": FROM_ADDRESS, "to": to_list, "subject": subject, "html": html}).encode(),
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print("sent:", subject, "->", len(to_list), "recipients")
    except urllib.error.HTTPError as e:
        print("send failed:", e.code, e.read().decode()[:300])


def main():
    if not RESEND_KEY:
        print("RESEND_API_KEY not set — skipping email send (in-app reminders are unaffected).")
        return

    members = api_get("/rest/v1/members?select=id,name,dob,unit,profile_id")
    profiles = api_get("/rest/v1/profiles?select=id,email,role")
    profile_by_id = {p["id"]: p for p in profiles}

    eligible_emails = set()
    for m in members:
        if m.get("unit") in ("Welfare", "Operations", "Admin") and m.get("profile_id"):
            prof = profile_by_id.get(m["profile_id"])
            if prof and prof.get("role") == "admin" and prof.get("email"):
                eligible_emails.add(prof["email"])

    if not eligible_emails:
        print("No eligible Welfare/Operations/Admin recipients found.")
        return

    today = datetime.date.today()
    offsets = {7: "in 7 days", 1: "tomorrow", 0: "today"}

    for m in members:
        dob = m.get("dob")
        if not dob or "/" not in dob:
            continue
        try:
            day, month = (int(x) for x in dob.split("/"))
        except ValueError:
            continue
        for offset, label in offsets.items():
            target = today + datetime.timedelta(days=offset)
            if target.day == day and target.month == month:
                subject = f"Birthday reminder: {m['name']} is {label}"
                html = f"<p><strong>{m['name']}'s</strong> birthday is {label} ({dob}).</p><p>Time to plan something for them.</p>" + cta_button()
                send_email(list(eligible_emails), subject, html)

    print("Done.")


if __name__ == "__main__":
    main()
