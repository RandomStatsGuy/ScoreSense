"""Request-local restrictions for anonymous projection reads.

Context is copied into FastAPI's sync workers. Jobs and authenticated requests
retain their normal behavior; public reads can consume existing artifacts and
provider caches without causing provider refreshes or paid text generation.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from collections.abc import Iterator


_ANONYMOUS_PROJECTION_READ = ContextVar("anonymous_projection_read", default=False)


def anonymous_projection_read() -> bool:
    return _ANONYMOUS_PROJECTION_READ.get()


@contextmanager
def projection_read_scope(*, anonymous: bool) -> Iterator[None]:
    token = _ANONYMOUS_PROJECTION_READ.set(anonymous)
    try:
        yield
    finally:
        _ANONYMOUS_PROJECTION_READ.reset(token)


def initialize_projection_worker() -> None:
    """Clear request context inherited by forked process-pool workers."""
    _ANONYMOUS_PROJECTION_READ.set(False)


def run_anonymous_projection_work(callback, *args):
    """Picklable process-worker entry point; local inference remains enabled."""
    with projection_read_scope(anonymous=True):
        return callback(*args)
