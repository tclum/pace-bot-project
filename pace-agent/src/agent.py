import asyncio
import json
import logging
import os
import uuid

import httpx
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    StopResponse,
    cli,
    llm,
    room_io,
)
from livekit.plugins import deepgram, noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from backend import BackendClient
from personas import (
    AVATAR_TYPES,
    DEFAULT_AVATAR_TYPE,
    DEGRADED_GREETING,
    DEGRADED_TURN_REPLY,
    PERSONA_GREETINGS,
    AvatarType,
)

load_dotenv(".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("pace-agent")

METADATA_WAIT_SECONDS = 5.0

BACKEND_TIMEOUT_REPLY = "I'm taking a moment to think. Could you repeat that?"
BACKEND_ERROR_REPLY = (
    "Sorry, I'm having trouble reaching my knowledge right now. "
    "Please try again in a moment."
)


def _parse_avatar_metadata(metadata: object, identity: str) -> AvatarType | None:
    if not isinstance(metadata, str) or not metadata:
        return None
    try:
        data = json.loads(metadata)
    except json.JSONDecodeError:
        logger.warning(
            "participant %s metadata is not valid JSON: %r", identity, metadata
        )
        return None
    raw = data.get("avatarType") if isinstance(data, dict) else None
    if isinstance(raw, str) and raw in AVATAR_TYPES:
        return raw  # type: ignore[return-value]
    logger.warning(
        "participant %s metadata avatarType=%r not recognized", identity, raw
    )
    return None


async def _resolve_avatar_type(ctx: JobContext) -> AvatarType:
    for p in ctx.room.remote_participants.values():
        resolved = _parse_avatar_metadata(p.metadata, p.identity)
        if resolved is not None:
            return resolved

    try:
        participant = await asyncio.wait_for(
            ctx.wait_for_participant(), timeout=METADATA_WAIT_SECONDS
        )
    except asyncio.TimeoutError:
        logger.warning(
            "no remote participant within %ss; defaulting to %s",
            METADATA_WAIT_SECONDS,
            DEFAULT_AVATAR_TYPE,
        )
        return DEFAULT_AVATAR_TYPE

    resolved = _parse_avatar_metadata(participant.metadata, participant.identity)
    if resolved is None:
        return DEFAULT_AVATAR_TYPE
    return resolved


class PaceAgent(Agent):
    def __init__(
        self,
        *,
        session_id: str,
        avatar_type: AvatarType,
        backend: BackendClient,
        degraded: bool,
    ) -> None:
        super().__init__(
            instructions=(
                "PACE voice agent. Replies come from the pace-bot backend; "
                "this agent is a conduit only."
            ),
        )
        self._session_id = session_id
        self._avatar_type = avatar_type
        self._backend = backend
        self._degraded = degraded

    async def on_enter(self) -> None:
        if self._degraded:
            logger.info("on_enter: degraded greeting")
            await self.session.say(DEGRADED_GREETING, add_to_chat_ctx=False)
            return
        greeting = PERSONA_GREETINGS[self._avatar_type]
        logger.info("on_enter: greeting for %s", self._avatar_type)
        await self.session.say(greeting, add_to_chat_ctx=False)

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        text = (new_message.text_content or "").strip()
        if not text:
            logger.info("user turn: empty; skipping")
            raise StopResponse()
        logger.info("user turn: %r", text)

        if self._degraded:
            if await self._backend.healthz():
                logger.info("backend healthy again; exiting degraded mode")
                self._degraded = False
            else:
                await self.session.say(DEGRADED_TURN_REPLY, add_to_chat_ctx=False)
                raise StopResponse()

        try:
            result = await self._backend.chat(
                session_id=self._session_id,
                avatar_type=self._avatar_type,
                message=text,
            )
        except httpx.TimeoutException:
            logger.warning("backend timeout")
            await self.session.say(BACKEND_TIMEOUT_REPLY, add_to_chat_ctx=False)
            raise StopResponse() from None
        except httpx.HTTPError as e:
            logger.error("backend HTTP error: %s", e)
            await self.session.say(BACKEND_ERROR_REPLY, add_to_chat_ctx=False)
            raise StopResponse() from None

        reply = result.get("reply", "")
        tools = result.get("toolsUsed", [])
        logger.info("backend reply: tools=%s reply=%r", tools, reply)
        if reply:
            await self.session.say(reply, add_to_chat_ctx=False)
        raise StopResponse()


server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def pace_agent_session(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    await ctx.connect()

    avatar_type = await _resolve_avatar_type(ctx)

    session_id = str(uuid.uuid4())

    pace_bot_url = os.environ.get("PACE_BOT_URL", "http://localhost:3000")
    timeout_seconds = float(os.environ.get("PACE_BOT_TIMEOUT_SECONDS", "20"))
    backend = BackendClient(base_url=pace_bot_url, timeout=timeout_seconds)

    async def _shutdown_backend() -> None:
        logger.info("shutdown: closing backend client")
        await backend.aclose()

    ctx.add_shutdown_callback(_shutdown_backend)

    healthy = await backend.healthz()
    degraded = not healthy
    if degraded:
        logger.warning(
            "backend health probe failed at %s; entering degraded mode",
            pace_bot_url,
        )
    else:
        logger.info("backend healthy at %s", pace_bot_url)

    logger.info(
        "session config: avatar_type=%s session_id=%s degraded=%s backend=%s",
        avatar_type,
        session_id,
        degraded,
        pace_bot_url,
    )

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="en-US", interim_results=True),
        tts=deepgram.TTS(model="aura-2-andromeda-en"),
        vad=ctx.proc.userdata["vad"],
        turn_detection=MultilingualModel(),
    )

    @session.on("user_input_transcribed")
    def _on_transcript(event) -> None:
        flag = "final" if event.is_final else "interim"
        logger.info("stt[%s]: %s", flag, event.transcript)

    @session.on("conversation_item_added")
    def _on_item(event) -> None:
        item = event.item
        logger.info(
            "conv item: role=%s text=%r",
            getattr(item, "role", "?"),
            getattr(item, "text_content", None),
        )

    @session.on("error")
    def _on_error(event) -> None:
        logger.error("session error: %s", event)

    @session.on("close")
    def _on_close(event) -> None:
        logger.info("session closed: reason=%s", getattr(event, "reason", "?"))

    @ctx.room.on("participant_connected")
    def _on_participant_connected(participant) -> None:
        logger.info(
            "participant connected: identity=%s count=%d",
            participant.identity,
            len(ctx.room.remote_participants),
        )

    @ctx.room.on("participant_disconnected")
    def _on_participant_disconnected(participant) -> None:
        logger.info("participant disconnected: identity=%s", participant.identity)

    @ctx.room.on("disconnected")
    def _on_disconnected(*_args, **_kwargs) -> None:
        logger.info("room disconnected")

    agent = PaceAgent(
        session_id=session_id,
        avatar_type=avatar_type,
        backend=backend,
        degraded=degraded,
    )

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=noise_cancellation.BVC(),
            ),
        ),
    )

    logger.info(
        "session started: room=%s remote_participants=%d",
        ctx.room.name,
        len(ctx.room.remote_participants),
    )


if __name__ == "__main__":
    cli.run_app(server)
