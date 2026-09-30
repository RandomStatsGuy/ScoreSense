import asyncio

from app.hub_http_timing import HubServerTimingMiddleware


def test_timing_preserves_headers_body_and_existing_metrics():
    async def endpoint(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 200,
                    'headers': [(b'server-timing', b'db;dur=2'), (b'content-type', b'application/json')]})
        await send({'type': 'http.response.body', 'body': b'{"ok":true}'})

    async def run(path):
        messages = []
        async def send(message):
            messages.append(message)
        await HubServerTimingMiddleware(endpoint)({'type': 'http', 'path': path}, None, send)
        return messages

    timed = asyncio.run(run('/api/hub/week'))
    metrics = [value for name, value in timed[0]['headers'] if name == b'server-timing']
    assert metrics[0] == b'db;dur=2'
    assert metrics[1].startswith(b'hub;dur=')
    assert float(metrics[1].split(b'=')[1]) >= 0
    assert timed[1]['body'] == b'{"ok":true}'
    assert asyncio.run(run('/assets/current.js'))[0]['headers'] == timed[0]['headers'][:2]
