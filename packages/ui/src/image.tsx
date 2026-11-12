/**
 * Every picture in the app: a shimmer while it loads, a quiet tint if it fails. Never the
 * browser's broken-image icon: `alt` goes on only once the picture is in.
 */
import { type ImgHTMLAttributes, useLayoutEffect, useRef, useState } from "react";

type Look = "wait" | "in" | "bad";

export function Img({
  src,
  alt = "",
  className,
  onLoad,
  onError,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [look, setLook] = useState<Look>(src ? "wait" : "bad");
  // a cached picture can finish before React binds onLoad
  useLayoutEffect(() => {
    const el = ref.current;
    if (!src) return setLook("bad");
    setLook(el?.complete ? (el.naturalWidth ? "in" : "bad") : "wait");
  }, [src]);
  return (
    <img
      ref={ref}
      src={src || undefined}
      alt={look === "in" ? alt : ""}
      aria-busy={look === "wait" || undefined}
      data-img={look}
      className={className ? `ui-img ${className}` : "ui-img"}
      onLoad={(e) => {
        setLook("in");
        onLoad?.(e);
      }}
      onError={(e) => {
        setLook("bad");
        onError?.(e);
      }}
      {...rest}
    />
  );
}
