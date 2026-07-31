"""
Sends emails for roster, assignment, new-signup, and DM-chat notifications.
Polls the notifications table for rows not yet emailed, sends via Gmail
SMTP (see email_utils.py), marks them processed either way (so a bad
email address doesn't retry forever). Team-channel chat broadcasts are
intentionally skipped — every message in a group channel emailing
everyone would be unusable spam.

Every email includes a clickable "Open in app" button pointing at the
right tab (and, for DMs, the right conversation), built from the APP_URL
environment variable / repo variable.
"""
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


def api_patch(path, payload):
    req = urllib.request.Request(
        SUPABASE_URL + path,
        method="PATCH",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}", "Content-Type": "application/json"},
        data=json.dumps(payload).encode(),
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()


def cta_button(link_tab, dm_with):
    if not APP_URL:
        return ""
    url = f"{APP_URL}/?tab={link_tab or 'dashboard'}"
    if dm_with:
        url += f"&dm={dm_with}"
    return (
        f'<p><a href="{url}" '
        f'style="display:inline-block;padding:10px 16px;background:#E8A33D;'
        f'color:#14171C;text-decoration:none;border-radius:6px;font-weight:600;">'
        f'Open in app</a></p>'
    )


def main():
    if not email_configured():
        print("Gmail SMTP not configured — skipping (in-app notifications are unaffected).")
        return
    if not APP_URL:
        print("Warning: APP_URL not set — emails will send without a clickable link.")

    pending = api_get(
        "/rest/v1/notifications?type=in.(roster,assignment,signup,announcement)&emailed=eq.false"
        "&select=id,type,title,body,link_tab,target_profile_id,dm_with_profile_id"
    )
    if not pending:
        print("Nothing to send.")
        return

    profiles = api_get("/rest/v1/profiles?select=id,email")
    email_by_id = {p["id"]: p.get("email") for p in profiles}
    all_emails = [e for e in email_by_id.values() if e]

    for n in pending:
        target = n.get("target_profile_id")
        to = [email_by_id.get(target)] if target else all_emails
        to = [t for t in to if t]

        html = f"<p>{n.get('body') or ''}</p>" + cta_button(n.get("link_tab"), n.get("dm_with_profile_id"))
        sent = send_email(to, n["title"], html)
        api_patch(f"/rest/v1/notifications?id=eq.{n['id']}", {"emailed": True})
        print(("sent" if sent else "skipped/failed") + ":", n["title"], "->", len(to), "recipients")

    print("Done.")


if __name__ == "__main__":
    main()
