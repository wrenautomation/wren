import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Ring } from "../../busy.js";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      // The artifact's toast: bottom centre, 22 px up, words and Undo, no icon.
      position="bottom-center"
      offset={22}
      mobileOffset={22}
      gap={8}
      icons={{ loading: <Ring /> }}
      style={
        {
          "--normal-bg": "var(--ui-ink)",
          "--normal-text": "var(--ui-paper)",
          "--normal-border": "transparent",
          "--border-radius": "var(--ui-leaf-button)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
