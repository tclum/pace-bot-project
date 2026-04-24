from dotenv import load_dotenv
load_dotenv(".env")
import os
from typing import Literal, get_args

AvatarType = Literal["pace_guide", "entrepreneurship_mentor"]

AVATAR_TYPES: tuple[AvatarType, ...] = get_args(AvatarType)

DEFAULT_AVATAR_TYPE: AvatarType = "pace_guide"

PERSONA_LIVEAVATAR_IDS: dict[AvatarType, str] = {
    "pace_guide": os.environ.get("PACE_GUIDE_LIVEAVATAR_ID", ""),
    "entrepreneurship_mentor": os.environ.get("MENTOR_LIVEAVATAR_ID", ""),
}

PERSONA_GREETINGS: dict[AvatarType, str] = {
    "pace_guide": (
        "Aloha, I'm here to help you learn about PACE. "
        "What would you like to know about our programs, events, or the people who run them?"
    ),
    "entrepreneurship_mentor": (
        "Welcome. I can walk you through the concepts and philosophies PACE teaches. "
        "What would you like to explore?"
    ),
}

DEGRADED_GREETING = (
    "Aloha — I can't reach the PACE knowledge base right now, "
    "so I'll only be able to hear you."
)

DEGRADED_TURN_REPLY = (
    "I'm still having trouble reaching the PACE knowledge base. "
    "Please try again in a moment."
)


def coerce_avatar_type(value: object) -> AvatarType:
    """Return value if it is a known AvatarType, else the default."""
    if isinstance(value, str) and value in AVATAR_TYPES:
        return value  # type: ignore[return-value]
    return DEFAULT_AVATAR_TYPE
