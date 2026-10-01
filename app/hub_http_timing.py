"""Coarse request-to-response-headers timing, independent of debug logging."""
from time import perf_counter


class HubServerTimingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope.get('path', '').startswith('/api/hub/'):
            return await self.app(scope, receive, send)
        started = perf_counter()

        async def timed_send(message):
            if message['type'] == 'http.response.start':
                headers = list(message.get('headers', []))
                headers.append((b'server-timing', f'hub;dur={(perf_counter()-started)*1000:.1f}'.encode()))
                message = {**message, 'headers': headers}
            await send(message)

        await self.app(scope, receive, timed_send)
