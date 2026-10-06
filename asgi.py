"""ASGI entrypoint for hosting platforms: ``asgi:app``.

Vercel picks this file up by its name. Set LOCKBOX_PLAYGROUND=1 there (serverless
hosts have no disk for the kiosk's progress file) and a LOCKBOX_ACCESS_CODE.
Locally: ``uvicorn asgi:app``.
"""

from lockbox.web import default_app

app = default_app()
