"""
Shared email-sending helper. Sends via Gmail's SMTP relay using the same
Google Account + App Password already configured for Supabase Auth emails
— one consistent, real sending identity, instead of a shared/generic
testing address that has nothing to do with this app's reputation.

Sends one individual copy per recipient (each with their own address in
the "To:" header) rather than one bulk BCC message. A BCC blast with the
sender's own address in "To" is a known spam signal — an individually
addressed copy looks like ordinary person-to-person mail instead.
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

    ok = True
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as server:
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            for recipient in to_list:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = f"{FROM_NAME} <{GMAIL_ADDRESS}>"
                msg["To"] = recipient
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
