import base from "./drizzle.config";

// The drift gate (scripts/gates.sh): the same schema, generated into a copy of drizzle/.
export default { ...base, out: process.env.WREN_DRIFT_OUT ?? "./drizzle" };
