import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Ring } from "../../busy.js";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      // The artifact's toast: bottom centre, 22 px up, words and Undo, no icon.
      position="bottom-center"
      // 22 px up; above the phone tab bar while it shows (tailwind.css --ui-toast-bottom)
      offset={{ bottom: "var(--ui-toast-bottom, 22px)", left: 22, right: 22 }}
      mobileOffset={{ bottom: "var(--ui-toast-bottom, 22px)", left: 16, right: 16 }}
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
