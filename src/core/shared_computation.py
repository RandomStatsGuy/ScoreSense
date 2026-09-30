"""Share active synchronous read computations without keeping result history."""
from concurrent.futures import Future
from threading import Lock
from typing import Callable, Hashable, TypeVar

T = TypeVar("T")


class SharedComputation:
    """One producer per key in this process; unrelated keys remain independent.

    Callers must isolate mutable results and include source revision/authority in
    their key. Failures reach all waiting callers and never prevent a later retry.
    Producers must not recursively request the same key.
    """

    def __init__(self):
        self._lock = Lock()
        self._pending: dict[Hashable, Future] = {}

    def run(self, key: Hashable, produce: Callable[[], T]) -> T:
        with self._lock:
            future = self._pending.get(key)
            owner = future is None
            if owner:
                future = Future()
                self._pending[key] = future
        if not owner:
            return future.result()
        try:
            result = produce()
            future.set_result(result)
            return result
        except BaseException as exc:
            future.set_exception(exc)
            raise
        finally:
            with self._lock:
                if self._pending.get(key) is future:
                    del self._pending[key]
