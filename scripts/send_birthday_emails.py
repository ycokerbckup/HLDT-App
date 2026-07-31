"""
Sends birthday reminder emails (7 days before, 1 day before, day-of) to
Welfare/Operations/Admin-unit admins, via Gmail SMTP (see email_utils.py).
Mirrors the in-app reminder logic that already runs inside Supabase via
pg_cron — this is the email half of it.

If Gmail SMTP isn't configured, this exits quietly. In-app reminders
keep working either way; email is additive, not a dependency.
"""
import datetime
import json
import os
import urllib.request

from email_utils import send_email, email_configured

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SERVICE_ROLE_KEY"]
APP_URL = os.environ.get("APP_URL", "").rstrip("/")


def api_get(path):
    req = urllib.request.Request(
        SUPABASE_URL + path,
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read().decode()
        return json.loads(body) if body else []


def cta_button():
    if not APP_URL:
        return ""
    return (
        f'<p><a href="{APP_URL}/?tab=dashboard" '
        f'style="display:inline-block;padding:10px 16px;background:#E8A33D;'
        f'color:#14171C;text-decoration:none;border-radius:6px;font-weight:600;">'
        f'Open in app</a></p>'
    )


def main():
    if not email_configured():
        print("Gmail SMTP not configured — skipping email send (in-app reminders are unaffected).")
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
