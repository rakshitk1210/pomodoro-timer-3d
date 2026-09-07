import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import DayCalendar from "@/components/DayCalendar";
import { useSessionLog } from "@/hooks/useSessionLog";
import { rename } from "@/lib/sessionLog";
import { layoutDay } from "@/lib/dayLayout";
import {
  addDays,
  fmtDayHeading,
  fmtDuration,
  isSameDay,
  startOfDay,
} from "@/lib/time";

/* One tick for the now-line and for the live block's growth. 20s at 64px/hr
   is 0.36px, imperceptible — and it only runs while the drawer is open, so a
   closed drawer costs nothing. Never rAF, and never derived from the
   countdown's `seconds`: that is what keeps this subtree off the 60fps path. */
const TICK_MS = 20_000;

/* Memoized, and it deliberately takes NO data props — it subscribes to the
   store itself. TimerScene re-renders ~60x/sec while a timer runs; `open` is a
   boolean and `onOpenChange` is a useState setter, so both are referentially
   stable and this memo bails out on every one of those frames. Passing a
   derived array or an inline arrow from the parent would defeat it. */
function SessionDrawer({ open, onOpenChange }) {
  const { sessions } = useSessionLog();
  const [dayStart, setDayStart] = useState(() => startOfDay(Date.now()));
  const [full, setFull] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /* which block is being renamed. It lives here, not in the block, because
     the Sheet has to know: Radix takes Escape on document in the capture
     phase, so only SheetContent can decline it and cancel the edit instead
     of closing the whole drawer. */
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [open]);

  /* reopening should land on today, not on wherever you last browsed */
  useEffect(() => {
    if (!open) return;
    setDayStart(startOfDay(Date.now()));
    setEditingId(null);
  }, [open]);

  const { blocks, totalMs, count } = useMemo(
    () => layoutDay(sessions, dayStart, now),
    [sessions, dayStart, now]
  );

  const isToday = isSameDay(dayStart, now);
  const goToday = useCallback(() => setDayStart(startOfDay(Date.now())), []);
  const onRename = useCallback((id, name) => rename(id, name), []);
  const onEdit = useCallback((id) => setEditingId(id), []);
  const onEndEdit = useCallback(() => setEditingId(null), []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="dm flex w-full flex-col gap-0 p-0 sm:max-w-md"
        onEscapeKeyDown={(e) => {
          if (!editingId) return;
          e.preventDefault();
          setEditingId(null);
        }}
      >
        <SheetHeader className="gap-3 pb-3">
          <SheetTitle className="sr-only">Focus log</SheetTitle>

          <div className="flex items-center gap-1 pr-8">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous day"
              onClick={() => setDayStart((d) => addDays(d, -1))}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next day"
              disabled={isToday}
              onClick={() => setDayStart((d) => addDays(d, 1))}
            >
              <ChevronRightIcon />
            </Button>
            <span className="ml-1 text-sm font-medium">
              {fmtDayHeading(dayStart, now)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {!isToday && (
                <Button variant="ghost" size="xs" onClick={goToday}>
                  Today
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                aria-pressed={full}
                onClick={() => setFull((v) => !v)}
              >
                {full ? "Auto" : "24h"}
              </Button>
            </div>
          </div>

          {/* daily summary. totalMs comes from real milliseconds, so the
              min-height clamp on short blocks never leaks into it. */}
          <div className="rounded-lg bg-muted/60 px-3 py-2.5">
            <div className="tab text-xl font-medium leading-tight">
              {totalMs > 0 ? fmtDuration(totalMs) : "0m"}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                focused
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {count === 1 ? "1 session" : `${count} sessions`}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary/70 transition-[width] duration-500"
                /* against an 8 hour day, capped so a long day still reads */
                style={{
                  width: `${Math.min(100, (totalMs / (8 * 3600e3)) * 100)}%`,
                }}
              />
            </div>
          </div>
        </SheetHeader>

        <Separator />

        <DayCalendar
          blocks={blocks}
          dayStart={dayStart}
          now={now}
          full={full}
          onRename={onRename}
          onJumpToToday={goToday}
          editingId={editingId}
          onEdit={onEdit}
          onEndEdit={onEndEdit}
        />
      </SheetContent>
    </Sheet>
  );
}

export default React.memo(SessionDrawer);
