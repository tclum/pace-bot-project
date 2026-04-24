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

type Message = {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
};

function ChatContent({ avatarType }: { avatarType: AvatarType }) {
  const navigate = useNavigate();
  const password = usePassword();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
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

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Password": password,
        },
        body: JSON.stringify({ sessionId, avatarType, message: trimmed }),
      });

      if (res.status === 401) {
        clearStoredPassword();
        setError("Password was rejected. Refresh to re-enter.");
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        reply: string;
        toolsUsed: string[];
      };
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply,
          tools: data.toolsUsed,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border p-4">
        <div className="max-w-3xl w-full mx-auto flex items-center justify-between gap-3">
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
                Text-only test mode
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Session: {sessionId.slice(0, 8)}
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
      >
        <div className="max-w-3xl w-full mx-auto space-y-4">
          {messages.length === 0 && (
            <p className="text-muted-foreground text-center pt-8">
              Ask {PERSONA_NAME[avatarType]} anything.
            </p>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-pace-green text-primary-foreground"
                    : "bg-card border border-border text-card-foreground"
                }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </div>
                {msg.tools && msg.tools.length > 0 && (
                  <div className="text-xs mt-2 opacity-70">
                    Tools: {msg.tools.join(", ")}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-card border border-border rounded-lg px-4 py-2 text-sm text-muted-foreground">
                Thinking…
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border-t border-destructive/40 p-2 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="border-t border-border p-4">
        <div className="max-w-3xl w-full mx-auto flex gap-2">
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
