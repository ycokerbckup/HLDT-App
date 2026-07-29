"""
Sends emails for roster, assignment, new-signup, and DM-chat notifications.
Polls the notifications table for rows not yet emailed, sends via Resend,
marks them processed either way (so a bad email address doesn't retry
forever). Team-channel chat broadcasts are intentionally skipped — every
message in a group channel emailing everyone would be unusable spam.

Every email includes a clickable "Open in app" button pointing at the
right tab (and, for DMs, the right conversation), built from the APP_URL
environment variable / repo variable.
"""
import json
import os
import urllib.error
import urllib.request

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SERVICE_ROLE_KEY"]
RESEND_KEY = os.environ.get("RESEND_API_KEY")
FROM_ADDRESS = os.environ.get("RESEND_FROM", "Display Team Ops <onboarding@resend.dev>")
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


def send_email(to_list, subject, html):
    if not to_list:
        return False
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        method="POST",
        headers={"Authorization": f"Bearer {RESEND_KEY}", "Content-Type": "application/json"},
        data=json.dumps({"from": FROM_ADDRESS, "to": to_list, "subject": subject, "html": html}).encode(),
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
        return True
    except urllib.error.HTTPError as e:
        print("send failed:", e.code, e.read().decode()[:300])
        return False


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
    if not RESEND_KEY:
        print("RESEND_API_KEY not set — skipping (in-app notifications are unaffected).")
        return
    if not APP_URL:
        print("Warning: APP_URL not set — emails will send without a clickable link.")

    pending = api_get(
        "/rest/v1/notifications?type=in.(roster,assignment,signup,chat)&emailed=eq.false"
        "&select=id,type,title,body,link_tab,target_profile_id,dm_with_profile_id"
    )
    if not pending:
        print("Nothing to send.")
        return

    profiles = api_get("/rest/v1/profiles?select=id,email")
    email_by_id = {p["id"]: p.get("email") for p in profiles}
    all_emails = [e for e in email_by_id.values() if e]

    for n in pending:
        # Team-channel chat broadcasts have no target_profile_id — too high
        # volume to email. Mark processed and move on.
        if n["type"] == "chat" and not n.get("target_profile_id"):
            api_patch(f"/rest/v1/notifications?id=eq.{n['id']}", {"emailed": True})
            continue

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
