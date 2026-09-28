"""把本機資料寫入事件推送給 SSE 用戶端與獨立的唯讀鏡像。"""

import asyncio
import socket


MIRROR_SIGNAL_PORT = 5059
SIGNAL = b"data-changed"


class _MirrorSignal(asyncio.DatagramProtocol):
    def __init__(self, hub):
        self.hub = hub

    def datagram_received(self, data, address):
        if address[0] == "127.0.0.1" and data == SIGNAL:
            self.hub._notify(relay=False)


class ChangeEvents:
    def __init__(self):
        self.loop = None
        self.subscribers = set()
        self.transport = None

    async def start(self, mirror=False):
        self.loop = asyncio.get_running_loop()
        if mirror:
            self.transport, _ = await self.loop.create_datagram_endpoint(
                lambda: _MirrorSignal(self), local_addr=("127.0.0.1", MIRROR_SIGNAL_PORT)
            )

    def stop(self):
        if self.transport:
            self.transport.close()
            self.transport = None
        self.loop = None
        self.subscribers.clear()

    def publish(self):
        """可從採集工作執行緒或 FastAPI 的同步端點呼叫。"""
        if self.loop:
            self.loop.call_soon_threadsafe(self._notify, True)

    def _notify(self, relay):
        for queue in tuple(self.subscribers):
            if not queue.full():
                queue.put_nowait(None)
        if relay:
            # 鏡像是另一個行程；loopback UDP 只傳固定通知，不傳任何玩家資料。
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                    sock.sendto(SIGNAL, ("127.0.0.1", MIRROR_SIGNAL_PORT))
            except OSError:
                # 鏡像沒有啟動時，本機畫面的通知仍照常送出。
                pass

    async def stream(self):
        queue = asyncio.Queue(maxsize=1)
        self.subscribers.add(queue)
        try:
            yield ": connected\n\n"
            while True:
                try:
                    await asyncio.wait_for(queue.get(), timeout=30)
                    yield "event: data-changed\ndata: {}\n\n"
                except asyncio.TimeoutError:
                    # 只在有瀏覽器連線時送心跳，保持代理後面的 SSE 連線。
                    yield ": keepalive\n\n"
        finally:
            self.subscribers.discard(queue)
