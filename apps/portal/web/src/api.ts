/** The portal API: POST /api/<route> with JSON. The Worker adds who is asking. */
export type {
  CrmHealth,
  Me,
  Now,
  Overview,
  PeopleFilter,
  PeoplePage,
  PersonRow,
  PersonView,
  RankedContact,
  RawFinding,
  RawPage,
  Reason,
  Source,
} from "@wren/reactivation/restate";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function call<T>(route: string, body: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("You're offline, or the portal is. Try again.", 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: an error page from the edge.
  }
  if (!res.ok) {
    const d = data as { message?: string; error?: string } | null;
    throw new ApiError(
      d?.message ?? d?.error ?? `Something went wrong (${res.status}).`,
      res.status,
    );
  }
  return data as T;
}
