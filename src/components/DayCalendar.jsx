import React, { useEffect, useMemo, useRef } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import SessionBlock from "@/components/SessionBlock";
import { PX_PER_HOUR, hourWindow } from "@/lib/dayLayout";
import { HOUR, fmtHour, isSameDay } from "@/lib/time";

/* room for the hour labels down the left edge */
const GUTTER = 52;

export default function DayCalendar({
  blocks,
  dayStart,
  now,
  full,
  onRename,
  onJumpToToday,
  editingId,
  onEdit,
  onEndEdit,
}) {
  const viewportRef = useRef(null);
  const isToday = isSameDay(dayStart, now);

  const { lo, hi } = useMemo(
    () => hourWindow(blocks, dayStart, now, isToday, full),
    [blocks, dayStart, now, isToday, full]
  );

  const offset = lo * PX_PER_HOUR;
  const gridHeight = (hi - lo) * PX_PER_HOUR;
  const nowTop = ((now - dayStart) / HOUR) * PX_PER_HOUR - offset;

  /* Land on the day's activity rather than the top of an empty grid. Keyed on
     the day, not on `now` — re-anchoring every tick would fight the scroll. */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const anchor = isToday
      ? ((Date.now() - dayStart) / HOUR) * PX_PER_HOUR - offset
      : blocks.length
        ? blocks[0].top - offset
        : 0;
    el.scrollTop = Math.max(0, anchor - 96);
  }, [dayStart, full, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const hours = [];
  for (let h = lo; h < hi; h++) hours.push(h);

  return (
    <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
      <div className="relative px-4 pb-8" style={{ height: gridHeight + 32 }}>
        {hours.map((h) => (
          <div
            key={h}
            className="absolute left-4 right-4 border-t border-border/70"
            style={{ top: (h - lo) * PX_PER_HOUR }}
          >
            <span className="tab absolute -top-2 left-0 bg-background pr-2 text-[10px] text-muted-foreground">
              {fmtHour(h)}
            </span>
          </div>
        ))}

        <div
          className="absolute top-0 right-4"
          style={{ left: 16 + GUTTER, height: gridHeight }}
        >
          {blocks.map((b) => (
            <SessionBlock
              key={b.key}
              block={{ ...b, top: b.top - offset }}
              onRename={onRename}
              editing={editingId === b.session.id}
              onEdit={onEdit}
              onEndEdit={onEndEdit}
            />
          ))}
        </div>

        {isToday && nowTop >= 0 && nowTop <= gridHeight && (
          <div
            /* starts at the gutter edge, like the blocks, so it does not
               strike through the hour label it lands next to */
            className="pointer-events-none absolute right-4 z-10 flex items-center"
            style={{ top: nowTop, left: 16 + GUTTER - 6 }}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
            <span className="h-px flex-1 bg-destructive/70" />
          </div>
        )}

        {/* the grid stays behind it, so an empty day still reads as a calendar */}
        {blocks.length === 0 && (
          <div
            className="absolute inset-x-0 flex flex-col items-center gap-2"
            style={{ top: gridHeight / 2 - 28 }}
          >
            <p className="text-xs text-muted-foreground">
              No focus sessions logged.
            </p>
            {isToday ? (
              <p className="text-[11px] text-muted-foreground/70">
                Dial a time and press start.
              </p>
            ) : (
              <Button variant="outline" size="sm" onClick={onJumpToToday}>
                Jump to today
              </Button>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
