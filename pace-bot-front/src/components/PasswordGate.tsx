import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STORAGE_KEY = "pace_app_password";

const PasswordContext = createContext<string | null>(null);

export function usePassword(): string {
  const password = useContext(PasswordContext);
  if (!password) {
    throw new Error("usePassword must be used inside <PasswordGate>");
  }
  return password;
}

export function clearStoredPassword(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function PasswordGate({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) setPassword(stored);
    setHydrated(true);
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError("Enter a password");
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, trimmed);
    setPassword(trimmed);
    setError(null);
  };

  if (!hydrated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-pace-navy-deep text-primary-foreground">
        <div className="flex flex-col items-center gap-3 text-sm tracking-wide">
          <div className="h-10 w-10 animate-soft-pulse rounded-full bg-pace-green/30" />
        </div>
      </div>
    );
  }

  if (!password) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pace-navy-deep px-6 py-12">
        <Card className="w-full max-w-md shadow-card">
          <CardHeader>
            <CardTitle>Enter password</CardTitle>
            <CardDescription>
              This demo requires a shared password. If you don&apos;t have one, ask PACE.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pace-password">Password</Label>
              <Input
                id="pace-password"
                type="password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Password"
                autoFocus
              />
              {error && (
                <p className="text-destructive text-sm">{error}</p>
              )}
            </div>
            <Button onClick={handleSubmit} className="w-full">
              Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PasswordContext.Provider value={password}>
      {children}
    </PasswordContext.Provider>
  );
}
