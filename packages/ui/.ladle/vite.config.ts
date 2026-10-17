import tailwindcss from "@tailwindcss/vite";

// The portal's Tailwind plugin. React comes from Ladle's own plugin: Ladle runs Vite 6, and the
// portal's `@vitejs/plugin-react` 6 needs Vite 8.
export default { plugins: [tailwindcss()] };
