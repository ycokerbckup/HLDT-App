"""
Shared email-sending helper. Sends via Gmail's SMTP relay using the same
Google Account + App Password already configured for Supabase Auth emails
— one consistent, real sending identity, instead of a shared/generic
testing address that has nothing to do with this app's reputation.

Recipients go in the SMTP envelope (BCC-style), not the visible "To:"
header, so a broadcast email doesn't expose everyone's address to
everyone else.
"""
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

GMAIL_ADDRESS = os.environ.get("GMAIL_ADDRESS")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD")
FROM_NAME = os.environ.get("FROM_NAME", "Display Team Ops")


def email_configured():
    return bool(GMAIL_ADDRESS and GMAIL_APP_PASSWORD)


def send_email(to_list, subject, html):
    if not to_list:
        return False
    if not email_configured():
        print("GMAIL_ADDRESS / GMAIL_APP_PASSWORD not set — skipping send.")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{FROM_NAME} <{GMAIL_ADDRESS}>"
    msg["To"] = GMAIL_ADDRESS  # visible header stays generic; real recipients go via envelope below
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as server:
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, to_list, msg.as_string())
        return True
    except Exception as e:
        print("send failed:", e)
        return False
