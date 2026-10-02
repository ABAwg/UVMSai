from __future__ import annotations

import argparse
import getpass
import os

from sqlalchemy import select

if os.getenv('UVMS_ENV', '').lower() == 'production' and os.getenv('POSTGRES_HOST'):
    from .prod_start import configure_database_url
    configure_database_url()

from .database import SessionLocal
from .models import User
from .security import hash_password
from .seed import seed_models, seed_plans


def create_admin(email: str, display_name: str, password: str) -> None:
    email = email.strip().lower()
    if not email or "@" not in email:
        raise SystemExit("A valid email is required")
    if len(password) < 8:
        raise SystemExit("Password must contain at least 8 characters")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user:
            user.role = "admin"
            user.is_active = True
            user.display_name = display_name or user.display_name
            if password:
                user.password_hash = hash_password(password)
        else:
            user = User(
                email=email,
                display_name=display_name or "UVMS Admin",
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
            )
            db.add(user)
        db.commit()
        print(f"Admin ready: {email}")


def seed_reference_data() -> None:
    """Idempotently seed plans and model aliases once before worker startup."""
    with SessionLocal() as db:
        seed_plans(db)
        seed_models(db)
    print("Reference data ready")


def create_demo(email: str, display_name: str, password: str) -> None:
    """Optional synthetic presentation data, with no fake generated AI answer."""
    from .models import Chat, Message, MemoryItem, Project, ProjectChat, Subscription
    if '@' not in email or len(password) < 12: raise SystemExit('A valid email and 12+ character password are required')
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email.strip().lower())):
            raise SystemExit('Account already exists; no password or data was changed')
        user = User(email=email.strip().lower(), display_name=display_name, password_hash=hash_password(password), role='user', is_active=True)
        db.add(user); db.flush()
        db.add(Subscription(user_id=user.id, plan_code='free', status='active'))
        project = Project(user_id=user.id, name='Workshop launch', description='Synthetic demonstration project. No real business data.',
                          instructions='Use concise action lists. The fictional workshop has a preparation budget of 300 units and opens on Saturday.')
        db.add(project); db.flush()
        chat = Chat(user_id=user.id, title='Plan the workshop', model_id='uvms-1-fast')
        db.add(chat); db.flush(); db.add(ProjectChat(project_id=project.id, chat_id=chat.id))
        db.add(Message(chat_id=chat.id, role='user', content='Example prompt: Help me prepare a checklist for our fictional workshop.'))
        db.add(MemoryItem(user_id=user.id, content='For this demonstration, I prefer short answers and metric units.', is_enabled=True))
        db.commit()
    print('Synthetic demo account created. Sign in with the separately stored credentials; AI answers are generated live.')


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin", help="Create or promote a UVMS AI administrator")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", default="UVMS Admin")
    admin.add_argument("--password", default="")
    sub.add_parser("seed", help="Seed plans and AI model aliases idempotently")
    demo = sub.add_parser('create-demo', help='Create an ordinary user with synthetic presentation data')
    demo.add_argument('--email', required=True)
    demo.add_argument('--name', default='Workshop Demo')
    args = parser.parse_args()

    if args.command == "create-admin":
        password = args.password or getpass.getpass("Admin password: ")
        create_admin(args.email, args.name, password)
    elif args.command == "seed":
        seed_reference_data()
    elif args.command == 'create-demo':
        password = os.environ.pop('UVMS_DEMO_PASSWORD', '') or getpass.getpass('Demo password (12+ characters): ')
        create_demo(args.email, args.name, password)


if __name__ == "__main__":
    main()
