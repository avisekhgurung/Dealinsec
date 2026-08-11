/**
 * FeedbackCard — rating + suggestion form (Settings → Preferences).
 *
 * Any member can send it; opinions are not a permission. Stored server-side
 * and emailed to the founder, capped at 5/user/day. Star rating is required;
 * the message is where the value lives, so the placeholder asks the question
 * we actually want answered.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, Loader2, MessageSquareHeart, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";
import { feedbackCategories } from "@shared/schema";

const CATEGORY_LABEL: Record<(typeof feedbackCategories)[number], string> = {
  suggestion: "💡 Suggestion",
  bug: "🐛 Something's broken",
  praise: "❤️ Praise",
  other: "💬 Other",
};

export function FeedbackCard() {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [category, setCategory] = useState<(typeof feedbackCategories)[number] | null>(null);
  const [message, setMessage] = useState("");
  const [allowTestimonial, setAllowTestimonial] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/feedback", {
        rating,
        category: category ?? undefined,
        message: message.trim() || undefined,
        allowTestimonial,
      });
      return res.json();
    },
    onSuccess: () => {
      setSent(true);
      toast({ title: "Thank you!", description: "Your feedback went straight to the founder." });
    },
    onError: (err) => {
      toast({
        title: "Could not send feedback",
        description: parseApiError(err).error || "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (sent) {
    return (
      <Card className="glass-card">
        <CardContent className="p-5 lg:p-6 text-center py-10">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
            <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="font-bold">Feedback sent</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            It goes straight to the founder — every message gets read.
          </p>
          <Button
            variant="outline" size="sm" className="mt-4"
            onClick={() => { setSent(false); setRating(0); setCategory(null); setMessage(""); setAllowTestimonial(false); }}
            data-testid="button-feedback-again"
          >
            Send another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardContent className="p-5 lg:p-6 space-y-5">
        <div className="flex items-start gap-2.5">
          <MessageSquareHeart className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div>
            <h2 className="font-bold text-lg">Rate &amp; suggest</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              What should DealInSec do better? Your message goes straight to the founder.
            </p>
          </div>
        </div>

        {/* Stars */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">How is DealInSec working for you?</p>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating out of 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className="p-1 -m-0.5 rounded-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                data-testid={`star-${n}`}
              >
                <Star
                  className={`w-7 h-7 transition-colors ${
                    n <= (hover || rating)
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/30"
                  }`}
                />
              </button>
            ))}
            {rating > 0 && (
              <span className="ml-2 text-sm font-semibold tabular-nums">{rating}/5</span>
            )}
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          {feedbackCategories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(category === c ? null : c)}
              aria-pressed={category === c}
              data-testid={`feedback-cat-${c}`}
              className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
                category === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's one thing that would make DealInSec better for you?"
          rows={4}
          maxLength={2000}
          data-testid="input-feedback-message"
        />

        {message.trim() && (
          <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-border p-3 hover:border-primary/40 transition-colors">
            <input
              type="checkbox"
              checked={allowTestimonial}
              onChange={(e) => setAllowTestimonial(e.target.checked)}
              className="mt-0.5 accent-[hsl(var(--primary))]"
              data-testid="checkbox-allow-testimonial"
            />
            <span className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">DealInSec may publish this as a testimonial</span>{" "}
              with my name and business type. Leave unticked to keep it private — it reaches the founder either way.
            </span>
          </label>
        )}

        <Button
          className="w-full sm:w-auto gradient-btn text-white font-semibold"
          disabled={rating === 0 || submit.isPending}
          onClick={() => submit.mutate()}
          data-testid="button-send-feedback"
        >
          {submit.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
            : "Send feedback"}
        </Button>
        {rating === 0 && (
          <p className="text-[11px] text-muted-foreground -mt-3">Pick a star rating to send.</p>
        )}
      </CardContent>
    </Card>
  );
}
