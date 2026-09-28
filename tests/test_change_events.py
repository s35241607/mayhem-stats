import asyncio
import socket
import unittest

import change_events


class ChangeEventsTests(unittest.IsolatedAsyncioTestCase):
    async def test_publish_wakes_subscriber(self):
        hub = change_events.ChangeEvents()
        await hub.start()
        stream = hub.stream()
        try:
            self.assertEqual(await anext(stream), ": connected\n\n")
            hub.publish()
            self.assertIn("event: data-changed", await asyncio.wait_for(anext(stream), 1))
        finally:
            await stream.aclose()
            hub.stop()

    async def test_local_publish_reaches_mirror(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        old_port = change_events.MIRROR_SIGNAL_PORT
        change_events.MIRROR_SIGNAL_PORT = port
        local = change_events.ChangeEvents()
        mirror = change_events.ChangeEvents()
        stream = None
        try:
            await mirror.start(mirror=True)
            await local.start()
            stream = mirror.stream()
            await anext(stream)
            local.publish()
            self.assertIn("event: data-changed", await asyncio.wait_for(anext(stream), 1))
        finally:
            if stream:
                await stream.aclose()
            local.stop()
            mirror.stop()
            change_events.MIRROR_SIGNAL_PORT = old_port


if __name__ == "__main__":
    unittest.main()
