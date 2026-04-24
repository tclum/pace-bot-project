import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ConnectionState, Track } from "livekit-client";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

type AvatarType = "pace_guide" | "entrepreneurship_mentor";

const VALID_AVATAR_TYPES: readonly AvatarType[] = [
  "pace_guide",
  "entrepreneurship_mentor",
];

const PERSONA_NAME: Record<AvatarType, string> = {
  pace_guide: "PACE Guide",
  entrepreneurship_mentor: "Entrepreneurship Mentor",
};

function isAvatarType(value: string | undefined): value is AvatarType {
  return (
    typeof value === "string" &&
    (VALID_AVATAR_TYPES as readonly string[]).includes(value)
  );
}

const LiveAvatar = () => {
  const { avatarType } = useParams<{ avatarType: string }>();
  const navigate = useNavigate();

  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isValid = isAvatarType(avatarType);

  useEffect(() => {
    if (!isValid) return;

    const sessionId = crypto.randomUUID();
    const apiBase = import.meta.env.VITE_API_BASE_URL;
    if (!apiBase) throw new Error("VITE_API_BASE_URL not set at build time");
    const controller = new AbortController();

    fetch(`${apiBase}/api/livekit-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarType, sessionId }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Token request failed: HTTP ${r.status}`);
        }
        return r.json() as Promise<{ token: string; serverUrl: string }>;
      })
      .then((data) => {
        setToken(data.token);
        setServerUrl(data.serverUrl);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => controller.abort();
  }, [avatarType, isValid]);

  if (!isValid) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-pace-navy-deep text-primary-foreground">
        <div className="text-center">
          <p className="text-lg">Unknown avatar type.</p>
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="mt-4"
          >
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-pace-navy-deep text-primary-foreground">
        <div className="text-center">
          <p className="text-lg">Couldn&apos;t start the conversation.</p>
          <p className="mt-2 text-sm text-white/60">{error}</p>
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="mt-6"
          >
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-pace-navy-deep text-primary-foreground">
        <div className="flex flex-col items-center gap-3 text-sm tracking-wide">
          <div className="h-10 w-10 animate-soft-pulse rounded-full bg-pace-green/30" />
          Connecting…
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect
      audio
      video={false}
      className="fixed inset-0 bg-pace-navy-deep"
    >
      <AvatarStage
        personaName={PERSONA_NAME[avatarType as AvatarType]}
        onEndCall={() => navigate("/")}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
};

interface AvatarStageProps {
  personaName: string;
  onEndCall: () => void;
}

const AvatarStage = ({ personaName, onEndCall }: AvatarStageProps) => {
  const state = useConnectionState();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const avatarTrack = tracks[0];

  const isConnecting =
    state === ConnectionState.Connecting ||
    state === ConnectionState.Reconnecting;

  return (
    <div className="relative h-full w-full">
      {avatarTrack ? (
        <VideoTrack
          trackRef={avatarTrack}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-primary-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-soft-pulse rounded-full bg-pace-green/30" />
            <p className="text-sm tracking-wide">
              {isConnecting
                ? `Connecting to ${personaName}…`
                : `Waiting for ${personaName}…`}
            </p>
          </div>
        </div>
      )}

      <div className="absolute left-4 top-4 rounded-full border border-white/20 bg-pace-navy-deep/70 px-4 py-1.5 text-sm font-semibold text-primary-foreground backdrop-blur">
        {personaName}
      </div>

      <div className="absolute right-4 top-4 rounded-full border border-white/20 bg-pace-navy-deep/70 px-3 py-1 text-xs uppercase tracking-wider text-primary-foreground backdrop-blur">
        {state}
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <Button
          variant="destructive"
          size="lg"
          onClick={onEndCall}
          className="rounded-full px-8 shadow-card"
        >
          End conversation
        </Button>
      </div>
    </div>
  );
};

export default LiveAvatar;
