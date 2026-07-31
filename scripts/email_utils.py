"""
Shared email-sending helper. Sends via Gmail's SMTP relay using the same
Google Account + App Password already configured for Supabase Auth emails
— one consistent, real sending identity, instead of a shared/generic
testing address that has nothing to do with this app's reputation.

Sends one individual copy per recipient (each with their own address in
the "To:" header) rather than one bulk BCC message. A BCC blast with the
sender's own address in "To" is a known spam signal — an individually
addressed copy looks like ordinary person-to-person mail instead.

Every email carries the same fixed In-Reply-To / References header, so
Gmail (and other threading-aware clients) group all of them into one
ongoing conversation per recipient instead of flooding the inbox with
separate top-level messages.
"""
import html as html_module
import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD")
FROM_NAME = os.environ.get("FROM_NAME", "Display Team Ops")
THREAD_ROOT_ID = f"<hldt-notifications-root@{(GMAIL_ADDRESS or 'display-team-ops').split('@')[-1] if GMAIL_ADDRESS else 'display-team-ops'}>"


def email_configured():
    return bool(GMAIL_ADDRESS and GMAIL_APP_PASSWORD)


def _plain_text(html_body):
    text = re.sub(r"<[^>]+>", "", html_body)
    return html_module.unescape(text).strip()


def send_email(to_list, subject, html):
    if not to_list:
        return False
    if not email_configured():
        print("GMAIL_ADDRESS / GMAIL_APP_PASSWORD not set — skipping send.")
        return False

    ok = True
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as server:
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            for recipient in to_list:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = f"{FROM_NAME} <{GMAIL_ADDRESS}>"
                msg["To"] = recipient
                msg["In-Reply-To"] = THREAD_ROOT_ID
                msg["References"] = THREAD_ROOT_ID
                msg.attach(MIMEText(_plain_text(html), "plain"))
                msg.attach(MIMEText(html, "html"))
                try:
                    server.sendmail(GMAIL_ADDRESS, [recipient], msg.as_string())
                except Exception as e:
                    print(f"send to {recipient} failed:", e)
                    ok = False
        return ok
    except Exception as e:
        print("SMTP connection failed:", e)
        return False
