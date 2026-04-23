from typing import TypedDict

import httpx

from personas import AvatarType


class ChatResponse(TypedDict):
    reply: str
    toolsUsed: list[str]


class BackendClient:
    def __init__(self, base_url: str, timeout: float) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout)

    @property
    def base_url(self) -> str:
        return self._base

    async def healthz(self) -> bool:
        try:
            resp = await self._client.get(f"{self._base}/healthz", timeout=5.0)
            resp.raise_for_status()
            return True
        except httpx.HTTPError:
            return False

    async def chat(
        self, session_id: str, avatar_type: AvatarType, message: str
    ) -> ChatResponse:
        resp = await self._client.post(
            f"{self._base}/api/chat",
            json={
                "sessionId": session_id,
                "avatarType": avatar_type,
                "message": message,
            },
        )
        resp.raise_for_status()
        return resp.json()

    async def aclose(self) -> None:
        await self._client.aclose()
