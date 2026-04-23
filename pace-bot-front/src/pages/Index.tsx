import { useState } from "react";
import AvatarModal from "@/components/AvatarModal";

/* ------------------------------------------------------------------
 *  SWAP POINTS
 *  (1) PACE_LOGO_URL          → replace with the official PACE logo
 *  (2) HEYGEN_EMBED_LINK_1    → Kai (PACE Guide) HeyGen iframe URL
 *  (3) HEYGEN_EMBED_LINK_2    → Business Coach HeyGen iframe URL
 * ------------------------------------------------------------------ */
const PACE_LOGO_URL =
  "https://media.licdn.com/dms/image/v2/C560BAQG15sCUCxF5Bw/company-logo_200_200/company-logo_200_200/0/1636086130261/pacehawaii_logo?e=2147483647&v=beta&t=3E7FB3DEh9VmVFYEMM5-Gqb-7tz3goQ5_zewVCtG07Y"; // (1) Footer PACE logo
const PACE_HERO_LOGO_URL =
  "https://media.bizj.us/view/img/12592390/2021pacelogocoloralternate.png"; // (1b) Hero PACE color logo
// (2) Kai — PACE Guide (LiveAvatar embed)
const KAI_EMBED_LINK = "https://embed.liveavatar.com/v1/c9b435e2-1bc6-46de-9dcb-104a6fc84248?orientation=horizontal";
// (3) Business Coach — replace with LiveAvatar embed URL when ready
const COACH_EMBED_LINK = "YOUR_LIVEAVATAR_EMBED_LINK_2";

const WaveDivider = ({ flip = false, fill = "hsl(var(--background))" }: { flip?: boolean; fill?: string }) => (
  <div className={`w-full leading-[0] ${flip ? "rotate-180" : ""}`} aria-hidden="true">
    <svg viewBox="0 0 1440 90" preserveAspectRatio="none" className="w-full h-[60px] md:h-[90px] block">
      <path
        d="M0,40 C240,90 480,0 720,40 C960,80 1200,20 1440,50 L1440,90 L0,90 Z"
        fill={fill}
      />
    </svg>
  </div>
);

const ChatBubbleIcon = () => (
  <svg viewBox="0 0 64 64" className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 14h40a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H28l-10 8v-8h-6a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" />
    <circle cx="24" cy="30" r="2.5" fill="currentColor" />
    <circle cx="34" cy="30" r="2.5" fill="currentColor" />
    <circle cx="44" cy="30" r="2.5" fill="currentColor" />
  </svg>
);

const BriefcaseIcon = () => (
  <svg viewBox="0 0 64 64" className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="20" width="48" height="32" rx="4" />
    <path d="M24 20v-6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6" />
    <path d="M8 34h48" />
    <rect x="28" y="32" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

const CampusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </svg>
);
const RocketIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);
const HandshakeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 17l2 2a1 1 0 1 0 3-3" />
    <path d="M14 14l2.5 2.5a1 1 0 1 0 3-3L15 9h-2l-3 3" />
    <path d="M11 17l-2.5 2.5a1 1 0 1 1-3-3L7 15" />
    <path d="M14 5l-3 3-3-3-5 5 4 4 8-8" />
  </svg>
);

const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);
const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.42a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.42 8.6.42 8.6.42s6.88 0 8.6-.42a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.35z" />
    <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" />
  </svg>
);

const Index = () => {
  const [openModal, setOpenModal] = useState<null | "kai" | "coach">(null);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* =========================================================
           HERO
         ========================================================= */}
      <header className="relative isolate overflow-hidden bg-hero-gradient text-primary-foreground">
        <div className="absolute inset-0 hero-pattern opacity-90" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-pace-navy-deep/60" aria-hidden="true" />

        <main className="relative container mx-auto px-6 pt-20 pb-32 md:pt-28 md:pb-40 flex flex-col items-center text-center">
          {/* (1b) PACE HERO LOGO */}
          <img
            id="pace-logo"
            src={PACE_HERO_LOGO_URL}
            alt="PACE — Pacific Asian Center for Entrepreneurship"
            className="h-24 md:h-32 w-auto mb-10 animate-fade-in drop-shadow-lg"
          />

          <h1 className="font-extrabold text-4xl sm:text-5xl md:text-6xl lg:text-7xl max-w-4xl leading-[1.05] animate-fade-in-up animate-headline-glow">
            Your Entrepreneurial<br className="hidden sm:block" /> Journey Starts Here
          </h1>

          <p className="mt-8 max-w-2xl text-base md:text-lg text-white/75 leading-relaxed animate-fade-in-up [animation-delay:150ms]">
            Meet your AI-powered PACE advisors — available 24/7 to guide you through
            programs, funding, mentorship, and business coaching.
          </p>

          <div className="mt-10 flex items-center gap-3 animate-fade-in-up [animation-delay:300ms]">
            <a
              href="#experiences"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/25 px-6 py-3 text-sm font-semibold backdrop-blur transition-smooth"
            >
              Choose your experience
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </main>

        <WaveDivider />
      </header>

      {/* =========================================================
           AVATAR SELECTION
         ========================================================= */}
      <section id="experiences" className="relative bg-background py-20 md:py-28">
        <div className="container mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14 md:mb-20">
            <span className="inline-block text-xs font-bold tracking-[0.18em] uppercase text-pace-green mb-3">
              AI Advisors
            </span>
            <h2 className="text-3xl md:text-5xl font-extrabold text-pace-navy">
              Choose Your Experience
            </h2>
            <p className="mt-5 text-muted-foreground text-base md:text-lg">
              Two intelligent guides, one mission — to help you build what's next.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* CARD 1 — Kai */}
            <article
              className="group relative rounded-2xl bg-card border border-border p-8 md:p-10 shadow-card hover:shadow-card-hover hover:-translate-y-2 transition-smooth animate-fade-in-up"
            >
              <div className="absolute -top-px left-8 right-8 h-1 bg-green-gradient rounded-b-full" aria-hidden="true" />
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-pace-green/10 text-pace-green mb-6 group-hover:scale-110 transition-smooth">
                <ChatBubbleIcon />
              </div>
              <h3 className="text-2xl md:text-3xl font-bold text-pace-navy mb-3">
                Meet Kai: Your PACE Guide
              </h3>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Chat with Kai, your virtual PACE advisor. Ask about programs, events,
                funding opportunities, competitions, and how to get involved —
                available anytime, day or night.
              </p>
              <button
                onClick={() => setOpenModal("kai")}
                className="inline-flex items-center gap-2 rounded-full bg-green-gradient text-primary-foreground font-semibold px-7 py-3.5 shadow-card transition-smooth group-hover:shadow-[0_18px_40px_-12px_hsl(var(--pace-green)/0.65)] group-hover:-translate-y-0.5"
              >
                Talk to Kai
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
              </button>
            </article>

            {/* CARD 2 — Business Coach */}
            <article
              className="group relative rounded-2xl bg-card border border-border p-8 md:p-10 shadow-card hover:shadow-card-hover hover:-translate-y-2 transition-smooth animate-fade-in-up [animation-delay:120ms]"
            >
              <div className="absolute -top-px left-8 right-8 h-1 bg-gold-gradient rounded-b-full" aria-hidden="true" />
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-pace-navy/10 text-pace-navy mb-6 group-hover:scale-110 transition-smooth">
                <BriefcaseIcon />
              </div>
              <h3 className="text-2xl md:text-3xl font-bold text-pace-navy mb-3">
                Meet Your Business Coach
              </h3>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Connect with a live AI business coach for personalized
                entrepreneurship advice. Get guidance on your business idea,
                strategy, pitching, and more — in real time.
              </p>
              <button
                onClick={() => setOpenModal("coach")}
                className="inline-flex items-center gap-2 rounded-full bg-pace-navy text-primary-foreground font-semibold px-7 py-3.5 border-2 border-pace-gold shadow-card transition-smooth group-hover:shadow-[0_18px_40px_-12px_hsl(var(--pace-gold)/0.65)] group-hover:-translate-y-0.5"
              >
                Start Coaching Session
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
              </button>
            </article>
          </div>
        </div>
      </section>

      {/* =========================================================
           ABOUT PACE STRIP
         ========================================================= */}
      <section className="relative bg-muted">
        <WaveDivider flip fill="hsl(var(--background))" />
        <div className="container mx-auto px-6 py-16 md:py-20">
          <div className="grid md:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
            <div>
              <span className="inline-block text-xs font-bold tracking-[0.18em] uppercase text-pace-green mb-3">
                About PACE
              </span>
              <h2 className="text-2xl md:text-4xl font-extrabold text-pace-navy mb-5 leading-tight">
                Educating innovative problem solvers across Hawaiʻi.
              </h2>
              <p className="text-muted-foreground leading-relaxed text-base md:text-lg">
                The Pacific Asian Center for Entrepreneurship (PACE) at the
                University of Hawaiʻi at Mānoa's Shidler College of Business is
                dedicated to educating innovative problem solvers. Open to all UH
                students across all 10 campuses.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 gap-4">
              {[
                { Icon: CampusIcon, number: "10", label: "UH Campuses Served" },
                { Icon: RocketIcon, number: "Every", label: "Stage of Programs" },
                { Icon: HandshakeIcon, number: "Real", label: "Mentors, Real Results" },
              ].map(({ Icon, number, label }, i) => (
                <div
                  key={label}
                  className="rounded-2xl bg-background border border-border p-6 text-center shadow-card hover:-translate-y-1 transition-smooth"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-pace-green/10 text-pace-green mb-3">
                    <Icon />
                  </div>
                  <div className="text-2xl md:text-3xl font-extrabold text-pace-navy leading-none">
                    {number}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2 font-medium">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
           FOOTER
         ========================================================= */}
      <footer className="bg-pace-navy-deep text-primary-foreground">
        <div className="container mx-auto px-6 py-14">
          <div className="grid md:grid-cols-3 gap-10 items-center">
            {/* Logo */}
            <div className="flex md:justify-start justify-center">
              {/* (1) PACE LOGO — swap src */}
              <img
                src={PACE_LOGO_URL}
                alt="PACE Logo"
                className="h-16 w-16 rounded-full object-cover"
              />
            </div>

            {/* Center contact */}
            <div className="text-center text-sm leading-relaxed text-white/80">
              <p className="font-semibold text-white">
                Pacific Asian Center for Entrepreneurship
              </p>
              <p>University of Hawaiʻi at Mānoa · Shidler College of Business</p>
              <p className="mt-2">
                <a href="mailto:pace@hawaii.edu" className="hover:text-pace-gold transition-smooth">
                  pace@hawaii.edu
                </a>
                <span className="mx-2 text-white/40">|</span>
                <a href="tel:+18089565083" className="hover:text-pace-gold transition-smooth">
                  (808) 956-5083
                </a>
              </p>
            </div>

            {/* Right links */}
            <div className="flex items-center justify-center md:justify-end gap-5">
              <a
                href="https://pace.shidler.hawaii.edu"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold rounded-full border border-white/25 hover:border-pace-gold hover:text-pace-gold px-5 py-2.5 transition-smooth"
              >
                Visit PACE Website
              </a>
              <a
                href="https://instagram.com/pacehawaii"
                target="_blank"
                rel="noreferrer"
                aria-label="PACE on Instagram (@pacehawaii)"
                className="h-10 w-10 rounded-full border border-white/25 hover:border-pace-gold hover:text-pace-gold flex items-center justify-center transition-smooth"
              >
                <InstagramIcon />
              </a>
              <a
                href="https://youtube.com/@pacehawaii"
                target="_blank"
                rel="noreferrer"
                aria-label="PACE on YouTube"
                className="h-10 w-10 rounded-full border border-white/25 hover:border-pace-gold hover:text-pace-gold flex items-center justify-center transition-smooth"
              >
                <YouTubeIcon />
              </a>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-white/10 text-center text-xs text-white/55">
            © 2025 Shidler College of Business. All rights reserved.
          </div>
        </div>
      </footer>

      {/* =========================================================
           MODALS
         ========================================================= */}
      {/* (2) Kai LiveAvatar embed */}
      <AvatarModal
        open={openModal === "kai"}
        onClose={() => setOpenModal(null)}
        title="Meet Kai — Your PACE Guide"
        src={KAI_EMBED_LINK}
      />
      {/* (3) Business Coach LiveAvatar embed */}
      <AvatarModal
        open={openModal === "coach"}
        onClose={() => setOpenModal(null)}
        title="AI Business Coach"
        src={COACH_EMBED_LINK}
      />
    </div>
  );
};

export default Index;
