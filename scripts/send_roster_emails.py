"""
Sends emails and push notifications for roster, assignment, new-signup,
chat, and other notifications. Polls the notifications table for rows
not yet fully processed on both channels (email + push are tracked
independently — one can succeed while the other fails, or one can be
unconfigured while the other still works). Team-channel chat broadcasts
stay silent on both channels — emailing/pushing everyone for every group
message would be unusable spam. Chat/mention notifications to a specific
person also skip both channels if that person was active on the site
within the last 90 seconds — they'll see it live already.

Every email includes a clickable "Open in app" button pointing at the
right tab (and, for DMs, the right conversation), built from the APP_URL
environment variable / repo variable. Push notifications carry the same
destination as JSON data the service worker reads on click.
"""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from email_utils import send_email, email_configured

try:
    from pywebpush import webpush, WebPushException
    PUSH_AVAILABLE = True
except ImportError:
    PUSH_AVAILABLE = False

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SERVICE_ROLE_KEY"]
APP_URL = os.environ.get("APP_URL", "").rstrip("/")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_CLAIM_EMAIL = os.environ.get("VAPID_CLAIM_EMAIL", "")

PRESENCE_TYPES = {"chat", "mention"}
PRESENCE_WINDOW_SECONDS = 90

NOTIFICATION_TYPES = (
    "roster,assignment,signup,chat,announcement,birthday,milestone,graduation,"
    "cover_request,saturday_roster_reminder,tuesday_roster_reminder,attendance_warning,"
    "attendance_suspension,monthly_digest,suspension_action_needed,mention,"
    "attendance_marking_reminder,suspension_lifted,special_event_reminder,"
    "special_event_assignee_reminder,new_special_event,event_personal_reminder"
)


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


def api_delete(path):
    req = urllib.request.Request(
        SUPABASE_URL + path,
        method="DELETE",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()


def recently_active(last_seen_at_str):
    if not last_seen_at_str:
        return False
    last_seen = datetime.fromisoformat(last_seen_at_str.replace("Z", "+00:00"))
    return datetime.now(timezone.utc) - last_seen < timedelta(seconds=PRESENCE_WINDOW_SECONDS)


HIGHLIGHT_BY_TYPE = {
    "saturday_roster_reminder": "saturday-roster-section",
    "tuesday_roster_reminder": "tuesday-roster-section",
}


def build_url(link_tab, dm_with, highlight_id=None):
    if not APP_URL:
        return "/"
    url = f"{APP_URL}/?tab={link_tab or 'dashboard'}"
    if dm_with:
        url += f"&dm={dm_with}"
    if highlight_id:
        url += f"&highlight={highlight_id}"
    return url


def cta_button(url):
    if not APP_URL:
        return ""
    return (
        f'<p><a href="{url}" '
        f'style="display:inline-block;padding:10px 16px;background:#E8A33D;'
        f'color:#14171C;text-decoration:none;border-radius:6px;font-weight:600;">'
        f'Open in app</a></p>'
    )


def send_push(subscription, title, body, url):
    try:
        webpush(
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
            },
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIM_EMAIL},
        )
        return True
    except WebPushException as e:
        status = e.response.status_code if e.response is not None else None
        if status in (404, 410):
            # Dead subscription (uninstalled, browser data cleared) — clean it up.
            api_delete(f"/rest/v1/push_subscriptions?endpoint=eq.{urllib.parse.quote(subscription['endpoint'], safe='')}")
        else:
            print("  push failed:", str(e)[:200])
        return False


def main():
    push_configured = PUSH_AVAILABLE and VAPID_PRIVATE_KEY and VAPID_CLAIM_EMAIL
    if not email_configured():
        print("Gmail SMTP not configured — email sending skipped.")
    if not push_configured:
        print("Push not configured (missing pywebpush or VAPID secrets) — push sending skipped.")
    if not APP_URL:
        print("Warning: APP_URL not set — links will be incomplete.")

    pending = api_get(
        f"/rest/v1/notifications?type=in.({NOTIFICATION_TYPES})"
        "&or=(emailed.eq.false,pushed.eq.false)"
        "&select=id,type,title,body,link_tab,target_profile_id,dm_with_profile_id,emailed,pushed"
    )
    if not pending:
        print("Nothing to send.")
        return

    profiles = api_get("/rest/v1/profiles?select=id,email,last_seen_at")
    email_by_id = {p["id"]: p.get("email") for p in profiles}
    last_seen_by_id = {p["id"]: p.get("last_seen_at") for p in profiles}
    all_emails = [e for e in email_by_id.values() if e]

    subs = api_get("/rest/v1/push_subscriptions?select=profile_id,endpoint,p256dh,auth") if push_configured else []
    subs_by_profile = {}
    for s in subs:
        subs_by_profile.setdefault(s["profile_id"], []).append(s)

    for n in pending:
        target = n.get("target_profile_id")
        is_team_broadcast = n["type"] == "chat" and not target
        is_suppressed_by_presence = (
            n["type"] in PRESENCE_TYPES and target and recently_active(last_seen_by_id.get(target))
        )
        skip_both = is_team_broadcast or is_suppressed_by_presence
        patch = {}

        if not n.get("emailed"):
            if skip_both or not email_configured():
                patch["emailed"] = True
                if is_team_broadcast:
                    pass  # by design, no log noise for every team message
            else:
                to = [email_by_id.get(target)] if target else all_emails
                to = [t for t in to if t]
                url = build_url(n.get("link_tab"), n.get("dm_with_profile_id"), HIGHLIGHT_BY_TYPE.get(n["type"]))
                html = f"<p>{n.get('body') or ''}</p>" + cta_button(url)
                sent = send_email(to, n["title"], html)
                patch["emailed"] = True
                print(("sent email" if sent else "skipped/failed email") + ":", n["title"], "->", len(to), "recipients")

        if not n.get("pushed"):
            if skip_both or not push_configured:
                patch["pushed"] = True
            else:
                url = build_url(n.get("link_tab"), n.get("dm_with_profile_id"), HIGHLIGHT_BY_TYPE.get(n["type"]))
                targets = subs_by_profile.get(target, []) if target else [s for lst in subs_by_profile.values() for s in lst]
                count = 0
                for sub in targets:
                    if send_push(sub, n["title"], n.get("body") or "", url):
                        count += 1
                patch["pushed"] = True
                if targets:
                    print(f"sent push: {n['title']} -> {count}/{len(targets)} devices")

        if is_suppressed_by_presence:
            print("skipped (recipient active on site):", n["title"])

        if patch:
            api_patch(f"/rest/v1/notifications?id=eq.{n['id']}", patch)

    print("Done.")


if __name__ == "__main__":
    main()
