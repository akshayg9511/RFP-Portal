"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerFrame,
  DrawerHeader,
  Icon,
} from "@/ds/components";

/**
 * The app's drawer.
 *
 * Quince Core's Drawer binding is structure and ARIA only — deliberately no
 * focus trap, scroll lock or portal, because those are decisions a product
 * owns. This adds them once so every drawer in Procura behaves the same:
 * Escape closes, focus is trapped and restored, the page behind does not
 * scroll, and it renders at the end of <body> so a transformed ancestor cannot
 * position it.
 */
export function SideDrawer({
  open,
  onClose,
  title,
  sub,
  size = "lg",
  onPrev,
  onNext,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  sub?: React.ReactNode;
  size?: "sm" | "lg";
  onPrev?: () => void;
  onNext?: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // The DS Drawer does not forward a ref, so the trap scopes to a wrapper
  // rather than patching a vendored component.
  const panel = React.useRef<HTMLDivElement>(null);
  const restoreTo = React.useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const { overflow, paddingInlineEnd } = document.body.style;
    document.body.style.overflow = "hidden";
    // Compensate so the page behind does not shift as the scrollbar goes.
    if (scrollbar > 0) document.body.style.paddingInlineEnd = `${scrollbar}px`;

    panel.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    )?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panel.current) return;

      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      document.body.style.paddingInlineEnd = paddingInlineEnd;
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <DrawerFrame
      onMouseDown={(event) => {
        // Only a click on the scrim itself closes — not a drag that ended here.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panel} style={{ display: "contents" }}>
      <Drawer size={size} labelledBy="drawer-title">
        <DrawerHeader sub={sub}>
          <div className="row">
            <span className="ttl" id="drawer-title">
              {title}
            </span>
            <div className="drawer-actions">
              {onPrev ? (
                <button
                  className="btn btn--ghost icon"
                  onClick={onPrev}
                  aria-label="Previous style"
                >
                  <Icon name="chevron_left" />
                </button>
              ) : null}
              {onNext ? (
                <button
                  className="btn btn--ghost icon"
                  onClick={onNext}
                  aria-label="Next style"
                >
                  <Icon name="chevron_right" />
                </button>
              ) : null}
              <button className="x" onClick={onClose} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>
          </div>
        </DrawerHeader>

        <DrawerBody>{children}</DrawerBody>
        {footer ? <DrawerFooter>{footer}</DrawerFooter> : null}
      </Drawer>
      </div>
    </DrawerFrame>,
    document.body,
  );
}
