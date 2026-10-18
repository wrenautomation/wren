/** Every record type's meta the worker serves: `.storybook/main.ts` makes it in Node. */
declare module "virtual:record-types" {
  const types: import("@wren/core/records").RecordMeta[];
  export default types;
}
