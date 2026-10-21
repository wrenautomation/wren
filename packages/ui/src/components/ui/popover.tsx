import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const popup = React.useRef<HTMLDivElement>(null)
  useDragDown(popup)
  return (
    <PopoverPrimitive.Portal>
      {/* A phone: the popup is a sheet from the bottom, over a dimmed page. */}
      <PopoverPrimitive.Backdrop className="fixed inset-0 z-50 hidden bg-(--ui-scrim) duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 max-[900px]:block" />
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50 max-[900px]:fixed! max-[900px]:inset-x-0! max-[900px]:top-auto! max-[900px]:bottom-0! max-[900px]:transform-none!"
      >
        <PopoverPrimitive.Popup
          ref={popup}
          data-slot="popover-content"
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-(--ui-leaf-box) bg-popover p-2.5 text-sm text-popover-foreground shadow-(--ui-float) outline-hidden duration-100 ease-(--ui-ease) data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
            SHEET
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

/**
 * On a phone a popup rises from the bottom as a sheet: full width, a grabber on top, clear of the
 * home bar, and it slides rather than zooms. Last in the classes, so it wins over a caller's.
 */
const SHEET =
  "max-[900px]:mx-auto max-[900px]:w-full! max-[900px]:max-w-[640px]! max-[900px]:max-h-[min(72dvh,560px)]! max-[900px]:min-w-0! max-[900px]:overflow-y-auto max-[900px]:overscroll-contain max-[900px]:rounded-b-none! max-[900px]:rounded-t-2xl! max-[900px]:border-t max-[900px]:border-(--ui-rim) max-[900px]:px-3! max-[900px]:pt-6! max-[900px]:pb-[calc(12px+env(safe-area-inset-bottom))]! max-[900px]:shadow-(--ui-shadow)! max-[900px]:ring-0! max-[900px]:duration-300 max-[900px]:zoom-in-100! max-[900px]:zoom-out-100! max-[900px]:slide-in-from-bottom-[40%]! max-[900px]:slide-out-to-bottom-[40%]! max-[900px]:before:absolute max-[900px]:before:top-2 max-[900px]:before:left-1/2 max-[900px]:before:h-[5px] max-[900px]:before:w-9 max-[900px]:before:-translate-x-1/2 max-[900px]:before:rounded-full max-[900px]:before:bg-(--ui-ink-3) max-[900px]:before:opacity-50 max-[900px]:before:content-['']"

/**
 * A popup sheet follows a finger pulling it down from its top, and past a third of its height
 * it shuts, by the Escape the popup already answers.
 */
function useDragDown(ref: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia?.("(max-width: 899.98px)").matches) return
    let y0 = 0
    let dy = 0
    let live = false
    const el = () => ref.current
    const start = (e: TouchEvent) => {
      const t = e.touches[0]
      const p = el()
      live = !!t && !!p && e.touches.length === 1 && p.scrollTop <= 0
      y0 = t?.clientY ?? 0
      dy = 0
    }
    const move = (e: TouchEvent) => {
      const t = e.touches[0]
      const p = el()
      if (!live || !t || !p) return
      dy = t.clientY - y0
      if (dy <= 0) {
        p.style.transform = ""
        return
      }
      if (e.cancelable) e.preventDefault()
      p.style.transition = "none"
      p.style.transform = `translate3d(0, ${dy}px, 0)`
    }
    const end = () => {
      const p = el()
      if (!live || !p) return
      live = false
      p.style.transition = "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)"
      if (dy > p.offsetHeight / 3) {
        p.style.transform = `translate3d(0, ${p.offsetHeight}px, 0)`
        p.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      } else p.style.transform = ""
    }
    // The popup mounts after its trigger: listen on the document, act on touches inside it.
    const inside = (f: (e: TouchEvent) => void) => (e: TouchEvent) => {
      const p = el()
      if (p && e.target instanceof Node && p.contains(e.target)) f(e)
    }
    const s = inside(start)
    const m = inside(move)
    document.addEventListener("touchstart", s, { passive: true })
    document.addEventListener("touchmove", m, { passive: false })
    document.addEventListener("touchend", end)
    return () => {
      document.removeEventListener("touchstart", s)
      document.removeEventListener("touchmove", m)
      document.removeEventListener("touchend", end)
    }
  }, [ref])
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
