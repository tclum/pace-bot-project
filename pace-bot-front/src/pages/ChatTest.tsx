import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PasswordGate,
  clearStoredPassword,
  usePassword,
} from "@/components/PasswordGate";

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

type Mode = "guarded" | "unguarded" | "raw";

type WithToolsState = {
  reply: string;
  tools: string[];
  loading: boolean;
  error?: string;
};

type RawState = {
  reply: string;
  loading: boolean;
  error?: string;
};

type TripleResponses = {
  guarded: WithToolsState;
  unguarded: WithToolsState;
  raw: RawState;
};

type ChatEntry =
  | { role: "user"; content: string }
  | {
      role: "assistant-triple";
      userMessage: string;
      responses: TripleResponses;
    };

type ChatApiResponse = {
  reply: string;
  toolsUsed?: string[];
  mode?: Mode;
};

const MODES: readonly Mode[] = ["guarded", "unguarded", "raw"];

const AUTH_ERROR = "AUTH";

function ChatContent({ avatarType }: { avatarType: AvatarType }) {
  const navigate = useNavigate();
  const password = usePassword();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const apiBase = import.meta.env.VITE_API_BASE_URL;
    if (!apiBase) {
      setError("VITE_API_BASE_URL not set at build time");
      return;
    }

    // Push user message + empty triple in one update. Because `loading`
    // gates concurrent sends, the triple's final position is deterministic:
    // it's the last entry (messages.length + 1 at time of push).
    const tripleIndex = messages.length + 1;

    setMessages((m) => [
      ...m,
      { role: "user", content: trimmed },
      {
        role: "assistant-triple",
        userMessage: trimmed,
        responses: {
          guarded: { reply: "", tools: [], loading: true },
          unguarded: { reply: "", tools: [], loading: true },
          raw: { reply: "", loading: true },
        },
      },
    ]);
    setInput("");
    setLoading(true);
    setError(null);

    const requests = MODES.map((mode) =>
      fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Password": password,
        },
        body: JSON.stringify({ sessionId, avatarType, message: trimmed, mode }),
      })
        .then(async (res) => {
          if (res.status === 401) throw new Error(AUTH_ERROR);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as ChatApiResponse;
        })
        .then((data) => {
          setMessages((m) => updateTriple(m, tripleIndex, mode, {
            reply: data.reply,
            tools: data.toolsUsed ?? [],
            loading: false,
          }));
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          setMessages((m) => updateTriple(m, tripleIndex, mode, {
            reply: "",
            tools: [],
            loading: false,
            error: msg,
          }));
          if (msg === AUTH_ERROR) {
            clearStoredPassword();
            setError("Password was rejected. Refresh to re-enter.");
          }
        }),
    );

    try {
      await Promise.allSettled(requests);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border p-4">
        <div className="max-w-6xl w-full mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/")}
            >
              ← Home
            </Button>
            <div>
              <h1 className="text-lg font-bold text-pace-navy">
                {PERSONA_NAME[avatarType]}
              </h1>
              <p className="text-xs text-muted-foreground">
                Text-only test mode · three-column comparison
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Session: {sessionId.slice(0, 8)}
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl w-full mx-auto space-y-4">
          {messages.length === 0 && (
            <p className="text-muted-foreground text-center pt-8">
              Ask {PERSONA_NAME[avatarType]} anything — you&apos;ll see three
              responses side-by-side.
            </p>
          )}
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg px-4 py-2 bg-pace-green text-primary-foreground">
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <TripleRow
                key={i}
                responses={msg.responses}
                personaName={PERSONA_NAME[avatarType]}
              />
            );
          })}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border-t border-destructive/40 p-2 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="border-t border-border p-4">
        <div className="max-w-6xl w-full mx-auto flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={`Ask ${PERSONA_NAME[avatarType]}…`}
            disabled={loading}
            autoFocus
          />
          <Button onClick={sendMessage} disabled={loading || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function updateTriple(
  list: ChatEntry[],
  index: number,
  mode: Mode,
  next: Partial<WithToolsState> & { loading: boolean; error?: string; reply?: string; tools?: string[] },
): ChatEntry[] {
  const entry = list[index];
  if (!entry || entry.role !== "assistant-triple") return list;
  const copy = list.slice();
  const responses = { ...entry.responses };
  if (mode === "raw") {
    responses.raw = {
      reply: next.reply ?? "",
      loading: next.loading,
      error: next.error,
    };
  } else {
    responses[mode] = {
      reply: next.reply ?? "",
      tools: next.tools ?? [],
      loading: next.loading,
      error: next.error,
    };
  }
  copy[index] = { ...entry, responses };
  return copy;
}

type Accent = "green" | "gold" | "navy";

const ACCENT_BORDER: Record<Accent, string> = {
  green: "border-pace-green/40",
  gold: "border-pace-gold/40",
  navy: "border-pace-navy/40",
};

const ACCENT_LABEL: Record<Accent, string> = {
  green: "text-pace-green",
  gold: "text-pace-gold",
  navy: "text-pace-navy",
};

function TripleRow({
  responses,
  personaName,
}: {
  responses: TripleResponses;
  personaName: string;
}) {
  return (
    <div className="my-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ResponseColumn
          title="Current product default"
          subtitle={`${personaName}, grounded — refuses when data is missing`}
          response={responses.guarded}
          accent="green"
        />
        <ResponseColumn
          title="Guardrails off"
          subtitle={`${personaName}, same tools — allowed to improvise`}
          response={responses.unguarded}
          accent="gold"
        />
        <ResponseColumn
          title="Pure Claude"
          subtitle="No system prompt, no PACE context"
          response={responses.raw}
          accent="navy"
        />
      </div>
    </div>
  );
}

function ResponseColumn({
  title,
  subtitle,
  response,
  accent,
}: {
  title: string;
  subtitle: string;
  response: WithToolsState | RawState;
  accent: Accent;
}) {
  const tools =
    "tools" in response && response.tools.length > 0 ? response.tools : null;

  return (
    <div
      className={`border rounded-lg bg-card p-4 shadow-sm flex flex-col ${ACCENT_BORDER[accent]}`}
    >
      <div
        className={`text-xs font-semibold uppercase tracking-wider ${ACCENT_LABEL[accent]}`}
      >
        {title}
      </div>
      <div className="text-xs text-muted-foreground mt-1 mb-3">{subtitle}</div>

      {response.loading ? (
        <div className="text-sm text-muted-foreground">Thinking…</div>
      ) : response.error ? (
        <div className="text-sm text-destructive">Error: {response.error}</div>
      ) : response.reply ? (
        <>
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-card-foreground">
            {response.reply}
          </div>
          {tools && (
            <div className="text-xs mt-3 text-muted-foreground">
              Tools: {tools.join(", ")}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-muted-foreground italic">No response.</div>
      )}
    </div>
  );
}

const ChatTest = () => {
  const { avatarType } = useParams<{ avatarType: string }>();
  const navigate = useNavigate();

  if (!isAvatarType(avatarType)) {
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

  return (
    <PasswordGate>
      <ChatContent avatarType={avatarType} />
    </PasswordGate>
  );
};

export default ChatTest;
