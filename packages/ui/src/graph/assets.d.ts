// Vite asset imports, used where a file must ship unbundled.
declare module "*?url" {
  const url: string;
  export default url;
}
