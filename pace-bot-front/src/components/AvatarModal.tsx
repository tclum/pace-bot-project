import { useEffect } from "react";

interface AvatarModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** HeyGen iframe embed URL */
  src: string;
}

const AvatarModal = ({ open, onClose, title, src }: AvatarModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-pace-navy-deep/85 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="relative w-[80vw] h-[80vh] max-w-[1400px] bg-background rounded-2xl shadow-card-hover overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 h-10 w-10 rounded-full bg-pace-navy text-primary-foreground hover:bg-pace-green transition-smooth flex items-center justify-center text-xl font-semibold shadow-card"
        >
          ✕
        </button>
        <iframe
          title={title}
          src={src}
          width="100%"
          height="100%"
          allow="camera; microphone; autoplay; fullscreen"
          allowFullScreen
          className="border-0 w-full h-full"
        />
      </div>
    </div>
  );
};

export default AvatarModal;
