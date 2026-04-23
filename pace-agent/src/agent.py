import logging

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

load_dotenv(".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("pace-agent")

GREETING = "Hi, I'm in echo mode. Say something and I'll repeat it back."


class EchoAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions="Echo mode. Repeat the user verbatim.")

    async def on_enter(self) -> None:
        logger.info("agent on_enter -> greeting")
        await self.session.say(GREETING)

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        text = (new_message.text_content or "").strip()
        logger.info("user turn completed: %r", text)
        if text:
            logger.info("say: %r", text)
            await self.session.say(text, add_to_chat_ctx=False)
        raise StopResponse()


server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def pace_agent_session(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

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
            len(ctx.room.remote_participants) + 1,
        )

    @ctx.room.on("participant_disconnected")
    def _on_participant_disconnected(participant) -> None:
        logger.info("participant disconnected: identity=%s", participant.identity)

    @ctx.room.on("disconnected")
    def _on_disconnected(*_args, **_kwargs) -> None:
        logger.info("room disconnected")

    await session.start(
        agent=EchoAgent(),
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

    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
