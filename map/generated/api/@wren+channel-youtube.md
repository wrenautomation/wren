# @wren/channel-youtube: interface

Exports: 7. Files: 1.

## packages/channel-youtube/src/content.ts

- **isoSeconds** (function) `(d: string | undefined): number | null`
- **reachRows** (function) `(csv: ReadonlyArray<Record<string, string>>): Array<{ id: string; day: string; impressions: number; clicks: number; rated: number }>`
- **sharesOf** (function) `(metric: string, rows: ReadonlyArray<Record<string, unknown>>, keyOf: (r: Record<string, unknown>) => string | null, col: string): InsightValue[]`
- **youtubeContent** (function) `(sites: SiteClient, o: YouTubeContentOptions = {}): ContentChannel`
- **reportRows** (function) `(r: Report): Array<Record<string, unknown>>`
- **ANALYTICS_PATH** (const) `"/v2/reports"`
- **REACH_REPORT** (const) `"channel_reach_basic_a1"`
