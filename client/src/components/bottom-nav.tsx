import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, Link } from "wouter";
import { MoreHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV_ICONS, isMoreActive, mobileBarItems, moreSheetSections } from "@/lib/nav";

/**
 * Mobile tab bar — the same lit ink-green surface as the desktop top bar, so
 * the phone app and the desktop app read as one product. Five items share
 * the width equally: Home, Outbound, Leads, Deals and More. "More" opens a
 * bottom sheet with the rest of the product, grouped as on desktop —
 * Documents (Quotations, Agreements), Money (Invoices) and Account (Profile,
 * Settings). Items, gating and active-route rules come from @shared/nav-model;
 * styles live in index.css (.dis-bottomnav*, .dis-moresheet*).
 *
 * Rendered per page (not in the shell), so navigating away unmounts the sheet
 * with the page; the location effect below covers routes that keep the page.
 */
/**
 * Rendered into <body>, not inside the page: pages fade in on navigation (RouteTransition), and the navigation bar
 * must stay perfectly still while they do.
 */
export function BottomNav() {
  if (typeof document === "undefined") return null;
  return createPortal(<BottomNavBar />, document.body);
}

function BottomNavBar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => setMoreOpen(false), [location]);

  const moreActive = isMoreActive(location);
  const sections = moreSheetSections(user as any);

  const label = (text: string, active: boolean) => (
    <span className={`max-w-full truncate px-0.5 text-[11px] leading-none tracking-tight min-[400px]:text-[12px] ${active ? "font-bold" : "font-medium"}`}>
      {text}
    </span>
  );

  return (
    <nav aria-label="Primary" className="dis-bottomnav fixed bottom-0 inset-x-0 z-50 safe-area-pb lg:hidden">
      <div className="flex items-stretch h-16 max-w-lg mx-auto px-1.5">
        {mobileBarItems(user as any).map((item) => {
          const active = item.isActive(location);
          const Icon = NAV_ICONS[item.key];
          return (
            <Link
              key={item.key}
              href={item.href}
              data-testid={`nav-${item.key}`}
              aria-current={active ? "page" : undefined}
              className="dis-bottomnav-item relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 outline-none"
            >
              <span className="dis-bottomnav-icon relative flex items-center justify-center w-11 h-7 rounded-full">
                <Icon className="w-[19px] h-[19px]" strokeWidth={active ? 2.4 : 1.8} />
              </span>
              {label(item.shortLabel, active)}
            </Link>
          );
        })}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          {/* Radix sets aria-haspopup="dialog", aria-expanded and aria-controls,
              closes on Escape and hands focus back to this button. */}
          <SheetTrigger
            data-testid="nav-more"
            aria-current={moreActive ? "page" : undefined}
            className="dis-bottomnav-item relative flex-1 min-w-0 flex flex-col items-center justify-center gap-1 outline-none"
          >
            <span className="dis-bottomnav-icon relative flex items-center justify-center w-11 h-7 rounded-full">
              <MoreHorizontal className="w-[19px] h-[19px]" strokeWidth={moreActive ? 2.4 : 1.8} />
            </span>
            {label("More", moreActive)}
          </SheetTrigger>

          <SheetContent side="bottom" className="dis-moresheet dis-bottomnav border-0 p-0 text-white">
            <div className="safe-area-pb">
              <div className="max-w-lg mx-auto px-4 pt-5 pb-4">
                <SheetTitle className="text-[17px] font-bold text-white">More</SheetTitle>
                <SheetDescription className="sr-only">Documents, money and your account</SheetDescription>

                <div className="mt-3 space-y-4">
                  {sections.map((section) => (
                    <section key={section.group} aria-labelledby={`more-${section.group}`}>
                      <h3
                        id={`more-${section.group}`}
                        className="px-1 pb-1.5 text-[12px] font-semibold uppercase tracking-wider text-emerald-200/80"
                      >
                        {section.label}
                      </h3>
                      <ul className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
                        {section.items.map((item) => {
                          const active = item.isActive(location);
                          const Icon = NAV_ICONS[item.key];
                          return (
                            <li key={item.key}>
                              <Link
                                href={item.href}
                                onClick={() => setMoreOpen(false)}
                                data-testid={`nav-more-${item.key}`}
                                aria-current={active ? "page" : undefined}
                                className="dis-moresheet-item flex items-center gap-3 min-h-[48px] px-3 rounded-xl text-[15px] font-semibold outline-none"
                              >
                                <Icon className="w-5 h-5 shrink-0" strokeWidth={active ? 2.3 : 1.9} />
                                <span className="truncate">{item.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
