import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("ui-skeleton relative overflow-hidden rounded-(--ui-leaf-line) bg-(--ui-fill)", className)}
      {...props}
    />
  )
}

export { Skeleton }
