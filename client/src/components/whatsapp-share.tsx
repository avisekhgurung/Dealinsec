/**
 * "Share on WhatsApp": shows the prefilled message so it can be edited, then opens WhatsApp with it. The person picks
 * the contact and presses send in WhatsApp; DealInSec sends nothing (shared/whatsapp-share.ts).
 */
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { trackEvent } from "@/lib/analytics";
import { whatsappShareUrl } from "@shared/whatsapp-share";

export function WhatsAppShareButton({ message, what, label = "Share on WhatsApp", size = "sm", variant = "outline", className, testId }: {
  /** The prefilled text (the person can change it before it opens). */
  message: string;
  /** What is being shared, for analytics only (a fixed id, never the text). */
  what: "quotation" | "agreement" | "invoice_reminder";
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(message);
  return (
    <>
      <Button type="button" size={size} variant={variant} className={className} onClick={() => { setText(message); setOpen(true); }} data-testid={testId ?? `button-whatsapp-${what}`}>
        <MessageCircle className="w-3.5 h-3.5 mr-1.5" aria-hidden />{label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share on WhatsApp</DialogTitle>
            <DialogDescription>Edit the message if you like. WhatsApp opens with it, you choose the contact and send it yourself.</DialogDescription>
          </DialogHeader>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={1500} aria-label="Message" data-testid="whatsapp-message" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button asChild className="gradient-btn text-white" data-testid="whatsapp-open">
              <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer" onClick={() => { trackEvent("document_shared", { what, channel: "whatsapp" }); setOpen(false); }}>
                <MessageCircle className="w-4 h-4 mr-1.5" aria-hidden />Open WhatsApp
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
