import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("ui-skeleton relative overflow-hidden rounded-[3px_8px_3px_8px] bg-(--ui-fill)", className)}
      {...props}
    />
  )
}

export { Skeleton }
