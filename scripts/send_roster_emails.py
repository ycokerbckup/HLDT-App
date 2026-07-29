"""
Sends emails for roster and assignment notifications. Polls the
notifications table for rows not yet emailed, sends via Resend, marks
them processed either way (so a bad email address doesn't retry forever).

Broadcast notifications (roster published/updated/removed, no
target_profile_id) go to every profile with an email on file.
Targeted notifications (individual roster assignments) go only to that
one recipient.
"""
import json
import os
import urllib.error
import urllib.request

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SERVICE_ROLE_KEY"]
RESEND_KEY = os.environ.get("RESEND_API_KEY")
FROM_ADDRESS = os.environ.get("RESEND_FROM", "Display Team Ops <onboarding@resend.dev>")


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


def main():
    if not RESEND_KEY:
        print("RESEND_API_KEY not set — skipping (in-app notifications are unaffected).")
        return

    pending = api_get("/rest/v1/notifications?type=in.(roster,assignment)&emailed=eq.false&select=id,title,body,target_profile_id")
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
        sent = send_email(to, n["title"], f"<p>{n.get('body') or ''}</p>")
        api_patch(f"/rest/v1/notifications?id=eq.{n['id']}", {"emailed": True})
        print(("sent" if sent else "skipped/failed") + ":", n["title"], "->", len(to), "recipients")

    print("Done.")


if __name__ == "__main__":
    main()
