from __future__ import annotations

import smtplib
from email.message import EmailMessage

from .config import settings


def send_password_reset(email: str, reset_url: str) -> bool:
    """Send a reset email. Returns False when SMTP is not configured.

    Development can intentionally run without SMTP; callers may surface a
    debug URL only outside production.
    """
    if not settings.smtp_host:
        return False

    message = EmailMessage()
    message["Subject"] = "Reset your UVMS AI password"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(
        "A password reset was requested for your UVMS AI account.\n\n"
        f"Open this link to set a new password:\n{reset_url}\n\n"
        f"This link expires in {settings.password_reset_minutes} minutes.\n"
        "If you did not request this, you can ignore this email."
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as client:
        if settings.smtp_starttls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)
    return True
